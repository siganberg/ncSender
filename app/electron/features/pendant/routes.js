/*
 * Pendant API Routes
 *
 * Endpoints for WiFi and USB serial pendant status and license activation.
 */

import { Router } from 'express';
import http from 'node:http';
import os from 'node:os';
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

  const uploadFirmwareOTA = (pendantIp, firmwareBuffer, onProgress) => {
    return new Promise((resolve, reject) => {
      const boundary = '----FirmwareOTA' + Date.now();
      const headerPart = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="firmware"; filename="firmware.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`
      );
      const footerPart = Buffer.from(`\r\n--${boundary}--\r\n`);
      const totalSize = headerPart.length + firmwareBuffer.length + footerPart.length;

      const url = new URL(`http://${pendantIp}/update`);
      const req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': totalSize
        },
        timeout: 120000
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(body || `HTTP ${res.statusCode}`));
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('OTA upload timed out')); });

      req.write(headerPart);

      const CHUNK_SIZE = 4096;
      let offset = 0;

      const writeChunks = () => {
        let ok = true;
        while (ok && offset < firmwareBuffer.length) {
          const end = Math.min(offset + CHUNK_SIZE, firmwareBuffer.length);
          ok = req.write(firmwareBuffer.subarray(offset, end));
          offset = end;
          onProgress(Math.round((offset / firmwareBuffer.length) * 100));
        }
        if (offset < firmwareBuffer.length) {
          req.once('drain', writeChunks);
        } else {
          req.write(footerPart);
          req.end();
        }
      };

      writeChunks();
    });
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

    // Determine active connection (WiFi/WebSocket has priority over USB)
    let activeConnectionType = null;
    if (wifiPendant) {
      activeConnectionType = 'wifi';
    } else if (usbStatus.connected) {
      activeConnectionType = 'usb';
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
      pendantConnectionType: wifiPendant ? 'wifi' : (usbStatus.connected ? 'usb' : null),
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

  // Check for firmware updates
  router.get('/firmware/check', async (req, res) => {
    try {
      const usbStatus = pendantSerial?.getStatus() || { connected: false };
      const wifiPendant = getWifiPendant();

      let currentVersion = null;
      let deviceModel = null;
      let connectionType = null;

      if (usbStatus.connected) {
        connectionType = 'usb';
        currentVersion = usbStatus.clientMeta?.version || null;
        deviceModel = usbStatus.clientMeta?.deviceModel || null;

        if (!deviceModel && pendantSerial.getPortVidPid) {
          const vidPid = await pendantSerial.getPortVidPid();
          if (vidPid) {
            deviceModel = (vidPid.vendorId === '303a' && vidPid.productId === '1001')
              ? 'ncsender' : 'pibot';
          }
        }
      } else if (wifiPendant) {
        connectionType = 'wifi';
        currentVersion = wifiPendant.version || null;

        if (wifiPendant.ip) {
          try {
            const infoResponse = await fetch(`http://${wifiPendant.ip}/api/info`, {
              signal: AbortSignal.timeout(3000)
            });
            if (infoResponse.ok) {
              const info = await infoResponse.json();
              deviceModel = info.deviceModel || null;
              if (!currentVersion) currentVersion = info.version || null;
            }
          } catch {
            log('Could not fetch device info from WiFi pendant');
          }
        }
      } else {
        return res.status(400).json({ error: 'No pendant connected' });
      }

      const ghResponse = await fetch(
        'https://api.github.com/repos/siganberg/ncSender.pendant.releases/releases/latest',
        {
          headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'ncSender' },
          signal: AbortSignal.timeout(10000)
        }
      );

      if (!ghResponse.ok) {
        return res.status(502).json({ error: 'Could not check for updates' });
      }

      const release = await ghResponse.json();
      const latestVersion = (release.tag_name || '').replace(/^v/, '');

      const updateAvailable = latestVersion
        ? (currentVersion ? currentVersion !== latestVersion : true)
        : false;

      res.json({
        currentVersion,
        latestVersion,
        updateAvailable,
        releaseNotes: release.body || '',
        publishedAt: release.published_at || null,
        deviceModel,
        connectionType
      });
    } catch (err) {
      logError('Firmware check failed:', err.message);
      res.status(500).json({ error: 'Could not check for updates' });
    }
  });

  // Flash firmware update via SSE
  router.post('/firmware/update', async (req, res) => {
    try {
      const usbStatus = pendantSerial?.getStatus() || { connected: false };
      const wifiPendant = getWifiPendant();
      const useWifi = !usbStatus.connected && wifiPendant?.ip;

      if (!usbStatus.connected && !wifiPendant) {
        return res.status(400).json({ error: 'No pendant connected' });
      }

      let deviceModel = null;

      if (usbStatus.connected) {
        deviceModel = usbStatus.clientMeta?.deviceModel || null;
        if (!deviceModel && pendantSerial.getPortVidPid) {
          const vidPid = await pendantSerial.getPortVidPid();
          if (vidPid) {
            deviceModel = (vidPid.vendorId === '303a' && vidPid.productId === '1001')
              ? 'ncsender' : 'pibot';
          }
        }
      } else if (wifiPendant?.ip) {
        try {
          const infoResponse = await fetch(`http://${wifiPendant.ip}/api/info`, {
            signal: AbortSignal.timeout(3000)
          });
          if (infoResponse.ok) {
            const info = await infoResponse.json();
            deviceModel = info.deviceModel || null;
          }
        } catch {
          log('Could not fetch device info from WiFi pendant');
        }
      }

      if (req.body?.deviceModel) {
        deviceModel = req.body.deviceModel;
      }

      if (!deviceModel) {
        return res.status(400).json({ error: 'Could not determine device model' });
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent({ type: 'progress', percent: 0, status: 'Fetching release info...' });

      const ghResponse = await fetch(
        'https://api.github.com/repos/siganberg/ncSender.pendant.releases/releases/latest',
        {
          headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'ncSender' },
          signal: AbortSignal.timeout(10000)
        }
      );

      if (!ghResponse.ok) {
        sendEvent({ type: 'error', message: 'Failed to fetch release info' });
        res.end();
        return;
      }

      const release = await ghResponse.json();
      const latestVersion = (release.tag_name || '').replace(/^v/, '');

      const assetName = `firmware_${deviceModel}_pendant_v${latestVersion}.bin`;
      const asset = (release.assets || []).find(a => a.name === assetName);

      if (!asset) {
        sendEvent({ type: 'error', message: `Firmware asset not found: ${assetName}` });
        res.end();
        return;
      }

      sendEvent({ type: 'progress', percent: 0, status: 'Downloading firmware...' });

      const dlResponse = await fetch(asset.browser_download_url, {
        headers: { 'User-Agent': 'ncSender' },
        signal: AbortSignal.timeout(60000)
      });

      if (!dlResponse.ok) {
        sendEvent({ type: 'error', message: 'Failed to download firmware' });
        res.end();
        return;
      }

      const arrayBuf = await dlResponse.arrayBuffer();
      const firmwareBuffer = Buffer.from(arrayBuf);

      log(`Downloaded firmware: ${assetName} (${firmwareBuffer.length} bytes)`);

      if (useWifi) {
        sendEvent({ type: 'progress', percent: 0, status: 'Uploading firmware via WiFi...' });

        await uploadFirmwareOTA(wifiPendant.ip, firmwareBuffer, (percent) => {
          sendEvent({ type: 'progress', percent, status: 'Uploading firmware via WiFi...' });
        });
      } else {
        sendEvent({ type: 'progress', percent: 0, status: 'Flashing firmware...' });

        await pendantSerial.flashFirmware(firmwareBuffer, (progress) => {
          sendEvent({ type: 'progress', percent: progress.percent, status: 'Flashing firmware...' });
        });
      }

      sendEvent({ type: 'complete', version: latestVersion });
      res.end();
    } catch (err) {
      logError('Firmware update failed:', err.message);
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        res.end();
      } catch {
        // Response may already be closed
      }
    }
  });

  // Flash firmware from user-provided .bin file via SSE
  router.post('/firmware/flash-file', async (req, res) => {
      try {
        const usbStatus = pendantSerial?.getStatus() || { connected: false };
        const wifiPendant = getWifiPendant();
        const useWifi = !usbStatus.connected && wifiPendant?.ip;

        if (!usbStatus.connected && !wifiPendant) {
          return res.status(400).json({ error: 'No pendant connected' });
        }

        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const firmwareBuffer = Buffer.concat(chunks);

        if (!firmwareBuffer.length) {
          return res.status(400).json({ error: 'No firmware data received' });
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const sendEvent = (data) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        log(`Flashing firmware from file (${firmwareBuffer.length} bytes)`);

        if (useWifi) {
          sendEvent({ type: 'progress', percent: 0, status: 'Uploading firmware via WiFi...' });

          await uploadFirmwareOTA(wifiPendant.ip, firmwareBuffer, (percent) => {
            sendEvent({ type: 'progress', percent, status: 'Uploading firmware via WiFi...' });
          });
        } else {
          sendEvent({ type: 'progress', percent: 0, status: 'Flashing firmware...' });

          await pendantSerial.flashFirmware(firmwareBuffer, (progress) => {
            sendEvent({ type: 'progress', percent: progress.percent, status: 'Flashing firmware...' });
          });
        }

        sendEvent({ type: 'complete', version: 'file' });
        res.end();
      } catch (err) {
        logError('Firmware flash from file failed:', err.message);
        try {
          res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
          res.end();
        } catch {
          // Response may already be closed
        }
      }
  });

  // Cancel an in-progress firmware flash
  router.post('/firmware/cancel', (req, res) => {
    if (pendantSerial?.cancelFlashFirmware) {
      pendantSerial.cancelFlashFirmware();
    }
    res.json({ success: true });
  });

  // Get host network info for WiFi settings push
  router.get('/wifi-info', (req, res) => {
    const interfaces = os.networkInterfaces();
    const ips = [];

    // Virtual/tunnel interface prefixes to exclude (macOS, Windows, Linux)
    const virtualPrefixes = [
      'bridge', 'utun', 'feth', 'veth', 'vmnet', 'docker', 'br-',
      'virbr', 'vbox', 'tun', 'tap', 'llw', 'awdl', 'ap',
      'isatap', 'teredo',
    ];

    for (const [name, addrs] of Object.entries(interfaces)) {
      const nameLower = name.toLowerCase();
      if (virtualPrefixes.some(p => nameLower.startsWith(p))) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          ips.push({ address: addr.address, interface: name });
        }
      }
    }

    // Sort RFC1918 addresses first
    ips.sort((a, b) => {
      const aPrivate = a.address.startsWith('192.168.') || a.address.startsWith('10.') || a.address.startsWith('172.');
      const bPrivate = b.address.startsWith('192.168.') || b.address.startsWith('10.') || b.address.startsWith('172.');
      if (aPrivate && !bPrivate) return -1;
      if (!aPrivate && bPrivate) return 1;
      return 0;
    });

    const serverPort = getSetting('connection.serverPort', 8090);
    res.json({ ips, serverPort });
  });

  // Push WiFi settings to pendant via USB serial
  router.post('/push-wifi', async (req, res) => {
    try {
      const { ssid, password, serverIP, serverPort } = req.body || {};

      if (!ssid) {
        return res.status(400).json({ error: 'SSID is required' });
      }

      if (!pendantSerial?.isConnected()) {
        return res.status(400).json({ error: 'USB pendant not connected' });
      }

      const result = await pendantSerial.pushWifiSettings({
        ssid,
        password: password || '',
        serverIP: serverIP || '192.168.1.100',
        serverPort: serverPort || 8090
      });

      if (result?.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: result?.error || 'Failed to push WiFi settings' });
      }
    } catch (err) {
      logError('Push WiFi settings failed:', err.message);
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
