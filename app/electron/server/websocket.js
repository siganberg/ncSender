import { WebSocketServer } from 'ws';
import { getSetting, DEFAULT_SETTINGS } from '../core/settings-manager.js';

const WS_READY_STATE_OPEN = 1;
const realtimeJobCommands = new Set(['!', '~', '\\x18']);

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
      || key === 'isToolChanging'
      || key === 'totalEstimatedSec'
      || key === 'progressProvider'
      || key === 'jobStartTime'
      || key === 'jobEndTime'
      || key === 'jobPauseAt'
      || key === 'jobPausedTotalSec'
      || key === 'feedRateCommanded'
      || key === 'Bf'
      || key === 'Pn') {
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
  const hexMatch = /^\\\x([0-9a-fA-F]{2})$/i.exec(trimmed);
  if (hexMatch) {
    const charCode = parseInt(hexMatch[1], 16);
    return {
      command: String.fromCharCode(charCode),
      displayCommand: trimmed
    };
  }

  return { command: trimmed, displayCommand: trimmed };
};

const formatCommandText = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  let needsEscaping = false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      needsEscaping = true;
      break;
    }
  }

  if (!needsEscaping) {
    return value;
  }

  return Array.from(value).map((char) => {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      return `\\x${code.toString(16).toUpperCase().padStart(2, '0')}`;
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
    displayCommand: event.displayCommand || formatCommandText(event.command),
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

  if (resolvedSourceId && resolvedSourceId !== 'no-broadcast') {
    payload.sourceId = resolvedSourceId;
  }

  if (includeTimestamp) {
    payload.timestamp = event.timestamp || new Date().toISOString();
  }

  return payload;
};

const isToolChangeCommand = (cmd) => {
  if (!cmd || typeof cmd !== 'string') return false;
  return /M6(?!\d)/i.test(cmd);
};

const parseToolParam = (cmd) => {
  if (!cmd || typeof cmd !== 'string') return undefined;
  const m = cmd.match(/(^|\s)T(\d+)/i);
  if (!m) return undefined;
  const n = parseInt(m[2], 10);
  return Number.isFinite(n) ? n : undefined;
};

export function createWebSocketLayer({
  httpServer,
  cncController,
  jobManager,
  jogManager,
  context,
  log
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

    try {
      if (realtimeJobCommands.has(commandValue) && jobManager.hasActiveJob()) {
        try {
          if (commandValue === '!') {
            jobManager.pause();
            log('Job paused via WebSocket command');
          } else if (commandValue === '~') {
            jobManager.resume();
            log('Job resumed via WebSocket command');
          } else if (commandValue === '\\x18') {
            jobManager.stop();
            log('Job stopped via WebSocket command');
          }
        } catch (jobError) {
          log('Job processor error (WebSocket command):', jobError.message);
        }
      }

      await cncController.sendCommand(commandValue, {
        commandId: normalizedCommandId,
        displayCommand: commandMeta.displayCommand,
        meta: Object.keys(metaPayload).length > 0 ? metaPayload : null
      });

      if (commandValue === '?' && metaPayload.sourceId !== 'no-broadcast') {
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
    if (event.meta?.sourceId === 'no-broadcast') {
      return;
    }

    const payload = toCommandPayload(event, { status: 'pending' });
    broadcast('cnc-command', payload);

    if (isToolChangeCommand(payload.command)) {
      try {
        const requestedTool = parseToolParam(payload.command);
        const currentTool = Number(serverState?.machineState?.tool);
        if (
          requestedTool !== undefined
          && Number.isFinite(currentTool)
          && requestedTool === currentTool
        ) {
          log(`M6 queued for current tool T${requestedTool}; skipping isToolChanging toggle`);
        } else {
          setToolChanging(true);
        }
      } catch (error) {
        setToolChanging(true);
      }
    }

    if (event.meta?.continuous) {
      longRunningCommands.set(event.id, payload);
    }
  };

  const broadcastCommandResult = (event) => {
    if (event.meta?.sourceId === 'no-broadcast') {
      return;
    }

    if (event.status === 'success' && event.meta?.continuous) {
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

  wss.on('connection', (ws) => {
    log('Client connected');
    clients.add(ws);

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
        default:
          log('Received unsupported WebSocket message type:', parsed.type);
          break;
      }
    });

    ws.on('close', () => {
      log('Client disconnected');
      clients.delete(ws);
      if (jogManager) {
        jogManager.handleDisconnect(ws).catch((error) => {
          log('Error handling jog disconnect', error?.message || error);
        });
      }
    });

    ws.on('error', (error) => {
      log('WebSocket error:', error);
      clients.delete(ws);
      if (jogManager) {
        jogManager.handleDisconnect(ws).catch((disconnectError) => {
          log('Error handling jog disconnect after error', disconnectError?.message || disconnectError);
        });
      }
    });

    computeJobProgressFields();
    updateSenderStatus();
    sendWsMessage(ws, 'server-state-updated', serverState);

    if (serverState.greetingMessage) {
      setTimeout(() => {
        sendWsMessage(ws, 'cnc-data', serverState.greetingMessage);
      }, 100);
    }
  });

  cncController.on('command-queued', broadcastQueuedCommand);
  cncController.on('command-ack', broadcastCommandResult);

  const shutdown = () => {
    wss.close();
    cncController.off?.('command-queued', broadcastQueuedCommand);
    cncController.off?.('command-ack', broadcastCommandResult);
  };

  return {
    wss,
    broadcast,
    sendWsMessage,
    handleWebSocketCommand,
    shutdown
  };
}
