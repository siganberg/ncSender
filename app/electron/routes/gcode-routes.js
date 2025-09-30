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

      // Broadcast G-code content to all connected clients for visualization
      const gcodeMessage = {
        filename: originalName,
        content: content,
        timestamp: new Date().toISOString()
      };
      broadcast('gcode-updated', gcodeMessage);

      // Broadcast server state update for button logic
      broadcast('server-state-updated', serverState);

      log('Broadcasting gcode-updated and server-state-updated for file:', originalName);

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

  // List G-code files with metadata
  router.get('/', async (req, res) => {
    try {
      const files = await fs.readdir(filesDir);
      const gcodeFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.gcode', '.nc', '.tap', '.txt'].includes(ext);
      });

      // Get file stats for each file
      const filesWithMetadata = await Promise.all(
        gcodeFiles.map(async (filename) => {
          const filePath = path.join(filesDir, filename);
          const stats = await fs.stat(filePath);
          return {
            name: filename,
            size: stats.size,
            uploadedAt: stats.mtime.toISOString()
          };
        })
      );

      // Sort by most recent first
      filesWithMetadata.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

      res.json({ files: filesWithMetadata });
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

  // Load specific G-code file (load into viewer)
  router.post('/:filename/load', async (req, res) => {
    try {
      const filename = req.params.filename;
      const filePath = path.join(filesDir, filename);
      const content = await fs.readFile(filePath, 'utf8');

      // Update server state
      serverState.loadedGCodeProgram = filename;

      // Broadcast G-code content to all connected clients for visualization
      const gcodeMessage = {
        filename: filename,
        content: content,
        timestamp: new Date().toISOString()
      };
      broadcast('gcode-updated', gcodeMessage);

      // Broadcast server state update for button logic
      broadcast('server-state-updated', serverState);

      log('Broadcasting gcode-updated and server-state-updated for file:', filename);

      res.json({
        success: true,
        filename: filename,
        message: 'File loaded and clients notified'
      });
    } catch (error) {
      console.error('Error loading G-code file:', error);
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Delete specific G-code file
  router.delete('/:filename', async (req, res) => {
    try {
      const filename = req.params.filename;
      const filePath = path.join(filesDir, filename);

      await fs.unlink(filePath);

      log('Deleted G-code file:', filename);

      res.json({
        success: true,
        filename: filename,
        message: 'File deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting G-code file:', error);
      res.status(404).json({ error: 'File not found' });
    }
  });

  return router;
}