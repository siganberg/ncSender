import { Router } from 'express';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export function createSystemRoutes(serverState) {
  const router = Router();

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Get server state
  router.get('/server-state', (req, res) => {
    try {
      res.json(serverState);
    } catch (error) {
      console.error('Error getting server state:', error);
      res.status(500).json({ error: 'Failed to get server state' });
    }
  });

  return router;
}