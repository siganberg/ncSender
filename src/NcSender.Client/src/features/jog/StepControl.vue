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
        {{ formatButtonStepDisplay(index) }}
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
          {{ formatOptionStepDisplay(opt) }}
        </button>
      </div>
    </div>
    <span class="feed-rate-label">Feed</span>
    <select
      class="feed-rate-select"
      :value="displayFeedRate"
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import {
  createStepGroups,
  jogPanelStepGroups,
  expandedOptionsMap,
  expandedOptionsMapImperial,
  feedRateOptionsByCategory,
  feedRateOptionsByCategoryImperial
} from './jog-step-state';
import { useAppStore } from '@/composables/use-app-store';
import { formatStepSize } from '@/lib/units';

const appStore = useAppStore();

const props = withDefaults(defineProps<{
  currentStep?: number;
  stepOptions?: number[];
  currentFeedRate?: number;
  feedRateOptions?: Record<number, number[]>;
  feedRateDefaults?: Record<number, number>;
  jogPanel?: boolean;
}>(), {
  currentStep: 1,
  stepOptions: () => [0.1, 1, 10],
  currentFeedRate: 2000
});

const emit = defineEmits<{
  (e: 'update:step', value: number): void;
  (e: 'update:feedRate', value: number): void;
}>();

const stepGroups = props.jogPanel ? jogPanelStepGroups : createStepGroups();
const categoryStateMetric = stepGroups.metric;
const categoryStateImperial = stepGroups.imperial;

// Long press state
const LONG_PRESS_MS = 500;
const openDropdown = ref<number | null>(null);
const dropdownPosition = ref<'top' | 'bottom'>('bottom');
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let pressStartTime = 0;
let currentButtonEl: HTMLElement | null = null;

// Fraction display map for imperial values
const fractionDisplayMap: Record<number, string> = {
  0.015625: '1/64',
  0.03125: '1/32',
  0.0625: '1/16',
  0.125: '1/8',
  0.25: '1/4',
  0.5: '1/2',
  0.625: '5/8',
  0.75: '3/4'
};

// Get category index for a step value (value is already in display units)
const getCategoryForStep = (step: number): number => {
  const optionsMap = appStore.unitsPreference.value === 'imperial' ? expandedOptionsMapImperial : expandedOptionsMap;

  for (const [catIndex, options] of Object.entries(optionsMap)) {
    if (options.some(opt => approxEqual(opt, step))) {
      return Number(catIndex);
    }
  }
  return 1; // Default to medium
};

// Helper to compare floating point numbers with tolerance
const approxEqual = (a: number, b: number): boolean => {
  return Math.abs(a - b) < 0.0001;
};

// Find matching value in imperial options (handles floating point)
const findMatchingImperialValue = (displayStep: number): number | null => {
  for (const options of Object.values(expandedOptionsMapImperial)) {
    const match = options.find(opt => approxEqual(opt, displayStep));
    if (match !== undefined) return match;
  }
  return null;
};

// Check if current step belongs to a category (step is in display units)
const isStepInCategory = (step: number, categoryIndex: number): boolean => {
  const optionsMap = appStore.unitsPreference.value === 'imperial' ? expandedOptionsMapImperial : expandedOptionsMap;
  const options = optionsMap[categoryIndex];
  return options?.some(opt => approxEqual(opt, step)) ?? false;
};

// Check if a specific option matches current step (both in display units)
const isOptionActive = (opt: number, currentStep: number): boolean => {
  return approxEqual(opt, currentStep);
};

// Get expanded options for a category (returns values in display units)
const getExpandedOptions = (categoryIndex: number): number[] => {
  if (appStore.unitsPreference.value === 'imperial') {
    return expandedOptionsMapImperial[categoryIndex] ?? [];
  }
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
    const clickedCategory = props.stepOptions.indexOf(value);
    if (clickedCategory === -1) return;

    const isImperial = appStore.unitsPreference.value === 'imperial';
    const state = isImperial ? categoryStateImperial : categoryStateMetric;
    const saved = state[clickedCategory];

    // Emit display value directly - G20/G21 in jog command handles units
    emit('update:step', saved.step);
    nextTick(() => emit('update:feedRate', saved.feedRate));
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
    const clickedCategory = props.stepOptions.indexOf(value);
    if (clickedCategory === -1) return;

    const isImperial = appStore.unitsPreference.value === 'imperial';
    const state = isImperial ? categoryStateImperial : categoryStateMetric;
    const saved = state[clickedCategory];

    // Emit display value directly - G20/G21 in jog command handles units
    emit('update:step', saved.step);
    nextTick(() => emit('update:feedRate', saved.feedRate));
  }
};

// Select step from dropdown (value is in display units)
const selectStep = (displayValue: number) => {
  const isImperial = appStore.unitsPreference.value === 'imperial';
  const state = isImperial ? categoryStateImperial : categoryStateMetric;

  // Find category from the display value
  const optionsMap = isImperial ? expandedOptionsMapImperial : expandedOptionsMap;
  let category = 1;
  for (const [catIndex, options] of Object.entries(optionsMap)) {
    if (options.some(opt => approxEqual(opt, displayValue))) {
      category = Number(catIndex);
      break;
    }
  }

  state[category].step = displayValue;

  // Emit display value directly - G20/G21 in jog command handles units
  emit('update:step', displayValue);
  nextTick(() => emit('update:feedRate', state[category].feedRate));
  closeDropdown();
};

// Get current category based on current step
const currentCategory = computed(() => getCategoryForStep(props.currentStep));

// Get feed rate options for current category
const getCurrentFeedRateOptions = (): number[] => {
  const isImperial = appStore.unitsPreference.value === 'imperial';
  const options = isImperial ? feedRateOptionsByCategoryImperial : feedRateOptionsByCategory;
  return options[currentCategory.value] ?? options[1];
};

// Get the feed rate to display (from local state for current category)
const displayFeedRate = computed(() => {
  const isImperial = appStore.unitsPreference.value === 'imperial';
  const state = isImperial ? categoryStateImperial : categoryStateMetric;
  const options = isImperial ? feedRateOptionsByCategoryImperial : feedRateOptionsByCategory;
  return state[currentCategory.value]?.feedRate ?? options[currentCategory.value][0];
});

// Format imperial step with fraction support
const formatImperialStep = (inchValue: number): string => {
  // Check fractions with approximate comparison
  for (const [decimal, fraction] of Object.entries(fractionDisplayMap)) {
    if (approxEqual(inchValue, Number(decimal))) {
      return fraction;
    }
  }
  // Format decimal: use appropriate precision
  if (inchValue < 0.1) return inchValue.toFixed(3);
  if (inchValue < 1) return inchValue.toFixed(1);
  return Math.round(inchValue).toString();
};

// Format step size for button display - always show the saved value for this category
const formatButtonStepDisplay = (categoryIndex: number): string => {
  const isImperial = appStore.unitsPreference.value === 'imperial';
  const state = isImperial ? categoryStateImperial : categoryStateMetric;
  const displayValue = state[categoryIndex]?.step ?? props.stepOptions[categoryIndex];

  if (isImperial) {
    // Snap to matching option to avoid floating point display issues
    const matched = findMatchingImperialValue(displayValue);
    return formatImperialStep(matched ?? displayValue);
  }
  return formatStepSize(displayValue, 'metric');
};

// Format step size for dropdown options - show the actual value (in display units)
const formatOptionStepDisplay = (value: number): string => {
  if (appStore.unitsPreference.value === 'imperial') {
    return formatImperialStep(value);
  }
  return formatStepSize(value, 'metric');
};

const formatFeedRateDisplay = (value: number): string => {
  // Value is already in display units (mm/min for metric, in/min for imperial)
  return String(Math.round(value));
};

const handleFeedRateChange = (event: Event) => {
  const select = event.target as HTMLSelectElement;
  const newRate = Number(select.value);
  if (Number.isFinite(newRate) && newRate > 0) {
    const isImperial = appStore.unitsPreference.value === 'imperial';
    const state = isImperial ? categoryStateImperial : categoryStateMetric;
    state[currentCategory.value].feedRate = newRate;
    emit('update:feedRate', newRate);
  }
};

// Watch for unit preference changes and emit defaults
watch(() => appStore.unitsPreference.value, (newUnit) => {
  const state = newUnit === 'imperial' ? categoryStateImperial : categoryStateMetric;
  const defaultCategory = 1; // Group 1 default
  const defaultStep = state[defaultCategory].step;

  // Emit display value directly - G20/G21 in jog command handles units
  emit('update:step', defaultStep);
  emit('update:feedRate', state[defaultCategory].feedRate);
});

// Close dropdown on escape key
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && openDropdown.value !== null) {
    closeDropdown();
  }
};

// Handle keyboard shortcut: cycle through step groups
const handleStepCycle = () => {
  const isImperial = appStore.unitsPreference.value === 'imperial';
  const state = isImperial ? categoryStateImperial : categoryStateMetric;
  const nextCategory = (currentCategory.value + 1) % 3;
  const saved = state[nextCategory];
  // Emit display value directly - G20/G21 in jog command handles units
  emit('update:step', saved.step);
  emit('update:feedRate', saved.feedRate);
};

// Handle keyboard shortcut: set specific step group
const handleStepSet = (event: Event) => {
  const category = (event as CustomEvent).detail?.category;
  if (typeof category !== 'number' || category < 0 || category > 2) return;
  const isImperial = appStore.unitsPreference.value === 'imperial';
  const state = isImperial ? categoryStateImperial : categoryStateMetric;
  const saved = state[category];
  // Emit display value directly - G20/G21 in jog command handles units
  emit('update:step', saved.step);
  emit('update:feedRate', saved.feedRate);
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('jog-step-cycle', handleStepCycle);
  window.addEventListener('jog-step-set', handleStepSet);

  // If in imperial mode and current step doesn't match any option, emit default for group 1
  if (appStore.unitsPreference.value === 'imperial') {
    const hasMatch = Object.values(expandedOptionsMapImperial).some(
      options => options.some(opt => approxEqual(opt, props.currentStep))
    );
    if (!hasMatch) {
      const defaultStep = categoryStateImperial[1].step; // Group 1 default (0.1 inch)
      emit('update:step', defaultStep);
      emit('update:feedRate', categoryStateImperial[1].feedRate);
    }
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('jog-step-cycle', handleStepCycle);
  window.removeEventListener('jog-step-set', handleStepSet);
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
