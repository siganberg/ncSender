import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { saveSettings } from '../../core/settings-manager.js';
import { getUserDataDir } from '../../utils/paths.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('GCodePreview');

export function createGCodePreviewRoutes(serverState, broadcast) {
  const router = Router();

  // Clear loaded G-code program from preview
  router.post('/clear', async (req, res) => {
    try {
      // Clear the loaded program from server state
      serverState.jobLoaded = null;

      // Clear from settings for persistence
      saveSettings({ lastLoadedFile: null });

      // Delete the cache file
      const cachePath = path.join(getUserDataDir(), 'gcode-cache', 'current.gcode');
      try {
        await fs.unlink(cachePath);
        log('Deleted cache file:', cachePath);
      } catch (error) {
        // Ignore if file doesn't exist
        if (error.code !== 'ENOENT') {
          log('Failed to delete cache file:', error);
        }
      }

      // Broadcast server state update to all connected clients
      broadcast('server-state-updated', serverState);

      log('G-code preview cleared and clients notified');

      res.json({
        success: true,
        message: 'G-code preview cleared and clients notified'
      });
    } catch (error) {
      log('Error clearing G-code preview:', error);
      res.status(500).json({ error: 'Failed to clear G-code preview' });
    }
  });

  return router;
}
