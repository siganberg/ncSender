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
  <div class="nc-step-control-wrapper">
    <StepControl
      :current-step="currentStep"
      :step-options="stepOptions"
      :current-feed-rate="currentFeedRate"
      @update:step="handleStepUpdate"
      @update:feedRate="handleFeedRateUpdate"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import StepControl from '../features/jog/StepControl.vue';

// Auto-configure with sensible defaults
const currentStep = ref(1);
const stepOptions = ref([0.1, 1, 10]);
const currentFeedRate = ref(3000);

// Feed rate defaults per step (middle value of each range)
const feedRateDefaults: Record<number, number> = {
  0.1: 500,   // Small step -> 500 mm/min (middle of [300, 400, 500, 700, 1000])
  1: 3000,    // Medium step -> 3000 mm/min (middle of [1000, 2000, 3000, 4000, 5000])
  10: 8000    // Large step -> 8000 mm/min (middle of [6000, 7000, 8000, 9000, 10000])
};

// Emit custom events for auto-syncing
const handleStepUpdate = (value: number) => {
  currentStep.value = value;

  // Auto-select default feed rate for this step
  const defaultFeedRate = feedRateDefaults[value] || 2000;
  currentFeedRate.value = defaultFeedRate;

  // Dispatch events that other components can listen to
  window.dispatchEvent(new CustomEvent('nc:step-changed', {
    detail: { step: value }
  }));

  window.dispatchEvent(new CustomEvent('nc:feed-rate-changed', {
    detail: { feedRate: defaultFeedRate }
  }));
};

const handleFeedRateUpdate = (value: number) => {
  currentFeedRate.value = value;

  // Dispatch custom event that other components can listen to
  window.dispatchEvent(new CustomEvent('nc:feed-rate-changed', {
    detail: { feedRate: value }
  }));
};

// Listen for updates from other components
onMounted(() => {
  window.addEventListener('nc:step-changed', ((e: CustomEvent) => {
    currentStep.value = e.detail.step;
  }) as EventListener);

  window.addEventListener('nc:feed-rate-changed', ((e: CustomEvent) => {
    currentFeedRate.value = e.detail.feedRate;
  }) as EventListener);
});
</script>
