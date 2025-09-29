const REALTIME_JOG_CANCEL = String.fromCharCode(0x85);

class NCClient {
  constructor() {
    this.baseUrl = this.getBaseUrl();
    this.ws = null;
    this.eventListeners = new Map();
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.clientId = this.ensureClientId();
    this.jogAckTimeoutMs = 1500;
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

  async sendCommandViaWebSocket({ command, displayCommand, commandId, meta, completesCommandId } = {}) {
    if (typeof command !== 'string' || command.trim() === '') {
      throw new Error('sendCommandViaWebSocket requires a command');
    }

    const normalizedCommandId = commandId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await this.ensureWebSocketReady();

    const payload = {
      command,
      commandId: normalizedCommandId,
      displayCommand,
      meta,
      completesCommandId,
      clientId: this.clientId
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      let ackReceived = false;

      const cleanup = () => {
        settled = true;
        clearTimeout(ackTimer);
        clearTimeout(resultTimer);
        if (offAck) offAck();
        if (offError) offError();
        if (offResult) offResult();
      };

      const rejectWith = (error) => {
        if (!settled) {
          cleanup();
          reject(error instanceof Error ? error : new Error(error?.message || 'Command failed'));
        }
      };

      const ackTimer = setTimeout(() => {
        if (!ackReceived) {
          rejectWith(new Error('Timed out waiting for command acknowledgement'));
        }
      }, this.jogAckTimeoutMs);

      const resultTimeoutMs = Math.max(this.jogAckTimeoutMs * 4, 6000);
      const resultTimer = setTimeout(() => {
        rejectWith(new Error('Timed out waiting for command result'));
      }, resultTimeoutMs);

      const offAck = this.on('cnc:command-ack', (data) => {
        if (!data || data.commandId !== normalizedCommandId || settled) {
          return;
        }
        ackReceived = true;
      });

      const offError = this.on('cnc:command-error', (data) => {
        if (!data || data.commandId !== normalizedCommandId || settled) {
          return;
        }
        rejectWith(new Error(data?.error?.message || 'Command failed'));
      });

      const offResult = this.on('cnc-command-result', (result) => {
        if (!result || result.id !== normalizedCommandId || settled) {
          return;
        }

        cleanup();
        if (result.status === 'success') {
          resolve(result);
        } else {
          const errorMessage = result.error?.message || 'Command failed';
          reject(new Error(errorMessage));
        }
      });

      this.sendWebSocketMessage('cnc:command', payload, { skipReadyCheck: true }).catch((error) => {
        rejectWith(error instanceof Error ? error : new Error('Failed to send command via WebSocket'));
      });
    });
  }

  async startJogSession({ jogId, command, displayCommand, axis, direction, feedRate }) {
    if (!jogId) {
      throw new Error('startJogSession requires a jogId');
    }

    if (typeof command !== 'string' || command.trim() === '') {
      throw new Error('startJogSession requires a command');
    }

    await this.ensureWebSocketReady();

    const payload = {
      jogId,
      command,
      displayCommand,
      axis,
      direction,
      feedRate,
      clientId: this.clientId
    };

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        if (offStarted) offStarted();
        if (offFailed) offFailed();
      };

      const timer = setTimeout(() => {
        if (!settled) {
          cleanup();
          reject(new Error('Timed out waiting for jog start acknowledgement'));
        }
      }, this.jogAckTimeoutMs);

      const offStarted = this.on('jog:started', (data) => {
        if (!data || data.jogId !== jogId || settled) {
          return;
        }
        cleanup();
        resolve(data);
      });

      const offFailed = this.on('jog:start-failed', (data) => {
        if (!data || data.jogId !== jogId || settled) {
          return;
        }
        cleanup();
        reject(new Error(data?.message || 'Jog start failed'));
      });

      this.sendWebSocketMessage('jog:start', payload, { skipReadyCheck: true }).catch((error) => {
        if (!settled) {
          cleanup();
          reject(error instanceof Error ? error : new Error('Failed to send jog start'));
        }
      });
    });
  }

  async stopJogSession(jogId, reason = 'client-stop') {
    if (!jogId) {
      return null;
    }

    await this.ensureWebSocketReady();

    const payload = { jogId, reason, clientId: this.clientId };

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        if (offStopped) offStopped();
      };

      const timer = setTimeout(() => {
        if (!settled) {
          cleanup();
          reject(new Error('Timed out waiting for jog stop acknowledgement'));
        }
      }, this.jogAckTimeoutMs);

      const offStopped = this.on('jog:stopped', (data) => {
        if (!data || data.jogId !== jogId || settled) {
          return;
        }
        cleanup();
        resolve(data);
      });

      this.sendWebSocketMessage('jog:stop', payload, { skipReadyCheck: true }).catch((error) => {
        if (!settled) {
          cleanup();
          reject(error instanceof Error ? error : new Error('Failed to send jog stop'));
        }
      });
    });
  }

  sendJogHeartbeat(jogId) {
    if (!jogId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.ws.send(JSON.stringify({ type: 'jog:heartbeat', data: { jogId } }));
    } catch (error) {
      console.error('Failed to send jog heartbeat:', error);
    }
  }

  async sendJogStep({ command, displayCommand, axis, direction, feedRate, distance, commandId }) {
    if (typeof command !== 'string' || command.trim() === '') {
      throw new Error('sendJogStep requires a command');
    }

    const resolvedCommandId = commandId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await this.ensureWebSocketReady();

    const payload = {
      command,
      displayCommand,
      axis,
      direction,
      feedRate,
      distance,
      commandId: resolvedCommandId,
      clientId: this.clientId
    };

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        if (offAck) offAck();
        if (offFailed) offFailed();
      };

      const timer = setTimeout(() => {
        if (!settled) {
          cleanup();
          reject(new Error('Timed out waiting for jog step acknowledgement'));
        }
      }, this.jogAckTimeoutMs);

      const offAck = this.on('jog:step-ack', (data) => {
        if (!data || data.commandId !== resolvedCommandId || settled) {
          return;
        }
        cleanup();
        resolve(data);
      });

      const offFailed = this.on('jog:step-failed', (data) => {
        if (!data || data.commandId !== resolvedCommandId || settled) {
          return;
        }
        cleanup();
        reject(new Error(data?.message || 'Jog step failed'));
      });

      this.sendWebSocketMessage('jog:step', payload, { skipReadyCheck: true }).catch((error) => {
        if (!settled) {
          cleanup();
          reject(error instanceof Error ? error : new Error('Failed to send jog step'));
        }
      });
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

  async ensureWebSocketReady(timeoutMs = this.jogAckTimeoutMs) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.connect();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        if (offConnected) offConnected();
        if (offError) offError();
      };

      const timer = setTimeout(() => {
        if (!settled) {
          cleanup();
          reject(new Error('WebSocket connection timed out'));
        }
      }, timeoutMs);

      const offConnected = this.on('connected', () => {
        if (!settled) {
          cleanup();
          resolve();
        }
      });

      const offError = this.on('error', (error) => {
        if (!settled) {
          cleanup();
          reject(error instanceof Error ? error : new Error('WebSocket connection error'));
        }
      });
    });
  }

  async sendWebSocketMessage(type, data, { skipReadyCheck = false } = {}) {
    if (!skipReadyCheck) {
      await this.ensureWebSocketReady();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    this.ws.send(JSON.stringify({ type, data }));
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
    // Use send-command API with real-time commands
    const commandMap = {
      'pause': '!',     // Feed hold
      'resume': '~'     // Resume
    };

    const command = commandMap[action];
    if (!command) {
      throw new Error(`Invalid action: ${action}`);
    }

    return await this.sendCommandViaWebSocket({
      command,
      meta: { jobControl: true }
    });
  }

  async stopGCodeJob() {
    const response = await fetch(`${this.baseUrl}/api/gcode-job/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      let message = 'Failed to stop G-code job';
      try {
        const errorBody = await response.json();
        if (errorBody?.error) {
          message = errorBody.error;
        }
      } catch (error) {
        // Ignore JSON parse errors and use default message
      }
      throw new Error(message);
    }

    return response.json();
  }
}

// Create singleton instance
export const api = new NCClient();

// Auto-connect WebSocket when module loads
api.connect();
