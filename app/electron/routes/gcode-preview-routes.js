import { Router } from 'express';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export function createGCodePreviewRoutes(serverState, broadcast) {
  const router = Router();

  // Clear loaded G-code program from preview
  router.post('/clear', async (req, res) => {
    try {
      // Clear the loaded program from server state
      serverState.loadedGCodeProgram = null;

      // Broadcast clear event to all connected clients
      broadcast('gcode-cleared', {
        timestamp: new Date().toISOString()
      });

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