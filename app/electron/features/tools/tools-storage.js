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

import fs from 'node:fs/promises';
import path from 'node:path';
import { getUserDataDir } from '../../utils/paths.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('ToolsStorage');

const TOOLS_FILE_PATH = path.join(getUserDataDir(), 'tools.json');

// Helper: Generate unique tool ID
export const generateToolId = (tools) => {
  if (tools.length === 0) return 1;
  return Math.max(...tools.map(t => t.id)) + 1;
};

// Helper: Migrate old data structure (id = toolNumber) to new structure (id + toolNumber)
export const migrateTools = (tools) => {
  return tools.map(tool => {
    // If tool already has the new structure, return as is
    if (tool.hasOwnProperty('toolNumber')) {
      return tool;
    }
    // Migrate old structure: id becomes toolNumber, generate new internal id
    return {
      ...tool,
      toolNumber: tool.id,
      id: tool.id // Keep same ID for migration
    };
  });
};

// Helper: Create default tool object
export const createDefaultTool = (id, toolNumber = null) => ({
  id: id,
  toolNumber: toolNumber,
  name: '',
  type: 'flat',
  diameter: 0,
  offsets: {
    tlo: 0.0,
    x: 0.0,
    y: 0.0
  },
  metadata: {
    notes: '',
    image: '',
    sku: ''
  },
  dimensions: {
    flute_length: null,
    overall_length: null,
    taper_angle: null,
    radius: null,
    stickout: null
  },
  specs: {
    material: null,
    coating: null
  },
  life: {
    enabled: false,
    total_minutes: null,
    used_minutes: 0,
    remaining_minutes: null,
    usage_count: 0
  }
});

/**
 * Ensure data directory exists
 */
async function ensureDataDirectory() {
  const dataDir = path.dirname(TOOLS_FILE_PATH);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

/**
 * Load tools from JSON file
 */
export async function loadTools() {
  try {
    const data = await fs.readFile(TOOLS_FILE_PATH, 'utf8');
    let tools = JSON.parse(data);

    // Migrate tools if needed
    tools = migrateTools(tools);

    return tools;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      return [];
    }
    throw error;
  }
}

/**
 * Save tools to JSON file
 */
export async function saveTools(tools) {
  await ensureDataDirectory();
  await fs.writeFile(TOOLS_FILE_PATH, JSON.stringify(tools, null, 2), 'utf8');
  log('Tools saved to:', TOOLS_FILE_PATH);
}

/**
 * Get all tools
 */
export async function getAllTools() {
  return await loadTools();
}

/**
 * Get tool by ID
 */
export async function getToolById(id) {
  const tools = await loadTools();
  return tools.find(t => t.id === id);
}

/**
 * Add new tool
 */
export async function addTool(toolData) {
  const tools = await loadTools();
  const newId = generateToolId(tools);

  const newTool = createDefaultTool(newId, toolData.toolNumber);
  Object.assign(newTool, toolData);
  newTool.id = newId; // Ensure ID is set correctly

  tools.push(newTool);
  await saveTools(tools);

  return newTool;
}

/**
 * Update existing tool
 */
export async function updateTool(id, toolData) {
  const tools = await loadTools();
  const index = tools.findIndex(t => t.id === id);

  if (index === -1) {
    throw new Error(`Tool with ID ${id} not found`);
  }

  // Preserve the ID
  const updatedTool = { ...toolData, id };
  tools[index] = updatedTool;

  await saveTools(tools);
  return updatedTool;
}

/**
 * Delete tool
 */
export async function deleteTool(id) {
  const tools = await loadTools();
  const filteredTools = tools.filter(t => t.id !== id);

  if (filteredTools.length === tools.length) {
    throw new Error(`Tool with ID ${id} not found`);
  }

  await saveTools(filteredTools);
  return true;
}

/**
 * Bulk update/replace all tools
 */
export async function bulkUpdateTools(newTools) {
  // Migrate if needed
  const migratedTools = migrateTools(newTools);
  await saveTools(migratedTools);
  return migratedTools;
}
