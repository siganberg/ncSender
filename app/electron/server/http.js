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

export function mountHttp({
  app,
  log,
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
  commandProcessor
}) {
  app.use('/api', (req, _res, next) => {
    log(`API ${req.method} ${req.path}`, req.body && Object.keys(req.body).length > 0 ? req.body : '');
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
  app.use('/api/firmware', createFirmwareRoutes(cncController));
  app.use('/api/probe', createProbeRoutes(cncController, serverState, broadcast));
  app.use('/api', createMacroRoutes(cncController, commandProcessor));
  app.use('/api', createToolRoutes(cncController, serverState, commandProcessor));
  app.use('/api', createToolsRoutes(broadcast));
  app.use('/api/plugins', createPluginRoutes({ getClientWebSocket, broadcast }));

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
}
