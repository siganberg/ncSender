<template>
  <div v-if="shouldShow" class="progress-card" role="group" aria-label="Job progress">
    <div class="header">
      <span class="title">Job Progress</span>
      <span class="status-pill" :class="statusClass">{{ statusLabel }}</span>
      <span class="spacer"></span>
      <span class="percent" aria-live="polite">{{ displayPercent }}%</span>
      <button class="close-btn" :disabled="!canClose" @click="handleClose" title="Hide progress">Close</button>
    </div>
  <div class="bar" :class="{ overdue: isOverdue }" aria-hidden="true">
      <div class="fill" :class="{ overdue: isOverdue }" :style="{ width: percent + '%' }">
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
        <span class="value">{{ formatTime(remainingSec) }}</span>
      </div>
      <div class="meta-item">
        <span class="label">ETA</span>
        <span class="value">{{ etaDisplay }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue';
import { useAppStore } from '@/composables/use-app-store';
import { api } from '@/lib/api.js';

const store = useAppStore();
const startTimeIso = computed(() => store.serverState?.jobLoaded?.jobStartTime as string | undefined);
const etaSeconds = computed(() => {
  const v = store.serverState?.jobLoaded?.jobETASeconds as number | undefined;
  return typeof v === 'number' ? v : undefined;
});
const hasLoadedFile = computed(() => !!store.serverState?.jobLoaded?.filename);
const statusRaw = computed(() => store.serverState?.jobLoaded?.status as 'running' | 'paused' | 'stopped' | 'completed' | undefined);
const statusLabel = computed(() => {
  const s = statusRaw.value;
  if (s === 'running') return 'Running';
  if (s === 'paused') return 'Paused';
  if (s === 'completed') return 'COMPLETED';
  if (s === 'stopped') return 'STOPPED';
  return '';
});
const statusClass = computed(() => {
  const s = statusRaw.value;
  return {
    running: s === 'running',
    paused: s === 'paused',
    stopped: s === 'stopped',
    completed: s === 'completed'
  };
});

const shouldShow = computed(() => {
  const jl = store.serverState?.jobLoaded as any;
  return !!(jl && jl.showProgress);
});

const startAtMs = computed(() => {
  if (!startTimeIso.value) return undefined;
  const t = Date.parse(startTimeIso.value);
  return Number.isFinite(t) ? t : undefined;
});

const nowMs = ref(Date.now());
let timer: number | null = null;
onMounted(() => {
  timer = window.setInterval(() => { nowMs.value = Date.now(); }, 200);
});
onUnmounted(() => { if (timer) clearInterval(timer); });

const jobPauseAtIso = computed(() => store.serverState?.jobLoaded?.jobPauseAt as string | undefined);
const jobPausedTotalSec = computed(() => {
  const v = store.serverState?.jobLoaded?.jobPausedTotalSec as number | undefined;
  return typeof v === 'number' ? v : 0;
});
const jobEndTimeIso = computed(() => store.serverState?.jobLoaded?.jobEndTime as string | undefined);

const baseNowMs = computed(() => {
  const endMs = jobEndTimeIso.value ? Date.parse(jobEndTimeIso.value) : undefined;
  return Number.isFinite(endMs) ? (endMs as number) : nowMs.value;
});

const elapsedSec = computed(() => {
  if (!startAtMs.value) return 0;
  let totalMs = baseNowMs.value - startAtMs.value;
  // Subtract accumulated paused time
  totalMs -= (jobPausedTotalSec.value * 1000);
  // If currently paused and not ended, subtract ongoing pause duration
  if (!jobEndTimeIso.value && jobPauseAtIso.value) {
    const pauseAtMs = Date.parse(jobPauseAtIso.value);
    if (Number.isFinite(pauseAtMs)) {
      totalMs -= (baseNowMs.value - (pauseAtMs as number));
    }
  }
  return Math.max(0, Math.floor(totalMs / 1000));
});

const remainingSec = computed(() => {
  if (!etaSeconds.value) return 0;
  return Math.round(etaSeconds.value - elapsedSec.value);
});
const isOverdue = computed(() => remainingSec.value < 0);

const percent = computed(() => {
  if (!etaSeconds.value || etaSeconds.value <= 0) return 0;
  const p = (elapsedSec.value / etaSeconds.value) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
});
const displayPercent = computed(() => percent.value);

const etaDisplay = computed(() => {
  if (!startAtMs.value || !etaSeconds.value) return '--:--';
  const eta = new Date(startAtMs.value + etaSeconds.value * 1000);
  return eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
});

function formatTime(s: number) {
  const neg = s < 0;
  const abs = Math.abs(s);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const sec = Math.floor(abs % 60);
  const base = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  return neg ? `-${base}` : base;
}

// Close is only enabled after job finished (completed or stopped)
const canClose = computed(() => statusRaw.value === 'completed' || statusRaw.value === 'stopped');

async function handleClose() {
  if (!canClose.value) return;
  try {
    await api.sendWebSocketMessage('job:progress:close', {}, { skipReadyCheck: false });
  } catch (e) {
    // Non-fatal; UI will update once server broadcasts
    console.warn('Failed to send job:progress:close:', (e as any)?.message || e);
  }
}
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
.percent { font-variant-numeric: tabular-nums; color: var(--color-text-secondary); }
.status-pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; margin-left: 8px; }
.status-pill.running { background: rgba(46, 204, 113, 0.2); color: #2ecc71; }
.status-pill.paused { background: rgba(241, 196, 15, 0.25); color: #f1c40f; }
.status-pill.stopped { background: rgba(149, 165, 166, 0.25); color: #95a5a6; }
.status-pill.completed { background: rgba(46, 204, 113, 0.2); color: #2ecc71; font-weight: 600; }
.spacer { flex: 1; }
.close-btn { border: 1px solid var(--color-border); background: var(--color-surface-muted); color: var(--color-text-primary); cursor: pointer; font-size: 12px; padding: 2px 8px; border-radius: 999px; margin-left: 8px; }
.close-btn:hover { color: var(--color-text-primary); }
.close-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.bar {
  position: relative;
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: var(--color-surface-muted);
  overflow: hidden;
}
.fill { position: absolute; inset: 0 auto 0 0; background: var(--gradient-accent); border-radius: 999px; transition: width 140ms ease; }
.bar.overdue { background: rgba(255, 107, 107, 0.15); }
.fill.overdue { background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.8)); }
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

@media (max-width: 959px) { .progress-card { padding: 10px; } .bar { height: 8px; } }
</style>
