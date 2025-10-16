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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export async function createApp(options = {}) {
  const connectionSettings = getSetting('connection');
  const configuredServerPort = connectionSettings?.serverPort ?? DEFAULT_SETTINGS.connection.serverPort;
  const port = options.port ?? process.env.PORT ?? configuredServerPort;

  const app = express();
  app.use(express.json());
  app.use(cors());

  const server = createHttpServer(app);

  const context = createServerContext();
  context.updateSenderStatus();

  const cncController = new CNCController();
  const jogManager = new JogSessionManager({ cncController, log });

  const autoConnector = createAutoConnector({ cncController, log });

  const { wss, broadcast, shutdown: shutdownWebSocket } = createWebSocketLayer({
    httpServer: server,
    cncController,
    jobManager,
    jogManager,
    context,
    log
  });

  const userDataDir = getUserDataDir();
  const filesDir = path.join(userDataDir, 'gcode-files');
  const firmwareFilePath = path.join(userDataDir, 'firmware.json');

  try {
    await fs.mkdir(filesDir, { recursive: true });
    log('Files directory created/verified:', filesDir);
  } catch (error) {
    log('Failed to create files directory:', error);
  }

  const lastLoadedFile = getSetting('lastLoadedFile');
  if (lastLoadedFile) {
    const filePath = path.join(filesDir, lastLoadedFile);
    try {
      await fs.access(filePath);
      const content = await fs.readFile(filePath, 'utf8');
      context.serverState.jobLoaded = {
        filename: lastLoadedFile,
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
      fileSize: 50 * 1024 * 1024
    }
  });

  const clientDistPath = path.join(__dirname, '../client/dist');

  mountHttp({
    app,
    log,
    clientDistPath,
    port,
    serverState: context.serverState,
    cncController,
    broadcast,
    updateSenderStatus: context.updateSenderStatus,
    commandHistory: context.commandHistory,
    maxHistorySize: context.MAX_HISTORY_SIZE,
    filesDir,
    upload
  });

  const { teardown: teardownCncEvents } = registerCncEventHandlers({
    cncController,
    jobManager,
    context,
    broadcast,
    log,
    autoConnector,
    firmwareFilePath
  });

  const start = () => new Promise((resolve) => {
    server.listen(port, '0.0.0.0', async () => {
      log(`ncSender Server listening on port ${port}`);
      log(`HTTP API: http://localhost:${port}/api`);
      log(`WebSocket: ws://localhost:${port}`);

      try {
        await pluginManager.initialize({ cncController, broadcast });
        log('Plugin manager initialized successfully');
      } catch (error) {
        log('Failed to initialize plugin manager:', error);
      }

      autoConnector.start();
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
