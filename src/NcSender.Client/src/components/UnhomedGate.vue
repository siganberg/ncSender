<!--
  The "machine is not homed" question, drawn as its two answers: home now
  (the safe one, when the machine has homing) or run what was asked without
  homing. Cancel sits under them. "Home now" only homes: what was asked for
  is dropped, and the user sends it again.
-->
<template>
  <div class="uhg">
    <div class="uhg__head">
      <span class="uhg__why">
        <PanelIcon name="warning" />
        The machine is not homed
      </span>
      <h3 class="uhg__title">{{ canHome ? 'Home before running this?' : 'Run this without homing?' }}</h3>
    </div>

    <div class="uhg__pick" :class="{ 'uhg__pick--one': !canHome }">
      <button v-if="canHome" type="button" class="uhg__tile uhg__tile--main" @click="emit('respond', gate.gateId, 'home')">
        <PanelIcon name="home" class="uhg__icon" />
        <span class="uhg__role">Recommended</span>
        <span class="uhg__do">Home now</span>
        <span class="uhg__note">Then send your command again. Soft limits, parking and tool changes need a known position.</span>
      </button>
      <button type="button" class="uhg__tile uhg__tile--danger" @click="emit('respond', gate.gateId, 'continue')">
        <PanelIcon name="hand" class="uhg__icon" />
        <span class="uhg__role">At your own risk</span>
        <span class="uhg__do">Run without homing</span>
        <span class="uhg__note">The position is unknown. The tool can crash.</span>
      </button>
    </div>

    <div class="uhg__foot">
      <span class="uhg__asked">
        <template v-if="requested">Requested: <code>{{ requested }}</code></template>
      </span>
      <button type="button" class="uhg__cancel" @click="emit('respond', gate.gateId, 'abort')">Cancel</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Gate } from '../composables/useGateDialog';
import PanelIcon from './PanelIcon.vue';

const props = defineProps<{ gate: Gate }>();
const emit = defineEmits<{ (e: 'respond', gateId: string, value: string): void }>();

const canHome = computed(() => props.gate.data?.canHome === '1');
const requested = computed(() => props.gate.data?.requested ?? '');
</script>

<style scoped>
.uhg {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 30px;
  min-width: min(560px, 92vw);
}

.uhg__head { display: flex; flex-direction: column; gap: 4px; }
.uhg__why {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.98rem;
  font-weight: 600;
  color: #e9b949;
}
.uhg__why svg { width: 18px; height: 18px; flex: none; }
.uhg__title { margin: 0; font-size: 1.5rem; font-weight: 600; line-height: 1.25; color: var(--color-text-primary); }

.uhg__pick {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  align-items: stretch;
}
.uhg__pick--one { grid-template-columns: minmax(0, 1fr); }

.uhg__tile {
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
.uhg__tile:focus-visible, .uhg__cancel:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

.uhg__icon { width: 38px; height: 38px; flex: none; }
.uhg__role {
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
.uhg__do { font-size: 1.26rem; font-weight: 700; line-height: 1.25; }
.uhg__note { font-size: 0.96rem; line-height: 1.4; color: var(--color-text-secondary); }

.uhg__tile--main {
  border-color: var(--color-accent) !important;
  background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface-muted)) !important;
}
.uhg__tile--main:hover { background: color-mix(in srgb, var(--color-accent) 22%, var(--color-surface-muted)) !important; }
.uhg__tile--main .uhg__icon,
.uhg__tile--main .uhg__role { color: var(--color-accent); }

.uhg__tile--danger .uhg__icon,
.uhg__tile--danger .uhg__role { color: #ff6b6b; }
.uhg__tile--danger:hover {
  border-color: #ff6b6b !important;
  background: color-mix(in srgb, #ff6b6b 13%, var(--color-surface-muted)) !important;
}

.uhg__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: var(--gap-md);
  border-top: 1px solid var(--color-border);
}
.uhg__asked { flex: 1 1 160px; min-width: 0; font-size: 0.96rem; color: var(--color-text-secondary); overflow-wrap: anywhere; }
.uhg__asked code { font-family: var(--font-mono, ui-monospace, Menlo, monospace); color: var(--color-text-primary); }

.uhg__cancel {
  min-width: 140px;
  padding: 14px 28px !important;
  font: inherit;
  font-size: 1.14rem;
  font-weight: 500;
  cursor: pointer;
  color: var(--color-text-primary) !important;
  background: var(--color-surface-muted) !important;
  border: 1px solid var(--color-border) !important;
  border-radius: var(--radius-small) !important;
  box-shadow: none !important;
}
.uhg__cancel:hover { border-color: var(--color-accent) !important; }

@media (max-width: 480px) {
  .uhg__pick { grid-template-columns: minmax(0, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
  .uhg__tile { transition: none; }
}
</style>
