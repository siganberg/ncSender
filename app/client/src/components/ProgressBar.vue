<template>
  <div class="progress-card" role="group" aria-label="Job progress">
    <div class="header">
      <span class="title">Job Progress</span>
      <span class="percent" aria-live="polite">{{ displayPercent }}%</span>
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

// Fake animation for now
const totalSeconds = ref(180);
const startAt = ref(Date.now());
const elapsedSec = ref(0);

const percent = computed(() => {
  const p = Math.min(100, (elapsedSec.value / totalSeconds.value) * 100);
  return Math.round(p * 10) / 10;
});
const displayPercent = computed(() => Math.floor(percent.value));
const remainingSec = computed(() => Math.max(0, Math.round(totalSeconds.value - elapsedSec.value)));
const etaDisplay = computed(() => {
  const eta = new Date(Date.now() + remainingSec.value * 1000);
  return eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
});

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

let timer: number | null = null;
onMounted(() => {
  const tick = () => {
    const now = Date.now();
    elapsedSec.value = Math.min(totalSeconds.value, (now - startAt.value) / 1000);
    if (elapsedSec.value >= totalSeconds.value) {
      setTimeout(() => {
        startAt.value = Date.now();
        totalSeconds.value = 120 + Math.floor(Math.random() * 180);
        elapsedSec.value = 0;
      }, 600);
    }
  };
  timer = window.setInterval(tick, 100);
});

onUnmounted(() => { if (timer) clearInterval(timer); });
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

@media (max-width: 959px) { .progress-card { padding: 10px; } .bar { height: 8px; } }
</style>
