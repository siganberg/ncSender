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

import { checkSameToolChange, parseM6Command, isSpindleStartCommand, isSpindleStopCommand } from '../utils/gcode-patterns.js';
import { getSetting } from './settings-manager.js';
import { createLogger } from './logger.js';

const { log, error: logError } = createLogger('CommandProcessor');

// Maximum feed rate allowed in Door state (mm/min)
const DOOR_STATE_MAX_FEED_RATE = 1000;

/**
 * Centralized command processor
 *
 * Handles pre-processing of user commands before they reach the Plugin Manager.
 * This is the single point for command interception logic like:
 * - Same-tool M6 detection and skipping
 * - Command validation
 * - Rate limiting
 * - Safety checks
 *
 * Flow: Entry Point → CommandProcessor → Plugin Manager → Controller → CNC
 */
export class CommandProcessor {
  constructor({ cncController, pluginManager, broadcast, serverState }) {
    this.cncController = cncController;
    this.pluginManager = pluginManager;
    this.broadcast = broadcast;
    this.serverState = serverState;
  }

  /**
   * Process a command through pre-processing checks and Plugin Manager
   *
   * @param {string} command - The command to process
   * @param {Object} context - Command context (sourceId, commandId, meta, machineState)
   * @returns {Promise<Object>} Result object with shouldContinue flag
   *
   * Result structure:
   * - If command should be skipped (e.g., same-tool M6):
   *   { shouldContinue: false, result: { status, id, ... } }
   *
   * - If command should continue to controller:
   *   { shouldContinue: true, commands: [...] }
   */
  async process(command, context = {}) {
    const {
      commandId,
      meta = {},
      machineState
    } = context;

    // Door state safety check - restrict commands when machine is in Door state
    const doorSafetyResult = this.checkDoorStateSafety(command, commandId, meta, machineState);
    if (doorSafetyResult) {
      return doorSafetyResult;
    }

    // Handle $NCSENDER_CLEAR_MSG command - clear plugin message and notify all clients
    if (command.trim().toUpperCase() === '$NCSENDER_CLEAR_MSG') {
      log('$NCSENDER_CLEAR_MSG command detected - clearing plugin message');

      // Clear plugin message from settings
      this.pluginManager.clearPluginMessage();

      // Broadcast cnc-command (pending status)
      this.broadcast('cnc-command', {
        id: commandId,
        command: '$NCSENDER_CLEAR_MSG',
        displayCommand: '$NCSENDER_CLEAR_MSG',
        status: 'pending',
        timestamp: new Date().toISOString(),
        sourceId: meta.sourceId || 'client'
      });

      // Broadcast cnc-command-result (success status)
      this.broadcast('cnc-command-result', {
        id: commandId,
        command: '$NCSENDER_CLEAR_MSG',
        displayCommand: '$NCSENDER_CLEAR_MSG',
        status: 'success',
        timestamp: new Date().toISOString(),
        sourceId: meta.sourceId || 'client'
      });

      // Return early - don't send to controller
      return {
        shouldContinue: false,
        result: {
          status: 'success',
          id: commandId,
          command: '$NCSENDER_CLEAR_MSG',
          displayCommand: '$NCSENDER_CLEAR_MSG',
          timestamp: new Date().toISOString()
        }
      };
    }

    // Check if this is a valid M6 command
    const m6Parse = parseM6Command(command);
    const isValidM6 = m6Parse?.matched && m6Parse.toolNumber !== null;

    // Check if this is a $TLS command (case insensitive)
    const isTLSCommand = command.trim().toUpperCase() === '$TLS';

    // Check for same-tool M6 command
    const currentTool = machineState?.tool ?? this.cncController.lastStatus?.tool ?? 0;
    const sameToolCheck = checkSameToolChange(command, currentTool);

    // Set isToolChanging flag only for valid M6 commands that are NOT same-tool changes
    if (isValidM6 && !sameToolCheck.isSameTool) {
      if (this.serverState.machineState.isToolChanging !== true) {
        log(`Setting isToolChanging -> true (M6 T${m6Parse.toolNumber})`);
        this.serverState.machineState.isToolChanging = true;
        this.broadcast('server-state-updated', this.serverState);
      }
    }

    if (sameToolCheck.isSameTool) {
      log(`Same-tool M6 detected: T${sameToolCheck.toolNumber} (current: T${currentTool}) - skipping`);

      // Create skip message
      const skipMessage = `M6 T${sameToolCheck.toolNumber}; Skipped, target tool is the same as the current tool.`;

      // Broadcast cnc-command (pending status)
      this.broadcast('cnc-command', {
        id: commandId,
        command: command.trim().toUpperCase(),
        displayCommand: skipMessage,
        status: 'pending',
        timestamp: new Date().toISOString(),
        sourceId: meta.sourceId || 'client'
      });

      // Broadcast cnc-command-result (success status)
      this.broadcast('cnc-command-result', {
        id: commandId,
        command: command.trim().toUpperCase(),
        displayCommand: skipMessage,
        status: 'success',
        timestamp: new Date().toISOString(),
        sourceId: meta.sourceId || 'client'
      });

      // Return early - don't continue to Plugin Manager or Controller
      return {
        shouldContinue: false,
        result: {
          status: 'success',
          id: commandId,
          command: command.trim().toUpperCase(),
          displayCommand: skipMessage,
          timestamp: new Date().toISOString()
        }
      };
    }

    // No early return needed - process through Plugin Manager
    try {
      const commands = await this.pluginManager.processCommand(command, context);

      // If this is a valid M6 command, insert (MSG, TOOL_CHANGE_COMPLETE) at the end
      if (isValidM6 && !sameToolCheck.isSameTool) {
        commands.push({
          command: '(MSG, TOOL_CHANGE_COMPLETE)',
          displayCommand: null,
          isOriginal: false
        });
      }

      // If this is a $TLS command, insert (MSG, TOOL_CHANGE_COMPLETE) at the end
      if (isTLSCommand) {
        commands.push({
          command: '(MSG, TOOL_CHANGE_COMPLETE)',
          displayCommand: null,
          isOriginal: false
        });
      }

      return {
        shouldContinue: true,
        commands
      };
    } catch (error) {
      log('Error processing command through Plugin Manager:', error);
      throw error;
    }
  }

  /**
   * Future: Add rate limiting
   */
  checkRateLimit() {
    // TODO: Implement rate limiting logic (will use command, context)
    return { allowed: true };
  }

  /**
   * Future: Add command validation
   */
  validateCommand() {
    // TODO: Implement validation logic (will use command, context)
    return { valid: true };
  }

  /**
   * Door state safety check
   * When door is detected (status='Door' OR Pn contains 'D'):
   * - Block: G0 rapid moves, spindle commands (M3/M4/M5)
   * - Limit: All movement feed rates to 1000mm/min (including jog)
   *
   * @param {string} command - The command to check
   * @param {string} commandId - Command ID for response
   * @param {Object} meta - Command metadata
   * @param {Object} machineState - Current machine state
   * @returns {Object|null} Return result object if command should be blocked/modified, null to continue normal flow
   */
  checkDoorStateSafety(command, commandId, meta, machineState) {
    const status = machineState?.status?.toLowerCase() || this.serverState?.machineState?.status?.toLowerCase();
    const pn = machineState?.Pn || this.serverState?.machineState?.Pn || '';

    // Check if door is active: status is 'door' OR Pn contains 'D'
    const isDoorActive = status === 'door' || pn.includes('D');

    // Only apply restrictions when door is active
    if (!isDoorActive) {
      return null;
    }

    const trimmedCommand = command.trim();
    const upperCommand = trimmedCommand.toUpperCase();

    // Allow real-time commands (single character control codes)
    const realTimeCommands = ['!', '~', '?', '\x18', '\x84', '\x85', '\x87'];
    if (trimmedCommand.length === 1) {
      if (realTimeCommands.includes(trimmedCommand) || trimmedCommand.charCodeAt(0) >= 0x80) {
        return null;
      }
    }

    // Block G0 rapid movements
    if (/\bG0*0\b/i.test(upperCommand) && !upperCommand.startsWith('$J=')) {
      log(`Door state safety: Blocking G0 rapid move "${trimmedCommand}"`);
      return this.createBlockedResult(commandId, trimmedCommand, meta, 'G0 rapid not allowed in Door state');
    }

    // Block spindle commands M3/M4/M5
    if (isSpindleStartCommand(trimmedCommand) || isSpindleStopCommand(trimmedCommand)) {
      log(`Door state safety: Blocking spindle command "${trimmedCommand}"`);
      return this.createBlockedResult(commandId, trimmedCommand, meta, 'Spindle not allowed in Door state');
    }

    // Limit feed rate on jog commands ($J=)
    if (/^\$J=/i.test(upperCommand)) {
      const result = this.limitMovementFeedRate(trimmedCommand, DOOR_STATE_MAX_FEED_RATE);
      if (result.wasLimited) {
        log(`Door state: Jog feed rate limited to ${DOOR_STATE_MAX_FEED_RATE}mm/min`);
        return this.createModifiedResult(commandId, result, meta);
      }
      return null;
    }

    // Limit feed rate on G1/G2/G3 movements
    if (/\bG0*[123]\b/i.test(upperCommand)) {
      const result = this.limitMovementFeedRate(trimmedCommand, DOOR_STATE_MAX_FEED_RATE);
      if (result.wasLimited) {
        log(`Door state: Movement feed rate limited to ${DOOR_STATE_MAX_FEED_RATE}mm/min`);
        return this.createModifiedResult(commandId, result, meta);
      }
      return null;
    }

    // Allow all other commands
    return null;
  }

  /**
   * Create a result object for a blocked command
   */
  createBlockedResult(commandId, command, meta, reason) {
    const blockedDisplay = `${command} (BLOCKED - ${reason})`;

    // Broadcast to terminal
    this.broadcast('cnc-command', {
      id: commandId,
      command: command,
      displayCommand: blockedDisplay,
      status: 'pending',
      timestamp: new Date().toISOString(),
      sourceId: meta.sourceId || 'client'
    });

    this.broadcast('cnc-command-result', {
      id: commandId,
      command: command,
      displayCommand: blockedDisplay,
      status: 'blocked',
      timestamp: new Date().toISOString(),
      sourceId: meta.sourceId || 'client'
    });

    return {
      shouldContinue: false,
      result: {
        status: 'blocked',
        id: commandId,
        command: command,
        displayCommand: blockedDisplay,
        message: `Command blocked: ${reason}`,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Create a result object for a modified command (feed rate limited)
   */
  createModifiedResult(_commandId, limitResult, _meta) {
    const displayCommand = `${limitResult.command} (F${limitResult.originalFeedRate} -> F${DOOR_STATE_MAX_FEED_RATE}, Door safety)`;

    return {
      shouldContinue: true,
      commands: [{
        command: limitResult.command,
        displayCommand: displayCommand,
        isOriginal: true
      }]
    };
  }

  /**
   * Limit movement command feed rate to a maximum value
   * @param {string} command - The movement command
   * @param {number} maxFeedRate - Maximum allowed feed rate in mm/min
   * @returns {Object} { command, wasLimited, originalFeedRate }
   */
  limitMovementFeedRate(command, maxFeedRate) {
    const feedMatch = command.match(/F([+-]?\d*\.?\d+)/i);

    if (!feedMatch) {
      // No feed rate specified - for jog commands add the limit
      if (/^\$J=/i.test(command)) {
        return {
          command: command + ` F${maxFeedRate}`,
          wasLimited: true,
          originalFeedRate: 'unset'
        };
      }
      return { command, wasLimited: false, originalFeedRate: null };
    }

    const currentFeedRate = parseFloat(feedMatch[1]);

    if (currentFeedRate <= maxFeedRate) {
      return { command, wasLimited: false, originalFeedRate: currentFeedRate };
    }

    // Replace feed rate with limited value
    const limitedCommand = command.replace(/F([+-]?\d*\.?\d+)/i, `F${maxFeedRate}`);
    return {
      command: limitedCommand,
      wasLimited: true,
      originalFeedRate: Math.round(currentFeedRate)
    };
  }
}
