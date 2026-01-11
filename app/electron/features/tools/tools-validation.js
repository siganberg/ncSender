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

/**
 * Validate tool data
 *
 * @param {Object} tool - The tool to validate
 * @param {Array} allTools - All existing tools (for duplicate checking)
 * @param {Object} originalTool - The original tool being edited (null for new tools)
 * @returns {Array} Array of error messages (empty if valid)
 */
export function validateTool(tool, allTools, originalTool = null) {
  const errors = [];

  // Check tool ID
  if (!tool.id || !Number.isInteger(tool.id) || tool.id < 1) {
    errors.push('Tool ID must be a positive integer');
  } else {
    // Check for duplicate tool ID (excluding current tool in edit mode)
    const duplicateId = allTools.find(t =>
      t.id === tool.id &&
      (!originalTool || t.id !== originalTool.id)
    );
    if (duplicateId) {
      errors.push(`Tool ID ${tool.id} already exists`);
    }
  }

  // Check tool number if provided
  if (tool.toolNumber !== null && tool.toolNumber !== undefined && tool.toolNumber !== '') {
    const toolNum = parseInt(tool.toolNumber);
    if (!Number.isInteger(toolNum) || toolNum < 1) {
      errors.push('Tool number must be a positive integer');
    }

    // Check for duplicate tool number (excluding current tool in edit mode)
    const duplicate = allTools.find(t =>
      t.toolNumber === toolNum &&
      t.id !== (originalTool ? originalTool.id : null)
    );
    if (duplicate) {
      errors.push(`Tool number ${toolNum} already exists`);
    }
  }

  // Check name
  if (!tool.name || tool.name.trim() === '') {
    errors.push('Tool name is required');
  }

  // Check diameter
  if (!tool.diameter || tool.diameter <= 0) {
    errors.push('Diameter must be greater than 0');
  }

  // Check type
  const validTypes = ['flat', 'ball', 'v-bit', 'drill', 'chamfer', 'surfacing', 'probe', 'thread-mill'];
  if (!tool.type || !validTypes.includes(tool.type)) {
    errors.push('Invalid tool type');
  }

  return errors;
}

/**
 * Validate tool ID
 */
export function validateToolId(id) {
  const errors = [];

  if (!id || !Number.isInteger(id) || id < 1) {
    errors.push('Tool ID must be a positive integer');
  }

  return errors;
}
