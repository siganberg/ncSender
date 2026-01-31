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

import { WebSocketServer } from 'ws';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSetting, DEFAULT_SETTINGS } from '../core/settings-manager.js';
import { pluginManager } from '../core/plugin-manager.js';
import { parseM6Command } from '../utils/gcode-patterns.js';
import { getUserDataDir } from '../utils/paths.js';
import { createLogger } from '../core/logger.js';
import { bleClientAdapter } from '../features/pendant/ble-client.js';

const { log, error: logError } = createLogger('WebSocket');

const WS_READY_STATE_OPEN = 1;

const isLocalConnection = (req) => {
  const ip = req?.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};
const SOFT_RESET = String.fromCharCode(0x18);
const realtimeJobCommands = new Set(['!', '~', SOFT_RESET]);

const sanitizeForJson = (value) => JSON.parse(JSON.stringify(value, (key, item) => {
  if (typeof item === 'object' && item !== null) {
    if (item.constructor && (
      item.constructor.name === 'Timeout' ||
      item.constructor.name === 'Timer' ||
      item.constructor.name === 'TimersList'
    )) {
      return undefined;
    }
    if (key.includes('_idle') || key.includes('_repeat')) {
      return undefined;
    }
  }
  if (key === 'isProbing'
      || key === 'totalEstimatedSec'
      || key === 'progressProvider'
      || key === 'jobStartTime'
      || key === 'jobEndTime'
      || key === 'jobPauseAt'
      || key === 'jobPausedTotalSec'
      || key === 'feedRateCommanded'
      || key === 'Bf') {
    return undefined;
  }
  if (typeof item === 'function') {
    return undefined;
  }
  return item;
}));

const translateCommandInput = (rawCommand) => {
  if (typeof rawCommand !== 'string' || rawCommand.trim() === '') {
    return {
      error: { message: 'Command is required', code: 'INVALID_COMMAND' }
    };
  }

  const trimmed = rawCommand.trim();
  // Accept both \xHH and 0xHH formats for hex byte commands
  const hexMatch = /^(?:\\x|0x)([0-9a-fA-F]{2})$/i.exec(trimmed);
  if (hexMatch) {
    const charCode = parseInt(hexMatch[1], 16);
    // Normalize display to 0xHH format
    const displayHex = `0x${hexMatch[1].toUpperCase()}`;
    return {
      command: String.fromCharCode(charCode),
      displayCommand: displayHex
    };
  }

  return { command: trimmed, displayCommand: trimmed };
};

const describeCommand = (command) => {
  const realTimeCommands = {
    [String.fromCharCode(0x90)]: '0x90 (Feed Rate Override Reset 100%)',
    [String.fromCharCode(0x91)]: '0x91 (Feed Rate Override +10%)',
    [String.fromCharCode(0x92)]: '0x92 (Feed Rate Override -10%)',
    [String.fromCharCode(0x93)]: '0x93 (Feed Rate Override +1%)',
    [String.fromCharCode(0x94)]: '0x94 (Feed Rate Override -1%)',
    [String.fromCharCode(0x99)]: '0x99 (Spindle Speed Override Reset 100%)',
    [String.fromCharCode(0x9A)]: '0x9A (Spindle Speed Override +10%)',
    [String.fromCharCode(0x9B)]: '0x9B (Spindle Speed Override -10%)',
    [String.fromCharCode(0x9C)]: '0x9C (Spindle Speed Override +1%)',
    [String.fromCharCode(0x9D)]: '0x9D (Spindle Speed Override -1%)',
    [String.fromCharCode(0x87)]: '0x87 (Status Report)',
    [String.fromCharCode(0x85)]: '0x85 (Jog Cancel)',
    [String.fromCharCode(0x84)]: '0x84 (Safety Door)',
    [String.fromCharCode(0x18)]: '0x18 (Soft Reset)',
    '!': '! (Feed Hold)',
    '~': '~ (Cycle Start/Resume)'
  };
  return realTimeCommands[command] || null;
};

const formatCommandText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  // First check if this is a known realtime command
  const described = describeCommand(value);
  if (described) {
    return described;
  }

  let needsEscaping = false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    // Check for control characters, but allow newlines (0x0A)
    if ((code < 0x20 && code !== 0x0A) || code === 0x7f) {
      needsEscaping = true;
      break;
    }
  }

  if (!needsEscaping) {
    return value;
  }

  return Array.from(value).map((char) => {
    const code = char.charCodeAt(0);
    // Preserve newlines, escape other control characters
    if (code === 0x0A) {
      return '\n';
    }
    if (code < 0x20 || code === 0x7f) {
      return `0x${code.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return char;
  }).join('');
};

const toCommandPayload = (event, options = {}) => {
  const {
    includeTimestamp = true,
    status,
    overrides = {},
    sourceId
  } = options;

  const payload = {
    id: event.id,
    command: event.command,
    displayCommand: formatCommandText(event.displayCommand || event.command),
    status: event.status,
    machineState: event.machineState
  };

  if (event.error) {
    payload.error = event.error;
  }

  const filteredMeta = event.meta ? { ...event.meta } : undefined;
  const resolvedSourceId = sourceId || event.meta?.sourceId;
  if (filteredMeta) {
    delete filteredMeta.sourceId;
    if (Object.keys(filteredMeta).length === 0) {
      delete payload.meta;
    } else {
      payload.meta = filteredMeta;
    }
  }

  Object.assign(payload, overrides);

  if (status) {
    payload.status = status;
  }

  if (resolvedSourceId && resolvedSourceId !== 'system') {
    payload.sourceId = resolvedSourceId;
  }

  if (includeTimestamp) {
    payload.timestamp = event.timestamp || new Date().toISOString();
  }

  return payload;
};

const isToolChangeCommand = (cmd) => {
  if (!cmd || typeof cmd !== 'string') return false;
  const parsed = parseM6Command(cmd);
  return parsed?.matched === true;
};

export function createWebSocketLayer({
  httpServer,
  cncController,
  jobManager,
  jogManager,
  context,
  commandProcessor
}) {
  const {
    serverState,
    messageStateTracker,
    computeJobProgressFields,
    updateSenderStatus,
    updateJobStatus
  } = context;

  const wss = new WebSocketServer({ server: httpServer });
  const clients = new Set();
  const clientIdToWsMap = new Map(); // Map client IDs to WebSocket connections
  const clientRegistry = new Map(); // clientId → metadata object
  const longRunningCommands = new Map();

  const sendWsMessage = (ws, type, data) => {
    try {
      if (ws && ws.readyState === WS_READY_STATE_OPEN) {
        const safeData = sanitizeForJson(data);
        ws.send(JSON.stringify({ type, data: safeData }));
      }
    } catch (error) {
      log('Failed to send WebSocket payload', error?.message || error);
    }
  };

  const broadcast = (type, data) => {
    let payload = data;

    if (type === 'server-state-updated') {
      updateSenderStatus();
      updateJobStatus(jobManager);
      computeJobProgressFields();

      const sanitizedState = sanitizeForJson(serverState);
      const enableStateDeltaBroadcast = getSetting('enableStateDeltaBroadcast') ?? DEFAULT_SETTINGS.enableStateDeltaBroadcast;

      if (enableStateDeltaBroadcast) {
        let changes = messageStateTracker.getDelta(type, sanitizedState);
        if (!changes) {
          return;
        }

        try {
          if (changes.jobLoaded && serverState.jobLoaded) {
            const jl = serverState.jobLoaded;
            if (typeof changes.jobLoaded !== 'object' || changes.jobLoaded === null) {
              changes.jobLoaded = {};
            }
            changes.jobLoaded.remainingSec = jl.remainingSec ?? null;
            changes.jobLoaded.progressPercent = jl.progressPercent ?? null;
            changes.jobLoaded.runtimeSec = jl.runtimeSec ?? null;
          }
        } catch (error) {
          log('Delta broadcast merge failed', error?.message || error);
        }

        payload = changes;
      } else {
        payload = sanitizedState;
        // Keep tracker in sync even when not diffing
        messageStateTracker.getDelta(type, sanitizedState);
      }
    } else {
      payload = sanitizeForJson(payload);
    }

    try {
      const message = JSON.stringify({ type, data: payload });
      clients.forEach((client) => {
        if (client.readyState === WS_READY_STATE_OPEN) {
          client.send(message);
        }
      });

      // Also broadcast to BLE pendant if connected
      bleClientAdapter.broadcast(type, payload).catch(() => {
        // Silently ignore BLE broadcast errors
      });
    } catch (error) {
      log('Error broadcasting message:', error?.message || error);
      log('Problematic data:', type, typeof data);
    }
  };

  const setToolChanging = (value) => {
    if (serverState.machineState.isToolChanging !== value) {
      log(`isToolChanging -> ${value ? 'true' : 'false'}`);
      serverState.machineState.isToolChanging = value;
      broadcast('server-state-updated', serverState);
    }
  };

  const handleWebSocketCommand = async (ws, payload) => {
    const {
      command: rawCommand,
      commandId,
      displayCommand,
      meta,
      completesCommandId
    } = payload || {};

    const translation = translateCommandInput(rawCommand);
    if (translation.error) {
      log('Command translation error:', translation.error.message);
      return;
    }

    const normalizedCommandId = commandId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const normalizedMeta = meta && typeof meta === 'object' ? { ...meta } : null;
    const commandValue = translation.command;

    const resolvedDisplayCommand = displayCommand || translation.displayCommand || commandValue;
    const commandMeta = {
      id: normalizedCommandId,
      command: commandValue,
      displayCommand: formatCommandText(resolvedDisplayCommand),
      timestamp: new Date().toISOString(),
      meta: normalizedMeta,
      completesCommandId: completesCommandId ?? null
    };

    log('WebSocket command received', commandMeta.displayCommand, `id=${normalizedCommandId}`);

    const metaPayload = commandMeta.meta ? { ...commandMeta.meta } : {};
    if (commandMeta.completesCommandId) {
      metaPayload.completesCommandId = commandMeta.completesCommandId;
    }
    // Default to 'client' sourceId if not provided
    if (!metaPayload.sourceId) {
      metaPayload.sourceId = 'client';
    }

    try {
      // Handle soft reset with optional deceleration delay
      if (commandValue === SOFT_RESET && jobManager.hasActiveJob()) {
        const jobStatus = jobManager.getJobStatus();
        const isActiveMotion = jobStatus && (jobStatus.status === 'running' || jobStatus.status === 'paused');

        if (isActiveMotion) {
          const rawSetting = getSetting('pauseBeforeStop', DEFAULT_SETTINGS.pauseBeforeStop);
          let pauseBeforeStop = Number(rawSetting);
          if (!Number.isFinite(pauseBeforeStop) || pauseBeforeStop < 0) {
            pauseBeforeStop = DEFAULT_SETTINGS.pauseBeforeStop;
          }

          if (pauseBeforeStop > 0) {
            // Send feed hold first to allow deceleration
            log(`Sending feed hold before soft reset (delay: ${pauseBeforeStop}ms)`);
            try {
              await cncController.sendCommand('!', {
                displayCommand: '! (Feed Hold)',
                meta: { jobControl: true, sourceId: 'client' }
              });
              jobManager.pause();
            } catch (err) {
              log('Failed to send feed hold:', err?.message || err);
            }

            // Wait for deceleration
            await new Promise(resolve => setTimeout(resolve, pauseBeforeStop));
          }
        }

        // Now send the soft reset
        try {
          jobManager.stop();
          log('Job stopped via WebSocket command');
        } catch (jobError) {
          log('Job processor error (WebSocket stop):', jobError.message);
        }
      } else if (realtimeJobCommands.has(commandValue) && jobManager.hasActiveJob()) {
        try {
          if (commandValue === '!') {
            jobManager.pause();
            log('Job paused via WebSocket command');
          } else if (commandValue === '~') {
            jobManager.resume();
            log('Job resumed via WebSocket command');
          }
        } catch (jobError) {
          log('Job processor error (WebSocket command):', jobError.message);
        }
      }

      // Process command through Command Processor
      const pluginContext = {
        sourceId: metaPayload.sourceId || 'client',
        commandId: normalizedCommandId,
        meta: metaPayload,
        machineState: cncController.lastStatus
      };

      const result = await commandProcessor.instance.process(commandValue, pluginContext);

      // Check if command was skipped (e.g., same-tool M6)
      if (!result.shouldContinue) {
        return; // Early return - command already handled and broadcast
      }

      const commands = result.commands;

      // Iterate through command array and send each to controller
      for (const cmd of commands) {
        const cmdDisplayCommand = cmd.displayCommand ? formatCommandText(cmd.displayCommand) : formatCommandText(cmd.command);
        const cmdMeta = { ...metaPayload, ...(cmd.meta || {}) };

        // Generate unique commandId for each command in the array
        const uniqueCommandId = cmd.commandId || `${normalizedCommandId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        await cncController.sendCommand(cmd.command, {
          commandId: uniqueCommandId,
          displayCommand: cmdDisplayCommand,
          meta: Object.keys(cmdMeta).length > 0 ? cmdMeta : null
        });
      }

      if (commandValue === '?' && metaPayload.sourceId !== 'system') {
        const rawData = cncController.getRawData();
        if (rawData && rawData.trim() !== '') {
          broadcast('cnc-data', rawData);
        }
      }
    } catch (error) {
      const errorPayload = {
        message: error?.message || 'Failed to send command',
        code: error?.code
      };
      log('WebSocket command failed', commandMeta.displayCommand, `id=${normalizedCommandId}`, errorPayload.message);
    }
  };

  const broadcastQueuedCommand = (event) => {
    if (event.meta?.sourceId === 'system') {
      return;
    }

    // Skip broadcasting silent commands (e.g., plugin-generated internal commands)
    if (event.meta?.silent) {
      return;
    }

    const payload = toCommandPayload(event, { status: 'pending' });
    broadcast('cnc-command', payload);

    if (event.meta?.continuous) {
      longRunningCommands.set(event.id, payload);
    }
  };

  const broadcastCommandResult = (event) => {
    if (event.meta?.sourceId === 'system') {
      return;
    }

    // Skip broadcasting silent command results
    if (event.meta?.silent) {
      return;
    }

    // Continuous jog success: send ack with silentCompletion flag so UI can
    // clear pending state without showing a new terminal line
    if (event.status === 'success' && event.meta?.continuous) {
      const payload = toCommandPayload(event, { includeTimestamp: false });
      payload.status = 'success';
      payload.meta = { ...payload.meta, silentCompletion: true };
      broadcast('cnc-command-result', payload);
      longRunningCommands.delete(event.id);
      return;
    }

    let status = event.status || 'success';
    const payload = toCommandPayload(event, { includeTimestamp: false });

    if (status === 'flushed') {
      status = 'error';
      payload.status = 'error';
      payload.error = {
        message: 'Command flushed: likely due to connection loss or controller reset',
        code: 'FLUSHED'
      };
    } else {
      payload.status = status;
    }

    broadcast('cnc-command-result', payload);

    computeJobProgressFields();
    broadcast('server-state-updated', serverState);

    if (isToolChangeCommand(payload.command)) {
      setToolChanging(false);
    }

    const completionId = event.meta?.completesCommandId;
    if (completionId) {
      const tracked = longRunningCommands.get(completionId) || { ...payload, id: completionId };
      const completionPayload = {
        ...tracked,
        status: status === 'success' ? 'success' : 'error',
        timestamp: payload.timestamp,
        error: payload.error
      };
      broadcast('cnc-command-result', completionPayload);
      longRunningCommands.delete(completionId);
    }

    if (event.meta?.continuous) {
      longRunningCommands.delete(event.id);
    }
  };

  wss.on('connection', async (ws, req) => {
    // Generate unique client ID
    const clientId = `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    ws.clientId = clientId;
    clientIdToWsMap.set(clientId, ws);

    const clientIp = req?.socket?.remoteAddress || 'unknown';
    const isLocal = isLocalConnection(req);
    ws.isLocal = isLocal;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const product = url.searchParams.get('product') || null;
    const machineId = url.searchParams.get('machineId') || null;
    const clientVersion = url.searchParams.get('version') || null;
    const licensed = url.searchParams.get('licensed') === 'true';
    const preferWifi = url.searchParams.get('preferWifi') !== 'false'; // Default true if not specified

    const clientMeta = {
      clientId,
      ip: clientIp,
      isLocal,
      product,
      machineId,
      version: clientVersion,
      licensed,
      preferWifi,
      connectedAt: Date.now()
    };
    clientRegistry.set(clientId, clientMeta);

    log('Client connected with ID:', clientId, 'IP:', clientIp, isLocal ? '(local)' : '(remote)', product ? `product: ${product}` : '');
    clients.add(ws);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    broadcast('client:connected', clientMeta);

    // Send client ID with local/remote info and remote control setting
    const remoteControlEnabled = getSetting('remoteControl.enabled', false);
    sendWsMessage(ws, 'client-id', {
      clientId,
      isLocal,
      remoteControlEnabled
    });

    ws.on('message', (rawData) => {
      let parsed;
      try {
        if (typeof rawData === 'string') {
          parsed = JSON.parse(rawData);
        } else if (rawData) {
          parsed = JSON.parse(rawData.toString());
        }
      } catch (error) {
        log('Ignoring invalid WebSocket payload (not JSON)', error?.message || error);
        sendWsMessage(ws, 'ws:error', { message: 'Invalid payload' });
        return;
      }

      if (!parsed || typeof parsed.type !== 'string') {
        log('Ignoring WebSocket payload with missing type');
        return;
      }

      if (parsed.type.startsWith('jog:')) {
        if (!jogManager) {
          return;
        }

        jogManager.handleMessage(ws, parsed).catch((error) => {
          log('Error handling jog message', error?.message || error);
        });
        return;
      }

      if (parsed.type.startsWith('plugin:')) {
        const match = parsed.type.match(/^plugin:([\w.-]+):(.+)$/);

        if (match) {
          const [, pluginId, eventName] = match;
          pluginManager.getEventBus().emitAsync(eventName, parsed.data).catch((error) => {
            log(`Error handling plugin message for ${pluginId}:${eventName}`, error?.message || error);
          });
        }
        return;
      }

      switch (parsed.type) {
        case 'cnc:command':
          handleWebSocketCommand(ws, parsed.data).catch((error) => {
            log('Error handling CNC command', error?.message || error);
          });
          break;
        case 'job:progress:close': {
          try {
            if (serverState.jobLoaded) {
              serverState.jobLoaded.status = null;
              serverState.jobLoaded.currentLine = 0;
              serverState.jobLoaded.jobStartTime = null;
              serverState.jobLoaded.jobEndTime = null;
              serverState.jobLoaded.jobPauseAt = null;
              serverState.jobLoaded.jobPausedTotalSec = 0;
              serverState.jobLoaded.remainingSec = null;
              serverState.jobLoaded.progressPercent = null;
              serverState.jobLoaded.runtimeSec = null;
              broadcast('server-state-updated', serverState);
            }
          } catch (error) {
            log('Error handling job:progress:close', error?.message || error);
          }
          break;
        }
        case 'plugin-dialog-response':
          pluginManager.getEventBus().emit('client:dialog-response', parsed.data);
          break;
        case 'client:metadata': {
          const existing = clientRegistry.get(ws.clientId);
          if (existing && parsed.data) {
            Object.assign(existing, parsed.data);
            broadcast('client:metadata-updated', existing);
          }
          break;
        }
        default:
          log('Received unsupported WebSocket message type:', parsed.type);
          break;
      }
    });

    ws.on('close', () => {
      log('Client disconnected:', ws.clientId);
      const meta = clientRegistry.get(ws.clientId);
      if (meta) {
        broadcast('client:disconnected', meta);
        clientRegistry.delete(ws.clientId);
      }
      clients.delete(ws);
      if (ws.clientId) {
        clientIdToWsMap.delete(ws.clientId);
      }
      if (jogManager) {
        jogManager.handleDisconnect(ws).catch((error) => {
          log('Error handling jog disconnect', error?.message || error);
        });
      }
    });

    ws.on('error', (error) => {
      log('WebSocket error:', error);
      const meta = clientRegistry.get(ws.clientId);
      if (meta) {
        broadcast('client:disconnected', meta);
        clientRegistry.delete(ws.clientId);
      }
      clients.delete(ws);
      if (ws.clientId) {
        clientIdToWsMap.delete(ws.clientId);
      }
      if (jogManager) {
        jogManager.handleDisconnect(ws).catch((disconnectError) => {
          log('Error handling jog disconnect after error', disconnectError?.message || disconnectError);
        });
      }
    });

    computeJobProgressFields();
    updateSenderStatus();
    sendWsMessage(ws, 'server-state-updated', serverState);

    // Send loaded G-code metadata if available (not full content)
    if (serverState.jobLoaded?.filename) {
      try {
        const cachePath = path.join(getUserDataDir(), 'gcode-cache', 'current.gcode');
        const stats = await fs.stat(cachePath);
        const gcodeMessage = {
          filename: serverState.jobLoaded.filename,
          totalLines: serverState.jobLoaded.totalLines,
          size: stats.size,
          timestamp: new Date().toISOString()
        };
        sendWsMessage(ws, 'gcode-updated', gcodeMessage);
      } catch (error) {
        log('Failed to read cached G-code metadata:', error);
      }
    }

    // Send greeting message to late-joining clients (but mark as initial-greeting to prevent duplicate in console)
    if (serverState.greetingMessage) {
      setTimeout(() => {
        sendWsMessage(ws, 'initial-greeting', serverState.greetingMessage);
      }, 100);
    }

    // Re-send any pending plugin dialogs to reconnecting browser clients only (not product clients like pendants)
    const pendingDialogs = pluginManager.getPendingDialogs();
    const clientProduct = clientRegistry.get(clientId)?.product;
    if (pendingDialogs.length > 0 && !clientProduct) {
      setTimeout(() => {
        for (const dialog of pendingDialogs) {
          sendWsMessage(ws, 'plugin:show-dialog', dialog);
        }
      }, 500);
    }
  });

  cncController.on('command-queued', broadcastQueuedCommand);
  cncController.on('command-ack', broadcastCommandResult);

  const PING_INTERVAL_MS = 5000;
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        log('Client ping timeout, terminating:', ws.clientId);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, PING_INTERVAL_MS);

  const shutdown = () => {
    clearInterval(pingInterval);
    wss.close();
    cncController.off?.('command-queued', broadcastQueuedCommand);
    cncController.off?.('command-ack', broadcastCommandResult);
  };

  const broadcastRemoteControlState = () => {
    const enabled = getSetting('remoteControl.enabled', false);
    broadcast('remote-control-state', { enabled });
  };

  return {
    wss,
    broadcast,
    sendWsMessage,
    handleWebSocketCommand,
    getClientWebSocket: (clientId) => clientIdToWsMap.get(clientId),
    getClientRegistry: () => [...clientRegistry.values()],
    broadcastRemoteControlState,
    shutdown
  };
}
