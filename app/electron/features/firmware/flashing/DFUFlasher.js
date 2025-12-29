/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * STM32 Firmware Flasher via USB DFU
 *
 * Orchestrates the firmware update process:
 * - Parses Intel HEX firmware files
 * - Erases required flash sectors
 * - Programs firmware data in chunks
 * - Triggers device reset to run new firmware
 */

import USBDFUDevice, { DFU_STATE, DFU_STATUS, DFUSE_CMD } from './DFU.js';
import hexParser from 'nrf-intel-hex';
import { EventEmitter } from 'events';
import { createLogger } from '../../../core/logger.js';

const { log, error: logError } = createLogger('DFUFlasher');

const CHUNK_SIZE = 2048; // Bytes per transfer

class FirmwareFlasher extends EventEmitter {
  constructor({ hex }) {
    super();
    this.hexData = hex;
    this.dfu = new USBDFUDevice();
    this.firmware = null;
  }

  /**
   * Parse Intel HEX file into memory map
   */
  parseHexFile() {
    try {
      const hexString = Buffer.from(this.hexData, 'utf-8').toString();
      this.firmware = hexParser.fromHex(hexString);
      return this.firmware;
    } catch (err) {
      throw new Error(`HEX parse error: ${err.message}`);
    }
  }

  /**
   * Calculate sector boundaries for an address
   */
  getSectorBounds(addr, region) {
    const sectorIdx = Math.floor((addr - region.start) / region.sectorSize);
    return {
      start: region.start + (sectorIdx * region.sectorSize),
      end: region.start + ((sectorIdx + 1) * region.sectorSize)
    };
  }

  /**
   * Erase flash memory covering the firmware range
   */
  async eraseFlash(startAddr, size) {
    this.emit('info', `Erasing ${size} bytes starting at 0x${startAddr.toString(16)}`);

    const region = this.dfu.findRegion(startAddr);
    if (!region) {
      throw new Error(`No memory region found for address 0x${startAddr.toString(16)}`);
    }

    const bounds = this.getSectorBounds(startAddr, region);
    let currentAddr = bounds.start;
    const endAddr = this.getSectorBounds(startAddr + size - 1, region).end;

    const totalBytes = endAddr - currentAddr;
    let erasedBytes = 0;

    while (currentAddr < endAddr) {
      const currentRegion = this.dfu.findRegion(currentAddr);

      if (!currentRegion) {
        currentAddr += region.sectorSize;
        continue;
      }

      if (!currentRegion.canErase) {
        erasedBytes = Math.min(erasedBytes + currentRegion.end - currentAddr, totalBytes);
        currentAddr = currentRegion.end;
        this.emit('progress', erasedBytes, totalBytes);
        continue;
      }

      const sector = this.getSectorBounds(currentAddr, currentRegion);
      this.emit('info', `Erasing sector at 0x${sector.start.toString(16)}`);

      await this.dfu.eraseSector(sector.start);

      currentAddr = sector.end;
      erasedBytes += currentRegion.sectorSize;
      this.emit('progress', Math.min(erasedBytes, totalBytes), totalBytes);
    }

    this.emit('info', 'Erase complete');
  }

  /**
   * Write firmware data to flash in chunks
   */
  async writeData(startAddr, data) {
    const totalSize = data.byteLength;
    let offset = 0;
    let addr = startAddr;

    while (offset < totalSize) {
      const remaining = totalSize - offset;
      const chunkSize = Math.min(remaining, CHUNK_SIZE);
      const chunk = data.slice(offset, offset + chunkSize);

      await this.dfu.setAddress(addr);
      await this.dfu.downloadBlock(chunk, 2);

      const status = await this.dfu.waitForState(s => s === DFU_STATE.DNLOAD_IDLE);
      if (status.status !== DFU_STATUS.OK) {
        throw new Error(`Write failed at 0x${addr.toString(16)}: status=${status.status}`);
      }

      offset += chunkSize;
      addr += chunkSize;
      this.emit('progress', offset, totalSize);
    }

    log(`Wrote ${totalSize} bytes`);
  }

  /**
   * Finalize flash and reset device
   */
  async finalize(startAddr) {
    this.emit('info', 'Finalizing and resetting device...');

    await this.dfu.resetToIdle();
    await this.dfu.setAddress(startAddr);
    await this.dfu.downloadBlock(new ArrayBuffer(0), 0);

    try {
      await this.dfu.waitForState(s => s === DFU_STATE.MANIFEST);
    } catch (e) {
      // Device may disconnect during manifest - this is normal
      log('Device reset (expected disconnect)');
    }
  }

  /**
   * Execute full flash process
   */
  async flash() {
    try {
      // Connect to device
      this.emit('info', 'Connecting to DFU device...');
      await this.dfu.connect();
      this.emit('info', 'Connected');

      // Parse firmware file
      this.emit('info', 'Parsing firmware file...');
      this.parseHexFile();

      // Calculate firmware size and start address
      let firstAddr = null;
      let totalSize = 0;

      for (const [addr, block] of this.firmware) {
        if (firstAddr === null) firstAddr = addr;
        totalSize += block.byteLength;
      }

      this.emit('info', `Firmware: ${totalSize} bytes at 0x${firstAddr.toString(16)}`);

      // Reset device to idle state
      await this.dfu.resetToIdle();
      this.emit('info', 'Device ready');

      // Erase required sectors
      await this.eraseFlash(firstAddr, totalSize);

      // Program firmware blocks
      for (const [addr, block] of this.firmware) {
        this.emit('info', `Programming 0x${addr.toString(16)} (${block.byteLength} bytes)`);
        await this.writeData(addr, block);
      }

      // Finalize and reset
      await this.finalize(firstAddr);

      this.emit('info', 'Firmware update complete!');
      this.emit('end');

    } catch (err) {
      this.emit('error', err.message);
      throw err;

    } finally {
      await this.dfu.disconnect();
    }
  }
}

export default FirmwareFlasher;
