/*
 * Pendant Serial Handler
 *
 * Handles USB serial communication with the pendant device.
 * Uses the same JSON message format as WebSocket, with newline delimiters.
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { createLogger } from '../../core/logger.js';
import { getSetting, DEFAULT_SETTINGS } from '../../core/settings-manager.js';

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

const BAUD_RATE = 115200;
const PING_INTERVAL_MS = 1000;
const PING_TIMEOUT_MS = 3000;
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

  async function detectPendantPort() {
    const configuredPort = getSetting('pendant.serialPort', 'auto');

    if (configuredPort && configuredPort !== 'auto') {
      return configuredPort;
    }

    // Auto-detect based on known VID/PID
    const ports = await listPorts();

    for (const portInfo of ports) {
      const vid = (portInfo.vendorId || '').toLowerCase();
      const pid = (portInfo.productId || '').toLowerCase();

      for (const identifier of PENDANT_IDENTIFIERS) {
        if (vid === identifier.vendorId && pid === identifier.productId) {
          log('Auto-detected pendant port:', portInfo.path, `(VID:${vid}, PID:${pid})`);
          return portInfo.path;
        }
      }
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
      // Check for timeout
      if (isConnected && Date.now() - lastPongTime > PING_TIMEOUT_MS) {
        log('Pendant ping timeout');
        handleDisconnect();
        return;
      }

      // Respond to any pending pings from pendant
      // The pendant sends pings, server responds with pongs
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

    // Overrides - only send if changed
    const curOverrides = {
      feed: ms.feedrateOverride || 100,
      rapid: ms.rapidOverride || 100,
      spindle: ms.spindleOverride || 100
    };
    if (curOverrides.feed !== lastOverrides.feed ||
        curOverrides.rapid !== lastOverrides.rapid ||
        curOverrides.spindle !== lastOverrides.spindle) {
      parts.push(`O:${curOverrides.feed},${curOverrides.rapid},${curOverrides.spindle}`);
      lastOverrides = curOverrides;
    }

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

    // Job progress - only if job is running
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

    // WCO - only send when changed
    const curWCO = ms.WCO || '0,0,0';
    if (curWCO !== lastWCO) {
      parts.push(`W:${curWCO}`);
      lastWCO = curWCO;
    }

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
    sendRaw('K'); // Compact pong: K (OK)

    if (!isConnected) {
      isConnected = true;
      clientMeta.connectedAt = Date.now();
      log('Pendant connected via USB serial');
      broadcast('client:connected', clientMeta);

      // Send initial state
      updateSenderStatus();
      updateJobStatus(jobManager);
      computeJobProgressFields();

      setTimeout(() => {
        if (port && port.isOpen) {
          sendState(serverState);

          // Send initial settings (force send on connection)
          const settings = serverState.settings || {};
          sendSettings(settings, true);
        }
      }, 100);
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
    shutdown
  };
}
