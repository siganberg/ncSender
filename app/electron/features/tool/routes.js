import { Router } from 'express';
import { pluginManager } from '../../core/plugin-manager.js';

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

const computeWorkPosition = (machineState) => {
  if (!machineState) return null;

  const workPos = parseCoordinate(machineState.WPos ?? machineState.WPO ?? machineState.WorkPosition);
  if (workPos) return workPos;

  const machinePos = parseCoordinate(machineState.MPos ?? machineState.MPOS);
  const wco = parseCoordinate(machineState.WCO ?? machineState.WorkCoordinateOffset);

  if (machinePos && wco) {
    return {
      x: machinePos.x - wco.x,
      y: machinePos.y - wco.y,
      z: machinePos.z - wco.z
    };
  }

  return null;
};

export function createToolRoutes(cncController, serverState) {
  const router = Router();

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
      const workPosition = computeWorkPosition(machineState);
      const hasReturnPosition = workPosition && [workPosition.x, workPosition.y].every(Number.isFinite);

      const xCommand = hasReturnPosition ? workPosition.x.toFixed(3) : null;
      const yCommand = hasReturnPosition ? workPosition.y.toFixed(3) : null;

      const commands = [
        `M6 T${parsedTool}`,
        ...(hasReturnPosition ? [`G90 G0 X${xCommand} Y${yCommand}`] : [])
      ];

      const meta = {
        sourceId: 'tool-change',
        toolNumber: parsedTool,
        originalWorkPosition: hasReturnPosition ? { x: workPosition.x, y: workPosition.y } : null
      };

      let commandsExecuted = 0;
      for (const command of commands) {
        try {
          log(`Executing tool change command: ${command}`);

          // Process command through Plugin Manager
          const pluginContext = {
            sourceId: 'tool-change',
            commandId: `tool-change-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            meta,
            machineState: cncController.lastStatus
          };

          const processedCommands = await pluginManager.processCommand(command, pluginContext);

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
        workPosition: hasReturnPosition ? { x: workPosition.x, y: workPosition.y } : null
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
