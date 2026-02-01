/*
 * BLE Pendant API Routes
 *
 * Endpoints for scanning, connecting, and managing BLE pendant connections.
 */

import { Router } from 'express';
import { blePendantManager } from './ble-manager.js';
import { bleClientAdapter } from './ble-client.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('BLE-API');

export function createPendantRoutes({ websocketLayer }) {
  const router = Router();

  // Helper to check if a pendant is connected via WiFi/WebSocket
  const getWifiPendant = () => {
    if (!websocketLayer?.getClientRegistry) return null;
    const clients = websocketLayer.getClientRegistry();
    return clients.find(c => c.product === 'ncSenderPendant') || null;
  };

  // Get BLE adapter state and connected device info
  router.get('/status', async (req, res) => {
    try {
      await blePendantManager.initialize();

      const bleDevice = blePendantManager.getConnectedDevice();
      const bleClientMeta = bleClientAdapter.getClientMeta();
      const wifiPendant = getWifiPendant();

      // Determine which connection type the pendant prefers/uses
      // The pendant's preferWifi setting determines which channel it actually uses
      let pendantConnectionType = null;
      let activeConnectionType = null;

      if (wifiPendant) {
        pendantConnectionType = 'wifi';
        // Check if pendant prefers WiFi (default true if not specified)
        const prefersWifi = wifiPendant.preferWifi !== false;
        activeConnectionType = prefersWifi ? 'wifi' : (bleDevice ? 'bluetooth' : 'wifi');
      } else if (bleDevice) {
        pendantConnectionType = 'bluetooth';
        activeConnectionType = 'bluetooth';
      }

      res.json({
        adapterState: blePendantManager.getAdapterState(),
        connectionState: blePendantManager.getState(),
        connectedDevice: bleDevice ? {
          ...bleDevice,
          version: bleClientMeta?.version || null
        } : null,
        wifiPendant: wifiPendant ? {
          id: wifiPendant.clientId,
          name: 'Pendant (WiFi)',
          ip: wifiPendant.ip,
          version: wifiPendant.version,
          preferWifi: wifiPendant.preferWifi !== false
        } : null,
        isAvailable: blePendantManager.isInitialized,
        pendantConnectionType,
        activeConnectionType
      });
    } catch (err) {
      const wifiPendant = getWifiPendant();
      const prefersWifi = wifiPendant ? wifiPendant.preferWifi !== false : true;
      res.json({
        adapterState: 'unavailable',
        connectionState: 'idle',
        connectedDevice: null,
        wifiPendant: wifiPendant ? {
          id: wifiPendant.clientId,
          name: 'Pendant (WiFi)',
          ip: wifiPendant.ip,
          version: wifiPendant.version,
          preferWifi: prefersWifi
        } : null,
        isAvailable: false,
        pendantConnectionType: wifiPendant ? 'wifi' : null,
        activeConnectionType: wifiPendant ? (prefersWifi ? 'wifi' : 'bluetooth') : null,
        error: err.message
      });
    }
  });

  // Start BLE scan for pendants
  router.post('/scan', async (req, res) => {
    try {
      const { duration = 10000 } = req.body || {};

      log('Scan request received');

      // Initialize BLE if not already done
      const ok = await blePendantManager.initialize();
      if (!ok) {
        return res.status(503).json({
          error: 'Bluetooth not available on this system',
          adapterState: 'unavailable'
        });
      }

      const state = blePendantManager.getAdapterState();
      log('Bluetooth state:', state);

      if (state !== 'poweredOn') {
        let message = 'Bluetooth is not available';
        if (state === 'disabled') {
          message = 'Bluetooth is disabled via DISABLE_BLE environment variable.';
        } else if (state === 'poweredOff') {
          message = 'Bluetooth is turned off. Please enable Bluetooth in System Preferences.';
        } else if (state === 'unauthorized') {
          message = 'Bluetooth access denied. Please grant Bluetooth permission in System Preferences > Privacy & Security > Bluetooth.';
        } else if (state === 'unknown') {
          message = 'Bluetooth adapter not detected or permission denied. On macOS, you may need to run ncSender and grant Bluetooth access when prompted.';
        } else if (state === 'unsupported' || state === 'uninitialized') {
          message = 'Bluetooth is disabled in standalone mode on macOS. Run as Electron app or set ENABLE_BLE=1 if Bluetooth permission is granted.';
        }
        return res.status(503).json({ error: message, adapterState: state });
      }

      log('Starting scan...');
      await blePendantManager.startScan(duration);
      log('Scan started');
      res.json({ status: 'scanning', duration });
    } catch (err) {
      logError('Scan failed:', err.message, err.stack);
      res.status(500).json({ error: err.message });
    }
  });

  // Stop BLE scan
  router.post('/scan/stop', async (req, res) => {
    try {
      await blePendantManager.stopScan();
      res.json({ status: 'stopped' });
    } catch (err) {
      logError('Stop scan failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Get discovered devices
  router.get('/devices', (req, res) => {
    res.json({
      devices: blePendantManager.getDiscoveredDevices()
    });
  });

  // Connect to a pendant
  router.post('/connect', async (req, res) => {
    try {
      const { deviceId } = req.body || {};
      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      await blePendantManager.connect(deviceId);

      res.json({
        status: 'connected',
        device: blePendantManager.getConnectedDevice()
      });
    } catch (err) {
      logError('Connect failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Disconnect from pendant
  router.post('/disconnect', async (req, res) => {
    try {
      await blePendantManager.disconnect();
      res.json({ status: 'disconnected' });
    } catch (err) {
      logError('Disconnect failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Send message to pendant (for testing)
  router.post('/send', async (req, res) => {
    try {
      const { message } = req.body || {};
      if (!message) {
        return res.status(400).json({ error: 'message is required' });
      }

      await blePendantManager.send(message);
      res.json({ status: 'sent' });
    } catch (err) {
      logError('Send failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Get auto-connect settings
  router.get('/auto-connect', (req, res) => {
    res.json({
      enabled: blePendantManager.isAutoConnectEnabled(),
      lastDevice: blePendantManager.getLastConnectedDevice(),
      reconnecting: blePendantManager.autoReconnectRunning
    });
  });

  // Trigger auto-connect manually
  router.post('/auto-connect', async (req, res) => {
    try {
      const connected = await blePendantManager.autoConnect();
      res.json({
        status: connected ? 'connected' : 'not_found',
        device: blePendantManager.getConnectedDevice()
      });
    } catch (err) {
      logError('Auto-connect failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Clear auto-connect (forget device)
  router.delete('/auto-connect', (req, res) => {
    blePendantManager.clearLastConnectedDevice();
    res.json({ status: 'cleared' });
  });

  return router;
}
