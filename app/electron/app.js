import express from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs/promises';
import { CNCController } from './features/cnc/controller.js';
import { JogSessionManager } from './features/cnc/jog-manager.js';
import { jobManager } from './features/gcode/job-manager.js';
import { createCNCRoutes } from './features/cnc/routes.js';
import { createCommandHistoryRoutes } from './features/command-history/routes.js';
import { createGCodeRoutes } from './features/gcode/routes.js';
import { createGCodePreviewRoutes } from './features/gcode/preview-routes.js';
import { createGCodeJobRoutes } from './features/gcode/job-routes.js';
import { createSystemRoutes } from './features/system/routes.js';
import { createSettingsRoutes } from './features/settings/routes.js';
import { createAlarmRoutes, fetchAndSaveAlarmCodes } from './features/alarms/routes.js';
import { createFirmwareRoutes, initializeFirmwareOnConnection } from './features/firmware/routes.js';
import { createProbeRoutes } from './features/probe/routes.js';
import { getSetting, saveSettings, removeSetting, DEFAULT_SETTINGS } from './core/settings-manager.js';
import { MessageStateTracker } from './core/state-diff.js';
import { getUserDataDir } from './utils/paths.js';

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
          if (key === 'isProbing' || key === 'isToolChanging') {
            return undefined;
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
      isToolChanging: false,
      isProbing: false
    },
    senderStatus: 'connecting',
    jobLoaded: null // Will be populated with current job info: { filename, currentLine, totalLines, status }
  };

  const computeSenderStatus = () => {
    const connectionType = getSetting('connectionType') ?? DEFAULT_SETTINGS.connectionType;
    const normalizedType = typeof connectionType === 'string' ? connectionType.toLowerCase() : undefined;

    const requireSetup = () => {
      if (normalizedType === 'usb') {
        const usbPort = getSetting('usbPort');
        const baudRate = getSetting('baudRate') ?? DEFAULT_SETTINGS.baudRate;
        return !usbPort || !baudRate;
      }

      if (normalizedType === 'ethernet') {
        const ip = getSetting('ip');
        const port = getSetting('port');
        return !ip || !port;
      }

      return false;
    };

    if (!normalizedType || requireSetup()) {
      return 'setup-required';
    }

    const connected = serverState.machineState?.connected === true;
    const machineStatusRaw = serverState.machineState?.status;
    const machineStatus = typeof machineStatusRaw === 'string' ? machineStatusRaw.toLowerCase() : undefined;
    const homed = serverState.machineState?.homed;
    const lastAlarmCode = getSetting('lastAlarmCode');
    const isToolChanging = serverState.machineState?.isToolChanging === true;
    const isProbing = serverState.machineState?.isProbing === true;
    const jobLoadedStatus = serverState.jobLoaded?.status;
    const jobIsRunning = jobLoadedStatus === 'running';

    if (!connected) {
      return 'connecting';
    }

    if (lastAlarmCode !== undefined && lastAlarmCode !== null) {
      return 'alarm';
    }
    if (machineStatus === 'alarm') {
      return 'alarm';
    }

    if (isToolChanging) {
      return 'tool-changing';
    }

    if (isProbing) {
      return 'probing';
    }

    if (machineStatus === 'home') {
      return 'homing';
    }

    if (machineStatus === 'hold') {
      return 'hold';
    }

    if (machineStatus === 'jog') {
      return 'jogging';
    }

    if (machineStatus === 'run' || jobIsRunning) {
      return 'running';
    }

    if (machineStatus === 'door') {
      return 'door';
    }

    if (machineStatus === 'check') {
      return 'check';
    }

    if (machineStatus === 'sleep') {
      return 'sleep';
    }

    if (machineStatus === 'tool') {
      return 'tool-changing';
    }

    if (machineStatus === 'idle' && homed === false) {
      return 'homing-required';
    }

    if (machineStatus === 'idle') {
      return 'idle';
    }

    return connected ? 'idle' : 'connecting';
  };

  const updateSenderStatus = () => {
    const nextStatus = computeSenderStatus();
    if (serverState.senderStatus !== nextStatus) {
      serverState.senderStatus = nextStatus;
      return true;
    }
    return false;
  };

  updateSenderStatus();

  // Track previous state for all message types
  const messageStateTracker = new MessageStateTracker();

  // Track connection history for internal server logic only (not broadcasted to clients)
  let hasEverConnected = false;

  // Middleware
  app.use(express.json());
  app.use(cors());

  // File upload configuration
  const userDataDir = getUserDataDir();
  const filesDir = path.join(userDataDir, 'gcode-files');
  const firmwareFilePath = path.join(userDataDir, 'firmware.json');

  try {
    await fs.mkdir(filesDir, { recursive: true });
    log('Files directory created/verified:', filesDir);
  } catch (error) {
    log('Failed to create files directory:', error);
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
        status: null
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

  // Serve static files for browser clients (includes /assets folder from Vite build)
  // In production (packaged app), __dirname will be inside app.asar
  // Electron handles asar paths transparently, so we can use them directly
  const clientDistPath = path.join(__dirname, '../client/dist');
  log('Serving client files from:', clientDistPath);

  // Serve from asar (for most files)
  app.use(express.static(clientDistPath, {
    setHeaders: (res, filePath) => {
      // Set proper MIME types for 3D model files
      if (filePath.endsWith('.obj')) {
        res.setHeader('Content-Type', 'text/plain');
      } else if (filePath.endsWith('.mtl')) {
        res.setHeader('Content-Type', 'text/plain');
      }
    }
  }));

  // Also serve from unpacked folder (for .obj and other unpacked files)
  const unpackedPath = clientDistPath.replace('app.asar', 'app.asar.unpacked');
  if (unpackedPath !== clientDistPath) {
    log('Also serving unpacked files from:', unpackedPath);
    app.use(express.static(unpackedPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.obj')) {
          res.setHeader('Content-Type', 'text/plain');
        } else if (filePath.endsWith('.mtl')) {
          res.setHeader('Content-Type', 'text/plain');
        }
      }
    }));
  }

  const translateCommandInput = (rawCommand) => {
    if (typeof rawCommand !== 'string' || rawCommand.trim() === '') {
      return {
        error: { message: 'Command is required', code: 'INVALID_COMMAND' }
      };
    }

    const trimmed = rawCommand.trim();

    const hexMatch = /^\\x([0-9a-fA-F]{2})$/i.exec(trimmed);
    if (hexMatch) {
      const charCode = parseInt(hexMatch[1], 16);
      return {
        command: String.fromCharCode(charCode),
        displayCommand: trimmed
      };
    }

    return { command: trimmed, displayCommand: trimmed };
  };

  async function handleWebSocketCommand(ws, payload) {
    const {
      command: rawCommand,
      commandId,
      displayCommand,
      meta,
      completesCommandId
    } = payload || {};

    const translation = translateCommandInput(rawCommand);
    if (translation.error) {
      // Translation error - command is invalid, don't send to CNC
      log('Command translation error:', translation.error.message);
      return;
    }

    const normalizedCommandId = commandId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const normalizedMeta = meta && typeof meta === 'object' ? { ...meta } : null;
    const commandValue = translation.command;

    const commandMeta = {
      id: normalizedCommandId,
      command: commandValue,
      displayCommand: displayCommand || translation.displayCommand || commandValue,
      timestamp: new Date().toISOString(),
      meta: normalizedMeta,
      completesCommandId: completesCommandId ?? null
    };

    log('WebSocket command received', commandMeta.displayCommand, `id=${normalizedCommandId}`);

    const metaPayload = commandMeta.meta ? { ...commandMeta.meta } : {};
    if (commandMeta.completesCommandId) {
      metaPayload.completesCommandId = commandMeta.completesCommandId;
    }
    // Do not attach originId to meta/broadcasts

    try {
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

      if (commandValue === '?' && metaPayload.sourceId !== 'no-broadcast') {
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
          });
          break;
        case 'job:progress:close': {
          try {
            if (serverState.jobLoaded) {
              // Reset to a freshly loaded state - preserve file info but clear all job run data
              serverState.jobLoaded.status = null;
              serverState.jobLoaded.currentLine = 0;
              serverState.jobLoaded.jobStartTime = null;
              serverState.jobLoaded.jobEndTime = null;
              serverState.jobLoaded.jobPauseAt = null;
              serverState.jobLoaded.jobPausedTotalSec = 0;
              serverState.jobLoaded.remainingSec = null;
              serverState.jobLoaded.progressPercent = null;
              serverState.jobLoaded.runtimeSec = null;
              broadcast('server-state-updated', serverState);
            }
          } catch (err) {
            log('Error handling job:progress:close', err?.message || err);
          }
          break;
        }
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
      log('WebSocket error:', error);
      clients.delete(ws);
      if (jogManager) {
        jogManager.handleDisconnect(ws).catch((disconnectError) => {
          log('Error handling jog disconnect after error', disconnectError?.message || disconnectError);
        });
      }
    });

    // Send server state (includes machine state and connection status)
    computeJobProgressFields();
    updateSenderStatus();
    sendWsMessage(ws, 'server-state-updated', serverState);
  });

  // Helper function to update job status in serverState
  const updateJobStatus = () => {
    const jobStatus = jobManager.getJobStatus();
    // Only update if there's an active job, otherwise keep the loaded file info
    if (jobStatus) {
      const prev = serverState.jobLoaded || {};
      // Merge to preserve extended fields (e.g., runtimeSec, remainingSec, showProgress)
      // Preserve totalLines from previous state if new value is 0 or missing
      const totalLines = (jobStatus.totalLines && jobStatus.totalLines > 0)
        ? jobStatus.totalLines
        : prev.totalLines;
      serverState.jobLoaded = { ...prev, ...jobStatus, totalLines };
    }
  };

  function broadcast(type, data) {
    // Always include current job status in server-state-updated messages
    if (type === 'server-state-updated') {
      updateSenderStatus();
      updateJobStatus();
      computeJobProgressFields();

      // Check if delta broadcast is enabled
      const enableStateDeltaBroadcast = getSetting('enableStateDeltaBroadcast') ?? DEFAULT_SETTINGS.enableStateDeltaBroadcast;

      if (enableStateDeltaBroadcast) {
        // Get delta for server-state-updated only
        let changes = messageStateTracker.getDelta(type, data);
        if (!changes) {
          return; // No changes, skip broadcast
        }

        // Ensure progress fields are present alongside jobLoaded deltas
        try {
          if (changes.jobLoaded && serverState.jobLoaded) {
            const jl = serverState.jobLoaded;
            if (typeof changes.jobLoaded !== 'object' || changes.jobLoaded === null) {
              changes.jobLoaded = {};
            }
            changes.jobLoaded.remainingSec = jl.remainingSec ?? null;
            changes.jobLoaded.progressPercent = jl.progressPercent ?? null;
            changes.jobLoaded.runtimeSec = jl.runtimeSec ?? null;
            // Include provider-driven fields to keep UI in sync
            changes.jobLoaded.totalEstimatedSec = jl.totalEstimatedSec ?? null;
            changes.jobLoaded.progressProvider = jl.progressProvider ?? null;
          }
        } catch {}

        data = changes;
      }
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
        if (key === 'isProbing' || key === 'isToolChanging') {
          return undefined;
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
      log('Error broadcasting message:', error.message);
      log('Problematic data:', type, typeof data);
    }
  }

  // Compute server-driven job progress fields so all clients stay in sync
  const computeJobProgressFields = () => {
    if (!serverState || !serverState.jobLoaded) return;
    const jl = serverState.jobLoaded;
    const tl = Number(jl.totalLines) || 0;
    const cl = Number(jl.currentLine) || 0;

    // Runtime (excludes paused time)
    const startIso = jl.jobStartTime;
    if (startIso) {
      const endOrNowMs = jl.jobEndTime ? Date.parse(jl.jobEndTime) : Date.now();
      let elapsedMs = endOrNowMs - Date.parse(startIso);
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) elapsedMs = 0;
      let pausedMs = (Number(jl.jobPausedTotalSec) || 0) * 1000;
      if (!jl.jobEndTime && jl.jobPauseAt) {
        const pauseAtMs = Date.parse(jl.jobPauseAt);
        if (Number.isFinite(pauseAtMs) && pauseAtMs < endOrNowMs) {
          pausedMs += (endOrNowMs - pauseAtMs);
        }
      }
      const runtimeSec = Math.max(0, Math.floor((elapsedMs - pausedMs) / 1000));
      jl.runtimeSec = runtimeSec;

      // If an external progress provider is not attached, compute naive percent/remaining
      if (!jl.progressProvider) {
        // Percent
        let percent = 0;
        if (tl > 0) {
          percent = Math.round((Math.max(0, Math.min(cl, tl)) / tl) * 100);
        }
        if (jl.status === 'completed') percent = 100;
        jl.progressPercent = percent;

        // Remaining based on avg seconds per executed line, frozen implicitly when paused
        if (cl > 0 && tl > 0) {
          const linesRemaining = Math.max(0, tl - cl);
          const avg = runtimeSec / cl; // sec per line
          jl.remainingSec = Math.round(linesRemaining * avg);
        } else {
          jl.remainingSec = null;
        }
      }
    }
  };

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

      // Validate settings are complete before attempting connection
      const isSettingsComplete = connectionType === 'ethernet'
        ? (currentSettings.ip && currentSettings.port)
        : (currentSettings.usbPort && currentSettings.baudRate);

      if (!isSettingsComplete) {
        // Settings incomplete, skip this iteration
        previousSettings = JSON.parse(JSON.stringify(currentSettings));
        continue;
      }

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

  const toCommandPayload = (event, options = {}) => {
    const { includeTimestamp = true, ...overrides } = options;
    const command = typeof event.command === 'string' ? event.command : (event.displayCommand || '');
    const displayCommand = formatCommandText(event.displayCommand ?? command);

    // Filter out server-only meta fields from broadcast (do not expose jog/originId)
    let filteredMeta = null;
    let sourceId;
    if (event.meta) {
      // Remove internal-only fields and redundant ones from meta
      const { jobControl, continuous, job, jog, originId, sourceId: src, ...clientMeta } = event.meta;
      sourceId = src;
      filteredMeta = Object.keys(clientMeta).length > 0 ? clientMeta : null;
    }

    const payload = {
      id: event.id,
      command,
      displayCommand,
      status: event.status || 'pending',
      ...overrides
    };

    // Only include meta if present
    if (filteredMeta) {
      payload.meta = filteredMeta;
    }

    // Only include sourceId if provided
    if (sourceId) {
      payload.sourceId = sourceId;
    }

    if (includeTimestamp) {
      payload.timestamp = event.timestamp || new Date().toISOString();
    }

    return payload;
  };

  const setToolChanging = (value) => {
    if (serverState.machineState.isToolChanging !== value) {
      log(`isToolChanging -> ${value ? 'true' : 'false'}`);
      serverState.machineState.isToolChanging = value;
      broadcast('server-state-updated', serverState);
    }
  };

  const isToolChangeCommand = (cmd) => {
    if (!cmd || typeof cmd !== 'string') return false;
    return /M6(?!\d)/i.test(cmd);
  };

  const parseToolParam = (cmd) => {
    if (!cmd || typeof cmd !== 'string') return undefined;
    const m = cmd.match(/(^|\s)T(\d+)/i);
    if (!m) return undefined;
    const n = parseInt(m[2], 10);
    return Number.isFinite(n) ? n : undefined;
  };

  const broadcastQueuedCommand = (event) => {
    // Skip broadcasting commands marked as no-broadcast
    if (event.meta?.sourceId === 'no-broadcast') {
      return;
    }

    const payload = toCommandPayload(event, { status: 'pending' });
    broadcast('cnc-command', payload);

    if (isToolChangeCommand(payload.command)) {
      try {
        const requestedTool = parseToolParam(payload.command);
        const currentTool = Number(serverState?.machineState?.tool);
        if (
          requestedTool !== undefined &&
          Number.isFinite(currentTool) &&
          requestedTool === currentTool
        ) {
          log(`M6 queued for current tool T${requestedTool}; skipping isToolChanging toggle`);
        } else {
          setToolChanging(true);
        }
      } catch (e) {
        // Fallback to setting toolchange on any M6 if parsing/state fails
        setToolChanging(true);
      }
    }

    if (event.meta?.continuous) {
      longRunningCommands.set(event.id, payload);
    }
  };

  const broadcastCommandResult = (event) => {
    // Skip broadcasting command results marked as no-broadcast
    if (event.meta?.sourceId === 'no-broadcast') {
      return;
    }

    if (event.status === 'success' && event.meta?.continuous) {
      return;
    }

    let status = event.status || 'success';
    const payload = toCommandPayload(event, { includeTimestamp: false });

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

    // After each acknowledged command, update job progress fields and broadcast state
    computeJobProgressFields();
    broadcast('server-state-updated', serverState);

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
        // Keep WCS in sync for clients that display it
        serverState.machineState.WCS = newWorkspace;
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

        // Initialize firmware structure on connection
        initializeFirmwareOnConnection(cncController).catch((error) => {
          log('Error initializing firmware on connection:', error?.message || error);
        });

        // Fetch and save alarm codes if not already cached
        fetchAndSaveAlarmCodes(cncController).catch((error) => {
          log('Error fetching alarm codes on connection:', error?.message || error);
        });
      }

      if (!newOnlineStatus && hasEverConnected) {
        log('Connection lost, starting reconnection attempts...');
        startAutoConnect();
      }

      broadcast('server-state-updated', serverState);
    }
  });

  // Update cached firmware value in firmware.json when a $<id>=<value> command is acknowledged
  cncController.on('command-ack', async (event) => {
    try {
      const cmd = String(event?.command || '').trim();
      // Match $<number>=<value> (e.g., $130=1260 or $1=255)
      const match = cmd.match(/^\$(\d+)=\s*(.+)$/);
      if (!match) return;
      const id = match[1];
      const value = match[2];

      // Read existing firmware data
      let firmwareData;
      try {
        const text = await fs.readFile(firmwareFilePath, 'utf8');
        firmwareData = JSON.parse(text);
      } catch (err) {
        // If file missing, start minimal structure
        firmwareData = { version: '1.0', timestamp: new Date().toISOString(), groups: {}, settings: {} };
      }

      if (!firmwareData.settings) firmwareData.settings = {};
      if (!firmwareData.settings[id]) {
        firmwareData.settings[id] = { id: parseInt(id, 10) };
      }
      firmwareData.settings[id].value = String(value);
      firmwareData.timestamp = new Date().toISOString();

      // Persist update
      try {
        await fs.mkdir(path.dirname(firmwareFilePath), { recursive: true });
      } catch {}
      await fs.writeFile(firmwareFilePath, JSON.stringify(firmwareData, null, 2), 'utf8');
      log(`Updated firmware.json setting $${id}=${value}`);
    } catch (error) {
      log('Failed to update firmware.json from command-ack:', error?.message || error);
    }
  });

  cncController.on('data', (data, sourceId) => {
    if (sourceId === 'no-broadcast') {
      return;
    }
    broadcast('cnc-data', data);
  });
  cncController.on('status-report', (status) => {
    const prevMachineState = { ...serverState.machineState };
    // Do not allow controller status to overwrite our authoritative workspace
    const { workspace: _ignoreWorkspace, ...statusWithoutWorkspace } = status || {};
    serverState.machineState = { ...serverState.machineState, ...statusWithoutWorkspace };

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

  // Handle CNC error to store lastAlarmCode in settings and broadcast to all clients
  cncController.on('cnc-error', (errorData) => {
    try {
      let alarmCode = errorData.code;

      // If code is 'ALARM', parse the actual code from the message (e.g., "ALARM:1" -> 1)
      if (alarmCode === 'ALARM' && errorData.message) {
        const alarmMatch = errorData.message.match(/alarm:(\d+)/i);
        if (alarmMatch) {
          alarmCode = parseInt(alarmMatch[1]);
          saveSettings({ lastAlarmCode: alarmCode });
          log('Saved lastAlarmCode to settings:', alarmCode);
        }
      }


      // Broadcast to all clients
      broadcast('cnc-error', errorData);
    } catch (error) {
      log('Failed to save lastAlarmCode:', error);
    }
  });

  // Handle unlock command ($X) to clear lastAlarmCode from settings
  cncController.on('unlock', () => {
    try {
      removeSetting('lastAlarmCode');
      log('Cleared lastAlarmCode from settings');
    } catch (error) {
      log('Failed to clear lastAlarmCode:', error);
    }
  });

  // Handle stop command to force reset any active job and update jobLoaded status
  cncController.on('stop', () => {
    log('Stop command detected, resetting job manager');
    const hadActiveJob = jobManager.hasActiveJob();
    jobManager.forceReset();

    const jobWasMarkedRunning = serverState.jobLoaded?.status === 'running' || serverState.jobLoaded?.status === 'paused';

    if (serverState.jobLoaded && (hadActiveJob || jobWasMarkedRunning)) {
      const nowIso = new Date().toISOString();

      if (serverState.jobLoaded.jobPauseAt) {
        const pauseMs = Date.parse(nowIso) - Date.parse(serverState.jobLoaded.jobPauseAt);
        if (Number.isFinite(pauseMs) && pauseMs > 0) {
          const add = Math.round(pauseMs / 1000);
          serverState.jobLoaded.jobPausedTotalSec = (serverState.jobLoaded.jobPausedTotalSec || 0) + add;
        }
      }

      serverState.jobLoaded = {
        ...serverState.jobLoaded,
        status: 'stopped',
        jobEndTime: nowIso,
        jobPauseAt: null,
        remainingSec: null,
        progressPercent: null,
        runtimeSec: null
      };
    }

    computeJobProgressFields();
    broadcast('server-state-updated', serverState);
  });

  // Handle pause command to update jobLoaded status
  cncController.on('pause', () => {
    log('Pause command detected');

    // Update jobLoaded status to paused
    if (serverState.jobLoaded) {
      serverState.jobLoaded.status = 'paused';
    }

    // Set pause start time
    if (serverState.jobLoaded && !serverState.jobLoaded.jobPauseAt) {
      serverState.jobLoaded.jobPauseAt = new Date().toISOString();
    }

    computeJobProgressFields();
    broadcast('server-state-updated', serverState);
  });

  // Handle resume command to update jobLoaded status
  cncController.on('resume', () => {
    log('Resume command detected');

    // Only update job status if there's an active job running
    if (!jobManager.hasActiveJob()) {
      log('Resume command ignored - no active job');
      return;
    }

    // Update jobLoaded status to running
    if (serverState.jobLoaded) {
      serverState.jobLoaded.status = 'running';
    }

    // Accumulate paused time
    if (serverState.jobLoaded && serverState.jobLoaded.jobPauseAt) {
      const nowIso = new Date().toISOString();
      const pauseMs = Date.parse(nowIso) - Date.parse(serverState.jobLoaded.jobPauseAt);
      if (Number.isFinite(pauseMs) && pauseMs > 0) {
        const add = Math.round(pauseMs / 1000);
        serverState.jobLoaded.jobPausedTotalSec = (serverState.jobLoaded.jobPausedTotalSec || 0) + add;
      }
      serverState.jobLoaded.jobPauseAt = null;
      serverState.jobLoaded.jobEndTime = null;
    }

    computeJobProgressFields();
    broadcast('server-state-updated', serverState);
  });

  // Set up job completion callback to reset job status and broadcast state update
  jobManager.setJobCompleteCallback((reason, finalJobStatus) => {
    log('Job lifecycle ended:', reason);

    // Extract final state from the captured job status
    const finalLine = finalJobStatus?.currentLine;

    // Update status for completion - sets status to 'completed' or 'stopped'
    if (serverState.jobLoaded) {
      // Use totalLines from serverState since job processor doesn't track it
      const totalLines = serverState.jobLoaded.totalLines;

      if (reason === 'completed') {
        serverState.jobLoaded.status = 'completed';
        // Ensure currentLine is set to totalLines on completion
        if (typeof totalLines === 'number' && totalLines > 0) {
          serverState.jobLoaded.currentLine = totalLines;
          log(`Job completed: setting currentLine to ${totalLines} (total lines)`);
        }
      } else if (reason === 'stopped') {
        serverState.jobLoaded.status = 'stopped';
        // Preserve the last executed line number
        if (typeof finalLine === 'number' && finalLine > 0) {
          serverState.jobLoaded.currentLine = finalLine;
          log(`Job stopped: preserving currentLine at ${finalLine}`);
        }
      }
    }
    // Mark end time and finalize pause accounting
    const nowIso = new Date().toISOString();
    if (serverState.jobLoaded) {
      if (serverState.jobLoaded.jobPauseAt) {
        const pauseMs = Date.parse(nowIso) - Date.parse(serverState.jobLoaded.jobPauseAt);
        if (Number.isFinite(pauseMs) && pauseMs > 0) {
          const add = Math.round(pauseMs / 1000);
          serverState.jobLoaded.jobPausedTotalSec = (serverState.jobLoaded.jobPausedTotalSec || 0) + add;
        }
        serverState.jobLoaded.jobPauseAt = null;
      }
      serverState.jobLoaded.jobEndTime = nowIso;
    }
    computeJobProgressFields();
    broadcast('server-state-updated', serverState);
  });

  // API request logging middleware
  app.use('/api', (req, _res, next) => {
    log(`API ${req.method} ${req.path}`, req.body && Object.keys(req.body).length > 0 ? req.body : '');
    next();
  });

  // Mount feature-based route modules
  app.use('/api', createSystemRoutes(serverState, cncController, updateSenderStatus));
  app.use('/api', createSettingsRoutes(serverState, cncController, broadcast));
  app.use('/api', createAlarmRoutes(serverState, cncController));
  app.use('/api', createCNCRoutes(cncController, broadcast));
  app.use('/api/command-history', createCommandHistoryRoutes(commandHistory, MAX_HISTORY_SIZE, broadcast));
  app.use('/api/gcode-files', createGCodeRoutes(filesDir, upload, serverState, broadcast));
  app.use('/api/gcode-preview', createGCodePreviewRoutes(serverState, broadcast));
  app.use('/api/gcode-job', createGCodeJobRoutes(filesDir, cncController, serverState, broadcast));
  app.use('/api/firmware', createFirmwareRoutes(cncController));
  app.use('/api/probe', createProbeRoutes(cncController, serverState, broadcast));

  // Fallback route for SPA - handle all non-API routes
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.includes('.')) {
      return next();
    }

    const indexPath = path.join(clientDistPath, 'index.html');
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
