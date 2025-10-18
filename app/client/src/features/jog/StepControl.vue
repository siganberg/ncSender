<template>
  <div class="step-control">
    <span class="step-label">Step ({{ getDistanceUnitLabel(appStore.unitsPreference.value) }})</span>
    <button
      v-for="value in stepOptions"
      :key="value"
      :class="['chip', { active: value === currentStep }]"
      @click="$emit('update:step', value)"
    >
      {{ formatStepSize(value) }}
    </button>
    <span class="feed-rate-label">Feed ({{ getFeedRateUnitLabel(appStore.unitsPreference.value) }})</span>
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
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAppStore } from '@/composables/use-app-store';
import { getDistanceUnitLabel, getFeedRateUnitLabel, mmToInches } from '@/lib/units';

const appStore = useAppStore();

const props = defineProps<{
  currentStep: number;
  stepOptions: number[];
  currentFeedRate: number;
  feedRateOptions?: Record<number, number[]>;
  feedRateDefaults?: Record<number, number>;
}>();

const emit = defineEmits<{
  (e: 'update:step', value: number): void;
  (e: 'update:feedRate', value: number): void;
}>();

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
  // Try to find by step value first (for compatibility with JogPanel)
  if (feedRateOptionsMap.value[props.currentStep]) {
    return feedRateOptionsMap.value[props.currentStep];
  }

  // Fall back to using step index (for Probe with imperial units)
  const stepIndex = props.stepOptions.indexOf(props.currentStep);
  if (stepIndex >= 0 && stepIndex < defaultFeedRateOptionsByIndex.length) {
    return defaultFeedRateOptionsByIndex[stepIndex];
  }

  // Ultimate fallback
  return [500, 1000, 3000, 5000];
};

const formatStepSize = (mmValue: number): string => {
  const units = appStore.unitsPreference.value;
  if (units === 'imperial') {
    const inches = mmToInches(mmValue);
    return (Math.round(inches * 1000) / 1000).toFixed(3);
  }
  return mmValue.toString();
};

const roundFeedRate = (feedRateInTargetUnits: number, units: string): number => {
  if (units === 'imperial') {
    return Math.round(feedRateInTargetUnits / 10) * 10;
  }
  return Math.round(feedRateInTargetUnits);
};

const formatFeedRateDisplay = (mmPerMin: number): string => {
  const units = appStore.unitsPreference.value;
  const converted = units === 'imperial' ? mmToInches(mmPerMin) : mmPerMin;
  return roundFeedRate(converted, units).toString();
};

const handleFeedRateChange = (event: Event) => {
  const select = event.target as HTMLSelectElement;
  const newRate = Number(select.value);
  if (Number.isFinite(newRate) && newRate > 0) {
    emit('update:feedRate', newRate);
  }
};
</script>

<style scoped>
.step-control {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
}

.chip {
  border: none;
  border-radius: 999px;
  padding: 6px 12px;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  cursor: pointer;
  min-width: 50px;
  width: 60px;
  transition: all 0.2s ease;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.chip.active {
  background: var(--gradient-accent);
  color: #fff;
}

.step-label,
.feed-rate-label {
  font-size: 0.85rem;
  color: var(--color-text-primary);
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
