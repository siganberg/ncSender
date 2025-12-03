import { debugLog, debugWarn, debugError } from './debug-logger';

const REALTIME_JOG_CANCEL = String.fromCharCode(0x85);

class NCClient {
  constructor() {
    this.baseUrl = this.getBaseUrl();
    this.ws = null;
    this.clientId = null; // Unique client ID assigned by server
    this.eventListeners = new Map();
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.jogAckTimeoutMs = 1500;
    this.discoveredPort = null;
    this.lastServerState = null;
    this.messageStates = new Map(); // Track state for each message type
    this.activeJogSessions = new Set(); // Track active jog sessions for dead-man switch
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
        return 'http://localhost:8090';
      } else if (window.location.port === '5174') {
        // Development mode: Connect directly to backend server
        const hostname = window.location.hostname;
        return `http://${hostname}:8090`;
      } else {
        // Production mode: served by embedded server - use same host/port as current page
        return `${window.location.protocol}//${window.location.host}`;
      }
    }
    return 'http://localhost:8090';
  }

  getWebSocketUrl() {
    if (typeof window !== 'undefined' && window.location) {
      if (window.location.port === '5174') {
        // Development mode: connect to backend server using same hostname
        const hostname = window.location.hostname;
        return `ws://${hostname}:8090`;
      } else if (window.location.protocol === 'file:') {
        // Electron app loading from file:// - connect directly to server
        return 'ws://localhost:8090';
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


  async getStatus() {
    const response = await fetch(`${this.baseUrl}/api/status`);
    if (!response.ok) throw new Error('Failed to get status');
    return await response.json();
  }

  async getServerState() {
    const response = await fetch(`${this.baseUrl}/api/server-state`);
    if (!response.ok) throw new Error('Failed to get server state');
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
    const displayCommand = providedDisplayCommand;

    try {
      const response = await fetch(`${this.baseUrl}/api/send-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          commandId,
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
      completesCommandId
    };

    // Fire-and-forget: send command via WebSocket
    // Results are broadcast via cnc-command-result and cnc-error events
    // Only reject if WebSocket fails to send
    return this.sendWebSocketMessage('cnc:command', payload, { skipReadyCheck: true });
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
      feedRate
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
        // Track active jog session for dead-man switch
        this.activeJogSessions.add(jogId);
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

    const payload = { jogId, reason };

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
        // Remove from active jog sessions
        this.activeJogSessions.delete(jogId);
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
      return Promise.resolve();
    }

    try {
      this.ws.send(JSON.stringify({ type: 'jog:heartbeat', data: { jogId } }));
      return Promise.resolve();
    } catch (error) {
      console.error('Failed to send jog heartbeat:', error);
      return Promise.reject(error);
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
      commandId: resolvedCommandId
    };

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        settled = true;
        clearTimeout(resultTimer);
        if (offResult) offResult();
      };

      const rejectWith = (error) => {
        if (!settled) {
          cleanup();
          reject(error instanceof Error ? error : new Error(error?.message || 'Jog step failed'));
        }
      };

      const resultTimeoutMs = Math.max(this.jogAckTimeoutMs * 4, 6000);
      const resultTimer = setTimeout(() => {
        rejectWith(new Error('Timed out waiting for jog step result'));
      }, resultTimeoutMs);

      const offResult = this.on('cnc-command-result', (result) => {
        if (!result || result.id !== resolvedCommandId || settled) {
          return;
        }
        cleanup();
        if (result.status === 'success') {
          resolve(result);
        } else {
          const message = result.error?.message || 'Jog step failed';
          reject(new Error(message));
        }
      });

      this.sendWebSocketMessage('jog:step', payload, { skipReadyCheck: true }).catch((error) => {
        rejectWith(error);
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

  async loadGCodeFile(filename) {
    const response = await fetch(`${this.baseUrl}/api/gcode-files/${encodeURIComponent(filename)}/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Failed to load G-code file');
    return await response.json();
  }

  async deleteGCodeFile(filename) {
    const response = await fetch(`${this.baseUrl}/api/gcode-files/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete G-code file');
    return await response.json();
  }

  async downloadGCodeFile(onProgress) {
    const response = await fetch(`${this.baseUrl}/api/gcode-files/current/download`);
    if (!response.ok) throw new Error('Failed to download G-code file');

    const contentLength = response.headers.get('Content-Length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    let loaded = 0;

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let content = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      loaded += value.length;
      content += decoder.decode(value, { stream: true });

      if (onProgress && total > 0) {
        onProgress({ loaded, total, percent: (loaded / total) * 100 });
      }
    }

    return content;
  }

  async clearGCode() {
    const response = await fetch(`${this.baseUrl}/api/gcode-preview/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Failed to clear G-code preview');
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
    debugLog('Connecting to WebSocket:', wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      debugLog('WebSocket connected successfully to:', wsUrl);
      this.reconnectAttempts = 0; // Reset on successful connection
      this.emit('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        // Use debugLog for all messages (including server-state-updated)
        debugLog('Parsed message:', JSON.stringify(message, null, 2));

        // Handle client ID assignment
        if (message && message.type === 'client-id' && message.data?.clientId) {
          this.clientId = message.data.clientId;
          debugLog('Client ID assigned:', this.clientId);
          this.emit('client-id-assigned', this.clientId);
        }

        if (message && message.type === 'server-state-updated' && message.data) {
          // Merge partial state updates with existing state
          this.lastServerState = this.mergeState(this.lastServerState, message.data);
          // Emit the full merged state
          this.emit(message.type, this.lastServerState);
        } else if (message && message.type === 'settings-changed' && message.data) {
          // Broadcast settings-changed event globally for all listeners (partial/delta update)
          try {
            window.dispatchEvent(new CustomEvent('settings-changed', {
              detail: message.data
            }));
          } catch {}
          this.emit(message.type, message.data);
        } else {
          this.emit(message.type, message.data);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error, 'Raw data:', event.data);
      }
    };

    this.ws.onclose = (event) => {
      debugLog('WebSocket disconnected', 'Code:', event.code, 'Reason:', event.reason);

      // Dead-man switch: Send emergency jog cancel if any jog sessions are active
      if (this.activeJogSessions.size > 0) {
        debugWarn('WebSocket disconnected with active jog sessions - sending emergency jog cancel');
        // Send jog cancel via HTTP as fallback (WebSocket is closed)
        fetch(`${this.baseUrl}/api/cnc/send-command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: REALTIME_JOG_CANCEL,
            displayCommand: '\\x85 (Emergency Jog Cancel - WebSocket Disconnected)',
            meta: { emergencyStop: true }
          })
        }).catch((error) => {
          console.error('Failed to send emergency jog cancel:', error);
        });
        // Clear all active jog sessions
        this.activeJogSessions.clear();
      }

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
    debugLog(`Attempting WebSocket reconnect (attempt ${this.reconnectAttempts}) in 1 second...`);

    setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Already reconnected
        return;
      }
      this.connect();
    }, 1000);
  }

  mergeState(existingState, partialUpdate) {
    if (!existingState) {
      return partialUpdate;
    }

    const merged = { ...existingState };

    for (const key in partialUpdate) {
      const value = partialUpdate[key];

      // Handle nested objects (one level deep)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const prev = merged[key];
        if (typeof prev === 'object' && prev !== null && !Array.isArray(prev)) {
          merged[key] = { ...prev, ...value };
        } else {
          // If previous is null/undefined or not an object, replace it entirely
          merged[key] = { ...value };
        }
      } else {
        merged[key] = value;
      }
    }

    return merged;
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

  onIOPinsUpdated(callback) {
    return this.on('io-pins-updated', callback);
  }

  // Backward compatibility - alias for server state updates that include machine state
  onMachineStateUpdated(callback) {
    return this.on('server-state-updated', (serverState) => {
      if (serverState.machineState) {
        callback(serverState.machineState);
      }
    });
  }

  // No longer broadcasting ETA from client

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

  async getJobStatus() {
    const response = await fetch(`${this.baseUrl}/api/gcode-job/status`);
    if (!response.ok) throw new Error('Failed to get job status');
    return await response.json();
  }

  async controlGCodeJob(action) {
    // Use send-command API with real-time commands
    let command;

    if (action === 'pause') {
      // Check if "Use Door as Pause" setting is enabled
      const { getSettings } = await import('./settings-store.js');
      const settings = getSettings();
      const useDoorAsPause = settings?.useDoorAsPause ?? false;

      command = useDoorAsPause ? '\x84' : '!';  // Door or Feed hold
    } else if (action === 'resume') {
      command = '~';  // Resume
    } else {
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

  // Firmware settings methods
  async getFirmwareSettings(forceRefresh = false) {
    const url = forceRefresh
      ? `${this.baseUrl}/api/firmware?refresh=true`
      : `${this.baseUrl}/api/firmware`;

    const response = await fetch(url);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to get firmware settings' }));
      throw new Error(error.error || 'Failed to get firmware settings');
    }
    return response.json();
  }

  async triggerToolChange(toolNumber) {
    return this.sendCommandViaWebSocket({
      command: `M6 T${toolNumber}`,
      displayCommand: `M6 T${toolNumber}`,
      meta: { sourceId: 'tool-change', toolNumber }
    });
  }

  async triggerTLS() {
    return this.sendCommandViaWebSocket({
      command: '$TLS',
      displayCommand: '$TLS',
      meta: { sourceId: 'tls' }
    });
  }

  // Settings methods
  async getSettings() {
    const response = await fetch(`${this.baseUrl}/api/settings`);
    if (response.status === 204) {
      return null; // No settings file exists
    }
    if (!response.ok) {
      throw new Error('Failed to get settings');
    }
    return response.json();
  }

  async getSetting(name) {
    const response = await fetch(`${this.baseUrl}/api/settings/${name}`);
    if (response.status === 204) {
      return null; // Setting not found / not set
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `Failed to get setting ${name}` }));
      throw new Error(error.error || `Failed to get setting ${name}`);
    }
    return response.json();
  }

  async updateSettings(updates, options = {}) {
    const { broadcast = true } = options;
    const url = `${this.baseUrl}/api/settings${broadcast ? '' : '?broadcast=false'}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update settings' }));
      throw new Error(error.error || 'Failed to update settings');
    }
    return response.json();
  }

  async saveSettings(settings) {
    const response = await fetch(`${this.baseUrl}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to save settings' }));
      throw new Error(error.error || 'Failed to save settings');
    }
    return response.json();
  }
}

// Create singleton instance
export const api = new NCClient();

// Auto-connect WebSocket when module loads
api.connect();
