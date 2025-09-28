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

  // WebSocket connection handling
  wss.on('connection', (ws) => {
    log('Client connected');
    clients.add(ws);

    ws.on('message', (data) => {
      if (!jogManager) {
        return;
      }

      jogManager.handleMessage(ws, data).catch((error) => {
        log('Error handling jog message', error?.message || error);
      });
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
    ws.send(JSON.stringify({
      type: 'cnc-status',
      data: cncController.getConnectionStatus()
    }));

    // Send server state (includes machine state)
    ws.send(JSON.stringify({
      type: 'server-state-updated',
      data: serverState
    }));
  });

  // Broadcast function for real-time updates
  function broadcast(type, data) {
    const message = JSON.stringify({ type, data });
    clients.forEach(client => {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    });
  }

  jogManager = new JogSessionManager({
    cncController,
    broadcast,
    log
  });

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
