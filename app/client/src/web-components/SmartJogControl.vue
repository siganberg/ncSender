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

<style>
/* Unscoped styles for nc-jog-control custom element */
nc-jog-control .nc-jog-control-wrapper {
  width: 100%;
  height: 180px;
  display: block;
}

/* Button styling */
nc-jog-control button,
nc-jog-control .jog-btn {
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
}

nc-jog-control button:hover,
nc-jog-control .jog-btn:hover {
  border-color: var(--color-accent);
  background: var(--color-surface-muted);
}

nc-jog-control button:active,
nc-jog-control .jog-btn:active,
nc-jog-control .jog-btn.pressed {
  background: var(--color-accent);
  color: white;
}

/* Center button - transparent with red circle */
nc-jog-control .jog-center {
  border: 2px solid #ff6b6b;
  background: var(--color-surface);
  border-radius: 50%;
}

nc-jog-control .jog-center:hover {
  background: rgba(255, 107, 107, 0.1);
  border-color: #ff4444;
}

nc-jog-control .jog-center:active {
  background: rgba(255, 107, 107, 0.2);
}

nc-jog-control .jog-center::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 6px;
  height: 6px;
  background: #ff6b6b;
  border-radius: 50%;
}

/* Z button layout */
nc-jog-control .jog-z {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 60px;
  height: 100%;
}

nc-jog-control .jog-z-btn,
nc-jog-control .jog-z button {
  flex: 1;
  font-weight: bold;
  min-height: 0;
}

/* Grid layout */
nc-jog-control .jog-grid {
  display: flex;
  gap: 8px;
  align-items: stretch;
  justify-content: center;
  height: 180px;
}

nc-jog-control .jog-xy {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 4px;
  width: 180px;
  height: 180px;
}
</style>
