<template>
  <div class="nc-jog-control-wrapper">
    <JogControls
      :current-step="currentStep"
      :feed-rate="feedRate"
      :custom-class="customClass"
      :disabled="disabled"
      @center-click="handleCenterClick"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import JogControls from '../features/jog/JogControls.vue';

// Auto-configure with sensible defaults
const currentStep = ref(1);
const feedRate = ref(2000);
const customClass = ref('jog-controls-probe');
const disabled = ref(false);

const handleCenterClick = () => {
  // Dispatch custom event for soft reset
  window.dispatchEvent(new CustomEvent('nc:soft-reset'));
};

// Listen for updates from StepControl
onMounted(() => {
  window.addEventListener('nc:step-changed', ((e: CustomEvent) => {
    currentStep.value = e.detail.step;
  }) as EventListener);

  window.addEventListener('nc:feed-rate-changed', ((e: CustomEvent) => {
    feedRate.value = e.detail.feedRate;
  }) as EventListener);
});
</script>
