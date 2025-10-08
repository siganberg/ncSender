const REALTIME_JOG_CANCEL = String.fromCharCode(0x85);
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 750;
const DEFAULT_MAX_JOG_DURATION_MS = 15000;
const WS_READY_STATE_OPEN = 1;

export class JogSessionManager {
  constructor({ cncController, log = console.log, heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS, maxDurationMs = DEFAULT_MAX_JOG_DURATION_MS } = {}) {
    if (!cncController || typeof cncController.sendCommand !== 'function') {
      throw new Error('JogSessionManager requires a CNC controller with sendCommand method');
    }

    this.cncController = cncController;
    this.log = log;
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    this.maxDurationMs = maxDurationMs;

    this.sessionsById = new Map();
    this.sessionsBySocket = new Map();
  }

  async handleMessage(ws, rawMessage) {
    let parsed = rawMessage;
    if (!parsed || typeof parsed !== 'object' || !parsed.type) {
      try {
        const asString = typeof rawMessage === 'string' ? rawMessage : rawMessage?.toString();
        parsed = JSON.parse(asString);
      } catch (error) {
        this.log('Ignoring invalid WebSocket payload (not JSON)', error?.message || error);
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
        this.log('Received unsupported jog message type:', type);
        break;
    }
  }

  async startSession(ws, data) {
    const {
      jogId,
      command,
      displayCommand,
      axis = null,
      direction = null,
      feedRate = null
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
      await this.cncController.sendCommand(command, {
        commandId: jogId,
        displayCommand: displayCommand || command,
        meta: {
          continuous: true, // Enable dead-man switch in controller
          // internal jog details no longer forwarded in meta
        }
      });
    } catch (error) {
      const message = error?.message || 'Failed to start jog command';
      this.log('Jog start failed', `jogId=${jogId}`, message);
      this.sendSafe(ws, {
        type: 'jog:start-failed',
        data: { jogId, message }
      });
      return;
    }

    const now = Date.now();

    const session = {
      jogId,
      ws,
      command,
      displayCommand: displayCommand || command,
      axis,
      direction,
      feedRate,
      // clientId removed; no longer tracked
      startedAt: now,
      lastHeartbeatAt: now,
      heartbeatTimer: null,
      maxDurationTimer: null,
      stopping: false
    };

    this.sessionsById.set(jogId, session);
    sessionSet.add(jogId);

    this.log('Jog started', `jogId=${jogId}`, axis ? `axis=${axis}` : '', direction != null ? `direction=${direction}` : '', feedRate ? `feed=${feedRate}` : '');

    this.scheduleHeartbeatTimeout(session);
    this.scheduleMaxDurationTimeout(session);

    this.sendSafe(ws, {
      type: 'jog:started',
      data: { jogId, startedAt: now }
    });
  }

  scheduleHeartbeatTimeout(session) {
    if (session.heartbeatTimer) {
      clearTimeout(session.heartbeatTimer);
    }

    session.heartbeatTimer = setTimeout(() => {
      this.log('Jog heartbeat timeout', `jogId=${session.jogId}`);
      this.finalizeSession(session, 'heartbeat-timeout').catch((error) => {
        this.log('Error during heartbeat timeout stop', error?.message || error);
      });
    }, this.heartbeatTimeoutMs);
  }

  scheduleMaxDurationTimeout(session) {
    if (session.maxDurationTimer) {
      clearTimeout(session.maxDurationTimer);
    }

    session.maxDurationTimer = setTimeout(() => {
      this.log('Jog max duration reached', `jogId=${session.jogId}`);
      this.finalizeSession(session, 'max-duration').catch((error) => {
        this.log('Error during max duration stop', error?.message || error);
      });
    }, this.maxDurationMs);
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

    session.lastHeartbeatAt = Date.now();
    this.scheduleHeartbeatTimeout(session);

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

    if (session.heartbeatTimer) {
      clearTimeout(session.heartbeatTimer);
      session.heartbeatTimer = null;
    }

    if (session.maxDurationTimer) {
      clearTimeout(session.maxDurationTimer);
      session.maxDurationTimer = null;
    }

    this.sessionsById.delete(session.jogId);

    const sessionSet = this.sessionsBySocket.get(session.ws);
    if (sessionSet) {
      sessionSet.delete(session.jogId);
      if (sessionSet.size === 0) {
        this.sessionsBySocket.delete(session.ws);
      }
    }

    const cancelMeta = {
      completesCommandId: session.jogId,
      stopReason: reason
    };

    try {
      await this.cncController.sendCommand(REALTIME_JOG_CANCEL, {
        meta: cancelMeta
      });
    } catch (error) {
      this.log('Failed to send jog cancel command', `jogId=${session.jogId}`, error?.message || error);
    }

    this.log('Jog stopped', `jogId=${session.jogId}`, `reason=${reason}`);

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
      commandId,
      axis = null,
      direction = null,
      feedRate = null,
      distance = null
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
      await this.cncController.sendCommand(command, {
        commandId: resolvedCommandId,
        displayCommand: displayCommand || command,
        // Do not include jog details or originId in meta
      });
      // No per-step acknowledgements sent; clients will observe cnc-command/cnc-command-result
    } catch (error) {
      // Log only; client will timeout if no result is observed
      this.log('Jog step send failed', `commandId=${resolvedCommandId}`, error?.message || error);
    }
  }

  sendSafe(ws, payload) {
    try {
      if (ws && ws.readyState === WS_READY_STATE_OPEN) {
        ws.send(JSON.stringify(payload));
      }
    } catch (error) {
      this.log('Failed to send WebSocket payload', error?.message || error);
    }
  }
}
