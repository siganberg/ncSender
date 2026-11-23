<!--
  One choice out of a few, as a track with an accent block that slides to the
  chosen one: the look of the toolbar's units switch, for any exclusive set of
  buttons. Every option gets the same width.
-->
<template>
  <div
    class="sgs"
    role="radiogroup"
    :aria-label="ariaLabel || undefined"
    :style="{ '--sgs-count': options.length, '--sgs-at': at }"
  >
    <span v-if="at >= 0" class="sgs__thumb" aria-hidden="true"></span>
    <button
      v-for="o in options"
      :key="String(o.value)"
      type="button"
      role="radio"
      class="sgs__btn"
      :aria-checked="o.value === modelValue"
      :disabled="disabled"
      @click="o.value !== modelValue && emit('update:modelValue', o.value)"
    >{{ o.label }}</button>
  </div>
</template>

<script setup lang="ts" generic="T extends string | number | boolean | null">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  ariaLabel?: string;
}>(), { disabled: false, ariaLabel: '' });

const emit = defineEmits<{ (e: 'update:modelValue', value: T): void }>();

const at = computed(() => props.options.findIndex((o) => o.value === props.modelValue));
</script>

<style scoped>
.sgs {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--sgs-count, 2), minmax(0, 1fr));
  min-height: 40px;
  padding: 2px;
  border: 1px solid var(--color-border-strong, rgba(127, 127, 127, 0.35));
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
  isolation: isolate;
}

/* The accent block that slides to the chosen option. */
.sgs__thumb {
  position: absolute;
  z-index: 0;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: calc((100% - 4px) / var(--sgs-count, 2));
  border-radius: calc(var(--radius-small) - 2px);
  background: var(--color-accent);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  transform: translateX(calc(100% * var(--sgs-at, 0)));
  transition: transform 0.25s cubic-bezier(0.3, 0.7, 0.3, 1);
}

.sgs__btn {
  position: relative;
  z-index: 1;
  min-width: 0;
  padding: 4px 12px;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  line-height: 1.15;
  cursor: pointer;
  transition: color 0.25s ease;
}

.sgs__btn:hover:not(:disabled):not([aria-checked="true"]) {
  color: var(--color-text-primary);
}

.sgs__btn[aria-checked="true"] {
  color: #fff;
  cursor: default;
}

.sgs__btn:disabled {
  cursor: default;
  opacity: 0.6;
}

@media (prefers-reduced-motion: reduce) {
  .sgs__thumb,
  .sgs__btn {
    transition: none;
  }
}
</style>
