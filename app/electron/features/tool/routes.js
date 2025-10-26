import { Router } from 'express';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

const parseCoordinate = (value) => {
  if (value == null) return null;

  if (typeof value === 'string') {
    const parts = value.split(',').map(part => Number.parseFloat(part.trim()));
    if (parts.length >= 2 && parts.every(Number.isFinite)) {
      return { x: parts[0], y: parts[1], z: parts[2] ?? 0 };
    }
    return null;
  }

  if (Array.isArray(value)) {
    const [x, y, z] = value;
    if ([x, y].every(Number.isFinite)) {
      return { x, y, z: Number.isFinite(z) ? z : 0 };
    }
    return null;
  }

  if (typeof value === 'object') {
    const { x, y, z } = value;
    if ([x, y].every(Number.isFinite)) {
      return { x, y, z: Number.isFinite(z) ? z : 0 };
    }
  }

  return null;
};

export function createToolRoutes(cncController, serverState, commandProcessor) {
  const router = Router();

  router.post('/tls', async (req, res) => {
    try {
      if (!cncController || !cncController.isConnected) {
        return res.status(503).json({ error: 'CNC controller is not connected' });
      }

      const machineState = serverState?.machineState;
      const machinePosition = parseCoordinate(machineState?.MPos);
      const hasReturnPosition = machinePosition && [machinePosition.x, machinePosition.y].every(Number.isFinite);

      const xCommand = hasReturnPosition ? machinePosition.x.toFixed(3) : null;
      const yCommand = hasReturnPosition ? machinePosition.y.toFixed(3) : null;

      const commands = [
        '$TLS',
        ...(hasReturnPosition ? [`G53 G21 G0 X${xCommand} Y${yCommand}`] : [])
      ];

      const meta = {
        sourceId: 'tls',
        originalMachinePosition: hasReturnPosition ? { x: machinePosition.x, y: machinePosition.y } : null
      };

      let commandsExecuted = 0;
      for (const command of commands) {
        try {
          log(`Executing TLS command: ${command}`);

          // Process command through Command Processor
          const pluginContext = {
            sourceId: 'tls',
            commandId: `tls-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            meta,
            machineState: cncController.lastStatus
          };

          const result = await commandProcessor.instance.process(command, pluginContext);

          if (!result.shouldContinue) {
            commandsExecuted++;
            continue;
          }

          const processedCommands = result.commands;

          // Iterate through command array and send each to controller
          for (const cmd of processedCommands) {
            const cmdDisplayCommand = cmd.displayCommand || cmd.command;
            const cmdMeta = { ...meta, ...(cmd.meta || {}) };

            // Generate unique commandId for each command in the array
            const uniqueCommandId = cmd.commandId || `${pluginContext.commandId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

            await cncController.sendCommand(cmd.command, {
              commandId: uniqueCommandId,
              displayCommand: cmdDisplayCommand,
              meta: Object.keys(cmdMeta).length > 0 ? cmdMeta : null
            });
          }

          commandsExecuted++;
        } catch (error) {
          // If queue was flushed (e.g., user pressed Stop/soft reset), treat as intentional cancellation
          if (error.code === 'COMMAND_FLUSHED') {
            log('TLS cancelled by user (queue flush)');
            return res.json({
              success: true,
              cancelled: true,
              commandsExecuted,
              message: 'TLS cancelled by user'
            });
          }
          throw error;
        }
      }

      res.json({
        success: true,
        commandsExecuted,
        machinePosition: hasReturnPosition ? { x: machinePosition.x, y: machinePosition.y } : null
      });
    } catch (error) {
      log('Error executing TLS:', error);
      log('Error stack:', error.stack);
      res.status(500).json({
        error: 'Failed to execute TLS',
        message: error.message,
        details: error.stack
      });
    }
  });

  router.post('/tool-change', async (req, res) => {
    try {
      if (!cncController || !cncController.isConnected) {
        return res.status(503).json({ error: 'CNC controller is not connected' });
      }

      const { tool, toolNumber } = req.body || {};
      const toolSelector = tool ?? toolNumber;
      const parsedTool = Number.parseInt(toolSelector, 10);

      if (!Number.isFinite(parsedTool) || parsedTool < 0) {
        return res.status(400).json({ error: 'Invalid tool number' });
      }

      const machineState = serverState?.machineState;
      const machinePosition = parseCoordinate(machineState?.MPos);
      const hasReturnPosition = machinePosition && [machinePosition.x, machinePosition.y].every(Number.isFinite);

      const xCommand = hasReturnPosition ? machinePosition.x.toFixed(3) : null;
      const yCommand = hasReturnPosition ? machinePosition.y.toFixed(3) : null;

      const commands = [
        `M6 T${parsedTool}`,
        ...(hasReturnPosition ? [`G53 G21 G0 X${xCommand} Y${yCommand}`] : [])
      ];

      const meta = {
        sourceId: 'tool-change',
        toolNumber: parsedTool,
        originalMachinePosition: hasReturnPosition ? { x: machinePosition.x, y: machinePosition.y } : null
      };

      let commandsExecuted = 0;
      for (const command of commands) {
        try {
          log(`Executing tool change command: ${command}`);

          // Process command through Command Processor
          const pluginContext = {
            sourceId: 'tool-change',
            commandId: `tool-change-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            meta,
            machineState: cncController.lastStatus
          };

          const result = await commandProcessor.instance.process(command, pluginContext);

          // Check if command was skipped (e.g., same-tool M6)
          if (!result.shouldContinue) {
            commandsExecuted++;
            continue; // Skip to next command
          }

          const processedCommands = result.commands;

          // Iterate through command array and send each to controller
          for (const cmd of processedCommands) {
            const cmdDisplayCommand = cmd.displayCommand || cmd.command;
            const cmdMeta = { ...meta, ...(cmd.meta || {}) };

            // Generate unique commandId for each command in the array
            const uniqueCommandId = cmd.commandId || `${pluginContext.commandId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

            await cncController.sendCommand(cmd.command, {
              commandId: uniqueCommandId,
              displayCommand: cmdDisplayCommand,
              meta: Object.keys(cmdMeta).length > 0 ? cmdMeta : null
            });
          }

          commandsExecuted++;
        } catch (error) {
          // If queue was flushed (e.g., user pressed Stop/soft reset), treat as intentional cancellation
          if (error.code === 'COMMAND_FLUSHED') {
            log('Tool change cancelled by user (queue flush)');
            return res.json({
              success: true,
              cancelled: true,
              toolNumber: parsedTool,
              commandsExecuted,
              message: 'Tool change cancelled by user'
            });
          }
          throw error;
        }
      }

      res.json({
        success: true,
        toolNumber: parsedTool,
        commandsExecuted,
        machinePosition: hasReturnPosition ? { x: machinePosition.x, y: machinePosition.y } : null
      });
    } catch (error) {
      log('Error executing tool change macro:', error);
      log('Error stack:', error.stack);
      log('Tool number:', req.body);
      res.status(500).json({
        error: 'Failed to execute tool change macro',
        message: error.message,
        details: error.stack
      });
    }
  });

  return router;
}
