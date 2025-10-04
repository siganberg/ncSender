<template>
  <div class="progress-card" role="group" aria-label="Job progress">
    <div class="header">
      <span class="title">Job Progress</span>
      <div class="header-right">
        <span v-if="statusPill" class="status-pill" :class="`status--${statusPill.toLowerCase()}`">{{ statusPill }}</span>
        <span class="percent" aria-live="polite">{{ displayPercent }}%</span>
        <button class="clear-btn" :disabled="status === 'running'" @click="$emit('close')" title="Close progress">Close</button>
      </div>
    </div>
    <div class="bar" aria-hidden="true">
      <div class="fill" :style="{ width: percent + '%' }">
        <div class="shine"></div>
      </div>
    </div>
    <div class="meta">
      <div class="meta-item">
        <span class="label">Elapsed</span>
        <span class="value">{{ formatTime(elapsedSec) }}</span>
      </div>
      <div class="meta-item">
        <span class="label">Remaining</span>
        <span class="value">{{ remainingDisplay }}</span>
      </div>
      <div class="meta-item">
        <span class="label">ETA</span>
        <span class="value">{{ etaDisplay }}</span>
        <span v-if="actualDisplay" class="subtle">Actual: {{ actualDisplay }}<template v-if="totalSecondsDelta !== 0"> (Δ {{ deltaDisplay }})</template></span>
      </div>
    </div>
  </div>
  </template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  currentLine?: number;
  totalLines?: number;
  totalSeconds?: number; // static estimate (seconds)
  timelineDoneSec?: number; // predicted time consumed up to current line
  actualSeconds?: number; // set when job completes
  elapsedSec: number; // live elapsed (seconds)
  status?: 'running' | 'paused' | 'stopped' | 'completed';
}>();

defineEmits<{ (e: 'close'): void }>();

const percent = computed(() => {
  // Prefer static time-based estimation when provided (non-adaptive)
  const T = Math.max(0, props.totalSeconds || 0);
  if (T > 0) {
    const e = Math.max(0, props.elapsedSec || 0);
    const p = Math.min(100, (e / T) * 100);
    return Math.round(p * 10) / 10;
  }
  // Fallback to line-based percent
  const t = Math.max(0, props.totalLines || 0);
  const c = Math.max(0, Math.min(props.currentLine || 0, t));
  const p = t > 0 ? (c / t) * 100 : 0;
  return Math.round(p * 10) / 10;
});
const displayPercent = computed(() => Math.floor(percent.value));

const throughput = computed(() => {
  // Only used for line-based fallback
  const e = Math.max(0, props.elapsedSec || 0);
  const c = Math.max(0, props.currentLine || 0);
  if (e < 2 || c < 1) return 0;
  return c / e; // lines per second
});

const remainingSec = computed(() => {
  const T = Math.max(0, props.totalSeconds || 0);
  if (T > 0) {
    const e = Math.max(0, props.elapsedSec || 0);
    return Math.round(T - e); // allow negative when past ETA
  }
  // Fallback to line-based remaining
  const t = Math.max(0, props.totalLines || 0);
  const c = Math.max(0, Math.min(props.currentLine || 0, t));
  const r = t - c;
  const th = throughput.value;
  if (th <= 0) return 0;
  return Math.max(0, Math.round(r / th));
});

const remainingDisplay = computed(() => formatSignedTime(remainingSec.value));
const etaDisplay = computed(() => {
  const eta = new Date(Date.now() + remainingSec.value * 1000);
  return isFinite(remainingSec.value) && remainingSec.value > 0
    ? eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '--:--';
});

const actualDisplay = computed(() => {
  const T = Math.max(0, props.totalSeconds || 0);
  const overrunNow = T > 0 && (props.elapsedSec || 0) > T;
  const a = typeof props.actualSeconds === 'number' && props.actualSeconds > 0
    ? props.actualSeconds
    : (overrunNow ? props.elapsedSec : 0);
  if (a && a > 0) return formatTime(a);
  return '';
});

const statusPill = computed(() => {
  switch (props.status) {
    case 'running': return 'Running';
    case 'paused': return 'Paused';
    case 'stopped': return 'Stopped';
    case 'completed': return 'Completed';
    default: return undefined;
  }
});

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatSignedTime(s: number) {
  const sign = s < 0 ? '-' : '';
  return sign + formatTime(Math.abs(s));
}

const totalSecondsDelta = computed(() => {
  const T = Math.max(0, props.totalSeconds || 0);
  if (!T) return 0;
  if (props.actualSeconds && props.actualSeconds > 0) return Math.round(props.actualSeconds - T);
  const e = Math.max(0, props.elapsedSec || 0);
  if (e > T) return Math.round(e - T);
  return 0;
});

const deltaDisplay = computed(() => {
  const d = totalSecondsDelta.value;
  const sign = d > 0 ? '+' : '';
  return `${sign}${formatTime(Math.abs(d))}`;
});
</script>

<style scoped>
.progress-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 10px 12px;
  box-shadow: var(--shadow-subtle, 0 4px 12px -10px rgba(0,0,0,0.3));
  opacity: 0.8; /* allow seeing toolpath beneath */
}

.header { display: flex; align-items: baseline; justify-content: space-between; }
.title { font-weight: 600; color: var(--color-text-primary); }
.header-right { display: flex; align-items: center; gap: 8px; }
.percent { font-variant-numeric: tabular-nums; color: var(--color-text-secondary); }
.clear-btn { background: transparent; color: var(--color-text-secondary); border: 1px solid var(--color-border); border-radius: 6px; padding: 4px 8px; cursor: pointer; }
.clear-btn:hover { background: var(--color-surface-muted); }
.clear-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.status-pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--color-border); color: var(--color-text-secondary); }
.status--running { color: #16a34a; border-color: rgba(22,163,74,0.3); }
.status--paused { color: #f59e0b; border-color: rgba(245,158,11,0.35); }
.status--stopped { color: #ef4444; border-color: rgba(239,68,68,0.35); }
.status--completed { color: #22c55e; border-color: rgba(34,197,94,0.35); }

.bar {
  position: relative;
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: var(--color-surface-muted);
  overflow: hidden;
}
.fill { position: absolute; inset: 0 auto 0 0; background: var(--gradient-accent); border-radius: 999px; transition: width 140ms ease; }
.shine {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(45deg, rgba(255,255,255,0.22) 0, rgba(255,255,255,0.22) 8px, rgba(255,255,255,0.08) 8px, rgba(255,255,255,0.08) 16px);
  mix-blend-mode: overlay; opacity: 0.35; border-radius: 999px;
  animation: flow 1.2s linear infinite;
}
@keyframes flow { 0% { transform: translateX(-20%); } 100% { transform: translateX(20%); } }

.meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 12px; }
.meta-item:first-child { justify-self: start; text-align: left; }
.meta-item:nth-child(2) { justify-self: center; text-align: center; }
.meta-item:last-child { justify-self: end; text-align: right; }
.meta-item { display: flex; flex-direction: column; gap: 2px; }
.label { font-size: 12px; color: var(--color-text-secondary); }
.value { font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
.subtle { font-size: 12px; color: var(--color-text-secondary); }

@media (max-width: 959px) { .progress-card { padding: 10px; } .bar { height: 8px; } }
</style>
