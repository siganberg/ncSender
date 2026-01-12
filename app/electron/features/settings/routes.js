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
import { readSettings, saveSettings, DEFAULT_SETTINGS } from '../../core/settings-manager.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('Settings');

const VALID_CONNECTION_TYPES = ['usb', 'ethernet'];

export function createSettingsRoutes(serverState, cncController, broadcast) {
  const router = Router();

  // Get all settings
  router.get('/settings', (req, res) => {
    try {
      const settings = readSettings();
      if (settings === null) {
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
      const updates = req.body || {};
      const connectionUpdates = updates.connection;
      if (connectionUpdates && typeof connectionUpdates.connectionType === 'string' && !connectionUpdates.type) {
        connectionUpdates.type = connectionUpdates.connectionType;
        delete connectionUpdates.connectionType;
      }
      const connectionTypeUpdate = connectionUpdates?.type;

      if (connectionTypeUpdate && !VALID_CONNECTION_TYPES.includes(connectionTypeUpdate.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid connection type' });
      }

      if (connectionUpdates?.serverPort !== undefined) {
        const parsedServerPort = parseInt(connectionUpdates.serverPort, 10);
        if (isNaN(parsedServerPort) || parsedServerPort < 1024 || parsedServerPort > 65535) {
          return res.status(400).json({ error: 'Invalid server port. Must be between 1024-65535' });
        }
      }

      if (connectionUpdates?.port !== undefined && isNaN(parseInt(connectionUpdates.port, 10))) {
        return res.status(400).json({ error: 'Invalid machine port' });
      }

      if (connectionUpdates?.baudRate !== undefined && isNaN(parseInt(connectionUpdates.baudRate, 10))) {
        return res.status(400).json({ error: 'Invalid baud rate' });
      }

      const currentSettings = readSettings() || {};
      const mergedSettings = { ...currentSettings };

      for (const key in updates) {
        if (updates[key] && typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
          mergedSettings[key] = {
            ...currentSettings[key],
            ...updates[key]
          };

          for (const nestedKey in updates[key]) {
            if (updates[key][nestedKey] && typeof updates[key][nestedKey] === 'object' && !Array.isArray(updates[key][nestedKey])) {
              mergedSettings[key][nestedKey] = {
                ...currentSettings[key]?.[nestedKey],
                ...updates[key][nestedKey]
              };
            }
          }
        } else if (updates[key] !== undefined) {
          mergedSettings[key] = updates[key];
        }
      }

      if (mergedSettings.connection && typeof mergedSettings.connection === 'object') {
        const connection = mergedSettings.connection;
        if (typeof connection.type === 'string') {
          connection.type = connection.type.toLowerCase();
        }

        if (connection.port !== undefined) {
          const parsedPort = parseInt(connection.port, 10);
          if (!Number.isNaN(parsedPort)) {
            connection.port = parsedPort;
          }
        }

        if (connection.serverPort !== undefined) {
          const parsedServerPort = parseInt(connection.serverPort, 10);
          if (!Number.isNaN(parsedServerPort)) {
            connection.serverPort = parsedServerPort;
          }
        }

        if (connection.baudRate !== undefined) {
          const parsedBaudRate = parseInt(connection.baudRate, 10);
          if (!Number.isNaN(parsedBaudRate)) {
            connection.baudRate = parsedBaudRate;
          }
        }
      }

      const effectiveConnection = mergedSettings.connection || {};
      const effectiveType = typeof effectiveConnection.type === 'string'
        ? effectiveConnection.type.toLowerCase()
        : undefined;

      if (effectiveType === 'ethernet') {
        const ip = effectiveConnection.ip;
        const portValue = effectiveConnection.port;
        if (!ip || portValue === undefined || isNaN(parseInt(portValue, 10))) {
          return res.status(400).json({ error: 'IP address and port required for Ethernet connection' });
        }
      }

      if (effectiveType === 'usb') {
        if (!effectiveConnection.usbPort) {
          return res.status(400).json({ error: 'USB port required for USB connection' });
        }
        if (typeof effectiveConnection.baudRate !== 'number' || Number.isNaN(effectiveConnection.baudRate)) {
          return res.status(400).json({ error: 'Baud rate required for USB connection' });
        }
      }

      if (effectiveConnection.baudRate !== undefined && (typeof effectiveConnection.baudRate !== 'number' || Number.isNaN(effectiveConnection.baudRate))) {
        return res.status(400).json({ error: 'Invalid baud rate' });
      }

      if (mergedSettings.connection && mergedSettings.connection.baudRate === undefined) {
        mergedSettings.connection.baudRate = DEFAULT_SETTINGS.connection.baudRate;
      }

      const savedSettings = saveSettings(mergedSettings);

      const broadcastPayload = { ...updates };
      if (broadcastPayload.connection?.type) {
        broadcastPayload.connection = {
          ...broadcastPayload.connection,
          type: broadcastPayload.connection.type.toLowerCase()
        };
      }

      if (broadcastPayload.connection?.baudRate !== undefined) {
        const parsedBroadcastBaudRate = parseInt(broadcastPayload.connection.baudRate, 10);
        if (!Number.isNaN(parsedBroadcastBaudRate)) {
          broadcastPayload.connection.baudRate = parsedBroadcastBaudRate;
        }
      }

      broadcast('settings-changed', broadcastPayload);

      // Broadcast remote control state change if that setting was updated
      if (updates.remoteControl?.enabled !== undefined) {
        broadcast('remote-control-state', { enabled: updates.remoteControl.enabled });
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
      const payload = req.body || {};
      const { connection, ...rest } = payload;
      if (connection && typeof connection.connectionType === 'string' && !connection.type) {
        connection.type = connection.connectionType;
        delete connection.connectionType;
      }
      const connectionType = connection?.type;

      if (connectionType && !VALID_CONNECTION_TYPES.includes(connectionType.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid connection type' });
      }

      const normalizedConnectionType = connectionType?.toLowerCase();

      if (normalizedConnectionType === 'ethernet') {
        const ip = connection?.ip;
        const port = connection?.port;
        if (!ip || port === undefined || isNaN(parseInt(port, 10))) {
          return res.status(400).json({ error: 'IP address and port required for Ethernet connection' });
        }
      }

      if (normalizedConnectionType === 'usb') {
        if (!connection?.usbPort) {
          return res.status(400).json({ error: 'USB port required for USB connection' });
        }
      }

      if (connection?.serverPort !== undefined) {
        const parsedServerPort = parseInt(connection.serverPort, 10);
        if (isNaN(parsedServerPort) || parsedServerPort < 1024 || parsedServerPort > 65535) {
          return res.status(400).json({ error: 'Invalid server port. Must be between 1024-65535' });
        }
      }

      if (connection?.baudRate === undefined || isNaN(parseInt(connection.baudRate, 10))) {
        return res.status(400).json({ error: 'Baud rate required and must be numeric' });
      }

      const parsedBaudRate = parseInt(connection.baudRate, 10);
      const parsedPort = connection?.port !== undefined ? parseInt(connection.port, 10) : undefined;
      const parsedServerPort = connection?.serverPort !== undefined ? parseInt(connection.serverPort, 10) : undefined;

      const settingsPayload = {
        ...rest
      };

      if (connection) {
        settingsPayload.connection = {
          ...connection,
          type: normalizedConnectionType ?? connection.type,
          ...(parsedPort !== undefined ? { port: parsedPort } : {}),
          ...(parsedServerPort !== undefined ? { serverPort: parsedServerPort } : {}),
          baudRate: parsedBaudRate
        };
      }

      const savedSettings = saveSettings(settingsPayload);
      log('Settings saved:', savedSettings);

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
