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
  <label class="theme-toggle">
    <span class="theme-toggle__wrapper">
      <input
        type="checkbox"
        class="theme-toggle__input"
        role="switch"
        :aria-checked="isDark"
        :checked="isDark"
        @change="$emit('toggle-theme')"
      />
      <span
        class="theme-toggle__slider"
        :class="{ 'theme-toggle__slider--dark': isDark }"
      >
        <span class="theme-toggle__icon theme-toggle__icon--light">L</span>
        <span class="theme-toggle__icon theme-toggle__icon--dark">D</span>
        <span
          class="theme-toggle__thumb"
          :class="{ 'theme-toggle__thumb--right': isDark }"
        />
      </span>
    </span>
    <span class="theme-toggle__label">{{ isDark ? 'Dark' : 'Light' }} Mode</span>
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  theme: 'light' | 'dark';
}>();

const isDark = computed(() => props.theme === 'dark');

defineEmits<{
  (e: 'toggle-theme'): void;
}>();
</script>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--color-text-primary);
}

.theme-toggle__wrapper {
  position: relative;
  display: inline-flex;
}

.theme-toggle__input {
  position: absolute;
  inset: 0;
  opacity: 0;
  margin: 0;
  cursor: pointer;
}

.theme-toggle__slider {
  position: relative;
  width: 52px;
  height: 28px;
  border-radius: 999px;
  background: var(--color-surface-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  box-shadow: inset 0 0 0 1px var(--color-border);
  transition: background 0.2s ease;
}

.theme-toggle__slider--dark {
  background: rgba(26, 188, 156, 0.2);
  box-shadow: inset 0 0 0 1px rgba(26, 188, 156, 0.4);
}

.theme-toggle__thumb {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-surface);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s ease;
}

.theme-toggle__thumb--right {
  transform: translateX(24px);
}

.theme-toggle__icon {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  pointer-events: none;
}

.theme-toggle__slider--dark .theme-toggle__icon--dark,
.theme-toggle__slider:not(.theme-toggle__slider--dark) .theme-toggle__icon--light {
  color: var(--color-text-primary);
}

.theme-toggle__input:focus-visible + .theme-toggle__slider {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.theme-toggle__label {
  font-size: 0.9rem;
}
</style>
