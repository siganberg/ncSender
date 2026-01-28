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
  <div class="step-control">
    <span class="step-label">Step</span>
    <div
      v-for="(value, index) in stepOptions"
      :key="value"
      class="step-btn-wrapper"
    >
      <button
        :class="['chip', { active: isStepInCategory(currentStep, index) }]"
        @click="handleStepClick(value)"
        @mousedown="startLongPress(index, $event)"
        @mouseup="endLongPress"
        @mouseleave="cancelLongPress"
        @touchstart.prevent="startLongPress(index, $event)"
        @touchend.prevent="handleTouchEnd(value)"
        @touchcancel="cancelLongPress"
      >
        {{ formatStepSizeDisplay(currentStep, index) }}
      </button>
      <div
        v-if="openDropdown === index"
        :class="['step-dropdown', `step-dropdown--${dropdownPosition}`]"
        @click.stop
        @touchstart.stop
      >
        <button
          v-for="opt in getExpandedOptions(index)"
          :key="opt"
          :class="['dropdown-option', { active: isOptionActive(opt, currentStep) }]"
          @click="selectStep(opt)"
          @touchend.prevent="selectStep(opt)"
        >
          {{ formatStepSizeDisplay(opt, index) }}
        </button>
      </div>
    </div>
    <span class="feed-rate-label">Feed</span>
    <select
      class="feed-rate-select"
      :value="currentFeedRate"
      @change="handleFeedRateChange"
    >
      <option
        v-for="rate in getCurrentFeedRateOptions()"
        :key="rate"
        :value="rate"
      >
        {{ formatFeedRateDisplay(rate) }}
      </option>
    </select>
  </div>
  <!-- Backdrop to close dropdown when clicking outside -->
  <div
    v-if="openDropdown !== null"
    class="dropdown-backdrop"
    @click="closeDropdown"
    @touchend.prevent="closeDropdown"
  ></div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useAppStore } from '@/composables/use-app-store';
import {formatJogFeedRate, formatStepSizeJogDisplay} from '@/lib/units';

const appStore = useAppStore();

const props = withDefaults(defineProps<{
  currentStep?: number;
  stepOptions?: number[];
  currentFeedRate?: number;
  feedRateOptions?: Record<number, number[]>;
  feedRateDefaults?: Record<number, number>;
}>(), {
  currentStep: 1,
  stepOptions: () => [0.1, 1, 10],
  currentFeedRate: 2000
});

const emit = defineEmits<{
  (e: 'update:step', value: number): void;
  (e: 'update:feedRate', value: number): void;
}>();

// Long press state
const LONG_PRESS_MS = 500;
const openDropdown = ref<number | null>(null);
const dropdownPosition = ref<'top' | 'bottom'>('bottom');
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let pressStartTime = 0;
let currentButtonEl: HTMLElement | null = null;

// Expanded options for each step category (in mm)
const expandedOptionsMap: Record<number, number[]> = {
  0: [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],  // Small steps
  1: [1, 2, 3, 4, 5, 6, 7, 8, 9],                                   // Medium steps
  2: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300]  // Large steps
};

// Helper to compare floating point numbers (round to 3 decimal places)
const approxEqual = (a: number, b: number): boolean => {
  const roundedA = Math.round(a * 1000) / 1000;
  const roundedB = Math.round(b * 1000) / 1000;
  return roundedA === roundedB;
};

// Check if current step belongs to a category
const isStepInCategory = (step: number, categoryIndex: number): boolean => {
  const options = expandedOptionsMap[categoryIndex];
  return options?.some(opt => approxEqual(opt, step)) ?? false;
};

// Check if a specific option matches current step
const isOptionActive = (opt: number, currentStep: number): boolean => {
  return approxEqual(opt, currentStep);
};

// Get expanded options for a category
const getExpandedOptions = (categoryIndex: number): number[] => {
  return expandedOptionsMap[categoryIndex] ?? [];
};

// Long press handlers
const startLongPress = (index: number, event: Event) => {
  pressStartTime = Date.now();
  currentButtonEl = (event.target as HTMLElement).closest('.chip');

  pressTimer = setTimeout(() => {
    // Calculate position based on available space
    if (currentButtonEl) {
      const rect = currentButtonEl.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropdownHeight = 260; // approximate max height

      // Prefer bottom, but use top if not enough space below
      dropdownPosition.value = spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove ? 'bottom' : 'top';
    }

    // If current step is not in this category, switch to the base step for this group
    if (!isStepInCategory(props.currentStep, index)) {
      emit('update:step', props.stepOptions[index]);
    }

    openDropdown.value = index;
    pressTimer = null;
  }, LONG_PRESS_MS);
};

const endLongPress = () => {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
};

// Handle touch end - combines endLongPress + click logic for touch devices
const handleTouchEnd = (value: number) => {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
  // If it was a short tap (not long press) and dropdown isn't open, select the step
  const elapsed = Date.now() - pressStartTime;
  if (elapsed < LONG_PRESS_MS && openDropdown.value === null) {
    emit('update:step', value);
  }
};

const cancelLongPress = () => {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
};

const closeDropdown = () => {
  openDropdown.value = null;
};

// Handle regular click (only if not a long press)
const handleStepClick = (value: number) => {
  const elapsed = Date.now() - pressStartTime;
  if (elapsed < LONG_PRESS_MS && openDropdown.value === null) {
    emit('update:step', value);
  }
};

// Select step from dropdown
const selectStep = (value: number) => {
  emit('update:step', value);
  closeDropdown();
};

// Default feed rate options per step size index (0=small, 1=medium, 2=large)
const defaultFeedRateOptionsByIndex = [
  [300, 400, 500, 700, 1000],      // Small step (0.1mm or 0.001in)
  [1000, 2000, 3000, 4000, 5000],  // Medium step (1mm or 0.01in)
  [6000, 7000, 8000, 9000, 10000]  // Large step (10mm or 0.1in)
];

const feedRateOptionsMap = computed(() => props.feedRateOptions ?? {
  0.1: [300, 400, 500, 700, 1000],
  1: [1000, 2000, 3000, 4000, 5000],
  10: [6000, 7000, 8000, 9000, 10000]
});

const getCurrentFeedRateOptions = (): number[] => {
  // Find which category the current step belongs to
  for (const [catIndex, options] of Object.entries(expandedOptionsMap)) {
    if (options.some(opt => approxEqual(opt, props.currentStep))) {
      return defaultFeedRateOptionsByIndex[Number(catIndex)] ?? [500, 1000, 3000, 5000];
    }
  }

  // Try to find by step value first (for compatibility with JogPanel)
  if (feedRateOptionsMap.value[props.currentStep]) {
    return feedRateOptionsMap.value[props.currentStep];
  }

  // Fall back to using step index (for Probe with imperial units)
  if (props.stepOptions && Array.isArray(props.stepOptions)) {
    const stepIndex = props.stepOptions.findIndex(opt => approxEqual(opt, props.currentStep));
    if (stepIndex >= 0 && stepIndex < defaultFeedRateOptionsByIndex.length) {
      return defaultFeedRateOptionsByIndex[stepIndex];
    }
  }

  // Ultimate fallback
  return [500, 1000, 3000, 5000];
};

// Format step size - show current value if in this category, otherwise show base value
const formatStepSizeDisplay = (value: number, categoryIndex: number): string => {
  const displayValue = isStepInCategory(value, categoryIndex) ? value : props.stepOptions[categoryIndex];
  return formatStepSizeJogDisplay(displayValue, false, appStore.unitsPreference.value);
};

const formatFeedRateDisplay = (mmPerMin: number): string => {
  return formatJogFeedRate(mmPerMin, appStore.unitsPreference.value);
};

const handleFeedRateChange = (event: Event) => {
  const select = event.target as HTMLSelectElement;
  const newRate = Number(select.value);
  if (Number.isFinite(newRate) && newRate > 0) {
    emit('update:feedRate', newRate);
  }
};

// Close dropdown on escape key
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && openDropdown.value !== null) {
    closeDropdown();
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  if (pressTimer) clearTimeout(pressTimer);
});
</script>

<style scoped>
.step-control {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
}

.step-btn-wrapper {
  position: relative;
}

.chip {
  border: none;
  border-radius: 999px !important;
  padding: 6px 12px !important;
  background: var(--color-surface-muted) !important;
  color: var(--color-text-secondary) !important;
  cursor: pointer;
  min-width: 50px !important;
  width: 60px !important;
  transition: all 0.2s ease;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  -webkit-user-select: none;
}

.chip.active {
  background: var(--gradient-accent) !important;
  color: #fff !important;
}

.step-label,
.feed-rate-label {
  font-size: 0.85rem;
  color: var(--color-text-primary);
}

.step-dropdown {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  box-shadow: var(--shadow-elevated);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 1000;
  min-width: 60px;
  max-height: 250px;
  overflow-y: auto;
}

.step-dropdown--bottom {
  top: calc(100% + 4px);
}

.step-dropdown--top {
  bottom: calc(100% + 4px);
}

.dropdown-option {
  border: none !important;
  background: transparent !important;
  color: var(--color-text-primary) !important;
  padding: 6px 12px !important;
  border-radius: var(--radius-small) !important;
  cursor: pointer;
  font-size: 0.85rem !important;
  text-align: center;
  transition: background 0.15s ease;
  white-space: nowrap;
}

.dropdown-option:hover {
  background: var(--color-surface-muted) !important;
}

.dropdown-option.active {
  background: var(--gradient-accent) !important;
  color: #fff !important;
}

.dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.feed-rate-select {
  width: 80px;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.feed-rate-select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.feed-rate-select:hover {
  border-color: var(--color-accent);
}
</style>
