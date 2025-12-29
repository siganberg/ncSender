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
  <label class="toggle-switch" :class="{ 'toggle-switch--disabled': disabled }">
    <span class="toggle-switch__wrapper">
      <input
        type="checkbox"
        class="toggle-switch__input"
        role="switch"
        :aria-checked="modelValue"
        :checked="modelValue"
        :disabled="disabled"
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
  disabled?: boolean;
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
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.toggle-switch__slider--on {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.toggle-switch__thumb {
  position: absolute;
  top: 1px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;
}

.toggle-switch__thumb--right {
  transform: translateX(18px);
}

.toggle-switch__input:focus-visible + .toggle-switch__slider {
  box-shadow: 0 0 0 2px rgba(26, 188, 156, 0.25);
}

.toggle-switch__label {
  font-size: 0.9rem;
  user-select: none;
}

.toggle-switch--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}
</style>
