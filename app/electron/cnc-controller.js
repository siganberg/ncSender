import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { EventEmitter } from 'events';
import net from 'net';
import { grblErrors } from './grbl-errors.js';
import { CommandQueue } from './command-queue.js';
import { getSetting, DEFAULT_SETTINGS } from './settings-manager.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export class CNCController extends EventEmitter {
  constructor() {
    super();
    this.connection = null; // Unified connection object
    this.parser = null;
    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.connectionType = null;
    this.statusPollInterval = null;
    this.lastStatus = {};
    this.rawData = '';
    this.connectionAttempt = null; // Track ongoing connection attempts
    this.isConnecting = false; // Track connection state
    this.commandQueue = new CommandQueue({
      log,
      sendCommand: async (entry) => {
        await this.writeToConnection(entry.commandToWrite ?? `${entry.rawCommand}\n`, {
          rawCommand: entry.rawCommand,
          isRealTime: false
        });
      }
    });

    this.setupCommandQueueEvents();
  }

  setupCommandQueueEvents() {
    this.commandQueue.on('send-error', (payload) => {
      this.emit('command-ack', { ...payload, phase: 'send' });
    });

    this.commandQueue.on('queued', (payload) => {
      this.emit('command-queued', payload);
    });

    this.commandQueue.on('ack', (payload) => {
      this.emit('command-ack', payload);
    });
  }

  emitConnectionStatus(status, isConnected = this.isConnected) {
    this.emit('status', {
      status,
      isConnected,
      retryAttempts: 0
    });
  }

  setupDataParser() {
    this.parser = new ReadlineParser({ delimiter: '\n' });
    this.parser.on('data', (data) => this.handleIncomingData(data.trim()));
  }

  handleIncomingData(trimmedData) {
    if (trimmedData.startsWith('<') && trimmedData.endsWith('>')) {
      this.rawData = trimmedData;
      this.parseStatusReport(trimmedData);
    } else if (trimmedData.startsWith('[GC:') && trimmedData.endsWith(']')) {
      this.parseGCodeModes(trimmedData);
      this.emit('data', trimmedData);
    } else if (trimmedData.toLowerCase().startsWith('error:')) {
      const code = parseInt(trimmedData.split(':')[1]);
      const message = grblErrors[code] || 'Unknown error';
      this.commandQueue.handleError({ code, message });
      this.emit('cnc-error', { code, message });
      this.sendRecoveryNewline();
    } else if (trimmedData.toLowerCase().startsWith('alarm')) {
      this.commandQueue.handleError({ code: 'ALARM', message: trimmedData });
      this.emit('cnc-error', { code: 'ALARM', message: trimmedData });
    } else if (trimmedData.toLowerCase() === 'ok' || trimmedData.toLowerCase().endsWith(':ok')) {
      log('CNC controller responded:', trimmedData);
      this.commandQueue.handleOk();
    } else {
      log('CNC data:', trimmedData);
      this.emit('data', trimmedData);
    }
  }

  sendRecoveryNewline() {
    try {
      this.writeToConnection('\n');
      log('Sent newline to reset firmware parser state after error');
    } catch (error) {
      console.error('Failed to send recovery newline:', error);
    }
  }

  parseStatusReport(data) {
    const parts = data.substring(1, data.length - 1).split('|');
    // Start with previous status to preserve all fields, but ensure it's a clean copy
    let newStatus;
    try {
      newStatus = JSON.parse(JSON.stringify(this.lastStatus || {}));
    } catch (error) {
      console.warn('Error cloning lastStatus, starting fresh:', error.message);
      newStatus = {};
    }

    // Update machine state (always present) - extract state name before colon
    newStatus.status = parts[0].split(':')[0];

    // Parse and update only the fields present in this report
    parts.slice(1).forEach(part => {
      const [key, value] = part.split(':');
      if (key === 'Ov' && value) {
        const [feedrate, rapid, spindle] = value.split(',').map(Number);
        newStatus.feedrateOverride = feedrate;
        newStatus.rapidOverride = rapid;
        newStatus.spindleOverride = spindle;
      } else if (key && value) {
        newStatus[key] = value;
      }
    });

    // Check if anything actually changed by doing a deep comparison
    let hasChanges = false;
    const relevantFields = ['status', 'MPos', 'WCO', 'FS', 'feedrateOverride', 'rapidOverride', 'spindleOverride', 'Pn', 'Bf'];

    for (const field of relevantFields) {
      if (newStatus[field] !== this.lastStatus[field]) {
        hasChanges = true;
        break;
      }
    }

    // Only emit if there are actual changes
    if (hasChanges) {

      this.lastStatus = newStatus;
      this.emit('status-report', newStatus);
    }
  }

  parseGCodeModes(data) {
    // Example: [GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]
    const content = data.substring(4, data.length - 1); // Remove [GC: and ]
    const modes = content.split(' ');

    // Find workspace coordinate system (G54-G59.3)
    const workspaceMode = modes.find(mode => /^G5[4-9]$/.test(mode) || /^G59\.[1-3]$/.test(mode));

    if (workspaceMode) {
      log('Active workspace detected:', workspaceMode);
      // Update workspace in lastStatus
      this.lastStatus.workspace = workspaceMode;
      // Emit updated status with workspace
      this.emit('status-report', { ...this.lastStatus });
    }
  }

  startPolling() {
    if (this.statusPollInterval) return;
    this.statusPollInterval = setInterval(() => {
      // Only send status requests if connected
      if (this.isConnected && this.connection) {
        try {
          this.sendCommand('?');
        } catch (error) {
          console.warn('Status polling failed, stopping polling:', error.message);
          this.stopPolling();
        }
      }
    }, 200);
  }

  stopPolling() {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }
  }

  async listAvailablePorts() {
    try {
      const ports = await SerialPort.list();
      // Filter out Bluetooth and wireless ports
      return ports.filter(port =>
        !port.path.toLowerCase().includes('bluetooth') &&
        !port.path.toLowerCase().includes('wlan') &&
        !port.path.toLowerCase().includes('wifi')
      );
    } catch (error) {
      console.error('Error listing serial ports:', error);
      return [];
    }
  }

  async connectWithSettings(settings) {
    try {

      const { connectionType, ip, port, usbPort, baudRate } = settings;

      // If no connection type, don't attempt connection
      if (!connectionType) {
        log('No connection type specified...');
        return 'no-settings';
      }

      this.isConnecting = true;

      if (connectionType === 'ethernet') {
        if (!ip || !port) {
          log('Incomplete Ethernet settings...');
          this.isConnecting = false;
          return 'no-settings';
        }

        this.connectionAttempt = this.connectEthernet(ip, port);
        return await this.connectionAttempt;
      } else {
        if (!usbPort || !baudRate) {
          log('Incomplete USB settings...');
          this.isConnecting = false;
          return 'no-settings';
        }

        this.connectionAttempt = this.connect(usbPort, baudRate);
        return await this.connectionAttempt;
      }
    } catch (error) {
      this.isConnecting = false;
      this.connectionAttempt = null;
      return false;
    }
  }

  findSuitableUSBPort(ports) {
    return ports.find(port => {
      const path = port.path.toLowerCase();
      return (path.includes('usb') || path.includes('tty.usbserial') || path.includes('ttyusb')) &&
             !path.includes('virtual');
    }) || ports[0];
  }

  onConnectionEstablished(type) {
    log(`CNC controller connected via ${type}`);
    this.isConnected = true;
    this.connectionStatus = 'connected';
    this.emitConnectionStatus('connected', true);
    this.startPolling();
  }

  onConnectionClosed(type) {
    log(`CNC controller disconnected (${type})`);
    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.commandQueue.flush(`${type}-close`);
    this.emitConnectionStatus('disconnected', false);
  }

  async connectEthernet(ip, port) {
    if (this.isConnected) {
      log('Already connected to CNC controller');
      return true;
    }

    try {
      this.connectionType = 'ethernet';
      this.emitConnectionStatus('connecting', false);

      this.connection = new net.Socket();
      this.setupDataParser();
      this.connection.pipe(this.parser);

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          try {
            const conn = this.connection;
            if (conn && !conn.destroyed) {
              conn.removeAllListeners?.();
              conn.destroy();
            }
          } catch (e) {
            log('Error destroying ethernet connection on timeout:', e?.message || e);
          }
          this.isConnecting = false;
          this.connectionAttempt = null;
          reject(new Error('Connection timeout'));
        }, 1000); // 1 second timeout

        this.connection.connect(port, ip, () => {
          clearTimeout(timeoutId);
          this.isConnecting = false;
          this.connectionAttempt = null;
          this.onConnectionEstablished('ethernet');
          resolve(true);
        });

        this.connection.on('error', (error) => {
          clearTimeout(timeoutId);
          console.error('CNC controller ethernet connection error:', error);
          this.isConnecting = false;
          this.connectionAttempt = null;
          this.handleConnectionError(error);
          reject(error);
        });

        this.connection.on('close', () => {
          this.onConnectionClosed('ethernet');
        });
      });

    } catch (error) {
      console.error('Failed to connect to CNC controller via ethernet:', error);
      this.handleConnectionError(error);
      throw error;
    }
  }

  async connect(portPath, baudRate = 115200) {
    if (this.isConnected) {
      log('Already connected to CNC controller');
      return true;
    }

    try {
      this.connectionType = 'usb';
      this.emitConnectionStatus('connecting', false);

      this.connection = new SerialPort({
        path: portPath,
        baudRate: baudRate,
        autoOpen: false
      });

      this.setupDataParser();
      this.connection.pipe(this.parser);

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (this.connection && !this.connection.destroyed) {
            this.connection.removeAllListeners();
            if (this.connection.isOpen) {
              this.connection.close();
            } else {
              try {
                this.connection.destroy();
              } catch (err) {
                log('Error destroying USB connection on timeout:', err.message);
              }
            }
          }
          this.isConnecting = false;
          this.connectionAttempt = null;
          reject(new Error('USB connection timeout'));
        }, 1000); // 1 second timeout for USB

        this.connection.on('open', () => {
          clearTimeout(timeoutId);
          this.isConnecting = false;
          this.connectionAttempt = null;
          this.onConnectionEstablished('usb');
          resolve(true);
        });

        this.connection.on('error', (error) => {
          clearTimeout(timeoutId);
          console.error('CNC controller connection error:', error);
          this.isConnecting = false;
          this.connectionAttempt = null;
          this.handleConnectionError(error);
          reject(error);
        });

        this.connection.on('close', () => {
          this.onConnectionClosed('usb');
        });

        // Start the connection attempt
        this.connection.open((err) => {
          if (err) {
            clearTimeout(timeoutId);
            this.isConnecting = false;
            this.connectionAttempt = null;
            reject(err);
          }
        });
      });

    } catch (error) {
      console.error('Failed to connect to CNC controller:', error);
      this.isConnecting = false;
      this.connectionAttempt = null;
      this.handleConnectionError(error);
      throw error;
    }
  }

  cancelConnection() {
    if (this.isConnecting || this.connectionAttempt) {
      log('Cancelling ongoing connection attempt...');

      // Force cleanup of any existing connection objects
      if (this.connection) {
        try {
          if (this.connectionType === 'ethernet') {
            if (!this.connection.destroyed) {
              this.connection.removeAllListeners();
              this.connection.destroy();
            }
          } else if (this.connectionType === 'usb') {
            if (this.connection.isOpen) {
              this.connection.removeAllListeners();
              this.connection.close((err) => {
                if (err) log('Error closing USB port during cancellation:', err.message);
              });
            } else if (!this.connection.destroyed) {
              // Handle case where port is opening but not yet open
              this.connection.removeAllListeners();
              try {
                this.connection.destroy();
              } catch (err) {
                log('Error destroying USB connection during cancellation:', err.message);
              }
            }
          }
        } catch (error) {
          log('Error during connection cleanup:', error.message);
        }

        this.connection = null;
      }

      // Clear parser
      if (this.parser) {
        this.parser.removeAllListeners();
        this.parser = null;
      }

      this.connectionAttempt = null;
      this.isConnecting = false;
      this.connectionStatus = 'cancelled';
      this.emitConnectionStatus('cancelled', false);
    }
  }

  disconnect() {
    this.cancelConnection();
    this.stopPolling();
    this.commandQueue.flush('disconnect');

    // Additional cleanup for any remaining connections
    if (this.connection) {
      try {
        this.connection.removeAllListeners();
        if (this.connectionType === 'ethernet') {
          if (!this.connection.destroyed) {
            this.connection.destroy();
          }
        } else if (this.connectionType === 'usb') {
          if (this.connection.isOpen) {
            this.connection.close();
          } else if (!this.connection.destroyed) {
            try {
              this.connection.destroy();
            } catch (err) {
              log('Error destroying USB connection during disconnect:', err.message);
            }
          }
        }
      } catch (error) {
        log('Error during disconnect cleanup:', error.message);
      }
      this.connection = null;
    }

    // Clear parser
    if (this.parser) {
      this.parser.removeAllListeners();
      this.parser = null;
    }

    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.connectionType = null;
    this.connectionAttempt = null;
    this.isConnecting = false;
    this.emitConnectionStatus('disconnected', false);
  }

  writeToConnection(commandToSend, { rawCommand, isRealTime } = {}) {
    if (!this.connection || !this.isConnected) {
      return Promise.reject(new Error('Connection is not available'));
    }

    if (this.connectionType === 'ethernet' && this.connection.destroyed) {
      return Promise.reject(new Error('Ethernet socket is disconnected'));
    }

    if (this.connectionType === 'usb' && !this.connection.isOpen) {
      return Promise.reject(new Error('Serial port is not open'));
    }

    return new Promise((resolve, reject) => {
      this.connection.write(commandToSend, (error) => {
        if (error) {
          console.error('Error sending command:', error);
          reject(error);
          return;
        }

        this.logCommandSent(rawCommand, isRealTime);
        resolve();
      });
    });
  }

  logCommandSent(rawCommand, isRealTime) {
    if (isRealTime && rawCommand !== '?') {
      if (rawCommand.length === 1 && rawCommand.charCodeAt(0) >= 0x80) {
        log('Real-time command sent:', '0x' + rawCommand.charCodeAt(0).toString(16).toUpperCase());
      } else {
        log('Real-time command sent:', rawCommand);
      }
    } else if (rawCommand && rawCommand.toUpperCase() !== '?') {
      log('Command sent:', rawCommand.toUpperCase());
    }
  }

  async sendCommand(command, options = {}) {
    if (!this.isConnected || !this.connection) {
      throw new Error('CNC controller is not connected');
    }

    // Clean up command - remove semicolon comments
    const cleanCommand = command.split(';')[0].trim();
    if (!cleanCommand) {
      throw new Error('Command is empty');
    }

    const { meta = null, commandId = null, displayCommand = null } = options || {};
    const normalizedMeta = meta && typeof meta === 'object' ? { ...meta } : null;
    const resolvedCommandId = commandId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Check if this is a real-time command (GRBL real-time commands or hex bytes >= 0x80)
    const realTimeCommands = ['!', '~', '?', '\x18'];
    const isRealTimeCommand = cleanCommand.length === 1 &&
      (realTimeCommands.includes(cleanCommand) || cleanCommand.charCodeAt(0) >= 0x80);

    let commandToSend;
    if (isRealTimeCommand) {
      // Real-time commands are sent as-is without newline or uppercase conversion
      commandToSend = cleanCommand;
    } else {
      // Regular G-code commands get uppercase conversion with newline
      commandToSend = cleanCommand.toUpperCase() + '\n';
    }

    if (isRealTimeCommand) {
      if (cleanCommand === '?') {
        await this.writeToConnection(commandToSend, {
          rawCommand: cleanCommand,
          isRealTime: true
        });
        return { id: resolvedCommandId, command: cleanCommand, status: 'success' };
      }

      const display = displayCommand || cleanCommand;
      const pendingPayload = {
        id: resolvedCommandId,
        command: cleanCommand,
        displayCommand: display,
        meta: normalizedMeta,
        status: 'pending',
        timestamp: new Date().toISOString(),
        realTime: true
      };

      this.emit('command-queued', pendingPayload);

      try {
        await this.writeToConnection(commandToSend, {
          rawCommand: cleanCommand,
          isRealTime: true
        });

        if (cleanCommand === '\x18') {
          this.commandQueue.flush('');
          // Emit a specific event for soft reset
          this.emit('soft-reset');
        }

        const ackPayload = {
          ...pendingPayload,
          status: 'success',
          timestamp: new Date().toISOString()
        };
        this.emit('command-ack', ackPayload);
        return ackPayload;
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const ackPayload = {
          ...pendingPayload,
          status: 'error',
          error: normalizedError,
          timestamp: new Date().toISOString()
        };
        this.emit('command-ack', ackPayload);
        throw normalizedError;
      }
    }

    const normalizedCommand = cleanCommand.toUpperCase();
    const display = displayCommand || normalizedCommand;

    const timeoutMs = normalizedMeta?.jobControl ? 0 : undefined;

    return this.commandQueue.enqueue({
      rawCommand: normalizedCommand,
      commandToWrite: commandToSend,
      meta: normalizedMeta,
      displayCommand: display,
      commandId: resolvedCommandId,
      timeoutMs
    });
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      status: this.connectionStatus,
      retryAttempts: this.retryAttempts
    };
  }

  getLastStatus() {
    return this.lastStatus;
  }

  getRawData() {
    return this.rawData;
  }


  handleConnectionError(error) {
    this.isConnected = false;
    this.connectionStatus = 'error';
    this.commandQueue.flush('connection-error', error);

    // Special handling for USB port locking issues
    if (error.message && error.message.includes('Resource temporarily unavailable')) {
      log('USB port locked, will retry after delay...');
      this.connectionStatus = 'port-locked';
    }

    this.emitConnectionStatus(this.connectionStatus, false);
  }
}
