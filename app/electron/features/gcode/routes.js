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
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { saveSettings } from '../../core/settings-manager.js';
import { pluginManager } from '../../core/plugin-manager.js';
import { getUserDataDir, getSafePath, isValidName, getParentPath, generatePathId } from '../../utils/paths.js';
import { GCodePreAnalyzer } from './gcode-preanalyzer.js';
import { readMachineProfileFromCache } from '../firmware/machine-profile.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('GCode');

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

const GCODE_EXTENSIONS = ['.gcode', '.nc', '.tap', '.txt'];

function isGCodeFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return GCODE_EXTENSIONS.includes(ext);
}

// Calculate estimated run time for G-code content
async function calculateEstimate(content) {
  try {
    const profile = await readMachineProfileFromCache();
    const analyzer = new GCodePreAnalyzer({
      rapidMmPerMin: Math.min(
        ...(Object.values(profile.vmaxMmPerMin || {}).map(Number).filter(Number.isFinite)),
        6000
      ),
      defaultFeedMmPerMin: 1000,
      vmaxMmPerMin: profile.vmaxMmPerMin || null,
      accelMmPerSec2: profile.accelMmPerSec2 || null,
      junctionDeviationMm: profile.junctionDeviationMm || 0.01
    });
    const plan = analyzer.parse(content);
    return Math.round(plan.totalSec || 0);
  } catch (error) {
    log('Failed to calculate estimate:', error);
    return null;
  }
}

async function buildFileTree(dir, basePath = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    // Skip hidden files and folders
    if (entry.name.startsWith('.')) continue;

    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      items.push({
        id: generatePathId(relativePath),
        name: entry.name,
        type: 'folder',
        path: relativePath,
        children: await buildFileTree(fullPath, relativePath)
      });
    } else if (isGCodeFile(entry.name)) {
      const stats = await fs.stat(fullPath);
      items.push({
        id: generatePathId(relativePath),
        name: entry.name,
        type: 'file',
        path: relativePath,
        size: stats.size,
        uploadedAt: stats.mtime.toISOString()
      });
    }
  }

  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function deleteRecursive(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await deleteRecursive(fullPath);
    } else {
      await fs.unlink(fullPath);
    }
  }
  await fs.rmdir(dirPath);
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

      // Calculate estimated run time
      const estimatedSec = await calculateEstimate(content);
      if (estimatedSec) {
        log('Estimated run time:', Math.floor(estimatedSec / 60), 'min', estimatedSec % 60, 'sec');
      }

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
        runtimeSec: null,
        estimatedSec,
        isTemporary: false,  // Clear any previous transform state
        sourceFile: null     // Clear any previous transform source
      };

      // Save to settings for persistence
      saveSettings({ lastLoadedFile: originalName });

      // Detect workspace from G-code content
      const detectedWorkspace = detectWorkspace(content);

      // Get file stats for metadata
      const stats = await fs.stat(CACHE_FILE_PATH);

      // Broadcast G-code metadata to all connected clients (not full content)
      const gcodeMessage = {
        filename: originalName,
        totalLines: content.split('\n').length,
        size: stats.size,
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

  // Load G-code temporarily (cache only, no file save)
  // Used by plugins like Replicator to load generated code without polluting file manager
  router.post('/load-temp', async (req, res) => {
    try {
      const { content, filename, sourceFile } = req.body;

      if (!content || !filename) {
        return res.status(400).json({ error: 'Content and filename are required' });
      }

      // Write to cache only (not to gcode-files directory)
      await ensureCacheDir();
      await fs.writeFile(CACHE_FILE_PATH, content, 'utf8');
      log('Loaded temporary G-code to cache:', filename);

      // Calculate estimated run time
      const estimatedSec = await calculateEstimate(content);

      // Update server state
      serverState.jobLoaded = {
        filename: filename,
        sourceFile: sourceFile || null,  // Track original source for plugins
        currentLine: 0,
        totalLines: content.split('\n').length,
        status: null,
        jobStartTime: null,
        jobEndTime: null,
        jobPauseAt: null,
        jobPausedTotalSec: 0,
        remainingSec: null,
        progressPercent: null,
        runtimeSec: null,
        estimatedSec,
        isTemporary: true  // Mark as temporary/generated
      };

      // Don't save to lastLoadedFile settings (keep original)

      // Detect workspace from G-code content
      const detectedWorkspace = detectWorkspace(content);

      // Get file stats for metadata
      const stats = await fs.stat(CACHE_FILE_PATH);

      // Broadcast updates
      broadcast('gcode-updated', {
        filename: filename,
        sourceFile: sourceFile || null,
        totalLines: content.split('\n').length,
        size: stats.size,
        detectedWorkspace: detectedWorkspace,
        timestamp: new Date().toISOString(),
        isTemporary: true
      });
      broadcast('server-state-updated', serverState);

      log('Temporary G-code loaded:', filename, sourceFile ? `(source: ${sourceFile})` : '');

      res.json({
        success: true,
        filename: filename,
        sourceFile: sourceFile || null,
        message: 'Temporary G-code loaded'
      });
    } catch (error) {
      log('Error loading temporary G-code:', error);
      res.status(500).json({ error: 'Failed to load temporary G-code' });
    }
  });

  // List G-code files with metadata (returns tree structure)
  router.get('/', async (req, res) => {
    try {
      const tree = await buildFileTree(filesDir);
      res.json({ tree, storagePath: filesDir });
    } catch (error) {
      log('Error listing G-code files:', error);
      res.status(500).json({ error: 'Failed to list files' });
    }
  });

  // Create folder
  router.post('/folders', async (req, res) => {
    try {
      const { path: folderPath } = req.body;

      if (!folderPath) {
        return res.status(400).json({ error: 'Folder path is required' });
      }

      const safePath = getSafePath(filesDir, folderPath);
      await fs.mkdir(safePath, { recursive: true });

      log('Created folder:', folderPath);
      res.json({ success: true, path: folderPath });
    } catch (error) {
      if (error.message.includes('traversal') || error.message.includes('outside')) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      log('Error creating folder:', error);
      res.status(500).json({ error: 'Failed to create folder' });
    }
  });

  // Delete folder (recursive) - using POST with body for path support
  router.post('/folders/delete', async (req, res) => {
    try {
      const { path: folderPath } = req.body;

      if (!folderPath) {
        return res.status(400).json({ error: 'Folder path is required' });
      }

      const safePath = getSafePath(filesDir, folderPath);
      const stats = await fs.stat(safePath);

      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a folder' });
      }

      await deleteRecursive(safePath);

      log('Deleted folder:', folderPath);
      res.json({ success: true, path: folderPath });
    } catch (error) {
      if (error.message.includes('traversal') || error.message.includes('outside')) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      log('Error deleting folder:', error);
      res.status(500).json({ error: 'Failed to delete folder' });
    }
  });

  // Move file or folder
  router.post('/move', async (req, res) => {
    try {
      const { sourcePath, destinationPath } = req.body;

      if (!sourcePath || !destinationPath) {
        return res.status(400).json({ error: 'Source and destination paths are required' });
      }

      const safeSource = getSafePath(filesDir, sourcePath);
      const safeDestination = getSafePath(filesDir, destinationPath);

      // Ensure parent directory of destination exists
      const destParent = path.dirname(safeDestination);
      await fs.mkdir(destParent, { recursive: true });

      await fs.rename(safeSource, safeDestination);

      log('Moved:', sourcePath, '->', destinationPath);
      res.json({ success: true, newPath: destinationPath });
    } catch (error) {
      if (error.message.includes('traversal') || error.message.includes('outside')) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      log('Error moving item:', error);
      res.status(500).json({ error: 'Failed to move item' });
    }
  });

  // Rename file or folder
  router.post('/rename', async (req, res) => {
    try {
      const { path: itemPath, newName } = req.body;

      if (!itemPath || !newName) {
        return res.status(400).json({ error: 'Path and new name are required' });
      }

      if (!isValidName(newName)) {
        return res.status(400).json({ error: 'Invalid name' });
      }

      const safePath = getSafePath(filesDir, itemPath);
      const parentDir = path.dirname(safePath);
      const newPath = path.join(parentDir, newName);

      // Verify new path is still safe
      const resolvedBase = path.resolve(filesDir);
      const resolvedNew = path.resolve(newPath);
      if (!resolvedNew.startsWith(resolvedBase + path.sep)) {
        return res.status(400).json({ error: 'Invalid path' });
      }

      await fs.rename(safePath, newPath);

      const relativeNewPath = path.relative(filesDir, newPath);
      log('Renamed:', itemPath, '->', relativeNewPath);
      res.json({ success: true, newPath: relativeNewPath });
    } catch (error) {
      if (error.message.includes('traversal') || error.message.includes('outside')) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      log('Error renaming item:', error);
      res.status(500).json({ error: 'Failed to rename item' });
    }
  });

  // Stream current cached G-code file for download
  router.get('/current/download', async (req, res) => {
    try {
      const stats = await fs.stat(CACHE_FILE_PATH);
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Length', stats.size);
      const stream = createReadStream(CACHE_FILE_PATH);
      stream.pipe(res);
    } catch (error) {
      log('Error streaming cached G-code file:', error);
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Get specific G-code file (supports nested paths via query param)
  router.get('/file', async (req, res) => {
    try {
      const relativePath = req.query.path;
      if (!relativePath) {
        return res.status(400).json({ error: 'Path is required' });
      }
      const safePath = getSafePath(filesDir, relativePath);
      const content = await fs.readFile(safePath, 'utf8');
      res.json({ filename: relativePath, content });
    } catch (error) {
      if (error.message.includes('traversal') || error.message.includes('outside')) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      log('Error reading G-code file:', req.query.path, error);
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Load specific G-code file (supports nested paths via body)
  router.post('/load', async (req, res) => {
    try {
      const relativePath = req.body.path;
      if (!relativePath) {
        return res.status(400).json({ error: 'Path is required' });
      }
      const safePath = getSafePath(filesDir, relativePath);
      let content = await fs.readFile(safePath, 'utf8');

      // Process through post-processor plugins (onGcodeProgramLoad event)
      const context = {
        filename: relativePath,
        filePath: safePath,
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
      }

      await ensureCacheDir();
      await fs.writeFile(CACHE_FILE_PATH, content, 'utf8');
      log('Cached G-code to:', CACHE_FILE_PATH);

      // Calculate estimated run time
      const estimatedSec = await calculateEstimate(content);
      if (estimatedSec) {
        log('Estimated run time:', Math.floor(estimatedSec / 60), 'min', estimatedSec % 60, 'sec');
      }

      serverState.jobLoaded = {
        filename: relativePath,
        currentLine: 0,
        totalLines: content.split('\n').length,
        status: null,
        jobStartTime: null,
        jobEndTime: null,
        jobPauseAt: null,
        jobPausedTotalSec: 0,
        remainingSec: null,
        progressPercent: null,
        runtimeSec: null,
        estimatedSec,
        isTemporary: false,  // Clear any previous transform state
        sourceFile: null     // Clear any previous transform source
      };

      saveSettings({ lastLoadedFile: relativePath });

      const detectedWorkspace = detectWorkspace(content);
      const stats = await fs.stat(CACHE_FILE_PATH);

      const gcodeMessage = {
        filename: relativePath,
        totalLines: content.split('\n').length,
        size: stats.size,
        detectedWorkspace: detectedWorkspace,
        timestamp: new Date().toISOString()
      };
      broadcast('gcode-updated', gcodeMessage);
      broadcast('server-state-updated', serverState);

      log('Broadcasting gcode-updated and server-state-updated for file:', relativePath);

      res.json({
        success: true,
        filename: relativePath,
        message: 'File loaded and clients notified'
      });
    } catch (error) {
      if (error.message.includes('traversal') || error.message.includes('outside')) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      log('Error loading G-code file:', error);
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Save/update G-code file content at specific path
  router.post('/file/save', async (req, res) => {
    try {
      const { path: relativePath, content } = req.body;
      if (!relativePath) {
        return res.status(400).json({ error: 'Path is required' });
      }
      if (typeof content !== 'string') {
        return res.status(400).json({ error: 'Content is required' });
      }

      const safePath = getSafePath(filesDir, relativePath);

      // Ensure parent directory exists
      const parentDir = path.dirname(safePath);
      await fs.mkdir(parentDir, { recursive: true });

      // Write content to file
      await fs.writeFile(safePath, content, 'utf8');

      log('Saved G-code file:', relativePath);

      res.json({
        success: true,
        filename: relativePath,
        message: 'File saved successfully'
      });
    } catch (error) {
      if (error.message.includes('traversal') || error.message.includes('outside')) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      log('Error saving G-code file:', error);
      res.status(500).json({ error: 'Failed to save file' });
    }
  });

  // Delete specific G-code file (supports nested paths via body)
  router.post('/file/delete', async (req, res) => {
    try {
      const relativePath = req.body.path;
      if (!relativePath) {
        return res.status(400).json({ error: 'Path is required' });
      }
      const safePath = getSafePath(filesDir, relativePath);

      await fs.unlink(safePath);

      log('Deleted G-code file:', relativePath);

      res.json({
        success: true,
        filename: relativePath,
        message: 'File deleted successfully'
      });
    } catch (error) {
      if (error.message.includes('traversal') || error.message.includes('outside')) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      log('Error deleting G-code file:', error);
      res.status(404).json({ error: 'File not found' });
    }
  });

  return router;
}
