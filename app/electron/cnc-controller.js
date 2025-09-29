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
    this.port = null;
    this.socket = null;
    this.parser = null;
    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.connectionType = null;
    this.retryInterval = null;
    this.retryAttempts = 0;
    this.maxRetryAttempts = 5;
    this.retryDelay = 2000;
    this.statusPollInterval = null;
    this.lastStatus = {};
    this.rawData = '';
    this.commandQueue = new CommandQueue({
      log,
      sendCommand: async (entry) => {
        await this.writeToPort(entry.commandToWrite ?? `${entry.rawCommand}\n`, {
          rawCommand: entry.rawCommand,
          isRealTime: false
        });
      }
    });

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

  parseStatusReport(data) {
    const parts = data.substring(1, data.length - 1).split('|');
    // Start with previous status to preserve all fields
    const newStatus = { ...this.lastStatus };

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

  startPolling() {
    if (this.statusPollInterval) return;
    this.statusPollInterval = setInterval(() => {
      this.sendCommand('?');
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

  async autoConnect() {
    try {
      log('Attempting auto-connect to CNC controller...');

      const connectionType = getSetting('connectionType', DEFAULT_SETTINGS.connectionType);

      if (connectionType === 'ethernet') {
        const ip = getSetting('ip', DEFAULT_SETTINGS.ip);
        const port = getSetting('port', DEFAULT_SETTINGS.port);
        log(`Auto-connecting via ethernet to: ${ip}:${port}`);
        await this.connectEthernet(ip, port);
        return true;
      } else {
        // USB connection (existing logic)
        const ports = await this.listAvailablePorts();

        if (ports.length === 0) {
          log('No suitable USB ports found for CNC connection');
          return false;
        }

        // Find the first USB port that looks like a CNC controller
        const suitablePort = ports.find(port => {
          const path = port.path.toLowerCase();
          // Look for common USB serial patterns, avoid virtual ports
          return (path.includes('usb') || path.includes('tty.usbserial') || path.includes('ttyusb')) &&
                 !path.includes('virtual');
        }) || ports[0]; // Fallback to first available port

        const baudRate = getSetting('baudRate', DEFAULT_SETTINGS.baudRate);
        log(`Auto-connecting to: ${suitablePort.path} (${suitablePort.manufacturer || 'Unknown'}) at ${baudRate} baud`);
        await this.connect(suitablePort.path, baudRate);
        return true;
      }
    } catch (error) {
      console.error('Auto-connect failed:', error);
      return false;
    }
  }

  async connectEthernet(ip, port) {
    if (this.isConnected) {
      log('Already connected to CNC controller');
      return;
    }

    try {
      log(`Connecting to CNC controller via ethernet at ${ip}:${port}`);

      this.connectionStatus = 'connecting';
      this.connectionType = 'ethernet';
      this.emit('status', {
        status: 'connecting',
        isConnected: false,
        retryAttempts: this.retryAttempts
      });

      this.socket = new net.Socket();
      this.parser = new ReadlineParser({ delimiter: '\n' });
      this.socket.pipe(this.parser);

      return new Promise((resolve, reject) => {
        this.socket.connect(port, ip, () => {
          log('CNC controller connected via ethernet');
          this.isConnected = true;
          this.connectionStatus = 'connected';
          this.retryAttempts = 0;

          this.emit('status', {
            status: 'connected',
            isConnected: true,
            retryAttempts: 0
          });

          // Start status polling
          this.startPolling();
          resolve();
        });

        this.socket.on('error', (error) => {
          console.error('CNC controller ethernet connection error:', error);
          this.handleConnectionError(error);
          reject(error);
        });

        this.socket.on('close', () => {
          log('CNC controller disconnected (ethernet)');
          this.isConnected = false;
          this.connectionStatus = 'disconnected';

          this.commandQueue.flush('socket-close');

          this.emit('status', {
            status: 'disconnected',
            isConnected: false,
            retryAttempts: this.retryAttempts
          });
        });

        this.parser.on('data', (data) => {
          const trimmedData = data.trim();
          if (trimmedData.startsWith('<') && trimmedData.endsWith('>')) {
            this.rawData = trimmedData;
            this.parseStatusReport(trimmedData);
          } else if (trimmedData.toLowerCase().startsWith('error:')) {
            const code = parseInt(trimmedData.split(':')[1]);
            const message = grblErrors[code] || 'Unknown error';
            this.commandQueue.handleError({ code, message });
            this.emit('cnc-error', { code, message });

            // Send newline to clear firmware parser state after error
            try {
              this.socket.write('\n');
              log('Sent newline to reset firmware parser state after error');
            } catch (error) {
              console.error('Failed to send recovery newline:', error);
            }
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
      return;
    }

    try {
      log(`Connecting to CNC controller on ${portPath} at ${baudRate} baud`);

      this.connectionStatus = 'connecting';
      this.connectionType = 'usb';
      this.emit('status', {
        status: 'connecting',
        isConnected: false,
        retryAttempts: this.retryAttempts
      });

      this.port = new SerialPort({
        path: portPath,
        baudRate: baudRate,
        autoOpen: false
      });

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));

      this.port.on('open', () => {
        log('CNC controller connected');
        this.isConnected = true;
        this.connectionStatus = 'connected';
        this.retryAttempts = 0;

        this.emit('status', {
          status: 'connected',
          isConnected: true,
          retryAttempts: 0
        });

        // Start status polling
        this.startPolling();
      });

      this.port.on('error', (error) => {
        console.error('CNC controller connection error:', error);
        this.handleConnectionError(error);
      });

      this.port.on('close', () => {
        log('CNC controller disconnected');
        this.isConnected = false;
        this.connectionStatus = 'disconnected';

        this.commandQueue.flush('port-close');

        this.emit('status', {
          status: 'disconnected',
          isConnected: false,
          retryAttempts: this.retryAttempts
        });
      });

      this.parser.on('data', (data) => {
        const trimmedData = data.trim();
        if (trimmedData.startsWith('<') && trimmedData.endsWith('>')) {
          this.rawData = trimmedData;
          this.parseStatusReport(trimmedData);
        } else if (trimmedData.toLowerCase().startsWith('error:')) {
          const code = parseInt(trimmedData.split(':')[1]);
          const message = grblErrors[code] || 'Unknown error';
          this.commandQueue.handleError({ code, message });
          this.emit('cnc-error', { code, message });

          // Send newline to clear firmware parser state after error
          try {
            this.port.write('\n');
            log('Sent newline to reset firmware parser state after error');
          } catch (error) {
            console.error('Failed to send recovery newline:', error);
          }
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
      });

      await this.port.open();

    } catch (error) {
      console.error('Failed to connect to CNC controller:', error);
      this.handleConnectionError(error);
      throw error;
    }
  }

  disconnect() {
    this.stopPolling();

    this.commandQueue.flush('disconnect');

    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }

    if (this.connectionType === 'ethernet') {
      if (this.socket && !this.socket.destroyed) {
        this.socket.destroy();
      }
    } else if (this.connectionType === 'usb') {
      if (this.port && this.port.isOpen) {
        this.port.close();
      }
    }

    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.connectionType = null;
    this.retryAttempts = 0;

    this.emit('status', {
      status: 'disconnected',
      isConnected: false,
      retryAttempts: 0
    });

    // Log message removed - it will be logged by the 'close' event handler
  }

  writeToPort(commandToSend, { rawCommand, isRealTime } = {}) {
    if (this.connectionType === 'ethernet') {
      if (!this.socket || this.socket.destroyed) {
        return Promise.reject(new Error('Ethernet socket is not connected'));
      }

      return new Promise((resolve, reject) => {
        this.socket.write(commandToSend, (error) => {
          if (error) {
            console.error('Error sending command via ethernet:', error);
            reject(error);
            return;
          }

          if (isRealTime) {
            if (rawCommand !== '?') {
              if (rawCommand.length === 1 && rawCommand.charCodeAt(0) >= 0x80) {
                log('Real-time command sent:', '0x' + rawCommand.charCodeAt(0).toString(16).toUpperCase());
              } else {
                log('Real-time command sent:', rawCommand);
              }
            }
          } else if (rawCommand && rawCommand.toUpperCase() !== '?') {
            log('Command sent:', rawCommand.toUpperCase());
          }

          resolve();
        });
      });
    } else {
      // USB/Serial connection
      if (!this.port || !this.port.isOpen) {
        return Promise.reject(new Error('Serial port is not open'));
      }

      return new Promise((resolve, reject) => {
        this.port.write(commandToSend, (error) => {
          if (error) {
            console.error('Error sending command:', error);
            reject(error);
            return;
          }

          if (isRealTime) {
            if (rawCommand !== '?') {
              if (rawCommand.length === 1 && rawCommand.charCodeAt(0) >= 0x80) {
                log('Real-time command sent:', '0x' + rawCommand.charCodeAt(0).toString(16).toUpperCase());
              } else {
                log('Real-time command sent:', rawCommand);
              }
            }
          } else if (rawCommand && rawCommand.toUpperCase() !== '?') {
            log('Command sent:', rawCommand.toUpperCase());
          }

          resolve();
        });
      });
    }
  }

  async sendCommand(command, options = {}) {
    if (!this.isConnected) {
      throw new Error('CNC controller is not connected');
    }

    if (this.connectionType === 'ethernet' && (!this.socket || this.socket.destroyed)) {
      throw new Error('Ethernet connection is not available');
    }

    if (this.connectionType === 'usb' && (!this.port || !this.port.isOpen)) {
      throw new Error('Serial port is not open');
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
        await this.writeToPort(commandToSend, {
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
        await this.writeToPort(commandToSend, {
          rawCommand: cleanCommand,
          isRealTime: true
        });

        if (cleanCommand === '\x18') {
          this.commandQueue.flush('');
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

    this.emit('status', {
      status: 'error',
      isConnected: false,
      retryAttempts: this.retryAttempts,
      error: error.message
    });

    // Auto-retry logic could be added here if needed
  }
}
