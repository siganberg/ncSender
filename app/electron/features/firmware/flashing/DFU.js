/**
 * USB DFU (Device Firmware Update) Protocol Handler
 *
 * Implements USB DFU 1.1 with ST DfuSe extensions for STM32 microcontrollers.
 * Reference: USB DFU Class Specification 1.1, ST AN3156
 */

import { findByIds, WebUSBDevice } from 'usb';

const log = (...args) => console.log(`[${new Date().toISOString()}] [DFU]`, ...args);

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// USB DFU Class Request Codes (per DFU 1.1 spec)
const DFU_REQUEST = {
  DETACH: 0x00,
  DNLOAD: 0x01,
  UPLOAD: 0x02,
  GETSTATUS: 0x03,
  CLRSTATUS: 0x04,
  GETSTATE: 0x05,
  ABORT: 0x06
};

// USB DFU Device States (per DFU 1.1 spec)
const DFU_STATE = {
  APP_IDLE: 0,
  APP_DETACH: 1,
  IDLE: 2,
  DNLOAD_SYNC: 3,
  DNBUSY: 4,
  DNLOAD_IDLE: 5,
  MANIFEST_SYNC: 6,
  MANIFEST: 7,
  MANIFEST_WAIT_RESET: 8,
  UPLOAD_IDLE: 9,
  ERROR: 10
};

// USB DFU Status Codes
const DFU_STATUS = {
  OK: 0x00,
  ERR_TARGET: 0x01,
  ERR_FILE: 0x02,
  ERR_WRITE: 0x03,
  ERR_ERASE: 0x04,
  ERR_CHECK_ERASED: 0x05,
  ERR_PROG: 0x06,
  ERR_VERIFY: 0x07,
  ERR_ADDRESS: 0x08,
  ERR_NOTDONE: 0x09,
  ERR_FIRMWARE: 0x0A,
  ERR_VENDOR: 0x0B,
  ERR_USBR: 0x0C,
  ERR_POR: 0x0D,
  ERR_UNKNOWN: 0x0E,
  ERR_STALLEDPKT: 0x0F
};

// ST DfuSe Command Codes
const DFUSE_CMD = {
  SET_ADDRESS: 0x21,
  ERASE_SECTOR: 0x41
};

// STMicroelectronics DFU Device Identifiers
const STM32_DFU_VID = 0x0483;
const STM32_DFU_PID = 0xDF11;

class USBDFUDevice {
  constructor() {
    this.device = null;
    this.iface = null;
    this.memoryLayout = null;
    this.timeout = 8000;
  }

  /**
   * Parse ST DfuSe memory layout descriptor string
   * Format: @name/0xADDRESS/sectors*size[BKM][rwea],...
   */
  parseMemoryLayout(descriptor) {
    if (!descriptor || !descriptor.startsWith('@')) {
      throw new Error('Invalid memory descriptor format');
    }

    const nameEnd = descriptor.indexOf('/');
    const name = descriptor.substring(1, nameEnd).trim();
    const rest = descriptor.substring(nameEnd);

    const regions = [];
    const regionPattern = /\/\s*(0x[0-9a-fA-F]+)\s*\/([^/]+)/g;
    let match;

    while ((match = regionPattern.exec(rest))) {
      let baseAddr = parseInt(match[1], 16);
      const sectorDefs = match[2];

      // Parse sector definitions: "count*size[BKM][rwea]"
      const sectorPattern = /(\d+)\s*\*\s*(\d+)\s*([BKM ])\s*([a-g])/g;
      let sectorMatch;

      while ((sectorMatch = sectorPattern.exec(sectorDefs))) {
        const count = parseInt(sectorMatch[1], 10);
        const sizeNum = parseInt(sectorMatch[2], 10);
        const sizeUnit = sectorMatch[3];
        const props = sectorMatch[4].charCodeAt(0) - 'a'.charCodeAt(0) + 1;

        const multiplier = sizeUnit === 'K' ? 1024 : sizeUnit === 'M' ? 1048576 : 1;
        const sectorSize = sizeNum * multiplier;

        regions.push({
          start: baseAddr,
          end: baseAddr + (sectorSize * count),
          sectorSize,
          canRead: (props & 0x1) !== 0,
          canErase: (props & 0x2) !== 0,
          canWrite: (props & 0x4) !== 0
        });

        baseAddr += sectorSize * count;
      }
    }

    this.memoryLayout = { name, regions };
    log('Memory layout parsed:', name, regions.length, 'regions');
    return this.memoryLayout;
  }

  /**
   * Find memory region containing the given address
   */
  findRegion(address) {
    if (!this.memoryLayout) return null;
    return this.memoryLayout.regions.find(r => address >= r.start && address < r.end);
  }

  /**
   * Connect to STM32 device in DFU mode
   */
  async connect() {
    const rawDevice = findByIds(STM32_DFU_VID, STM32_DFU_PID);
    if (!rawDevice) {
      throw new Error(`No STM32 DFU device found. Ensure device is in DFU/bootloader mode.`);
    }

    rawDevice.timeout = this.timeout;

    this.device = await WebUSBDevice.createInstance(rawDevice);
    await this.device.open();
    await wait(400);

    const config = this.device.configurations?.[0];
    this.iface = config?.interfaces?.[0];

    if (!this.iface) {
      throw new Error('DFU interface not found on device');
    }

    const alt = this.iface.alternates[0];
    if (alt.interfaceName) {
      this.parseMemoryLayout(alt.interfaceName);
    }

    await this.device.selectConfiguration(config.configurationValue);
    await this.device.claimInterface(this.iface.interfaceNumber);
    await this.device.selectAlternateInterface(0, alt.alternateSetting);

    log('Connected to DFU device');
  }

  /**
   * Disconnect from device
   */
  async disconnect() {
    if (this.device) {
      try {
        await this.device.close();
        log('Disconnected from DFU device');
      } catch (e) {
        log('Disconnect warning:', e.message);
      }
      this.device = null;
    }
  }

  /**
   * Send control transfer IN request
   */
  async controlIn(request, length, value = 0) {
    const result = await this.device.controlTransferIn({
      requestType: 'class',
      recipient: 'interface',
      request,
      value,
      index: this.iface.interfaceNumber
    }, length);

    if (result.status !== 'ok') {
      throw new Error(`Control IN failed: ${result.status}`);
    }
    return result.data;
  }

  /**
   * Send control transfer OUT request
   */
  async controlOut(request, data, value = 0) {
    const result = await this.device.controlTransferOut({
      requestType: 'class',
      recipient: 'interface',
      request,
      value,
      index: 0
    }, data);

    if (result.status !== 'ok') {
      throw new Error(`Control OUT failed: ${result.status}`);
    }
    return result.bytesWritten;
  }

  /**
   * Get device status (DFU_GETSTATUS)
   */
  async getStatus() {
    const data = await this.controlIn(DFU_REQUEST.GETSTATUS, 6);
    return {
      status: data.getUint8(0),
      pollTimeout: data.getUint32(1, true) & 0xFFFFFF,
      state: data.getUint8(4)
    };
  }

  /**
   * Get current device state (DFU_GETSTATE)
   */
  async getState() {
    const data = await this.controlIn(DFU_REQUEST.GETSTATE, 1);
    return data.getUint8(0);
  }

  /**
   * Clear error status (DFU_CLRSTATUS)
   */
  async clearStatus() {
    return this.controlOut(DFU_REQUEST.CLRSTATUS);
  }

  /**
   * Abort current operation (DFU_ABORT)
   */
  async abort() {
    return this.controlOut(DFU_REQUEST.ABORT);
  }

  /**
   * Download data block (DFU_DNLOAD)
   */
  async downloadBlock(data, blockNum) {
    return this.controlOut(DFU_REQUEST.DNLOAD, data, blockNum);
  }

  /**
   * Wait until device reaches expected state
   */
  async waitForState(checkFn) {
    let status = await this.getStatus();

    while (!checkFn(status.state) && status.state !== DFU_STATE.ERROR) {
      await wait(status.pollTimeout || 10);
      status = await this.getStatus();
    }

    return status;
  }

  /**
   * Reset device to idle state
   */
  async resetToIdle() {
    await this.abort();
    let state = await this.getState();

    if (state === DFU_STATE.ERROR) {
      await this.clearStatus();
      state = await this.getState();
    }

    if (state !== DFU_STATE.IDLE) {
      throw new Error(`Failed to reset to idle. Current state: ${state}`);
    }
  }

  /**
   * Send DfuSe command (SET_ADDRESS or ERASE_SECTOR)
   */
  async sendCommand(cmd, address) {
    const payload = new ArrayBuffer(5);
    const view = new DataView(payload);
    view.setUint8(0, cmd);
    view.setUint32(1, address, true);

    await this.downloadBlock(payload, 0);
    const status = await this.waitForState(s => s !== DFU_STATE.DNBUSY);

    if (status.status !== DFU_STATUS.OK) {
      throw new Error(`DfuSe command 0x${cmd.toString(16)} failed at 0x${address.toString(16)}`);
    }
  }

  /**
   * Set download address pointer
   */
  async setAddress(address) {
    await this.sendCommand(DFUSE_CMD.SET_ADDRESS, address);
    await this.getStatus();
  }

  /**
   * Erase flash sector at address
   */
  async eraseSector(address) {
    await this.sendCommand(DFUSE_CMD.ERASE_SECTOR, address);
    await this.getStatus();
  }
}

// Export class and constants
export default USBDFUDevice;
export { DFU_STATE, DFU_STATUS, DFUSE_CMD };
