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
 * Centralized G-code pattern matching utilities
 *
 * This module provides consistent pattern matching for G-code commands
 * across the application and plugins.
 */

/**
 * Pattern to match M6 tool change commands
 *
 * Matches:
 * - M6 T1, M6 T01, M06 T1 (with spaces)
 * - M6T1, M06T1 (no space)
 * - T1 M6, T1 M06 (T before M6 with space)
 * - T1M6, T2M6 (T before M6 without space)
 *
 * Does NOT match:
 * - M60, M61, M600 (other M-codes)
 * - M6R2 (M6 with other letter codes)
 *
 * Capture groups:
 * - Group 1: Tool number from M6 T# format
 * - Group 2: Tool number from T# M6 format
 */
const M6_PATTERN = /(?:^|[^A-Z])M0*6(?:\s*T0*(\d+)|(?=[^0-9T])|$)|(?:^|[^A-Z])T0*(\d+)\s*M0*6(?:[^0-9]|$)/i;

/**
 * Check if a G-code line is a comment
 *
 * G-code comment formats:
 * - Semicolon comments: ; M6 T1 (entire line after ; is a comment)
 * - Parenthetical comments: (M6 T1) (entire line wrapped in parentheses)
 *
 * @param {string} command - The G-code command to check
 * @returns {boolean} True if the line is a comment
 */
function isGcodeComment(command) {
  const trimmed = command.trim();

  // Strip optional N-number prefix (e.g., "N16 ;M6 T3" -> ";M6 T3")
  const withoutLineNumber = trimmed.replace(/^N\d+\s*/i, '');

  // Semicolon comment - entire line is a comment
  if (withoutLineNumber.startsWith(';')) {
    return true;
  }

  // Parenthetical comment - entire line wrapped in parentheses
  if (withoutLineNumber.startsWith('(') && withoutLineNumber.endsWith(')')) {
    return true;
  }

  return false;
}

/**
 * Parse M6 tool change command and extract tool number
 *
 * @param {string} command - The G-code command to parse
 * @returns {Object|null} Object with { toolNumber, matched } or null if no match
 *
 * @example
 * parseM6Command('M6 T2')  // { toolNumber: 2, matched: true }
 * parseM6Command('T2M6')   // { toolNumber: 2, matched: true }
 * parseM6Command('M6')     // { toolNumber: null, matched: true }
 * parseM6Command('M60')    // null
 * parseM6Command('; M6 T1') // null (commented)
 * parseM6Command('(M6 T1)') // null (commented)
 */
export function parseM6Command(command) {
  if (!command || typeof command !== 'string') {
    return null;
  }

  // Skip commented lines
  if (isGcodeComment(command)) {
    return null;
  }

  const normalizedCommand = command.trim().toUpperCase();
  const match = normalizedCommand.match(M6_PATTERN);

  if (!match) {
    return null;
  }

  // Extract tool number from either capture group
  const toolNumberStr = match[1] || match[2];
  const toolNumber = toolNumberStr ? parseInt(toolNumberStr, 10) : null;

  return {
    toolNumber: Number.isFinite(toolNumber) ? toolNumber : null,
    matched: true
  };
}

/**
 * Check if a command is an M6 tool change command
 *
 * @param {string} command - The G-code command to check
 * @returns {boolean} True if command is M6, false otherwise
 *
 * @example
 * isM6Command('M6 T2')  // true
 * isM6Command('M60')    // false
 * isM6Command('; M6 T1') // false (commented)
 */
export function isM6Command(command) {
  const parsed = parseM6Command(command);
  return parsed?.matched === true;
}

/**
 * Get the M6 pattern regex for direct use
 * Use parseM6Command() instead when possible
 *
 * @returns {RegExp} The M6 pattern regex
 */
export function getM6Pattern() {
  return M6_PATTERN;
}

/**
 * Check if M6 command is for the same tool as currently loaded
 *
 * @param {string} command - The G-code command to check
 * @param {number} currentTool - The currently loaded tool number
 * @returns {Object} Object with { isSameTool, toolNumber, matched }
 *
 * @example
 * checkSameToolChange('M6 T2', 2)  // { isSameTool: true, toolNumber: 2, matched: true }
 * checkSameToolChange('M6 T3', 2)  // { isSameTool: false, toolNumber: 3, matched: true }
 * checkSameToolChange('G0 X10', 2) // { isSameTool: false, toolNumber: null, matched: false }
 */
export function checkSameToolChange(command, currentTool) {
  const parsed = parseM6Command(command);

  if (!parsed?.matched || parsed.toolNumber === null) {
    return { isSameTool: false, toolNumber: null, matched: false };
  }

  return {
    isSameTool: parsed.toolNumber === currentTool,
    toolNumber: parsed.toolNumber,
    matched: true
  };
}

/**
 * Pattern to match M3/M4 spindle start commands
 *
 * Matches (case-insensitive):
 * - M3, M03, M4, M04 (standalone)
 * - M3 S1000, M03 S1000 (with speed after)
 * - S1000 M3, S1000 M03 (with speed before)
 * - M3S1000, S1000M3 (no spaces)
 * - N100 M3 S1000 (with line numbers)
 *
 * Does NOT match:
 * - M30, M31, M40, M41 (other M-codes)
 * - ; M3 S1000 (commented lines)
 * - (M3 S1000) (commented lines)
 */
const SPINDLE_START_PATTERN = /(?:^|[^A-Z0-9])M0*[34](?:[^0-9]|$)/i;

/**
 * Pattern to match M5 spindle stop commands
 *
 * Matches (case-insensitive):
 * - M5, M05 (standalone)
 * - N100 M5 (with line numbers)
 *
 * Does NOT match:
 * - M50, M51, M500 (other M-codes)
 * - ; M5 (commented lines)
 * - (M5) (commented lines)
 */
const SPINDLE_STOP_PATTERN = /(?:^|[^A-Z0-9])M0*5(?:[^0-9]|$)/i;

/**
 * Check if a command is an M3/M4 spindle start command
 *
 * @param {string} command - The G-code command to check
 * @returns {boolean} True if command contains M3 or M4, false otherwise
 *
 * @example
 * isSpindleStartCommand('M3 S1000')   // true
 * isSpindleStartCommand('S1000 M3')   // true
 * isSpindleStartCommand('M3S1000')    // true
 * isSpindleStartCommand('N100 M3')    // true
 * isSpindleStartCommand('M4 S500')    // true
 * isSpindleStartCommand('M30')        // false
 * isSpindleStartCommand('; M3 S1000') // false (commented)
 */
export function isSpindleStartCommand(command) {
  if (!command || typeof command !== 'string') {
    return false;
  }

  if (isGcodeComment(command)) {
    return false;
  }

  return SPINDLE_START_PATTERN.test(command.trim().toUpperCase());
}

/**
 * Check if a command is an M5 spindle stop command
 *
 * @param {string} command - The G-code command to check
 * @returns {boolean} True if command contains M5, false otherwise
 *
 * @example
 * isSpindleStopCommand('M5')      // true
 * isSpindleStopCommand('M05')     // true
 * isSpindleStopCommand('N100 M5') // true
 * isSpindleStopCommand('M50')     // false
 * isSpindleStopCommand('; M5')    // false (commented)
 */
export function isSpindleStopCommand(command) {
  if (!command || typeof command !== 'string') {
    return false;
  }

  if (isGcodeComment(command)) {
    return false;
  }

  return SPINDLE_STOP_PATTERN.test(command.trim().toUpperCase());
}
