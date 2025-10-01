import express from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs/promises';
import { CNCController } from './cnc-controller.js';
import { JogSessionManager } from './jog-session-manager.js';
import { jobManager } from './job-processor-manager.js';
import { createCNCRoutes } from './routes/cnc-routes.js';
import { createCommandHistoryRoutes } from './routes/command-history-routes.js';
import { createGCodeRoutes } from './routes/gcode-routes.js';
import { createGCodePreviewRoutes } from './routes/gcode-preview-routes.js';
import { createGCodeJobRoutes } from './routes/gcode-job-routes.js';
import { createSystemRoutes } from './routes/system-routes.js';
import { getSetting, saveSettings, DEFAULT_SETTINGS } from './settings-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export async function createApp(options = {}) {
  const port = options.port ?? process.env.PORT ?? getSetting('serverPort') ?? DEFAULT_SETTINGS.serverPort;

  const app = express();
  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server });

  // Initialize CNC Controller
  const cncController = new CNCController();

  // Store connected clients
  const clients = new Set();
  let jogManager;

  const WS_READY_STATE_OPEN = 1;

  const sendWsMessage = (ws, type, data) => {
    try {
      if (ws && ws.readyState === WS_READY_STATE_OPEN) {
        const safeData = JSON.parse(JSON.stringify(data, (key, value) => {
          if (typeof value === 'object' && value !== null) {
            if (value.constructor && (
              value.constructor.name === 'Timeout' ||
              value.constructor.name === 'Timer' ||
              value.constructor.name === 'TimersList' ||
              value.constructor.name === 'CNCController' ||
              key.includes('_idle') ||
              key.includes('_repeat') ||
              key === 'cncController'
            )) {
              return undefined;
            }
          }
          if (typeof value === 'function') {
            return undefined;
          }
          return value;
        }));

        ws.send(JSON.stringify({ type, data: safeData }));
      }
    } catch (error) {
      log('Failed to send WebSocket payload', error?.message || error);
    }
  };

  // Command history storage (in-memory for now, persists until server restart)
  let commandHistory = [];
  const MAX_HISTORY_SIZE = 200;

  // Server state
  const serverState = {
    machineState: {
      connected: false,
      isToolChanging: false
    },
    jobLoaded: null // Will be populated with current job info: { filename, currentLine, totalLines, status }
  };

  // Track connection history for internal server logic only (not broadcasted to clients)
  let hasEverConnected = false;

  // Middleware
  app.use(express.json());
  app.use(cors());

  function getUserDataDir() {
    const platform = os.platform();
    const appName = 'ncSender';

    switch (platform) {
      case 'win32':
        return path.join(os.homedir(), 'AppData', 'Roaming', appName);
      case 'darwin':
        return path.join(os.homedir(), 'Library', 'Application Support', appName);
      case 'linux':
        return path.join(os.homedir(), '.config', appName);
      default:
        return path.join(os.homedir(), `.${appName}`);
    }
  }

  // File upload configuration
  const userDataDir = getUserDataDir();
  const filesDir = path.join(userDataDir, 'gcode-files');

  try {
    await fs.mkdir(filesDir, { recursive: true });
    log('Files directory created/verified:', filesDir);
  } catch (error) {
    console.error('Failed to create files directory:', error);
  }

  // Load last loaded file from settings on server start
  const lastLoadedFile = getSetting('lastLoadedFile');
  if (lastLoadedFile) {
    const filePath = path.join(filesDir, lastLoadedFile);
    try {
      // Check if file still exists
      await fs.access(filePath);
      const content = await fs.readFile(filePath, 'utf8');
      serverState.jobLoaded = {
        filename: lastLoadedFile,
        currentLine: 0,
        totalLines: content.split('\n').length,
        status: 'stopped'
      };
      log('Restored last loaded file from settings:', lastLoadedFile);
    } catch (error) {
      log('Last loaded file no longer exists, clearing from settings:', lastLoadedFile);
      // File no longer exists, clear from settings
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

  // Serve assets folder BEFORE client dist (to avoid catch-all route)
  const assetsPath = path.join(__dirname, '../assets');
  app.use('/assets', express.static(assetsPath));
  log('Serving assets from:', assetsPath);

  // Serve static files for browser clients
  const clientDistPath = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDistPath));
  log('Serving client files from:', clientDistPath);

  const translateCommandInput = (rawCommand) => {
    if (typeof rawCommand !== 'string' || rawCommand.trim() === '') {
      return {
        error: { message: 'Command is required', code: 'INVALID_COMMAND' }
      };
    }

    const trimmed = rawCommand.split(';')[0].trim();

    const hexMatch = /^\\x([0-9a-fA-F]{2})$/i.exec(trimmed);
    if (hexMatch) {
      const charCode = parseInt(hexMatch[1], 16);
      return {
        command: String.fromCharCode(charCode),
        displayCommand: rawCommand.trim()
      };
    }

    return { command: trimmed, displayCommand: rawCommand.trim() };
  };

  async function handleWebSocketCommand(ws, payload) {
    const {
      command: rawCommand,
      commandId,
      displayCommand,
      meta,
      completesCommandId,
      clientId
    } = payload || {};

    const translation = translateCommandInput(rawCommand);
    if (translation.error) {
      sendWsMessage(ws, 'cnc:command-error', {
        commandId: commandId ?? null,
        error: translation.error
      });
      return;
    }

    const normalizedCommandId = commandId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const normalizedMeta = meta && typeof meta === 'object' ? { ...meta } : null;
    const commandValue = translation.command;

    const commandMeta = {
      id: normalizedCommandId,
      command: commandValue,
      displayCommand: displayCommand || translation.displayCommand || commandValue,
      originId: clientId ?? null,
      timestamp: new Date().toISOString(),
      meta: normalizedMeta,
      completesCommandId: completesCommandId ?? null
    };

    log('WebSocket command received', commandMeta.displayCommand, `id=${normalizedCommandId}`);

    const metaPayload = commandMeta.meta ? { ...commandMeta.meta } : {};
    if (commandMeta.completesCommandId) {
      metaPayload.completesCommandId = commandMeta.completesCommandId;
    }
    if (commandMeta.originId) {
      metaPayload.originId = commandMeta.originId;
    }

    try {
      sendWsMessage(ws, 'cnc:command-ack', {
        commandId: normalizedCommandId,
        status: 'accepted'
      });

      const realtimeJobCommands = new Set(['!', '~', '\x18']);
      if (realtimeJobCommands.has(commandValue) && jobManager.hasActiveJob()) {
        try {
          if (commandValue === '!') {
            jobManager.pause();
            log('Job paused via WebSocket command');
          } else if (commandValue === '~') {
            jobManager.resume();
            log('Job resumed via WebSocket command');
          } else if (commandValue === '\x18') {
            jobManager.stop();
            log('Job stopped via WebSocket command');
          }
        } catch (jobError) {
          log('Job processor error (WebSocket command):', jobError.message);
        }
      }

      await cncController.sendCommand(commandValue, {
        commandId: normalizedCommandId,
        displayCommand: commandMeta.displayCommand,
        meta: Object.keys(metaPayload).length > 0 ? metaPayload : null
      });

      if (commandValue === '?') {
        const rawData = cncController.getRawData();
        if (rawData) {
          broadcast('cnc-data', rawData);
        }
      }
    } catch (error) {
      const errorPayload = {
        message: error?.message || 'Failed to send command',
        code: error?.code
      };

      sendWsMessage(ws, 'cnc:command-error', {
        commandId: normalizedCommandId,
        error: errorPayload
      });

      log('WebSocket command failed', commandMeta.displayCommand, `id=${normalizedCommandId}`, errorPayload.message);
    }
  }

  // WebSocket connection handling
  wss.on('connection', (ws) => {
    log('Client connected');
    clients.add(ws);

    ws.on('message', (rawData) => {
      let parsed;
      try {
        if (typeof rawData === 'string') {
          parsed = JSON.parse(rawData);
        } else if (rawData) {
          parsed = JSON.parse(rawData.toString());
        }
      } catch (error) {
        log('Ignoring invalid WebSocket payload (not JSON)', error?.message || error);
        sendWsMessage(ws, 'ws:error', { message: 'Invalid payload' });
        return;
      }

      if (!parsed || typeof parsed.type !== 'string') {
        log('Ignoring WebSocket payload with missing type');
        return;
      }

      if (parsed.type.startsWith('jog:')) {
        if (!jogManager) {
          return;
        }

        jogManager.handleMessage(ws, parsed).catch((error) => {
          log('Error handling jog message', error?.message || error);
        });
        return;
      }

      switch (parsed.type) {
        case 'cnc:command':
          handleWebSocketCommand(ws, parsed.data).catch((error) => {
            log('Error handling CNC command', error?.message || error);
            sendWsMessage(ws, 'cnc:command-error', {
              commandId: parsed?.data?.commandId ?? null,
              error: { message: error?.message || 'Command handling failed' }
            });
          });
          break;
        default:
          log('Received unsupported WebSocket message type:', parsed.type);
          break;
      }
    });

    ws.on('close', () => {
      log('Client disconnected');
      clients.delete(ws);
      if (jogManager) {
        jogManager.handleDisconnect(ws).catch((error) => {
          log('Error handling jog disconnect', error?.message || error);
        });
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clients.delete(ws);
      if (jogManager) {
        jogManager.handleDisconnect(ws).catch((disconnectError) => {
          log('Error handling jog disconnect after error', disconnectError?.message || disconnectError);
        });
      }
    });

    // Send server state (includes machine state and connection status)
    sendWsMessage(ws, 'server-state-updated', serverState);
  });

  // Helper function to update job status in serverState
  const updateJobStatus = () => {
    const jobStatus = jobManager.getJobStatus();
    // Only update if there's an active job, otherwise keep the loaded file info
    if (jobStatus) {
      serverState.jobLoaded = jobStatus;
    }
  };

  function broadcast(type, data) {
    // Always include current job status in server-state-updated messages
    if (type === 'server-state-updated') {
      updateJobStatus();
    }

    try {
      const safeData = JSON.parse(JSON.stringify(data, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (value.constructor && (
            value.constructor.name === 'Timeout' ||
            value.constructor.name === 'Timer' ||
            value.constructor.name === 'TimersList' ||
            key.includes('_idle') ||
            key.includes('_repeat')
          )) {
            return undefined;
          }
        }
        if (typeof value === 'function') {
          return undefined;
        }
        return value;
      }));

      const message = JSON.stringify({ type, data: safeData });
      clients.forEach(client => {
        if (client.readyState === WS_READY_STATE_OPEN) {
          client.send(message);
        }
      });
    } catch (error) {
      console.error('Error broadcasting message:', error.message);
      console.error('Problematic data:', type, typeof data);
    }
  }

  jogManager = new JogSessionManager({
    cncController,
    log
  });

  const longRunningCommands = new Map();
  let autoConnectActive = false;

  async function startAutoConnect() {
    if (autoConnectActive) return;

    autoConnectActive = true;
    log('Starting automatic CNC connection loop...');

    let previousSettings = null;

    while (autoConnectActive) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const connectionType = getSetting('connectionType');
      if (connectionType === undefined) {
        continue;
      }

      const currentSettings = {
        connectionType,
        ip: getSetting('ip'),
        port: getSetting('port'),
        usbPort: getSetting('usbPort'),
        baudRate: getSetting('baudRate')
      };

      const settingsChanged = !previousSettings || JSON.stringify(currentSettings) !== JSON.stringify(previousSettings);

      if (settingsChanged) {
        cncController.cancelConnection();
        if (cncController.isConnected) {
          cncController.disconnect();
        }

        try {
          await cncController.connectWithSettings(currentSettings);
          if (cncController.isConnected) {
            log('Auto-connect successful');
          }
        } catch (error) {
          // swallow errors; loop will retry
        }

        previousSettings = JSON.parse(JSON.stringify(currentSettings));
        continue;
      }

      if (!cncController.isConnected && !cncController.isConnecting) {
        try {
          await cncController.connectWithSettings(currentSettings);
          if (cncController.isConnected) {
            log('Auto-connect successful');
          }
        } catch (error) {
          // swallow errors; loop will retry
        }
      }
    }
  }

  const formatCommandText = (value) => {
    if (typeof value !== 'string') {
      return '';
    }

    let needsEscaping = false;
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) {
        needsEscaping = true;
        break;
      }
    }

    if (!needsEscaping) {
      return value;
    }

    return Array.from(value).map((char) => {
      const code = char.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) {
        return `\\x${code.toString(16).toUpperCase().padStart(2, '0')}`;
      }
      return char;
    }).join('');
  };

  const toCommandPayload = (event, overrides = {}) => {
    const command = typeof event.command === 'string' ? event.command : (event.displayCommand || '');
    const displayCommand = formatCommandText(event.displayCommand ?? command);
    return {
      id: event.id,
      command,
      displayCommand,
      status: event.status || 'pending',
      timestamp: event.timestamp || new Date().toISOString(),
      originId: event.meta?.originId ?? null,
      meta: event.meta || null,
      ...overrides
    };
  };

  const setToolChanging = (value) => {
    if (serverState.machineState.isToolChanging !== value) {
      serverState.machineState.isToolChanging = value;
      broadcast('server-state-updated', serverState);
    }
  };

  const isToolChangeCommand = (cmd) => {
    if (!cmd || typeof cmd !== 'string') return false;
    return /M6(?!\d)/i.test(cmd);
  };

  const broadcastQueuedCommand = (event) => {
    const payload = toCommandPayload(event, { status: 'pending' });
    broadcast('cnc-command', payload);

    if (isToolChangeCommand(payload.command)) {
      setToolChanging(true);
    } else if (serverState.machineState.isToolChanging) {
      setToolChanging(false);
    }

    if (event.meta?.continuous) {
      longRunningCommands.set(event.id, payload);
    }
  };

  const broadcastCommandResult = (event) => {
    if (event.status === 'success' && event.meta?.continuous) {
      return;
    }

    let status = event.status || 'success';
    const payload = toCommandPayload(event);

    if (status === 'flushed') {
      status = 'error';
      payload.status = 'error';
      payload.error = {
        message: 'Command flushed: likely due to connection loss or controller reset',
        code: 'FLUSHED'
      };
    } else {
      payload.status = status;
    }

    broadcast('cnc-command-result', payload);

    if (isToolChangeCommand(payload.command)) {
      setToolChanging(false);
    }

    const completionId = event.meta?.completesCommandId;
    if (completionId) {
      const tracked = longRunningCommands.get(completionId) || { ...payload, id: completionId };
      const completionPayload = {
        ...tracked,
        status: status === 'success' ? 'success' : 'error',
        timestamp: payload.timestamp,
        error: payload.error
      };
      broadcast('cnc-command-result', completionPayload);
      longRunningCommands.delete(completionId);
    }

    if (event.meta?.continuous) {
      longRunningCommands.delete(event.id);
    }
  };

  const handleWorkspaceChange = (event) => {
    if (event.status === 'success' && event.command) {
      const workspaceMatch = /^(G5[4-9]|G59\.[1-3])$/i.exec(event.command);
      if (workspaceMatch) {
        const newWorkspace = workspaceMatch[1].toUpperCase();
        log('Workspace changed to:', newWorkspace);

        if (!serverState.machineState) {
          serverState.machineState = {};
        }
        serverState.machineState.workspace = newWorkspace;
        broadcast('server-state-updated', serverState);
      }
    }
  };

  cncController.on('command-queued', broadcastQueuedCommand);
  cncController.on('command-ack', handleWorkspaceChange);
  cncController.on('command-ack', broadcastCommandResult);

  cncController.on('status', (data) => {
    const newOnlineStatus = data.status === 'connected' && data.isConnected;
    if (serverState.machineState.connected !== newOnlineStatus) {
      serverState.machineState.connected = newOnlineStatus;
      log(`CNC controller connection status changed. Server state 'machineState.connected' is now: ${serverState.machineState.connected}`);

      if (newOnlineStatus) {
        hasEverConnected = true;
      }

      if (!newOnlineStatus && hasEverConnected) {
        log('Connection lost, starting reconnection attempts...');
        startAutoConnect();
      }

      broadcast('server-state-updated', serverState);
    }
  });

  cncController.on('data', (data) => broadcast('cnc-data', data));
  cncController.on('status-report', (status) => {
    const prevMachineState = { ...serverState.machineState };
    serverState.machineState = { ...serverState.machineState, ...status };

    // Check if anything actually changed
    const hasChanged = JSON.stringify(prevMachineState) !== JSON.stringify(serverState.machineState);

    // If machine enters alarm state and a job is running, force reset the job
    const currentMachineStatus = status?.status?.toLowerCase();
    const prevMachineStatus = prevMachineState?.status;
    if (currentMachineStatus === 'alarm' && prevMachineStatus !== 'alarm' && jobManager.hasActiveJob()) {
      log('Machine entered alarm state, resetting job manager');
      jobManager.forceReset();
    }

    if (hasChanged) {
      broadcast('server-state-updated', serverState);
    }
  });
  cncController.on('system-message', (message) => broadcast('cnc-system-message', message));
  cncController.on('response', (response) => broadcast('cnc-response', response));

  // Handle stop command to force reset any active job and update jobLoaded status
  cncController.on('stop', () => {
    log('Stop command detected, resetting job manager');
    jobManager.forceReset();

    // Update jobLoaded status to stopped
    if (serverState.jobLoaded) {
      serverState.jobLoaded.status = 'stopped';
      serverState.jobLoaded.currentLine = 0;
    }

    broadcast('server-state-updated', serverState);
  });

  // Handle pause command to update jobLoaded status
  cncController.on('pause', () => {
    log('Pause command detected');

    // Update jobLoaded status to paused
    if (serverState.jobLoaded) {
      serverState.jobLoaded.status = 'paused';
    }

    broadcast('server-state-updated', serverState);
  });

  // Handle resume command to update jobLoaded status
  cncController.on('resume', () => {
    log('Resume command detected');

    // Update jobLoaded status to running
    if (serverState.jobLoaded) {
      serverState.jobLoaded.status = 'running';
    }

    broadcast('server-state-updated', serverState);
  });

  // Set up job completion callback to reset job status and broadcast state update
  jobManager.setJobCompleteCallback(() => {
    log('Job completed, resetting jobLoaded status to stopped');
    // Keep the loaded file info but reset status to stopped
    if (serverState.jobLoaded) {
      serverState.jobLoaded.status = 'stopped';
      serverState.jobLoaded.currentLine = 0;
    }
    broadcast('server-state-updated', serverState);
  });

  // Mount feature-based route modules
  app.use('/api', createSystemRoutes(serverState, cncController));
  app.use('/api', createCNCRoutes(cncController, broadcast));
  app.use('/api/command-history', createCommandHistoryRoutes(commandHistory, MAX_HISTORY_SIZE, broadcast));
  app.use('/api/gcode-files', createGCodeRoutes(filesDir, upload, serverState, broadcast));
  app.use('/api/gcode-preview', createGCodePreviewRoutes(serverState, broadcast));
  app.use('/api/gcode-job', createGCodeJobRoutes(filesDir, cncController, serverState, broadcast));

  // Fallback route for SPA - handle all non-API routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.includes('.')) {
      return next();
    }

    const indexPath = path.join(__dirname, '../client/dist/index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        log('Client index.html not found, serving basic response');
        res.status(200).send(`
          <html>
            <head><title>ncSender Server</title></head>
            <body>
              <h1>ncSender Server</h1>
              <p>Server is running on port ${port}</p>
              <p>Build the client first with: <code>cd client && npm run build</code></p>
              <p>API endpoints:</p>
              <ul>
                <li><a href="/api/health">Health Check</a></li>
                <li><a href="/api/serial-ports">Serial Ports</a></li>
                <li><a href="/api/status">CNC Status</a></li>
              </ul>
            </body>
          </html>
        `);
      }
    });
  });

  const start = () => new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      log(`ncSender Server listening on port ${port}`);
      log(`HTTP API: http://localhost:${port}/api`);
      log(`WebSocket: ws://localhost:${port}`);

      startAutoConnect();
      resolve();
    });
  });

  const close = () => {
    log('Shutting down server...');
    wss.close();
    server.close();
  };

  return { app, server, wss, port, start, close };
}

