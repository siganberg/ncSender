// Dead-man switch for continuous jogging
// Automatically sends jog cancel if heartbeat is not received within timeout

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

const REALTIME_JOG_CANCEL = String.fromCharCode(0x85);

export class JogWatchdog {
  constructor({ timeoutMs = 750, onTimeout = null } = {}) {
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
    this.timer = null;
    this.activeJogCommand = null;
  }

  start(commandId, command) {
    // Clear any existing watchdog
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

    // Reset the timer
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

export { REALTIME_JOG_CANCEL };
