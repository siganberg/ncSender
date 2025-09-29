import { Router } from 'express';
import { getSetting, DEFAULT_SETTINGS } from '../settings-manager.js';

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

  // Get server configuration (port, etc.)
  router.get('/server-config', (req, res) => {
    try {
      const serverPort = getSetting('serverPort', DEFAULT_SETTINGS.serverPort);
      res.json({
        serverPort,
        version: '0.1.0'
      });
    } catch (error) {
      console.error('Error getting server config:', error);
      res.status(500).json({ error: 'Failed to get server config' });
    }
  });

  return router;
}