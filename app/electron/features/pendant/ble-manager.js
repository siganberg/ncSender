/*
 * BLE Pendant Manager
 *
 * Handles Bluetooth Low Energy connections to ncSender pendants.
 * Uses Nordic UART Service (NUS) for bidirectional JSON communication.
 * Supports auto-connect to previously paired devices.
 *
 * Platform support:
 * - All platforms use @stoprocent/noble
 * - Linux requires setcap permissions (see docs/LINUX_BLE_SETUP.md)
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../core/logger.js';
import { getSetting, saveSettings } from '../../core/settings-manager.js';

const { log, error: logError } = createLogger('BLE');

// Connection states
const STATE = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting'
};

// Check if BLE is disabled via environment variable
const BLE_DISABLED = process.env.DISABLE_BLE === '1' || process.env.DISABLE_BLE === 'true';

// Force enable BLE (for users who have configured Bluetooth permissions)
const BLE_FORCE_ENABLE = process.env.ENABLE_BLE === '1' || process.env.ENABLE_BLE === 'true';

// Check if running in Electron (where permission dialogs work)
const IS_ELECTRON = !!(process.versions && process.versions.electron);

// On macOS standalone (non-Electron), noble's native bindings can crash
// when Bluetooth permission is denied - disable BLE unless forced
const PLATFORM_BLE_SAFE = IS_ELECTRON || process.platform !== 'darwin' || BLE_FORCE_ENABLE;

if (BLE_DISABLED) {
  log('BLE disabled via DISABLE_BLE environment variable');
} else if (BLE_FORCE_ENABLE && !IS_ELECTRON && process.platform === 'darwin') {
  log('BLE force-enabled via ENABLE_BLE environment variable');
} else if (!PLATFORM_BLE_SAFE) {
  log('BLE disabled: macOS standalone mode may crash without Bluetooth permission');
  log('Set ENABLE_BLE=1 if you have granted Bluetooth permission to Terminal/Node');
}

// Auto-reconnect settings
const AUTO_RECONNECT_INTERVAL = 2000; // 2 seconds between reconnect attempts
const AUTO_RECONNECT_SCAN_DURATION = 1200; // 1.2 second scan (pendant advertises every 500-1000ms)

class BLEPendantManager extends EventEmitter {
  constructor() {
    super();
    this.backend = null;
    this.state = STATE.IDLE;
    this.connectedDevice = null;
    this.connection = null;
    this.discoveredDevices = new Map();
    this.receiveBuffer = '';
    this.isInitialized = false;
    this.initError = null;
    this.autoReconnectTimer = null;
    this.autoReconnectRunning = false;

    // Send queue to prevent message interleaving
    this.sendQueue = [];
    this.isSending = false;

    // Prevent EventEmitter from throwing on unhandled 'error' events
    this.on('error', (err) => {
      logError('BLE manager error:', err.message);
    });
  }

  async initialize() {
    if (this.isInitialized) return true;
    if (this.initError) return false;

    // Check if BLE is disabled or unsafe
    if (BLE_DISABLED) {
      this.initError = new Error('BLE disabled via environment variable');
      return false;
    }

    if (!PLATFORM_BLE_SAFE) {
      this.initError = new Error('BLE not safe in macOS standalone mode');
      return false;
    }

    try {
      // Load Noble backend
      const { NobleBackend } = await import('./ble-backend-noble.js');
      this.backend = new NobleBackend();

      // Set up backend event handlers
      this.backend.on('error', (err) => {
        logError('Backend error:', err.message);
        this.emit('error', err);
      });

      this.backend.on('stateChange', (state) => {
        log('Bluetooth adapter state:', state);
        this.emit('adapterState', state);

        if (state === 'poweredOn') {
          this.emit('ready');
        } else if (state === 'poweredOff') {
          this.emit('disabled');
        }
      });

      this.backend.on('discover', (device) => {
        this.handleDiscovery(device);
      });

      this.backend.on('scanStop', () => {
        if (this.state === STATE.SCANNING) {
          this.state = STATE.IDLE;
          if (!this._silentScan) {
            log('Scan stopped by adapter');
          }
        }
      });

      this.backend.on('data', (data) => {
        this.handleIncomingData(data);
      });

      this.backend.on('disconnect', () => {
        this.handleDisconnect();
      });

      // Initialize backend
      const ok = await this.backend.initialize();
      if (!ok) {
        this.initError = this.backend.initError || new Error('Backend initialization failed');
        return false;
      }

      this.isInitialized = true;

      const currentState = this.backend.getState();
      log('BLE manager initialized, current state:', currentState);

      return true;
    } catch (err) {
      this.initError = err;
      logError('Failed to initialize BLE:', err.message);
      return false;
    }
  }

  getAdapterState() {
    if (BLE_DISABLED) return 'disabled';
    if (!PLATFORM_BLE_SAFE) return 'unsupported';
    if (!this.backend) return 'uninitialized';
    return this.backend.getState();
  }

  async waitForPoweredOn(timeout = 5000) {
    try {
      if (!this.isInitialized) {
        const ok = await this.initialize();
        if (!ok) return false;
      }

      if (!this.backend) return false;

      const state = this.backend.getState();
      if (state === 'poweredOn') {
        return true;
      }

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.backend.removeListener('stateChange', checkState);
          resolve(false);
        }, timeout);

        const checkState = (state) => {
          if (state === 'poweredOn') {
            clearTimeout(timer);
            this.backend.removeListener('stateChange', checkState);
            resolve(true);
          } else if (state === 'poweredOff' || state === 'unauthorized' || state === 'unsupported') {
            clearTimeout(timer);
            this.backend.removeListener('stateChange', checkState);
            resolve(false);
          }
        };

        this.backend.on('stateChange', checkState);
      });
    } catch (err) {
      logError('Error waiting for Bluetooth:', err.message);
      return false;
    }
  }

  handleDiscovery(device) {
    const deviceInfo = {
      id: device.id,
      name: device.name,
      address: device.address,
      rssi: device.rssi,
      _backendDevice: device
    };

    this.discoveredDevices.set(device.id, deviceInfo);

    // Only log during user-initiated scans
    if (!this._silentScan) {
      log('Discovered pendant:', device.name, 'RSSI:', device.rssi);
    }

    this.emit('deviceDiscovered', {
      id: device.id,
      name: device.name,
      address: device.address,
      rssi: device.rssi
    });
  }

  async startScan(duration = 10000, { silent = false } = {}) {
    if (!this.isInitialized) {
      const ok = await this.initialize();
      if (!ok) throw new Error('BLE not available: ' + (this.initError?.message || 'unknown'));
    }

    if (this.state === STATE.SCANNING) {
      if (!silent) log('Already scanning');
      return;
    }

    const state = this.backend.getState();
    if (state !== 'poweredOn') {
      throw new Error('Bluetooth is not powered on (state: ' + state + ')');
    }

    this.state = STATE.SCANNING;
    this.discoveredDevices.clear();
    this._silentScan = silent;

    if (!silent) log('Starting BLE scan for', duration, 'ms');
    this.emit('scanStarted');

    try {
      await this.backend.startScanning(duration);
    } catch (err) {
      this.state = STATE.IDLE;
      logError('Failed to start scanning:', err.message);
      throw err;
    }

    // Stop after duration
    setTimeout(() => {
      this.stopScan().catch((err) => {
        logError('Failed to stop scan:', err.message);
      });
    }, duration);
  }

  async stopScan() {
    if (this.state !== STATE.SCANNING) return;

    const silent = this._silentScan;
    this._silentScan = false;

    // Set state to IDLE before stopping
    this.state = STATE.IDLE;

    await this.backend.stopScanning();

    if (!silent) log('Scan stopped, found', this.discoveredDevices.size, 'devices');
    this.emit('scanStopped', [...this.discoveredDevices.values()].map(d => ({
      id: d.id,
      name: d.name,
      address: d.address,
      rssi: d.rssi
    })));
  }

  getDiscoveredDevices() {
    return [...this.discoveredDevices.values()].map(d => ({
      id: d.id,
      name: d.name,
      address: d.address,
      rssi: d.rssi
    }));
  }

  async connect(deviceId) {
    if (this.state === STATE.CONNECTED) {
      await this.disconnect();
    }

    const device = this.discoveredDevices.get(deviceId);
    if (!device) {
      throw new Error('Device not found. Run scan first.');
    }

    this.state = STATE.CONNECTING;
    log('Connecting to', device.name);
    this.emit('connecting', { id: deviceId, name: device.name });

    try {
      this.connection = await this.backend.connect(deviceId);

      this.connectedDevice = {
        id: deviceId,
        name: this.connection.name,
        address: this.connection.address
      };
      this.state = STATE.CONNECTED;
      this.receiveBuffer = '';

      log('Connected to pendant:', this.connectedDevice.name);

      // Stop auto-reconnect since we're now connected
      this.stopAutoReconnect();

      // Save for auto-reconnect
      this.saveLastConnectedDevice(this.connectedDevice);

      this.emit('connected', {
        id: deviceId,
        name: this.connectedDevice.name,
        address: this.connectedDevice.address
      });

      return true;
    } catch (err) {
      this.state = STATE.IDLE;
      this.connectedDevice = null;
      this.connection = null;
      logError('Connection failed:', err.message);
      this.emit('connectionFailed', { id: deviceId, error: err.message });
      throw err;
    }
  }

  handleIncomingData(data) {
    // Append to buffer (BLE may fragment messages)
    this.receiveBuffer += data.toString('utf8');

    // Process complete JSON messages (newline-delimited)
    let newlineIndex;
    while ((newlineIndex = this.receiveBuffer.indexOf('\n')) !== -1) {
      const jsonStr = this.receiveBuffer.slice(0, newlineIndex);
      this.receiveBuffer = this.receiveBuffer.slice(newlineIndex + 1);

      if (jsonStr.trim()) {
        try {
          const message = JSON.parse(jsonStr);
          this.emit('message', message);
        } catch (err) {
          logError('Failed to parse BLE message:', err.message, jsonStr);
        }
      }
    }
  }

  handleDisconnect() {
    const wasConnected = this.state === STATE.CONNECTED;
    const device = this.connectedDevice;

    this.state = STATE.IDLE;
    this.connectedDevice = null;
    this.connection = null;
    this.receiveBuffer = '';

    // Clear send queue and reject pending sends
    while (this.sendQueue.length > 0) {
      const { reject } = this.sendQueue.shift();
      reject(new Error('Disconnected'));
    }
    this.isSending = false;

    if (wasConnected) {
      log('Pendant disconnected:', device?.name);
      this.emit('disconnected', {
        id: device?.id,
        name: device?.name
      });

      // Start auto-reconnect if we have a saved device
      this.startAutoReconnect();
    }
  }

  async disconnect() {
    if (!this.connectedDevice) return;

    this.state = STATE.DISCONNECTING;
    log('Disconnecting from', this.connectedDevice.name);

    await this.backend.disconnect(this.connection);
    this.handleDisconnect();
  }

  async send(message, { withoutResponse = false } = {}) {
    if (this.state !== STATE.CONNECTED || !this.connection) {
      throw new Error('Not connected to pendant');
    }

    // Add to queue and process
    return new Promise((resolve, reject) => {
      // For state updates, replace any existing queued state update (keeps only latest)
      if (message?.type === 'server-state-updated') {
        const newStatus = message?.data?.senderStatus;
        const existingIndex = this.sendQueue.findIndex(item => {
          if (item.message?.type !== 'server-state-updated') return false;
          const oldStatus = item.message?.data?.senderStatus;
          return oldStatus === newStatus;
        });
        if (existingIndex !== -1) {
          this.sendQueue[existingIndex].resolve();
          this.sendQueue[existingIndex] = { message, withoutResponse, resolve, reject };
          this.processSendQueue();
          return;
        }
      }

      this.sendQueue.push({ message, withoutResponse, resolve, reject });
      this.processSendQueue();
    });
  }

  async processSendQueue() {
    if (this.isSending || this.sendQueue.length === 0) {
      return;
    }

    this.isSending = true;

    while (this.sendQueue.length > 0) {
      const { message, withoutResponse, resolve, reject } = this.sendQueue.shift();

      if (this.state !== STATE.CONNECTED || !this.connection) {
        reject(new Error('Not connected to pendant'));
        continue;
      }

      try {
        await this.sendImmediate(message, withoutResponse);
        resolve();
      } catch (err) {
        reject(err);
      }
    }

    this.isSending = false;
  }

  async sendImmediate(message, withoutResponse = false) {
    const jsonStr = JSON.stringify(message) + '\n';
    const data = Buffer.from(jsonStr, 'utf8');

    // BLE has MTU limits, chunk if needed
    const chunkSize = 200;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
      await this.backend.write(this.connection, chunk);
    }
  }

  isConnected() {
    return this.state === STATE.CONNECTED;
  }

  async requestInfo(timeout = 5000) {
    if (this.state !== STATE.CONNECTED) {
      throw new Error('Not connected to pendant');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('message', onMessage);
        reject(new Error('Timeout waiting for pendant info'));
      }, timeout);

      const onMessage = (message) => {
        if (message.type === 'pendant:info') {
          clearTimeout(timer);
          this.removeListener('message', onMessage);
          resolve(message.data);
        }
      };

      this.on('message', onMessage);

      this.send({ type: 'pendant:get-info' }).catch((err) => {
        clearTimeout(timer);
        this.removeListener('message', onMessage);
        reject(err);
      });
    });
  }

  getConnectedDevice() {
    if (!this.connectedDevice || this.state !== STATE.CONNECTED || !this.connection) {
      return null;
    }
    return {
      id: this.connectedDevice.id,
      name: this.connectedDevice.name,
      address: this.connectedDevice.address
    };
  }

  getState() {
    return this.state;
  }

  // Auto-connect functionality

  saveLastConnectedDevice(device) {
    if (!device) return;

    try {
      saveSettings({
        blePendant: {
          autoConnect: true,
          lastDevice: {
            id: device.id,
            name: device.name,
            address: device.address
          }
        }
      });
      log('Saved pendant for auto-connect:', device.name);
    } catch (err) {
      logError('Failed to save pendant settings:', err.message);
    }
  }

  getLastConnectedDevice() {
    try {
      const blePendant = getSetting('blePendant');
      if (blePendant?.autoConnect && blePendant?.lastDevice) {
        return blePendant.lastDevice;
      }
    } catch (err) {
      logError('Failed to read pendant settings:', err.message);
    }
    return null;
  }

  isAutoConnectEnabled() {
    try {
      const blePendant = getSetting('blePendant');
      return blePendant?.autoConnect !== false;
    } catch {
      return true;
    }
  }

  async autoConnect() {
    if (!this.isAutoConnectEnabled()) {
      return false;
    }

    const lastDevice = this.getLastConnectedDevice();
    if (!lastDevice) {
      return false;
    }

    log('Auto-connect: starting for', lastDevice.name);

    // Initialize BLE in background
    this.initialize().catch(() => {});

    // Start polling immediately
    this.startAutoReconnect();
    return false;
  }

  clearLastConnectedDevice() {
    try {
      this.stopAutoReconnect();
      saveSettings({
        blePendant: {
          autoConnect: false,
          lastDevice: null
        }
      });
      log('Cleared auto-connect pendant');
    } catch (err) {
      logError('Failed to clear pendant settings:', err.message);
    }
  }

  startAutoReconnect() {
    if (this.autoReconnectTimer) return;
    if (!this.isAutoConnectEnabled()) return;
    if (!this.getLastConnectedDevice()) return;

    log('Auto-reconnect: starting background polling every', AUTO_RECONNECT_INTERVAL, 'ms');
    this.autoReconnectRunning = true;

    setImmediate(async () => {
      if (this.state === STATE.IDLE && !this.isConnected()) {
        try {
          await this.attemptReconnect();
        } catch (err) {
          // Ignore - interval will retry
        }
      }
    });

    this.autoReconnectTimer = setInterval(async () => {
      if (this.state !== STATE.IDLE) return;
      if (this.isConnected()) {
        this.stopAutoReconnect();
        return;
      }

      try {
        await this.attemptReconnect();
      } catch (err) {
        // Silently ignore
      }
    }, AUTO_RECONNECT_INTERVAL);
  }

  stopAutoReconnect() {
    if (this.autoReconnectTimer) {
      clearInterval(this.autoReconnectTimer);
      this.autoReconnectTimer = null;
      this.autoReconnectRunning = false;
    }
  }

  async attemptReconnect() {
    const lastDevice = this.getLastConnectedDevice();
    if (!lastDevice) return false;

    try {
      const ok = await this.initialize();
      if (!ok) return false;

      const ready = await this.waitForPoweredOn(500);
      if (!ready) return false;

      // Try to get device from backend cache
      let cachedDevice = this.backend.getPeripheralFromCache(lastDevice.id);

      // Also check by address
      if (!cachedDevice && lastDevice.address) {
        cachedDevice = this.backend.getPeripheralFromCache(lastDevice.address);
      }

      if (!cachedDevice) {
        // Device not in cache - do a quick scan
        cachedDevice = await this.scanAndFindDevice(lastDevice);
        if (!cachedDevice) {
          return false;
        }
      }

      // Connect to the device
      return await this.connectToFoundDevice(cachedDevice, lastDevice);
    } catch (err) {
      this.state = STATE.IDLE;
      this.connection = null;
      return false;
    }
  }

  async scanAndFindDevice(targetDevice) {
    return new Promise(async (resolve) => {
      let found = false;
      let scanTimeout = null;

      const onDiscover = (device) => {
        const isTarget = device.id === targetDevice.id ||
                        device.address === targetDevice.address ||
                        device.name === targetDevice.name;

        if (isTarget && !found) {
          found = true;
          if (scanTimeout) clearTimeout(scanTimeout);
          this.backend.removeListener('discover', onDiscover);
          this.stopScan().catch(() => {});
          resolve(device);
        }
      };

      this.backend.on('discover', onDiscover);

      try {
        this.state = STATE.SCANNING;
        this._silentScan = true;

        await this.backend.startScanning(AUTO_RECONNECT_SCAN_DURATION);

        scanTimeout = setTimeout(() => {
          if (!found) {
            this.backend.removeListener('discover', onDiscover);
            this.stopScan().catch(() => {});
            resolve(null);
          }
        }, AUTO_RECONNECT_SCAN_DURATION);

      } catch (err) {
        this.backend.removeListener('discover', onDiscover);
        this.state = STATE.IDLE;
        resolve(null);
      }
    });
  }

  async connectToFoundDevice(device, deviceInfo) {
    this.state = STATE.CONNECTING;

    try {
      // Store in discovered devices for connect() to find
      this.discoveredDevices.set(device.id || deviceInfo.id, {
        id: device.id || deviceInfo.id,
        name: device.name || deviceInfo.name,
        address: device.address || deviceInfo.address,
        rssi: device.rssi || 0,
        _backendDevice: device
      });

      this.connection = await this.backend.connectToPeripheral(device._backendDevice || device);

      this.connectedDevice = {
        id: deviceInfo.id,
        name: this.connection.name || deviceInfo.name,
        address: this.connection.address || deviceInfo.address
      };
      this.state = STATE.CONNECTED;
      this.receiveBuffer = '';

      log('Auto-reconnect: connected to', this.connectedDevice.name);

      this.stopAutoReconnect();
      this.saveLastConnectedDevice(this.connectedDevice);

      this.emit('connected', {
        id: deviceInfo.id,
        name: this.connectedDevice.name,
        address: this.connectedDevice.address
      });

      return true;
    } catch (err) {
      this.state = STATE.IDLE;
      this.connection = null;
      throw err;
    }
  }
}

// Singleton instance
export const blePendantManager = new BLEPendantManager();
