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
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLogger, getLogsDir } from '../../core/logger.js';
import { getSetting, DEFAULT_SETTINGS } from '../../core/settings-manager.js';

const { log, error: logError } = createLogger('System');

export function createSystemRoutes(serverState, cncController, ensureSenderStatus = () => {}) {
  const router = Router();

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Get server info for pendant WiFi configuration
  router.get('/server-info', (req, res) => {
    try {
      // Get server port from settings
      const connectionSettings = getSetting('connection');
      const serverPort = connectionSettings?.serverPort ?? DEFAULT_SETTINGS.connection.serverPort;

      // Get local IP addresses (prefer non-internal IPv4)
      const interfaces = os.networkInterfaces();
      let serverIP = '';

      for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;
        for (const addr of addrs) {
          // Skip internal and IPv6 addresses
          if (addr.internal || addr.family !== 'IPv4') continue;
          // Prefer addresses that look like local network IPs
          if (addr.address.startsWith('192.168.') ||
              addr.address.startsWith('10.') ||
              addr.address.startsWith('172.')) {
            serverIP = addr.address;
            break;
          }
          // Use first non-internal IPv4 as fallback
          if (!serverIP) {
            serverIP = addr.address;
          }
        }
        if (serverIP.startsWith('192.168.') || serverIP.startsWith('10.')) break;
      }

      res.json({
        serverIP,
        serverPort,
        hostname: os.hostname()
      });
    } catch (error) {
      log('Error getting server info:', error);
      res.status(500).json({ error: 'Failed to get server info' });
    }
  });

  // Get server state
  router.get('/server-state', (req, res) => {
    try {
      // Create a safe copy of serverState without circular references
      ensureSenderStatus();

      const safeServerState = {
        jobLoaded: serverState.jobLoaded,
        machineState: serverState.machineState,
        senderStatus: serverState.senderStatus
        // Exclude cncController to avoid circular references
      };
      res.json(safeServerState);
    } catch (error) {
      log('Error getting server state:', error);
      res.status(500).json({ error: 'Failed to get server state' });
    }
  });

  // Get available USB ports
  router.get('/usb-ports', async (req, res) => {
    try {
      if (!cncController) {
        return res.status(503).json({ error: 'CNC controller not available' });
      }

      const ports = await cncController.listAvailablePorts();
      res.json(ports);
    } catch (error) {
      log('Error getting USB ports:', error);
      res.status(500).json({ error: 'Failed to get USB ports' });
    }
  });

  // Get list of available log files
  router.get('/logs', async (req, res) => {
    try {
      const logsDir = getLogsDir();

      if (!existsSync(logsDir)) {
        return res.json({ files: [] });
      }

      const files = await fs.readdir(logsDir);
      const logFiles = [];

      for (const file of files) {
        if (!file.endsWith('.log')) continue;

        const filePath = path.join(logsDir, file);
        const stats = await fs.stat(filePath);

        logFiles.push({
          name: file,
          size: stats.size,
          date: file.replace('.log', ''),
          modifiedAt: stats.mtime.toISOString()
        });
      }

      // Sort by date descending (newest first)
      logFiles.sort((a, b) => b.date.localeCompare(a.date));

      res.json({ files: logFiles, logsDir });
    } catch (error) {
      log('Error listing log files:', error);
      res.status(500).json({ error: 'Failed to list log files' });
    }
  });

  // Get content of a specific log file
  router.get('/logs/:filename', async (req, res) => {
    try {
      const { filename } = req.params;
      const maxSize = 5 * 1024 * 1024; // 5MB limit

      // Validate filename (only allow .log files, no path traversal)
      if (!filename.endsWith('.log') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      const logsDir = getLogsDir();
      const filePath = path.join(logsDir, filename);

      // Check file exists
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: 'Log file not found' });
      }

      // Check file size
      const stats = await fs.stat(filePath);
      if (stats.size > maxSize) {
        // For large files, only read the last 5MB
        const fd = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(maxSize);
        const startPos = stats.size - maxSize;
        await fd.read(buffer, 0, maxSize, startPos);
        await fd.close();
        const content = '... (file truncated, showing last 5MB) ...\n\n' + buffer.toString('utf8');
        return res.json({ filename, content, truncated: true, totalSize: stats.size });
      }

      const content = await fs.readFile(filePath, 'utf8');
      res.json({ filename, content });
    } catch (error) {
      log('Error reading log file:', error);
      res.status(500).json({ error: 'Failed to read log file' });
    }
  });

  // Download a log file
  router.get('/logs/:filename/download', async (req, res) => {
    try {
      const { filename } = req.params;

      // Validate filename
      if (!filename.endsWith('.log') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }

      const logsDir = getLogsDir();
      const filePath = path.join(logsDir, filename);

      if (!existsSync(filePath)) {
        return res.status(404).json({ error: 'Log file not found' });
      }

      const stats = await fs.stat(filePath);
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const stream = createReadStream(filePath);
      stream.pipe(res);
    } catch (error) {
      log('Error downloading log file:', error);
      res.status(500).json({ error: 'Failed to download log file' });
    }
  });

  return router;
}
