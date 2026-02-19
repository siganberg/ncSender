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

import { Router, json } from 'express';
import { SerialFileService } from './serial-file-service.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('ControllerFiles');

const largeBodyParser = json({ limit: '10mb' });

export function createControllerFilesRoutes(cncController) {
  const router = Router();
  const fileService = new SerialFileService(cncController);

  router.get('/', async (req, res) => {
    if (!cncController.isConnected) {
      return res.json({ files: [], status: 'not-connected' });
    }
    if (!cncController.lastStatus.hasSD) {
      return res.json({ files: [], status: 'no-storage' });
    }

    try {
      const files = await fileService.listFiles();
      res.json({ files, status: 'ok' });
    } catch (err) {
      logError('Failed to list controller files:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/run', async (req, res) => {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    try {
      await fileService.runFile(filename);
      res.json({ success: true });
    } catch (err) {
      logError('Failed to run controller file:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/delete', async (req, res) => {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    try {
      await fileService.deleteFile(filename);
      res.json({ success: true });
    } catch (err) {
      logError('Failed to delete controller file:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/read', async (req, res) => {
    const { filename } = req.query;
    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    try {
      const content = await fileService.readFile(filename);
      res.json({ content });
    } catch (err) {
      logError('Failed to read controller file:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/upload', largeBodyParser, async (req, res) => {
    const { filename, content } = req.body;
    if (!filename || content === undefined) {
      return res.status(400).json({ error: 'filename and content are required' });
    }
    if (cncController.connectionType === 'websocket') {
      return res.status(400).json({ error: 'File upload requires a USB or Ethernet connection (Ymodem is not supported over WebSocket)' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    try {
      await fileService.uploadFile(filename, content, (progress) => {
        res.write(`data: ${JSON.stringify({ type: 'progress', ...progress, status: 'uploading' })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    } catch (err) {
      logError('Failed to upload controller file:', err.message);
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    }
    res.end();
  });

  router.post('/save', largeBodyParser, async (req, res) => {
    const { filename, content } = req.body;
    if (!filename || content === undefined) {
      return res.status(400).json({ error: 'filename and content are required' });
    }
    if (cncController.connectionType === 'websocket') {
      return res.status(400).json({ error: 'File save requires a USB or Ethernet connection (Ymodem is not supported over WebSocket)' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    try {
      await fileService.saveFile(filename, content, (progress) => {
        res.write(`data: ${JSON.stringify({ type: 'progress', ...progress, status: 'uploading' })}\n\n`);
      });
      res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    } catch (err) {
      logError('Failed to save controller file:', err.message);
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    }
    res.end();
  });

  return router;
}
