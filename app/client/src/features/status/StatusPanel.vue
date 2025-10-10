<template>
  <section class="card status-card" :class="{ 'card-disabled': coordZeroingDisabled }">
    <div class="status-hint">Press and hold an axis card to zero it at the current position</div>
    <div class="coords">
      <!-- Group X and Y with a border and a join indicator -->
      <div class="axis-group xy-group">
        <!-- X Card -->
        <div
          class="axis-display"
          @mousedown="startLongPress('x', $event)"
          @mouseup="endLongPress('x')"
          @mouseleave="cancelLongPress('x')"
          @touchstart.prevent="startLongPress('x', $event)"
          @touchend="endLongPress('x')"
          @touchcancel="cancelLongPress('x')"
        >
          <div class="press-progress" :style="{ width: `${pressState['x']?.progress || 0}%` }"></div>
          <span class="axis-label">X</span>
          <div class="coord-values">
            <div class="work-coord">{{ axisValues.x.toFixed(3) }}</div>
            <div class="machine-coord">{{ machineValues.x.toFixed(3) }}</div>
          </div>
        </div>

        <!-- XY Join Indicator -->
        <div
          :class="['axis-link', { active: (pressState['xy']?.progress || 0) > 0 }]"
          title="Zero X and Y (G10 L20 X0 Y0)"
          @mousedown="startLongPress('xy', $event)"
          @mouseup="endLongPress('xy')"
          @mouseleave="cancelLongPress('xy')"
          @touchstart.prevent="startLongPress('xy', $event)"
          @touchend="endLongPress('xy')"
          @touchcancel="cancelLongPress('xy')"
        >
          <span class="link-label">XY</span>
        </div>

        <!-- Y Card -->
        <div
          class="axis-display"
          @mousedown="startLongPress('y', $event)"
          @mouseup="endLongPress('y')"
          @mouseleave="cancelLongPress('y')"
          @touchstart.prevent="startLongPress('y', $event)"
          @touchend="endLongPress('y')"
          @touchcancel="cancelLongPress('y')"
        >
          <div class="press-progress" :style="{ width: `${pressState['y']?.progress || 0}%` }"></div>
          <span class="axis-label">Y</span>
          <div class="coord-values">
            <div class="work-coord">{{ axisValues.y.toFixed(3) }}</div>
            <div class="machine-coord">{{ machineValues.y.toFixed(3) }}</div>
          </div>
        </div>
      </div>

      <!-- Other axes (e.g., Z) -->
      <div class="axis-grid">
        <div
          v-for="axis in remainingAxes"
          :key="axis"
          class="axis-display"
          @mousedown="startLongPress(axis, $event)"
          @mouseup="endLongPress(axis)"
          @mouseleave="cancelLongPress(axis)"
          @touchstart.prevent="startLongPress(axis, $event)"
          @touchend="endLongPress(axis)"
          @touchcancel="cancelLongPress(axis)"
        >
          <div class="press-progress" :style="{ width: `${(pressState[axis]?.progress || 0)}%` }"></div>
          <span class="axis-label">{{ axis.toUpperCase() }}</span>
          <div class="coord-values">
            <div class="work-coord">{{ axisValues[axis].toFixed(3) }}</div>
            <div class="machine-coord">{{ machineValues[axis].toFixed(3) }}</div>
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
import { ref, watch, computed, reactive, onMounted, onUnmounted } from 'vue';
import { api, sendRealtime, REALTIME, zeroAxis, zeroXY } from './api';
import { useStatusStore } from './store';
import { useAppStore } from '../../composables/use-app-store';

const store = useStatusStore();
const appStore = useAppStore();
const { isJobRunning } = appStore;

// Computed to check if coordinate zeroing should be disabled (not connected, not homed, or homing)
const isHoming = computed(() => (store.senderStatus.value || '').toLowerCase() === 'homing');
const coordZeroingDisabled = computed(() => !store.isConnected.value || !store.isHomed.value || isHoming.value || store.isProbing.value || isJobRunning.value);

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

// Filter out the A axis from work coordinates
const filteredWorkCoords = computed(() => {
  const coords = { ...props.status.workCoords } as Record<string, number>;
  delete (coords as any).a;
  return coords;
});

const axisValues = computed(() => ({
  x: Number(props.status.workCoords.x ?? 0),
  y: Number(props.status.workCoords.y ?? 0),
  z: Number(props.status.workCoords.z ?? 0)
}) as Record<string, number>);

const machineValues = computed(() => ({
  x: Number(props.status.machineCoords.x ?? 0),
  y: Number(props.status.machineCoords.y ?? 0),
  z: Number(props.status.machineCoords.z ?? 0)
}) as Record<string, number>);

const remainingAxes = computed(() => Object.keys(filteredWorkCoords.value)
  .filter(a => a !== 'x' && a !== 'y'));

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

const sendRealtimeCommand = (command: string) => {
  sendRealtime(command).catch((error) => {
    console.error('Failed to send real-time command:', command, error);
  });
};

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
      for (let i = 0; i < steps; i++) sendRealtimeCommand(REALTIME.FEED_PLUS_10);
    } else {
      // Decrease - use -10% command
      const steps = Math.abs(diff) / 10;
      for (let i = 0; i < steps; i++) sendRealtimeCommand(REALTIME.FEED_MINUS_10);
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
  sendRealtimeCommand(REALTIME.FEED_RESET);
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
      for (let i = 0; i < steps; i++) sendRealtimeCommand(REALTIME.SPINDLE_PLUS_10);
    } else {
      // Decrease - use -10% command
      const steps = Math.abs(diff) / 10;
      for (let i = 0; i < steps; i++) sendRealtimeCommand(REALTIME.SPINDLE_MINUS_10);
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
  sendRealtimeCommand(REALTIME.SPINDLE_RESET);
  spindleOverride.value = 100;
  previousSpindleOverride.value = 100;
};

// --- Long press to zero work coordinate (G10 L20 <axis>0) ---
type AxisKey = 'x' | 'y' | 'z' | string;
const LONG_PRESS_MS = 750;

const pressState = reactive<Record<string, { start: number; progress: number; raf?: number; triggered: boolean; active: boolean }>>({});

const ensureAxisState = (axis: AxisKey) => {
  if (!pressState[axis]) {
    pressState[axis] = { start: 0, progress: 0, triggered: false, active: false };
  }
  return pressState[axis];
};

let activeAxis: string | null = null;

const startLongPress = (axis: AxisKey, _evt: Event) => {
  if (!store.isHomed.value) {
    return;
  }
  const state = ensureAxisState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.start = performance.now();
  state.progress = 0;
  state.triggered = false;
  state.active = true;
  activeAxis = String(axis).toLowerCase();

  const tick = () => {
    if (!state.active) return; // stop if canceled
    const elapsed = performance.now() - state.start;
    const pct = Math.min(100, (elapsed / LONG_PRESS_MS) * 100);
    state.progress = pct;

    // When pressing XY, mirror progress into X and Y cards
    if (String(axis).toLowerCase() === 'xy') {
      const sx = ensureAxisState('x');
      const sy = ensureAxisState('y');
      sx.progress = pct;
      sy.progress = pct;
    }

    if (elapsed >= LONG_PRESS_MS && !state.triggered) {
      state.triggered = true;
      // Send zero command(s)
      const a = String(axis).toUpperCase();
      if (a === 'XY' || a === 'YX') {
        zeroXY().catch(() => {});
      } else {
        zeroAxis(a as any).catch(() => {});
      }
    }

    // Keep animating until release
    state.raf = requestAnimationFrame(tick);
  };

  state.raf = requestAnimationFrame(tick);
};

const endLongPress = (axis: AxisKey) => {
  const state = ensureAxisState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;
  state.active = false;
  if (activeAxis === String(axis).toLowerCase()) activeAxis = null;
  const axisLower = String(axis).toLowerCase();
  if (!state.triggered) {
    state.progress = 0;
    // If XY was canceled before triggering, also reset mirrored X/Y bars immediately
    if (axisLower === 'xy') {
      const sx = ensureAxisState('x');
      const sy = ensureAxisState('y');
      sx.progress = 0; sy.progress = 0;
      sx.triggered = false; sy.triggered = false;
      sx.active = false; sy.active = false;
    }
  } else {
    // Immediate reset for XY to avoid visible lag; brief linger only for single-axis
    if (axisLower === 'xy') {
      state.progress = 0; state.triggered = false;
      const sx = ensureAxisState('x');
      const sy = ensureAxisState('y');
      sx.progress = 0; sy.progress = 0;
      sx.triggered = false; sy.triggered = false;
      sx.active = false; sy.active = false;
    } else {
      setTimeout(() => { state.progress = 0; state.triggered = false; }, 150);
    }
  }
};

const cancelLongPress = (axis: AxisKey) => {
  const state = ensureAxisState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;
  state.active = false;
  state.progress = 0;
  state.triggered = false;
  if (String(axis).toLowerCase() === 'xy') {
    const sx = ensureAxisState('x');
    const sy = ensureAxisState('y');
    sx.progress = 0; sy.progress = 0;
    sx.triggered = false; sy.triggered = false;
    sx.active = false; sy.active = false;
  }
  if (activeAxis === String(axis).toLowerCase()) activeAxis = null;
};

// Global release handlers to ensure cancel/reset even if pointerup occurs outside the element
const handleGlobalPointerUp = () => {
  if (!activeAxis) return;
  cancelLongPress(activeAxis);
};

onMounted(() => {
  window.addEventListener('mouseup', handleGlobalPointerUp);
  window.addEventListener('touchend', handleGlobalPointerUp);
  window.addEventListener('touchcancel', handleGlobalPointerUp);
});

onUnmounted(() => {
  window.removeEventListener('mouseup', handleGlobalPointerUp);
  window.removeEventListener('touchend', handleGlobalPointerUp);
  window.removeEventListener('touchcancel', handleGlobalPointerUp);
});
</script>

<style scoped>
/* Disable entire status card when not homed or while homing. */
.card-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.card {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  padding: var(--gap-sm);
  box-shadow: var(--shadow-elevated);
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  height: fit-content;
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

.status-hint {
  text-align: center;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  font-style: italic;
  font-weight: 600;
  margin-bottom: 2px;
}

.coords {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.axis-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--gap-sm);
}

@media (max-width: 959px) {
  /* Reduce axis card minimum width on portrait to fit better */
  .axis-grid {
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 6px;
  }
  .axis-group.xy-group { margin-bottom: 2px; }
  .axis-link { width: 80px; min-width: 80px; }
}

.axis-group.xy-group {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: stretch;
  gap: 0; /* let X and Y close together behind XY */
  border: none;
  border-radius: var(--radius-small);
  padding: 2px;
  margin-bottom: 4px;
}

.axis-display {
  background: var(--color-surface-muted);
  padding: 8px;
  border-radius: var(--radius-small);
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  position: relative;
  overflow: hidden;
  cursor: pointer; /* indicate pressable */
  z-index: 1; /* below XY "tape" */
}

.axis-label {
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.axis-link {
  width: 96px;
  min-width: 96px;
  border-radius: 8px;
  background: var(--color-surface-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  /* Always show gradient border via pseudo-element */
  cursor: pointer;
  /* Tape-like overlapping look */
  align-self: center;
  height: 68%;
  min-height: 28px;
  margin-left: -20px;  /* overlap X side more */
  margin-right: -20px; /* overlap Y side more */
  margin-top: -2px;
  margin-bottom: -2px;
  z-index: 2; /* above X/Y cards */
  box-shadow: 0 2px 6px rgba(0,0,0,0.18);
}

/* Slightly tuck X and Y under the XY tape for a tighter join */
.axis-group.xy-group > .axis-display:first-child { margin-right: -20px; }
.axis-group.xy-group > .axis-display:last-child { margin-left: -20px; }

.axis-link .link-label {
  position: relative;
  z-index: 1;
  font-weight: 700;
  color: var(--color-text-primary);
}

@keyframes link-glow {
  0% { box-shadow: 0 0 0 0 var(--color-accent); }
  100% { box-shadow: 0 0 12px 2px var(--color-accent); }
}

.axis-link.active {
  animation: link-glow 0.9s ease-in-out infinite alternate;
}

/* Gradient border ring only while active (pressing) */
.axis-link.active::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px; /* border thickness */
  border-radius: inherit;
  background: var(--gradient-accent);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  pointer-events: none;
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

/* Ensure two rows in portrait regardless of width */
@media (orientation: portrait) {
  .metrics {
    flex-direction: column;
  }
}

/* Portrait/top-row equal-height with JogPanel */
@media (max-width: 1279px) {
  .card {
    height: 100%; /* stretch to grid row height */
  }
}
</style>
