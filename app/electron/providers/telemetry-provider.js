// Lightweight telemetry provider interface and a grblHAL-backed implementation.
// The provider exposes parsed controller telemetry needed for ETA refinement.

export class TelemetryProvider {
  // Base class/interface. Implementations should emit updates via a callback.
  constructor() {
    this._cb = null;
    this._snapshot = {};
  }

  onUpdate(cb) {
    this._cb = cb;
  }

  getSnapshot() {
    return { ...this._snapshot };
  }

  start() {}
  stop() {}
}

export class GrblHalTelemetryProvider extends TelemetryProvider {
  constructor(cncController) {
    super();
    this.cnc = cncController;
    this._listener = null;
  }

  start() {
    if (!this.cnc || this._listener) return;
    this._listener = (status) => {
      // Map a compact snapshot we care about
      const snap = {};
      if (status) {
        if (status.FS) {
          // FS is already parsed into lastStatus in cnc-controller as a string, but
          // we also expose feed/spindle numeric via split when present.
          const parts = String(status.FS).split(',');
          const f = Number(parts[0]);
          if (Number.isFinite(f)) snap.feed = f; // mm/min (grblHAL default)
        }
        if (typeof status.feedrateOverride === 'number') snap.feedOv = status.feedrateOverride; // percent
        if (typeof status.rapidOverride === 'number') snap.rapidOv = status.rapidOverride; // percent
        if (typeof status.spindleOverride === 'number') snap.spindleOv = status.spindleOverride; // percent
        if (typeof status.MPos === 'string') snap.MPos = status.MPos; // raw string "x,y,z"
        if (typeof status.Bf === 'string') snap.Bf = status.Bf; // planner buffer (optional)
        if (typeof status.status === 'string') snap.state = status.status; // Idle/Run/Hold
      }
      this._snapshot = snap;
      if (this._cb) this._cb(this.getSnapshot());
    };
    this.cnc.on('status-report', this._listener);
  }

  stop() {
    if (this.cnc && this._listener) {
      try { this.cnc.off?.('status-report', this._listener); } catch {}
      this._listener = null;
    }
  }
}

