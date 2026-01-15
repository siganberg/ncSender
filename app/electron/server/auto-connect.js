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

import { getSetting, DEFAULT_SETTINGS } from '../core/settings-manager.js';
import { createLogger } from '../core/logger.js';

const { log, error: logError } = createLogger('AutoConnect');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createAutoConnector({ cncController }) {
  let active = false;
  let loopPromise;
  let inhibited = false; // When true, start() is ignored (used during firmware flashing)

  let lastReconnectLog = 0;
  const reconnectLogThrottleMs = 30000;

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
        const now = Date.now();
        const shouldLog = now - lastReconnectLog > reconnectLogThrottleMs;

        if (cncController.connection || cncController.isConnecting) {
          if (shouldLog) {
            log('Disconnecting stale connection before retry...');
          }
          cncController.disconnect();
        }

        if (shouldLog) {
          log('Attempting to connect...');
          lastReconnectLog = now;
        }
        try {
          await cncController.connectWithSettings(currentSettings);
          if (cncController.isConnected) {
            log('Auto-connect successful');
            lastReconnectLog = 0;
          }
        } catch (error) {
          // Silent retry - errors are logged by controller with throttling
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
