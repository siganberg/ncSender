<template>
  <label class="toggle-switch">
    <span class="toggle-switch__wrapper">
      <input
        type="checkbox"
        class="toggle-switch__input"
        role="switch"
        :aria-checked="modelValue"
        :checked="modelValue"
        @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      <span
        class="toggle-switch__slider"
        :class="{ 'toggle-switch__slider--on': modelValue }"
      >
        <span class="toggle-switch__thumb" :class="{ 'toggle-switch__thumb--right': modelValue }" />
      </span>
    </span>
    <span v-if="label" class="toggle-switch__label">{{ label }}</span>
  </label>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  label?: string;
}>();

defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();
</script>

<style scoped>
.toggle-switch {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--color-text-primary);
  cursor: pointer;
}

.toggle-switch__wrapper {
  position: relative;
  display: inline-flex;
}

.toggle-switch__input {
  position: absolute;
  inset: 0;
  opacity: 0;
  margin: 0;
  cursor: pointer;
}

.toggle-switch__slider {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: var(--color-surface-muted);
  display: flex;
  align-items: center;
  box-shadow: inset 0 0 0 1px var(--color-border);
  transition: background 0.2s ease;
}

.toggle-switch__slider--on {
  background: rgba(26, 188, 156, 0.2);
  box-shadow: inset 0 0 0 1px rgba(26, 188, 156, 0.4);
}

.toggle-switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-surface);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s ease;
}

.toggle-switch__thumb--right {
  transform: translateX(20px);
}

.toggle-switch__input:focus-visible + .toggle-switch__slider {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.toggle-switch__label {
  font-size: 0.9rem;
  user-select: none;
}
</style>
