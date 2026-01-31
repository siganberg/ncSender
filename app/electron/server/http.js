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

import path from 'node:path';
import express from 'express';
import { createSystemRoutes } from '../features/system/routes.js';
import { createSettingsRoutes } from '../features/settings/routes.js';
import { createAlarmRoutes } from '../features/alarms/routes.js';
import { createCNCRoutes } from '../features/cnc/routes.js';
import { createCommandHistoryRoutes } from '../features/command-history/routes.js';
import { createGCodeRoutes } from '../features/gcode/routes.js';
import { createGCodePreviewRoutes } from '../features/gcode/preview-routes.js';
import { createGCodeJobRoutes } from '../features/gcode/job-routes.js';
import { createFirmwareRoutes } from '../features/firmware/routes.js';
import { createProbeRoutes } from '../features/probe/routes.js';
import { createMacroRoutes } from '../features/macro/routes.js';
import { createToolRoutes } from '../features/tool/routes.js';
import { createToolsRoutes } from '../features/tools/routes.js';
import { createPluginRoutes } from '../features/plugins/routes.js';
import { createInitRoutes } from '../features/init/routes.js';
import { createPendantRoutes } from '../features/pendant/routes.js';
import { createLogger } from '../core/logger.js';

const { log, error: logError } = createLogger('HTTP');

export function mountHttp({
  app,
  clientDistPath,
  port,
  serverState,
  cncController,
  broadcast,
  getClientWebSocket,
  updateSenderStatus,
  commandHistory,
  maxHistorySize,
  filesDir,
  upload,
  commandProcessor,
  autoConnector,
  websocketLayer
}) {
  app.use('/api', (req, _res, next) => {
    // Skip logging for noisy polling endpoints
    if (req.path === '/pendant/status') {
      return next();
    }

    let logBody = '';
    if (req.body && Object.keys(req.body).length > 0) {
      // Filter out large fields like 'content' to avoid huge log entries
      const { content, ...rest } = req.body;
      if (content) {
        rest._content = `[${content.length} chars]`;
      }
      logBody = Object.keys(rest).length > 0 ? rest : '';
    }
    log(`API ${req.method} ${req.path}`, logBody);
    next();
  });

  app.use('/api', createSystemRoutes(serverState, cncController, updateSenderStatus));
  app.use('/api', createSettingsRoutes(serverState, cncController, broadcast));
  app.use('/api', createAlarmRoutes(serverState, cncController));
  app.use('/api', createCNCRoutes(cncController, broadcast, commandProcessor));
  app.use('/api/command-history', createCommandHistoryRoutes(commandHistory, maxHistorySize, broadcast));
  app.use('/api/gcode-files', createGCodeRoutes(filesDir, upload, serverState, broadcast));
  app.use('/api/gcode-preview', createGCodePreviewRoutes(serverState, broadcast));
  app.use('/api/gcode-job', createGCodeJobRoutes(filesDir, cncController, serverState, broadcast, commandProcessor));
  app.use('/api/firmware', createFirmwareRoutes(cncController, broadcast, autoConnector));
  app.use('/api/probe', createProbeRoutes(cncController, serverState, broadcast));
  app.use('/api', createMacroRoutes(cncController, commandProcessor));
  app.use('/api', createToolRoutes(cncController, serverState, commandProcessor));
  app.use('/api', createToolsRoutes(broadcast));
  app.use('/api/plugins', createPluginRoutes({ getClientWebSocket, broadcast }));
  app.use('/api', createInitRoutes(serverState, commandHistory));
  app.use('/api/pendant', createPendantRoutes({ websocketLayer }));

  log('Serving client files from:', clientDistPath);
  app.use(express.static(clientDistPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.obj')) {
        res.setHeader('Content-Type', 'text/plain');
      } else if (filePath.endsWith('.mtl')) {
        res.setHeader('Content-Type', 'text/plain');
      }
    }
  }));

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

  // Global error handler - catches Multer errors, route errors, etc.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    // Log the error with full details including stack trace for debugging
    logError(`${req.method} ${req.path}:`, err.message || err);
    if (err.stack) {
      logError('Stack trace:', err.stack);
    }

    // Determine appropriate status code
    let statusCode = err.status || err.statusCode || 500;
    let message = err.message || 'Internal server error';

    // Handle Multer-specific errors
    if (err.name === 'MulterError') {
      statusCode = 400;
      if (err.code === 'LIMIT_FILE_SIZE') {
        message = 'File too large. Maximum file size is 250MB.';
      }
    }

    // Send error response if headers haven't been sent
    if (!res.headersSent) {
      res.status(statusCode).json({ error: message });
    }
  });
}
