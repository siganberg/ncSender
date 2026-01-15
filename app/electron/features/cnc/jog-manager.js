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

import { createLogger } from '../../core/logger.js';

export const REALTIME_JOG_CANCEL = String.fromCharCode(0x85);
const WS_READY_STATE_OPEN = 1;

const { log, error: logError } = createLogger('JogManager');

// Dead-man switch for continuous jogging
// Automatically sends jog cancel if heartbeat is not received within timeout
export class JogWatchdog {
  constructor({ timeoutMs = 1500, onTimeout = null } = {}) {
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
    this.timer = null;
    this.activeJogCommand = null;
  }

  start(commandId, command) {
    this.clear();
    this.activeJogCommand = { id: commandId, command };
    this.timer = setTimeout(() => {
      log('Jog watchdog timeout - triggering emergency cancel');
      if (this.onTimeout) {
        this.onTimeout('watchdog-timeout');
      }
    }, this.timeoutMs);
  }

  extend() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      log('Jog watchdog timeout - triggering emergency cancel');
      if (this.onTimeout) {
        this.onTimeout('watchdog-timeout');
      }
    }, this.timeoutMs);
  }

  clear() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.activeJogCommand = null;
  }

  isActive() {
    return this.timer !== null;
  }

  getActiveCommand() {
    return this.activeJogCommand;
  }
}

export class JogSessionManager {
  constructor({ cncController, commandProcessor } = {}) {
    if (!cncController || typeof cncController.sendCommand !== 'function') {
      throw new Error('JogSessionManager requires a CNC controller with sendCommand method');
    }

    this.cncController = cncController;
    // commandProcessor is a wrapper { instance: CommandProcessor } to allow late initialization
    this.commandProcessorWrapper = commandProcessor;
    this.sessionsById = new Map();
    this.sessionsBySocket = new Map();
  }

  get commandProcessor() {
    return this.commandProcessorWrapper?.instance;
  }

  async handleMessage(ws, rawMessage) {
    let parsed = rawMessage;
    if (!parsed || typeof parsed !== 'object' || !parsed.type) {
      try {
        const asString = typeof rawMessage === 'string' ? rawMessage : rawMessage?.toString();
        parsed = JSON.parse(asString);
      } catch (error) {
        log('Ignoring invalid WebSocket payload (not JSON)', error?.message || error);
        this.sendSafe(ws, {
          type: 'jog:error',
          data: { message: 'Invalid jog payload. Expecting JSON structure.' }
        });
        return;
      }
    }

    const { type, data } = parsed || {};
    switch (type) {
      case 'jog:start':
        await this.startSession(ws, data);
        break;
      case 'jog:heartbeat':
        this.recordHeartbeat(ws, data);
        break;
      case 'jog:stop':
        await this.stopSession(ws, data, 'client-stop');
        break;
      case 'jog:step':
        await this.executeStep(ws, data);
        break;
      default:
        log('Received unsupported jog message type:', type);
        break;
    }
  }

  async startSession(ws, data) {
    const {
      jogId,
      command,
      displayCommand
    } = data || {};

    if (!jogId || typeof jogId !== 'string') {
      this.sendSafe(ws, {
        type: 'jog:error',
        data: { message: 'jog:start requires a jogId' }
      });
      return;
    }

    if (typeof command !== 'string' || command.trim() === '') {
      this.sendSafe(ws, {
        type: 'jog:error',
        data: { jogId, message: 'jog:start requires a command string' }
      });
      return;
    }

    // Ensure only one active session per jogId
    const existingSession = this.sessionsById.get(jogId);
    if (existingSession) {
      await this.finalizeSession(existingSession, 'restarted', { notifyClient: false });
    }

    const sessionSet = this.sessionsBySocket.get(ws) ?? new Set();
    this.sessionsBySocket.set(ws, sessionSet);

    try {
      // Safety: Cancel any stuck jog before starting new one (handles failed deadman switch)
      await this.cncController.sendCommand(REALTIME_JOG_CANCEL, {
        meta: { sourceId: 'jog-safety', silent: true }
      });

      // Route through CommandProcessor for safety checks and plugin interception
      if (this.commandProcessor) {
        const result = await this.commandProcessor.process(command, {
          commandId: jogId,
          meta: { continuous: true, sourceId: 'client' },
          machineState: this.cncController.lastStatus
        });

        if (!result.shouldContinue) {
          // Command was blocked or handled by CommandProcessor
          const message = result.result?.message || 'Jog command blocked';
          log('Jog start blocked by CommandProcessor', `jogId=${jogId}`, message);
          this.sendSafe(ws, {
            type: 'jog:start-failed',
            data: { jogId, message }
          });
          return;
        }

        // Send processed commands
        for (const cmd of result.commands) {
          await this.cncController.sendCommand(cmd.command, {
            commandId: jogId,
            displayCommand: cmd.displayCommand || cmd.command,
            meta: { continuous: true, sourceId: 'client' }
          });
        }
      } else {
        // Fallback to direct controller call
        await this.cncController.sendCommand(command, {
          commandId: jogId,
          displayCommand: displayCommand || command,
          meta: { continuous: true, sourceId: 'client' }
        });
      }
    } catch (error) {
      const message = error?.message || 'Failed to start jog command';
      log('Jog start failed', `jogId=${jogId}`, message);
      this.sendSafe(ws, {
        type: 'jog:start-failed',
        data: { jogId, message }
      });
      return;
    }

    const session = {
      jogId,
      ws,
      command,
      displayCommand: displayCommand || command,
      stopping: false
    };

    this.sessionsById.set(jogId, session);
    sessionSet.add(jogId);

    log('Jog started', `jogId=${jogId}`);

    this.sendSafe(ws, {
      type: 'jog:started',
      data: { jogId, startedAt: Date.now() }
    });
  }

  recordHeartbeat(ws, data) {
    const { jogId } = data || {};
    if (!jogId) {
      return;
    }

    const session = this.sessionsById.get(jogId);
    if (!session || session.ws !== ws) {
      return;
    }

    // Forward heartbeat to controller to extend its dead-man switch watchdog
    this.cncController.sendCommand('', {
      commandId: `heartbeat-${jogId}`,
      meta: { jogHeartbeat: true }
    }).catch(() => {
      // Ignore errors - heartbeat is best-effort
    });
  }

  async stopSession(ws, data, defaultReason = 'client-stop') {
    const { jogId, reason = defaultReason } = data || {};
    if (!jogId) {
      return;
    }

    const session = this.sessionsById.get(jogId);
    if (!session) {
      return;
    }

    if (session.ws !== ws) {
      // Only allow owning socket to request stop; others will be ignored
      return;
    }

    await this.finalizeSession(session, reason);
  }

  async finalizeSession(session, reason, { notifyClient = true } = {}) {
    if (!session || session.stopping) {
      return;
    }

    session.stopping = true;

    this.sessionsById.delete(session.jogId);

    const sessionSet = this.sessionsBySocket.get(session.ws);
    if (sessionSet) {
      sessionSet.delete(session.jogId);
      if (sessionSet.size === 0) {
        this.sessionsBySocket.delete(session.ws);
      }
    }

    try {
      await this.cncController.sendCommand(REALTIME_JOG_CANCEL, {
        meta: {
          completesCommandId: session.jogId,
          stopReason: reason
        }
      });
    } catch (error) {
      log('Failed to send jog cancel command', `jogId=${session.jogId}`, error?.message || error);
    }

    log('Jog stopped', `jogId=${session.jogId}`, `reason=${reason}`);

    if (notifyClient) {
      this.sendSafe(session.ws, {
        type: 'jog:stopped',
        data: { jogId: session.jogId, reason }
      });
    }
  }

  async handleDisconnect(ws) {
    const sessionSet = this.sessionsBySocket.get(ws);
    if (!sessionSet || sessionSet.size === 0) {
      return;
    }

    // Clone to avoid mutation during iteration
    const sessionIds = Array.from(sessionSet.values());
    for (const jogId of sessionIds) {
      const session = this.sessionsById.get(jogId);
      if (session) {
        await this.finalizeSession(session, 'disconnect', { notifyClient: false });
      }
    }
  }

  async executeStep(ws, data) {
    const {
      command,
      displayCommand,
      commandId
    } = data || {};

    if (typeof command !== 'string' || command.trim() === '') {
      this.sendSafe(ws, {
        type: 'jog:error',
        data: { message: 'jog:step requires a command string' }
      });
      return;
    }

    const resolvedCommandId = commandId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      // Safety: Cancel any stuck jog before starting new one (handles failed deadman switch)
      await this.cncController.sendCommand(REALTIME_JOG_CANCEL, {
        meta: { sourceId: 'jog-safety', silent: true }
      });

      // Route through CommandProcessor for safety checks and plugin interception
      if (this.commandProcessor) {
        const result = await this.commandProcessor.process(command, {
          commandId: resolvedCommandId,
          meta: { jogStep: true, sourceId: 'client' },
          machineState: this.cncController.lastStatus
        });

        if (!result.shouldContinue) {
          // Command was blocked - already logged/broadcast by CommandProcessor
          log('Jog step blocked by CommandProcessor', `commandId=${resolvedCommandId}`);
          return;
        }

        // Send processed commands
        for (const cmd of result.commands) {
          await this.cncController.sendCommand(cmd.command, {
            commandId: resolvedCommandId,
            displayCommand: cmd.displayCommand || cmd.command,
            meta: { jogStep: true, sourceId: 'client' }
          });
        }
      } else {
        // Fallback to direct controller call
        await this.cncController.sendCommand(command, {
          commandId: resolvedCommandId,
          displayCommand: displayCommand || command,
          meta: { jogStep: true, sourceId: 'client' }
        });
      }
    } catch (error) {
      log('Jog step send failed', `commandId=${resolvedCommandId}`, error?.message || error);
    }
  }

  sendSafe(ws, payload) {
    try {
      if (ws && ws.readyState === WS_READY_STATE_OPEN) {
        ws.send(JSON.stringify(payload));
      }
    } catch (error) {
      log('Failed to send WebSocket payload', error?.message || error);
    }
  }
}
