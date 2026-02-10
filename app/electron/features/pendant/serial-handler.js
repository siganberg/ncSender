/*
 * Pendant Serial Handler
 *
 * Handles USB serial communication with the pendant device.
 * Uses the same JSON message format as WebSocket, with newline delimiters.
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { createLogger } from '../../core/logger.js';
import { getSetting, readSettings, DEFAULT_SETTINGS } from '../../core/settings-manager.js';

const { log, error: logError } = createLogger('PendantSerial');

// Known pendant device identifiers
const PENDANT_IDENTIFIERS = [
  // ESP32-S3 native USB CDC
  { vendorId: '303a', productId: '1001' },  // Espressif ESP32-S3
  // Common USB-to-Serial chips used with ESP32
  { vendorId: '10c4', productId: 'ea60' },  // Silicon Labs CP210x
  { vendorId: '1a86', productId: '7523' },  // CH340
  { vendorId: '0403', productId: '6001' },  // FTDI FT232
];

// USB product strings that identify an ESP-NOW dongle (not a pendant)
const DONGLE_PRODUCT_NAMES = ['ncSender ESP-NOW Dongle'];

const BAUD_RATE = 460800;
const PING_INTERVAL_MS = 1000;
const PING_TIMEOUT_MS = 8000;
const RECONNECT_INTERVAL_MS = 5000;

export function createPendantSerialHandler({
  cncController,
  jobManager,
  jogManager,
  context,
  commandProcessor,
  broadcast
}) {
  const { serverState, updateSenderStatus, updateJobStatus, computeJobProgressFields } = context;

  let port = null;
  let parser = null;
  let isConnected = false;
  let lastPongTime = 0;
  let pingInterval = null;
  let reconnectInterval = null;
  let currentPortPath = null;
  let otaResponseHandler = null;

  // Client metadata for registry
  const clientMeta = {
    clientId: 'usb-pendant',
    ip: 'usb',
    isLocal: true,
    product: 'ncSenderPendant',
    machineId: null,
    deviceId: null,
    version: null,
    licensed: false,
    connectedAt: null
  };

  async function listPorts() {
    try {
      const ports = await SerialPort.list();
      return ports;
    } catch (err) {
      logError('Failed to list serial ports:', err.message);
      return [];
    }
  }

  function isDonglePort(portInfo) {
    const fields = [
      portInfo.manufacturer,
      portInfo.serialNumber,
      portInfo.pnpId,
      portInfo.friendlyName
    ].filter(Boolean).join(' ');

    return DONGLE_PRODUCT_NAMES.some(name => fields.includes(name));
  }

  async function detectPendantPort() {
    const configuredPort = getSetting('pendant.serialPort', 'auto');

    if (configuredPort && configuredPort !== 'auto') {
      return configuredPort;
    }

    // Auto-detect based on known VID/PID
    // Prefer dongle over direct USB — pendant prioritizes ESP-NOW when dongle exists,
    // so direct USB pendant will suppress pings and won't respond
    const ports = await listPorts();
    let donglePort = null;
    let pendantPort = null;

    for (const portInfo of ports) {
      const vid = (portInfo.vendorId || '').toLowerCase();
      const pid = (portInfo.productId || '').toLowerCase();

      const matches = PENDANT_IDENTIFIERS.some(id => vid === id.vendorId && pid === id.productId);
      if (!matches) continue;

      if (isDonglePort(portInfo)) {
        donglePort = donglePort || portInfo.path;
        log('Found dongle port:', portInfo.path);
      } else {
        pendantPort = pendantPort || portInfo.path;
        log('Found pendant port:', portInfo.path);
      }
    }

    if (donglePort) {
      log('Using dongle port (ESP-NOW bridge):', donglePort);
      return donglePort;
    }

    if (pendantPort) {
      log('Using direct pendant port:', pendantPort);
      return pendantPort;
    }

    return null;
  }

  async function connect(portPath = null) {
    if (isConnected && port) {
      log('Already connected to pendant');
      return true;
    }

    const targetPort = portPath || await detectPendantPort();

    if (!targetPort) {
      return false;
    }

    try {
      log('Connecting to pendant on', targetPort);

      port = new SerialPort({
        path: targetPort,
        baudRate: BAUD_RATE,
        autoOpen: false,
        hupcl: false,     // Don't reset DTR on close (prevents ESP32 reset)
        rtscts: false     // Disable hardware flow control
      });

      return new Promise((resolve) => {
        port.open((err) => {
          if (err) {
            logError('Failed to open port:', err.message);
            port = null;
            resolve(false);
            return;
          }

          currentPortPath = targetPort;

          // Set DTR/RTS low immediately to prevent ESP32 reset
          try {
            port.set({ dtr: false, rts: false });
          } catch (setErr) {
            // Ignore errors - some ports don't support DTR/RTS control
          }

          // Set up parser immediately
          parser = new ReadlineParser({ delimiter: '\n' });
          port.pipe(parser);

          parser.on('data', (data) => {
            handleMessage(data.trim());
          });

          port.on('close', () => {
            handleDisconnect();
          });

          port.on('error', (err) => {
            logError('Serial port error:', err.message);
            handleDisconnect();
          });

          // Start ping interval
          startPingInterval();

          log('Serial port opened, waiting for pendant handshake...');
          resolve(true);
        });
      });
    } catch (err) {
      logError('Failed to connect:', err.message);
      return false;
    }
  }

  function disconnect() {
    stopPingInterval();
    stopReconnectInterval();

    if (port && port.isOpen) {
      port.close();
    }
    port = null;
    parser = null;
    isConnected = false;
    currentPortPath = null;
    lastPongTime = 0;
    clientMeta.connectedAt = null;
  }

  function handleDisconnect() {
    const wasConnected = isConnected;
    isConnected = false;
    stopPingInterval();

    if (wasConnected) {
      log('Pendant disconnected');
      broadcast('client:disconnected', clientMeta);
    }

    port = null;
    parser = null;
    currentPortPath = null;
    lastPongTime = 0;

    // Start reconnect interval if auto-connect is enabled
    const autoConnect = getSetting('pendant.autoConnect', true);
    if (autoConnect) {
      startReconnectInterval();
    }
  }

  function startPingInterval() {
    stopPingInterval();
    lastPongTime = Date.now();

    pingInterval = setInterval(() => {
      if (isConnected && Date.now() - lastPongTime > PING_TIMEOUT_MS) {
        log('Pendant ping timeout');
        // Don't close the serial port — dongle stays connected even when pendant is off.
        // Just mark as disconnected. When pendant reboots and pings again,
        // handlePing() will re-establish the connection through the same port.
        isConnected = false;
        broadcast('client:disconnected', clientMeta);
      }

      // Push DRO to pendant periodically. This ensures the pendant receives
      // state data even if ping responses or broadcastState DRO get lost.
      // The pendant treats DRO as connection proof, so this also lets it
      // connect without waiting for the K pong handshake.
      if (port && port.isOpen) {
        sendState(serverState);
      }
    }, PING_INTERVAL_MS);
  }

  function stopPingInterval() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  function startReconnectInterval() {
    stopReconnectInterval();

    reconnectInterval = setInterval(async () => {
      if (!isConnected) {
        const connected = await connect();
        if (connected) {
          stopReconnectInterval();
        }
      }
    }, RECONNECT_INTERVAL_MS);
  }

  function stopReconnectInterval() {
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
  }

  // Queue for serializing message sends
  let sendQueue = Promise.resolve();

  // Track last sent values to avoid redundant sends
  let lastOverrides = { feed: 0, rapid: 0, spindle: 0 };
  let lastWCO = '';
  let lastJobProgress = '';
  let lastSentSettings = null;

  function sendRaw(message) {
    if (!port || !port.isOpen) {
      return false;
    }
    if (otaResponseHandler) {
      return false;
    }

    sendQueue = sendQueue.then(() => {
      return new Promise((resolve) => {
        if (!port || !port.isOpen) {
          resolve();
          return;
        }
        port.write(message + '\n', () => {
          port.drain(() => {
            resolve();
          });
        });
      });
    });

    return true;
  }

  function sendMessage(type, data) {
    if (!port || !port.isOpen) {
      return false;
    }

    try {
      const message = JSON.stringify({ type, data });
      return sendRaw(message);
    } catch (err) {
      logError('sendMessage failed:', err.message);
      return false;
    }
  }

  function sendCompactDRO(state) {
    if (!port || !port.isOpen) {
      return false;
    }

    const ms = state.machineState;
    if (!ms) {
      return false;
    }

    // Build compact DRO message: $Status|P:x,y,z|O:f,r,s|F:feed|R:rpm|C|H|J:cur/total
    const parts = [];

    // Status (first field, no prefix)
    parts.push(ms.status || 'Unknown');

    // Work position - calculate from MPos and WCO
    if (ms.MPos) {
      const mpos = ms.MPos.split(',').map(parseFloat);
      const wco = ms.WCO ? ms.WCO.split(',').map(parseFloat) : [0, 0, 0];
      const wpos = mpos.map((m, i) => (m - (wco[i] || 0)).toFixed(3));
      parts.push(`P:${wpos.join(',')}`);
    }

    // Overrides - always send (no dedup — ESP-NOW is unreliable)
    const curOverrides = {
      feed: ms.feedrateOverride || 100,
      rapid: ms.rapidOverride || 100,
      spindle: ms.spindleOverride || 100
    };
    parts.push(`O:${curOverrides.feed},${curOverrides.rapid},${curOverrides.spindle}`);

    // Feed rate (only if > 0)
    if (ms.feedRate > 0) {
      parts.push(`F:${Math.round(ms.feedRate)}`);
    }

    // Spindle RPM (only if > 0)
    if (ms.spindleRpmActual > 0) {
      parts.push(`R:${Math.round(ms.spindleRpmActual)}`);
    }

    // Connected flag
    if (ms.connected) {
      parts.push('C');
    }

    // Homed flag
    if (ms.homed) {
      parts.push('H');
    }

    // Alarm code (only if in alarm)
    if (ms.alarmCode && ms.status === 'Alarm') {
      parts.push(`A:${ms.alarmCode}`);
    }

    // Job progress and status
    const job = state.jobLoaded;
    if (job && job.status === 'running' && job.totalLines > 0) {
      const jobStr = `${job.currentLine || 0}/${job.totalLines}`;
      if (jobStr !== lastJobProgress) {
        parts.push(`J:${jobStr}`);
        lastJobProgress = jobStr;
      }
    } else {
      lastJobProgress = '';
    }

    // Job status (running/paused/stopped) for auto-switch and UI
    if (job && job.status) {
      parts.push(`D:${job.status}`);
    }

    // WCO - always send (no dedup — ESP-NOW is unreliable)
    const curWCO = ms.WCO || '0,0,0';
    parts.push(`W:${curWCO}`);

    const message = '$' + parts.join('|');
    return sendRaw(message);
  }

  function sendState(state) {
    // Use compact DRO format for state updates
    return sendCompactDRO(state);
  }

  function sendSettings(settings, force = false) {
    if (!port || !port.isOpen || !isConnected) {
      return false;
    }

    // Build settings object with relevant pendant settings
    // maxFeedrate comes from machineState (read from firmware $110/$111)
    const pendantSettings = {
      maxFeedrate: serverState.machineState?.maxFeedrate || 8000,
      theme: settings?.theme,
      accentColor: settings?.accentColor || settings?.primaryColor,
      gradientColor: settings?.gradientColor,
      darkMode: settings?.darkMode
    };

    // Skip if settings haven't changed (unless forced)
    if (!force && lastSentSettings) {
      const unchanged = Object.keys(pendantSettings).every(
        key => pendantSettings[key] === lastSentSettings[key]
      );
      if (unchanged) {
        return true;
      }
    }

    lastSentSettings = { ...pendantSettings };

    // Send as JSON since settings are infrequent
    return sendMessage('settings-changed', pendantSettings);
  }

  function handleMessage(data) {
    // Intercept $OTA responses during firmware flashing
    if (otaResponseHandler && data.startsWith('$OTA:')) {
      otaResponseHandler(data);
      return;
    }

    // During OTA, drop all non-OTA messages — responding to pings would send
    // DRO text into the serial port, which the dongle (in binary mode) would
    // interpret as firmware bytes, corrupting the OTA stream.
    if (otaResponseHandler) {
      return;
    }

    // Handle compact jog format: JX1.000F3000
    if (data.startsWith('J') && data.length > 1) {
      const axis = data[1].toUpperCase();
      if (['X', 'Y', 'Z', 'A', 'B', 'C'].includes(axis)) {
        handleCompactJog(data.substring(1));
        return;
      }
    }

    // Handle compact command format: C$H or C! or C~
    if (data.startsWith('C') && data.length > 1) {
      handleCompactCommand(data.substring(1));
      return;
    }

    // Handle compact job control: RS (start), RP (pause), RR (resume), RT (stop)
    if (data.startsWith('R') && data.length === 2) {
      const action = data[1].toUpperCase();
      if (action === 'S') {
        handleJobStart().catch((err) => logError('Error handling job:start:', err.message));
        return;
      } else if (action === 'P') {
        handleJobPause().catch((err) => logError('Error handling job:pause:', err.message));
        return;
      } else if (action === 'R') {
        handleJobResume().catch((err) => logError('Error handling job:resume:', err.message));
        return;
      } else if (action === 'T') {
        handleJobStop().catch((err) => logError('Error handling job:stop:', err.message));
        return;
      }
    }

    // Handle ping (compact or JSON)
    if (data === 'P') {
      handlePing();
      return;
    }

    // Try JSON parsing for backwards compatibility and other messages
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      // Ignore non-JSON data (bootloader output, debug messages)
      return;
    }

    if (!parsed || typeof parsed.type !== 'string') {
      return;
    }

    const { type } = parsed;

    // Handle ping from pendant (JSON format)
    if (type === 'ping') {
      handlePing();
      return;
    }

    // Update last activity time on any message
    if (isConnected) {
      lastPongTime = Date.now();
    }

    // Handle jog commands (JSON format for backwards compatibility)
    if (type.startsWith('jog:')) {
      if (jogManager) {
        jogManager.handleMessage({ clientId: 'usb-pendant' }, parsed).catch((err) => {
          logError('Error handling jog message:', err.message);
        });
      } else {
        logError('jogManager not available');
      }
      return;
    }

    // Handle CNC commands
    if (type === 'cnc:command') {
      handleCncCommand(parsed.data).catch((err) => {
        logError('Error handling CNC command:', err.message);
      });
      return;
    }

    // Handle job control (JSON format)
    if (type === 'job:start') {
      handleJobStart().catch((err) => logError('Error handling job:start:', err.message));
      return;
    }

    if (type === 'job:pause') {
      handleJobPause().catch((err) => logError('Error handling job:pause:', err.message));
      return;
    }

    if (type === 'job:resume') {
      handleJobResume().catch((err) => logError('Error handling job:resume:', err.message));
      return;
    }

    if (type === 'job:stop') {
      handleJobStop().catch((err) => logError('Error handling job:stop:', err.message));
      return;
    }

    // Handle client metadata updates
    if (type === 'client:metadata') {
      if (parsed.data) {
        Object.assign(clientMeta, parsed.data);
        broadcast('client:metadata-updated', clientMeta);
      }
      return;
    }
  }

  function handlePing() {
    lastPongTime = Date.now();

    if (!isConnected) {
      sendRaw('K'); // Initial pong to establish connection
      isConnected = true;
      clientMeta.connectedAt = Date.now();
      log('Pendant connected via USB serial');
      broadcast('client:connected', clientMeta);

      // Reset dedup state so first compact DRO sends ALL fields (WCO, overrides, etc.)
      lastOverrides = { feed: 0, rapid: 0, spindle: 0 };
      lastWCO = '';
      lastJobProgress = '';
      lastSentSettings = null;

      // Send initial state after brief delay to avoid back-to-back ESP-NOW sends
      // (K + DRO sent too close together can cause the dongle to drop the second packet)
      updateSenderStatus();
      updateJobStatus(jobManager);
      computeJobProgressFields();

      setTimeout(() => {
        if (port && port.isOpen) {
          sendState(serverState);

          // Send initial settings (force send on connection)
          const settings = readSettings() || {};
          sendSettings(settings, true);
        }
      }, 100);
    } else {
      // Send DRO directly — no "K" pong needed because the pendant treats
      // received DRO as connection proof. Sending a single packet (DRO only)
      // instead of two (K + DRO) avoids back-to-back ESP-NOW sends through
      // the dongle where the second packet can get dropped.
      sendState(serverState);
    }
  }

  function handleCompactJog(jogData) {
    // Format: X1.000F3000 or Y-0.100F1500 or X1.000F3000S (S=silent)
    // Parse axis, distance, feed rate, and silent flag
    const axis = jogData[0].toUpperCase();
    let rest = jogData.substring(1);

    // Check for silent flag at the end
    const silent = rest.endsWith('S') || rest.endsWith('s');
    if (silent) {
      rest = rest.slice(0, -1);
    }

    // Find F separator
    const fIndex = rest.toUpperCase().indexOf('F');
    if (fIndex === -1) {
      logError('Invalid compact jog format (missing F):', jogData);
      return;
    }

    const distance = rest.substring(0, fIndex);
    const feedRate = rest.substring(fIndex + 1);

    if (!distance || !feedRate) {
      logError('Invalid compact jog format:', jogData);
      return;
    }

    // Construct full jog command
    const jogCommand = `$J=G21 G91 ${axis}${distance} F${feedRate}`;

    // Send directly to CNC controller (skipJogCancel: true to avoid 0x85 prefix)
    cncController.sendCommand(jogCommand, {
      meta: { sourceId: 'usb-pendant', jogCommand: true, skipJogCancel: true, silent }
    }).catch((err) => {
      logError('Jog command failed:', err.message);
    });
  }

  function handleCompactCommand(command) {
    // Translate hex notation if present
    let cmd = command;
    const hexMatch = /^\\x([0-9a-fA-F]{2})$/i.exec(command);
    if (hexMatch) {
      cmd = String.fromCharCode(parseInt(hexMatch[1], 16));
    }

    // Send command through normal processing
    handleCncCommand({ command: cmd }).catch((err) => {
      logError('Command failed:', err.message);
    });
  }

  async function handleCncCommand(payload) {
    const { command: rawCommand, commandId, meta } = payload || {};

    if (!rawCommand || typeof rawCommand !== 'string') {
      return;
    }

    // Translate hex commands
    let command = rawCommand.trim();
    const hexMatch = /^(?:\\x|0x)([0-9a-fA-F]{2})$/i.exec(command);
    if (hexMatch) {
      command = String.fromCharCode(parseInt(hexMatch[1], 16));
    }

    log('USB pendant command:', command, `id=${commandId || 'none'}`);

    try {
      const pluginContext = {
        sourceId: 'usb-pendant',
        commandId: commandId || `usb-${Date.now()}`,
        meta: meta || {},
        machineState: cncController.lastStatus
      };

      const result = await commandProcessor.instance.process(command, pluginContext);

      if (!result.shouldContinue) {
        return;
      }

      for (const cmd of result.commands) {
        await cncController.sendCommand(cmd.command, {
          commandId: cmd.commandId || pluginContext.commandId,
          displayCommand: cmd.displayCommand || cmd.command,
          meta: { ...pluginContext.meta, ...(cmd.meta || {}) }
        });
      }
    } catch (err) {
      logError('Command failed:', err.message);
    }
  }

  async function handleJobStart() {
    const filename = serverState.jobLoaded?.filename;
    if (!filename) {
      log('job:start failed: No program loaded');
      return;
    }

    if (!serverState.machineState?.connected) {
      log('job:start failed: CNC controller not connected');
      return;
    }

    const machineStatus = serverState.machineState?.status?.toLowerCase();
    if (machineStatus !== 'idle') {
      log(`job:start failed: Machine state is ${machineStatus}`);
      return;
    }

    // Initialize timing for progress
    if (serverState.jobLoaded) {
      serverState.jobLoaded.jobStartTime = new Date().toISOString();
      serverState.jobLoaded.jobEndTime = null;
      serverState.jobLoaded.jobPauseAt = null;
      serverState.jobLoaded.jobPausedTotalSec = 0;
      serverState.jobLoaded.status = 'running';
      broadcast('server-state-updated', serverState);
    }

    const { getUserDataDir } = await import('../../utils/paths.js');
    const path = await import('path');
    const cachePath = path.join(getUserDataDir(), 'gcode-cache', 'current.gcode');

    await jobManager.startJob(cachePath, filename, cncController, broadcast, commandProcessor, { serverState });
    log('Job started via USB pendant');
  }

  async function handleJobPause() {
    const machineStatus = serverState.machineState?.status?.toLowerCase();
    if (machineStatus === 'hold' || machineStatus === 'door') {
      log('job:pause: Already paused');
      return;
    }

    if (machineStatus !== 'run') {
      log(`job:pause failed: Machine state is ${machineStatus}`);
      return;
    }

    const useDoorAsPause = getSetting('useDoorAsPause', DEFAULT_SETTINGS.useDoorAsPause);
    const command = useDoorAsPause ? '\x84' : '!';

    await cncController.sendCommand(command, {
      displayCommand: useDoorAsPause ? '\\x84 (Safety Door)' : '! (Feed Hold)',
      meta: { jobControl: true, sourceId: 'usb-pendant' }
    });

    log('Job paused via USB pendant');
  }

  async function handleJobResume() {
    const machineStatus = serverState.machineState?.status?.toLowerCase();
    if (!machineStatus || !['hold', 'door'].includes(machineStatus)) {
      log(`job:resume failed: Machine state is ${machineStatus}`);
      return;
    }

    await cncController.sendCommand('~', {
      displayCommand: '~ (Resume)',
      meta: { jobControl: true, sourceId: 'usb-pendant' }
    });

    log('Job resumed via USB pendant');
  }

  async function handleJobStop() {
    if (!jobManager.hasActiveJob()) {
      log('job:stop: No active job');
      return;
    }

    const status = jobManager.getJobStatus();
    const isActiveMotion = status && (status.status === 'running' || status.status === 'paused');

    const rawSetting = getSetting('pauseBeforeStop', DEFAULT_SETTINGS.pauseBeforeStop);
    let pauseBeforeStop = Number(rawSetting);
    if (!Number.isFinite(pauseBeforeStop) || pauseBeforeStop < 0) {
      pauseBeforeStop = DEFAULT_SETTINGS.pauseBeforeStop;
    }

    if (isActiveMotion && pauseBeforeStop > 0) {
      await cncController.sendCommand('!', {
        displayCommand: '! (Feed Hold)',
        meta: { jobControl: true, sourceId: 'usb-pendant' }
      });
      await new Promise(resolve => setTimeout(resolve, pauseBeforeStop));
    }

    if (isActiveMotion) {
      await cncController.sendCommand('\x18', {
        displayCommand: '\\x18 (Soft Reset)',
        meta: { jobControl: true, sourceId: 'usb-pendant' }
      });
    }

    jobManager.stop();
    log('Job stopped via USB pendant');
  }

  let otaReject = null;
  let otaInactivityTimer = null;

  function otaCleanup() {
    clearTimeout(otaInactivityTimer);
    otaInactivityTimer = null;
    otaResponseHandler = null;
    otaReject = null;
  }

  async function flashFirmware(firmwareBuffer, onProgress) {
    if (!port || !port.isOpen) {
      throw new Error('Serial port not open');
    }

    stopPingInterval();

    return new Promise((resolve, reject) => {
      otaReject = reject;
      const INACTIVITY_TIMEOUT_MS = 15000;
      otaInactivityTimer = setTimeout(onTimeout, INACTIVITY_TIMEOUT_MS);

      function resetTimeout() {
        clearTimeout(otaInactivityTimer);
        otaInactivityTimer = setTimeout(onTimeout, INACTIVITY_TIMEOUT_MS);
      }

      function onTimeout() {
        otaCleanup();
        setTimeout(() => startPingInterval(), 7000);
        reject(new Error('Firmware update timed out'));
      }

      const chunkSize = 4096;
      let offset = 0;

      const sendNextChunk = () => {
        if (offset >= firmwareBuffer.length) return;
        const end = Math.min(offset + chunkSize, firmwareBuffer.length);
        const chunk = firmwareBuffer.slice(offset, end);
        offset = end;
        port.write(chunk);
      };

      otaResponseHandler = (line) => {
        if (line === '$OTA:READY') {
          resetTimeout();
          sendNextChunk();
        } else if (line === '$OTA:ACK') {
          resetTimeout();
          sendNextChunk();
        } else if (line.startsWith('$OTA:PROGRESS:')) {
          resetTimeout();
          const percent = parseInt(line.substring(14), 10);
          if (onProgress) onProgress({ percent });
        } else if (line === '$OTA:OK') {
          otaCleanup();
          resolve();
        } else if (line.startsWith('$OTA:ERROR:')) {
          otaCleanup();
          startPingInterval();
          reject(new Error(line.substring(11)));
        }
      };

      const cmd = `$OTA:${firmwareBuffer.length}\n`;
      port.write(cmd, (err) => {
        if (err) {
          otaCleanup();
          startPingInterval();
          reject(new Error('Failed to send OTA command: ' + err.message));
        }
      });
    });
  }

  function cancelFlashFirmware() {
    if (otaReject) {
      const r = otaReject;
      otaCleanup();
      setTimeout(() => startPingInterval(), 7000);
      r(new Error('Firmware update cancelled'));
    }
  }

  async function getPortVidPid() {
    if (!currentPortPath) return null;
    const ports = await listPorts();
    const match = ports.find(p => p.path === currentPortPath);
    if (!match) return null;
    return {
      vendorId: (match.vendorId || '').toLowerCase(),
      productId: (match.productId || '').toLowerCase()
    };
  }

  async function autoConnect() {
    const autoConnect = getSetting('pendant.autoConnect', true);
    if (!autoConnect) {
      return;
    }

    const connected = await connect();
    if (!connected) {
      // Start reconnect interval to keep trying
      startReconnectInterval();
    }
  }

  function getStatus() {
    return {
      connected: isConnected,
      port: currentPortPath,
      clientMeta: isConnected ? clientMeta : null
    };
  }

  function shutdown() {
    disconnect();
  }

  return {
    connect,
    disconnect,
    isConnected: () => isConnected,
    sendState,
    sendSettings,
    sendMessage,
    autoConnect,
    listPorts,
    getStatus,
    flashFirmware,
    cancelFlashFirmware,
    getPortVidPid,
    shutdown
  };
}
