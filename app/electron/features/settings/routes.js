import { Router } from 'express';
import { readSettings, saveSettings } from '../../core/settings-manager.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export function createSettingsRoutes(serverState, cncController, broadcast) {
  const router = Router();

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
      log('Error getting settings:', error);
      res.status(500).json({ error: 'Failed to get settings' });
    }
  });

  // Get specific setting by name
  router.get('/settings/:name', (req, res) => {
    try {
      const { name } = req.params;
      const settings = readSettings();

      if (settings === null) {
        return res.status(404).json({ error: 'Settings not found' });
      }

      if (!(name in settings)) {
        return res.status(404).json({ error: `Setting '${name}' not found` });
      }

      res.json({ [name]: settings[name] });
    } catch (error) {
      log('Error getting setting:', error);
      res.status(500).json({ error: 'Failed to get setting' });
    }
  });

  // Update specific settings (partial update)
  router.patch('/settings', (req, res) => {
    try {
      const updates = req.body;

      // Validate updated fields only
      if (updates.connectionType && !['usb', 'ethernet'].includes(updates.connectionType)) {
        return res.status(400).json({ error: 'Invalid connection type' });
      }

      if (updates.baudRate && isNaN(parseInt(updates.baudRate))) {
        return res.status(400).json({ error: 'Invalid baud rate' });
      }

      if (updates.serverPort && (isNaN(parseInt(updates.serverPort)) || parseInt(updates.serverPort) < 1024 || parseInt(updates.serverPort) > 65535)) {
        return res.status(400).json({ error: 'Invalid server port. Must be between 1024-65535' });
      }

      // Read current settings and merge with updates
      const currentSettings = readSettings() || {};
      const mergedSettings = { ...currentSettings, ...updates };

      // Validate complete settings if connectionType is being updated
      if (updates.connectionType === 'ethernet') {
        const ip = updates.ip || currentSettings.ip;
        const port = updates.port || currentSettings.port;
        if (!ip || !port || isNaN(parseInt(port))) {
          return res.status(400).json({ error: 'IP address and port required for Ethernet connection' });
        }
      }

      if (updates.connectionType === 'usb') {
        const usbPort = updates.usbPort || currentSettings.usbPort;
        if (!usbPort) {
          return res.status(400).json({ error: 'USB port required for USB connection' });
        }
      }

      const savedSettings = saveSettings(mergedSettings);
      log('Settings updated:', updates);

      // Broadcast only the changed settings (delta/partial update)
      // Check if broadcast is explicitly disabled via query parameter
      const shouldBroadcast = req.query.broadcast !== 'false';
      if (broadcast && shouldBroadcast) {
        broadcast('settings-changed', updates);
      }

      res.json({
        success: true,
        message: 'Settings updated successfully',
        settings: savedSettings
      });
    } catch (error) {
      log('Error updating settings:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  // Save settings (complete replacement)
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
      log('Error saving settings:', error);
      res.status(500).json({ error: 'Failed to save settings' });
    }
  });

  return router;
}
