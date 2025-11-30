import { checkSameToolChange, parseM6Command } from '../utils/gcode-patterns.js';
import { getSetting } from './settings-manager.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}] [CommandProcessor]`, ...args);
};

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

      // If this is a valid M6 command, insert (MSG, TOOL CHANGE COMPLETE) at the end
      if (isValidM6 && !sameToolCheck.isSameTool) {
        commands.push({
          command: '(MSG, TOOL CHANGE COMPLETE)',
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
   * Future: Add safety checks
   */
  checkSafety() {
    // TODO: Implement safety check logic (will use command, context)
    return { safe: true };
  }
}
