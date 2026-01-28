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

// G-code pre-analyzer to produce a static plan of durations per line.
// Uses a velocity continuity model that considers entry/exit velocities between moves
// to better approximate real CNC controller behavior with look-ahead planning.

const MM_PER_MIN_TO_MM_PER_SEC = 1 / 60;

export class GCodePreAnalyzer {
  constructor(options = {}) {
    this.defaults = {
      rapidMmPerMin: options.rapidMmPerMin ?? 6000, // fallback scalar rapid
      defaultFeedMmPerMin: options.defaultFeedMmPerMin ?? 1000,
      vmaxMmPerMin: options.vmaxMmPerMin || null,   // {x,y,z} per-axis max rate (mm/min)
      accelMmPerSec2: options.accelMmPerSec2 || null, // {x,y,z} per-axis accel (mm/s^2)
      junctionDeviationMm: options.junctionDeviationMm ?? 0.01 // junction deviation for cornering
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
    let perLineDist = new Array(lines.length).fill(0);
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
        if (Number.isFinite(f) && f > 0) {
          // Convert feed rate to mm/min if in imperial mode
          lastFeed = unitsMm ? f : f * 25.4;
        }
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

        // Store unit vector for linear moves (arcs are already handled above)
        if ((isG0 || isG1) && !perLineUnit[i].x && !perLineUnit[i].y && !perLineUnit[i].z) {
          perLineUnit[i] = { x: dx / dist, y: dy / dist, z: dz / dist };
        }

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
      perLineDist[i] = dist;
      totalDist += dist;
      lastPos = target;
    }

    // Two-pass velocity continuity model (similar to real CNC look-ahead planners)
    // Pass 1: Calculate junction velocities between consecutive MOTION lines
    // Non-motion lines (comments, M-codes) don't affect motion continuity
    const jd = Number(this.defaults?.junctionDeviationMm) || 0.01;
    const junctionVelocities = new Array(perLineSec.length + 1).fill(0);

    // Build list of motion line indices for efficient lookup
    const motionLineIndices = [];
    for (let i = 0; i < perLineSec.length; i++) {
      if (perLineDist[i] > 0 && perLineVtarget[i] > 0) {
        motionLineIndices.push(i);
      }
    }

    // Calculate junction velocities between consecutive motion lines
    for (let mi = 0; mi < motionLineIndices.length; mi++) {
      const i = motionLineIndices[mi];
      const nextMotionIdx = motionLineIndices[mi + 1];

      // If no next motion line, must stop at end
      if (nextMotionIdx === undefined) {
        junctionVelocities[i + 1] = 0;
        continue;
      }

      const v1 = perLineUnit[i] || { x: 0, y: 0, z: 0 };
      const v2 = perLineUnit[nextMotionIdx] || { x: 0, y: 0, z: 0 };

      // If either has no direction, maintain reasonable velocity
      if ((v1.x === 0 && v1.y === 0 && v1.z === 0) || (v2.x === 0 && v2.y === 0 && v2.z === 0)) {
        junctionVelocities[i + 1] = Math.min(perLineVtarget[i] || 0, perLineVtarget[nextMotionIdx] || 0) * 0.5;
        continue;
      }

      const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
      const dotClamped = Math.max(-1, Math.min(1, dot));
      const theta = Math.acos(dotClamped);

      // For small angles (< ~11 degrees), maintain full velocity - controller blends these
      if (!Number.isFinite(theta) || theta < 0.2) {
        junctionVelocities[i + 1] = Math.min(perLineVtarget[i] || 0, perLineVtarget[nextMotionIdx] || 0);
        continue;
      }

      // Junction deviation formula with grblHAL-style calculation
      const a_eff = Math.min(perLineAccel[i] || 500, perLineAccel[nextMotionIdx] || 500);

      // Use sin(theta/2) approximation with 4x effective jd for modern controller behavior
      const sinHalf = Math.sin(theta / 2);
      const effectiveJd = jd * 4; // Modern controllers are more aggressive than classic grbl
      const vj = sinHalf < 0.95
        ? Math.sqrt(Math.max(0, a_eff * effectiveJd * sinHalf / Math.max(0.05, 1 - sinHalf)))
        : Math.min(perLineVtarget[i] || 0, perLineVtarget[nextMotionIdx] || 0) * 0.1;

      const vmaxCorner = Math.min(perLineVtarget[i] || 0, perLineVtarget[nextMotionIdx] || 0);
      junctionVelocities[i + 1] = Math.min(vj, vmaxCorner);
    }

    // Pass 2: Backward pass to ensure we can decelerate to junction velocities
    for (let i = perLineSec.length - 1; i >= 0; i--) {
      const dist = perLineDist[i] || 0;
      const a_eff = perLineAccel[i] || 500;
      const exitV = junctionVelocities[i + 1] || 0;

      if (dist > 0 && a_eff > 0) {
        // Max entry velocity to be able to decelerate to exitV
        const maxEntryV = Math.sqrt(exitV * exitV + 2 * a_eff * dist);
        junctionVelocities[i] = Math.min(junctionVelocities[i] || Infinity, maxEntryV, perLineVtarget[i] || 0);
      }
    }

    // Pass 3: Forward pass to calculate actual timing with velocity continuity
    // Also propagate actual achieved exit velocities forward
    totalSec = 0;
    let actualExitVelocity = 0;
    for (let i = 0; i < perLineSec.length; i++) {
      const dist = perLineDist[i] || 0;
      if (dist <= 0) continue;

      const a_eff = perLineAccel[i] || 500;
      const v_target = perLineVtarget[i] || 0;
      // Entry velocity is the max of: previous exit velocity, or calculated junction velocity
      const v_entry = Math.min(Math.max(actualExitVelocity, junctionVelocities[i] || 0), v_target);
      const v_exit = junctionVelocities[i + 1] || 0;

      if (v_target <= 0 || a_eff <= 0) {
        // Fallback to simple calculation
        const v = v_target > 0 ? v_target : (this.defaults.defaultFeedMmPerMin * MM_PER_MIN_TO_MM_PER_SEC);
        perLineSec[i] = dist / v;
        actualExitVelocity = v;
      } else {
        // Calculate time for trapezoidal profile with entry/exit velocities
        perLineSec[i] = this._calcTrapezoidTime(dist, v_entry, v_exit, v_target, a_eff);
        // Track actual exit velocity for next segment
        actualExitVelocity = v_exit;
      }

      totalSec += perLineSec[i];
    }

    return { totalSec, perLineSec, totalDist, perLineType };
  }

  // Calculate time for trapezoidal motion profile
  _calcTrapezoidTime(dist, v_entry, v_exit, v_cruise, accel) {
    if (dist <= 0) return 0;
    if (accel <= 0) return dist / Math.max(v_cruise, 0.001);

    // Distance needed to accelerate from v_entry to v_cruise
    const d_accel = (v_cruise * v_cruise - v_entry * v_entry) / (2 * accel);
    // Distance needed to decelerate from v_cruise to v_exit
    const d_decel = (v_cruise * v_cruise - v_exit * v_exit) / (2 * accel);

    if (d_accel + d_decel <= dist) {
      // Full trapezoidal profile: accel + cruise + decel
      const t_accel = (v_cruise - v_entry) / accel;
      const t_decel = (v_cruise - v_exit) / accel;
      const d_cruise = dist - d_accel - d_decel;
      const t_cruise = d_cruise / v_cruise;
      return Math.max(0, t_accel) + Math.max(0, t_cruise) + Math.max(0, t_decel);
    } else {
      // Triangle profile: can't reach cruise speed
      // Find peak velocity: v_peak^2 = v_entry^2 + 2*a*d1 = v_exit^2 + 2*a*d2
      // where d1 + d2 = dist
      const v_peak_sq = (2 * accel * dist + v_entry * v_entry + v_exit * v_exit) / 2;
      const v_peak = Math.sqrt(Math.max(0, v_peak_sq));
      const t_accel = (v_peak - v_entry) / accel;
      const t_decel = (v_peak - v_exit) / accel;
      return Math.max(0, t_accel) + Math.max(0, t_decel);
    }
  }
}
