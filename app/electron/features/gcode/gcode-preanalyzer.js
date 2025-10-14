// Simple G-code pre-analyzer to produce a static plan of durations per line.
// This is intentionally approximate (feed-only, no accel). It is designed to be
// easily swappable or upgraded to a trapezoidal/jerk profile model later.

const MM_PER_MIN_TO_MM_PER_SEC = 1 / 60;

export class GCodePreAnalyzer {
  constructor(options = {}) {
    this.defaults = {
      rapidMmPerMin: options.rapidMmPerMin ?? 6000, // fallback scalar rapid
      defaultFeedMmPerMin: options.defaultFeedMmPerMin ?? 1000,
      vmaxMmPerMin: options.vmaxMmPerMin || null,   // {x,y,z} per-axis max rate (mm/min)
      accelMmPerSec2: options.accelMmPerSec2 || null // {x,y,z} per-axis accel (mm/s^2)
    };
  }

  parse(content) {
    if (typeof content !== 'string') return { totalSec: 0, perLineSec: [], totalDist: 0 };

    const lines = content.split('\n');
    let lastFeed = this.defaults.defaultFeedMmPerMin;
    let modalAbs = true; // G90 absolute by default; toggled with G90/G91
    let unitsMm = true; // G21 mm default; toggle with G20
    let plane = 'G17'; // XY plane default
    let modalMotion = null; // last modal motion code (G0/G1/G2/G3)
    let lastPos = { x: 0, y: 0, z: 0 };
    let perLineSec = new Array(lines.length).fill(0);
    let perLineType = new Array(lines.length).fill('other');
    let perLineUnit = new Array(lines.length).fill({ x: 0, y: 0, z: 0 });
    let perLineVtarget = new Array(lines.length).fill(0);
    let perLineAccel = new Array(lines.length).fill(0);
    let totalSec = 0;
    let totalDist = 0;

    const parseWords = (s) => {
      const tokens = [];
      const stripped = s.replace(/\((?:[^)]*)\)/g, ''); // strip paren comments
      const re = /([a-zA-Z])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
      let match;
      while ((match = re.exec(stripped)) !== null) {
        const letter = match[1].toUpperCase();
        const value = Number(match[2]);
        if (Number.isFinite(value)) {
          tokens.push({ letter, value });
        }
      }
      const words = {};
      for (const { letter, value } of tokens) {
        words[letter] = value;
      }
      return { tokens, words };
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const clean = raw.trim();
      if (!clean) continue;

      const { tokens, words } = parseWords(clean);
      // Modal updates based on tokens in order of appearance
      let lineMotion = null;
      for (const { letter, value } of tokens) {
        if (!Number.isFinite(value)) continue;
        if (letter === 'G') {
          const gVal = Math.round(value);
          if (gVal === 90) modalAbs = true;
          else if (gVal === 91) modalAbs = false;
          else if (gVal === 20) unitsMm = false; // inches
          else if (gVal === 21) unitsMm = true;
          else if (gVal === 17) plane = 'G17';
          else if (gVal === 18) plane = 'G18';
          else if (gVal === 19) plane = 'G19';
          if (gVal >= 0 && gVal <= 3) {
            modalMotion = gVal;
            lineMotion = gVal;
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(words, 'F')) {
        const f = Number(words.F);
        if (Number.isFinite(f) && f > 0) lastFeed = f;
      }

      const motionCode = lineMotion !== null ? lineMotion : modalMotion;
      const isG0 = motionCode === 0;
      const isG1 = motionCode === 1;
      const isG2 = motionCode === 2;
      const isG3 = motionCode === 3;

      const hasLinearComponents = Number.isFinite(words.X) || Number.isFinite(words.Y) || Number.isFinite(words.Z);
      const hasArcComponents = Number.isFinite(words.I) || Number.isFinite(words.J) || Number.isFinite(words.K) || Number.isFinite(words.R);
      const isMotionLine = Boolean(motionCode !== null && (lineMotion !== null || hasLinearComponents || hasArcComponents));
      if (!isMotionLine) continue;

      const target = { ...lastPos };
      if (Number.isFinite(words.X)) target.x = modalAbs ? words.X : (target.x + words.X);
      if (Number.isFinite(words.Y)) target.y = modalAbs ? words.Y : (target.y + words.Y);
      if (Number.isFinite(words.Z)) target.z = modalAbs ? words.Z : (target.z + words.Z);

      // Convert to mm if needed
      const scale = unitsMm ? 1 : 25.4;
      let dx = (target.x - lastPos.x) * scale;
      let dy = (target.y - lastPos.y) * scale;
      let dz = (target.z - lastPos.z) * scale;
      let dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      let moveType = isG0 ? 'rapid' : (isG1 ? 'linear' : 'arc');

      // Arc length estimation (XY plane primary). IJK are offsets (incremental) by convention.
      if ((isG2 || isG3) && (plane === 'G17')) {
        // Compute center using I,J or use R if provided
        let arcLen = 0;
        let ux = 0, uy = 0, uz = 0;
        const startX = lastPos.x * scale;
        const startY = lastPos.y * scale;
        const endX = target.x * scale;
        const endY = target.y * scale;

        if (Number.isFinite(words.I) || Number.isFinite(words.J)) {
          const cx = startX + (Number(words.I) || 0) * scale;
          const cy = startY + (Number(words.J) || 0) * scale;
          const rs = Math.hypot(startX - cx, startY - cy) || 0;
          const re = Math.hypot(endX - cx, endY - cy) || 0;
          const r = (rs + re) / 2; // average to mitigate rounding
          const a0 = Math.atan2(startY - cy, startX - cx);
          const a1 = Math.atan2(endY - cy, endX - cx);
          let dtheta = a1 - a0;
          if (isG2) { // CW: negative sweep
            if (dtheta >= 0) dtheta -= 2 * Math.PI;
          } else {   // CCW
            if (dtheta <= 0) dtheta += 2 * Math.PI;
          }
          arcLen = Math.abs(r * dtheta);
          // Tangent at start gives initial direction
          const tx = isG2 ?  Math.sin(a0) : -Math.sin(a0);
          const ty = isG2 ? -Math.cos(a0) :  Math.cos(a0);
          const norm = Math.hypot(tx, ty) || 1;
          ux = Math.abs(tx / norm);
          uy = Math.abs(ty / norm);
          uz = 0;
        } else if (Number.isFinite(words.R)) {
          const chord = Math.hypot(endX - startX, endY - startY);
          const R = Math.abs(Number(words.R) * scale);
          if (R > 0 && chord > 0) {
            let dtheta = 2 * Math.asin(Math.min(1, chord / (2 * R)));
            // R<0 indicates the large arc in some dialects; we only have value, not sign now.
            if (Number(words.R) < 0) dtheta = 2 * Math.PI - dtheta;
            arcLen = R * dtheta;
            const ang = Math.atan2(endY - startY, endX - startX);
            ux = Math.abs(Math.cos(ang));
            uy = Math.abs(Math.sin(ang));
            uz = 0;
          }
        }

        if (arcLen > 0) {
          dist = arcLen;
          dx = (endX - startX);
          dy = (endY - startY);
          dz = 0;
          // replace unit vector with tangential approximation
          if (ux === 0 && uy === 0 && uz === 0) {
            const nn = Math.max(1e-9, Math.hypot(dx, dy));
            ux = Math.abs(dx / nn); uy = Math.abs(dy / nn); uz = 0;
          }
          // store unit
          perLineUnit[i] = { x: dx === 0 ? 0 : dx / Math.max(1e-9, Math.hypot(dx, dy, dz)), y: dy === 0 ? 0 : dy / Math.max(1e-9, Math.hypot(dx, dy, dz)), z: 0 };
        }
      }

      let sec = 0;
      if (dist > 0) {
        const ux = Math.abs(dx) / dist;
        const uy = Math.abs(dy) / dist;
        const uz = Math.abs(dz) / dist;

        // Effective max vector speed from per-axis limits (mm/s)
        const vmax = this.defaults.vmaxMmPerMin;
        let v_eff_max = Infinity;
        if (vmax) {
          const vx = Number(vmax.x) * MM_PER_MIN_TO_MM_PER_SEC;
          const vy = Number(vmax.y) * MM_PER_MIN_TO_MM_PER_SEC;
          const vz = Number(vmax.z) * MM_PER_MIN_TO_MM_PER_SEC;
          if (ux > 0 && Number.isFinite(vx)) v_eff_max = Math.min(v_eff_max, vx / ux);
          if (uy > 0 && Number.isFinite(vy)) v_eff_max = Math.min(v_eff_max, vy / uy);
          if (uz > 0 && Number.isFinite(vz)) v_eff_max = Math.min(v_eff_max, vz / uz);
        } else {
          // Fallback scalar rapid/feed limit
          v_eff_max = (this.defaults.rapidMmPerMin || this.defaults.defaultFeedMmPerMin) * MM_PER_MIN_TO_MM_PER_SEC;
        }

        // Target speed for this move
        const feed_mmps = (isG0 ? Infinity : (Number(lastFeed) * MM_PER_MIN_TO_MM_PER_SEC));
        const v_target = Math.max(0, Math.min(v_eff_max, feed_mmps));

        // Effective accel (mm/s^2) from per-axis limits
        const aaxes = this.defaults.accelMmPerSec2;
        let a_eff = null;
        if (aaxes) {
          const ax = Number(aaxes.x);
          const ay = Number(aaxes.y);
          const az = Number(aaxes.z);
          let aInf = Infinity;
          if (ux > 0 && Number.isFinite(ax)) aInf = Math.min(aInf, ax / ux);
          if (uy > 0 && Number.isFinite(ay)) aInf = Math.min(aInf, ay / uy);
          if (uz > 0 && Number.isFinite(az)) aInf = Math.min(aInf, az / uz);
          if (Number.isFinite(aInf) && aInf > 0) a_eff = aInf;
        }

        if (a_eff && Number.isFinite(v_target) && v_target > 0) {
          // Trapezoidal timing along the vector
          const ta = v_target / a_eff;
          const da = 0.5 * a_eff * ta * ta; // distance during accel
          if (2 * da >= dist) {
            // Triangle profile
            const v_peak = Math.sqrt(dist * a_eff);
            sec = 2 * (v_peak / a_eff);
          } else {
            const cruise = dist - 2 * da;
            sec = 2 * ta + cruise / v_target;
          }
        } else {
          // Fallback to constant speed
          const v = Number.isFinite(v_target) && v_target > 0 ? v_target : ((this.defaults.defaultFeedMmPerMin || 1) * MM_PER_MIN_TO_MM_PER_SEC);
          sec = dist / v;
        }
        perLineVtarget[i] = v_target;
        perLineAccel[i] = a_eff || 0;
      }

      perLineSec[i] = sec;
      perLineType[i] = moveType;
      totalSec += sec;
      totalDist += dist;
      lastPos = target;
    }

    // Junction deviation cornering heuristic
    try {
      const jd = Number(this.defaults?.junctionDeviationMm);
      if (Number.isFinite(jd) && jd > 0) {
        for (let i = 1; i < perLineSec.length - 1; i++) {
          // angle between directions of segment i and i+1
          const v1 = perLineUnit[i] || { x: 0, y: 0, z: 0 };
          const v2 = perLineUnit[i + 1] || { x: 0, y: 0, z: 0 };
          const dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z);
          const dotClamped = Math.max(-1, Math.min(1, dot));
          const theta = Math.acos(dotClamped);
          if (!Number.isFinite(theta) || theta < 1e-6) continue;
          const a_eff = perLineAccel[i] || perLineAccel[i + 1] || 0;
          const v_prev = perLineVtarget[i] || 0;
          const v_next = perLineVtarget[i + 1] || 0;
          if (!(a_eff > 0 && v_prev > 0 && v_next > 0)) continue;
          const tanHalf = Math.tan(theta / 2);
          const vj = Math.sqrt(Math.max(0, a_eff * jd * tanHalf));
          const vmaxCorner = Math.min(v_prev, v_next);
          const vcorner = Math.min(vj, vmaxCorner);
          if (vcorner < vmaxCorner) {
            const t1 = (v_prev - vcorner) / a_eff;
            const t2 = (v_next - vcorner) / a_eff;
            const penalty = Math.max(0, t1) + Math.max(0, t2);
            perLineSec[i + 1] += penalty;
            totalSec += penalty;
          }
        }
      }
    } catch {}

    return { totalSec, perLineSec, totalDist, perLineType };
  }
}
