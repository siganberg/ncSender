<!--
  This file is part of ncSender.

  ncSender is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  ncSender is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with ncSender. If not, see <https://www.gnu.org/licenses/>.
-->

<template>
  <!-- Pre-run info: show estimate before job starts -->
  <div v-if="showPreRun" class="progress-card pre-run" :class="{ 'has-warning': warningMessage }" role="group" aria-label="Job info">
    <div class="header">
      <span class="title">Job Info</span>
      <span class="status-pill" :class="warningMessage ? 'warning' : 'ready'">{{ warningMessage ? 'Warning' : 'Ready' }}</span>
    </div>
    <div class="meta pre-run-meta">
      <div class="meta-item">
        <span class="label">Est. Time</span>
        <span class="value">{{ estimateDisplay }}</span>
      </div>
      <div class="meta-item">
        <span class="label">Lines</span>
        <span class="value">{{ totalLines?.toLocaleString() || '0' }}</span>
      </div>
    </div>
    <div v-if="warningMessage" class="warning-row">
      <svg class="warning-icon" width="20" height="20" viewBox="0 0 24 24">
        <path d="M12 2L2 20h20L12 2z" fill="currentColor" opacity="0.9"/>
        <path d="M11 10h2v5h-2zm0 6h2v2h-2z" fill="#1a1a1a"/>
      </svg>
      <span class="warning-text">{{ warningMessage.replace(/^Warning:\s*/i, '') }}</span>
    </div>
  </div>
  <!-- Running/finished progress bar -->
  <div v-else-if="shouldShow" class="progress-card" role="group" aria-label="Job progress">
    <div class="header">
      <span class="title">Job Progress</span>
      <span class="status-pill" :class="statusClass">{{ statusLabel }}</span>
      <span class="spacer"></span>
      <button class="close-btn" :disabled="!canClose" @click="handleClose" title="Hide progress">Close</button>
    </div>
    <div class="bar-wrap">
      <div class="bar" :class="{ stopped: isStopped }" aria-hidden="true">
        <div class="fill" :class="{ stopped: isStopped }" :style="{ width: percent + '%' }">
          <div class="shine"></div>
        </div>
      </div>
      <div class="percent-overlay" aria-live="polite">{{ displayPercent }}%</div>
    </div>
    <div class="meta">
      <template v-if="isFinished">
        <div class="meta-item">
          <span class="label">Total Time</span>
          <span class="value">{{ formatTime(effectiveElapsedSec) }}</span>
        </div>
        <div class="meta-item"></div>
        <div class="meta-item">
          <span class="label">Lines</span>
          <span class="value">{{ linesDisplay }}</span>
        </div>
      </template>
      <template v-else>
        <div class="meta-item">
          <span class="label">Remaining</span>
          <span class="value" :class="{ 'time-exceeded': isTimeExceeded }">{{ remainingDisplay }}</span>
        </div>
        <div class="meta-item"></div>
        <div class="meta-item">
          <span class="label">Lines</span>
          <span class="value">{{ linesDisplay }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAppStore } from '@/composables/use-app-store';
import { api } from '@/lib/api.js';

const props = defineProps<{
  warningMessage?: string;
}>();

const store = useAppStore();
const runtimeSecFromServer = computed(() => store.serverState?.jobLoaded?.runtimeSec as number | undefined);
const totalLines = computed(() => store.serverState?.jobLoaded?.totalLines as number | undefined);
const currentLine = computed(() => store.serverState?.jobLoaded?.currentLine as number | undefined);
const hasLoadedFile = computed(() => !!store.serverState?.jobLoaded?.filename);
const statusRaw = computed(() => store.serverState?.jobLoaded?.status as 'running' | 'paused' | 'stopped' | 'completed' | null | undefined);
const estimatedSec = computed(() => store.serverState?.jobLoaded?.estimatedSec as number | undefined);

// Show pre-run info when file is loaded but not yet started (status is null)
const showPreRun = computed(() => {
  return hasLoadedFile.value && statusRaw.value === null && estimatedSec.value !== undefined;
});

const estimateDisplay = computed(() => {
  const sec = estimatedSec.value;
  if (!sec || sec <= 0) return '--:--';
  return formatTime(sec);
});
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
  const status = statusRaw.value;
  // Show progress bar when status is 'running', 'paused', 'stopped', or 'completed'
  // Don't show when status is null (file just loaded) or undefined (no file)
  return status === 'running' || status === 'paused' || status === 'stopped' || status === 'completed';
});

const effectiveElapsedSec = computed(() => Math.max(0, Number(runtimeSecFromServer.value || 0)));

const isCompleted = computed(() => statusRaw.value === 'completed');
const isStopped = computed(() => statusRaw.value === 'stopped');
const isFinished = computed(() => isCompleted.value || isStopped.value);

const currRemainingSec = computed(() => {
  const v = store.serverState?.jobLoaded?.remainingSec as number | null | undefined;
  return typeof v === 'number' ? v : null;
});

const isTimeExceeded = computed(() => {
  const v = currRemainingSec.value;
  return v !== null && v < 0;
});

const percent = computed(() => {
  const pv = store.serverState?.jobLoaded?.progressPercent as number | undefined;
  if (typeof pv === 'number') return Math.max(0, Math.min(100, Math.round(pv)));
  const tl = totalLines.value || 0;
  const cl = currentLine.value || 0;
  if (isCompleted.value) return 100;
  if (tl <= 0) return 0;
  const p = (cl / tl) * 100;
  return Math.max(0, Math.min(100, Math.round(p)));
});
const displayPercent = computed(() => percent.value);

const remainingDisplay = computed(() => {
  if (isFinished.value) return '';
  const tl = totalLines.value || 0;
  const cl = currentLine.value || 0;
  if (tl <= 0 || cl <= 0) return '--:--';
  if (currRemainingSec.value === null) return '--:--';
  const time = currRemainingSec.value;
  // If time is negative, show + prefix with positive value
  if (time < 0) {
    return '+' + formatTime(Math.abs(time));
  }
  return formatTime(time);
});

const linesDisplay = computed(() => {
  const tl = totalLines.value || 0;
  const cl = currentLine.value || 0;
  if (isCompleted.value) return `${Math.max(0, tl)} / ${Math.max(0, tl)}`;
  return `${Math.max(0, cl)} / ${Math.max(0, tl)}`;
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
.bar-wrap { position: relative; }
.percent-overlay { position: absolute; left: 50%; transform: translateX(-50%); top: calc(100% + 2px); font-variant-numeric: tabular-nums; color: var(--color-text-secondary); pointer-events: none; }
.status-pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; margin-left: 8px; }
.status-pill.running { background: rgba(46, 204, 113, 0.2); color: #2ecc71; }
.status-pill.paused { background: rgba(241, 196, 15, 0.25); color: #f1c40f; }
.status-pill.stopped { background: rgba(149, 165, 166, 0.25); color: #95a5a6; }
.status-pill.completed { background: rgba(46, 204, 113, 0.2); color: #2ecc71; font-weight: 600; }
.status-pill.ready { background: rgba(52, 152, 219, 0.2); color: #3498db; }
.status-pill.warning { background: rgba(255, 107, 107, 0.25); color: #ff6b6b; }
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
.bar.stopped { background: rgba(255, 107, 107, 0.15); }
.fill.stopped { background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.8)); }
.shine {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(45deg, rgba(255,255,255,0.22) 0, rgba(255,255,255,0.22) 8px, rgba(255,255,255,0.08) 8px, rgba(255,255,255,0.08) 16px);
  mix-blend-mode: overlay; opacity: 0.35; border-radius: 999px;
  animation: flow 1.2s linear infinite;
}
@keyframes flow { 0% { transform: translateX(-20%); } 100% { transform: translateX(20%); } }

.meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 12px; }
.pre-run { min-width: 180px; width: fit-content; margin: 0 auto; }
.pre-run.has-warning { max-width: 260px; border: 2px solid #b84444; animation: warningPulse 2s ease-in-out infinite; }
@keyframes warningPulse {
  0%, 50%, 100% { border-color: #dc3545; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 20px rgba(220, 53, 69, 0.6); }
  25%, 75% { border-color: #dc3545; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 30px rgba(220, 53, 69, 0.9); }
}
.warning-row { display: flex; align-items: flex-start; gap: 6px; color: #ff8888; font-size: 0.85rem; font-weight: 500; line-height: 1.3; }
.warning-text { word-break: break-word; }
.warning-icon { flex-shrink: 0; }
.pre-run-meta { display: flex; justify-content: space-between; gap: 24px; }
.pre-run.has-warning .pre-run-meta { justify-content: center; gap: 32px; }
.meta-item:first-child { justify-self: start; text-align: left; }
.meta-item:nth-child(2) { justify-self: center; text-align: center; }
.meta-item:last-child { justify-self: end; text-align: right; }
.meta-item { display: flex; flex-direction: column; gap: 2px; }
.label { font-size: 12px; color: var(--color-text-secondary); }
.value { font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
.value.time-exceeded { color: #ff6b6b; font-weight: 600; }

@media (max-width: 959px) { .progress-card { padding: 10px; } .bar { height: 8px; } }
</style>
