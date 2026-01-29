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

import { Router } from 'express';
import {
  listMacros,
  getMacro,
  createMacro,
  updateMacro,
  deleteMacro,
  getNextAvailableId,
  validateMacroId,
  getIdRange
} from './m98-storage.js';
import { runMigration, getMigrationStatus } from './migration.js';
import { readSettings, saveSettings } from '../../core/settings-manager.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('M98Routes');

export function createMacroRoutes(cncController, commandProcessor) {
  const router = Router();

  // Run migration on router creation (one-time)
  try {
    const migrationResult = runMigration();
    if (migrationResult.migrated && migrationResult.count > 0) {
      log(`Migrated ${migrationResult.count} macros from macros.json`);
    }
  } catch (err) {
    logError('Migration failed:', err);
  }

  // GET /api/m98-macros - List all macros
  router.get('/m98-macros', (req, res) => {
    try {
      const macros = listMacros();
      res.json(macros);
    } catch (error) {
      logError('Error listing macros:', error);
      res.status(500).json({ error: 'Failed to list macros' });
    }
  });

  // GET /api/m98-macros/next-id - Get next available ID
  router.get('/m98-macros/next-id', (req, res) => {
    try {
      const nextId = getNextAvailableId();
      const range = getIdRange();
      res.json({ nextId, ...range });
    } catch (error) {
      logError('Error getting next ID:', error);
      res.status(500).json({ error: 'Failed to get next ID' });
    }
  });

  // GET /api/m98-macros/migration-status - Get migration status
  router.get('/m98-macros/migration-status', (req, res) => {
    try {
      const status = getMigrationStatus();
      res.json(status);
    } catch (error) {
      logError('Error getting migration status:', error);
      res.status(500).json({ error: 'Failed to get migration status' });
    }
  });

  // GET /api/m98-macros/:id - Get single macro
  router.get('/m98-macros/:id', (req, res) => {
    try {
      const validation = validateMacroId(req.params.id);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const macro = getMacro(validation.id);
      if (!macro) {
        return res.status(404).json({ error: `Macro not found: ${validation.id}` });
      }
      res.json(macro);
    } catch (error) {
      logError('Error reading macro:', error);
      res.status(500).json({ error: 'Failed to read macro' });
    }
  });

  // POST /api/m98-macros - Create new macro
  router.post('/m98-macros', (req, res) => {
    try {
      const { id, name, description, body, content } = req.body;

      // Require either body or content
      if (!body && !content) {
        return res.status(400).json({ error: 'Body or content is required' });
      }

      const newMacro = createMacro({ id, name, description, body, content });
      res.status(201).json(newMacro);
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('Invalid macro ID')) {
        return res.status(400).json({ error: error.message });
      }
      logError('Error creating macro:', error);
      res.status(500).json({ error: 'Failed to create macro' });
    }
  });

  // PUT /api/m98-macros/:id - Update macro
  router.put('/m98-macros/:id', (req, res) => {
    try {
      const validation = validateMacroId(req.params.id);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const { name, description, body, content } = req.body;
      const updates = {};

      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (body !== undefined) updates.body = body;
      if (content !== undefined) updates.content = content;

      const updatedMacro = updateMacro(validation.id, updates);
      res.json(updatedMacro);
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      logError('Error updating macro:', error);
      res.status(500).json({ error: 'Failed to update macro' });
    }
  });

  // DELETE /api/m98-macros/:id - Delete macro
  router.delete('/m98-macros/:id', (req, res) => {
    try {
      const validation = validateMacroId(req.params.id);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const result = deleteMacro(validation.id);

      // Also remove any keyboard shortcut assigned to this macro
      try {
        const settings = readSettings();
        if (settings && settings.keyboardBindings) {
          const actionId = `Macro:${validation.id}`;
          if (actionId in settings.keyboardBindings) {
            const updatedBindings = { ...settings.keyboardBindings };
            delete updatedBindings[actionId];
            saveSettings({
              ...settings,
              keyboardBindings: updatedBindings
            });
            log(`Removed keyboard binding for deleted macro: ${actionId}`);
          }
        }
      } catch (bindingError) {
        logError('Failed to remove keyboard binding for deleted macro:', bindingError);
      }

      res.json(result);
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      logError('Error deleting macro:', error);
      res.status(500).json({ error: 'Failed to delete macro' });
    }
  });

  // POST /api/m98-macros/:id/execute - Execute macro directly
  router.post('/m98-macros/:id/execute', async (req, res) => {
    try {
      if (!cncController || !cncController.isConnected) {
        return res.status(503).json({ error: 'CNC controller is not connected' });
      }

      const validation = validateMacroId(req.params.id);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const macro = getMacro(validation.id);
      if (!macro) {
        return res.status(404).json({ error: `Macro not found: ${validation.id}` });
      }

      // Execute via M98 command through the command processor
      const m98Command = `M98 P${validation.id}`;
      log(`Executing macro via: ${m98Command}`);

      const pluginContext = {
        sourceId: 'macro',
        commandId: `macro-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        meta: { sourceId: 'macro', macroId: validation.id, macroName: macro.name },
        machineState: cncController.lastStatus
      };

      const result = await commandProcessor.instance.process(m98Command, pluginContext);

      if (!result.shouldContinue) {
        if (result.error) {
          return res.status(400).json({ error: result.error });
        }
        return res.json({
          success: true,
          message: `Macro "${macro.name}" (${validation.id}) processed`,
          commandsExecuted: 0
        });
      }

      const processedCommands = result.commands || [];

      // Send each processed command to the controller
      for (const cmd of processedCommands) {
        const cmdDisplayCommand = cmd.displayCommand || cmd.command;
        const cmdMeta = {
          sourceId: 'macro',
          macroId: validation.id,
          macroName: macro.name,
          ...(cmd.meta || {})
        };

        const uniqueCommandId = cmd.commandId || `${pluginContext.commandId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        await cncController.sendCommand(cmd.command, {
          commandId: uniqueCommandId,
          displayCommand: cmdDisplayCommand,
          meta: Object.keys(cmdMeta).length > 0 ? cmdMeta : null
        });
      }

      res.json({
        success: true,
        message: `Macro "${macro.name}" (${validation.id}) executed successfully`,
        commandsExecuted: processedCommands.length
      });
    } catch (error) {
      logError('Error executing macro:', error);
      res.status(500).json({ error: 'Failed to execute macro', message: error.message });
    }
  });

  // Legacy routes for backward compatibility (redirect to new endpoints)
  router.get('/macros', (req, res) => {
    res.redirect(301, '/api/m98-macros');
  });

  router.get('/macros/:id', (req, res) => {
    res.redirect(301, `/api/m98-macros/${req.params.id}`);
  });

  router.post('/macros', (req, res) => {
    res.redirect(307, '/api/m98-macros');
  });

  router.put('/macros/:id', (req, res) => {
    res.redirect(307, `/api/m98-macros/${req.params.id}`);
  });

  router.delete('/macros/:id', (req, res) => {
    res.redirect(307, `/api/m98-macros/${req.params.id}`);
  });

  router.post('/macros/:id/execute', (req, res) => {
    res.redirect(307, `/api/m98-macros/${req.params.id}/execute`);
  });

  return router;
}
