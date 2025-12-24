import { getSetting, DEFAULT_SETTINGS } from '../core/settings-manager.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createAutoConnector({ cncController, log }) {
  let active = false;
  let loopPromise;
  let inhibited = false; // When true, start() is ignored (used during firmware flashing)

  const runLoop = async () => {
    let previousSettings = null;
    let firstIteration = true;

    while (active) {
      if (firstIteration) {
        firstIteration = false;
      } else {
        await sleep(1000);
        if (!active) break;
      }

      const rawConnection = getSetting('connection');
      if (!active) break;

      if (!rawConnection || typeof rawConnection.type !== 'string') {
        continue;
      }

      const normalizedType = rawConnection.type.toLowerCase();
      if (normalizedType !== 'usb' && normalizedType !== 'ethernet') {
        previousSettings = null;
        continue;
      }

      const sanitizedConnection = {
        type: normalizedType,
        ip: rawConnection.ip,
        port: rawConnection.port,
        serverPort: rawConnection.serverPort,
        usbPort: rawConnection.usbPort,
        baudRate: rawConnection.baudRate
      };
      const parsedBaudRate = parseInt(rawConnection.baudRate, 10);
      const sanitizedBaudRate = Number.isFinite(parsedBaudRate)
        ? parsedBaudRate
        : DEFAULT_SETTINGS.connection.baudRate;
      sanitizedConnection.baudRate = sanitizedBaudRate;

      const currentSettings = { connection: sanitizedConnection };

      const isSettingsComplete = sanitizedConnection.type === 'ethernet'
        ? (sanitizedConnection.ip && sanitizedConnection.port)
        : (sanitizedConnection.usbPort && sanitizedConnection.baudRate);

      if (!isSettingsComplete) {
        previousSettings = JSON.parse(JSON.stringify(currentSettings));
        continue;
      }

      const settingsChanged = !previousSettings
        || JSON.stringify(currentSettings) !== JSON.stringify(previousSettings);

      if (settingsChanged) {
        cncController.cancelConnection();
        if (cncController.isConnected) {
          cncController.disconnect();
        }

        try {
          await cncController.connectWithSettings(currentSettings);
          if (cncController.isConnected) {
            log('Auto-connect successful');
          }
        } catch (error) {
          // Expected – loop will retry after delay.
        }

        previousSettings = JSON.parse(JSON.stringify(currentSettings));
        continue;
      }

      if (!cncController.isConnected) {
        if (cncController.connection || cncController.isConnecting) {
          log('Disconnecting stale connection before retry...');
          cncController.disconnect();
        }

        log('Attempting to connect...');
        try {
          await cncController.connectWithSettings(currentSettings);
          if (cncController.isConnected) {
            log('Auto-connect successful');
          }
        } catch (error) {
          log('Connection attempt failed, will retry in 1 second');
        }
      }
    }
  };

  const start = () => {
    if (inhibited) {
      log('Auto-connector start ignored (inhibited for firmware flashing)');
      return;
    }
    if (active) return;
    active = true;
    loopPromise = runLoop().catch((error) => {
      log('Auto-connect loop terminated unexpectedly', error?.message || error);
    });
  };

  const stop = async () => {
    if (!active) return;
    active = false;
    cncController.cancelConnection();
    if (loopPromise) {
      try {
        await loopPromise;
      } catch (error) {
        log('Auto-connect loop stop error', error?.message || error);
      }
    }
    loopPromise = undefined;
  };

  const inhibit = () => {
    inhibited = true;
    log('Auto-connector inhibited');
  };

  const uninhibit = () => {
    inhibited = false;
    log('Auto-connector uninhibited');
  };

  const isActive = () => active;
  const isInhibited = () => inhibited;

  return { start, stop, inhibit, uninhibit, isActive, isInhibited };
}
