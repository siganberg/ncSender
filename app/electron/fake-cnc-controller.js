import { EventEmitter } from 'events';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}] [FAKE CNC]`, ...args);
};

export class FakeCNCController extends EventEmitter {
  constructor() {
    super();
    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.lastStatus = {
      status: 'Idle',
      MPos: '0.000,0.000,0.000',
      WPos: '0.000,0.000,0.000',
      WCO: '0.000,0.000,0.000',
      feedrateOverride: 100,
      rapidOverride: 100,
      spindleOverride: 100
    };
    this.rawData = '<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000>';
    this.commandQueue = [];
    this.statusPollInterval = null;
    this.currentPosition = { x: 0, y: 0, z: 0 };
    this.machineState = 'Idle'; // Idle, Run, Hold, Door, etc.
  }

  async listAvailablePorts() {
    return [
      { path: '/dev/fake-cnc', manufacturer: 'Fake CNC Simulator' }
    ];
  }

  async autoConnect() {
    log('Auto-connecting to fake CNC controller...');
    await this.connect('/dev/fake-cnc', 115200);
    return true;
  }

  async connect(portPath, baudRate = 115200) {
    if (this.isConnected) {
      log('Already connected to fake CNC controller');
      return;
    }

    log(`Connecting to fake CNC controller on ${portPath} at ${baudRate} baud`);

    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 500));

    this.isConnected = true;
    this.connectionStatus = 'connected';
    this.machineState = 'Idle';

    this.emit('status', {
      status: 'connected',
      isConnected: true,
      retryAttempts: 0
    });

    // Start status polling
    this.startPolling();

    log('Fake CNC controller connected successfully');
  }

  disconnect() {
    this.stopPolling();
    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    this.machineState = 'Idle';

    this.emit('status', {
      status: 'disconnected',
      isConnected: false,
      retryAttempts: 0
    });

    log('Fake CNC controller disconnected');
  }

  startPolling() {
    if (this.statusPollInterval) return;
    this.statusPollInterval = setInterval(() => {
      this.updateStatus();
    }, 200);
  }

  stopPolling() {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }
  }

  updateStatus() {
    // Simulate status report
    const newStatus = {
      status: this.machineState,
      MPos: `${this.currentPosition.x.toFixed(3)},${this.currentPosition.y.toFixed(3)},${this.currentPosition.z.toFixed(3)}`,
      WPos: `${this.currentPosition.x.toFixed(3)},${this.currentPosition.y.toFixed(3)},${this.currentPosition.z.toFixed(3)}`,
      WCO: '0.000,0.000,0.000',
      feedrateOverride: this.lastStatus.feedrateOverride || 100,
      rapidOverride: this.lastStatus.rapidOverride || 100,
      spindleOverride: this.lastStatus.spindleOverride || 100
    };

    // Create raw data string
    this.rawData = `<${newStatus.status}|MPos:${newStatus.MPos}|WPos:${newStatus.WPos}|WCO:${newStatus.WCO}>`;

    // Check for changes and emit if different
    if (JSON.stringify(newStatus) !== JSON.stringify(this.lastStatus)) {
      this.lastStatus = newStatus;
      this.emit('status-report', newStatus);
    }
  }

  async sendCommand(command) {
    if (!this.isConnected) {
      throw new Error('Fake CNC controller is not connected');
    }

    // Clean up command - remove semicolon comments
    const cleanCommand = command.split(';')[0].trim();

    // Check if this is a real-time command
    const realTimeCommands = ['!', '~', '?'];
    const isRealTimeCommand = cleanCommand.length === 1 &&
      (realTimeCommands.includes(cleanCommand) || cleanCommand.charCodeAt(0) >= 0x80);

    if (isRealTimeCommand) {
      // Handle real-time commands immediately
      return this.handleRealTimeCommand(cleanCommand);
    }

    // Simulate command processing delay
    await new Promise(resolve => setTimeout(resolve, 50));

    // Simulate command execution
    await this.simulateCommandExecution(cleanCommand);

    // Don't log '?' commands to reduce noise
    if (cleanCommand !== '?') {
      log('Command executed:', cleanCommand);
    }

    return Promise.resolve();
  }

  async handleRealTimeCommand(command) {
    switch (command) {
      case '!':
        // Feed hold (pause)
        if (this.machineState === 'Run') {
          this.machineState = 'Hold';
          log('Machine paused (Feed Hold)');
        }
        break;
      case '~':
        // Resume
        if (this.machineState === 'Hold') {
          this.machineState = 'Run';
          log('Machine resumed');
        }
        break;
      case '?':
        // Status query - just return current status
        this.emit('data', this.rawData);
        break;
      default:
        if (command.charCodeAt(0) >= 0x80) {
          // Handle override commands
          this.handleOverrideCommand(command);
        }
        break;
    }
    return Promise.resolve();
  }

  handleOverrideCommand(command) {
    const code = command.charCodeAt(0);

    // Feed rate overrides
    if (code >= 0x90 && code <= 0x99) {
      let change = 0;
      switch (code) {
        case 0x90: this.lastStatus.feedrateOverride = 100; break; // Reset to 100%
        case 0x91: change = 1; break;  // +1%
        case 0x92: change = -1; break; // -1%
        case 0x93: change = 10; break; // +10%
        case 0x94: change = -10; break; // -10%
      }
      if (change !== 0) {
        this.lastStatus.feedrateOverride = Math.max(10, Math.min(200, this.lastStatus.feedrateOverride + change));
      }
      log(`Feed rate override: ${this.lastStatus.feedrateOverride}%`);
    }

    // Spindle speed overrides
    else if (code >= 0x9A && code <= 0xA3) {
      let change = 0;
      switch (code) {
        case 0x99: this.lastStatus.spindleOverride = 100; break; // Reset to 100%
        case 0x9A: change = 1; break;  // +1%
        case 0x9B: change = -1; break; // -1%
        case 0x9C: change = 10; break; // +10%
        case 0x9D: change = -10; break; // -10%
      }
      if (change !== 0) {
        this.lastStatus.spindleOverride = Math.max(10, Math.min(200, this.lastStatus.spindleOverride + change));
      }
      log(`Spindle override: ${this.lastStatus.spindleOverride}%`);
    }
  }

  async simulateCommandExecution(command) {
    const upperCommand = command.toUpperCase();

    // Simulate movement commands
    if (upperCommand.startsWith('G0') || upperCommand.startsWith('G1')) {
      // Set machine to Run state during movement
      const wasIdle = this.machineState === 'Idle';
      if (wasIdle) {
        this.machineState = 'Run';
      }

      // Parse coordinates and simulate movement
      const xMatch = upperCommand.match(/X([-+]?\d*\.?\d+)/);
      const yMatch = upperCommand.match(/Y([-+]?\d*\.?\d+)/);
      const zMatch = upperCommand.match(/Z([-+]?\d*\.?\d+)/);

      if (xMatch) this.currentPosition.x = parseFloat(xMatch[1]);
      if (yMatch) this.currentPosition.y = parseFloat(yMatch[1]);
      if (zMatch) this.currentPosition.z = parseFloat(zMatch[1]);

      // Simulate movement time (faster for rapid moves)
      const moveTime = upperCommand.startsWith('G0') ? 50 : 200;
      await new Promise(resolve => setTimeout(resolve, moveTime));

      // Return to Idle after movement (if not paused)
      if (wasIdle && this.machineState === 'Run') {
        this.machineState = 'Idle';
      }
    }

    // Simulate homing
    else if (upperCommand === '$H') {
      this.machineState = 'Home';
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate homing time
      this.currentPosition = { x: 0, y: 0, z: 0 };
      this.machineState = 'Idle';
      log('Homing completed');
    }

    // Simulate spindle commands
    else if (upperCommand.startsWith('M3') || upperCommand.startsWith('M4') || upperCommand.startsWith('M5')) {
      await new Promise(resolve => setTimeout(resolve, 100));
      log(`Spindle command executed: ${upperCommand}`);
    }

    // Simulate other commands
    else {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      status: this.connectionStatus,
      retryAttempts: 0
    };
  }

  getLastStatus() {
    return this.lastStatus;
  }

  getRawData() {
    return this.rawData;
  }
}