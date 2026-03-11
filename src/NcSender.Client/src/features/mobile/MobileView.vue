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
  <div class="mobile-view" :class="{ 'view-disabled': viewDisabled }">
    <div class="mobile-container">
      <div class="mobile-card">
        <div class="mobile-groups" :class="orientationClass">
          <!-- Group 1: Jog Controls -->
          <div class="mobile-group jog-group">
            <!-- Step Controls -->
            <div class="step-controls-mobile">
              <StepControl
                :current-step="jogConfig.stepSize"
                :step-options="jogConfig.stepOptions"
                :current-feed-rate="feedRate"
                :feed-rate-options="feedRateOptions"
                :feed-rate-defaults="feedRateDefaults"
                @update:step="emit('update:stepSize', $event)"
                @update:feedRate="handleFeedRateUpdate"
              />
            </div>

            <!-- Jog Controls -->
            <div class="jog-controls-wrapper">
              <JogControls
                :current-step="jogConfig.stepSize"
                :feed-rate="feedRate"
                :disabled="motionControlsDisabled"
                custom-class="jog-controls-mobile"
                @center-click="sendSoftReset"
              />
            </div>
          </div>

          <!-- Group 2: Workspace Offset & Coolant -->
          <div class="mobile-group offset-group">
            <!-- Header -->
            <div class="offset-header">
              <h3>Workspace Offset</h3>
              <span class="hold-hint">HOLD TO ZERO</span>
            </div>

            <!-- Axis Cards (X, Y, Z) -->
            <div class="axis-cards">
              <div
                v-for="axis in ['x', 'y', 'z']"
                :key="axis"
                :class="['axis-card-mobile', { 'axis-disabled': axisControlsDisabled }]"
                @mousedown="startLongPress(axis, $event)"
                @mouseup="endLongPress(axis)"
                @mouseleave="cancelLongPress(axis)"
                @touchstart.prevent="startLongPress(axis, $event)"
                @touchend="endLongPress(axis)"
                @touchcancel="cancelLongPress(axis)"
              >
                <div class="press-progress" :style="{ width: `${pressState[axis]?.progress || 0}%` }"></div>
                <span class="axis-label-mobile">{{ axis.toUpperCase() }}</span>
                <div class="axis-coords">
                  <span class="coord-value">{{ formatCoordinate(axisValues[axis], appStore.unitsPreference.value) }}</span>
                  <span class="coord-separator">/</span>
                  <span class="coord-machine">{{ formatCoordinate(machineValues[axis], appStore.unitsPreference.value) }}</span>
                </div>
              </div>
            </div>

            <!-- Coolant Controls (Flood & Mist) -->
            <div class="coolant-footer">
              <div class="coolant-slider">
                <label class="switch">
                  <input type="checkbox" :checked="floodEnabled" @change="toggleFlood" :disabled="coolantDisabled">
                  <span class="slider"></span>
                </label>
                <span class="coolant-label">Flood</span>
              </div>

              <div class="coolant-slider">
                <label class="switch">
                  <input type="checkbox" :checked="mistEnabled" @change="toggleMist" :disabled="coolantDisabled">
                  <span class="slider"></span>
                </label>
                <span class="coolant-label">Mist</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, watch } from 'vue';
import JogControls from '@/features/jog/JogControls.vue';
import StepControl from '@/features/jog/StepControl.vue';
import { api } from '@/features/jog/api';
import { zeroAxis } from '@/features/status/api';
import { useJogStore } from '@/features/jog/store';
import { useAppStore } from '@/composables/use-app-store';
import { formatCoordinate } from '@/lib/units';

const props = defineProps<{
  status: {
    connected: boolean;
    machineCoords: Record<string, number>;
    workCoords: Record<string, number>;
    floodCoolant?: boolean;
    mistCoolant?: boolean;
  };
  jogConfig: {
    stepSize: number;
    stepOptions: number[];
    feedRate: number;
    feedRateOptions?: Record<number, number[]>;
    feedRateDefaults?: Record<number, number>;
  };
}>();

const emit = defineEmits<{
  (e: 'update:stepSize', value: number): void;
  (e: 'update:feedRate', value: number): void;
}>();

const store = useJogStore();
const appStore = useAppStore();

const feedRateOptions = computed(() => props.jogConfig.feedRateOptions ?? {
  0.1: [300, 400, 500, 700, 1000],
  1: [1000, 2000, 3000, 4000, 5000],
  10: [6000, 7000, 8000, 9000, 10000]
});
const feedRateDefaults = computed(() => props.jogConfig.feedRateDefaults ?? {
  0.1: 500,
  1: 3000,
  10: 8000
});

const resolveFeedRate = (): number => {
  const provided = Number(props.jogConfig.feedRate);
  if (Number.isFinite(provided) && provided > 0) {
    return provided;
  }

  const defaultRate = feedRateDefaults.value[props.jogConfig.stepSize];
  if (Number.isFinite(defaultRate) && defaultRate > 0) {
    return defaultRate;
  }

  const fallbackOption = feedRateOptions.value[props.jogConfig.stepSize]?.[0];
  if (Number.isFinite(fallbackOption) && fallbackOption > 0) {
    return fallbackOption;
  }

  return 500;
};

const feedRate = ref(resolveFeedRate());
emit('update:feedRate', feedRate.value);

const handleFeedRateUpdate = (newRate: number) => {
  feedRate.value = newRate;
  emit('update:feedRate', newRate);
};

watch(() => props.jogConfig.stepSize, (newStepSize) => {
  const defaultRate = feedRateDefaults.value[newStepSize];
  const fallbackOption = feedRateOptions.value[newStepSize]?.[0];
  const resolved = Number.isFinite(defaultRate) && defaultRate > 0
    ? defaultRate
    : (Number.isFinite(fallbackOption) && fallbackOption > 0 ? fallbackOption : 500);

  if (Math.abs(resolved - feedRate.value) < 0.0001) {
    return;
  }

  feedRate.value = resolved;
  emit('update:feedRate', resolved);
});

watch(
  () => props.jogConfig.feedRate,
  (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    if (Math.abs(parsed - feedRate.value) < 0.0001) {
      return;
    }
    feedRate.value = parsed;
  }
);

const isHoming = computed(() => (store.senderStatus.value || '').toLowerCase() === 'homing');
const isJobRunning = computed(() => appStore.isJobRunning.value);
const senderStatus = computed(() => (store.senderStatus.value || '').toLowerCase());

const viewDisabled = computed(() =>
  !store.isConnected.value ||
  senderStatus.value === 'connecting'
);

const motionControlsDisabled = computed(() =>
  !store.isConnected.value ||
  (store.homingCycle.value > 0 && !store.isHomed.value) ||
  isHoming.value ||
  store.isProbing.value ||
  (isJobRunning.value && senderStatus.value !== 'idle')
);

const axisControlsDisabled = computed(() =>
  viewDisabled.value ||
  isJobRunning.value ||
  (senderStatus.value !== 'idle' && !senderStatus.value.includes('jog'))
);

const coolantDisabled = computed(() =>
  viewDisabled.value ||
  (senderStatus.value !== 'idle' && !senderStatus.value.includes('jog'))
);

// Track window dimensions for orientation detection
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 375);
const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 667);

const orientationClass = computed(() => {
  return viewportWidth.value > viewportHeight.value ? 'landscape' : 'portrait';
});

const axisValues = computed(() => ({
  x: Number(props.status.workCoords.x ?? 0),
  y: Number(props.status.workCoords.y ?? 0),
  z: Number(props.status.workCoords.z ?? 0)
}));

const machineValues = computed(() => ({
  x: Number(props.status.machineCoords.x ?? 0),
  y: Number(props.status.machineCoords.y ?? 0),
  z: Number(props.status.machineCoords.z ?? 0)
}));

const sendSoftReset = async () => {
  try {
    await api.sendCommandViaWebSocket({ command: '\x18' });
  } catch (error) {
    console.error('Failed to send soft reset:', error);
  }
};

type AxisKey = 'x' | 'y' | 'z';
const AXIS_ZERO_LONG_PRESS_MS = 750;

const pressState = reactive<Record<string, { start: number; progress: number; raf?: number; triggered: boolean; active: boolean }>>({});

const ensureAxisState = (axis: AxisKey) => {
  if (!pressState[axis]) {
    pressState[axis] = { start: 0, progress: 0, triggered: false, active: false };
  }
  return pressState[axis];
};

const startLongPress = (axis: AxisKey, _evt: Event) => {
  if (axisControlsDisabled.value) return;

  const state = ensureAxisState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.start = performance.now();
  state.progress = 0;
  state.triggered = false;
  state.active = true;

  const tick = () => {
    if (!state.active) return;
    const elapsed = performance.now() - state.start;
    const pct = Math.min(100, (elapsed / AXIS_ZERO_LONG_PRESS_MS) * 100);
    state.progress = pct;

    if (elapsed >= AXIS_ZERO_LONG_PRESS_MS && !state.triggered) {
      state.triggered = true;
      zeroAxis(axis.toUpperCase() as any).catch(() => {});
    }

    state.raf = requestAnimationFrame(tick);
  };

  state.raf = requestAnimationFrame(tick);
};

const endLongPress = (axis: AxisKey) => {
  const state = ensureAxisState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;
  state.active = false;

  if (!state.triggered) {
    state.progress = 0;
  } else {
    setTimeout(() => { state.progress = 0; state.triggered = false; }, 150);
  }
};

const cancelLongPress = (axis: AxisKey) => {
  const state = ensureAxisState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;
  state.active = false;
  state.progress = 0;
  state.triggered = false;
};

// Sync coolant state with server status
const floodEnabled = computed(() => props.status.floodCoolant ?? false);
const mistEnabled = computed(() => props.status.mistCoolant ?? false);

const toggleFlood = async () => {
  try {
    const command = floodEnabled.value ? 'M9' : 'M8';
    await api.sendCommandViaWebSocket({
      command,
      displayCommand: command
    });
  } catch (error) {
    console.error('Failed to toggle flood:', error);
  }
};

const toggleMist = async () => {
  try {
    const command = mistEnabled.value ? 'M9' : 'M7';
    await api.sendCommandViaWebSocket({
      command,
      displayCommand: command
    });
  } catch (error) {
    console.error('Failed to toggle mist:', error);
  }
};

const handleResize = () => {
  if (typeof window !== 'undefined') {
    viewportWidth.value = window.innerWidth;
    viewportHeight.value = window.innerHeight;
  }
};

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('orientationchange', handleResize);
  }

  ['x', 'y', 'z'].forEach((axis) => {
    const state = pressState[axis];
    if (state?.raf) cancelAnimationFrame(state.raf);
  });
});
</script>

<style scoped>
.mobile-view {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--color-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5px;
  box-sizing: border-box;
  touch-action: pan-y;
  z-index: 9999;
}

.view-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.mobile-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mobile-card {
  width: 100%;
  height: 100%;
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  box-shadow: var(--shadow-elevated);
  display: flex;
  flex-direction: column;
  padding: var(--gap-sm);
  box-sizing: border-box;
  overflow: hidden;
}

.mobile-groups {
  display: flex;
  gap: var(--gap-sm);
  width: 100%;
  height: 100%;
}

.mobile-groups.portrait {
  flex-direction: column;
}

.mobile-groups.landscape {
  flex-direction: row;
}

.mobile-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  min-height: 0;
}

.jog-group {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.step-controls-mobile {
  flex-shrink: 0;
}

.jog-controls-wrapper {
  flex: 1;
  display: flex;
  gap: var(--gap-xs);
  min-height: 0;
}

.jog-controls-mobile {
  flex: 1;
  min-width: 0;
}

.offset-group {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.offset-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.offset-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.hold-hint {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  font-style: italic;
  font-weight: 600;
}

.axis-cards {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.axis-card-mobile {
  flex: 1;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.axis-card-mobile:hover:not(.axis-disabled) {
  border-color: var(--color-accent);
}

.axis-card-mobile.axis-disabled {
  opacity: 0.6;
  pointer-events: none;
}

.press-progress {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, var(--color-accent) 0%, rgba(52,211,153,0.8) 100%);
  opacity: 0.18;
  pointer-events: none;
}

.axis-label-mobile {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--color-text-primary);
  min-width: 24px;
  position: relative;
  z-index: 1;
}

.axis-coords {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  font-size: 1rem;
  position: relative;
  z-index: 1;
}

.coord-value {
  font-weight: 700;
  color: var(--color-text-primary);
}

.coord-separator {
  color: var(--color-text-secondary);
  font-weight: 400;
}

.coord-machine {
  font-weight: 400;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.coolant-footer {
  display: flex;
  gap: var(--gap-sm);
  justify-content: center;
  flex-shrink: 0;
  padding-top: 8px;
}

.coolant-slider {
  display: flex;
  align-items: center;
  gap: 8px;
}

.coolant-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  transition: all 0.3s ease;
  border-radius: 13px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: all 0.3s ease;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

input:checked + .slider {
  background-color: var(--color-accent);
  border-color: var(--color-accent);
}

input:checked + .slider:before {
  transform: translateX(22px);
}

input:disabled + .slider {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (orientation: portrait) {
  .mobile-groups {
    flex-direction: column;
  }
}

@media (orientation: landscape) {
  .mobile-groups {
    flex-direction: row;
  }
}
</style>
