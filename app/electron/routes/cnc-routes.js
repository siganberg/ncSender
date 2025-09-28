import { Router } from 'express';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export function createCNCRoutes(cncController, broadcast) {
  const router = Router();
  const longRunningCommands = new Map();

  const translateCommandInput = (rawCommand) => {
    if (typeof rawCommand !== 'string' || rawCommand.trim() === '') {
      return {
        error: { message: 'Command is required', code: 'INVALID_COMMAND' }
      };
    }

    // Clean up command - remove semicolon comments first
    const trimmed = rawCommand.split(';')[0].trim();

    const hexMatch = /^0x([0-9a-fA-F]{2})$/i.exec(trimmed);
    if (hexMatch) {
      const charCode = parseInt(hexMatch[1], 16);
      return {
        command: String.fromCharCode(charCode),
        displayCommand: rawCommand.trim() // Keep original for display (with comments)
      };
    }

    return { command: trimmed, displayCommand: rawCommand.trim() };
  };

  const buildCommandContext = (body) => {
    const {
      command: rawCommand,
      commandId,
      clientId,
      displayCommand,
      meta,
      completesCommandId
    } = body || {};

    const translation = translateCommandInput(rawCommand);
    if (translation.error) {
      return { error: translation.error };
    }

    const normalizedCommandId = commandId ?? `${Date.now()}`;
    const normalizedMeta = meta && typeof meta === 'object' ? meta : null;
    const commandValue = translation.command;
    const isJogCancel = commandValue === '\x85';
    const isLongRunning = Boolean(normalizedMeta?.continuous);
    const targetCompletionId =
      completesCommandId || normalizedMeta?.completesCommandId || normalizedCommandId;

    const commandMeta = {
      id: normalizedCommandId,
      command: commandValue,
      displayCommand: displayCommand || translation.displayCommand || commandValue,
      originId: clientId ?? null,
      timestamp: new Date().toISOString(),
      meta: normalizedMeta
    };

    return {
      commandMeta,
      commandValue,
      isJogCancel,
      isLongRunning,
      targetCompletionId
    };
  };

  const broadcastEvent = (event, payload) => {
    if (typeof broadcast === 'function') {
      broadcast(event, payload);
    }
  };

  const broadcastPendingCommand = (commandMeta, isLongRunning) => {
    const pendingPayload = { ...commandMeta, status: 'pending' };
    broadcastEvent('cnc-command', pendingPayload);
    if (isLongRunning) {
      longRunningCommands.set(commandMeta.id, pendingPayload);
    }
  };

  const resolveTrackedCommand = (commandId, fallback) => {
    if (!commandId) {
      return fallback;
    }
    const tracked = longRunningCommands.get(commandId) || fallback;
    longRunningCommands.delete(commandId);
    return tracked;
  };

  const broadcastCommandSuccess = ({
    commandMeta,
    isJogCancel,
    isLongRunning,
    targetCompletionId
  }) => {
    if (isJogCancel) {
      if (!targetCompletionId) {
        return;
      }
      const trackedCommand = resolveTrackedCommand(targetCompletionId, {
        ...commandMeta,
        id: targetCompletionId
      });
      broadcastEvent('cnc-command-result', {
        ...trackedCommand,
        status: 'success',
        timestamp: new Date().toISOString()
      });
    } else if (!isLongRunning) {
      broadcastEvent('cnc-command-result', {
        ...commandMeta,
        status: 'success'
      });
    }
  };

  const broadcastCommandError = ({
    commandMeta,
    isJogCancel,
    isLongRunning,
    targetCompletionId,
    errorPayload
  }) => {
    if (isJogCancel) {
      if (!targetCompletionId) {
        return;
      }
      const trackedCommand = resolveTrackedCommand(targetCompletionId, {
        ...commandMeta,
        id: targetCompletionId
      });
      broadcastEvent('cnc-command-result', {
        ...trackedCommand,
        status: 'error',
        error: errorPayload,
        timestamp: new Date().toISOString()
      });
    } else {
      broadcastEvent('cnc-command-result', {
        ...commandMeta,
        status: 'error',
        error: errorPayload
      });
      if (isLongRunning) {
        longRunningCommands.delete(commandMeta.id);
      }
    }
  };

  // List available serial ports
  router.get('/serial-ports', async (req, res) => {
    try {
      const ports = await cncController.listAvailablePorts();
      res.json(ports);
    } catch (error) {
      console.error('Error listing serial ports:', error);
      res.status(500).json({ error: 'Failed to list serial ports' });
    }
  });

  // Connect to CNC
  router.post('/connect', async (req, res) => {
    const { port, baudRate } = req.body;
    try {
      if (port && baudRate) {
        // Manual connect
        await cncController.connect(port, baudRate);
        res.json({ success: true });
      } else {
        // Auto connect
        const success = await cncController.autoConnect();
        if (success) {
          res.json({ success: true, message: 'Auto-connect successful' });
        } else {
          res.json({ success: false, message: 'No suitable ports found or connection failed' });
        }
      }
    } catch (error) {
      console.error('Error connecting to CNC:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Disconnect from CNC
  router.post('/disconnect', async (req, res) => {
    try {
      cncController.disconnect();
      res.json({ success: true });
    } catch (error) {
      console.error('Error disconnecting from CNC:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get connection status
  router.get('/status', async (req, res) => {
    try {
      const status = cncController.getConnectionStatus();
      res.json(status);
    } catch (error) {
      console.error('Error getting status:', error);
      res.status(500).json({ error: 'Failed to get status' });
    }
  });

  // Send command to CNC
  router.post('/send-command', async (req, res) => {
    let context = null;
    try {
      context = buildCommandContext(req.body);
      if (context.error) {
        return res.status(400).json({
          success: false,
          error: context.error
        });
      }

      const { commandMeta, commandValue, isJogCancel, isLongRunning, targetCompletionId } = context;

      // If this is a status query command, just broadcast the latest raw response
      if (commandValue === '?') {
        broadcastCommandSuccess({
          commandMeta,
          isJogCancel,
          isLongRunning,
          targetCompletionId
        });

        const rawData = cncController.getRawData();
        if (rawData) {
          broadcastEvent('cnc-data', rawData);
        }
      } else {
        if (!isJogCancel) {
          broadcastPendingCommand(commandMeta, isLongRunning);
        }

        await cncController.sendCommand(commandValue);

        broadcastCommandSuccess({
          commandMeta,
          isJogCancel,
          isLongRunning,
          targetCompletionId
        });
      }

      res.json({ success: true, commandId: commandMeta.id });
    } catch (error) {
      console.error('Error sending command:', error);
      const errorPayload = {
        message: error?.message || error,
        code: error?.code
      };

      if (context && !context.error) {
        const { commandMeta, isJogCancel, isLongRunning, targetCompletionId } = context;
        broadcastCommandError({
          commandMeta,
          isJogCancel,
          isLongRunning,
          targetCompletionId,
          errorPayload
        });

        return res.status(200).json({
          success: false,
          error: errorPayload,
          commandId: commandMeta.id
        });
      }

      res.status(500).json({
        success: false,
        error: errorPayload
      });
    }
  });

  return router;
}
