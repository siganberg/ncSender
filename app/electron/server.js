import express from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export async function createServer() {
  const app = express();
  const server = createHttpServer(app);
  const wss = new WebSocketServer({ server });
  const port = process.env.PORT || 3001;

  // Initialize CNC Controller
  const cncController = new CNCController();

  // Store connected clients
  const clients = new Set();
  let jogManager;

  const WS_READY_STATE_OPEN = 1;

  const sendWsMessage = (ws, type, data) => {
    try {
      if (ws && ws.readyState === WS_READY_STATE_OPEN) {
        ws.send(JSON.stringify({ type, data }));
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
    loadedGCodeProgram: null, // filename of currently loaded G-code
    online: false, // CNC connection status
    machineState: null // last known GRBL status report payload
  };

  // Middleware
  app.use(express.json());
  app.use(cors());

  // File upload configuration
  const filesDir = path.join(__dirname, 'files');
  const upload = multer({
    dest: filesDir,
    fileFilter: (req, file, cb) => {
      // Accept only G-code files
      const allowedExtensions = ['.gcode', '.nc', '.tap', '.txt'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowedExtensions.includes(ext) || file.mimetype === 'text/plain') {
        cb(null, true);
      } else {
        cb(new Error('Only G-code files are allowed'), false);
      }
    },
    limits: {
      fileSize: 50 * 1024 * 1024 // 50MB limit
    }
  });

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

    // Send initial status
    sendWsMessage(ws, 'cnc-status', cncController.getConnectionStatus());

    // Send server state (includes machine state)
    sendWsMessage(ws, 'server-state-updated', serverState);
  });

  // Broadcast function for real-time updates
  function broadcast(type, data) {
    const message = JSON.stringify({ type, data });
    clients.forEach(client => {
      if (client.readyState === WS_READY_STATE_OPEN) { // OPEN
        client.send(message);
      }
    });
  }

  jogManager = new JogSessionManager({
    cncController,
    log
  });

  const longRunningCommands = new Map();

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

  const broadcastQueuedCommand = (event) => {
    const payload = toCommandPayload(event, { status: 'pending' });
    broadcast('cnc-command', payload);

    if (event.meta?.continuous) {
      longRunningCommands.set(event.id, payload);
    }
  };

  const broadcastCommandResult = (event) => {
    if (event.status === 'success' && event.meta?.continuous) {
      // Keep long-running command pending until a completion command arrives
      return;
    }

    let status = event.status || 'success';
    const payload = toCommandPayload(event);

    if (status === 'flushed') {
      status = 'error';
      payload.status = 'error';
      payload.error = { message: event.reason || 'Command cancelled' };
    } else if (status === 'error') {
      payload.error = {
        message: event.error?.message || 'Command failed',
        code: event.error?.code
      };
    } else {
      payload.status = status;
    }

    broadcast('cnc-command-result', payload);

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

  cncController.on('command-queued', broadcastQueuedCommand);
  cncController.on('command-ack', broadcastCommandResult);

  // CNC Controller event forwarding to all clients
  cncController.on('status', (data) => {
    // Update server state based on connection status
    const newOnlineStatus = data.status === 'connected' && data.isConnected;
    if (serverState.online !== newOnlineStatus) {
      serverState.online = newOnlineStatus;
      log(`CNC controller connection status changed. Server state 'online' is now: ${serverState.online}`);
    }

    // Broadcast the status and server state update
    broadcast('cnc-status', data);
    broadcast('server-state-updated', serverState);
  });

  cncController.on('data', (data) => broadcast('cnc-data', data));
  cncController.on('status-report', (status) => {
    serverState.machineState = { ...status };
    broadcast('server-state-updated', serverState);
  });
  cncController.on('system-message', (message) => broadcast('cnc-system-message', message));
  cncController.on('response', (response) => broadcast('cnc-response', response));

  // Mount feature-based route modules
  app.use('/api', createSystemRoutes(serverState));
  app.use('/api', createCNCRoutes(cncController, broadcast));
  app.use('/api/command-history', createCommandHistoryRoutes(commandHistory, MAX_HISTORY_SIZE, broadcast));
  app.use('/api/gcode-files', createGCodeRoutes(filesDir, upload, serverState, broadcast));
  app.use('/api/gcode-preview', createGCodePreviewRoutes(serverState, broadcast));
  app.use('/api/gcode-job', createGCodeJobRoutes(filesDir, cncController, serverState, broadcast));

  // Fallback route for SPA - handle all non-API routes
  app.use((req, res, next) => {
    // Skip API routes and static assets
    if (req.path.startsWith('/api') || req.path.includes('.')) {
      return next();
    }

    // Serve index.html for all other routes (SPA routing)
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

  // Start server
  server.listen(port, '0.0.0.0', () => {
    log(`ncSender Server listening on port ${port}`);
    log(`HTTP API: http://localhost:${port}/api`);
    log(`WebSocket: ws://localhost:${port}`);
  });

  return {
    app,
    server,
    wss,
    port,
    close: () => {
      log('Shutting down server...');
      wss.close();
      server.close();
    }
  };
}
