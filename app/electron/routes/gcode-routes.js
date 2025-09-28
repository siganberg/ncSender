import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export function createGCodeRoutes(filesDir, upload, serverState, broadcast) {
  const router = Router();

  // Add (upload) G-code file
  router.post('/', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const originalName = req.file.originalname;
      const tempPath = req.file.path;
      const finalPath = path.join(filesDir, originalName);

      // Move file to final location with original name
      await fs.rename(tempPath, finalPath);

      // Read file content for validation
      const content = await fs.readFile(finalPath, 'utf8');

      // Update server state
      serverState.loadedGCodeProgram = originalName;

      // Broadcast to all connected clients
      const message = {
        type: 'gcode-updated',
        data: {
          filename: originalName,
          content: content,
          timestamp: new Date().toISOString()
        }
      };

      broadcast('gcode-updated', message.data);
      log('Broadcasting gcode-updated for file:', originalName);

      res.json({
        success: true,
        filename: originalName,
        message: 'File uploaded and clients notified'
      });
    } catch (error) {
      console.error('Error uploading G-code file:', error);
      res.status(500).json({ error: 'Failed to upload file' });
    }
  });

  // List G-code files
  router.get('/', async (req, res) => {
    try {
      const files = await fs.readdir(filesDir);
      const gcodeFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.gcode', '.nc', '.tap', '.txt'].includes(ext);
      });
      res.json(gcodeFiles);
    } catch (error) {
      console.error('Error listing G-code files:', error);
      res.status(500).json({ error: 'Failed to list files' });
    }
  });

  // Get specific G-code file
  router.get('/:filename', async (req, res) => {
    try {
      const filename = req.params.filename;
      const filePath = path.join(filesDir, filename);
      const content = await fs.readFile(filePath, 'utf8');
      res.json({ filename, content });
    } catch (error) {
      console.error('Error reading G-code file:', filename, 'from path:', filePath, error);
      res.status(404).json({ error: 'File not found' });
    }
  });

  return router;
}