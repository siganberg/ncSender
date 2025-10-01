import { Router } from 'express';
import { saveSettings } from '../settings-manager.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export function createGCodePreviewRoutes(serverState, broadcast) {
  const router = Router();

  // Clear loaded G-code program from preview
  router.post('/clear', async (req, res) => {
    try {
      // Clear the loaded program from server state
      serverState.jobLoaded = null;

      // Clear from settings for persistence
      saveSettings({ lastLoadedFile: null });

      // Broadcast server state update to all connected clients
      broadcast('server-state-updated', serverState);

      log('G-code preview cleared and clients notified');

      res.json({
        success: true,
        message: 'G-code preview cleared and clients notified'
      });
    } catch (error) {
      console.error('Error clearing G-code preview:', error);
      res.status(500).json({ error: 'Failed to clear G-code preview' });
    }
  });

  return router;
}