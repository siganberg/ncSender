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

import { createLogger } from '../../core/logger.js';

const { log } = createLogger('YmodemSender');

const SOH = 0x01;
const STX = 0x02;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;
const C_CHAR = 0x43; // 'C'

const BLOCK_128 = 128;
const BLOCK_1024 = 1024;
const MAX_RETRIES = 10;
const RESPONSE_TIMEOUT = 5000;

function crc16(data) {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
    crc &= 0xFFFF;
  }
  return crc;
}

function buildPacket(type, seq, data) {
  const blockSize = type === SOH ? BLOCK_128 : BLOCK_1024;
  const padded = Buffer.alloc(blockSize, 0x1A);
  data.copy(padded, 0, 0, Math.min(data.length, blockSize));

  const crc = crc16(padded);
  const packet = Buffer.alloc(3 + blockSize + 2);
  packet[0] = type;
  packet[1] = seq & 0xFF;
  packet[2] = (~seq) & 0xFF;
  padded.copy(packet, 3);
  packet[3 + blockSize] = (crc >> 8) & 0xFF;
  packet[3 + blockSize + 1] = crc & 0xFF;
  return packet;
}

export class YmodemSender {
  constructor(cncController) {
    this.cncController = cncController;
    this.responseBuffer = Buffer.alloc(0);
    this.onProgress = null;
  }

  async send(filename, content) {
    const fileData = Buffer.from(content, 'utf-8');
    const totalBytes = fileData.length;

    log('Starting Ymodem upload:', filename, '(' + totalBytes + ' bytes)');

    this.cncController.enterRawMode();
    try {
      this.responseBuffer = Buffer.alloc(0);
      this.cncController.onRawData((data) => {
        this.responseBuffer = Buffer.concat([this.responseBuffer, data]);
      });

      // Block 0: filename + filesize → receiver responds ACK + C
      const header = Buffer.from(filename + '\0' + totalBytes.toString() + '\0', 'utf-8');
      const block0 = buildPacket(SOH, 0, header);

      await this._sendWithRetry(block0);
      await this._expectByte(C_CHAR, RESPONSE_TIMEOUT);

      // Data blocks → receiver responds ACK after each
      let seq = 1;
      let offset = 0;
      while (offset < totalBytes) {
        const chunk = fileData.subarray(offset, offset + BLOCK_1024);
        const packet = buildPacket(STX, seq, chunk);

        await this._sendWithRetry(packet);

        offset += BLOCK_1024;
        seq = (seq + 1) & 0xFF;

        if (this.onProgress) {
          const sent = Math.min(offset, totalBytes);
          this.onProgress({
            bytesSent: sent,
            totalBytes,
            percent: Math.round((sent / totalBytes) * 100)
          });
        }
      }

      // EOT → receiver responds ACK + C
      await this.cncController.writeRaw(Buffer.from([EOT]));
      await this._expectByte(ACK, RESPONSE_TIMEOUT);
      await this._expectByte(C_CHAR, RESPONSE_TIMEOUT);

      // Empty block 0 (end batch) → receiver responds ACK then ends transfer
      const emptyBlock = buildPacket(SOH, 0, Buffer.alloc(0));
      await this.cncController.writeRaw(emptyBlock);
      await this._expectByte(ACK, RESPONSE_TIMEOUT);

      log('Ymodem upload complete:', filename);
    } finally {
      this.cncController.exitRawMode();
    }
  }

  async _sendWithRetry(packet) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.cncController.writeRaw(packet);
      const byte = await this._readByte(RESPONSE_TIMEOUT);

      if (byte === ACK) {
        return;
      }
      if (byte === NAK) {
        log('NAK received, retrying (attempt ' + (attempt + 1) + ')');
        continue;
      }
      if (byte === CAN) {
        try { await this._readByte(1000); } catch { /* ignore */ }
        throw new Error('Transfer cancelled by receiver');
      }
      throw new Error('Unexpected response: 0x' + byte.toString(16));
    }
    throw new Error('Max retries exceeded');
  }

  async _readByte(timeout) {
    await this._waitForBytes(1, timeout);
    return this._consumeBytes(1)[0];
  }

  async _expectByte(expected, timeout) {
    const byte = await this._readByte(timeout);
    if (byte !== expected) {
      throw new Error('Expected 0x' + expected.toString(16) + ', got 0x' + byte.toString(16));
    }
  }

  async _waitForBytes(count, timeout) {
    const start = Date.now();
    while (this.responseBuffer.length < count) {
      if (Date.now() - start > timeout) {
        throw new Error('Timeout waiting for ' + count + ' bytes');
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  _consumeBytes(count) {
    const result = this.responseBuffer.subarray(0, count);
    this.responseBuffer = this.responseBuffer.subarray(count);
    return Buffer.from(result);
  }
}
