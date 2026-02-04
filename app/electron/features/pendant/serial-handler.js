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

  function sendMessage(type, data) {
    if (!port || !port.isOpen) {
      return false;
    }

    try {
      const message = JSON.stringify({ type, data });

      // Queue the send to ensure proper serialization
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
    } catch (err) {
      logError('sendMessage failed:', err.message);
      return false;
    }
  }

  function sendState(state) {
    // Only send essential fields to pendant to avoid buffer overflow
    // Pendant has a 4096 byte JSON buffer limit
    const pendantState = {
      machineState: state.machineState ? {
        connected: state.machineState.connected,
        homed: state.machineState.homed,
        status: state.machineState.status,
        MPos: state.machineState.MPos,
        WCO: state.machineState.WCO,
        WCS: state.machineState.WCS,
        feedRate: state.machineState.feedRate,
        spindleRpmActual: state.machineState.spindleRpmActual,
        feedrateOverride: state.machineState.feedrateOverride,
        rapidOverride: state.machineState.rapidOverride,
        spindleOverride: state.machineState.spindleOverride,
        alarmCode: state.machineState.alarmCode,
        maxFeedrate: state.machineState.maxFeedrate
      } : null,
      senderStatus: state.senderStatus,
      jobLoaded: state.jobLoaded ? {
        filename: state.jobLoaded.filename,
        currentLine: state.jobLoaded.currentLine,
        totalLines: state.jobLoaded.totalLines,
        progressPercent: state.jobLoaded.progressPercent,
        status: state.jobLoaded.status
      } : null
    };
    return sendMessage('server-state-updated', pendantState);
  }

  function handleMessage(data) {
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

    // Handle ping from pendant
    if (type === 'ping') {
      lastPongTime = Date.now();
      sendMessage('pong', {});

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
          }
        }, 100);
      }
      return;
    }

    // Update last activity time on any message
    if (isConnected) {
      lastPongTime = Date.now();
    }

    // Handle jog commands
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

    // Handle job control
    if (type === 'job:start') {
      handleJobStart().catch((err) => {
        logError('Error handling job:start:', err.message);
      });
      return;
    }

    if (type === 'job:pause') {
      handleJobPause().catch((err) => {
        logError('Error handling job:pause:', err.message);
      });
      return;
    }

    if (type === 'job:resume') {
      handleJobResume().catch((err) => {
        logError('Error handling job:resume:', err.message);
      });
      return;
    }

    if (type === 'job:stop') {
      handleJobStop().catch((err) => {
        logError('Error handling job:stop:', err.message);
      });
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
    sendMessage,
    autoConnect,
    listPorts,
    getStatus,
    shutdown
  };
}
