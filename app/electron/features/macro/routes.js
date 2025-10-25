import { Router } from 'express';
import {
  readMacros,
  getMacro,
  createMacro,
  updateMacro,
  deleteMacro
} from './storage.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

export function createMacroRoutes(cncController, commandProcessor) {
  const router = Router();

  router.get('/macros', (req, res) => {
    try {
      const macros = readMacros();
      res.json(macros);
    } catch (error) {
      log('Error reading macros:', error);
      res.status(500).json({ error: 'Failed to read macros' });
    }
  });

  router.get('/macros/:id', (req, res) => {
    try {
      const macro = getMacro(req.params.id);
      if (!macro) {
        return res.status(404).json({ error: 'Macro not found' });
      }
      res.json(macro);
    } catch (error) {
      log('Error reading macro:', error);
      res.status(500).json({ error: 'Failed to read macro' });
    }
  });

  router.post('/macros', (req, res) => {
    try {
      const { name, description, commands } = req.body;

      if (!name || !commands) {
        return res.status(400).json({ error: 'Name and commands are required' });
      }

      const newMacro = createMacro({ name, description, commands });
      res.status(201).json(newMacro);
    } catch (error) {
      log('Error creating macro:', error);
      res.status(500).json({ error: 'Failed to create macro' });
    }
  });

  router.put('/macros/:id', (req, res) => {
    try {
      const { name, description, commands } = req.body;
      const updates = {};

      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (commands !== undefined) updates.commands = commands;

      const updatedMacro = updateMacro(req.params.id, updates);
      res.json(updatedMacro);
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      log('Error updating macro:', error);
      res.status(500).json({ error: 'Failed to update macro' });
    }
  });

  router.delete('/macros/:id', (req, res) => {
    try {
      const result = deleteMacro(req.params.id);
      res.json(result);
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      log('Error deleting macro:', error);
      res.status(500).json({ error: 'Failed to delete macro' });
    }
  });

  router.post('/macros/:id/execute', async (req, res) => {
    try {
      if (!cncController || !cncController.isConnected) {
        return res.status(503).json({ error: 'CNC controller is not connected' });
      }

      const macro = getMacro(req.params.id);
      if (!macro) {
        return res.status(404).json({ error: 'Macro not found' });
      }

      // Split commands by newline and filter empty lines
      const commands = macro.commands.split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');

      log(`Executing macro: ${macro.name} (${commands.length} commands)`);

      // Send each command separately
      for (const command of commands) {
        // Process command through Command Processor
        const pluginContext = {
          sourceId: 'macro',
          commandId: `macro-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          meta: { sourceId: 'macro', macroId: req.params.id, macroName: macro.name },
          machineState: cncController.lastStatus
        };

        const result = await commandProcessor.instance.process(command, pluginContext);

        // Check if command was skipped (e.g., same-tool M6)
        if (!result.shouldContinue) {
          continue; // Skip to next command
        }

        const processedCommands = result.commands;

        // Iterate through command array and send each to controller
        for (const cmd of processedCommands) {
          const cmdDisplayCommand = cmd.displayCommand || cmd.command;
          const cmdMeta = {
            sourceId: 'macro',
            macroId: req.params.id,
            macroName: macro.name,
            ...(cmd.meta || {})
          };

          // Generate unique commandId for each command in the array
          const uniqueCommandId = cmd.commandId || `${pluginContext.commandId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

          await cncController.sendCommand(cmd.command, {
            commandId: uniqueCommandId,
            displayCommand: cmdDisplayCommand,
            meta: Object.keys(cmdMeta).length > 0 ? cmdMeta : null
          });
        }
      }

      res.json({
        success: true,
        message: `Macro "${macro.name}" executed successfully`,
        commandsExecuted: commands.length
      });
    } catch (error) {
      log('Error executing macro:', error);
      res.status(500).json({ error: 'Failed to execute macro', message: error.message });
    }
  });

  return router;
}
