import path from 'node:path';
import fs from 'node:fs/promises';
import { saveSettings, removeSetting } from '../core/settings-manager.js';
import { fetchAndSaveAlarmCodes } from '../features/alarms/routes.js';
import { initializeFirmwareOnConnection } from '../features/firmware/routes.js';
import { pluginManager } from '../core/plugin-manager.js';

export function registerCncEventHandlers({
  cncController,
  jobManager,
  context,
  broadcast,
  log,
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

      // Send soft reset to clear any hanging state (e.g., Door, Hold)
      log('Sending soft reset to clear controller state...');
      cncController.sendCommand('\x18', {
        displayCommand: '\\x18 (Soft Reset on Connect)',
        meta: { systemCommand: true }
      }).then(() => {
        log('Soft reset sent successfully');
        // Initialize firmware after reset
        return initializeFirmwareOnConnection(cncController);
      }).then(() => {
        log('Firmware initialized successfully');
        // Fetch alarm codes after initialization
        return fetchAndSaveAlarmCodes(cncController);
      }).catch((error) => {
        log('Error during connection initialization:', error?.message || error);
      });
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
      if (!firmwareData.settings[id]) {
        firmwareData.settings[id] = { id: parseInt(id, 10) };
      }
      firmwareData.settings[id].value = String(value);
      firmwareData.timestamp = new Date().toISOString();

      try {
        await fs.mkdir(path.dirname(firmwareFilePath), { recursive: true });
      } catch (error) {
        log('Failed to ensure firmware directory exists:', error?.message || error);
      }
      await fs.writeFile(firmwareFilePath, JSON.stringify(firmwareData, null, 2), 'utf8');
      log(`Updated firmware.json setting $${id}=${value}`);
    } catch (error) {
      log('Failed to update firmware.json from command-ack:', error?.message || error);
    }
  };

  const handleData = (data, sourceId) => {
    if (sourceId === 'no-broadcast') {
      return;
    }
    if (!data || (typeof data === 'string' && data.trim() === '')) {
      return;
    }
    broadcast('cnc-data', data);
    pluginManager.getEventBus().emitAsync('ws:cnc-data', data);
  };

  const handleStatusReport = (status) => {
    const prevMachineState = { ...serverState.machineState };
    serverState.machineState = { ...serverState.machineState, ...status };

    const hasChanged = JSON.stringify(prevMachineState) !== JSON.stringify(serverState.machineState);

    const currentMachineStatus = status?.status?.toLowerCase();
    const prevMachineStatus = prevMachineState?.status;

    // Log status changes for debugging
    if (status?.status && prevMachineStatus !== status?.status) {
      console.log(`[CNC Events] machineState.status changed: '${prevMachineStatus}' -> '${status.status}'`);
    }

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

  const handleCncError = (errorData) => {
    try {
      let alarmCode = errorData.code;

      if (alarmCode === 'ALARM' && errorData.message) {
        const alarmMatch = errorData.message.match(/alarm:(\d+)/i);
        if (alarmMatch) {
          alarmCode = parseInt(alarmMatch[1], 10);
          saveSettings({ lastAlarmCode: alarmCode });
          log('Saved lastAlarmCode to settings:', alarmCode);
        }
      }

      broadcast('cnc-error', errorData);
    } catch (error) {
      log('Failed to save lastAlarmCode:', error);
    }
  };

  const handleUnlock = () => {
    try {
      removeSetting('lastAlarmCode');
      log('Cleared lastAlarmCode from settings');
    } catch (error) {
      log('Failed to clear lastAlarmCode:', error);
    }
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
    jobManager.setJobCompleteCallback(null);
  };

  return { teardown };
}
