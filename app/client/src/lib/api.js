const REALTIME_JOG_CANCEL = String.fromCharCode(0x85);

class NCClient {
  constructor() {
    this.baseUrl = this.getBaseUrl();
    this.ws = null;
    this.eventListeners = new Map();
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.clientId = this.ensureClientId();
  }

  ensureClientId() {
    const generateId = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const storageKey = 'ncSenderClientId';
        const existingId = window.sessionStorage.getItem(storageKey);
        if (existingId) {
          return existingId;
        }

        const newId = generateId();
        window.sessionStorage.setItem(storageKey, newId);
        return newId;
      }
    } catch (error) {
      console.warn('Unable to persist client ID to sessionStorage:', error);
    }

    return generateId();
  }

  describeCommand(command) {
    const realTimeCommands = {
      [String.fromCharCode(0x90)]: '\\x90; (Feed Rate Override Reset 100%)',
      [String.fromCharCode(0x91)]: '\\x91; (Feed Rate Override +10%)',
      [String.fromCharCode(0x92)]: '\\x92; (Feed Rate Override -10%)',
      [String.fromCharCode(0x93)]: '\\x93; (Feed Rate Override +1%)',
      [String.fromCharCode(0x94)]: '\\x94; (Feed Rate Override -1%)',
      [String.fromCharCode(0x99)]: '\\x99; (Spindle Speed Override Reset 100%)',
      [String.fromCharCode(0x9A)]: '\\x9A; (Spindle Speed Override +10%)',
      [String.fromCharCode(0x9B)]: '\\x9B; (Spindle Speed Override -10%)',
      [String.fromCharCode(0x9C)]: '\\x9C; (Spindle Speed Override +1%)',
      [String.fromCharCode(0x9D)]: '\\x9D; (Spindle Speed Override -1%)',
      [String.fromCharCode(0x85)]: '\\x85; (Jog Cancel)',
      [String.fromCharCode(0x18)]: '\\x18; (Soft Reset)'
    };
    return realTimeCommands[command] || command;
  }

  isJogCancelCommand(command) {
    return command === REALTIME_JOG_CANCEL;
  }

  getJogCancelCommand() {
    return REALTIME_JOG_CANCEL;
  }

  getBaseUrl() {
    if (typeof window !== 'undefined' && window.location) {
      if (window.location.protocol === 'file:') {
        // Electron app loading from file:// - connect to server
        return 'http://localhost:3001';
      } else if (window.location.port === '5174') {
        // Development mode: Connect directly to backend server
        const hostname = window.location.hostname;
        return `http://${hostname}:3001`;
      } else {
        // Production mode: served by embedded server
        return `${window.location.protocol}//${window.location.host}`;
      }
    }
    return 'http://localhost:3001';
  }

  getWebSocketUrl() {
    if (typeof window !== 'undefined' && window.location) {
      if (window.location.port === '5174') {
        // Development mode: connect to backend server using same hostname
        const hostname = window.location.hostname;
        return `ws://${hostname}:3001`;
      } else if (window.location.protocol === 'file:') {
        // Electron app loading from file:// - connect directly to server
        return 'ws://localhost:3001';
      }
    }

    // Production mode: use same host as base URL
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  // HTTP API methods
  async listPorts() {
    const response = await fetch(`${this.baseUrl}/api/serial-ports`);
    if (!response.ok) throw new Error('Failed to fetch ports');
    return await response.json();
  }

  async connectToCNC(port, baudRate) {
    const body = port && baudRate ? { port, baudRate } : {};
    const response = await fetch(`${this.baseUrl}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Failed to connect to CNC');
    return await response.json();
  }

  async disconnectCNC() {
    try {
      const response = await fetch(`${this.baseUrl}/api/disconnect`, {
        method: 'POST'
      });
      if (!response.ok) {
        throw new Error('Failed to disconnect from CNC');
      }
      console.log('Successfully disconnected CNC');
    } catch (error) {
      console.error('Error during CNC disconnect:', error);
    }
  }

  async getStatus() {
    const response = await fetch(`${this.baseUrl}/api/status`);
    if (!response.ok) throw new Error('Failed to get status');
    return await response.json();
  }

  async sendCommand(command, options = {}) {
    const {
      commandId: providedCommandId,
      displayCommand: providedDisplayCommand,
      meta,
      completesCommandId
    } = options || {};

    const commandId = providedCommandId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const displayCommand = providedDisplayCommand ?? this.describeCommand(command);

    try {
      const response = await fetch(`${this.baseUrl}/api/send-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          commandId,
          clientId: this.clientId,
          displayCommand,
          meta,
          completesCommandId
        })
      });
      const responseData = await response.json();
      if (responseData && typeof responseData === 'object' && !responseData.commandId) {
        responseData.commandId = commandId;
      }

      if (!response.ok) {
        const error = new Error(responseData?.error?.message || 'Failed to send command');
        error.code = responseData?.error?.code;
        error.commandId = responseData?.commandId || commandId;
        error.payload = responseData;
        throw error;
      }

      return responseData;
    } catch (error) {
      throw error;
    }
  }

  async startContinuousJog(command) {
    const commandId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const response = await this.sendCommand(command, {
      commandId,
      meta: {
        continuous: true,
        recordHistory: false
      }
    });
    return { commandId, response };
  }

  async stopContinuousJog(commandId) {
    return await this.sendCommand(REALTIME_JOG_CANCEL, {
      commandId,
      meta: {
        completesCommandId: commandId,
        recordHistory: false
      },
      completesCommandId: commandId
    });
  }

  async uploadGCodeFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseUrl}/api/gcode-files`, {
      method: 'POST',
      body: formData
    });
    if (!response.ok) throw new Error('Failed to upload G-code file');
    return await response.json();
  }

  async listGCodeFiles() {
    const response = await fetch(`${this.baseUrl}/api/gcode-files`);
    if (!response.ok) throw new Error('Failed to list G-code files');
    return await response.json();
  }

  async getGCodeFile(filename) {
    const response = await fetch(`${this.baseUrl}/api/gcode-files/${encodeURIComponent(filename)}`);
    if (!response.ok) throw new Error('Failed to get G-code file');
    return await response.json();
  }

  async clearGCode() {
    const response = await fetch(`${this.baseUrl}/api/gcode-preview/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Failed to clear G-code preview');
    return await response.json();
  }

  async getServerState() {
    const response = await fetch(`${this.baseUrl}/api/server-state`);
    if (!response.ok) throw new Error('Failed to get server state');
    return await response.json();
  }

  async getCommandHistory() {
    const response = await fetch(`${this.baseUrl}/api/command-history`);
    if (!response.ok) throw new Error('Failed to get command history');
    return await response.json();
  }

  async addCommandToHistory(command) {
    const response = await fetch(`${this.baseUrl}/api/command-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });
    if (!response.ok) throw new Error('Failed to add command to history');
    return await response.json();
  }

  onCommandHistoryAppended(callback) {
    return this.on('command-history-appended', callback);
  }

  // WebSocket real-time communication (auto-connects, always retries)
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = this.getWebSocketUrl();
    console.log('Connecting to WebSocket:', wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected successfully to:', wsUrl);
      this.reconnectAttempts = 0; // Reset on successful connection
      this.emit('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Parsed message:', message);
        this.emit(message.type, message.data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error, 'Raw data:', event.data);
      }
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket disconnected', 'Code:', event.code, 'Reason:', event.reason);
      this.emit('disconnected');
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    };
  }

  attemptReconnect() {
    this.reconnectAttempts++;
    console.log(`Attempting WebSocket reconnect (attempt ${this.reconnectAttempts}) in 1 second...`);

    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Already reconnected
        return;
      }
      this.connect();
    }, 1000);
  }





  // Event handling
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event).add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  emit(event, data) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in event listener:', error);
        }
      });
    }
  }

  // Convenience methods for CNC events
  onStatus(callback) {
    return this.on('cnc-status', callback);
  }

  onData(callback) {
    return this.on('cnc-data', callback);
  }


  onSystemMessage(callback) {
    return this.on('cnc-system-message', callback);
  }

  onResponse(callback) {
    return this.on('cnc-response', callback);
  }

  onGCodeUpdated(callback) {
    return this.on('gcode-updated', callback);
  }


  onServerStateUpdated(callback) {
    return this.on('server-state-updated', callback);
  }

  // Backward compatibility - alias for server state updates that include machine state
  onMachineStateUpdated(callback) {
    return this.on('server-state-updated', (serverState) => {
      if (serverState.machineState) {
        callback(serverState.machineState);
      }
    });
  }

  async checkCurrentProgram() {
    try {
      const serverState = await this.getServerState();

      if (serverState.loadedGCodeProgram) {
        // Add small delay to ensure viewport is fully rendered before loading G-code
        setTimeout(async () => {
          try {
            // Get the file content and emit the gcode-updated event
            const fileData = await this.getGCodeFile(serverState.loadedGCodeProgram);
            this.emit('gcode-updated', {
              filename: fileData.filename,
              content: fileData.content,
              timestamp: new Date().toISOString()
            });
          } catch (error) {
            console.error('Error loading current program:', error);
          }
        }, 200); // 200ms delay
      }
    } catch (error) {
      console.error('Error checking current program:', error);
    }
  }

  // G-code Job Control Methods
  async startGCodeJob(filename) {
    const response = await fetch(`${this.baseUrl}/api/gcode-job`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filename }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start G-code job');
    }

    return response.json();
  }

  async controlGCodeJob(action) {
    const response = await fetch(`${this.baseUrl}/api/gcode-job`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to ${action} G-code job`);
    }

    return response.json();
  }

  async stopGCodeJob() {
    const response = await fetch(`${this.baseUrl}/api/gcode-job`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to stop G-code job');
    }

    return response.json();
  }
}

// Create singleton instance
export const api = new NCClient();

// Auto-connect WebSocket when module loads
api.connect();
