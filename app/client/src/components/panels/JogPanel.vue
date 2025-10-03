<template>
  <section class="card">
    <header class="card__header">
      <div class="step-selector">
        <span>Step</span>
        <button
          v-for="value in jogConfig.stepOptions"
          :key="value"
          :class="['chip', { active: value === jogConfig.stepSize }]"
          @click="emit('update:stepSize', value)"
        >
          {{ value }}
        </button>
      </div>
      <h2>Motion Controls</h2>
    </header>
    <div class="jog-layout">
      <!-- Axis Movement Group (XY Joystick + Z Controls) -->
      <div class="axis-movement-group" :class="{ 'motion-disabled': motionControlsDisabled }">
        <!-- XY Joystick Layout -->
        <div class="xy-joystick">
          <!-- Top Row -->
          <button :class="['control', 'corner', { pressed: isButtonPressed('diagonal--1-1') }]" aria-label="Jog X negative Y positive"
                  @mousedown="jogDiagonalStart(-1, 1, $event)" @mouseup="jogDiagonalEnd(-1, 1, $event)"
                  @touchstart="jogDiagonalStart(-1, 1, $event)" @touchend="jogDiagonalEnd(-1, 1, $event)">↖</button>
          <button :class="['control', 'axis', { pressed: isButtonPressed('Y-1') }]" aria-label="Jog Y positive"
                  @mousedown="jogStart('Y', 1, $event)" @mouseup="jogEnd('Y', 1, $event)"
                  @touchstart="jogStart('Y', 1, $event)" @touchend="jogEnd('Y', 1, $event)">Y+</button>
          <button :class="['control', 'corner', { pressed: isButtonPressed('diagonal-1-1') }]" aria-label="Jog X positive Y positive"
                  @mousedown="jogDiagonalStart(1, 1, $event)" @mouseup="jogDiagonalEnd(1, 1, $event)"
                  @touchstart="jogDiagonalStart(1, 1, $event)" @touchend="jogDiagonalEnd(1, 1, $event)">↗</button>

          <!-- Middle Row -->
          <button :class="['control', 'axis', { pressed: isButtonPressed('X--1') }]" aria-label="Jog X negative"
                  @mousedown="jogStart('X', -1, $event)" @mouseup="jogEnd('X', -1, $event)"
                  @touchstart="jogStart('X', -1, $event)" @touchend="jogEnd('X', -1, $event)">X-</button>
          <button class="center-indicator" aria-label="Soft Reset" @click="sendSoftReset"></button>
          <button :class="['control', 'axis', { pressed: isButtonPressed('X-1') }]" aria-label="Jog X positive"
                  @mousedown="jogStart('X', 1, $event)" @mouseup="jogEnd('X', 1, $event)"
                  @touchstart="jogStart('X', 1, $event)" @touchend="jogEnd('X', 1, $event)">X+</button>

          <!-- Bottom Row -->
          <button :class="['control', 'corner', { pressed: isButtonPressed('diagonal--1--1') }]" aria-label="Jog X negative Y negative"
                  @mousedown="jogDiagonalStart(-1, -1, $event)" @mouseup="jogDiagonalEnd(-1, -1, $event)"
                  @touchstart="jogDiagonalStart(-1, -1, $event)" @touchend="jogDiagonalEnd(-1, -1, $event)">↙</button>
          <button :class="['control', 'axis', { pressed: isButtonPressed('Y--1') }]" aria-label="Jog Y negative"
                  @mousedown="jogStart('Y', -1, $event)" @mouseup="jogEnd('Y', -1, $event)"
                  @touchstart="jogStart('Y', -1, $event)" @touchend="jogEnd('Y', -1, $event)">Y-</button>
          <button :class="['control', 'corner', { pressed: isButtonPressed('diagonal-1--1') }]" aria-label="Jog X positive Y negative"
                  @mousedown="jogDiagonalStart(1, -1, $event)" @mouseup="jogDiagonalEnd(1, -1, $event)"
                  @touchstart="jogDiagonalStart(1, -1, $event)" @touchend="jogDiagonalEnd(1, -1, $event)">↘</button>
        </div>

        <!-- Z Controls -->
        <div class="z-controls">
          <button :class="['control', 'z-button', { pressed: isButtonPressed('Z-1') }]" aria-label="Jog Z positive"
                  @mousedown="jogStart('Z', 1, $event)" @mouseup="jogEnd('Z', 1, $event)"
                  @touchstart="jogStart('Z', 1, $event)" @touchend="jogEnd('Z', 1, $event)">Z+</button>
          <button :class="['control', 'z-button', { pressed: isButtonPressed('Z--1') }]" aria-label="Jog Z negative"
                  @mousedown="jogStart('Z', -1, $event)" @mouseup="jogEnd('Z', -1, $event)"
                  @touchstart="jogStart('Z', -1, $event)" @touchend="jogEnd('Z', -1, $event)">Z-</button>
        </div>
      </div>

      <!-- Home button group -->
      <div class="home-group" ref="homeGroupRef">
        <Transition name="home-main" mode="out-in">
          <button
            v-if="!homeSplit"
            :class="['control', 'home-button', 'home-main-view', { 'is-holding': homePress.active, 'needs-homing': !store.isHomed.value }]"
            :disabled="isHoming"
            @click="goHome"
            @mousedown="startHomePress($event)"
            @mouseup="endHomePress()"
            @mouseleave="cancelHomePress()"
            @touchstart.prevent="startHomePress($event)"
            @touchend="endHomePress()"
            @touchcancel="cancelHomePress()"
          >
            <div class="press-progress-home" :style="{ height: `${homePress.progress || 0}%` }"></div>
            <div class="home-button-content">
              <svg class="home-icon" viewBox="0 0 460.298 460.297" xmlns="http://www.w3.org/2000/svg">
                <path fill="currentColor" d="M230.149,120.939L65.986,256.274c0,0.191-0.048,0.472-0.144,0.855c-0.094,0.38-0.144,0.656-0.144,0.852v137.041c0,4.948,1.809,9.236,5.426,12.847c3.616,3.613,7.898,5.431,12.847,5.431h109.63V303.664h73.097v109.64h109.629c4.948,0,9.236-1.814,12.847-5.435c3.617-3.607,5.432-7.898,5.432-12.847V257.981c0-0.76-0.104-1.334-0.288-1.707L230.149,120.939z"/>
                <path fill="currentColor" d="M457.122,225.438L394.6,173.476V56.989c0-2.663-0.856-4.853-2.574-6.567c-1.704-1.712-3.894-2.568-6.563-2.568h-54.816c-2.666,0-4.855,0.856-6.57,2.568c-1.711,1.714-2.566,3.905-2.566,6.567v55.673l-69.662-58.245c-6.084-4.949-13.318-7.423-21.694-7.423c-8.375,0-15.608,2.474-21.698,7.423L3.172,225.438c-1.903,1.52-2.946,3.566-3.14,6.136c-0.193,2.568,0.472,4.811,1.997,6.713l17.701,21.128c1.525,1.712,3.521,2.759,5.996,3.142c2.285,0.192,4.57-0.476,6.855-1.998L230.149,95.817l197.57,164.741c1.526,1.328,3.521,1.991,5.996,1.991h0.858c2.471-0.376,4.463-1.43,5.996-3.138l17.703-21.125c1.522-1.906,2.189-4.145,1.991-6.716C460.068,229.007,459.021,226.961,457.122,225.438z"/>
              </svg>
              <span>Home</span>
            </div>
          </button>
        </Transition>

        <Transition name="home-split" mode="out-in">
          <div v-if="homeSplit" class="home-split">
            <button :class="['control', 'home-split-btn', { 'needs-homing': !store.isHomed.value }]" :disabled="isHoming" @click="goHomeAxis('X')">HX</button>
            <button :class="['control', 'home-split-btn', { 'needs-homing': !store.isHomed.value }]" :disabled="isHoming" @click="goHomeAxis('Y')">HY</button>
            <button :class="['control', 'home-split-btn', { 'needs-homing': !store.isHomed.value }]" :disabled="isHoming" @click="goHomeAxis('Z')">HZ</button>
          </div>
        </Transition>
      </div>

      <!-- Position controls group (X0/Y0/Z0, Corners, Park) -->
      <div class="position-controls-group" :class="{ 'motion-disabled': motionControlsDisabled }">
        <!-- Column of X0/Y0/Z0 separate from corner/park -->
        <div class="axis-zero-column">
          <button class="control axis-zero-btn" title="Zero X" @click="goToZero('X')">X0</button>
          <button class="control axis-zero-btn" title="Zero Y" @click="goToZero('Y')">Y0</button>
          <button class="control axis-zero-btn" title="Zero Z" @click="goToZero('Z')">Z0</button>
        </div>

        <!-- Simple 2x2 corner buttons + Park below -->
        <div class="corner-simple">
          <div class="corner-grid">
            <button class="control corner-btn" title="Corner Top-Left" @click="goToCorner('top-left')">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 6H8V14" stroke="currentColor" stroke-width="3" stroke-linecap="square"/>
              </svg>
            </button>
            <button class="control corner-btn" title="Corner Top-Right" @click="goToCorner('top-right')">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 6H16V14" stroke="currentColor" stroke-width="3" stroke-linecap="square"/>
              </svg>
            </button>
            <button class="control corner-btn" title="Corner Bottom-Left" @click="goToCorner('bottom-left')">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 18H8V10" stroke="currentColor" stroke-width="3" stroke-linecap="square"/>
              </svg>
            </button>
            <button class="control corner-btn" title="Corner Bottom-Right" @click="goToCorner('bottom-right')">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 18H16V10" stroke="currentColor" stroke-width="3" stroke-linecap="square"/>
              </svg>
            </button>
          </div>
          <button
            class="control park-btn-wide"
            title="Park"
            @click="handleParkClick"
            @mousedown="startParkPress($event)"
            @mouseup="endParkPress()"
            @mouseleave="cancelParkPress()"
            @touchstart.prevent="startParkPress($event)"
            @touchend="endParkPress()"
            @touchcancel="cancelParkPress()"
          >
            <div class="press-progress-park" :style="{ width: `${parkPress.progress || 0}%` }"></div>
            Park
          </button>
        </div>
      </div>
    </div>

    <!-- Parking not set dialog -->
    <Dialog v-if="showParkingDialog" @close="showParkingDialog = false" :show-header="false" size="small" :z-index="10000">
      <ConfirmPanel
        title="Parking Location Not Set"
        message="Long press the Park button (1s) to save the current machine position as the parking location."
        :show-cancel="false"
        confirm-text="Close"
        variant="primary"
        @confirm="showParkingDialog = false"
      />
    </Dialog>
  </section>
</template>

<script setup lang="ts">
import { api } from '../../lib/api.js';
import { ref, reactive, onMounted, onBeforeUnmount, computed } from 'vue';
import { useAppStore } from '../../composables/use-app-store';
import Dialog from '../Dialog.vue';
import ConfirmPanel from '../ConfirmPanel.vue';

const store = useAppStore();

const emit = defineEmits<{
  (e: 'update:stepSize', value: number): void;
}>();

const props = defineProps<{
  jogConfig: {
    stepSize: number;
    stepOptions: number[];
  };
  isDisabled?: boolean;
  machineCoords?: { x: number; y: number; z: number };
  gridSizeX?: number;
  gridSizeY?: number;
}>();

// Computed to check if motion controls should be disabled (not connected, not homed, OR already disabled)
const motionControlsDisabled = computed(() => !store.isConnected.value || props.isDisabled || !store.isHomed.value);

// Computed to check if homing is in progress
const isHoming = computed(() => store.status.machineState?.toLowerCase() === 'home');

let jogTimer: number | null = null;
let heartbeatTimer: number | null = null;
let isLongPress = false;
let activeJogId: string | null = null;

const HEARTBEAT_INTERVAL_MS = 250;

const createJogId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const startHeartbeat = (jogId: string) => {
  stopHeartbeat();
  api.sendJogHeartbeat(jogId);
  heartbeatTimer = window.setInterval(() => {
    api.sendJogHeartbeat(jogId);
  }, HEARTBEAT_INTERVAL_MS);
};

const stopHeartbeat = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
};

// Track which buttons are pressed for visual feedback
const pressedButtons = ref(new Set<string>());

const jog = async (axis: 'X' | 'Y' | 'Z', direction: 1 | -1) => {
  const distance = props.jogConfig.stepSize * direction;
  const command = `$J=G21 G91 ${axis}${distance} F5000`;
  try {
    await api.sendJogStep({
      command,
      displayCommand: command,
      axis,
      direction,
      feedRate: axis === 'Z' ? 2500 : 5000,
      distance
    });
  } catch (error) {
    console.error('Failed to execute jog step:', error);
  }
};

const jogDiagonal = async (xDirection: 1 | -1, yDirection: 1 | -1) => {
  const xDistance = props.jogConfig.stepSize * xDirection;
  const yDistance = props.jogConfig.stepSize * yDirection;
  const command = `$J=G21 G91 X${xDistance} Y${yDistance} F5000`;
  try {
    await api.sendJogStep({
      command,
      displayCommand: command,
      axis: 'XY',
      direction: null,
      feedRate: 5000,
      distance: { x: xDistance, y: yDistance }
    });
  } catch (error) {
    console.error('Failed to execute diagonal jog step:', error);
  }
};

const continuousJog = async (axis: 'X' | 'Y' | 'Z', direction: 1 | -1) => {
  const feedRate = axis === 'Z' ? 2500 : 5000;
  const command = `$J=G21G91 ${axis}${3000 * direction} F${feedRate}`;
  const jogId = createJogId();
  activeJogId = jogId;

  try {
    await api.startJogSession({
      jogId,
      command,
      displayCommand: command,
      axis,
      direction,
      feedRate
    });
    startHeartbeat(jogId);
  } catch (error) {
    console.error('Failed to start continuous jog:', error);
    stopHeartbeat();
    if (activeJogId === jogId) {
      activeJogId = null;
    }
  }
};

const continuousDiagonalJog = async (xDirection: 1 | -1, yDirection: 1 | -1) => {
  const command = `$J=G21G91 X${3000 * xDirection} Y${3000 * yDirection} F5000`;
  const jogId = createJogId();
  activeJogId = jogId;

  try {
    await api.startJogSession({
      jogId,
      command,
      displayCommand: command,
      axis: 'XY',
      direction: null,
      feedRate: 5000
    });
    startHeartbeat(jogId);
  } catch (error) {
    console.error('Failed to start diagonal continuous jog:', error);
    stopHeartbeat();
    if (activeJogId === jogId) {
      activeJogId = null;
    }
  }
};

const jogStart = (axis: 'X' | 'Y' | 'Z', direction: 1 | -1, event?: Event) => {
  if (event) {
    event.preventDefault();
  }

  // Don't allow jogging if motion controls are disabled
  if (motionControlsDisabled.value) {
    return;
  }

  const buttonId = getButtonId(axis, direction);
  setButtonPressed(buttonId);

  isLongPress = false;
  jogTimer = setTimeout(() => {
    isLongPress = true;
    continuousJog(axis, direction);
  }, 300);
};

const jogDiagonalStart = (xDirection: 1 | -1, yDirection: 1 | -1, event?: Event) => {
  if (event) {
    event.preventDefault();
  }

  // Don't allow jogging if motion controls are disabled
  if (motionControlsDisabled.value) {
    return;
  }

  const buttonId = getButtonId('', undefined, xDirection, yDirection);
  setButtonPressed(buttonId);

  isLongPress = false;
  jogTimer = setTimeout(() => {
    isLongPress = true;
    continuousDiagonalJog(xDirection, yDirection);
  }, 300);
};

const jogEnd = (axis: 'X' | 'Y' | 'Z', direction: 1 | -1, event?: Event) => {
  if (event) {
    event.preventDefault();
  }
  const buttonId = getButtonId(axis, direction);
  setButtonReleased(buttonId);

  if (jogTimer) {
    clearTimeout(jogTimer);
    jogTimer = null;
  }
  if (isLongPress) {
    stopJog();
  } else {
    void jog(axis, direction);
  }
};

const jogDiagonalEnd = (xDirection: 1 | -1, yDirection: 1 | -1, event?: Event) => {
  if (event) {
    event.preventDefault();
  }
  const buttonId = getButtonId('', undefined, xDirection, yDirection);
  setButtonReleased(buttonId);

  if (jogTimer) {
    clearTimeout(jogTimer);
    jogTimer = null;
  }
  if (isLongPress) {
    stopJog();
  } else {
    void jogDiagonal(xDirection, yDirection);
  }
};

const stopJog = () => {
  if (!activeJogId) {
    return;
  }

  const jogId = activeJogId;
  activeJogId = null;
  stopHeartbeat();

  api.stopJogSession(jogId).catch((error) => {
    console.error('Failed to stop jog session:', error);
  });
};

const goHome = async () => {
  try {
    await api.sendCommandViaWebSocket({
      command: '$H'
    });
  } catch (error) {
    console.error('Failed to execute home command:', error);
  }
};

// Helper functions for button visual feedback
const getButtonId = (axis: string, direction?: number, xDir?: number, yDir?: number) => {
  if (xDir !== undefined && yDir !== undefined) {
    return `diagonal-${xDir}-${yDir}`;
  }
  return `${axis}-${direction}`;
};

const setButtonPressed = (buttonId: string) => {
  pressedButtons.value.add(buttonId);
};

const setButtonReleased = (buttonId: string) => {
  pressedButtons.value.delete(buttonId);
};

const isButtonPressed = (buttonId: string) => {
  return pressedButtons.value.has(buttonId);
};

let unsubscribeJogStopped: (() => void) | null = null;

onMounted(() => {
  unsubscribeJogStopped = api.on('jog:stopped', (data) => {
    if (!data || !data.jogId) {
      return;
    }
    if (activeJogId && data.jogId === activeJogId) {
      activeJogId = null;
      stopHeartbeat();
    }
  });
});

onBeforeUnmount(() => {
  if (unsubscribeJogStopped) {
    unsubscribeJogStopped();
    unsubscribeJogStopped = null;
  }
  stopHeartbeat();
});

// --- Home split (HX/HY/HZ) via long-press ---
const homeSplit = ref(false);
const homeGroupRef = ref<HTMLElement | null>(null);
const LONG_PRESS_MS_HOME = 750;
const homePress = reactive<{ start: number; progress: number; raf?: number; active: boolean; triggered: boolean }>({ start: 0, progress: 0, active: false, triggered: false });
let homeActive = false;

const startHomePress = (_evt?: Event) => {
  if (homeSplit.value) return;
  if (homePress.raf) cancelAnimationFrame(homePress.raf);
  homePress.start = performance.now();
  homePress.progress = 0;
  homePress.active = true;
  homePress.triggered = false;
  homeActive = true;

  const tick = () => {
    if (!homePress.active) return;
    const elapsed = performance.now() - homePress.start;
    const pct = Math.min(100, (elapsed / LONG_PRESS_MS_HOME) * 100);
    homePress.progress = pct;

    if (elapsed >= LONG_PRESS_MS_HOME && !homePress.triggered) {
      homePress.triggered = true;
      homeSplit.value = true; // reveal HX/HY/HZ
      // reset the visual progress immediately
      homePress.progress = 0;
      homePress.active = false;
      homeActive = false;
      return; // stop animating
    }

    homePress.raf = requestAnimationFrame(tick);
  };

  homePress.raf = requestAnimationFrame(tick);
};

const endHomePress = () => {
  if (homePress.raf) cancelAnimationFrame(homePress.raf);
  homePress.raf = undefined;
  homePress.active = false;
  homeActive = false;
  if (!homePress.triggered) {
    // Not triggered: ensure progress cleared
    homePress.progress = 0;
  }
};

const cancelHomePress = () => {
  if (homePress.raf) cancelAnimationFrame(homePress.raf);
  homePress.raf = undefined;
  homePress.active = false;
  homeActive = false;
  homePress.progress = 0;
  homePress.triggered = false;
};

// Click outside to collapse back to single Home
const handleGlobalClick = (e: MouseEvent | TouchEvent) => {
  if (!homeSplit.value) return;
  const target = e.target as Node | null;
  const container = homeGroupRef.value;
  if (!container) return;
  if (!target || !container.contains(target)) {
    homeSplit.value = false;
  }
};

const handleGlobalPointerUp = () => {
  if (homeActive) {
    cancelHomePress();
  }
};

onMounted(() => {
  window.addEventListener('click', handleGlobalClick, true);
  window.addEventListener('touchstart', handleGlobalClick, true);
  window.addEventListener('mouseup', handleGlobalPointerUp);
  window.addEventListener('touchend', handleGlobalPointerUp);
  window.addEventListener('touchcancel', handleGlobalPointerUp);
});

onBeforeUnmount(() => {
  window.removeEventListener('click', handleGlobalClick, true);
  window.removeEventListener('touchstart', handleGlobalClick, true);
  window.removeEventListener('mouseup', handleGlobalPointerUp);
  window.removeEventListener('touchend', handleGlobalPointerUp);
  window.removeEventListener('touchcancel', handleGlobalPointerUp);
});

const goHomeAxis = async (axis: 'X' | 'Y' | 'Z') => {
  try {
    await api.sendCommandViaWebSocket({ command: `$H${axis}`, displayCommand: `$H${axis}` });
  } catch (error) {
    console.error(`Failed to home ${axis}:`, error);
  }
};

// --- Parking location: click to check, long-press to set ---
const showParkingDialog = ref(false);
const LONG_PRESS_MS_PARK = 1000;
const parkPress = reactive<{ start: number; progress: number; raf?: number; active: boolean; triggered: boolean }>({ start: 0, progress: 0, active: false, triggered: false });

const handleParkClick = async () => {
  // If long-press already handled action, ignore click
  if (parkPress.triggered) return;
  if (motionControlsDisabled.value) {
    return;
  }
  try {
    const response = await api.getSetting('parkingLocation');
    if (response === null || !response.parkingLocation) {
      // Not set
      showParkingDialog.value = true;
      return;
    }
    // Parse parking location (format: "x,y,z")
    const [x, y, z] = response.parkingLocation.split(',').map(v => parseFloat(v));

    // Send parking G-code commands in sequence
    await api.sendCommandViaWebSocket({ command: 'G53 G90 G0 Z-5', displayCommand: 'G53 G90 G0 Z-5' });
    await api.sendCommandViaWebSocket({ command: `G53 G90 G0 X${x} Y${y}`, displayCommand: `G53 G90 G0 X${x} Y${y}` });
    await api.sendCommandViaWebSocket({ command: `G53 G90 G0 Z${z}`, displayCommand: `G53 G90 G0 Z${z}` });
  } catch (_err) {
    // Network or other errors: show dialog to instruct long press
    showParkingDialog.value = true;
  }
};

const startParkPress = (_evt?: Event) => {
  if (parkPress.raf) cancelAnimationFrame(parkPress.raf);
  parkPress.start = performance.now();
  parkPress.progress = 0;
  parkPress.active = true;
  parkPress.triggered = false;

  const tick = () => {
    if (!parkPress.active) return;
    const elapsed = performance.now() - parkPress.start;
    const pct = Math.min(100, (elapsed / LONG_PRESS_MS_PARK) * 100);
    parkPress.progress = pct;

    if (elapsed >= LONG_PRESS_MS_PARK && !parkPress.triggered) {
      parkPress.triggered = true;
      // Capture current machine coords and save as parkingLocation
      const x = Number(props.machineCoords?.x ?? 0).toFixed(3);
      const y = Number(props.machineCoords?.y ?? 0).toFixed(3);
      const z = Number(props.machineCoords?.z ?? 0).toFixed(3);
      const parking = `${x},${y},${z}`;
      api.updateSettings({ parkingLocation: parking }).catch(() => {});
      // Close the info dialog if open
      showParkingDialog.value = false;
      // stop animating
      parkPress.active = false;
      parkPress.progress = 0;
      return;
    }

    parkPress.raf = requestAnimationFrame(tick);
  };

  parkPress.raf = requestAnimationFrame(tick);
};

const endParkPress = () => {
  if (parkPress.raf) cancelAnimationFrame(parkPress.raf);
  parkPress.raf = undefined;
  parkPress.active = false;
  parkPress.progress = 0;
  // Reset triggered after a short delay to allow click suppression for long-press
  setTimeout(() => {
    parkPress.triggered = false;
  }, 100);
};

const cancelParkPress = () => {
  if (parkPress.raf) cancelAnimationFrame(parkPress.raf);
  parkPress.raf = undefined;
  parkPress.active = false;
  parkPress.progress = 0;
  parkPress.triggered = false;
};

// Zero axis buttons
const goToZero = async (axis: 'X' | 'Y' | 'Z') => {
  if (motionControlsDisabled.value) {
    return;
  }
  try {
    await api.sendCommandViaWebSocket({
      command: `G90 G0 ${axis}0`,
      displayCommand: `G90 G0 ${axis}0`
    });
  } catch (error) {
    console.error(`Failed to move ${axis} to zero:`, error);
  }
};

// Soft reset (center button)
const sendSoftReset = async () => {
  try {
    await api.sendCommandViaWebSocket({
      command: String.fromCharCode(0x18),
      displayCommand: '\\x18; (Soft Reset)'
    });
  } catch (error) {
    console.error('Failed to send soft reset:', error);
  }
};

// Corner button handlers
const goToCorner = async (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
  if (motionControlsDisabled.value) {
    return;
  }
  const xLimit = props.gridSizeX || 1260;
  const yLimit = props.gridSizeY || 1284;

  try {
    // Always move to safe Z height first
    await api.sendCommandViaWebSocket({ command: 'G53 G90 G0 Z-5', displayCommand: 'G53 G90 G0 Z-5' });

    // Move to corner based on which button was clicked
    switch (corner) {
      case 'top-left':
        await api.sendCommandViaWebSocket({ command: 'G53 G90 G0 X0 Y0', displayCommand: 'G53 G90 G0 X0 Y0' });
        break;
      case 'top-right':
        await api.sendCommandViaWebSocket({ command: `G53 G90 G0 X${xLimit} Y0`, displayCommand: `G53 G90 G0 X${xLimit} Y0` });
        break;
      case 'bottom-left':
        await api.sendCommandViaWebSocket({ command: `G53 G90 G0 X0 Y-${yLimit}`, displayCommand: `G53 G90 G0 X0 Y-${yLimit}` });
        break;
      case 'bottom-right':
        await api.sendCommandViaWebSocket({ command: `G53 G90 G0 X${xLimit} Y-${yLimit}`, displayCommand: `G53 G90 G0 X${xLimit} Y-${yLimit}` });
        break;
    }
  } catch (error) {
    console.error('Failed to move to corner:', error);
  }
};
</script>

<style scoped>
/* Disable motion controls when not homed */
.motion-disabled {
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
  align-items: center;
  justify-content: space-between;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

.step-selector {
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
}

.chip.active {
  background: var(--gradient-accent);
  color: #fff;
}

.jog-layout {
  display: flex;
  gap: var(--gap-xs);
  align-items: center;
  width: 100%;
}

.axis-movement-group {
  display: flex;
  gap: 4px;
  align-items: stretch;
}

.xy-joystick {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 4px;
  width: 180px;
  height: 180px;
}

.z-controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 50px;
}

.center-indicator {
  width: 100%;
  height: 100%;
  border: 2px solid #ff6b6b;
  border-radius: 50%;
  background: var(--color-surface);
  position: relative;
  cursor: pointer;
  transition: all 0.2s ease;
}

.center-indicator:hover {
  background: rgba(255, 107, 107, 0.1);
  border-color: #ff4444;
}

.center-indicator:active {
  background: rgba(255, 107, 107, 0.2);
  transform: scale(0.95);
}

.center-indicator::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  background: #ff6b6b;
  border-radius: 50%;
}

.home-button {
  width: 60px;
  height: 100%;
  background: var(--color-surface-muted);
  font-weight: bold;
}

.control {
  border-radius: var(--radius-small);
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  /* Allow touch events for jog controls */
  -webkit-touch-callout: default;
  touch-action: manipulation;
}

.control:hover:not(:disabled) {
  border: 1px solid var(--color-accent);
}

.control:active:not(:disabled),
.control.pressed {
  background: var(--color-accent);
  color: white;
  transform: scale(0.98);
  box-shadow: 0 0 10px rgba(26, 188, 156, 0.5);
  border: 1px solid var(--color-accent);
}

.control:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.control.corner {
  font-size: 1.2rem;
}

.control.axis {
  font-weight: bold;
}

.home-group {
  flex: 1; /* Home button adapts to available space */
  min-width: 60px; /* Minimum width cap */
}

.position-controls-group {
  display: flex;
  gap: 4px;
  align-items: stretch;
}

/* Simple corner + park layout */
.corner-simple {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 100px; /* Can squeeze to 100px */
  height: 180px; /* match column height */
}

.corner-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: 4px;
  flex: 1; /* take available space above Park */
}

.corner-btn {
  font-size: 1.1rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

.corner-btn svg {
  width: 20px;
  height: 20px;
  color: var(--color-text-primary);
}

.zero-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.zero-btn {
  height: 44px;
  font-weight: 800;
}

.park-btn-wide {
  height: 56px;
  font-weight: 800;
}

/* Axis zero column */
.axis-zero-column {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 50px; /* Can shrink to 50px */
}

.axis-zero-btn {
  flex: 1;
  font-weight: 800;
}

.z-button {
  flex: 1;
  background: var(--color-surface-muted);
  font-weight: bold;
}

.home-button {
  width: 100%;
  height: 100%;
  background: var(--color-surface-muted);
  font-weight: bold;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.home-button-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  position: relative;
  z-index: 1;
}

.home-icon {
  width: 24px;
  height: 24px;
  color: var(--color-text-primary);
}

.home-button-content span {
  font-size: 0.85rem;
  font-weight: bold;
}

@media (max-width: 959px) {
  .jog-layout {
    flex-direction: column;
    gap: var(--gap-sm);
  }

  .xy-joystick {
    width: 150px;
    height: 150px;
  }

  .z-controls {
    width: 50px;
  }

  /* Make X0/Y0/Z0 column slimmer on portrait */
  .axis-zero-column {
    width: 72px;
    gap: 4px;
  }
  .axis-zero-btn {
    height: 40px;
    font-size: 0.9rem;
  }
}

/* Portrait: ensure each column in Controls has equal total height */
@media (orientation: portrait) {
  /* Portrait: fixed balanced control height */
  .jog-layout { align-items: center; justify-content: center; --jog-col-height: 200px; margin-top: auto; margin-bottom: auto; gap: 6px; }
  .axis-movement-group { height: var(--jog-col-height); }
  .xy-joystick { width: var(--jog-col-height); height: var(--jog-col-height); }
  .z-controls { height: var(--jog-col-height); }
  .home-group { height: var(--jog-col-height); }
  .position-controls-group { align-items: stretch; }
  .position-controls-group > * { height: var(--jog-col-height); }
  .axis-zero-column { height: var(--jog-col-height); }
  .corner-simple { height: var(--jog-col-height); }
}

/* Tablet portrait: keep zero column narrow so cards do not overflow */
@media (max-width: 1279px) and (min-width: 960px) {
  .axis-zero-column {
    width: 80px;
    gap: 4px;
  }
  .axis-zero-btn {
    height: 42px;
    font-size: 0.95rem;
  }
}

/* Home split styles */
.home-group {
  margin: 0;
  padding: 0;
  border: none;
  width: 60px;
  height: 180px;
  position: relative; /* lock size; children will be absolute */
}

.home-split {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.home-split-btn {
  flex: 1;
  width: 100%;
  font-weight: bold;
}

.press-progress-home {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 0%;
  background: var(--color-accent);
  opacity: 0.22;
  pointer-events: none;
}

/* Ensure visibility over accent-pressed background */
.home-button.is-holding .press-progress-home,
.home-button:active .press-progress-home {
  background: rgba(255, 255, 255, 0.35);
  opacity: 1;
}

/* Park press progress */
.park-btn-wide {
  position: relative;
  overflow: hidden;
}
.press-progress-park {
  position: absolute;
  left: 0;
  top: 0;
  width: 0%;
  height: 100%;
  background: var(--color-accent);
  opacity: 0.22;
  pointer-events: none;
}

/* Ensure visibility over accent-pressed background */
.park-btn-wide:active .press-progress-park {
  background: rgba(255, 255, 255, 0.35);
  opacity: 1;
}

/* Transition animations for expanding/collapsing Home -> HX/HY/HZ */
.home-split-enter-active,
.home-split-leave-active,
.home-main-enter-active,
.home-main-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
  will-change: opacity, transform;
}

.home-split-enter-from,
.home-main-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.home-split-enter-to,
.home-main-leave-from {
  opacity: 1;
  transform: scale(1);
}

.home-split-leave-from,
.home-main-enter-to {
  opacity: 1;
  transform: scale(1);
}

.home-split-leave-to,
.home-main-enter-from {
  opacity: 0;
  transform: scale(0.96);
}

/* Position the main Home view absolutely as well */
.home-main-view {
  position: absolute;
  inset: 0;
}

/* Glowing animation for Home button when not homed */
@keyframes glow-pulse {
  0%, 100% {
    box-shadow: 0 0 8px rgba(26, 188, 156, 0.6),
                0 0 16px rgba(26, 188, 156, 0.4),
                inset 0 0 8px rgba(26, 188, 156, 0.3);
  }
  50% {
    box-shadow: 0 0 16px rgba(26, 188, 156, 0.8),
                0 0 24px rgba(26, 188, 156, 0.6),
                inset 0 0 12px rgba(26, 188, 156, 0.5);
  }
}

.home-button.needs-homing {
  animation: glow-pulse 2s ease-in-out infinite;
  background: var(--color-accent);
  color: white;
}

.home-button.needs-homing .home-icon {
  color: white;
}

.home-split-btn.needs-homing {
  animation: glow-pulse 2s ease-in-out infinite;
  background: var(--color-accent);
  color: white;
}

/* Simple confirm dialog styling (mirrors ToolpathViewport) */
.confirm-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}
.confirm-dialog__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
.confirm-dialog__message {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.confirm-dialog__actions {
  display: flex;
  gap: var(--gap-sm);
  justify-content: flex-end;
  margin-top: var(--gap-sm);
}
.confirm-dialog__btn {
  padding: 10px 24px;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}
.confirm-dialog__btn--cancel {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}
.confirm-dialog__btn--cancel:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

/* Portrait/top-row equal-height with StatusPanel */
@media (max-width: 1279px) {
  .card {
    height: 100%; /* stretch to grid row height */
  }
  /* Make internal controls compact to avoid horizontal overflow */
  .jog-layout { flex-wrap: wrap; gap: 6px; justify-content: center; --jog-col-height: 150px; }
  .axis-movement-group { height: var(--jog-col-height); }
  .xy-joystick { width: var(--jog-col-height); height: var(--jog-col-height); }
  .z-controls { height: var(--jog-col-height); }
  .home-group { height: var(--jog-col-height); }
  .axis-zero-column { width: 50px; height: var(--jog-col-height); gap: 4px; }
  .axis-zero-btn { font-size: 0.9rem; }
  .corner-simple { width: 120px; height: var(--jog-col-height); gap: 4px; }
  .corner-grid { gap: 4px; }
  .corner-btn { font-size: 1rem; }
  .park-btn-wide { height: 44px; }

  /* Portrait: match main portrait height */
  @media (orientation: portrait) {
    .jog-layout { --jog-col-height: 200px; }
  }
}
</style>
