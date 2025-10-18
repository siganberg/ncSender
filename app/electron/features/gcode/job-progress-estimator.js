import { GCodePreAnalyzer } from './gcode-preanalyzer.js';
import { readMachineProfileFromCache } from '../firmware/machine-profile.js';

export class JobProgressEstimator {
  constructor({ telemetry, preAnalyzer, shouldCountCallback } = {}) {
    this.telemetry = telemetry || null;
    this.pre = preAnalyzer || new GCodePreAnalyzer();
    this._perLineSec = [];
    this._prefixSec = [];
    this._totalSec = 0;
    this._perLineType = [];
    this._currentLine = 0; // 1-based from job processor perspective
    this._active = false;
    this._originalEstimatedSec = 0; // Store original estimate
    this._actualElapsedSec = 0; // Actual elapsed time (counts only when running)
    this._timerInterval = null; // 1-second timer
    this._shouldCountCallback = shouldCountCallback || null; // Callback to check if we should count
  }

  async startWithContent(gcodeText) {
    // Refresh pre-analyzer with machine profile (firmware.json cached)
    try {
      const profile = await readMachineProfileFromCache();
      this.pre = new GCodePreAnalyzer({
        rapidMmPerMin: Math.min(
          ...(Object.values(profile.vmaxMmPerMin || {}).map(Number).filter(Number.isFinite)),
          6000
        ),
        defaultFeedMmPerMin: 1000,
        vmaxMmPerMin: profile.vmaxMmPerMin || null,
        accelMmPerSec2: profile.accelMmPerSec2 || null
      });
    } catch {}

    const plan = this.pre.parse(gcodeText || '');
    this._perLineSec = plan.perLineSec || [];
    this._totalSec = Number(plan.totalSec) || 0;
    this._perLineType = plan.perLineType || new Array(this._perLineSec.length).fill('other');
    // Build prefix sums for O(1) executed time
    this._prefixSec = new Array(this._perLineSec.length + 1).fill(0);
    for (let i = 0; i < this._perLineSec.length; i++) {
      this._prefixSec[i + 1] = this._prefixSec[i] + (Number(this._perLineSec[i]) || 0);
    }
    this._currentLine = 0;
    this._active = true;
    this._originalEstimatedSec = this._totalSec; // Store original estimate
    this._actualElapsedSec = 0; // Reset actual elapsed time
    this._startTimer();
    if (this.telemetry?.start) this.telemetry.start();
  }

  stop() {
    this._active = false;
    this._stopTimer();
    if (this.telemetry?.stop) this.telemetry.stop();
  }

  pause() {
    this._stopTimer();
  }

  resume() {
    this._startTimer();
  }

  _startTimer() {
    if (this._timerInterval) return; // Already running
    this._timerInterval = setInterval(() => {
      if (!this._active) return;

      // Only increment if shouldCountCallback returns true (senderStatus is 'running')
      const shouldCount = this._shouldCountCallback ? this._shouldCountCallback() : true;

      if (shouldCount) {
        this._actualElapsedSec++;
        console.log(`[JobProgressEstimator] Timer tick: elapsed=${this._actualElapsedSec}s, remaining=${this._originalEstimatedSec - this._actualElapsedSec}s`);
      } else {
        console.log(`[JobProgressEstimator] Timer tick skipped (not running)`);
      }
    }, 1000);
  }

  _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  onAdvanceToLine(lineNumber) {
    // lineNumber is 1-based index (matches job processor currentLine)
    if (!Number.isFinite(lineNumber)) return;
    this._currentLine = Math.max(0, Math.min(lineNumber, this._perLineSec.length));
  }

  getEstimate() {
    if (!this._active) return null;

    // Calculate remaining time as countdown from original estimate
    const remainingSec = this._originalEstimatedSec - this._actualElapsedSec;

    // Calculate progress based on lines executed
    const executedSec = this._prefixSec[Math.min(this._currentLine, this._prefixSec.length - 1)] || 0;
    const progressPercent = this._originalEstimatedSec > 0
      ? Math.round((executedSec / this._originalEstimatedSec) * 100)
      : 0;

    return {
      progressProvider: 'telemetry-estimator',
      totalEstimatedSec: Math.round(this._originalEstimatedSec),
      actualElapsedSec: Math.round(this._actualElapsedSec),
      remainingSec: Math.round(remainingSec),
      progressPercent: Math.max(0, Math.min(100, progressPercent))
    };
  }
}
