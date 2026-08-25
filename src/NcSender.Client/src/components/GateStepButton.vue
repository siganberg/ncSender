
<template>
  <button
    :ref="assignBtn"
    type="button"
    class="gate-panel__btn gate-panel__btn--step"
    :disabled="disabled || armed"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointerleave="onPointerLeave"
    @pointercancel="onPointerCancel"
    @contextmenu.prevent
  >
    {{ displayLabel }}
  </button>
</template>

<script setup lang="ts">
import { toRef } from 'vue';
import { useHoldTapConfirm } from '../composables/useHoldTapConfirm';

const props = defineProps<{
  label: string;
  disabled?: boolean;
  holdMs?: number;
  countdownSec?: number;
}>();
const emit = defineEmits<{ (e: 'fire'): void }>();

const labelRef = toRef(props, 'label');

const {
  buttonRef,
  armed,
  displayLabel,
  onPointerDown, onPointerUp, onPointerLeave, onPointerCancel,
} = useHoldTapConfirm({
  label:        () => labelRef.value,
  onFire:       () => emit('fire'),
  holdMs:       () => props.holdMs ?? 1000,
  countdownSec: () => props.countdownSec ?? 5,
  disabled:     () => !!props.disabled,
});

// Function ref: string refs inside <template v-for> collect into an array
// which breaks direct DOM writes in the gesture composable.
function assignBtn(el: unknown): void {
  buttonRef.value = (el as HTMLButtonElement | null) ?? null;
}
</script>

<style scoped>
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

.gate-panel__btn--step {
  background-color: var(--color-accent, #2563eb);
  color: white;
  overflow: hidden;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
}
</style>
