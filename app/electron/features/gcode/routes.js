import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { saveSettings } from '../../core/settings-manager.js';
import { pluginManager } from '../../core/plugin-manager.js';
import { getUserDataDir } from '../../utils/paths.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

// Cache directory for G-code file (single file, always overwritten)
const PROCESSED_CACHE_DIR = path.join(getUserDataDir(), 'gcode-cache');
const CACHE_FILE_PATH = path.join(PROCESSED_CACHE_DIR, 'current.gcode');

// Ensure cache directory exists
async function ensureCacheDir() {
  try {
    await fs.mkdir(PROCESSED_CACHE_DIR, { recursive: true });
  } catch (error) {
    log('Failed to create cache directory:', error);
  }
}

function detectWorkspace(gcodeContent) {
  const lines = gcodeContent.split('\n');
  const workspacePattern = /\b(G5[4-9])\b/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('(') || trimmed.startsWith(';')) {
      continue;
    }

    const match = trimmed.match(workspacePattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

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

      // Read file content
      let content = await fs.readFile(finalPath, 'utf8');

      // Process through post-processor plugins (onGcodeProgramLoad event)
      const context = {
        filename: originalName,
        filePath: finalPath,
        sourceId: 'upload'
      };

      try {
        const processedContent = await pluginManager.getEventBus().emitChain('onGcodeProgramLoad', content, context);
        if (processedContent && typeof processedContent === 'string') {
          content = processedContent;
          log('G-code processed by post-processor plugins');
        }
      } catch (error) {
        log('Error processing G-code through plugins:', error);
        // Continue with original content if plugin processing fails
      }

      // Always cache G-code to disk (whether processed or not) to avoid memory issues with large files
      await ensureCacheDir();
      await fs.writeFile(CACHE_FILE_PATH, content, 'utf8');
      log('Cached G-code to:', CACHE_FILE_PATH);

      // Update server state - set jobLoaded with null status (file loaded but not started)
      serverState.jobLoaded = {
        filename: originalName,  // Original filename for display and API
        currentLine: 0,
        totalLines: content.split('\n').length,
        status: null,
        jobStartTime: null,
        jobEndTime: null,
        jobPauseAt: null,
        jobPausedTotalSec: 0,
        remainingSec: null,
        progressPercent: null,
        runtimeSec: null
      };

      // Save to settings for persistence
      saveSettings({ lastLoadedFile: originalName });

      // Detect workspace from G-code content
      const detectedWorkspace = detectWorkspace(content);

      // Broadcast G-code content to all connected clients for visualization
      const gcodeMessage = {
        filename: originalName,  // Use original filename for display
        content: content,
        detectedWorkspace: detectedWorkspace,
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
      log('Error uploading G-code file:', error);
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
      log('Error listing G-code files:', error);
      res.status(500).json({ error: 'Failed to list files' });
    }
  });

  // Get specific G-code file
  router.get('/:filename', async (req, res) => {
    try {
      const filename = decodeURIComponent(req.params.filename);
      const filePath = path.join(filesDir, filename);
      const content = await fs.readFile(filePath, 'utf8');
      res.json({ filename, content });
    } catch (error) {
      log('Error reading G-code file:', req.params.filename, error);
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Load specific G-code file (load into viewer)
  router.post('/:filename/load', async (req, res) => {
    try {
      const filename = req.params.filename;
      const filePath = path.join(filesDir, filename);
      let content = await fs.readFile(filePath, 'utf8');

      // Process through post-processor plugins (onGcodeProgramLoad event)
      const context = {
        filename: filename,
        filePath: filePath,
        sourceId: 'load'
      };

      try {
        const processedContent = await pluginManager.getEventBus().emitChain('onGcodeProgramLoad', content, context);
        if (processedContent && typeof processedContent === 'string') {
          content = processedContent;
          log('G-code processed by post-processor plugins');
        }
      } catch (error) {
        log('Error processing G-code through plugins:', error);
        // Continue with original content if plugin processing fails
      }

      // Always cache G-code to disk (whether processed or not) to avoid memory issues with large files
      await ensureCacheDir();
      await fs.writeFile(CACHE_FILE_PATH, content, 'utf8');
      log('Cached G-code to:', CACHE_FILE_PATH);

      // Update server state - set jobLoaded with null status (file loaded but not started)
      serverState.jobLoaded = {
        filename: filename,  // Original filename for display and API
        currentLine: 0,
        totalLines: content.split('\n').length,
        status: null,
        jobStartTime: null,
        jobEndTime: null,
        jobPauseAt: null,
        jobPausedTotalSec: 0,
        remainingSec: null,
        progressPercent: null,
        runtimeSec: null
      };

      // Save to settings for persistence
      saveSettings({ lastLoadedFile: filename });

      // Detect workspace from G-code content
      const detectedWorkspace = detectWorkspace(content);

      // Broadcast G-code content to all connected clients for visualization
      const gcodeMessage = {
        filename: filename,  // Use original filename for display
        content: content,
        detectedWorkspace: detectedWorkspace,
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
      log('Error loading G-code file:', error);
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
      log('Error deleting G-code file:', error);
      res.status(404).json({ error: 'File not found' });
    }
  });

  return router;
}
