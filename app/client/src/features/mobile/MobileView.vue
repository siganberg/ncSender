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

            <!-- Jog Controls + Home Button -->
            <div class="jog-controls-wrapper">
              <JogControls
                :current-step="jogConfig.stepSize"
                :feed-rate="feedRate"
                :disabled="motionControlsDisabled"
                custom-class="jog-controls-mobile"
                @center-click="sendSoftReset"
              />

              <!-- Home Button -->
              <button
                :class="['home-button-mobile', { 'is-holding': homePress.active, 'needs-homing': !store.isHomed.value, 'long-press-triggered': homePress.triggered }]"
                :disabled="isHoming"
                @mousedown="startHomePress($event)"
                @mouseup="endHomePress()"
                @mouseleave="cancelHomePress()"
                @touchstart="startHomePress($event)"
                @touchend="endHomePress()"
                @touchcancel="cancelHomePress()"
              >
                <div class="long-press-indicator" :style="{ width: `${homePress.progress || 0}%` }"></div>
                <svg class="home-icon" viewBox="0 0 460.298 460.297" xmlns="http://www.w3.org/2000/svg">
                  <path fill="currentColor" d="M230.149,120.939L65.986,256.274c0,0.191-0.048,0.472-0.144,0.855c-0.094,0.38-0.144,0.656-0.144,0.852v137.041c0,4.948,1.809,9.236,5.426,12.847c3.616,3.613,7.898,5.431,12.847,5.431h109.63V303.664h73.097v109.64h109.629c4.948,0,9.236-1.814,12.847-5.435c3.617-3.607,5.432-7.898,5.432-12.847V257.981c0-0.76-0.104-1.334-0.288-1.707L230.149,120.939z"/>
                  <path fill="currentColor" d="M457.122,225.438L394.6,173.476V56.989c0-2.663-0.856-4.853-2.574-6.567c-1.704-1.712-3.894-2.568-6.563-2.568h-54.816c-2.666,0-4.855,0.856-6.57,2.568c-1.711,1.714-2.566,3.905-2.566,6.567v55.673l-69.662-58.245c-6.084-4.949-13.318-7.423-21.694-7.423c-8.375,0-15.608,2.474-21.698,7.423L3.172,225.438c-1.903,1.52-2.946,3.566-3.14,6.136c-0.193,2.568,0.472,4.811,1.997,6.713l17.701,21.128c1.525,1.712,3.521,2.759,5.996,3.142c2.285,0.192,4.57-0.476,6.855-1.998L230.149,95.817l197.57,164.741c1.526,1.328,3.521,1.991,5.996,1.991h0.858c2.471-0.376,4.463-1.43,5.996-3.138l17.703-21.125c1.522-1.906,2.189-4.145,1.991-6.716C460.068,229.007,459.021,226.961,457.122,225.438z"/>
                </svg>
              </button>
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
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue';
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

const feedRate = ref(props.jogConfig.feedRate);
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

const handleFeedRateUpdate = (newRate: number) => {
  feedRate.value = newRate;
  emit('update:feedRate', newRate);
};

const isHoming = computed(() => (store.senderStatus.value || '').toLowerCase() === 'homing');
const isJobRunning = computed(() => appStore.isJobRunning.value);
const senderStatus = computed(() => (store.senderStatus.value || '').toLowerCase());

const viewDisabled = computed(() =>
  !store.isConnected.value ||
  senderStatus.value === 'connecting'
);

const motionControlsDisabled = computed(() =>
  !store.isConnected.value ||
  !store.isHomed.value ||
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
    await api.sendCommandViaWebSocket({ command: '\x18', displayCommand: 'Soft Reset' });
  } catch (error) {
    console.error('Failed to send soft reset:', error);
  }
};

const LONG_PRESS_MS = 1500;

const homePress = reactive({ start: 0, progress: 0, raf: undefined as number | undefined, triggered: false, active: false });

const startHomePress = (evt: Event) => {
  if (isHoming.value) return;
  evt.preventDefault();

  if (homePress.raf) cancelAnimationFrame(homePress.raf);
  homePress.start = performance.now();
  homePress.progress = 0;
  homePress.triggered = false;
  homePress.active = true;

  const tick = () => {
    if (!homePress.active) return;
    const elapsed = performance.now() - homePress.start;
    const pct = Math.min(100, (elapsed / LONG_PRESS_MS) * 100);
    homePress.progress = pct;

    if (elapsed >= LONG_PRESS_MS && !homePress.triggered) {
      homePress.triggered = true;
      api.sendCommandViaWebSocket({ command: '$H', displayCommand: '$H' }).catch(() => {});
    }

    homePress.raf = requestAnimationFrame(tick);
  };

  homePress.raf = requestAnimationFrame(tick);
};

const endHomePress = () => {
  if (homePress.raf) cancelAnimationFrame(homePress.raf);
  homePress.raf = undefined;
  homePress.active = false;

  if (!homePress.triggered) {
    homePress.progress = 0;
  } else {
    setTimeout(() => { homePress.progress = 0; homePress.triggered = false; }, 150);
  }
};

const cancelHomePress = () => {
  if (homePress.raf) cancelAnimationFrame(homePress.raf);
  homePress.raf = undefined;
  homePress.active = false;
  homePress.progress = 0;
  homePress.triggered = false;
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
  if (axisControlsDisabled.value || !store.isHomed.value) return;

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

  if (homePress.raf) cancelAnimationFrame(homePress.raf);
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

.home-button-mobile {
  width: 60px;
  min-width: 60px;
  flex-shrink: 0;
  border: 2px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  padding: 0;
}

.home-button-mobile:hover {
  border-color: var(--color-accent);
}

.home-button-mobile.needs-homing {
  animation: home-glow 2s ease-in-out infinite;
}

@keyframes home-glow {
  0%, 100% { box-shadow: 0 0 0 rgba(26, 188, 156, 0); }
  50% { box-shadow: 0 0 16px rgba(26, 188, 156, 0.6); }
}

.home-button-mobile.long-press-triggered {
  background: var(--color-accent);
  border-color: var(--color-accent);
}

.home-button-mobile.long-press-triggered .home-icon {
  color: white;
}

.home-icon {
  width: 32px;
  height: 32px;
  color: var(--color-text-primary);
  position: relative;
  z-index: 1;
}

.long-press-indicator {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, var(--color-accent) 0%, rgba(52,211,153,0.8) 100%);
  opacity: 0.22;
  pointer-events: none;
  transition: width 0.05s linear;
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
