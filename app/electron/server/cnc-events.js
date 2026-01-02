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

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { saveSettings, removeSetting, getSetting } from '../core/settings-manager.js';
import { fetchAndSaveAlarmCodes } from '../features/alarms/routes.js';
import { initializeFirmwareOnConnection } from '../features/firmware/routes.js';
import { pluginManager } from '../core/plugin-manager.js';
import { grblAlarms } from '../features/cnc/grbl-alarms.js';
import { createLogger } from '../core/logger.js';

const { log, error: logError } = createLogger('CncEvents');

function getUserDataDir() {
  const platform = os.platform();
  const appName = 'ncSender';

  switch (platform) {
    case 'win32':
      return path.join(os.homedir(), 'AppData', 'Roaming', appName);
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', appName);
    case 'linux':
      return path.join(os.homedir(), '.config', appName);
    default:
      return path.join(os.homedir(), `.${appName}`);
  }
}

// Messages to filter from terminal broadcast
// Add keywords here to prevent them from appearing in terminal history
const FILTERED_BROADCAST_MESSAGES = [
  'RGBonToolChanged',
  'RGBonToolSelected',
  '[MSG:]'
];

function shouldFilterBroadcast(data) {
  if (typeof data !== 'string') {
    return false;
  }
  return FILTERED_BROADCAST_MESSAGES.some(filterTerm => data.includes(filterTerm));
}

export function registerCncEventHandlers({
  cncController,
  jobManager,
  context,
  broadcast,
  autoConnector,
  firmwareFilePath
}) {
  const { serverState, computeJobProgressFields } = context;

  const handleStatus = (data) => {
    const newOnlineStatus = data.status === 'connected' && data.isConnected;
    const statusChanged = serverState.machineState.connected !== newOnlineStatus;

    if (statusChanged) {
      serverState.machineState.connected = newOnlineStatus;
      log(`CNC controller connection status changed. Server state 'machineState.connected' is now: ${serverState.machineState.connected}`);
    }

    if (newOnlineStatus && statusChanged) {
      const greetingMessage = cncController.getGreetingMessage();
      if (greetingMessage) {
        serverState.greetingMessage = greetingMessage;
        log('Stored GRBL greeting:', greetingMessage);
      }

      (async () => {
        try {
          log('Initializing firmware after controller connection...');
          await initializeFirmwareOnConnection(cncController);
          log('Firmware initialization complete');

          // Get $22 (homing cycle) setting value for client
          try {
            const firmwareData = JSON.parse(await fs.readFile(firmwareFilePath, 'utf8'));
            const setting22 = firmwareData.settings?.['22'];
            // Store raw value, default to 7 (enabled + single axis + startup required) if not found
            serverState.machineState.homeCycle = setting22?.value !== undefined ? parseInt(setting22.value, 10) : 7;
            log(`Home cycle ($22): ${serverState.machineState.homeCycle}`);
          } catch (error) {
            // Default to 7 (homing enabled + startup required) if we can't read firmware settings
            serverState.machineState.homeCycle = 7;
            log('Could not read $22 setting, defaulting homeCycle to 7');
          }
        } catch (error) {
          log('Failed to initialize firmware on connection:', error?.message || error);
        }
      })();
    }

    if (data.status === 'disconnected' || data.status === 'cancelled') {
      log('Connection lost, starting reconnection attempts...');
      autoConnector.start();
    }

    if (statusChanged) {
      broadcast('server-state-updated', serverState);
    }
  };

  const handleFirmwareAck = async (event) => {
    try {
      const cmd = String(event?.command || '').trim();
      const match = cmd.match(/^\$(\d+)=\s*(.+)$/);
      if (!match) return;
      const id = match[1];
      const value = match[2];

      let firmwareData;
      try {
        const text = await fs.readFile(firmwareFilePath, 'utf8');
        firmwareData = JSON.parse(text);
      } catch (error) {
        firmwareData = { version: '1.0', timestamp: new Date().toISOString(), groups: {}, settings: {} };
      }

      if (!firmwareData.settings) firmwareData.settings = {};

      // Check if value actually changed
      const oldValue = firmwareData.settings[id]?.value;
      const newValue = String(value);
      const valueChanged = oldValue !== newValue;

      if (!firmwareData.settings[id]) {
        // Setting doesn't exist - create minimal entry
        firmwareData.settings[id] = { id: parseInt(id, 10), value: newValue };
      } else {
        // Setting exists - preserve ALL existing properties (name, unit, dataType, format, min, max, halDetails, group, etc.)
        // Only update the value property to avoid losing metadata
        firmwareData.settings[id] = {
          ...firmwareData.settings[id],
          value: newValue
        };
      }
      firmwareData.timestamp = new Date().toISOString();

      try {
        await fs.mkdir(path.dirname(firmwareFilePath), { recursive: true });
      } catch (error) {
        log('Failed to ensure firmware directory exists:', error?.message || error);
      }
      await fs.writeFile(firmwareFilePath, JSON.stringify(firmwareData, null, 2), 'utf8');
      log(`Updated firmware.json setting $${id}=${value}`);

      // Check if setting requires restart and value actually changed
      if (valueChanged && firmwareData.settings[id]?.halDetails?.[7] === '1') {
        const restartMessage = `(Setting $${id} changed - Controller restart required for changes to take effect)`;
        broadcast('cnc-data', restartMessage);
      }

      // Update homeCycle if $22 changed
      if (id === '22' && valueChanged) {
        serverState.machineState.homeCycle = parseInt(newValue, 10);
        log(`$22 changed - homeCycle: ${serverState.machineState.homeCycle}`);
        broadcast('server-state-updated', serverState);
      }
    } catch (error) {
      log('Failed to update firmware.json from command-ack:', error?.message || error);
    }
  };

  const handleData = (data, sourceId) => {
    if (sourceId === 'system') {
      return;
    }
    if (!data || (typeof data === 'string' && data.trim() === '')) {
      return;
    }
    if (shouldFilterBroadcast(data)) {
      return;
    }
    // Filter out greeting messages - they will be sent to late-joining clients only
    if (typeof data === 'string' && data.toLowerCase().startsWith('grbl')) {
      return;
    }
    broadcast('cnc-data', data);
    pluginManager.getEventBus().emitAsync('ws:cnc-data', data);
  };

  const handleStatusReport = async (status) => {
    const prevMachineState = { ...serverState.machineState };

    serverState.machineState = { ...serverState.machineState, ...status };

    const currentMachineStatus = status?.status?.toLowerCase();
    const prevMachineStatus = prevMachineState?.status;

    // If entering alarm state, include alarm code and description in machineState
    if (currentMachineStatus === 'alarm') {
      const lastAlarmCode = getSetting('lastAlarmCode');

      if (typeof lastAlarmCode === 'number') {
        serverState.machineState.alarmCode = lastAlarmCode;

        // Look up alarm description
        let description = null;
        try {
          const alarmsFilePath = path.join(getUserDataDir(), 'alarms.json');
          const alarmsText = await fs.readFile(alarmsFilePath, 'utf8');
          const alarms = JSON.parse(alarmsText);
          description = alarms[lastAlarmCode];
        } catch (err) {
          // Fall back to standard GRBL alarms
        }

        if (!description) {
          description = grblAlarms[lastAlarmCode] || 'Unknown Alarm';
        }

        serverState.machineState.alarmDescription = description;
        log(`Machine in alarm state - Code: ${lastAlarmCode}, Description: ${description}`);
      } else {
        // No alarm code saved, but machine is in alarm state
        serverState.machineState.alarmCode = null;
        serverState.machineState.alarmDescription = 'Unknown Alarm';
        log('Machine in alarm state but no alarm code saved');
      }
    } else {
      // Not in alarm state - clear alarm info from machineState and settings
      delete serverState.machineState.alarmCode;
      delete serverState.machineState.alarmDescription;

      // Clear lastAlarmCode from settings when exiting alarm state
      const lastAlarmCode = getSetting('lastAlarmCode');
      if (lastAlarmCode !== undefined && lastAlarmCode !== null) {
        await removeSetting('lastAlarmCode');
        log('Cleared lastAlarmCode from settings (machine not in alarm state)');
      }
    }

    const hasChanged = JSON.stringify(prevMachineState) !== JSON.stringify(serverState.machineState);

    if (currentMachineStatus === 'alarm' && prevMachineStatus !== 'alarm' && jobManager.hasActiveJob()) {
      log('Machine entered alarm state, resetting job manager');
      jobManager.forceReset();
    }

    if (hasChanged) {
      broadcast('server-state-updated', serverState);
    }
  };

  const handleSystemMessage = (message) => {
    broadcast('cnc-system-message', message);
    pluginManager.getEventBus().emitAsync('ws:cnc-system-message', message);
  };

  const handleResponse = (response) => {
    broadcast('cnc-response', response);
    pluginManager.getEventBus().emitAsync('ws:cnc-response', response);
  };

  const handleCncError = async (errorData) => {
    try {
      let enrichedErrorData = { ...errorData };

      // If this is an alarm with a code, save it and look up description
      if (errorData.code === 'ALARM' && typeof errorData.alarmCode === 'number') {
        const alarmCode = errorData.alarmCode;

        // Save alarm code to settings for display purposes
        await saveSettings({ lastAlarmCode: alarmCode });
        log(`Saved alarm code ${alarmCode} to settings`);

        let description = null;

        // Try to read alarm descriptions from alarms.json (controller-specific)
        try {
          const alarmsFilePath = path.join(getUserDataDir(), 'alarms.json');
          const alarmsText = await fs.readFile(alarmsFilePath, 'utf8');
          const alarms = JSON.parse(alarmsText);
          description = alarms[alarmCode];

          if (description) {
            log(`Alarm ${alarmCode} description from alarms.json: ${description}`);
          }
        } catch (err) {
          // alarms.json doesn't exist or can't be read, will use fallback
          log('Could not read alarm descriptions from alarms.json, using fallback:', err.message);
        }

        // If no description from alarms.json, use standard GRBL fallback
        if (!description) {
          description = grblAlarms[alarmCode];
          if (description) {
            log(`Alarm ${alarmCode} description from fallback: ${description}`);
          } else {
            description = 'Unknown Alarm';
            log(`Alarm ${alarmCode} has no description in fallback`);
          }
        }

        enrichedErrorData.alarmDescription = description;
      }

      // Broadcast alarm to frontend with description
      broadcast('cnc-error', enrichedErrorData);
    } catch (error) {
      log('Failed to broadcast cnc-error:', error);
    }
  };

  const handleUnlock = async () => {
    // Clear saved alarm code when unlocking
    await removeSetting('lastAlarmCode');
  };

  const handleStop = () => {
    log('Stop command detected, resetting job manager');
    const hadActiveJob = jobManager.hasActiveJob();
    jobManager.forceReset();

    const jobWasMarkedRunning = serverState.jobLoaded?.status === 'running' || serverState.jobLoaded?.status === 'paused';

    if (serverState.jobLoaded && (hadActiveJob || jobWasMarkedRunning)) {
      const nowIso = new Date().toISOString();

      if (serverState.jobLoaded.jobPauseAt) {
        const pauseMs = Date.parse(nowIso) - Date.parse(serverState.jobLoaded.jobPauseAt);
        if (Number.isFinite(pauseMs) && pauseMs > 0) {
          const add = Math.round(pauseMs / 1000);
          serverState.jobLoaded.jobPausedTotalSec = (serverState.jobLoaded.jobPausedTotalSec || 0) + add;
        }
      }

      serverState.jobLoaded = {
        ...serverState.jobLoaded,
        status: 'stopped',
        jobEndTime: nowIso,
        jobPauseAt: null,
        remainingSec: null,
        progressPercent: null,
        runtimeSec: null
      };
    }

    // Reset isToolChanging flag on soft reset
    if (serverState.machineState.isToolChanging) {
      log('Resetting isToolChanging -> false (soft reset)');
      serverState.machineState.isToolChanging = false;
    }

    computeJobProgressFields();
    broadcast('server-state-updated', serverState);
  };

  const handlePause = () => {
    log('Pause command detected');
    if (serverState.jobLoaded) {
      serverState.jobLoaded.status = 'paused';
      if (!serverState.jobLoaded.jobPauseAt) {
        serverState.jobLoaded.jobPauseAt = new Date().toISOString();
      }
    }

    computeJobProgressFields();
    broadcast('server-state-updated', serverState);
  };

  const handleResume = () => {
    log('Resume command detected');

    if (!jobManager.hasActiveJob()) {
      log('Resume command ignored - no active job');
      return;
    }

    if (serverState.jobLoaded) {
      serverState.jobLoaded.status = 'running';
      if (serverState.jobLoaded.jobPauseAt) {
        const nowIso = new Date().toISOString();
        const pauseMs = Date.parse(nowIso) - Date.parse(serverState.jobLoaded.jobPauseAt);
        if (Number.isFinite(pauseMs) && pauseMs > 0) {
          const add = Math.round(pauseMs / 1000);
          serverState.jobLoaded.jobPausedTotalSec = (serverState.jobLoaded.jobPausedTotalSec || 0) + add;
        }
        serverState.jobLoaded.jobPauseAt = null;
        serverState.jobLoaded.jobEndTime = null;
      }
    }

    computeJobProgressFields();
    broadcast('server-state-updated', serverState);
  };

  const handleToolChangeComplete = (message) => {
    log('Tool change completion message received:', message);
    if (serverState.machineState.isToolChanging) {
      log('Resetting isToolChanging -> false (tool change complete)');
      serverState.machineState.isToolChanging = false;
      broadcast('server-state-updated', serverState);
    }
  };

  const jobCompleteCallback = (reason, finalJobStatus) => {
    log('Job lifecycle ended:', reason);

    const finalLine = finalJobStatus?.currentLine;

    if (serverState.jobLoaded) {
      const totalLines = serverState.jobLoaded.totalLines;

      if (reason === 'completed') {
        serverState.jobLoaded.status = 'completed';
        if (typeof totalLines === 'number' && totalLines > 0) {
          serverState.jobLoaded.currentLine = totalLines;
          log(`Job completed: setting currentLine to ${totalLines} (total lines)`);
        }
      } else if (reason === 'stopped') {
        serverState.jobLoaded.status = 'stopped';
        if (typeof finalLine === 'number' && finalLine > 0) {
          serverState.jobLoaded.currentLine = finalLine;
          log(`Job stopped: preserving currentLine at ${finalLine}`);
        }
      }
    }

    const nowIso = new Date().toISOString();
    if (serverState.jobLoaded) {
      if (serverState.jobLoaded.jobPauseAt) {
        const pauseMs = Date.parse(nowIso) - Date.parse(serverState.jobLoaded.jobPauseAt);
        if (Number.isFinite(pauseMs) && pauseMs > 0) {
          const add = Math.round(pauseMs / 1000);
          serverState.jobLoaded.jobPausedTotalSec = (serverState.jobLoaded.jobPausedTotalSec || 0) + add;
        }
        serverState.jobLoaded.jobPauseAt = null;
      }
      serverState.jobLoaded.jobEndTime = nowIso;
    }
    computeJobProgressFields();
    broadcast('server-state-updated', serverState);
  };

  cncController.on('status', handleStatus);
  cncController.on('command-ack', handleFirmwareAck);
  cncController.on('data', handleData);
  cncController.on('status-report', handleStatusReport);
  cncController.on('system-message', handleSystemMessage);
  cncController.on('response', handleResponse);
  cncController.on('cnc-error', handleCncError);
  cncController.on('unlock', handleUnlock);
  cncController.on('stop', handleStop);
  cncController.on('pause', handlePause);
  cncController.on('resume', handleResume);
  cncController.on('tool-change-complete', handleToolChangeComplete);

  jobManager.setJobCompleteCallback(jobCompleteCallback);

  const teardown = () => {
    cncController.off?.('status', handleStatus);
    cncController.off?.('command-ack', handleFirmwareAck);
    cncController.off?.('data', handleData);
    cncController.off?.('status-report', handleStatusReport);
    cncController.off?.('system-message', handleSystemMessage);
    cncController.off?.('response', handleResponse);
    cncController.off?.('cnc-error', handleCncError);
    cncController.off?.('unlock', handleUnlock);
    cncController.off?.('stop', handleStop);
    cncController.off?.('pause', handlePause);
    cncController.off?.('resume', handleResume);
    cncController.off?.('tool-change-complete', handleToolChangeComplete);
    jobManager.setJobCompleteCallback(null);
  };

  return { teardown };
}
