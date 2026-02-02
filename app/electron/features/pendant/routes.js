/*
 * BLE Pendant API Routes
 *
 * Endpoints for scanning, connecting, and managing BLE pendant connections.
 */

import { Router } from 'express';
import { pendantController } from './pendant-controller.js';
import { createLogger } from '../../core/logger.js';
import { getSetting } from '../../core/settings-manager.js';

const { log, error: logError } = createLogger('BLE-API');

export function createPendantRoutes({ websocketLayer }) {
  const router = Router();

  // Helper to get BLE managers from pendant controller
  const getBlePendantManager = () => pendantController.getBlePendantManager();
  const getBleClientAdapter = () => pendantController.getBleClientAdapter();

  // Helper to check if a pendant is connected via WiFi/WebSocket
  const getWifiPendant = () => {
    if (!websocketLayer?.getClientRegistry) return null;
    const clients = websocketLayer.getClientRegistry();
    return clients.find(c => c.product === 'ncSenderPendant') || null;
  };

  // Get BLE adapter state and connected device info
  router.get('/status', async (req, res) => {
    const showPendant = getSetting('showPendant', false);
    const wifiPendant = getWifiPendant();
    const blePendantManager = getBlePendantManager();
    const bleClientAdapter = getBleClientAdapter();

    // If pendant feature is disabled, return minimal status
    if (!showPendant) {
      return res.json({
        adapterState: 'disabled',
        connectionState: 'idle',
        connectedDevice: null,
        wifiPendant: null,
        isAvailable: false,
        pendantConnectionType: null,
        activeConnectionType: null,
        pendantEnabled: false
      });
    }

    try {
      if (blePendantManager) {
        await blePendantManager.initialize();
      }

      const bleDevice = blePendantManager?.getConnectedDevice() || null;
      const bleClientMeta = bleClientAdapter?.getClientMeta() || null;

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
        adapterState: blePendantManager?.getAdapterState() || 'unavailable',
        connectionState: blePendantManager?.getState() || 'idle',
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
        isAvailable: blePendantManager?.isInitialized || false,
        pendantConnectionType,
        activeConnectionType,
        pendantEnabled: true
      });
    } catch (err) {
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
        pendantEnabled: true,
        error: err.message
      });
    }
  });

  // Start BLE scan for pendants
  router.post('/scan', async (req, res) => {
    try {
      const showPendant = getSetting('showPendant', false);
      if (!showPendant) {
        return res.status(503).json({
          error: 'Pendant feature is disabled. Enable it in Settings > Controls.',
          adapterState: 'disabled'
        });
      }

      const blePendantManager = getBlePendantManager();
      if (!blePendantManager) {
        return res.status(503).json({
          error: 'Bluetooth not initialized. Try toggling the Pendant setting.',
          adapterState: 'unavailable'
        });
      }

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
      const blePendantManager = getBlePendantManager();
      if (blePendantManager) {
        await blePendantManager.stopScan();
      }
      res.json({ status: 'stopped' });
    } catch (err) {
      logError('Stop scan failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Get discovered devices
  router.get('/devices', (req, res) => {
    const blePendantManager = getBlePendantManager();
    res.json({
      devices: blePendantManager?.getDiscoveredDevices() || []
    });
  });

  // Connect to a pendant
  router.post('/connect', async (req, res) => {
    try {
      const blePendantManager = getBlePendantManager();
      if (!blePendantManager) {
        return res.status(503).json({ error: 'Pendant feature is not enabled' });
      }

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
      const blePendantManager = getBlePendantManager();
      if (blePendantManager) {
        await blePendantManager.disconnect();
      }
      res.json({ status: 'disconnected' });
    } catch (err) {
      logError('Disconnect failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Send message to pendant (for testing)
  router.post('/send', async (req, res) => {
    try {
      const blePendantManager = getBlePendantManager();
      if (!blePendantManager) {
        return res.status(503).json({ error: 'Pendant feature is not enabled' });
      }

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

  // Get pendant device info via BLE
  router.get('/info', async (req, res) => {
    try {
      const blePendantManager = getBlePendantManager();
      if (!blePendantManager || !blePendantManager.isConnected()) {
        return res.status(400).json({ error: 'No BLE pendant connected' });
      }

      // Send get-info request and wait for response
      const info = await blePendantManager.requestInfo(5000);
      res.json(info);
    } catch (err) {
      logError('Get pendant info failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Activate pendant license via BLE
  router.post('/activate', async (req, res) => {
    try {
      const blePendantManager = getBlePendantManager();
      if (!blePendantManager) {
        return res.status(503).json({ error: 'Pendant feature is not enabled' });
      }

      const { installationId, deviceId } = req.body || {};
      if (!installationId) {
        return res.status(400).json({ error: 'installationId is required' });
      }
      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      if (!blePendantManager.isConnected()) {
        return res.status(400).json({ error: 'No BLE pendant connected' });
      }

      // Call activation server
      const ACTIVATION_API_URL = 'https://franciscreation.com/api/license/activate';
      const ACTIVATION_API_KEY = 'ncsp-2025-fc-api-key';

      log('Calling activation server for installationId:', installationId);

      const activationResponse = await fetch(ACTIVATION_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': ACTIVATION_API_KEY
        },
        body: JSON.stringify({
          installationId,
          machineHash: deviceId,
          product: 'ncSenderPendant'
        })
      });

      const activationText = await activationResponse.text();

      if (!activationResponse.ok) {
        let errorMessage = `Activation failed (HTTP ${activationResponse.status})`;
        try {
          const err = JSON.parse(activationText);
          if (err.error) errorMessage = err.error;
        } catch {}
        log('Activation server error:', errorMessage);
        return res.status(400).json({ error: errorMessage });
      }

      if (!activationText) {
        return res.status(500).json({ error: 'Activation server returned empty response' });
      }

      const licenseData = JSON.parse(activationText);
      log('Received license data from server');

      // Send license to pendant via BLE
      // The pendant expects: { type: 'pendant:activate', data: { license: <JSON string> } }
      await blePendantManager.send({
        type: 'pendant:activate',
        data: {
          license: JSON.stringify(licenseData)
        }
      });

      log('License sent to pendant via BLE');

      res.json({
        success: true,
        message: 'License activated successfully'
      });
    } catch (err) {
      logError('Activation failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Activate pendant license via WiFi (HTTP API)
  router.post('/activate-wifi', async (req, res) => {
    try {
      const { installationId, deviceId, pendantIp } = req.body || {};
      if (!installationId) {
        return res.status(400).json({ error: 'installationId is required' });
      }
      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }
      if (!pendantIp) {
        return res.status(400).json({ error: 'pendantIp is required' });
      }

      // Call activation server
      const ACTIVATION_API_URL = 'https://franciscreation.com/api/license/activate';
      const ACTIVATION_API_KEY = 'ncsp-2025-fc-api-key';

      log('Calling activation server for installationId:', installationId);

      const activationResponse = await fetch(ACTIVATION_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': ACTIVATION_API_KEY
        },
        body: JSON.stringify({
          installationId,
          machineHash: deviceId,
          product: 'ncSenderPendant'
        })
      });

      const activationText = await activationResponse.text();

      if (!activationResponse.ok) {
        let errorMessage = `Activation failed (HTTP ${activationResponse.status})`;
        try {
          const err = JSON.parse(activationText);
          if (err.error) errorMessage = err.error;
        } catch {}
        log('Activation server error:', errorMessage);
        return res.status(400).json({ error: errorMessage });
      }

      if (!activationText) {
        return res.status(500).json({ error: 'Activation server returned empty response' });
      }

      const licenseData = JSON.parse(activationText);
      log('Received license data from server');

      // Send license to pendant via HTTP API
      log('Sending license to pendant at:', pendantIp);
      const pendantResponse = await fetch(`http://${pendantIp}/api/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(licenseData),
        signal: AbortSignal.timeout(10000)
      });

      const pendantText = await pendantResponse.text();

      if (!pendantResponse.ok) {
        let errorMessage = `Pendant activation failed (HTTP ${pendantResponse.status})`;
        try {
          const err = JSON.parse(pendantText);
          if (err.error || err.message) errorMessage = err.error || err.message;
        } catch {}
        return res.status(400).json({ error: errorMessage });
      }

      log('License sent to pendant via WiFi');

      res.json({
        success: true,
        message: 'License activated successfully'
      });
    } catch (err) {
      logError('WiFi activation failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Get auto-connect settings
  router.get('/auto-connect', (req, res) => {
    const blePendantManager = getBlePendantManager();
    res.json({
      enabled: blePendantManager?.isAutoConnectEnabled() || false,
      lastDevice: blePendantManager?.getLastConnectedDevice() || null,
      reconnecting: blePendantManager?.autoReconnectRunning || false
    });
  });

  // Trigger auto-connect manually
  router.post('/auto-connect', async (req, res) => {
    try {
      const blePendantManager = getBlePendantManager();
      if (!blePendantManager) {
        return res.status(503).json({ error: 'Pendant feature is not enabled' });
      }

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
    const blePendantManager = getBlePendantManager();
    if (blePendantManager) {
      blePendantManager.clearLastConnectedDevice();
    }
    res.json({ status: 'cleared' });
  });

  return router;
}
