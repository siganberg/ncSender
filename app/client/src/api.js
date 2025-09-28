class NCClient {
  constructor() {
    this.baseUrl = this.getBaseUrl();
    this.ws = null;
    this.eventListeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
  }

  getBaseUrl() {
    // Detect if running in Electron or browser
    if (typeof window !== 'undefined' && window.location) {
      if (window.location.protocol === 'file:') {
        // Electron app loading from file://
        return 'http://localhost:3001';
      } else {
        // Browser
        return `${window.location.protocol}//${window.location.host}`;
      }
    }
    return 'http://localhost:3001';
  }

  getWebSocketUrl() {
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

  async connect(port, baudRate) {
    const response = await fetch(`${this.baseUrl}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port, baudRate })
    });
    if (!response.ok) throw new Error('Failed to connect');
    return await response.json();
  }

  async disconnect() {
    const response = await fetch(`${this.baseUrl}/api/disconnect`, {
      method: 'POST'
    });
    if (!response.ok) throw new Error('Failed to disconnect');
    return await response.json();
  }

  async getStatus() {
    const response = await fetch(`${this.baseUrl}/api/status`);
    if (!response.ok) throw new Error('Failed to get status');
    return await response.json();
  }

  async sendCommand(command) {
    const response = await fetch(`${this.baseUrl}/api/send-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });
    if (!response.ok) throw new Error('Failed to send command');
    return await response.json();
  }

  // WebSocket real-time communication
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    const wsUrl = this.getWebSocketUrl();
    console.log('Connecting to WebSocket:', wsUrl);

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.emit('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.emit(message.type, message.data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.emit('disconnected');
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    };
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
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
}

// Create singleton instance
export const api = new NCClient();

// Auto-connect WebSocket when module loads
api.connect();