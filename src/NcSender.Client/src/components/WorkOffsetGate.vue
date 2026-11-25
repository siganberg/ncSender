<!--
  The "work offset changed" question, drawn as the two offsets side by side:
  the one the reset left the controller in, and the one in use before it, each
  with where its zero is. Tapping one answers. "Always switch back" is a switch
  under them, and only goes with switching back.
-->
<template>
  <div class="wog">
    <div class="wog__head">
      <span class="wog__why">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
        {{ why === 'end' ? `The program's end put the controller back in ${now}` : `The controller was reset to ${now}` }}
      </span>
      <h3 class="wog__title">Keep working in {{ was }}?</h3>
    </div>

    <div class="wog__pick">
      <button type="button" class="wog__tile" @click="emit('respond', gate.gateId, 'stay')">
        <span class="wog__role">Now</span>
        <span class="wog__name">{{ now }}</span>
        <span v-if="nowAt" class="wog__zero">{{ nowAt }}</span>
        <span class="wog__do">Stay in {{ now }}</span>
      </button>
      <span class="wog__arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
      </span>
      <button type="button" class="wog__tile wog__tile--main" @click="emit('respond', gate.gateId, always ? 'always' : 'switch')">
        <span class="wog__role">You were using</span>
        <span class="wog__name">{{ was }}</span>
        <span v-if="wasAt" class="wog__zero">{{ wasAt }}</span>
        <span class="wog__do">Switch back to {{ was }}</span>
      </button>
    </div>

    <div class="wog__always">
      <div class="wog__always-text">
        <b>Always switch back</b>
        <span>Don't ask again. Change it in Settings.</span>
      </div>
      <ToggleSwitch v-model="always" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Gate } from '../composables/useGateDialog';
import { useAppStore } from '@/composables/use-app-store';
import { formatCoordinate } from '@/lib/units';
import ToggleSwitch from './ToggleSwitch.vue';

const props = defineProps<{ gate: Gate }>();
const emit = defineEmits<{ (e: 'respond', gateId: string, value: string): void }>();
const appStore = useAppStore();

const always = ref(false);
const was = computed(() => props.gate.data?.was ?? '');
const now = computed(() => props.gate.data?.now ?? 'G54');
const why = computed(() => props.gate.data?.why ?? 'reset');

// "x,y,z,..." in machine millimetres, shown in the user's units.
const place = (csv?: string) => {
  const n = (csv ?? '').split(',').map(Number);
  if (n.length < 3 || n.slice(0, 3).some((v) => !Number.isFinite(v))) return '';
  const units = appStore.unitsPreference.value;
  return ['X', 'Y', 'Z'].map((axis, i) => `${axis} ${formatCoordinate(n[i], units)}`).join('   ');
};
const wasAt = computed(() => place(props.gate.data?.wasAt));
const nowAt = computed(() => place(props.gate.data?.nowAt));
</script>

<style scoped>
.wog {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 30px;
  min-width: min(560px, 92vw);
}

.wog__head { display: flex; flex-direction: column; gap: 4px; }
.wog__why {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.98rem;
  font-weight: 600;
  color: #e9b949;
}
.wog__why svg { width: 18px; height: 18px; flex: none; }
.wog__title { margin: 0; font-size: 1.5rem; font-weight: 600; line-height: 1.25; color: var(--color-text-primary); }

.wog__pick {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 10px;
  align-items: stretch;
}

.wog__tile {
  display: flex !important;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
  padding: 18px !important;
  text-align: left;
  font: inherit;
  cursor: pointer;
  color: var(--color-text-primary) !important;
  background: var(--color-surface-muted) !important;
  border: 1.5px solid var(--color-border) !important;
  border-radius: var(--radius-small) !important;
  box-shadow: none !important;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.wog__tile:hover { border-color: var(--color-text-secondary) !important; }
.wog__tile:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

.wog__role {
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
.wog__name { font-family: var(--font-mono, ui-monospace, Menlo, monospace); font-size: 2.28rem; font-weight: 700; line-height: 1.1; }
.wog__zero {
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
  font-size: 0.89rem;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.wog__do { margin-top: 6px; font-size: 1.08rem; font-weight: 600; }

.wog__tile--main {
  border-color: var(--color-accent) !important;
  background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface-muted)) !important;
}
.wog__tile--main:hover { border-color: var(--color-accent) !important; background: color-mix(in srgb, var(--color-accent) 22%, var(--color-surface-muted)) !important; }
.wog__tile--main .wog__role,
.wog__tile--main .wog__do { color: var(--color-accent); }

.wog__arrow { align-self: center; display: flex; color: var(--color-text-secondary); }
.wog__arrow svg { width: 22px; height: 22px; }

.wog__always {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-top: var(--gap-md);
  border-top: 1px solid var(--color-border);
}
.wog__always-text { min-width: 0; }
.wog__always-text b { display: block; font-size: 1.1rem; font-weight: 600; color: var(--color-text-primary); }
.wog__always-text span { font-size: 0.96rem; color: var(--color-text-secondary); }

@media (max-width: 480px) {
  .wog__pick { grid-template-columns: minmax(0, 1fr); }
  .wog__arrow { justify-self: center; transform: rotate(90deg); }
}

@media (prefers-reduced-motion: reduce) {
  .wog__tile { transition: none; }
}
</style>
