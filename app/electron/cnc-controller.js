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
        return await this.connectEthernet(ip, port);
      } else {
        const ports = await this.listAvailablePorts();
        if (ports.length === 0) {
          log('No suitable USB ports found for CNC connection');
          return false;
        }

        const suitablePort = this.findSuitableUSBPort(ports);
        const baudRate = getSetting('baudRate', DEFAULT_SETTINGS.baudRate);
        log(`Auto-connecting to: ${suitablePort.path} (${suitablePort.manufacturer || 'Unknown'}) at ${baudRate} baud`);
        return await this.connect(suitablePort.path, baudRate);
      }
    } catch (error) {
      console.error('Auto-connect failed:', error);
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
      log(`Connecting to CNC controller via ethernet at ${ip}:${port}`);
      this.connectionType = 'ethernet';
      this.emitConnectionStatus('connecting', false);

      this.connection = new net.Socket();
      this.setupDataParser();
      this.connection.pipe(this.parser);

      return new Promise((resolve, reject) => {
        this.connection.connect(port, ip, () => {
          this.onConnectionEstablished('ethernet');
          resolve(true);
        });

        this.connection.on('error', (error) => {
          console.error('CNC controller ethernet connection error:', error);
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
      log(`Connecting to CNC controller on ${portPath} at ${baudRate} baud`);
      this.connectionType = 'usb';
      this.emitConnectionStatus('connecting', false);

      this.connection = new SerialPort({
        path: portPath,
        baudRate: baudRate,
        autoOpen: false
      });

      this.setupDataParser();
      this.connection.pipe(this.parser);

      this.connection.on('open', () => {
        this.onConnectionEstablished('usb');
      });

      this.connection.on('error', (error) => {
        console.error('CNC controller connection error:', error);
        this.handleConnectionError(error);
      });

      this.connection.on('close', () => {
        this.onConnectionClosed('usb');
      });

      await this.connection.open();
      return true;

    } catch (error) {
      console.error('Failed to connect to CNC controller:', error);
      this.handleConnectionError(error);
      throw error;
    }
  }

  disconnect() {
    this.stopPolling();
    this.commandQueue.flush('disconnect');

    if (this.connection) {
      if (this.connectionType === 'ethernet') {
        !this.connection.destroyed && this.connection.destroy();
      } else if (this.connectionType === 'usb') {
        this.connection.isOpen && this.connection.close();
      }
    }

    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.connectionType = null;
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
    this.emitConnectionStatus('error', false);
  }
}
