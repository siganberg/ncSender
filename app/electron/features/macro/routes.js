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

export function createMacroRoutes() {
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
      const { name, description, category, commands } = req.body;

      if (!name || !commands) {
        return res.status(400).json({ error: 'Name and commands are required' });
      }

      const newMacro = createMacro({ name, description, category, commands });
      res.status(201).json(newMacro);
    } catch (error) {
      log('Error creating macro:', error);
      res.status(500).json({ error: 'Failed to create macro' });
    }
  });

  router.put('/macros/:id', (req, res) => {
    try {
      const { name, description, category, commands } = req.body;
      const updates = {};

      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (category !== undefined) updates.category = category;
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

  return router;
}
