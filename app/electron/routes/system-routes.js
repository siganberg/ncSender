import { Router } from 'express';

export function createSystemRoutes(serverState, cncController) {
  const router = Router();

  // Health check endpoint
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Get server state
  router.get('/server-state', (req, res) => {
    try {
      // Create a safe copy of serverState without circular references
      const safeServerState = {
        jobLoaded: serverState.jobLoaded,
        machineState: serverState.machineState
        // Exclude cncController to avoid circular references
      };
      res.json(safeServerState);
    } catch (error) {
      console.error('Error getting server state:', error);
      res.status(500).json({ error: 'Failed to get server state' });
    }
  });

  // Get available USB ports
  router.get('/usb-ports', async (req, res) => {
    try {
      if (!cncController) {
        return res.status(503).json({ error: 'CNC controller not available' });
      }

      const ports = await cncController.listAvailablePorts();
      res.json(ports);
    } catch (error) {
      console.error('Error getting USB ports:', error);
      res.status(500).json({ error: 'Failed to get USB ports' });
    }
  });

  return router;
}
