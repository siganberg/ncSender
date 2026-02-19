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

import { YmodemSender } from './ymodem-sender.js';
import { createLogger } from '../../core/logger.js';

const { log } = createLogger('ControllerFiles');
const SOURCE_ID = 'controller-files';

export class SerialFileService {
  constructor(cncController) {
    this.cncController = cncController;
  }

  async listFiles() {
    const files = [];

    const dataHandler = (data, sourceId) => {
      if (sourceId !== SOURCE_ID) return;
      // Format: [FILE:filename|SIZE:bytes]
      const match = data.match(/^\[FILE:(.+)\|SIZE:(\d+)\]$/);
      if (match) {
        files.push({ name: match[1], size: parseInt(match[2]) });
      }
    };

    this.cncController.on('data', dataHandler);
    try {
      await this.cncController.sendCommand('$F', { meta: { sourceId: SOURCE_ID } });
    } finally {
      this.cncController.off('data', dataHandler);
    }

    log('Listed', files.length, 'files from controller');
    return files;
  }

  async runFile(filename) {
    log('Running file:', filename);
    await this.cncController.sendCommand(`$F=${filename}`, { meta: { sourceId: SOURCE_ID } });
  }

  async readFile(filename) {
    const lines = [];

    const dataHandler = (data, sourceId) => {
      if (sourceId !== SOURCE_ID) return;
      lines.push(data);
    };

    this.cncController.on('data', dataHandler);
    try {
      await this.cncController.sendCommand(`$F<=${filename}`, { meta: { sourceId: SOURCE_ID } });
    } finally {
      this.cncController.off('data', dataHandler);
    }

    log('Read file:', filename, '(' + lines.length + ' lines)');
    return lines.join('\n');
  }

  async uploadFile(filename, content, onProgress) {
    log('Uploading file:', filename);
    const sender = new YmodemSender(this.cncController);
    if (onProgress) {
      sender.onProgress = onProgress;
    }
    await sender.send(filename, content);
  }

  async saveFile(filename, content, onProgress) {
    log('Saving file (delete + upload):', filename);
    try {
      await this.deleteFile(filename);
    } catch {
      // File may not exist, ignore delete errors
    }
    await this.uploadFile(filename, content, onProgress);
  }

  async deleteFile(filename) {
    log('Deleting file:', filename);
    await this.cncController.sendCommand(`$FD=${filename}`, { meta: { sourceId: SOURCE_ID } });
  }
}
