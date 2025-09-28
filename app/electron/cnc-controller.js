import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { EventEmitter } from 'events';
import { grblErrors } from './grbl-errors.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export class CNCController extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.parser = null;
    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.retryInterval = null;
    this.retryAttempts = 0;
    this.maxRetryAttempts = 5;
    this.retryDelay = 2000;
    this.statusPollInterval = null;
    this.lastStatus = {};
    this.rawData = '';
    this.commandQueue = [];
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

      log(`Auto-connecting to: ${suitablePort.path} (${suitablePort.manufacturer || 'Unknown'})`);
      await this.connect(suitablePort.path, 115200);
      return true;
    } catch (error) {
      console.error('Auto-connect failed:', error);
      return false;
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
          const command = this.commandQueue.shift();
          if (command) {
            command.reject({ code, message });
          }
          this.emit('cnc-error', { code, message });

          // Send newline to clear firmware parser state after error
          try {
            this.port.write('\n');
            log('Sent newline to reset firmware parser state after error');
          } catch (error) {
            console.error('Failed to send recovery newline:', error);
          }
        } else if (trimmedData.toLowerCase() === 'ok' || trimmedData.toLowerCase().endsWith(':ok')) {
          log('CNC controller responded:', trimmedData);
          const command = this.commandQueue.shift();
          if (command) {
            command.resolve();
          }
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

    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }

    if (this.port && this.port.isOpen) {
      this.port.close();
    }

    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.retryAttempts = 0;

    this.emit('status', {
      status: 'disconnected',
      isConnected: false,
      retryAttempts: 0
    });

    // Log message removed - it will be logged by the 'close' event handler
  }

  async sendCommand(command) {
    if (!this.isConnected || !this.port || !this.port.isOpen) {
      throw new Error('CNC controller is not connected');
    }

    // Clean up command - remove semicolon comments
    const cleanCommand = command.split(';')[0].trim();

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

    return new Promise((resolve, reject) => {
      if (!isRealTimeCommand) {
        this.commandQueue.push({ resolve, reject });
      }


      this.port.write(commandToSend, (error) => {
        if (error) {
          console.error('Error sending command:', error);
          if (!isRealTimeCommand) {
            this.commandQueue.shift(); // Remove the command from the queue
          }
          reject(error);
        } else {
          if (isRealTimeCommand) {
            // Don't log '?' commands to reduce noise from polling
            if (cleanCommand !== '?') {
              if (cleanCommand.charCodeAt(0) >= 0x80) {
                log('Real-time command sent:', '0x' + cleanCommand.charCodeAt(0).toString(16).toUpperCase());
              } else {
                log('Real-time command sent:', cleanCommand);
              }
            }
            resolve(); // Real-time commands resolve immediately
          } else if (cleanCommand.toUpperCase() !== '?') {
            log('Command sent:', cleanCommand.toUpperCase());
          }
        }
      });
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

    this.emit('status', {
      status: 'error',
      isConnected: false,
      retryAttempts: this.retryAttempts,
      error: error.message
    });

    // Auto-retry logic could be added here if needed
  }
}