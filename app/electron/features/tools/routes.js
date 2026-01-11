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

import express from 'express';
import path from 'node:path';
import {
  getAllTools,
  getToolById,
  addTool,
  updateTool,
  deleteTool,
  bulkUpdateTools
} from './tools-storage.js';
import { validateTool } from './tools-validation.js';
import { createLogger } from '../../core/logger.js';
import { getUserDataDir } from '../../utils/paths.js';

const { log, error: logError } = createLogger('Tools');

export function createToolsRoutes(broadcast) {
  const router = express.Router();

  /**
   * GET /api/tools - Get all tools
   */
  router.get('/tools', async (req, res) => {
    try {
      const tools = await getAllTools();
      res.json(tools);
    } catch (error) {
      log('Error getting tools:', error);
      res.status(500).json({ error: 'Failed to get tools' });
    }
  });

  /**
   * GET /api/tools/info - Get tools storage info
   */
  router.get('/tools/info', async (req, res) => {
    try {
      const storagePath = path.join(getUserDataDir(), 'tools.json');
      res.json({ storagePath });
    } catch (error) {
      log('Error getting tools info:', error);
      res.status(500).json({ error: 'Failed to get tools info' });
    }
  });

  /**
   * GET /api/tools/:id - Get tool by ID
   */
  router.get('/tools/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid tool ID' });
      }

      const tool = await getToolById(id);
      if (!tool) {
        return res.status(404).json({ error: 'Tool not found' });
      }

      res.json(tool);
    } catch (error) {
      log('Error getting tool:', error);
      res.status(500).json({ error: 'Failed to get tool' });
    }
  });

  /**
   * POST /api/tools - Add new tool
   */
  router.post('/tools', async (req, res) => {
    try {
      const toolData = req.body;

      // Get all tools for validation
      const allTools = await getAllTools();

      // Validate
      const errors = validateTool(toolData, allTools, null);
      if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation failed', errors });
      }

      // Add tool
      const newTool = await addTool(toolData);

      // Broadcast update
      const updatedTools = await getAllTools();
      broadcast('tools-updated', updatedTools);

      log('Tool added:', newTool.id);
      res.status(201).json(newTool);
    } catch (error) {
      log('Error adding tool:', error);
      res.status(500).json({ error: 'Failed to add tool' });
    }
  });

  /**
   * PUT /api/tools/:id - Update tool
   */
  router.put('/tools/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid tool ID' });
      }

      const toolData = req.body;

      // Get all tools and original tool for validation
      const allTools = await getAllTools();
      const originalTool = allTools.find(t => t.id === id);

      if (!originalTool) {
        return res.status(404).json({ error: 'Tool not found' });
      }

      // Check if ID is being changed
      const newId = toolData.id;
      const isIdChanging = newId !== undefined && newId !== id;

      if (isIdChanging) {
        // If ID is changing, we need to delete the old tool and create a new one
        // First validate the new tool data with the new ID
        const errors = validateTool(toolData, allTools, null);
        if (errors.length > 0) {
          return res.status(400).json({ error: 'Validation failed', errors });
        }

        // Delete the old tool
        await deleteTool(id);

        // Create new tool with the new ID
        const newTool = await addTool(toolData);

        // Broadcast update
        const updatedTools = await getAllTools();
        broadcast('tools-updated', updatedTools);

        log('Tool ID changed:', id, '->', newId);
        res.json(newTool);
      } else {
        // Normal update - ID is not changing
        // Validate
        const errors = validateTool(toolData, allTools, originalTool);
        if (errors.length > 0) {
          return res.status(400).json({ error: 'Validation failed', errors });
        }

        // Update tool
        const updatedTool = await updateTool(id, toolData);

        // Broadcast update
        const updatedTools = await getAllTools();
        broadcast('tools-updated', updatedTools);

        log('Tool updated:', id);
        res.json(updatedTool);
      }
    } catch (error) {
      log('Error updating tool:', error);
      res.status(500).json({ error: 'Failed to update tool' });
    }
  });

  /**
   * DELETE /api/tools/:id - Delete tool
   */
  router.delete('/tools/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid tool ID' });
      }

      await deleteTool(id);

      // Broadcast update
      const updatedTools = await getAllTools();
      broadcast('tools-updated', updatedTools);

      log('Tool deleted:', id);
      res.json({ success: true });
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      log('Error deleting tool:', error);
      res.status(500).json({ error: 'Failed to delete tool' });
    }
  });

  /**
   * PUT /api/tools - Bulk update tools (save all)
   */
  router.put('/tools', async (req, res) => {
    try {
      const tools = req.body;

      if (!Array.isArray(tools)) {
        return res.status(400).json({ error: 'Request body must be an array of tools' });
      }

      // Validate all tools
      const validationErrors = [];
      tools.forEach((tool, index) => {
        // For bulk import, pass the tool itself as originalTool to prevent self-duplication errors
        const errors = validateTool(tool, tools, tool);
        if (errors.length > 0) {
          validationErrors.push({ index, errors });
        }
      });

      if (validationErrors.length > 0) {
        return res.status(400).json({
          error: 'Validation failed',
          validationErrors
        });
      }

      // Bulk update
      const updatedTools = await bulkUpdateTools(tools);

      // Broadcast update
      broadcast('tools-updated', updatedTools);

      log('Tools bulk updated, count:', updatedTools.length);
      res.json(updatedTools);
    } catch (error) {
      log('Error bulk updating tools:', error);
      res.status(500).json({ error: 'Failed to bulk update tools' });
    }
  });

  return router;
}
