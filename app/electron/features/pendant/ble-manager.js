/*
 * BLE Pendant Manager
 *
 * Handles Bluetooth Low Energy connections to ncSender pendants.
 * Uses Nordic UART Service (NUS) for bidirectional JSON communication.
 * Supports auto-connect to previously paired devices.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../core/logger.js';
import { getSetting, saveSettings } from '../../core/settings-manager.js';

const { log, error: logError } = createLogger('BLE');

// Nordic UART Service UUIDs
const NUS_SERVICE_UUID = '6e400001b5a3f393e0a9e50e24dcca9e';
const NUS_TX_CHAR_UUID = '6e400003b5a3f393e0a9e50e24dcca9e'; // Pendant -> Host (notifications)
const NUS_RX_CHAR_UUID = '6e400002b5a3f393e0a9e50e24dcca9e'; // Host -> Pendant (write)

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
    this.noble = null;
    this.state = STATE.IDLE;
    this.connectedDevice = null;
    this.txCharacteristic = null;
    this.rxCharacteristic = null;
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
      // Dynamic import to handle platforms without BLE support
      // Wrap in Promise to catch any synchronous throws during import
      let noble;
      try {
        const nobleModule = await import('@abandonware/noble');
        noble = nobleModule.default || nobleModule;
      } catch (importErr) {
        logError('Failed to import noble:', importErr.message);
        this.initError = importErr;
        return false;
      }

      this.noble = noble;

      // CRITICAL: Handle error events to prevent process crash
      this.noble.on('error', (err) => {
        logError('Noble error:', err.message);
        this.emit('error', err);
      });

      this.noble.on('warning', (msg) => {
        log('Noble warning:', msg);
      });

      this.noble.on('stateChange', (state) => {
        log('Bluetooth adapter state:', state);
        this.emit('adapterState', state);

        if (state === 'poweredOn') {
          this.emit('ready');
        } else if (state === 'poweredOff') {
          this.emit('disabled');
        }
      });

      this.noble.on('discover', (peripheral) => {
        this.handleDiscovery(peripheral);
      });

      // Handle scan stop event
      this.noble.on('scanStop', () => {
        if (this.state === STATE.SCANNING) {
          this.state = STATE.IDLE;
          if (!this._silentScan) {
            log('Scan stopped by adapter');
          }
        }
      });

      this.isInitialized = true;

      // On macOS, accessing noble.state can trigger native code
      // Wrap in try/catch to prevent crash
      let currentState = 'unknown';
      try {
        currentState = this.noble.state;
      } catch (stateErr) {
        logError('Failed to get noble state:', stateErr.message);
      }

      log('BLE manager initialized, current state:', currentState);

      // On macOS, if state is 'unknown', it might need a moment
      // The stateChange event will fire when ready
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
    if (!this.noble) return 'uninitialized';
    try {
      return this.noble.state;
    } catch {
      return 'unknown';
    }
  }

  async waitForPoweredOn(timeout = 5000) {
    try {
      if (!this.isInitialized) {
        const ok = await this.initialize();
        if (!ok) return false;
      }

      if (!this.noble) return false;

      if (this.noble.state === 'poweredOn') {
        return true;
      }

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.noble.removeListener('stateChange', checkState);
          resolve(false);
        }, timeout);

        const checkState = (state) => {
          if (state === 'poweredOn') {
            clearTimeout(timer);
            this.noble.removeListener('stateChange', checkState);
            resolve(true);
          } else if (state === 'poweredOff' || state === 'unauthorized' || state === 'unsupported') {
            clearTimeout(timer);
            this.noble.removeListener('stateChange', checkState);
            resolve(false);
          }
        };

        this.noble.on('stateChange', checkState);
      });
    } catch (err) {
      logError('Error waiting for Bluetooth:', err.message);
      return false;
    }
  }

  handleDiscovery(peripheral) {
    const name = peripheral.advertisement?.localName || peripheral.address;
    const hasNUS = peripheral.advertisement?.serviceUuids?.some(
      uuid => uuid.toLowerCase().replace(/-/g, '') === NUS_SERVICE_UUID
    );

    if (!hasNUS) return;

    const deviceInfo = {
      id: peripheral.id,
      name,
      address: peripheral.address,
      rssi: peripheral.rssi,
      peripheral
    };

    this.discoveredDevices.set(peripheral.id, deviceInfo);

    // Only log during user-initiated scans
    if (!this._silentScan) {
      log('Discovered pendant:', name, 'RSSI:', peripheral.rssi);
    }

    this.emit('deviceDiscovered', {
      id: peripheral.id,
      name,
      address: peripheral.address,
      rssi: peripheral.rssi
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

    if (this.noble.state !== 'poweredOn') {
      throw new Error('Bluetooth is not powered on (state: ' + this.noble.state + ')');
    }

    this.state = STATE.SCANNING;
    this.discoveredDevices.clear();
    this._silentScan = silent;

    if (!silent) log('Starting BLE scan for', duration, 'ms');
    this.emit('scanStarted');

    try {
      // Scan for devices advertising Nordic UART Service
      // noble API varies - try async version first, fall back to callback
      if (typeof this.noble.startScanningAsync === 'function') {
        await this.noble.startScanningAsync([NUS_SERVICE_UUID], false);
      } else {
        await new Promise((resolve, reject) => {
          this.noble.startScanning([NUS_SERVICE_UUID], false, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
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

    // Set state to IDLE before stopping to prevent scanStop event from logging
    this.state = STATE.IDLE;

    try {
      if (typeof this.noble.stopScanningAsync === 'function') {
        await this.noble.stopScanningAsync();
      } else {
        this.noble.stopScanning();
      }
    } catch (err) {
      if (!silent) logError('Error stopping scan:', err.message);
    }

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

    const peripheral = device.peripheral;

    try {
      // Connect to peripheral
      await peripheral.connectAsync();
      log('Connected to peripheral');

      // Discover services and characteristics
      const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
        [NUS_SERVICE_UUID],
        [NUS_TX_CHAR_UUID, NUS_RX_CHAR_UUID]
      );

      // Find TX and RX characteristics
      for (const char of characteristics) {
        const uuid = char.uuid.toLowerCase().replace(/-/g, '');
        if (uuid === NUS_TX_CHAR_UUID) {
          this.txCharacteristic = char;
        } else if (uuid === NUS_RX_CHAR_UUID) {
          this.rxCharacteristic = char;
        }
      }

      if (!this.txCharacteristic || !this.rxCharacteristic) {
        throw new Error('Nordic UART characteristics not found');
      }

      // Subscribe to TX notifications (data from pendant)
      this.txCharacteristic.on('data', (data) => {
        this.handleIncomingData(data);
      });

      await this.txCharacteristic.subscribeAsync();
      log('Subscribed to TX notifications');

      // Handle disconnect
      peripheral.once('disconnect', () => {
        this.handleDisconnect();
      });

      this.connectedDevice = device;
      this.state = STATE.CONNECTED;
      this.receiveBuffer = '';

      log('Connected to pendant:', device.name);

      // Stop auto-reconnect since we're now connected
      this.stopAutoReconnect();

      // Save for auto-reconnect
      this.saveLastConnectedDevice(device);

      this.emit('connected', {
        id: deviceId,
        name: device.name,
        address: device.address
      });

      return true;
    } catch (err) {
      this.state = STATE.IDLE;
      this.connectedDevice = null;
      this.txCharacteristic = null;
      this.rxCharacteristic = null;
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
    this.txCharacteristic = null;
    this.rxCharacteristic = null;
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

    try {
      if (this.txCharacteristic) {
        await this.txCharacteristic.unsubscribeAsync();
      }
      await this.connectedDevice.peripheral.disconnectAsync();
    } catch (err) {
      logError('Disconnect error:', err.message);
    }

    this.handleDisconnect();
  }

  /**
   * Queue a message to be sent. Messages are sent sequentially to prevent interleaving.
   * For state updates, newer messages replace older ones in the queue to prevent stale data.
   */
  async send(message, { withoutResponse = false } = {}) {
    if (this.state !== STATE.CONNECTED || !this.rxCharacteristic) {
      throw new Error('Not connected to pendant');
    }

    // Add to queue and process
    return new Promise((resolve, reject) => {
      // For state updates, replace any existing queued state update (keeps only latest)
      // This prevents stale position data from being sent when queue backs up
      // BUT: only replace if senderStatus is the same - status changes must be sent
      if (message?.type === 'server-state-updated') {
        const newStatus = message?.data?.senderStatus;
        const existingIndex = this.sendQueue.findIndex(item => {
          if (item.message?.type !== 'server-state-updated') return false;
          const oldStatus = item.message?.data?.senderStatus;
          // Only replace if status is the same (position-only update)
          return oldStatus === newStatus;
        });
        if (existingIndex !== -1) {
          // Resolve the old one (it's being superseded) and replace with new
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

  /**
   * Process the send queue sequentially
   */
  async processSendQueue() {
    if (this.isSending || this.sendQueue.length === 0) {
      return;
    }

    this.isSending = true;

    while (this.sendQueue.length > 0) {
      const { message, withoutResponse, resolve, reject } = this.sendQueue.shift();

      if (this.state !== STATE.CONNECTED || !this.rxCharacteristic) {
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

  /**
   * Send a message immediately (internal use only)
   */
  async sendImmediate(message, withoutResponse = false) {
    const jsonStr = JSON.stringify(message) + '\n';
    const data = Buffer.from(jsonStr, 'utf8');

    // BLE has MTU limits, chunk if needed (default ~20 bytes, negotiated higher)
    const chunkSize = 200; // Safe chunk size after MTU negotiation
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
      await this.rxCharacteristic.writeAsync(chunk, withoutResponse);
    }
  }

  isConnected() {
    return this.state === STATE.CONNECTED;
  }

  /**
   * Request pendant info and wait for response
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<object>} Pendant info object
   */
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

      // Send request
      this.send({ type: 'pendant:get-info' }).catch((err) => {
        clearTimeout(timer);
        this.removeListener('message', onMessage);
        reject(err);
      });
    });
  }

  getConnectedDevice() {
    // Only report connected if we have all required state for sending
    if (!this.connectedDevice || this.state !== STATE.CONNECTED || !this.rxCharacteristic) {
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

  /**
   * Save the connected device for auto-reconnect
   */
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

  /**
   * Get the last connected device from settings
   */
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

  /**
   * Check if auto-connect is enabled
   */
  isAutoConnectEnabled() {
    try {
      const blePendant = getSetting('blePendant');
      return blePendant?.autoConnect !== false;
    } catch {
      return true; // Default to enabled
    }
  }

  /**
   * Start auto-connect process
   * Starts background polling immediately - no blocking waits
   */
  async autoConnect() {
    if (!this.isAutoConnectEnabled()) {
      return false;
    }

    const lastDevice = this.getLastConnectedDevice();
    if (!lastDevice) {
      return false;
    }

    log('Auto-connect: starting for', lastDevice.name);

    // Initialize BLE in background (don't wait)
    this.initialize().catch(() => {});

    // Start polling immediately - it will handle connection when ready
    this.startAutoReconnect();
    return false;
  }

  /**
   * Clear saved device (disable auto-connect to this device)
   */
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

  /**
   * Start periodic auto-reconnect attempts
   * Runs in background when not connected but have a saved device
   */
  startAutoReconnect() {
    if (this.autoReconnectTimer) return;
    if (!this.isAutoConnectEnabled()) return;
    if (!this.getLastConnectedDevice()) return;

    log('Auto-reconnect: starting background polling every', AUTO_RECONNECT_INTERVAL, 'ms');
    this.autoReconnectRunning = true;

    // Do first attempt immediately instead of waiting for interval
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
      // Skip if already connected or currently scanning/connecting
      if (this.state !== STATE.IDLE) return;
      if (this.isConnected()) {
        this.stopAutoReconnect();
        return;
      }

      try {
        await this.attemptReconnect();
      } catch (err) {
        // Silently ignore - will retry on next interval
      }
    }, AUTO_RECONNECT_INTERVAL);
  }

  /**
   * Stop periodic auto-reconnect
   */
  stopAutoReconnect() {
    if (this.autoReconnectTimer) {
      clearInterval(this.autoReconnectTimer);
      this.autoReconnectTimer = null;
      this.autoReconnectRunning = false;
      // Silent - no log to avoid noise
    }
  }

  /**
   * Single reconnect attempt (used by periodic auto-reconnect)
   * Silent operation - no logs to avoid noise from frequent retries
   * Tries direct connection using noble's internal cache, or quick scan if needed
   */
  async attemptReconnect() {
    const lastDevice = this.getLastConnectedDevice();
    if (!lastDevice) return false;

    try {
      const ok = await this.initialize();
      if (!ok) return false;

      // Check if Bluetooth is ready
      const ready = await this.waitForPoweredOn(500);
      if (!ready) return false;

      // Try to get peripheral from noble's internal cache first
      let peripheral = this.noble._peripherals?.[lastDevice.id];

      if (!peripheral) {
        // Peripheral not in cache - scan and connect immediately when found
        peripheral = await this.scanAndFindDevice(lastDevice);
        if (!peripheral) {
          return false;
        }
      }

      // Check if peripheral is already connected at noble level
      // but we still need to set up our internal state
      if (peripheral.state === 'connected' && this.state === STATE.CONNECTED && this.rxCharacteristic) {
        return true;
      }

      // Try direct connection (or reconnection if noble thinks it's connected but we're not ready)
      return await this.connectToPeripheral(peripheral, lastDevice);
    } catch (err) {
      // Silently reset state on failure
      this.state = STATE.IDLE;
      this.txCharacteristic = null;
      this.rxCharacteristic = null;
      return false;
    }
  }

  /**
   * Scan for a specific device and return immediately when found
   * @returns {Promise<object|null>} The peripheral if found, null otherwise
   */
  async scanAndFindDevice(targetDevice) {
    return new Promise(async (resolve) => {
      let found = false;
      let scanTimeout = null;

      // Handler for when we find the target device
      const onDiscover = (peripheral) => {
        const name = peripheral.advertisement?.localName || peripheral.address;
        const hasNUS = peripheral.advertisement?.serviceUuids?.some(
          uuid => uuid.toLowerCase().replace(/-/g, '') === NUS_SERVICE_UUID
        );

        if (!hasNUS) return;

        // Check if this is our target device
        const isTarget = peripheral.id === targetDevice.id ||
                        peripheral.address === targetDevice.address ||
                        name === targetDevice.name;

        if (isTarget && !found) {
          found = true;

          // Stop scanning immediately
          if (scanTimeout) clearTimeout(scanTimeout);
          this.noble.removeListener('discover', onDiscover);
          this.stopScan().catch(() => {});

          resolve(peripheral);
        }
      };

      // Add one-shot discovery listener
      this.noble.on('discover', onDiscover);

      try {
        // Start scanning
        this.state = STATE.SCANNING;
        this._silentScan = true;

        if (typeof this.noble.startScanningAsync === 'function') {
          await this.noble.startScanningAsync([NUS_SERVICE_UUID], false);
        } else {
          await new Promise((res, rej) => {
            this.noble.startScanning([NUS_SERVICE_UUID], false, (err) => {
              if (err) rej(err);
              else res();
            });
          });
        }

        // Timeout after scan duration
        scanTimeout = setTimeout(() => {
          if (!found) {
            this.noble.removeListener('discover', onDiscover);
            this.stopScan().catch(() => {});
            resolve(null);
          }
        }, AUTO_RECONNECT_SCAN_DURATION);

      } catch (err) {
        this.noble.removeListener('discover', onDiscover);
        this.state = STATE.IDLE;
        resolve(null);
      }
    });
  }

  /**
   * Connect to a peripheral and set up characteristics
   */
  async connectToPeripheral(peripheral, deviceInfo) {
    this.state = STATE.CONNECTING;

    await peripheral.connectAsync();

    // Discover services and characteristics
    const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [NUS_SERVICE_UUID],
      [NUS_TX_CHAR_UUID, NUS_RX_CHAR_UUID]
    );

    // Find TX and RX characteristics
    for (const char of characteristics) {
      const uuid = char.uuid.toLowerCase().replace(/-/g, '');
      if (uuid === NUS_TX_CHAR_UUID) {
        this.txCharacteristic = char;
      } else if (uuid === NUS_RX_CHAR_UUID) {
        this.rxCharacteristic = char;
      }
    }

    if (!this.txCharacteristic || !this.rxCharacteristic) {
      throw new Error('Nordic UART characteristics not found');
    }

    // Subscribe to TX notifications
    this.txCharacteristic.on('data', (data) => {
      this.handleIncomingData(data);
    });

    await this.txCharacteristic.subscribeAsync();

    // Handle disconnect
    peripheral.once('disconnect', () => {
      this.handleDisconnect();
    });

    // Build device info for storage
    const device = {
      id: deviceInfo.id,
      name: peripheral.advertisement?.localName || deviceInfo.name,
      address: peripheral.address || deviceInfo.address,
      peripheral
    };

    this.connectedDevice = device;
    this.discoveredDevices.set(deviceInfo.id, device);
    this.state = STATE.CONNECTED;
    this.receiveBuffer = '';

    log('Auto-reconnect: connected to', device.name);

    this.stopAutoReconnect();
    this.saveLastConnectedDevice(device);

    this.emit('connected', {
      id: deviceInfo.id,
      name: device.name,
      address: device.address
    });

    return true;
  }
}

// Singleton instance
export const blePendantManager = new BLEPendantManager();
