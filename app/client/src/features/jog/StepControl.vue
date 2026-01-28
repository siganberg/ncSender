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
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useAppStore } from '@/composables/use-app-store';
import { formatStepSize, formatJogFeedRate } from '@/lib/units';

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
  0: [0.01, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],  // Small steps
  1: [1, 2, 3, 4, 5, 6, 7, 8, 9],                                   // Medium steps
  2: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300]  // Large steps
};

// Expanded options for imperial mode (in inches)
const expandedOptionsMapImperial: Record<number, number[]> = {
  0: [0.001, 0.005, 0.01, 0.015625, 0.02, 0.03125, 0.03, 0.04, 0.05, 0.06, 0.0625, 0.07, 0.08, 0.09],
  1: [0.1, 0.125, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.625, 0.7, 0.75, 0.8, 0.9],
  2: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
};

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

// Per-category persistent state for metric (step in mm, feed rate in mm/min)
const categoryStateMetric = reactive<Record<number, { step: number; feedRate: number }>>({
  0: { step: 0.1, feedRate: 500 },
  1: { step: 1, feedRate: 3000 },
  2: { step: 10, feedRate: 6000 }
});

// Per-category persistent state for imperial (step in inches, feed rate in mm/min)
const categoryStateImperial = reactive<Record<number, { step: number; feedRate: number }>>({
  0: { step: 0.01, feedRate: 500 },
  1: { step: 0.1, feedRate: 3000 },
  2: { step: 1, feedRate: 6000 }
});

// Convert mm to inches
const mmToInches = (mm: number): number => mm / 25.4;

// Convert inches to mm
const inchesToMm = (inches: number): number => inches * 25.4;

// Get the current step in display units (inches for imperial, mm for metric)
const getStepInDisplayUnits = (stepMm: number): number => {
  if (appStore.unitsPreference.value === 'imperial') {
    return mmToInches(stepMm);
  }
  return stepMm;
};

// Get category index for a step value (expects value in display units)
const getCategoryForStep = (stepMm: number): number => {
  const displayStep = getStepInDisplayUnits(stepMm);
  const optionsMap = appStore.unitsPreference.value === 'imperial' ? expandedOptionsMapImperial : expandedOptionsMap;

  for (const [catIndex, options] of Object.entries(optionsMap)) {
    if (options.some(opt => approxEqual(opt, displayStep))) {
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

// Check if current step (in mm) belongs to a category
const isStepInCategory = (stepMm: number, categoryIndex: number): boolean => {
  const displayStep = getStepInDisplayUnits(stepMm);
  const optionsMap = appStore.unitsPreference.value === 'imperial' ? expandedOptionsMapImperial : expandedOptionsMap;
  const options = optionsMap[categoryIndex];
  return options?.some(opt => approxEqual(opt, displayStep)) ?? false;
};

// Check if a specific option (in display units) matches current step (in mm)
const isOptionActive = (opt: number, currentStepMm: number): boolean => {
  const displayStep = getStepInDisplayUnits(currentStepMm);
  return approxEqual(opt, displayStep);
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

    // Emit in mm (convert if imperial)
    const mmValue = isImperial ? inchesToMm(saved.step) : saved.step;
    emit('update:step', mmValue);
    // Always emit feed rate to keep parent in sync
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

    // Emit in mm (convert if imperial)
    const mmValue = isImperial ? inchesToMm(saved.step) : saved.step;
    emit('update:step', mmValue);
    // Always emit feed rate to keep parent in sync
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

  // Emit in mm (convert if imperial)
  const mmValue = isImperial ? inchesToMm(displayValue) : displayValue;
  emit('update:step', mmValue);
  // Always emit feed rate to keep parent in sync
  nextTick(() => emit('update:feedRate', state[category].feedRate));
  closeDropdown();
};

// Feed rate options per category (0=small, 1=medium, 2=large)
const feedRateOptionsByCategory = [
  [300, 400, 500, 700, 1000],
  [1000, 2000, 3000, 4000, 5000],
  [6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000]
];

// Get current category based on current step
const currentCategory = computed(() => getCategoryForStep(props.currentStep));

// Get feed rate options for current category
const getCurrentFeedRateOptions = (): number[] => {
  return feedRateOptionsByCategory[currentCategory.value] ?? feedRateOptionsByCategory[1];
};

// Get the feed rate to display (from local state for current category)
const displayFeedRate = computed(() => {
  const isImperial = appStore.unitsPreference.value === 'imperial';
  const state = isImperial ? categoryStateImperial : categoryStateMetric;
  return state[currentCategory.value]?.feedRate ?? feedRateOptionsByCategory[currentCategory.value][0];
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

const formatFeedRateDisplay = (mmPerMin: number): string => {
  return formatJogFeedRate(mmPerMin, appStore.unitsPreference.value);
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
  const mmValue = newUnit === 'imperial' ? inchesToMm(defaultStep) : defaultStep;

  // Always emit step and feed rate when units change to ensure parent is in sync
  emit('update:step', mmValue);
  emit('update:feedRate', state[defaultCategory].feedRate);
});

// Close dropdown on escape key
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && openDropdown.value !== null) {
    closeDropdown();
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);

  // If in imperial mode and current step doesn't match any option, emit default for group 2
  if (appStore.unitsPreference.value === 'imperial') {
    const displayStep = getStepInDisplayUnits(props.currentStep);
    const hasMatch = Object.values(expandedOptionsMapImperial).some(
      options => options.some(opt => approxEqual(opt, displayStep))
    );
    if (!hasMatch) {
      const defaultStep = categoryStateImperial[1].step; // Group 1 default (0.1 inch)
      emit('update:step', inchesToMm(defaultStep));
      emit('update:feedRate', categoryStateImperial[1].feedRate);
    }
  }
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
