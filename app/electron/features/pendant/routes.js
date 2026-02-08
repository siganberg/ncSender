/*
 * Pendant API Routes
 *
 * Endpoints for WiFi and USB serial pendant status and license activation.
 */

import { Router } from 'express';
import { createLogger } from '../../core/logger.js';
import { getSetting } from '../../core/settings-manager.js';

const { log, error: logError } = createLogger('Pendant-API');

export function createPendantRoutes({ websocketLayer, pendantSerial }) {
  const router = Router();

  // Helper to check if a pendant is connected via WiFi/WebSocket
  const getWifiPendant = () => {
    if (!websocketLayer?.getClientRegistry) return null;
    const clients = websocketLayer.getClientRegistry();
    return clients.find(c => c.product === 'ncSenderPendant') || null;
  };

  // Get pendant status (includes both USB and WiFi)
  router.get('/status', async (req, res) => {
    const showPendant = getSetting('showPendant', false);
    const wifiPendant = getWifiPendant();
    const usbStatus = pendantSerial?.getStatus() || { connected: false };

    if (!showPendant) {
      return res.json({
        connectionState: 'idle',
        connectedDevice: null,
        usbPendant: null,
        wifiPendant: null,
        pendantConnectionType: null,
        activeConnectionType: null,
        pendantEnabled: false
      });
    }

    // Determine active connection (USB has priority)
    let activeConnectionType = null;
    if (usbStatus.connected) {
      activeConnectionType = 'usb';
    } else if (wifiPendant) {
      activeConnectionType = 'wifi';
    }

    let wifiLicensed = false;
    if (wifiPendant?.ip) {
      try {
        const infoResponse = await fetch(`http://${wifiPendant.ip}/api/info`, {
          signal: AbortSignal.timeout(3000)
        });
        if (infoResponse.ok) {
          const info = await infoResponse.json();
          wifiLicensed = info.licensed === true;
        }
      } catch {
        wifiLicensed = wifiPendant.licensed === true;
      }
    }

    res.json({
      connectionState: (usbStatus.connected || wifiPendant) ? 'connected' : 'idle',
      connectedDevice: null,
      usbPendant: usbStatus.connected ? {
        id: 'usb-pendant',
        name: 'Pendant (USB)',
        port: usbStatus.port,
        version: usbStatus.clientMeta?.version || null,
        licensed: usbStatus.clientMeta?.licensed || false,
        deviceId: usbStatus.clientMeta?.deviceId || null
      } : null,
      wifiPendant: wifiPendant ? {
        id: wifiPendant.clientId,
        name: 'Pendant (WiFi)',
        ip: wifiPendant.ip,
        version: wifiPendant.version,
        licensed: wifiLicensed
      } : null,
      pendantConnectionType: usbStatus.connected ? 'usb' : (wifiPendant ? 'wifi' : null),
      activeConnectionType,
      pendantEnabled: true
    });
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

  // Activate pendant license via USB serial
  router.post('/activate-usb', async (req, res) => {
    try {
      const { installationId } = req.body || {};
      if (!installationId) {
        return res.status(400).json({ error: 'installationId is required' });
      }

      if (!pendantSerial?.isConnected()) {
        return res.status(400).json({ error: 'USB pendant not connected' });
      }

      // Get device ID from USB pendant metadata (sent on connection)
      const usbStatus = pendantSerial.getStatus();
      const deviceId = usbStatus.clientMeta?.deviceId;

      if (!deviceId) {
        return res.status(400).json({ error: 'Device ID not available. Please reconnect the pendant.' });
      }

      // Call activation server
      const ACTIVATION_API_URL = 'https://franciscreation.com/api/license/activate';
      const ACTIVATION_API_KEY = 'ncsp-2025-fc-api-key';

      log('Calling activation server for USB pendant, installationId:', installationId);

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

      // Send license to pendant via USB serial
      const PENDANT_PLUGIN_ID = 'com.ncsender.wireless-pendant';
      const sent = pendantSerial.sendMessage(`plugin:${PENDANT_PLUGIN_ID}:license-data`, licenseData);

      if (!sent) {
        return res.status(500).json({ error: 'Failed to send license to pendant' });
      }
      log('License sent to pendant via USB serial');

      res.json({
        success: true,
        message: 'License activated successfully via USB'
      });
    } catch (err) {
      logError('USB activation failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Deactivate pendant license via WiFi (HTTP API)
  router.post('/deactivate-wifi', async (req, res) => {
    try {
      const { pendantIp } = req.body || {};
      if (!pendantIp) {
        return res.status(400).json({ error: 'pendantIp is required' });
      }

      log('Deactivating pendant license via WiFi at:', pendantIp);

      const pendantResponse = await fetch(`http://${pendantIp}/api/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });

      const pendantText = await pendantResponse.text();

      if (!pendantResponse.ok) {
        let errorMessage = `Deactivation failed (HTTP ${pendantResponse.status})`;
        try {
          const err = JSON.parse(pendantText);
          if (err.error || err.message) errorMessage = err.error || err.message;
        } catch {}
        return res.status(400).json({ error: errorMessage });
      }

      log('License deactivated via WiFi');

      res.json({
        success: true,
        message: 'License deactivated successfully'
      });
    } catch (err) {
      logError('WiFi deactivation failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Deactivate pendant license via USB serial
  router.post('/deactivate-usb', async (req, res) => {
    try {
      if (!pendantSerial?.isConnected()) {
        return res.status(400).json({ error: 'USB pendant not connected' });
      }

      log('Deactivating pendant license via USB');

      const PENDANT_PLUGIN_ID = 'com.ncsender.wireless-pendant';
      pendantSerial.sendMessage(`plugin:${PENDANT_PLUGIN_ID}:deactivate`, {});

      log('Deactivation command sent via USB serial');

      res.json({
        success: true,
        message: 'License deactivated successfully via USB'
      });
    } catch (err) {
      logError('USB deactivation failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // List available serial ports
  router.get('/serial/ports', async (req, res) => {
    try {
      const ports = pendantSerial ? await pendantSerial.listPorts() : [];
      res.json({
        ports: ports.map(p => ({
          path: p.path,
          manufacturer: p.manufacturer || null,
          serialNumber: p.serialNumber || null,
          vendorId: p.vendorId || null,
          productId: p.productId || null,
          friendlyName: p.friendlyName || null,
          pnpId: p.pnpId || null
        }))
      });
    } catch (err) {
      logError('Failed to list serial ports:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Get USB serial connection status
  router.get('/serial/status', (req, res) => {
    if (!pendantSerial) {
      return res.json({ connected: false, port: null });
    }
    res.json(pendantSerial.getStatus());
  });

  // Connect to USB serial pendant
  router.post('/serial/connect', async (req, res) => {
    if (!pendantSerial) {
      return res.status(500).json({ error: 'Serial handler not initialized' });
    }

    try {
      const { port } = req.body || {};
      const connected = await pendantSerial.connect(port || null);

      if (connected) {
        res.json({ success: true, message: 'Connected to pendant' });
      } else {
        res.status(400).json({ error: 'Failed to connect - port not found or unavailable' });
      }
    } catch (err) {
      logError('Serial connect failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Disconnect USB serial pendant
  router.post('/serial/disconnect', (req, res) => {
    if (!pendantSerial) {
      return res.status(500).json({ error: 'Serial handler not initialized' });
    }

    try {
      pendantSerial.disconnect();
      res.json({ success: true, message: 'Disconnected from pendant' });
    } catch (err) {
      logError('Serial disconnect failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
