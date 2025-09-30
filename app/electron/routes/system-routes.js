import { Router } from 'express';
import { getSetting, DEFAULT_SETTINGS, readSettings, saveSettings } from '../settings-manager.js';

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
      // Create a safe copy of serverState without circular references
      const safeServerState = {
        loadedGCodeProgram: serverState.loadedGCodeProgram,
        online: serverState.online,
        machineState: serverState.machineState,
        hasEverConnected: serverState.hasEverConnected
        // Exclude cncController to avoid circular references
      };
      res.json(safeServerState);
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

  // Get available USB ports
  router.get('/usb-ports', async (req, res) => {
    try {
      // Get the CNC controller instance from server state
      const cncController = serverState?.cncController;
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

  // Get all settings
  router.get('/settings', (req, res) => {
    try {
      const settings = readSettings();
      if (settings === null) {
        // No settings file exists, return 204 No Content
        return res.status(204).end();
      }
      res.json(settings);
    } catch (error) {
      console.error('Error getting settings:', error);
      res.status(500).json({ error: 'Failed to get settings' });
    }
  });

  // Save settings
  router.post('/settings', (req, res) => {
    try {
      const { connectionType, baudRate, ip, port, serverPort, usbPort } = req.body;

      // Validate settings
      if (connectionType && !['usb', 'ethernet'].includes(connectionType)) {
        return res.status(400).json({ error: 'Invalid connection type' });
      }

      if (baudRate && isNaN(parseInt(baudRate))) {
        return res.status(400).json({ error: 'Invalid baud rate' });
      }

      if (connectionType === 'ethernet') {
        if (!ip || !port || isNaN(parseInt(port))) {
          return res.status(400).json({ error: 'IP address and port required for Ethernet connection' });
        }
      }

      if (connectionType === 'usb') {
        if (!usbPort) {
          return res.status(400).json({ error: 'USB port required for USB connection' });
        }
      }

      if (serverPort && (isNaN(parseInt(serverPort)) || parseInt(serverPort) < 1024 || parseInt(serverPort) > 65535)) {
        return res.status(400).json({ error: 'Invalid server port. Must be between 1024-65535' });
      }

      // Read settings before save to detect connection-related changes
      const before = readSettings();
      const savedSettings = saveSettings(req.body);
      log('Settings saved:', savedSettings);

      // Intentionally no auto-reconnect here; a single background loop manages connection

      res.json({
        success: true,
        message: 'Settings saved successfully',
        settings: savedSettings
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      res.status(500).json({ error: 'Failed to save settings' });
    }
  });

  return router;
}
