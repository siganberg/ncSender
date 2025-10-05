import { GCodePreAnalyzer } from './gcode-preanalyzer.js';
import { readMachineProfileFromCache } from './machine-profile.js';

export class JobProgressEstimator {
  constructor({ telemetry, preAnalyzer } = {}) {
    this.telemetry = telemetry || null;
    this.pre = preAnalyzer || new GCodePreAnalyzer();
    this._perLineSec = [];
    this._prefixSec = [];
    this._totalSec = 0;
    this._perLineType = [];
    this._currentLine = 0; // 1-based from job processor perspective
    this._active = false;
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
    if (this.telemetry?.start) this.telemetry.start();
  }

  stop() {
    this._active = false;
    if (this.telemetry?.stop) this.telemetry.stop();
  }

  onAdvanceToLine(lineNumber) {
    // lineNumber is 1-based index (matches job processor currentLine)
    if (!Number.isFinite(lineNumber)) return;
    this._currentLine = Math.max(0, Math.min(lineNumber, this._perLineSec.length));
  }

  getEstimate() {
    if (!this._active) return null;
    const executedSec = this._prefixSec[Math.min(this._currentLine, this._prefixSec.length - 1)] || 0;
    let remainingSec = Math.max(0, this._totalSec - executedSec);

    const snap = this.telemetry?.getSnapshot?.() || {};
    // Scale remaining time by overrides if available: separate linear vs rapid
    if ((Number.isFinite(snap.feedOv) && snap.feedOv > 0) || (Number.isFinite(snap.rapidOv) && snap.rapidOv > 0)) {
      let remLinear = 0;
      let remRapid = 0;
      for (let i = this._currentLine; i < this._perLineSec.length; i++) {
        const t = Number(this._perLineSec[i]) || 0;
        const ty = this._perLineType[i];
        if (ty === 'rapid') remRapid += t; else if (ty === 'linear') remLinear += t; else remLinear += t;
      }
      const feedScale = Number.isFinite(snap.feedOv) && snap.feedOv > 0 ? (100 / snap.feedOv) : 1;
      const rapidScale = Number.isFinite(snap.rapidOv) && snap.rapidOv > 0 ? (100 / snap.rapidOv) : 1;
      remainingSec = remLinear * feedScale + remRapid * rapidScale;
    }

    const totalDyn = executedSec + remainingSec;
    const progressPercent = totalDyn > 0 ? Math.round((executedSec / totalDyn) * 100) : 0;

    return {
      progressProvider: 'telemetry-estimator',
      totalEstimatedSec: Math.round(totalDyn),
      remainingSec: Math.round(remainingSec),
      progressPercent
    };
  }
}
