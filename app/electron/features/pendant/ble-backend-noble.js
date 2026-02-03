/*
 * Noble BLE Backend
 *
 * Uses @stoprocent/noble for BLE on macOS and Windows.
 * This backend requires raw HCI socket access on Linux (not recommended).
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('BLE-Noble');

// Nordic UART Service UUIDs (without dashes, lowercase)
const NUS_SERVICE_UUID = '6e400001b5a3f393e0a9e50e24dcca9e';
const NUS_TX_CHAR_UUID = '6e400003b5a3f393e0a9e50e24dcca9e';
const NUS_RX_CHAR_UUID = '6e400002b5a3f393e0a9e50e24dcca9e';

export class NobleBackend extends EventEmitter {
  constructor() {
    super();
    this.noble = null;
    this.isInitialized = false;
    this.initError = null;
    this._peripherals = new Map();
  }

  async initialize() {
    if (this.isInitialized) return true;
    if (this.initError) return false;

    try {
      const nobleModule = await import('@stoprocent/noble');
      this.noble = nobleModule.default || nobleModule;

      this.noble.on('error', (err) => {
        logError('Noble error:', err.message);
        this.emit('error', err);
      });

      this.noble.on('warning', (msg) => {
        log('Noble warning:', msg);
      });

      this.noble.on('stateChange', (state) => {
        log('Adapter state:', state);
        this.emit('stateChange', state);
      });

      this.noble.on('discover', (peripheral) => {
        this._handleDiscovery(peripheral);
      });

      this.noble.on('scanStop', () => {
        this.emit('scanStop');
      });

      this.isInitialized = true;
      log('Noble backend initialized');
      return true;
    } catch (err) {
      this.initError = err;
      logError('Failed to initialize:', err.message);
      return false;
    }
  }

  getState() {
    if (!this.noble) return 'uninitialized';
    try {
      return this.noble.state;
    } catch {
      return 'unknown';
    }
  }

  _handleDiscovery(peripheral) {
    const name = peripheral.advertisement?.localName || peripheral.address;
    const serviceUuids = peripheral.advertisement?.serviceUuids || [];

    const hasNUS = serviceUuids.some(
      uuid => uuid.toLowerCase().replace(/-/g, '') === NUS_SERVICE_UUID
    );

    if (!hasNUS) return;

    this._peripherals.set(peripheral.id, peripheral);

    this.emit('discover', {
      id: peripheral.id,
      name,
      address: peripheral.address,
      rssi: peripheral.rssi,
      _peripheral: peripheral
    });
  }

  async startScanning(duration) {
    if (!this.noble || this.noble.state !== 'poweredOn') {
      throw new Error('Bluetooth not ready (state: ' + this.getState() + ')');
    }

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
  }

  async stopScanning() {
    if (!this.noble) return;

    try {
      if (typeof this.noble.stopScanningAsync === 'function') {
        await this.noble.stopScanningAsync();
      } else {
        this.noble.stopScanning();
      }
    } catch (err) {
      logError('Error stopping scan:', err.message);
    }
  }

  async connect(deviceId) {
    const peripheral = this._peripherals.get(deviceId);
    if (!peripheral) {
      throw new Error('Device not found');
    }

    await peripheral.connectAsync();

    const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [NUS_SERVICE_UUID],
      [NUS_TX_CHAR_UUID, NUS_RX_CHAR_UUID]
    );

    let txChar = null;
    let rxChar = null;

    for (const char of characteristics) {
      const uuid = char.uuid.toLowerCase().replace(/-/g, '');
      if (uuid === NUS_TX_CHAR_UUID) txChar = char;
      else if (uuid === NUS_RX_CHAR_UUID) rxChar = char;
    }

    if (!txChar || !rxChar) {
      await peripheral.disconnectAsync();
      throw new Error('NUS characteristics not found');
    }

    // Set up notification handler
    txChar.on('data', (data) => {
      this.emit('data', data);
    });

    await txChar.subscribeAsync();

    // Handle disconnect
    peripheral.once('disconnect', () => {
      this.emit('disconnect');
    });

    return {
      id: deviceId,
      name: peripheral.advertisement?.localName || peripheral.address,
      address: peripheral.address,
      _peripheral: peripheral,
      _txChar: txChar,
      _rxChar: rxChar
    };
  }

  async disconnect(connection) {
    if (!connection?._peripheral) return;

    try {
      if (connection._txChar) {
        await connection._txChar.unsubscribeAsync();
      }
      await connection._peripheral.disconnectAsync();
    } catch (err) {
      logError('Disconnect error:', err.message);
    }
  }

  async write(connection, data) {
    if (!connection?._rxChar) {
      throw new Error('Not connected');
    }
    await connection._rxChar.writeAsync(data, false);
  }

  getPeripheralFromCache(deviceId) {
    return this._peripherals.get(deviceId) || this.noble?._peripherals?.[deviceId];
  }

  async connectToPeripheral(peripheral) {
    await peripheral.connectAsync();

    const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [NUS_SERVICE_UUID],
      [NUS_TX_CHAR_UUID, NUS_RX_CHAR_UUID]
    );

    let txChar = null;
    let rxChar = null;

    for (const char of characteristics) {
      const uuid = char.uuid.toLowerCase().replace(/-/g, '');
      if (uuid === NUS_TX_CHAR_UUID) txChar = char;
      else if (uuid === NUS_RX_CHAR_UUID) rxChar = char;
    }

    if (!txChar || !rxChar) {
      await peripheral.disconnectAsync();
      throw new Error('NUS characteristics not found');
    }

    txChar.on('data', (data) => {
      this.emit('data', data);
    });

    await txChar.subscribeAsync();

    peripheral.once('disconnect', () => {
      this.emit('disconnect');
    });

    return {
      id: peripheral.id,
      name: peripheral.advertisement?.localName || peripheral.address,
      address: peripheral.address,
      _peripheral: peripheral,
      _txChar: txChar,
      _rxChar: rxChar
    };
  }

  destroy() {
    this._peripherals.clear();
    this.removeAllListeners();
  }
}
