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

import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readSettings } from '../../core/settings-manager.js';
import { readMacros } from '../macro/storage.js';
import { pluginManager } from '../../core/plugin-manager.js';
import { getAllTools } from '../tools/tools-storage.js';
import { getUserDataDir } from '../../utils/paths.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('Init');

const FIRMWARE_FILE_PATH = path.join(getUserDataDir(), 'firmware.json');

async function tryReadFirmwareFile() {
  try {
    const data = await fs.readFile(FIRMWARE_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function createInitRoutes(serverState, commandHistory) {
  const router = Router();

  router.get('/init', async (req, res) => {
    try {
      const [settings, macros, firmware, tools] = await Promise.all([
        Promise.resolve(readSettings() || {}),
        Promise.resolve(readMacros() || []),
        tryReadFirmwareFile(),
        getAllTools().catch(() => [])
      ]);

      const plugins = pluginManager.getLoadedPlugins();

      res.json({
        settings,
        macros,
        firmware,
        plugins,
        commandHistory: commandHistory || [],
        tools,
        serverState: serverState || {}
      });
    } catch (error) {
      logError('Error in /api/init:', error);
      res.status(500).json({ error: 'Failed to initialize client data' });
    }
  });

  return router;
}
