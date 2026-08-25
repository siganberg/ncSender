
<template>
  <div class="gate-panel" :class="`gate-panel--${gate.variant || 'info'}`">
    <h3 class="gate-panel__title">{{ gate.title }}</h3>
    <p
      v-if="gate.message && gate.messageHtml"
      class="gate-panel__message"
      v-html="gate.message"
    ></p>
    <p v-else-if="gate.message" class="gate-panel__message">{{ gate.message }}</p>
    <p v-if="showHoldHint" class="gate-panel__hint">{{ holdHint }}</p>

    <div class="gate-panel__actions">
      <template v-for="item in actionItems" :key="item.key">
        <GateStepButton
          v-if="item.kind === 'step' && currentStep"
          :label="currentStep.label"
          :disabled="stepsAllDone"
          :hold-ms="gate.stepConfig?.holdMs"
          :countdown-sec="gate.stepConfig?.countdownSec"
          @fire="onStepFire"
        />
        <button
          v-else-if="item.button"
          type="button"
          :class="['gate-panel__btn', styleClass(item.button.style)]"
          :disabled="item.button.requiresStepsComplete && !stepsAllDone"
          @click="onRespond(item.button.value)"
        >
          {{ item.button.label }}
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import type { Gate, GateButton, GateStep } from '../composables/useGateDialog';
import GateStepButton from './GateStepButton.vue';

const props = defineProps<{ gate: Gate }>();
const emit = defineEmits<{
  (e: 'respond', gateId: string, value: string): void;
  (e: 'fire-step', gateId: string, stepIndex: number): void;
}>();

// ── Step-derived state ─────────────────────────────────────────────────────
const stepIndex = computed(() => props.gate.stepProgress ?? 0);
const totalSteps = computed(() => props.gate.steps?.length ?? 0);
const hasSteps = computed(() => totalSteps.value > 0);
const stepsAllDone = computed(() => hasSteps.value && stepIndex.value >= totalSteps.value);

const currentStep = computed<GateStep | null>(() => {
  const steps = props.gate.steps;
  if (!steps || steps.length === 0) return null;
  if (stepIndex.value >= steps.length) return steps[steps.length - 1];
  return steps[stepIndex.value];
});

// ── Button layout ──────────────────────────────────────────────────────────
// Insert the step button between Abort and Continue (before the first
// requiresStepsComplete button). If no button needs steps, append after.
interface ActionItem { key: string; kind: 'step' | 'button'; button?: GateButton }
const actionItems = computed<ActionItem[]>(() => {
  const out: ActionItem[] = [];
  let stepInserted = false;
  for (const btn of props.gate.buttons) {
    if (hasSteps.value && btn.requiresStepsComplete && !stepInserted) {
      out.push({ key: '__step__', kind: 'step' });
      stepInserted = true;
    }
    out.push({ key: btn.value, kind: 'button', button: btn });
  }
  if (hasSteps.value && !stepInserted) out.push({ key: '__step__', kind: 'step' });
  return out;
});

// ── Hold-hint text ─────────────────────────────────────────────────────────
const showHoldHint = computed(() => hasSteps.value && !stepsAllDone.value);
const holdHint = computed(() => {
  const cs = Math.max(1, props.gate.stepConfig?.countdownSec ?? 5);
  const hm = Math.max(200, props.gate.stepConfig?.holdMs ?? 1000);
  const chain = props.gate.stepConfig?.chainSteps
    ? ` Chain mode is on — one arm runs every remaining step.`
    : '';
  return `Tap to arm a ${cs}-second countdown, so you have time to walk to the spindle first. `
       + `Press and hold for ${hm / 1000} second${hm === 1000 ? '' : 's'} to fire it right away.${chain}`;
});

function styleClass(style?: string): string {
  switch (style) {
    case 'danger':  return 'gate-panel__btn--danger';
    case 'primary': return 'gate-panel__btn--primary';
    default:        return 'gate-panel__btn--secondary';
  }
}

function onRespond(value: string): void {
  emit('respond', props.gate.gateId, value);
}
function onStepFire(): void {
  if (stepsAllDone.value) return;
  emit('fire-step', props.gate.gateId, stepIndex.value);
}

// If a step advances (server rebroadcasts), do nothing here — the step
// button component owns its own gesture state and unmounts when
// stepsAllDone flips.
watch(stepIndex, () => { /* no-op */ });
</script>

<style scoped>
.gate-panel {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  padding: var(--gap-lg);
}

.gate-panel__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.gate-panel__message {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
}

.gate-panel__hint {
  margin: 0;
  color: var(--color-text-muted, var(--color-text-secondary));
  font-size: 0.85rem;
  line-height: 1.4;
  opacity: 0.85;
}

.gate-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-sm);
  justify-content: center;
  margin-top: var(--gap-sm);
}

.gate-panel__btn {
  padding: 12px 24px;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  min-width: 110px;
}

.gate-panel__btn:disabled { opacity: 0.5; cursor: not-allowed; }

.gate-panel__btn--secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}
.gate-panel__btn--secondary:hover:not(:disabled) {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.gate-panel__btn--primary {
  background: var(--gradient-accent);
  color: #fff;
}
.gate-panel__btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(26, 188, 156, 0.25);
}

.gate-panel__btn--danger {
  background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.8));
  color: white;
}
.gate-panel__btn--danger:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(255, 107, 107, 0.3);
}
</style>
