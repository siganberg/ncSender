/*
 * Pendant API Routes
 *
 * Endpoints for WiFi pendant status and license activation.
 */

import { Router } from 'express';
import { createLogger } from '../../core/logger.js';
import { getSetting } from '../../core/settings-manager.js';

const { log, error: logError } = createLogger('Pendant-API');

export function createPendantRoutes({ websocketLayer }) {
  const router = Router();

  // Helper to check if a pendant is connected via WiFi/WebSocket
  const getWifiPendant = () => {
    if (!websocketLayer?.getClientRegistry) return null;
    const clients = websocketLayer.getClientRegistry();
    return clients.find(c => c.product === 'ncSenderPendant') || null;
  };

  // Get pendant status
  router.get('/status', async (req, res) => {
    const showPendant = getSetting('showPendant', false);
    const clients = websocketLayer?.getClientRegistry?.() || [];
    const wifiPendant = getWifiPendant();

    if (!showPendant) {
      return res.json({
        connectionState: 'idle',
        connectedDevice: null,
        wifiPendant: null,
        pendantConnectionType: null,
        activeConnectionType: null,
        pendantEnabled: false
      });
    }

    res.json({
      connectionState: wifiPendant ? 'connected' : 'idle',
      connectedDevice: null,
      wifiPendant: wifiPendant ? {
        id: wifiPendant.clientId,
        name: 'Pendant (WiFi)',
        ip: wifiPendant.ip,
        version: wifiPendant.version,
        licensed: wifiPendant.licensed === true
      } : null,
      pendantConnectionType: wifiPendant ? 'wifi' : null,
      activeConnectionType: wifiPendant ? 'wifi' : null,
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

  return router;
}
