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
