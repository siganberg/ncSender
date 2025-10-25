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

export function createMacroRoutes(cncController) {
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

      // Send all commands as a single multi-line command
      const multiLineCommand = commands.join('\n');
      await cncController.sendCommand(multiLineCommand, {
        meta: { sourceId: 'macro' }
      });

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
