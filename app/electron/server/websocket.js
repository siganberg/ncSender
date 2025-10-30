import { WebSocketServer } from 'ws';
import { getSetting, DEFAULT_SETTINGS } from '../core/settings-manager.js';
import { pluginManager } from '../core/plugin-manager.js';
import { parseM6Command, isM6Command } from '../utils/gcode-patterns.js';

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

const describeCommand = (command) => {
  const realTimeCommands = {
    [String.fromCharCode(0x90)]: '\\x90 (Feed Rate Override Reset 100%)',
    [String.fromCharCode(0x91)]: '\\x91 (Feed Rate Override +10%)',
    [String.fromCharCode(0x92)]: '\\x92 (Feed Rate Override -10%)',
    [String.fromCharCode(0x93)]: '\\x93 (Feed Rate Override +1%)',
    [String.fromCharCode(0x94)]: '\\x94 (Feed Rate Override -1%)',
    [String.fromCharCode(0x99)]: '\\x99 (Spindle Speed Override Reset 100%)',
    [String.fromCharCode(0x9A)]: '\\x9A (Spindle Speed Override +10%)',
    [String.fromCharCode(0x9B)]: '\\x9B (Spindle Speed Override -10%)',
    [String.fromCharCode(0x9C)]: '\\x9C (Spindle Speed Override +1%)',
    [String.fromCharCode(0x9D)]: '\\x9D (Spindle Speed Override -1%)',
    [String.fromCharCode(0x85)]: '\\x85 (Jog Cancel)',
    [String.fromCharCode(0x84)]: '\\x84 (Safety Door)',
    [String.fromCharCode(0x18)]: '\\x18 (Soft Reset)',
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
  log,
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
    // Default to 'client' sourceId if not provided
    if (!metaPayload.sourceId) {
      metaPayload.sourceId = 'client';
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

      // Helper to parse machine position
      const parseMachinePosition = (machinePosition) => {
        let x, y;
        if (typeof machinePosition === 'string') {
          const parts = machinePosition.split(',').map(p => parseFloat(p.trim()));
          x = parts[0];
          y = parts[1];
        } else if (machinePosition && typeof machinePosition === 'object') {
          x = machinePosition.x;
          y = machinePosition.y;
        }
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      };

      // Handle $TLS command - set tool changing flag and save return position
      let tlsReturnPosition = null;
      if (commandValue === '$TLS') {
        log('$TLS command detected, setting isToolChanging flag');
        serverState.machineState.isToolChanging = true;

        const machinePosition = serverState.machineState?.MPos;
        log('Current machine position:', JSON.stringify(machinePosition));

        tlsReturnPosition = parseMachinePosition(machinePosition);

        if (tlsReturnPosition) {
          metaPayload.originalMachinePosition = tlsReturnPosition;
          log('Saved TLS return position:', JSON.stringify(tlsReturnPosition));
        } else {
          log('No valid return position available');
        }
      }

      // Handle M6 command - set tool changing flag and save return position
      let m6ReturnPosition = null;
      if (isM6Command(commandValue)) {
        log('M6 command detected, setting isToolChanging flag');
        serverState.machineState.isToolChanging = true;

        const machinePosition = serverState.machineState?.MPos;
        log('Current machine position:', JSON.stringify(machinePosition));

        m6ReturnPosition = parseMachinePosition(machinePosition);

        if (m6ReturnPosition) {
          metaPayload.originalMachinePosition = m6ReturnPosition;
          log('Saved M6 return position:', JSON.stringify(m6ReturnPosition));
        } else {
          log('No valid return position available');
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

      let commands = result.commands;

      // Add return-to-position command for $TLS
      if (commandValue === '$TLS' && tlsReturnPosition) {
        const xCommand = tlsReturnPosition.x.toFixed(3);
        const yCommand = tlsReturnPosition.y.toFixed(3);
        const returnCommand = `G53 G21 G0 X${xCommand} Y${yCommand}`;
        log('Adding TLS return command:', returnCommand);
        commands = [
          ...commands,
          {
            command: returnCommand,
            displayCommand: returnCommand,
            meta: { ...metaPayload, sourceId: metaPayload.sourceId || 'tls' }
          }
        ];
        log('Total commands to execute:', commands.length);
      }

      // Add return-to-position command for M6
      if (isM6Command(commandValue) && m6ReturnPosition) {
        const xCommand = m6ReturnPosition.x.toFixed(3);
        const yCommand = m6ReturnPosition.y.toFixed(3);
        const returnCommand = `G53 G21 G0 X${xCommand} Y${yCommand}`;
        log('Adding M6 return command:', returnCommand);
        commands = [
          ...commands,
          {
            command: returnCommand,
            displayCommand: returnCommand,
            meta: { ...metaPayload, sourceId: metaPayload.sourceId || 'tool-change' }
          }
        ];
        log('Total commands to execute:', commands.length);
      }

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
    // Generate unique client ID
    const clientId = `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    ws.clientId = clientId;
    clientIdToWsMap.set(clientId, ws);

    log('Client connected with ID:', clientId);
    clients.add(ws);

    // Send client ID to the client
    sendWsMessage(ws, 'client-id', { clientId });

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
        default:
          log('Received unsupported WebSocket message type:', parsed.type);
          break;
      }
    });

    ws.on('close', () => {
      log('Client disconnected:', ws.clientId);
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
    getClientWebSocket: (clientId) => clientIdToWsMap.get(clientId),
    shutdown
  };
}
