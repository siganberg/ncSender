<!--
  A plugin prompt with things to do in order (a manual tool change), drawn
  as a list: each step the machine does has its button in its own row, a
  finished step gets a tick, and the last row is Continue. The plugin gives
  the heading and a line per step (data.kind = 'steps'); a prompt without
  them is drawn by GatePanel.
-->
<template>
  <div class="sg">
    <div class="sg__head">
      <span class="sg__why">
        <PanelIcon name="warning" />
        {{ gate.title }}
      </span>
      <h3 class="sg__title">{{ gate.data?.heading }}</h3>
    </div>

    <div v-if="gate.data?.toolId" class="sg__tool">
      <span class="sg__tool-id">{{ gate.data.toolId }}</span>
      <span v-if="gate.data.toolName" class="sg__tool-name">{{ gate.data.toolName }}</span>
    </div>

    <ol v-if="steps.length" class="sg__steps">
      <li
        v-for="(step, i) in steps"
        :key="i"
        class="sg__step"
        :class="{ 'sg__step--done': i < progress, 'sg__step--now': i === progress }"
      >
        <span class="sg__n">
          <svg v-if="i < progress" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          <template v-else>{{ i + 1 }}</template>
        </span>
        <div class="sg__body">
          <span class="sg__do">{{ stepText(i, step.label) }}</span>
          <template v-if="i === progress">
            <div class="sg__act">
              <GateStepButton
                class="sg__fire"
                :label="step.label"
                :hold-ms="gate.stepConfig?.holdMs"
                :countdown-sec="gate.stepConfig?.countdownSec"
                @fire="emit('fire-step', gate.gateId, i)"
              />
            </div>
            <span class="sg__note">{{ holdHint }}</span>
          </template>
        </div>
      </li>
      <li class="sg__step" :class="{ 'sg__step--now': allDone }">
        <span class="sg__n">{{ steps.length + 1 }}</span>
        <div class="sg__body">
          <span class="sg__do">{{ continueText }}</span>
          <span v-if="allDone && gate.data?.continueNote" class="sg__note">{{ gate.data.continueNote }}</span>
        </div>
      </li>
    </ol>
    <p v-else class="sg__text">{{ continueText }}</p>

    <div class="sg__foot">
      <button
        v-for="btn in gate.buttons"
        :key="btn.value"
        type="button"
        class="sg__btn"
        :class="`sg__btn--${btn.style || 'secondary'}`"
        :disabled="btn.requiresStepsComplete && !allDone"
        @click="emit('respond', gate.gateId, btn.value)"
      >{{ btn.label }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Gate } from '../composables/useGateDialog';
import GateStepButton from './GateStepButton.vue';
import PanelIcon from './PanelIcon.vue';

const props = defineProps<{ gate: Gate }>();
const emit = defineEmits<{
  (e: 'respond', gateId: string, value: string): void;
  (e: 'fire-step', gateId: string, stepIndex: number): void;
}>();

const steps = computed(() => props.gate.steps ?? []);
const progress = computed(() => props.gate.stepProgress ?? 0);
const allDone = computed(() => progress.value >= steps.value.length);

// A step's own line: what to do, or what it did once it is done.
function stepText(i: number, label: string): string {
  const d = props.gate.data ?? {};
  const task = d[`step${i}.task`] || label;
  return i < progress.value ? d[`step${i}.done`] || task : task;
}

const continueText = computed(() => props.gate.data?.continueTask || 'Continue the job');

const holdHint = computed(() => {
  const cs = Math.max(1, props.gate.stepConfig?.countdownSec ?? 5);
  const hm = Math.max(200, props.gate.stepConfig?.holdMs ?? 1000);
  const chain = props.gate.stepConfig?.chainSteps ? ' Chain mode is on — one arm runs every remaining step.' : '';
  return `Tap to arm a ${cs}-second countdown, so you have time to walk to the spindle first. `
       + `Press and hold for ${hm / 1000} second${hm === 1000 ? '' : 's'} to fire it right away.${chain}`;
});
</script>

<style scoped>
.sg {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 30px;
  min-width: min(560px, 92vw);
}

.sg__head { display: flex; flex-direction: column; gap: 4px; }
.sg__why {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.98rem;
  font-weight: 600;
  color: #e9b949;
}
.sg__why svg { width: 18px; height: 18px; flex: none; }
.sg__title { margin: 0; font-size: 1.5rem; font-weight: 600; line-height: 1.25; text-wrap: balance; color: var(--color-text-primary); }

.sg__tool {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
}
.sg__tool-id {
  flex: none;
  padding: 6px 10px;
  font-family: var(--font-mono, ui-monospace, Menlo, monospace);
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  border-radius: 8px;
}
.sg__tool-name { min-width: 0; font-size: 1.1rem; font-weight: 600; color: var(--color-text-primary); overflow-wrap: anywhere; }

.sg__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.sg__step {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  column-gap: 14px;
  padding-bottom: 16px;
}
.sg__step:last-child { padding-bottom: 0; }
/* The line joining one step to the next. */
.sg__step:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 16px;
  top: 36px;
  bottom: 2px;
  width: 2px;
  background: var(--color-border);
}
.sg__step--done:not(:last-child)::before { background: color-mix(in srgb, #2ecc71 55%, var(--color-border)); }

.sg__n {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  font-size: 0.98rem;
  font-weight: 700;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 2px solid var(--color-border);
  border-radius: 50%;
}
.sg__n svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.sg__step--now .sg__n { color: #fff; background: var(--color-accent); border-color: var(--color-accent); }
.sg__step--done .sg__n { color: #2ecc71; border-color: #2ecc71; background: rgba(46, 204, 113, 0.12); }

.sg__body { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding-top: 4px; }
.sg__do { font-size: 1.1rem; font-weight: 600; line-height: 1.4; color: var(--color-text-secondary); }
.sg__step--now .sg__do { color: var(--color-text-primary); }
.sg__note { font-size: 0.98rem; line-height: 1.4; color: var(--color-text-secondary); }
.sg__text { margin: 0; font-size: 1.1rem; line-height: 1.5; color: var(--color-text-secondary); }

.sg__act { display: flex; flex-wrap: wrap; gap: var(--gap-sm); }
.sg__fire {
  min-width: 160px !important;
  padding: 14px 28px !important;
  font-size: 1.14rem !important;
}

.sg__foot {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--gap-sm);
  padding-top: var(--gap-md);
  border-top: 1px solid var(--color-border);
}
.sg__btn {
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
.sg__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sg__btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.sg__btn--secondary:hover:not(:disabled) { border-color: var(--color-accent) !important; }
.sg__btn--primary {
  color: #fff !important;
  background: var(--gradient-accent) !important;
  border-color: transparent !important;
}
.sg__btn--danger {
  color: #fff !important;
  background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.8)) !important;
  border-color: transparent !important;
}
</style>
