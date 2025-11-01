import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { EventEmitter } from 'events';
import net from 'net';
import PQueue from 'p-queue';
import { grblErrors } from './grbl-errors.js';
import { getSetting, DEFAULT_SETTINGS } from '../../core/settings-manager.js';
import { JogWatchdog, REALTIME_JOG_CANCEL } from './jog-manager.js';
import { pluginEventBus } from '../../core/plugin-event-bus.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

const MAX_QUEUE_SIZE = 200;

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
    this.isVerifyingConnection = false; // Track if we're waiting for initial status to confirm controller
    this.hasReceivedFirstStatus = false; // Track if we've parsed the initial status report
    this.greetingMessage = null; // Store the initial connection info message

    this.commandQueue = new PQueue({ concurrency: 1 });
    this.activeCommand = null;
    this.pendingCommands = new Map();

    // Dead-man switch for continuous jogging
    this.jogWatchdog = new JogWatchdog({
      timeoutMs: 500,
      onTimeout: (reason) => this.sendEmergencyJogCancel(reason)
    });

    this.lastStatusLogTs = 0;
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
    if (trimmedData.endsWith('>')) {
      if (this.isVerifyingConnection && !this.hasReceivedFirstStatus) {
        log('Received initial status report, marking controller as ready:', trimmedData);
        this.hasReceivedFirstStatus = true;
        this.isVerifyingConnection = false;
        this.isConnected = true;
        this.connectionStatus = 'connected';
        this.emitConnectionStatus('connected', true);

        // Request initial G-code modes to get workspace and tool number
        this.sendCommand('$G', { meta: { sourceId: 'system' } }).catch(() => {
          // Ignore errors during initial setup
        });

        // Request tool length offset status
        this.sendCommand('$#=_tool_offset', { meta: { sourceId: 'system' } }).catch(() => {
          // Ignore errors during initial setup
        });

        // Publish the first status report so clients receive an immediate connection indicator
        this.emit('data', trimmedData, null);
      }

      this.rawData = trimmedData;
      this.parseStatusReport(trimmedData);
    } else if (trimmedData.startsWith('[GC:') && trimmedData.endsWith(']')) {
      this.parseGCodeModes(trimmedData);
      const sourceId = this.activeCommand?.meta?.sourceId || null;
      this.emit('data', trimmedData, sourceId);
    } else if (trimmedData.startsWith('[PARAM:') && trimmedData.endsWith(']')) {
      this.parseParam(trimmedData);
      const sourceId = this.activeCommand?.meta?.sourceId || null;
      this.emit('data', trimmedData, sourceId);
    } else if (trimmedData.toLowerCase().startsWith('error:')) {
      const code = parseInt(trimmedData.split(':')[1]);
      const message = grblErrors[code] || 'Unknown error';
      this.handleCommandError({ code, message });
      this.emit('cnc-error', { code, message });
      this.sendRecoveryNewline();
    } else if (trimmedData.toLowerCase().startsWith('alarm')) {
      this.handleCommandError({ code: 'ALARM', message: trimmedData });
      this.emit('cnc-error', { code: 'ALARM', message: trimmedData });
    } else if (trimmedData.toLowerCase() === 'ok' || trimmedData.toLowerCase().endsWith(':ok')) {
      log('CNC controller responded:', trimmedData);
      this.handleCommandOk();
    } else {
      log('CNC data:', trimmedData);

      // Capture greeting message if it starts with "GrblHal" (case-insensitive)
      if (trimmedData.toLowerCase().startsWith('grblhal')) {
        this.greetingMessage = trimmedData;
      }

      // Detect tool change completion message from plugins (e.g., RapidChange ATC)
      if (trimmedData.includes('[MSG:TOOL CHANGE COMPLETE')) {
        this.emit('tool-change-complete', trimmedData);
        return; // Skip broadcasting this message to terminal
      }

      const sourceId = this.activeCommand?.meta?.sourceId || null;
      this.emit('data', trimmedData, sourceId);
    }
  }

  async handleCommandOk() {
    if (!this.activeCommand) {
      log('Received OK with no active command');
      return;
    }

    const cmd = this.activeCommand;
    this.activeCommand = null;

    if (cmd.timeoutHandle) {
      clearTimeout(cmd.timeoutHandle);
    }

    const payload = {
      id: cmd.id,
      command: cmd.rawCommand,
      displayCommand: cmd.displayCommand,
      meta: cmd.meta,
      status: 'success',
      timestamp: new Date().toISOString()
    };

    const commandContext = {
      sourceId: cmd.meta?.sourceId || null,
      commandId: cmd.id,
      displayCommand: cmd.displayCommand,
      meta: cmd.meta,
      response: 'ok'
    };

    await pluginEventBus.emitAsync('onAfterCommand', cmd.rawCommand, commandContext, payload);

    cmd.resolve(payload);
    this.emit('command-ack', payload);

    if (cmd.rawCommand && cmd.rawCommand.toLowerCase() === '$x') {
      this.emit('unlock');
    }
  }

  async handleCommandError(errorPayload) {
    if (!this.activeCommand) {
      log('Received error with no active command', errorPayload);
      return;
    }

    const cmd = this.activeCommand;
    this.activeCommand = null;

    if (cmd.timeoutHandle) {
      clearTimeout(cmd.timeoutHandle);
    }

    const error = errorPayload instanceof Error ? errorPayload : new Error(errorPayload?.message || 'CNC command failed');
    if (errorPayload && typeof errorPayload === 'object') {
      Object.assign(error, errorPayload);
    }

    const payload = {
      id: cmd.id,
      command: cmd.rawCommand,
      displayCommand: cmd.displayCommand,
      meta: cmd.meta,
      status: 'error',
      error,
      timestamp: new Date().toISOString()
    };

    const commandContext = {
      sourceId: cmd.meta?.sourceId || null,
      commandId: cmd.id,
      displayCommand: cmd.displayCommand,
      meta: cmd.meta,
      response: 'error',
      error
    };

    await pluginEventBus.emitAsync('onAfterCommand', cmd.rawCommand, commandContext, payload);

    cmd.reject(error);
    this.emit('command-ack', payload);
  }

  sendRecoveryNewline() {
    try {
      this.writeToConnection('\n');
      log('Sent newline to reset firmware parser state after error');
    } catch (error) {
      log('Failed to send recovery newline:', error);
    }
  }

  parseStatusReport(data) {
    const now = Date.now();
    if (now - (this.lastStatusLogTs || 0) >= 1000) {
      //log('[status-report raw]', data);
      this.lastStatusLogTs = now;
    }

    const parts = data.substring(1, data.length - 1).split('|');
    // Start with previous status to preserve all fields, but ensure it's a clean copy
    let newStatus;
    try {
      newStatus = JSON.parse(JSON.stringify(this.lastStatus || {}));
    } catch (error) {
      console.warn('Error cloning lastStatus, starting fresh:', error.message);
      newStatus = {};
    }

    // Default probe state resets each report unless explicitly set
    newStatus.probeActive = false;
    newStatus.Pn = '';

    // Update machine state (always present) - extract state name before colon
    newStatus.status = parts[0].split(':')[0];

    // Check if A: field is present in the status report
    let hasAccessoryField = false;

    // Parse and update only the fields present in this report
    parts.slice(1).forEach(part => {
      const [key, value] = part.split(':');
      if (key === 'Ov' && value) {
        const [feedrate, rapid, spindle] = value.split(',').map(Number);
        newStatus.feedrateOverride = feedrate;
        newStatus.rapidOverride = rapid;
        newStatus.spindleOverride = spindle;
      } else if (key === 'T' && value) {
        // Tool number
        newStatus.tool = parseInt(value);
      } else if (key === 'H' && value) {
        // Homed status - can be '0', '1', or '1,7' (multiple axes homed)
        // Consider machine homed if value contains '1' (any axis homed)
        newStatus.homed = value.includes('1');
      } else if (key === 'FS') {
        const [feed, spindle, commanded] = value ? value.split(',').map(Number) : [];
        if (Number.isFinite(feed)) {
          newStatus.feedRate = feed;
        }
        if (Number.isFinite(spindle)) {
          newStatus.spindleRpm = spindle;
        }
        if (Number.isFinite(commanded)) {
          newStatus.feedRateCommanded = commanded;
        }
      } else if (key === 'A') {
        // Accessory state: S=Spindle, F=Flood, M=Mist
        hasAccessoryField = true;
        if (value) {
          newStatus.spindleActive = value.includes('S') || value.includes('C');
          newStatus.floodCoolant = value.includes('F');
          newStatus.mistCoolant = value.includes('M');
        } else {
          // A: field present but empty means all accessories are off
          newStatus.spindleActive = false;
          newStatus.floodCoolant = false;
          newStatus.mistCoolant = false;
        }
      } else if (key === 'Pn') {
        // Pin state: P=Probe, X/Y/Z=Limit switches, etc.
        const pins = value || '';
        newStatus.probeActive = pins.includes('P');
        newStatus.Pn = pins;
      } else if (key === 'WCS') {
        // Workspace coordinate system (G54, G55, etc.)
        newStatus.WCS = value;
        newStatus.workspace = value;
      } else if (key && value) {
        newStatus[key] = value;
      }
    });

    // Only update accessory states if A: field was present in this report
    // This prevents resetting states when Grbl doesn't include the A: field
    if (!hasAccessoryField && this.lastStatus) {
      // Preserve previous accessory states
      newStatus.spindleActive = this.lastStatus.spindleActive || false;
      newStatus.floodCoolant = this.lastStatus.floodCoolant || false;
      newStatus.mistCoolant = this.lastStatus.mistCoolant || false;
    } else if (!hasAccessoryField) {
      // First status report, default to off
      newStatus.spindleActive = false;
      newStatus.floodCoolant = false;
      newStatus.mistCoolant = false;
    }

    // Check if anything actually changed by doing a deep comparison
    let hasChanges = false;
    delete newStatus.FS;

    const relevantFields = ['status', 'MPos', 'WCO', 'feedRate', 'feedRateCommanded', 'spindleRpm', 'feedrateOverride', 'rapidOverride', 'spindleOverride', 'tool', 'toolLengthSet', 'homed', 'Pn', 'Bf', 'Ln', 'spindleActive', 'floodCoolant', 'mistCoolant', 'probeActive', 'WCS', 'workspace'];

    for (const field of relevantFields) {
      if (newStatus[field] !== this.lastStatus[field]) {
        hasChanges = true;
        break;
      }
    }

    // Only emit if there are actual changes
    if (hasChanges) {
      // Log specific property changes for debugging
      const debugFields = ['WCS', 'workspace'];
      for (const field of debugFields) {
        if (newStatus[field] !== this.lastStatus[field]) {
          log(`[DEBUG] ${field} changed:`, JSON.stringify({
            old: this.lastStatus[field],
            new: newStatus[field]
          }));
        }
      }

      this.lastStatus = newStatus;
      this.emit('status-report', newStatus);
    }
  }

  parseGCodeModes(data) {
    // Example: [GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]
    const content = data.substring(4, data.length - 1); // Remove [GC: and ]
    const modes = content.split(' ');

    let hasChanges = false;

    // Find tool number (T0, T1, etc.)
    const toolMode = modes.find(mode => /^T\d+$/.test(mode));

    if (toolMode) {
      const toolNumber = parseInt(toolMode.substring(1));
      if (this.lastStatus.tool !== toolNumber) {
        log('Active tool detected:', toolNumber);
        this.lastStatus.tool = toolNumber;
        hasChanges = true;
      }
    }

    // Emit updated status if anything changed
    if (hasChanges) {
      this.emit('status-report', { ...this.lastStatus });
    }
  }

  parseParam(data) {
    // Example: [PARAM:_TOOL_OFFSET=1]
    const content = data.substring(7, data.length - 1); // Remove [PARAM: and ]

    if (content.startsWith('_TOOL_OFFSET=')) {
      const value = content.substring(13); // Remove _TOOL_OFFSET=
      const toolLengthSet = value === '1';

      if (this.lastStatus.toolLengthSet !== toolLengthSet) {
        log('Tool length set status:', toolLengthSet);
        this.lastStatus.toolLengthSet = toolLengthSet;
        this.emit('status-report', { ...this.lastStatus });
      }
    }
  }

  startPolling() {
    if (this.statusPollInterval) return;
    this.statusPollInterval = setInterval(() => {
      // Send status requests while connected or verifying controller readiness
      if (this.connection && (this.isConnected || this.isVerifyingConnection)) {
        try {
          this.sendCommand('?', { meta: { sourceId: 'system' } });
        } catch (error) {
          console.warn('Status polling failed, stopping polling:', error.message);
          this.stopPolling();
        }
      }
    }, 50);
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
      log('Error listing serial ports:', error);
      return [];
    }
  }

  async connectWithSettings(settings) {
    try {

      const connection = settings?.connection ?? {};
      const connectionTypeRaw = connection?.type;
      const connectionType = typeof connectionTypeRaw === 'string' ? connectionTypeRaw.toLowerCase() : undefined;
      const baudRate = connection?.baudRate;

      // If no connection type, don't attempt connection
      if (!connectionType) {
        log('No connection type specified...');
        return 'no-settings';
      }

      this.isConnecting = true;

      if (connectionType === 'ethernet') {
        const { ip, port } = connection;
        if (!ip || !port) {
          log('Incomplete Ethernet settings...');
          this.isConnecting = false;
          return 'no-settings';
        }

        this.connectionAttempt = this.connectEthernet(ip, port);
        return await this.connectionAttempt;
      } else if (connectionType === 'usb') {
        const { usbPort } = connection;
        if (!usbPort || !baudRate) {
          log('Incomplete USB settings...');
          this.isConnecting = false;
          return 'no-settings';
        }

        this.connectionAttempt = this.connect(usbPort, baudRate);
        return await this.connectionAttempt;
      }

      this.isConnecting = false;
      log(`Unsupported connection type: ${connectionType}`);
      return 'no-settings';
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
    log(`CNC controller connection opened via ${type}, verifying controller readiness...`);

    // Don't mark as fully connected yet - wait for the first status report to confirm controller
    this.isVerifyingConnection = true;
    this.hasReceivedFirstStatus = false;
    this.greetingMessage = null;
    this.emitConnectionStatus('verifying', false);

    // Kick off status polling immediately so we can confirm readiness without relying on greetings
    this.startPolling();

    //-- auto send soft-reset to clear all previous states of the controller such as Door trigger.
    log('Sending soft-reset to CNC controller upon connection establishment...');
    this.sendCommand('\x18', { meta: { sourceId: 'system' } }).catch(() => {
      // Ignore errors during the initial status request
    });


  }

  onConnectionClosed(type) {
    log(`CNC controller disconnected (${type})`);
    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.isVerifyingConnection = false;
    this.hasReceivedFirstStatus = false;
    this.greetingMessage = null;

    this.flushQueue(`${type}-close`);
    this.emitConnectionStatus('disconnected', false);
  }

  flushQueue(reason = 'flush', details) {
    if (this.activeCommand) {
      const cmd = this.activeCommand;
      this.activeCommand = null;

      if (cmd.timeoutHandle) {
        clearTimeout(cmd.timeoutHandle);
      }

      const error = new Error(`Command cancelled due to ${reason || 'queue flush'}`);
      error.code = 'COMMAND_FLUSHED';
      error.commandId = cmd.id;
      error.command = cmd.rawCommand;
      error.meta = cmd.meta;
      if (details) {
        error.details = details;
      }

      cmd.reject(error);
      this.emit('command-ack', {
        id: cmd.id,
        command: cmd.rawCommand,
        displayCommand: cmd.displayCommand,
        meta: cmd.meta,
        status: 'flushed',
        reason,
        timestamp: new Date().toISOString()
      });
    }

    this.pendingCommands.forEach((cmd) => {
      if (cmd.timeoutHandle) {
        clearTimeout(cmd.timeoutHandle);
      }

      const error = new Error(`Command cancelled due to ${reason || 'queue flush'}`);
      error.code = 'COMMAND_FLUSHED';
      error.commandId = cmd.id;
      error.command = cmd.rawCommand;
      error.meta = cmd.meta;
      if (details) {
        error.details = details;
      }

      cmd.reject(error);
      this.emit('command-ack', {
        id: cmd.id,
        command: cmd.rawCommand,
        displayCommand: cmd.displayCommand,
        meta: cmd.meta,
        status: 'flushed',
        reason,
        timestamp: new Date().toISOString()
      });
    });

    this.pendingCommands.clear();
    this.commandQueue.clear();
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
        this.connection.connect(port, ip, () => {
          this.isConnecting = false;
          this.connectionAttempt = null;
          this.onConnectionEstablished('ethernet');
          resolve(true);
        });

        this.connection.on('error', (error) => {
          log('CNC controller ethernet connection error:', error);
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
      log('Failed to connect to CNC controller via ethernet:', error);
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
        this.connection.on('open', () => {
          this.isConnecting = false;
          this.connectionAttempt = null;
          this.onConnectionEstablished('usb');
          resolve(true);
        });

        this.connection.on('error', (error) => {
          log('CNC controller connection error:', error);
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
            this.isConnecting = false;
            this.connectionAttempt = null;
            reject(err);
          }
        });
      });

    } catch (error) {
      log('Failed to connect to CNC controller:', error);
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
      this.isVerifyingConnection = false;
      this.hasReceivedFirstStatus = false;
      this.greetingMessage = null;
      this.emitConnectionStatus('cancelled', false);
    }
  }

  disconnect() {
    this.cancelConnection();
    this.stopPolling();
    this.flushQueue('disconnect');

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
    this.isVerifyingConnection = false;
    this.hasReceivedFirstStatus = false;
    this.greetingMessage = null;
    this.emitConnectionStatus('disconnected', false);
  }

  async sendEmergencyJogCancel(reason) {
    try {
      await this.writeToConnection(REALTIME_JOG_CANCEL, {
        rawCommand: REALTIME_JOG_CANCEL,
        isRealTime: true
      });

      log('Emergency jog cancel sent:', reason);

      this.emit('command-ack', {
        id: `emergency-cancel-${Date.now()}`,
        command: REALTIME_JOG_CANCEL,
        displayCommand: `\\x85 (Emergency Jog Cancel - ${reason})`,
        status: 'success',
        timestamp: new Date().toISOString(),
        meta: { emergencyStop: true, reason }
      });
    } catch (error) {
      log('Failed to send emergency jog cancel:', error);
    }

    this.jogWatchdog.clear();
  }

  writeToConnection(commandToSend, { rawCommand, isRealTime } = {}) {
    // Allow writes if connected or still verifying the controller during initial handshake
    if (!this.connection || (!this.isConnected && !this.isVerifyingConnection)) {
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
          log('Error sending command:', error);
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
    // Allow commands if connected or still verifying during the initial handshake
    if ((!this.isConnected && !this.isVerifyingConnection) || !this.connection) {
      throw new Error('CNC controller is not connected');
    }

    const { meta = null, commandId = null, displayCommand = null } = options || {};
    const normalizedMeta = meta && typeof meta === 'object' ? { ...meta } : null;
    const resolvedCommandId = commandId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Handle jog heartbeat - extend watchdog timer
    // Check this BEFORE validating command content, as heartbeats can have empty commands
    const isJogHeartbeat = normalizedMeta?.jogHeartbeat === true;
    if (isJogHeartbeat && this.jogWatchdog.isActive()) {
      this.jogWatchdog.extend();
      // Don't actually queue heartbeat - it's just to keep watchdog alive
      return { status: 'heartbeat-ack', id: resolvedCommandId };
    }

    const cleanCommand = command.trim();
    if (!cleanCommand) {
      throw new Error('Command is empty');
    }

    // Same-tool detection moved to CommandProcessor (upstream)
    // Commands are pre-processed by CommandProcessor → Plugin Manager before reaching controller
    const finalCommand = cleanCommand;

    // Intercept user ? command - return cached status instead of sending to controller
    // But allow polling (sourceId: 'system') to go through
    if (finalCommand === '?' && normalizedMeta?.sourceId !== 'system') {
      const display = displayCommand || finalCommand;
      const pendingPayload = {
        id: resolvedCommandId,
        command: finalCommand,
        displayCommand: display,
        meta: normalizedMeta,
        status: 'pending',
        timestamp: new Date().toISOString(),
        realTime: true
      };

      this.emit('command-queued', pendingPayload);

      // Return cached rawData from polling
      const cachedData = this.rawData || '<Idle>';

      const ackPayload = {
        ...pendingPayload,
        status: 'success',
        data: cachedData,
        timestamp: new Date().toISOString()
      };
      this.emit('command-ack', ackPayload);
      return ackPayload;
    }

    // Check if this is a real-time command (GRBL real-time commands or hex bytes >= 0x80)
    const realTimeCommands = ['!', '~', '?', '\x18'];
    let isRealTimeCommand = finalCommand.length === 1 &&
      (realTimeCommands.includes(finalCommand) || finalCommand.charCodeAt(0) >= 0x80);

    // Treat M7 (mist), M8 (flood), M9 (coolant off) as realtime commands
    // UNLESS they come from job-manager (which sends them as part of G-code programs)
    const isCoolantCommand = /^M[789]$/i.test(finalCommand);
    const isFromJobManager = normalizedMeta?.sourceId === 'job-manager';
    if (isCoolantCommand && !isFromJobManager) {
      isRealTimeCommand = true;
    }

    // Check if this is a jog cancel command (0x85)
    const isJogCancel = finalCommand.length === 1 && finalCommand.charCodeAt(0) === 0x85;
    if (isJogCancel) {
      this.jogWatchdog.clear();
    }

    let commandToSend;
    if (isRealTimeCommand) {
      // Real-time commands are sent as-is without newline or uppercase conversion
      commandToSend = finalCommand;
    } else {
      // Regular G-code commands get uppercase conversion with newline
      // Preserve case for GRBL variable syntax (% assignments and [] expressions)
      const hasVariableSyntax = finalCommand.startsWith('%') || /\[.*\]/.test(finalCommand);
      commandToSend = (hasVariableSyntax ? finalCommand : finalCommand.toUpperCase()) + '\n';
    }

    // Detect continuous jog commands ($J=) and enable dead-man switch watchdog
    // Skip watchdog for step jogs (meta.jogStep = true) since they complete quickly
    const isJogCommand = /^\$J=/i.test(finalCommand);
    const isStepJog = normalizedMeta?.jogStep === true;
    if (isJogCommand && !isStepJog) {
      this.jogWatchdog.start(resolvedCommandId, finalCommand);
      log('Dead-man switch watchdog started for continuous jog:', resolvedCommandId);
    }

    if (isRealTimeCommand) {
      const display = displayCommand || finalCommand;
      const pendingPayload = {
        id: resolvedCommandId,
        command: finalCommand,
        displayCommand: display,
        meta: normalizedMeta,
        status: 'pending',
        timestamp: new Date().toISOString(),
        realTime: true
      };

      this.emit('command-queued', pendingPayload);

      try {
        await this.writeToConnection(commandToSend, {
          rawCommand: finalCommand,
          isRealTime: true
        });

        if (finalCommand === '\x18') {
          this.flushQueue('');
          this.emit('stop');
        } else if (finalCommand === '!') {
          this.emit('pause');
        } else if (finalCommand === '~') {
          this.emit('resume');
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

    // Preserve case for GRBL variable syntax (% assignments and [] expressions)
    const hasVariableSyntax = finalCommand.startsWith('%') || /\[.*\]/.test(finalCommand);
    const normalizedCommand = hasVariableSyntax ? finalCommand : finalCommand.toUpperCase();
    // Use provided displayCommand if available, otherwise use original case for display
    const display = displayCommand || finalCommand;

    // Skip tool change commands when tool.count is 0 or not configured
    const isToolChange = /M6(?!\d)/i.test(normalizedCommand);
    if (isToolChange) {
      const toolSettings = getSetting('tool');
      const toolCount = toolSettings?.count ?? 0;
      const hasToolsConfigured = Number.isFinite(toolCount) && toolCount > 0;

      if (!hasToolsConfigured) {
        log('Discarding tool change command (M6) because tool.count is not configured or zero.');

        const metaForAck = normalizedMeta ? { ...normalizedMeta } : {};
        metaForAck.skippedToolChange = true;
        metaForAck.skipReason = 'tool-count-unconfigured';

        const ackPayload = {
          id: resolvedCommandId,
          command: normalizedCommand,
          displayCommand: display,
          meta: Object.keys(metaForAck).length > 0 ? metaForAck : null,
          status: 'success',
          timestamp: new Date().toISOString()
        };

        this.emit('command-ack', ackPayload);
        return ackPayload;
      }
    }

    while (this.commandQueue.size >= MAX_QUEUE_SIZE) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const commandEntry = {
      id: resolvedCommandId,
      rawCommand: normalizedCommand,
      commandToWrite: commandToSend,
      meta: normalizedMeta,
      displayCommand: display,
      enqueuedAt: Date.now(),
      timeoutHandle: null,
      resolve: null,
      reject: null
    };

    const promise = new Promise((resolve, reject) => {
      commandEntry.resolve = resolve;
      commandEntry.reject = reject;
    });

    this.pendingCommands.set(resolvedCommandId, commandEntry);

    this.emit('command-queued', {
      id: resolvedCommandId,
      command: normalizedCommand,
      displayCommand: display,
      meta: normalizedMeta,
      status: 'pending',
      timestamp: new Date().toISOString()
    });

    this.commandQueue.add(async () => {
      if (!this.pendingCommands.has(resolvedCommandId)) {
        return;
      }

      this.activeCommand = commandEntry;
      this.pendingCommands.delete(resolvedCommandId);

      try {
        await this.writeToConnection(commandToSend, {
          rawCommand: normalizedCommand,
          isRealTime: false
        });

        commandEntry.sentAt = Date.now();

        const timeoutMs = normalizedMeta?.jobControl ? 0 : 0;
        if (timeoutMs > 0) {
          commandEntry.timeoutHandle = setTimeout(() => {
            if (this.activeCommand && this.activeCommand.id === resolvedCommandId) {
              const error = new Error(`Command timed out after ${timeoutMs}ms`);
              error.code = 'COMMAND_TIMEOUT';
              error.commandId = resolvedCommandId;
              error.command = normalizedCommand;
              error.meta = normalizedMeta;
              this.handleCommandError(error);
            }
          }, timeoutMs);
        }

        this.emit('sent', {
          id: resolvedCommandId,
          command: normalizedCommand,
          displayCommand: display,
          meta: normalizedMeta,
          status: 'sent',
          timestamp: new Date().toISOString()
        });

        await promise;
      } catch (error) {
        log('Failed to send CNC command', normalizedCommand, error?.message || error);
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        this.emit('send-error', {
          id: resolvedCommandId,
          command: normalizedCommand,
          displayCommand: display,
          meta: normalizedMeta,
          status: 'error',
          error: normalizedError,
          timestamp: new Date().toISOString()
        });
        throw normalizedError;
      }
    }).catch(() => {});

    return promise;
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

  getGreetingMessage() {
    return this.greetingMessage;
  }

  handleConnectionError(error) {
    this.isConnected = false;
    this.connectionStatus = 'error';
    this.isVerifyingConnection = false;
    this.hasReceivedFirstStatus = false;
    this.greetingMessage = null;
    this.flushQueue('connection-error', error);

    // Special handling for USB port locking issues
    if (error.message && error.message.includes('Resource temporarily unavailable')) {
      log('USB port locked, will retry after delay...');
      this.connectionStatus = 'port-locked';
    }

    this.emitConnectionStatus(this.connectionStatus, false);
  }
}
