import { EventEmitter } from 'events';

const DEFAULT_RESPONSE_TIMEOUT_MS = 0;

const buildTimeoutError = (entry) => {
  const error = new Error(`Command timed out after ${entry.timeoutMs}ms`);
  error.code = 'COMMAND_TIMEOUT';
  error.commandId = entry.id;
  error.command = entry.rawCommand;
  error.meta = entry.meta;
  return error;
};

const buildFlushError = (entry, reason, details) => {
  const error = new Error(`Command cancelled due to ${reason || 'queue flush'}`);
  error.code = 'COMMAND_FLUSHED';
  error.commandId = entry.id;
  error.command = entry.rawCommand;
  error.meta = entry.meta;
  if (details) {
    error.details = details;
  }
  return error;
};

const toEventPayload = (entry, overrides = {}) => ({
  id: entry.id,
  command: entry.rawCommand,
  displayCommand: entry.displayCommand ?? entry.rawCommand,
  meta: entry.meta,
  enqueuedAt: entry.enqueuedAt,
  sentAt: entry.sentAt,
  timeoutMs: entry.timeoutMs,
  ...overrides
});

export class CommandQueue extends EventEmitter {
  constructor({ sendCommand, log = console.log, responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS } = {}) {
    super();

    if (typeof sendCommand !== 'function') {
      throw new Error('CommandQueue requires a sendCommand function');
    }

    this.sendCommand = sendCommand;
    this.log = log;
    this.responseTimeoutMs = responseTimeoutMs;

    this.pending = [];
    this.activeEntry = null;
    this.isDispatching = false;
  }

  get size() {
    return this.pending.length + (this.activeEntry ? 1 : 0);
  }

  enqueue({ rawCommand, commandToWrite, meta, displayCommand, commandId, timeoutMs }) {
    if (typeof rawCommand !== 'string' || rawCommand.trim() === '') {
      throw new Error('CommandQueue.enqueue requires a rawCommand string');
    }

    const entry = {
      id: commandId || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      rawCommand,
      commandToWrite,
      meta: meta || null,
      enqueuedAt: Date.now(),
      timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : this.responseTimeoutMs,
      resolve: null,
      reject: null,
      timeoutHandle: null,
      displayCommand: displayCommand || rawCommand
    };

    const promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });

    this.pending.push(entry);
    this.emit('queued', toEventPayload(entry, { status: 'pending', timestamp: new Date().toISOString() }));
    this.log('Queued CNC command', rawCommand, `queueSize=${this.pending.length}`);

    this.dispatchNext();

    return promise;
  }

  async dispatchNext() {
    if (this.isDispatching || this.activeEntry || this.pending.length === 0) {
      return;
    }

    this.isDispatching = true;
    const entry = this.pending.shift();

    try {
      await this.sendCommand(entry);
      entry.sentAt = Date.now();
      this.activeEntry = entry;
      this.startTimeout(entry);
      this.emit('sent', toEventPayload(entry, { status: 'sent', timestamp: new Date().toISOString() }));
      this.log('Sent CNC command', entry.rawCommand);
    } catch (error) {
      this.log('Failed to send CNC command', entry.rawCommand, error?.message || error);
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      entry.reject(normalizedError);
      this.emit('send-error', toEventPayload(entry, {
        status: 'error',
        error: normalizedError,
        timestamp: new Date().toISOString()
      }));
      // Attempt to send the next command in queue
      this.isDispatching = false;
      this.dispatchNext();
      return;
    }

    this.isDispatching = false;
  }

  startTimeout(entry) {
    if (entry.timeoutMs <= 0) {
      return;
    }

    entry.timeoutHandle = setTimeout(() => {
      if (this.activeEntry && this.activeEntry.id === entry.id) {
        this.log('CNC command timeout', entry.rawCommand);
        this.rejectActive(buildTimeoutError(entry));
      }
    }, entry.timeoutMs);
  }

  clearTimeout(entry) {
    if (entry?.timeoutHandle) {
      clearTimeout(entry.timeoutHandle);
      entry.timeoutHandle = null;
    }
  }

  handleOk() {
    if (!this.activeEntry) {
      this.log('Received OK with no active entry');
      return null;
    }

    const entry = this.activeEntry;
    this.clearTimeout(entry);
    this.activeEntry = null;

    const payload = toEventPayload(entry, {
      status: 'success',
      timestamp: new Date().toISOString()
    });
    entry.resolve(payload);
    this.emit('ack', payload);

    // Move on to the next command immediately
    this.dispatchNext();
    return entry;
  }

  handleError(errorPayload) {
    if (!this.activeEntry) {
      this.log('Received error with no active entry', errorPayload);
      return null;
    }

    const error = errorPayload instanceof Error ? errorPayload : new Error(errorPayload?.message || 'CNC command failed');
    if (errorPayload && typeof errorPayload === 'object') {
      Object.assign(error, errorPayload);
    }

    return this.rejectActive(error);
  }

  rejectActive(error) {
    if (!this.activeEntry) {
      return;
    }

    const entry = this.activeEntry;
    this.clearTimeout(entry);
    this.activeEntry = null;

    entry.reject(error);
    this.emit('ack', toEventPayload(entry, {
      status: 'error',
      error,
      timestamp: new Date().toISOString()
    }));

    this.dispatchNext();
    return entry;
  }

  flush(reason = 'flush', details) {
    const rejectEntry = (entry) => {
      this.clearTimeout(entry);
      entry.reject(buildFlushError(entry, reason, details));
      this.emit('ack', toEventPayload(entry, {
        status: 'flushed',
        reason,
        timestamp: new Date().toISOString()
      }));
    };

    if (this.activeEntry) {
      const entry = this.activeEntry;
      this.activeEntry = null;
      rejectEntry(entry);
    }

    while (this.pending.length > 0) {
      const entry = this.pending.shift();
      rejectEntry(entry);
    }
  }
}
