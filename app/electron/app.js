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

import express from 'express';
import { createServer as createHttpServer } from 'http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs/promises';
import { CNCController } from './features/cnc/controller.js';
import { JogSessionManager } from './features/cnc/jog-manager.js';
import { jobManager } from './features/gcode/job-manager.js';
import { getSetting, saveSettings, DEFAULT_SETTINGS } from './core/settings-manager.js';
import { getUserDataDir } from './utils/paths.js';
import { createServerContext } from './server/context.js';
import { createAutoConnector } from './server/auto-connect.js';
import { createWebSocketLayer } from './server/websocket.js';
import { registerCncEventHandlers } from './server/cnc-events.js';
import { mountHttp } from './server/http.js';
import { pluginManager } from './core/plugin-manager.js';
import { CommandProcessor } from './core/command-processor.js';
import { readFile } from 'node:fs/promises';
import { createLogger } from './core/logger.js';
import { bleClientAdapter } from './features/pendant/ble-client.js';
import { blePendantManager } from './features/pendant/ble-manager.js';

const { log, error: logError } = createLogger('App');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load package.json for version info
const packageJson = JSON.parse(
  await readFile(path.join(__dirname, '../package.json'), 'utf-8')
);

export async function createApp(options = {}) {
  const connectionSettings = getSetting('connection');
  const configuredServerPort = connectionSettings?.serverPort ?? DEFAULT_SETTINGS.connection.serverPort;
  const port = options.port ?? process.env.PORT ?? configuredServerPort;

  const app = express();
  app.use(express.json({ limit: '100mb' }));
  app.use(cors());

  const server = createHttpServer(app);

  const context = createServerContext();
  context.updateSenderStatus();

  const userDataDir = getUserDataDir();
  const firmwareFilePath = path.join(userDataDir, 'firmware.json');

  const cncController = new CNCController();

  // Create a wrapper object that will hold commandProcessor reference
  // This allows JogManager and WebSocket layer to access it after initialization
  const commandProcessorWrapper = { instance: null };

  const jogManager = new JogSessionManager({
    cncController,
    commandProcessor: commandProcessorWrapper
  });

  const autoConnector = createAutoConnector({ cncController });

  const websocketLayer = createWebSocketLayer({
    httpServer: server,
    cncController,
    jobManager,
    jogManager,
    context,
    commandProcessor: commandProcessorWrapper
  });

  const { wss, broadcast, sendWsMessage, getClientWebSocket, getClientRegistry, shutdown: shutdownWebSocket, handleWebSocketCommand } = websocketLayer;

  // Now initialize CommandProcessor with broadcast function
  commandProcessorWrapper.instance = new CommandProcessor({
    cncController,
    pluginManager,
    broadcast,
    serverState: context.serverState,
    firmwareFilePath
  });

  const filesDir = path.join(userDataDir, 'gcode-files');

  try {
    await fs.mkdir(filesDir, { recursive: true });
    log('Files directory created/verified:', filesDir);
  } catch (error) {
    log('Failed to create files directory:', error);
  }

  const lastLoadedFile = getSetting('lastLoadedFile');
  if (lastLoadedFile) {
    const filePath = path.join(filesDir, lastLoadedFile);
    const cachePath = path.join(getUserDataDir(), 'gcode-cache', 'current.gcode');

    try {
      await fs.access(filePath);

      // Check if cached file exists from previous session (use it regardless of processing)
      let content;
      try {
        await fs.access(cachePath);
        content = await fs.readFile(cachePath, 'utf8');
        log('Using cached G-code from previous session:', cachePath);
      } catch {
        // Cache doesn't exist, read original file (no processing on server restart)
        content = await fs.readFile(filePath, 'utf8');
        log('No cache found, using original file:', filePath);
      }

      // Set serverState
      context.serverState.jobLoaded = {
        filename: lastLoadedFile,  // Original filename for display and API
        currentLine: 0,
        totalLines: content.split('\n').length,
        status: null
      };

      log('Restored last loaded file from settings:', lastLoadedFile);
    } catch (error) {
      log('Last loaded file no longer exists, clearing from settings:', lastLoadedFile);
      saveSettings({ lastLoadedFile: null });
    }
  }

  const upload = multer({
    dest: filesDir,
    fileFilter: (req, file, cb) => {
      const allowedExtensions = ['.gcode', '.nc', '.tap', '.txt'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowedExtensions.includes(ext) || file.mimetype === 'text/plain') {
        cb(null, true);
      } else {
        cb(new Error('Only G-code files are allowed'), false);
      }
    },
    limits: {
      fileSize: 250 * 1024 * 1024
    }
  });

  const clientDistPath = path.join(__dirname, '../client/dist');

  mountHttp({
    app,
    clientDistPath,
    port,
    serverState: context.serverState,
    cncController,
    broadcast,
    getClientWebSocket,
    updateSenderStatus: context.updateSenderStatus,
    commandHistory: context.commandHistory,
    maxHistorySize: context.MAX_HISTORY_SIZE,
    filesDir,
    upload,
    commandProcessor: commandProcessorWrapper,
    autoConnector,
    websocketLayer
  });

  // Setup BLE client adapter to bridge BLE pendant connections to WebSocket handlers
  bleClientAdapter.setup({
    websocketLayer,
    serverState: context.serverState,
    jobManager
  });

  const { teardown: teardownCncEvents } = registerCncEventHandlers({
    cncController,
    jobManager,
    context,
    broadcast,
    autoConnector,
    firmwareFilePath
  });

  const start = () => new Promise((resolve) => {
    server.listen(port, '0.0.0.0', async () => {
      log(`ncSender v${packageJson.version}`);
      log(`ncSender Server listening on port ${port}`);
      log(`HTTP API: http://localhost:${port}/api`);
      log(`WebSocket: ws://localhost:${port}`);

      try {
        await pluginManager.initialize({ cncController, broadcast, sendWsMessage, getClientRegistry, serverState: context.serverState });
        log('Plugin manager initialized successfully');
      } catch (error) {
        log('Failed to initialize plugin manager:', error);
      }

      autoConnector.start();

      // Auto-connect to BLE pendant if previously paired
      blePendantManager.autoConnect().then(connected => {
        if (connected) {
          log('BLE pendant auto-connected');
        }
      }).catch(err => {
        log('BLE auto-connect skipped:', err.message);
      });

      resolve();
    });
  });

  const close = async () => {
    log('Shutting down server...');
    await autoConnector.stop();
    teardownCncEvents();
    shutdownWebSocket();
    await new Promise((resolve) => server.close(resolve));
  };

  return { app, server, wss, port, start, close };
}
