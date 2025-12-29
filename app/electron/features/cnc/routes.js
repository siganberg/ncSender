import { Router } from 'express';
import { jobManager } from '../gcode/job-manager.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('CNC');

export function createCNCRoutes(cncController, broadcast, commandProcessor) {
  const router = Router();

  const translateCommandInput = (rawCommand) => {
    if (typeof rawCommand !== 'string' || rawCommand.trim() === '') {
      return {
        error: { message: 'Command is required', code: 'INVALID_COMMAND' }
      };
    }

    const trimmed = rawCommand.trim();

    const hexMatch = /^\\x([0-9a-fA-F]{2})$/i.exec(trimmed);
    if (hexMatch) {
      const charCode = parseInt(hexMatch[1], 16);
      return {
        command: String.fromCharCode(charCode),
        displayCommand: trimmed
      };
    }

    return { command: trimmed, displayCommand: rawCommand.trim() };
  };

  const buildCommandContext = (body) => {
    const {
      command: rawCommand,
      commandId,
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
    const targetCompletionId =
      completesCommandId || normalizedMeta?.completesCommandId || normalizedCommandId;

    const commandMeta = {
      id: normalizedCommandId,
      command: commandValue,
      displayCommand: displayCommand || translation.displayCommand || commandValue,
      timestamp: new Date().toISOString(),
      meta: normalizedMeta
    };

    return {
      commandMeta,
      commandValue,
      targetCompletionId
    };
  };

  // List available serial ports
  router.get('/serial-ports', async (req, res) => {
    try {
      const ports = await cncController.listAvailablePorts();
      res.json(ports);
    } catch (error) {
      log('Error listing serial ports:', error);
      res.status(500).json({ error: 'Failed to list serial ports' });
    }
  });

  // Connect to CNC
  router.post('/connect', async (req, res) => {
    const { port, baudRate, ip, ethernetPort } = req.body;
    try {
      if (ip && ethernetPort) {
        // Manual ethernet connect
        await cncController.connectEthernet(ip, ethernetPort);
        res.json({ success: true, message: 'Ethernet connection successful' });
      } else if (port && baudRate) {
        // Manual USB connect
        await cncController.connect(port, baudRate);
        res.json({ success: true, message: 'USB connection successful' });
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
      log('Error connecting to CNC:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Disconnect from CNC
  router.post('/disconnect', async (req, res) => {
    try {
      cncController.disconnect();
      res.json({ success: true });
    } catch (error) {
      log('Error disconnecting from CNC:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get connection status
  router.get('/status', async (req, res) => {
    try {
      const status = cncController.getConnectionStatus();
      res.json(status);
    } catch (error) {
      log('Error getting status:', error);
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

      const { commandMeta, commandValue, targetCompletionId } = context;

      // Check for real-time commands that should signal the job processor
      const realTimeCommands = ['!', '~', '\x18'];
      if (realTimeCommands.includes(commandValue) && jobManager.hasActiveJob()) {
        try {
          if (commandValue === '!') {
            jobManager.pause();
            log('Job paused via send-command');
          } else if (commandValue === '~') {
            jobManager.resume();
            log('Job resumed via send-command');
          } else if (commandValue === '\x18') {
            jobManager.stop();
            log('Job stopped via send-command');
          }
        } catch (jobError) {
          log('Job processor error:', jobError.message);
        }
      }

      const metaPayload = commandMeta.meta ? { ...commandMeta.meta } : {};
      if (targetCompletionId) {
        metaPayload.completesCommandId = targetCompletionId;
      }
      // Default to 'client' sourceId if not provided
      if (!metaPayload.sourceId) {
        metaPayload.sourceId = 'client';
      }

      // Process command through Command Processor
      const pluginContext = {
        sourceId: metaPayload.sourceId || 'client',
        commandId: commandMeta.id,
        meta: metaPayload,
        machineState: cncController.lastStatus
      };

      const result = await commandProcessor.instance.process(commandValue, pluginContext);

      // Check if command was skipped (e.g., same-tool M6)
      if (!result.shouldContinue) {
        return res.json({ success: true, commandId: commandMeta.id, skipped: true });
      }

      const commands = result.commands;

      // Iterate through command array and send each to controller
      for (const cmd of commands) {
        const cmdDisplayCommand = cmd.displayCommand || cmd.command;
        const cmdMeta = { ...metaPayload, ...(cmd.meta || {}) };

        // Generate unique commandId for each command in the array
        const uniqueCommandId = cmd.commandId || `${commandMeta.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        await cncController.sendCommand(cmd.command, {
          commandId: uniqueCommandId,
          displayCommand: cmdDisplayCommand,
          meta: Object.keys(cmdMeta).length > 0 ? cmdMeta : null
        });
      }

      if (commandValue === '?' && metaPayload.sourceId !== 'system') {
        const rawData = cncController.getRawData();
        if (rawData && typeof broadcast === 'function') {
          broadcast('cnc-data', rawData);
        }
      }

      res.json({ success: true, commandId: commandMeta.id });
    } catch (error) {
      log('Error sending command:', error);
      const errorPayload = {
        message: error?.message || error,
        code: error?.code
      };

      if (context && !context.error) {
        const { commandMeta } = context;
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
