<template>
  <section class="card">
    <header class="card__header">
      <h2>Status</h2>
    </header>
    <div class="coords">
      <div class="axis-grid">
        <div v-for="(workValue, axis) in status.workCoords" :key="axis" class="axis-display" :class="{ disabled: axis === 'a' }">
          <span class="axis-label">{{ axis.toUpperCase() }}</span>
          <div class="coord-values">
            <div class="work-coord">{{ workValue.toFixed(3) }}</div>
            <div class="machine-coord">{{ status.machineCoords[axis]?.toFixed(3) || '0.000' }}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="metrics">
      <div class="metric-control">
        <div class="metric-header">
          <button @click="resetFeedOverride" class="control-btn control-btn--primary metric-btn" title="Reset to 100%">
            Feed ↻
          </button>
          <span class="value">{{ status.feedRate }} mm/min</span>
        </div>
        <div class="override-control">
          <span class="override-label">{{ feedOverride }}%</span>
          <input
            type="range"
            min="50"
            max="150"
            step="10"
            v-model="feedOverride"
            @mousedown="userInteracting = true"
            @mouseup="handleFeedOverrideComplete"
            @input="updateFeedOverride"
            class="override-slider"
          />
        </div>
      </div>
      <div class="metric-control">
        <div class="metric-header">
          <button @click="resetSpindleOverride" class="control-btn control-btn--primary metric-btn" title="Reset to 100%">
            Spindle ↻
          </button>
          <span class="value">{{ status.spindleRpm }} rpm</span>
        </div>
        <div class="override-control">
          <span class="override-label">{{ spindleOverride }}%</span>
          <input
            type="range"
            min="50"
            max="150"
            step="10"
            v-model="spindleOverride"
            @mousedown="userInteracting = true"
            @mouseup="handleSpindleOverrideComplete"
            @input="updateSpindleOverride"
            class="override-slider"
          />
        </div>
      </div>
    </div>
    <div v-if="status.alarms.length" class="alarms">
      <h3>Alarms</h3>
      <ul>
        <li v-for="alarm in status.alarms" :key="alarm">{{ alarm }}</li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../../lib/api.js';

const props = defineProps<{
  status: {
    connected: boolean;
    machineCoords: Record<string, number>;
    workCoords: Record<string, number>;
    alarms: string[];
    feedRate: number;
    spindleRpm: number;
    feedrateOverride: number;
    rapidOverride: number;
    spindleOverride: number;
  };
}>();

// Override percentages (100% = normal speed)
const feedOverride = ref(100);
const spindleOverride = ref(100);

// Track previous values to calculate deltas
const previousFeedOverride = ref(100);
const previousSpindleOverride = ref(100);

// Track if user is actively interacting with sliders
const userInteracting = ref(false);
const feedUpdateTimeout = ref(null);
const spindleUpdateTimeout = ref(null);

// Sync slider values with status props (only when user is not interacting)
watch(() => props.status.feedrateOverride, (newValue) => {
  if (!userInteracting.value && !feedUpdateTimeout.value) {
    feedOverride.value = newValue;
    previousFeedOverride.value = newValue;
  }
}, { immediate: true });

watch(() => props.status.spindleOverride, (newValue) => {
  if (!userInteracting.value && !spindleUpdateTimeout.value) {
    spindleOverride.value = newValue;
    previousSpindleOverride.value = newValue;
  }
}, { immediate: true });

const updateFeedOverride = () => {
  // Clear any existing timeout
  if (feedUpdateTimeout.value) {
    clearTimeout(feedUpdateTimeout.value);
  }

  // Debounce the update to prevent rapid-fire commands
  feedUpdateTimeout.value = setTimeout(() => {
    const target = feedOverride.value;
    const previous = previousFeedOverride.value;
    const diff = target - previous;

    if (diff === 0) {
      feedUpdateTimeout.value = null;
      return;
    }

    if (diff > 0) {
      // Increase - use +10% command
      const steps = Math.abs(diff) / 10;
      for (let i = 0; i < steps; i++) {
        api.sendCommand('\x91'); // Feed rate override +10%
      }
    } else {
      // Decrease - use -10% command
      const steps = Math.abs(diff) / 10;
      for (let i = 0; i < steps; i++) {
        api.sendCommand('\x92'); // Feed rate override -10%
      }
    }

    previousFeedOverride.value = target;
    feedUpdateTimeout.value = null;
  }, 100); // 100ms debounce
};

const handleFeedOverrideComplete = () => {
  userInteracting.value = false;
  // Update previous value to current after interaction is complete
  previousFeedOverride.value = feedOverride.value;
};

const resetFeedOverride = () => {
  api.sendCommand('\x90'); // Feed rate override reset
  feedOverride.value = 100;
  previousFeedOverride.value = 100;
};

const updateSpindleOverride = () => {
  // Clear any existing timeout
  if (spindleUpdateTimeout.value) {
    clearTimeout(spindleUpdateTimeout.value);
  }

  // Debounce the update to prevent rapid-fire commands
  spindleUpdateTimeout.value = setTimeout(() => {
    const target = spindleOverride.value;
    const previous = previousSpindleOverride.value;
    const diff = target - previous;

    if (diff === 0) {
      spindleUpdateTimeout.value = null;
      return;
    }

    if (diff > 0) {
      // Increase - use +10% command
      const steps = Math.abs(diff) / 10;
      for (let i = 0; i < steps; i++) {
        api.sendCommand('\x9A'); // Spindle speed override +10%
      }
    } else {
      // Decrease - use -10% command
      const steps = Math.abs(diff) / 10;
      for (let i = 0; i < steps; i++) {
        api.sendCommand('\x9B'); // Spindle speed override -10%
      }
    }

    previousSpindleOverride.value = target;
    spindleUpdateTimeout.value = null;
  }, 100); // 100ms debounce
};

const handleSpindleOverrideComplete = () => {
  userInteracting.value = false;
  // Update previous value to current after interaction is complete
  previousSpindleOverride.value = spindleOverride.value;
};

const resetSpindleOverride = () => {
  api.sendCommand('\x99'); // Spindle speed override reset
  spindleOverride.value = 100;
  previousSpindleOverride.value = 100;
};
</script>

<style scoped>
.card {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  padding: var(--gap-sm);
  box-shadow: var(--shadow-elevated);
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h2, h3 {
  margin: 0;
  font-size: 1.1rem;
}

.coords {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.axis-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--gap-sm);
}

.axis-display {
  background: var(--color-surface-muted);
  padding: 8px;
  border-radius: var(--radius-small);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.axis-label {
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.coord-values {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.work-coord {
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.1;
}

.machine-coord {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  line-height: 1.2;
}

.axis-display.disabled {
  background: var(--color-surface);
  opacity: 0.5;
}

.axis-display.disabled .axis-label,
.axis-display.disabled .work-coord,
.axis-display.disabled .machine-coord {
  color: var(--color-text-secondary);
}

.metrics {
  display: flex;
  gap: var(--gap-sm);
}

.metric-control {
  flex: 1;
  padding: 8px 12px;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.metric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.control-btn {
  border: none;
  border-radius: var(--radius-medium);
  padding: 12px 20px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
}

.control-btn:hover {
  transform: translateY(-1px);
}

.control-btn:active {
  transform: translateY(0);
}

.control-btn--primary {
  background: var(--gradient-accent);
  color: white;
  box-shadow: 0 4px 12px -4px rgba(26, 188, 156, 0.5);
}

.control-btn--primary:hover {
  box-shadow: 0 6px 16px -6px rgba(26, 188, 156, 0.6);
}

.metric-btn {
  border-radius: 8px;
  padding: 1px;
  font-size: 0.75rem;
  width: 80px;
  min-height: 30px;
  justify-content: center;
}

.override-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.override-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-accent);
  min-width: 35px;
  text-align: center;
}

.override-slider {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  outline: none;
  background: var(--color-border);
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
}

.override-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.override-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

/* Center mark styling */
.override-slider {
  background: linear-gradient(
    to right,
    var(--color-border) 0%,
    var(--color-border) 49%,
    var(--color-accent) 49%,
    var(--color-accent) 51%,
    var(--color-border) 51%,
    var(--color-border) 100%
  );
}

.label {
  display: block;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.value {
  font-size: 1rem;
  font-weight: 600;
}

.alarms {
  border-top: 1px solid var(--color-border);
  padding-top: var(--gap-xs);
}

@media (max-width: 959px) {
  .metrics {
    flex-direction: column;
  }
}
</style>
