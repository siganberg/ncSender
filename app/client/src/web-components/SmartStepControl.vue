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
const currentFeedRate = ref(2000);

// Emit custom events for auto-syncing
const handleStepUpdate = (value: number) => {
  currentStep.value = value;

  // Dispatch custom event that other components can listen to
  window.dispatchEvent(new CustomEvent('nc:step-changed', {
    detail: { step: value }
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
