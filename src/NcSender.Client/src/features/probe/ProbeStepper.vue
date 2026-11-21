<!--
  A number for the probe dialog, sized for a touch screen: − [value unit] +.
  A press steps to the next whole step; holding repeats, faster the longer it
  is held. The value can still be typed. `change` fires when a press ends or
  the field is left: the moment to save.
-->
<template>
  <div class="pst" :class="{ 'is-disabled': disabled, 'is-invalid': invalid }">
    <button
      type="button"
      class="pst__btn"
      :disabled="disabled || atMin"
      aria-label="−"
      @pointerdown.prevent="hold(-1)"
      @pointerup="release"
      @pointerleave="release"
      @pointercancel="release"
      @contextmenu.prevent
    >−</button>
    <label class="pst__field">
      <input
        class="pst__input"
        type="number"
        inputmode="decimal"
        step="any"
        :value="shown"
        :style="{ width: `${Math.max(2, shown.length) + 0.6}ch` }"
        :disabled="disabled"
        @input="onInput"
        @blur="emit('change')"
      />
      <span v-if="unit" class="pst__unit">{{ unit }}</span>
    </label>
    <button
      type="button"
      class="pst__btn"
      :disabled="disabled || atMax"
      aria-label="+"
      @pointerdown.prevent="hold(1)"
      @pointerup="release"
      @pointerleave="release"
      @pointercancel="release"
      @contextmenu.prevent
    >+</button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: number | null | '';
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
  invalid?: boolean;
}>(), { step: 1, min: -Infinity, max: Infinity, unit: '', disabled: false, invalid: false });
const emit = defineEmits<{
  (e: 'update:modelValue', v: number): void;
  (e: 'change'): void;
}>();

const current = computed(() => (props.modelValue === '' || props.modelValue == null || Number.isNaN(Number(props.modelValue))
  ? null : Number(props.modelValue)));
const decimals = computed(() => {
  const s = String(props.step);
  return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
});
// At most one digit more than the step has: a converted value does not trail a dozen decimals.
const shown = computed(() => (current.value == null ? '' : String(Number(current.value.toFixed(decimals.value + 1)))));
const atMin = computed(() => current.value != null && current.value <= props.min + 1e-9);
const atMax = computed(() => current.value != null && current.value >= props.max - 1e-9);

const bump = (dir: number) => {
  const step = props.step;
  const cur = current.value ?? 0;
  const next = dir > 0 ? Math.floor(cur / step + 1e-6) + 1 : Math.ceil(cur / step - 1e-6) - 1;
  const v = Math.min(props.max, Math.max(props.min, next * step));
  emit('update:modelValue', Number(v.toFixed(decimals.value + 2)));
};

let timer: ReturnType<typeof setTimeout> | null = null;
let held = false;
const release = () => {
  if (timer) { clearTimeout(timer); timer = null; }
  if (held) { held = false; emit('change'); }
};
const hold = (dir: number) => {
  release();
  held = true;
  bump(dir);
  let delay = 400;
  const again = () => { bump(dir); delay = Math.max(50, delay * 0.8); timer = setTimeout(again, delay); };
  timer = setTimeout(again, delay);
};
onBeforeUnmount(() => { if (timer) clearTimeout(timer); });

const onInput = (e: Event) => {
  const raw = (e.target as HTMLInputElement).value.trim();
  if (raw === '') return;
  const v = Number(raw);
  if (Number.isFinite(v)) emit('update:modelValue', v);
};
</script>

<style scoped>
.pst {
  display: flex; align-items: stretch; width: 100%; height: 40px; box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--color-text-secondary) 30%, transparent);
  border-radius: 10px; background: var(--color-surface); overflow: hidden;
}
.pst:focus-within { border-color: var(--color-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 20%, transparent); }
.pst.is-invalid { border-color: var(--color-error, #e45858); }
.pst.is-disabled { opacity: 0.55; }
.pst__btn {
  flex: 0 0 40px; border: 0; padding: 0;
  background: color-mix(in srgb, var(--color-text-secondary) 20%, var(--color-surface));
  color: var(--color-text-primary); font-family: inherit; font-size: 1.35rem; font-weight: 700; line-height: 1;
  cursor: pointer; touch-action: manipulation; user-select: none; -webkit-user-select: none;
}
.pst__btn:active:not(:disabled) { background: color-mix(in srgb, var(--color-accent) 35%, var(--color-surface)); }
.pst__btn:disabled { opacity: 0.4; cursor: default; }
.pst__field { flex: 1 1 0; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 4px; cursor: text; }
.pst__input {
  /* As wide as the number, so the number and its unit sit centred together. */
  flex: 0 1 auto; min-width: 0; padding: 0; border: 0; background: transparent; outline: none;
  color: var(--color-text-primary); font-family: inherit; font-size: 0.95rem; font-weight: 600;
  font-variant-numeric: tabular-nums; text-align: center;
  appearance: textfield; -moz-appearance: textfield;
}
.pst__input::-webkit-outer-spin-button, .pst__input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pst__unit { flex: none; font-size: 0.78rem; color: var(--color-text-secondary); }
</style>
