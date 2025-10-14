<template>
  <section class="card" :class="{ 'controls-disabled': panelDisabled }">
    <header class="card__header">
      <div class="step-selector">
        <span class="step-label">Step</span>
        <button
          v-for="value in jogConfig.stepOptions"
          :key="value"
          :class="['chip', { active: value === jogConfig.stepSize }]"
          @click="emit('update:stepSize', value)"
        >
          {{ value }}
        </button>
        <span class="feed-rate-label">Feed Rate</span>
        <input
          type="text"
          class="feed-rate-input"
          :value="feedRateInput"
          @input="handleFeedRateInput"
          @blur="validateFeedRate"
          placeholder="0.00"
        />
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
                  @mousedown="handleJogDiagonalStart(-1, 1, $event)" @mouseup="handleJogDiagonalEnd(-1, 1, $event)"
                  @touchstart="handleJogDiagonalStart(-1, 1, $event)" @touchend="handleJogDiagonalEnd(-1, 1, $event)">↖</button>
          <button :class="['control', 'axis', { pressed: isButtonPressed('Y-1') }]" aria-label="Jog Y positive"
                  @mousedown="handleJogStart('Y', 1, $event)" @mouseup="handleJogEnd('Y', 1, $event)"
                  @touchstart="handleJogStart('Y', 1, $event)" @touchend="handleJogEnd('Y', 1, $event)">Y+</button>
          <button :class="['control', 'corner', { pressed: isButtonPressed('diagonal-1-1') }]" aria-label="Jog X positive Y positive"
                  @mousedown="handleJogDiagonalStart(1, 1, $event)" @mouseup="handleJogDiagonalEnd(1, 1, $event)"
                  @touchstart="handleJogDiagonalStart(1, 1, $event)" @touchend="handleJogDiagonalEnd(1, 1, $event)">↗</button>

          <!-- Middle Row -->
          <button :class="['control', 'axis', { pressed: isButtonPressed('X--1') }]" aria-label="Jog X negative"
                  @mousedown="handleJogStart('X', -1, $event)" @mouseup="handleJogEnd('X', -1, $event)"
                  @touchstart="handleJogStart('X', -1, $event)" @touchend="handleJogEnd('X', -1, $event)">X-</button>
          <button class="center-indicator" aria-label="Soft Reset" @click="sendSoftReset"></button>
          <button :class="['control', 'axis', { pressed: isButtonPressed('X-1') }]" aria-label="Jog X positive"
                  @mousedown="handleJogStart('X', 1, $event)" @mouseup="handleJogEnd('X', 1, $event)"
                  @touchstart="handleJogStart('X', 1, $event)" @touchend="handleJogEnd('X', 1, $event)">X+</button>

          <!-- Bottom Row -->
          <button :class="['control', 'corner', { pressed: isButtonPressed('diagonal--1--1') }]" aria-label="Jog X negative Y negative"
                  @mousedown="handleJogDiagonalStart(-1, -1, $event)" @mouseup="handleJogDiagonalEnd(-1, -1, $event)"
                  @touchstart="handleJogDiagonalStart(-1, -1, $event)" @touchend="handleJogDiagonalEnd(-1, -1, $event)">↙</button>
          <button :class="['control', 'axis', { pressed: isButtonPressed('Y--1') }]" aria-label="Jog Y negative"
                  @mousedown="handleJogStart('Y', -1, $event)" @mouseup="handleJogEnd('Y', -1, $event)"
                  @touchstart="handleJogStart('Y', -1, $event)" @touchend="handleJogEnd('Y', -1, $event)">Y-</button>
          <button :class="['control', 'corner', { pressed: isButtonPressed('diagonal-1--1') }]" aria-label="Jog X positive Y negative"
                  @mousedown="handleJogDiagonalStart(1, -1, $event)" @mouseup="handleJogDiagonalEnd(1, -1, $event)"
                  @touchstart="handleJogDiagonalStart(1, -1, $event)" @touchend="handleJogDiagonalEnd(1, -1, $event)">↘</button>
        </div>

        <!-- Z Controls -->
        <div class="z-controls">
          <button :class="['control', 'z-button', { pressed: isButtonPressed('Z-1') }]" aria-label="Jog Z positive"
                  @mousedown="handleJogStart('Z', 1, $event)" @mouseup="handleJogEnd('Z', 1, $event)"
                  @touchstart="handleJogStart('Z', 1, $event)" @touchend="handleJogEnd('Z', 1, $event)">Z+</button>
          <button :class="['control', 'z-button', { pressed: isButtonPressed('Z--1') }]" aria-label="Jog Z negative"
                  @mousedown="handleJogStart('Z', -1, $event)" @mouseup="handleJogEnd('Z', -1, $event)"
                  @touchstart="handleJogStart('Z', -1, $event)" @touchend="handleJogEnd('Z', -1, $event)">Z-</button>
        </div>
      </div>

      <!-- Home button group -->
      <div class="home-group" ref="homeGroupRef">
        <Transition name="home-main" mode="out-in">
          <button
            v-if="!homeSplit"
            :class="['control', 'home-button', 'home-main-view', { 'is-holding': homePress.active, 'needs-homing': !store.isHomed.value, 'long-press-triggered': homePress.triggered, 'blink-border': homePress.blinking }]"
            :disabled="isHoming"
            @click="handleHomeDoubleClick"
            @mousedown="startHomePress($event)"
            @mouseup="endHomePress()"
            @mouseleave="cancelHomePress()"
            @touchstart="startHomePress($event)"
            @touchend="endHomePress()"
            @touchcancel="cancelHomePress()"
          >
            <div class="long-press-indicator long-press-horizontal" :style="{ width: `${homePress.progress || 0}%` }"></div>
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
            <button
              :class="['control', 'home-split-btn', { 'needs-homing': !store.isHomed.value, 'long-press-triggered': homeSplitPress.X.triggered, 'blink-border': homeSplitPress.X.blinking }]"
              :disabled="isHoming"
              @mousedown="startHomeSplitPress('X', $event)"
              @mouseup="endHomeSplitPress('X')"
              @mouseleave="cancelHomeSplitPress('X')"
              @touchstart="startHomeSplitPress('X', $event)"
              @touchend="endHomeSplitPress('X')"
              @touchcancel="cancelHomeSplitPress('X')"
            >
              <div class="long-press-indicator long-press-horizontal" :style="{ width: `${homeSplitPress.X.progress || 0}%` }"></div>
              HX
            </button>
            <button
              :class="['control', 'home-split-btn', { 'needs-homing': !store.isHomed.value, 'long-press-triggered': homeSplitPress.Y.triggered, 'blink-border': homeSplitPress.Y.blinking }]"
              :disabled="isHoming"
              @mousedown="startHomeSplitPress('Y', $event)"
              @mouseup="endHomeSplitPress('Y')"
              @mouseleave="cancelHomeSplitPress('Y')"
              @touchstart="startHomeSplitPress('Y', $event)"
              @touchend="endHomeSplitPress('Y')"
              @touchcancel="cancelHomeSplitPress('Y')"
            >
              <div class="long-press-indicator long-press-horizontal" :style="{ width: `${homeSplitPress.Y.progress || 0}%` }"></div>
              HY
            </button>
            <button
              :class="['control', 'home-split-btn', { 'needs-homing': !store.isHomed.value, 'long-press-triggered': homeSplitPress.Z.triggered, 'blink-border': homeSplitPress.Z.blinking }]"
              :disabled="isHoming"
              @mousedown="startHomeSplitPress('Z', $event)"
              @mouseup="endHomeSplitPress('Z')"
              @mouseleave="cancelHomeSplitPress('Z')"
              @touchstart="startHomeSplitPress('Z', $event)"
              @touchend="endHomeSplitPress('Z')"
              @touchcancel="cancelHomeSplitPress('Z')"
            >
              <div class="long-press-indicator long-press-horizontal" :style="{ width: `${homeSplitPress.Z.progress || 0}%` }"></div>
              HZ
            </button>
          </div>
        </Transition>
      </div>

      <!-- Position controls group (X0/Y0/Z0, Corners, Park) -->
      <div class="position-controls-group" :class="{ 'motion-disabled': motionControlsDisabled }">
        <!-- Column of X0/Y0/Z0 separate from corner/park -->
        <div class="axis-zero-column" ref="axisZeroGroupRef">
          <div class="axis-zero-xy-container">
            <Transition name="axis-zero-main" mode="out-in">
              <button
                v-if="!axisZeroSplit"
                :class="['control', 'axis-zero-btn', 'axis-zero-xy-combined', { 'long-press-triggered': axisZeroPress.XY.triggered, 'blink-border': axisZeroPress.XY.blinking }]"
                title="Zero XY (Double-tap to split, Hold to move)"
                @click="handleXY0DoubleClick"
                @mousedown="startAxisZeroPress('XY', $event)"
                @mouseup="endAxisZeroPress('XY')"
                @mouseleave="cancelAxisZeroPress('XY')"
                @touchstart="startAxisZeroPress('XY', $event)"
                @touchend="endAxisZeroPress('XY')"
                @touchcancel="cancelAxisZeroPress('XY')"
              >
                <div class="long-press-indicator long-press-horizontal" :style="{ width: `${axisZeroPress.XY.progress || 0}%` }"></div>
                XY0
              </button>
            </Transition>

            <Transition name="axis-zero-split" mode="out-in">
              <div v-if="axisZeroSplit" class="axis-zero-split-xy">
                <button
                  :class="['control', 'axis-zero-btn', { 'long-press-triggered': axisZeroPress.X.triggered, 'blink-border': axisZeroPress.X.blinking }]"
                  title="Zero X (Hold to move)"
                  @mousedown="startAxisZeroPress('X', $event)"
                  @mouseup="endAxisZeroPress('X')"
                  @mouseleave="cancelAxisZeroPress('X')"
                  @touchstart="startAxisZeroPress('X', $event)"
                  @touchend="endAxisZeroPress('X')"
                  @touchcancel="cancelAxisZeroPress('X')"
                >
                  <div class="long-press-indicator long-press-horizontal" :style="{ width: `${axisZeroPress.X.progress || 0}%` }"></div>
                  X0
                </button>
                <button
                  :class="['control', 'axis-zero-btn', { 'long-press-triggered': axisZeroPress.Y.triggered, 'blink-border': axisZeroPress.Y.blinking }]"
                  title="Zero Y (Hold to move)"
                  @mousedown="startAxisZeroPress('Y', $event)"
                  @mouseup="endAxisZeroPress('Y')"
                  @mouseleave="cancelAxisZeroPress('Y')"
                  @touchstart="startAxisZeroPress('Y', $event)"
                  @touchend="endAxisZeroPress('Y')"
                  @touchcancel="cancelAxisZeroPress('Y')"
                >
                  <div class="long-press-indicator long-press-horizontal" :style="{ width: `${axisZeroPress.Y.progress || 0}%` }"></div>
                  Y0
                </button>
              </div>
            </Transition>
          </div>

          <button
            :class="['control', 'axis-zero-btn', { 'long-press-triggered': axisZeroPress.Z.triggered, 'blink-border': axisZeroPress.Z.blinking }]"
            title="Zero Z (Hold to move)"
            @mousedown="startAxisZeroPress('Z', $event)"
            @mouseup="endAxisZeroPress('Z')"
            @mouseleave="cancelAxisZeroPress('Z')"
            @touchstart="startAxisZeroPress('Z', $event)"
            @touchend="endAxisZeroPress('Z')"
            @touchcancel="cancelAxisZeroPress('Z')"
          >
            <div class="long-press-indicator long-press-horizontal" :style="{ width: `${axisZeroPress.Z.progress || 0}%` }"></div>
            Z0
          </button>
        </div>

        <!-- Simple 2x2 corner buttons + Park below -->
        <div class="corner-simple">
          <div class="corner-grid">
            <button
              :class="['control', 'corner-btn', { 'long-press-triggered': cornerPress.topLeft.triggered, 'blink-border': cornerPress.topLeft.blinking }]"
              title="Corner Top-Left (Hold to move)"
              @mousedown="startCornerPress('top-left', $event)"
              @mouseup="endCornerPress('top-left')"
              @mouseleave="cancelCornerPress('top-left')"
              @touchstart="startCornerPress('top-left', $event)"
              @touchend="endCornerPress('top-left')"
              @touchcancel="cancelCornerPress('top-left')"
            >
              <div class="long-press-indicator long-press-horizontal" :style="{ width: `${cornerPress.topLeft.progress || 0}%` }"></div>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 6H8V14" stroke="currentColor" stroke-width="3" stroke-linecap="square"/>
              </svg>
            </button>
            <button
              :class="['control', 'corner-btn', { 'long-press-triggered': cornerPress.topRight.triggered, 'blink-border': cornerPress.topRight.blinking }]"
              title="Corner Top-Right (Hold to move)"
              @mousedown="startCornerPress('top-right', $event)"
              @mouseup="endCornerPress('top-right')"
              @mouseleave="cancelCornerPress('top-right')"
              @touchstart="startCornerPress('top-right', $event)"
              @touchend="endCornerPress('top-right')"
              @touchcancel="cancelCornerPress('top-right')"
            >
              <div class="long-press-indicator long-press-horizontal" :style="{ width: `${cornerPress.topRight.progress || 0}%` }"></div>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 6H16V14" stroke="currentColor" stroke-width="3" stroke-linecap="square"/>
              </svg>
            </button>
            <button
              :class="['control', 'corner-btn', { 'long-press-triggered': cornerPress.bottomLeft.triggered, 'blink-border': cornerPress.bottomLeft.blinking }]"
              title="Corner Bottom-Left (Hold to move)"
              @mousedown="startCornerPress('bottom-left', $event)"
              @mouseup="endCornerPress('bottom-left')"
              @mouseleave="cancelCornerPress('bottom-left')"
              @touchstart="startCornerPress('bottom-left', $event)"
              @touchend="endCornerPress('bottom-left')"
              @touchcancel="cancelCornerPress('bottom-left')"
            >
              <div class="long-press-indicator long-press-horizontal" :style="{ width: `${cornerPress.bottomLeft.progress || 0}%` }"></div>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16 18H8V10" stroke="currentColor" stroke-width="3" stroke-linecap="square"/>
              </svg>
            </button>
            <button
              :class="['control', 'corner-btn', { 'long-press-triggered': cornerPress.bottomRight.triggered, 'blink-border': cornerPress.bottomRight.blinking }]"
              title="Corner Bottom-Right (Hold to move)"
              @mousedown="startCornerPress('bottom-right', $event)"
              @mouseup="endCornerPress('bottom-right')"
              @mouseleave="cancelCornerPress('bottom-right')"
              @touchstart="startCornerPress('bottom-right', $event)"
              @touchend="endCornerPress('bottom-right')"
              @touchcancel="cancelCornerPress('bottom-right')"
            >
              <div class="long-press-indicator long-press-horizontal" :style="{ width: `${cornerPress.bottomRight.progress || 0}%` }"></div>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 18H16V10" stroke="currentColor" stroke-width="3" stroke-linecap="square"/>
              </svg>
            </button>
          </div>
          <button
            :class="['control', 'park-btn-wide', { 'long-press-triggered': parkPress.saved, 'blink-border': parkPress.blinking }]"
            title="Park (Hold 1.5s to go, 3s to save)"
            @mousedown="startParkPress($event)"
            @mouseup="endParkPress()"
            @mouseleave="cancelParkPress()"
            @touchstart="startParkPress($event)"
            @touchend="endParkPress()"
            @touchcancel="cancelParkPress()"
          >
            <div class="long-press-indicator long-press-horizontal" :style="{ width: `${parkPress.progress || 0}%` }"></div>
            Park
          </button>
        </div>
      </div>
    </div>

    <!-- Parking not set dialog -->
    <Dialog v-if="showParkingDialog" @close="showParkingDialog = false" :show-header="false" size="small" :z-index="10000">
      <ConfirmPanel
        title="Parking Location Not Set"
        message="No parking location is saved yet. Please move your spindle to the desired location and continuously press the Park button for at least 3 seconds."
        :show-cancel="false"
        confirm-text="Close"
        variant="primary"
        @confirm="showParkingDialog = false"
      />
    </Dialog>
  </section>
</template>

<script setup lang="ts">
import { api, jogStart, jogStop, jogHeartbeat, jogStep } from './api';
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch } from 'vue';
import { useJogStore } from './store';
import Dialog from '../../components/Dialog.vue';
import ConfirmPanel from '../../components/ConfirmPanel.vue';

const store = useJogStore();

const emit = defineEmits<{
  (e: 'update:stepSize', value: number): void;
}>();

type AxisHome = 'min' | 'max';
type MachineOrientation = {
  xHome: AxisHome;
  yHome: AxisHome;
  zHome: AxisHome;
  homeCorner: 'front-left' | 'front-right' | 'back-left' | 'back-right';
};

const props = defineProps<{
  jogConfig: {
    stepSize: number;
    stepOptions: number[];
  };
  isDisabled?: boolean;
  machineCoords?: { x: number; y: number; z: number };
  gridSizeX?: number;
  gridSizeY?: number;
  zMaxTravel?: number | null;
  machineOrientation?: MachineOrientation;
}>();

// Feed rate management based on step size
const feedRateDefaults = {
  0.1: 500,
  1: 3000,
  10: 8000
};

const defaultOrientation: MachineOrientation = {
  xHome: 'min',
  yHome: 'max',
  zHome: 'max',
  homeCorner: 'back-left'
};

const orientation = computed(() => props.machineOrientation ?? defaultOrientation);

const computeAxisBounds = (size: number | undefined, home: AxisHome) => {
  const travel = typeof size === 'number' && size > 0 ? size : 0;
  if (home === 'max') {
    return {
      min: -travel,
      max: 0
    };
  }
  return {
    min: 0,
    max: travel
  };
};

const xAxisBounds = computed(() => computeAxisBounds(props.gridSizeX, orientation.value.xHome));
const yAxisBounds = computed(() => computeAxisBounds(props.gridSizeY, orientation.value.yHome));

const formatMachineCoord = (value: number) => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(3));
  const normalized = Math.abs(rounded) < 1e-6 ? 0 : rounded;
  return normalized.toString();
};

const safeZValue = computed(() => {
  const travel = typeof props.zMaxTravel === 'number' && props.zMaxTravel > 0 ? props.zMaxTravel : null;
  if (orientation.value.zHome === 'max') {
    const offset = travel != null ? Math.min(5, travel) : 5;
    return -offset;
  }
  if (travel != null) {
    return travel > 5 ? travel - 5 : travel;
  }
  return 5;
});

const safeZCommand = computed(() => formatMachineCoord(safeZValue.value));

const getCornerPosition = (corner: CornerType) => {
  const xBounds = xAxisBounds.value;
  const yBounds = yAxisBounds.value;
  const x = (corner === 'top-left' || corner === 'bottom-left') ? xBounds.min : xBounds.max;
  const y = (corner === 'top-left' || corner === 'top-right') ? yBounds.max : yBounds.min;
  return { x, y };
};

const feedRateInput = ref(String(feedRateDefaults[props.jogConfig.stepSize as keyof typeof feedRateDefaults] || 500));
const feedRate = ref(feedRateDefaults[props.jogConfig.stepSize as keyof typeof feedRateDefaults] || 500);

// Watch for step size changes and update feed rate
watch(() => props.jogConfig.stepSize, (newStepSize) => {
  const defaultRate = feedRateDefaults[newStepSize as keyof typeof feedRateDefaults] || 500;
  feedRate.value = defaultRate;
  feedRateInput.value = String(defaultRate);
});

const handleFeedRateInput = (event: Event) => {
  const input = event.target as HTMLInputElement;
  let value = input.value;

  // Only allow numbers and decimal point
  value = value.replace(/[^\d.]/g, '');

  // Ensure only one decimal point
  const parts = value.split('.');
  if (parts.length > 2) {
    value = parts[0] + '.' + parts.slice(1).join('');
  }

  // Limit to 2 decimal places
  if (parts.length === 2 && parts[1].length > 2) {
    value = parts[0] + '.' + parts[1].substring(0, 2);
  }

  feedRateInput.value = value;
};

const validateFeedRate = () => {
  const parsed = parseFloat(feedRateInput.value);

  if (isNaN(parsed) || parsed <= 0) {
    // Reset to default for current step size
    const defaultRate = feedRateDefaults[props.jogConfig.stepSize as keyof typeof feedRateDefaults] || 500;
    feedRate.value = defaultRate;
    feedRateInput.value = String(defaultRate);
  } else {
    feedRate.value = parsed;
    feedRateInput.value = parsed.toFixed(2);
  }
};

// Disable the entire panel only when disconnected or explicitly disabled
const panelDisabled = computed(() => !store.isConnected.value || props.isDisabled || store.isProbing.value);

// Disable motion controls when disconnected, explicitly disabled, not homed, or probing
const motionControlsDisabled = computed(() => !store.isConnected.value || props.isDisabled || !store.isHomed.value || store.isProbing.value);

// Computed to check if homing is in progress
const isHoming = computed(() => (store.senderStatus.value || '').toLowerCase() === 'homing');

let jogTimer: number | null = null;
let heartbeatTimer: number | null = null;
let isLongPress = false;
let activeJogId: string | null = null;

const HEARTBEAT_INTERVAL_MS = 250;

const createJogId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const startHeartbeat = (jogId: string) => {
  stopHeartbeat();
  jogHeartbeat(jogId);
  heartbeatTimer = window.setInterval(() => {
    jogHeartbeat(jogId);
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
    await jogStep({
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
    await jogStep({
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
  const jogFeedRate = axis === 'Z' ? feedRate.value / 2 : feedRate.value;
  // Ensure proper spacing between modal codes (G21 G91) for GRBL compatibility
  const command = `$J=G21 G91 ${axis}${3000 * direction} F${jogFeedRate}`;
  const jogId = createJogId();
  activeJogId = jogId;

  try {
    await jogStart({
      jogId,
      command,
      displayCommand: command,
      axis,
      direction,
      feedRate: jogFeedRate
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
  // Ensure proper spacing between modal codes (G21 G91) for GRBL compatibility
  const command = `$J=G21 G91 X${3000 * xDirection} Y${3000 * yDirection} F${feedRate.value}`;
  const jogId = createJogId();
  activeJogId = jogId;

  try {
    await jogStart({
      jogId,
      command,
      displayCommand: command,
      axis: 'XY',
      direction: null,
      feedRate: feedRate.value
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

const handleJogStart = (axis: 'X' | 'Y' | 'Z', direction: 1 | -1, event?: Event) => {
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

const handleJogDiagonalStart = (xDirection: 1 | -1, yDirection: 1 | -1, event?: Event) => {
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

const handleJogEnd = (axis: 'X' | 'Y' | 'Z', direction: 1 | -1, event?: Event) => {
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

const handleJogDiagonalEnd = (xDirection: 1 | -1, yDirection: 1 | -1, event?: Event) => {
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

  jogStop(jogId).catch((error) => {
    console.error('Failed to stop jog session:', error);
  });
};

const handleHomeDoubleClick = () => {
  const now = performance.now();
  if (now - lastHomeClickTime < DOUBLE_CLICK_THRESHOLD_MS) {
    // Double-click detected - expand to HX, HY, HZ
    homeSplit.value = true;
    lastHomeClickTime = 0; // Reset to prevent triple-click issues
  } else {
    // First click - record time
    lastHomeClickTime = now;
  }
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

// --- Home split (HX/HY/HZ) via double-click ---
const homeSplit = ref(false);
const homeGroupRef = ref<HTMLElement | null>(null);
const LONG_PRESS_MS_HOME = 1500;
const DELAY_BEFORE_VISUAL_MS = 150;
const homePress = reactive<{ start: number; progress: number; raf?: number; active: boolean; triggered: boolean; touchUsed: boolean; blinking: boolean }>({ start: 0, progress: 0, active: false, triggered: false, touchUsed: false, blinking: false });
let homeActive = false;
let lastHomeClickTime = 0;

// Home split buttons (HX/HY/HZ) with long-press
const homeSplitPress = reactive({
  X: { start: 0, progress: 0, raf: undefined as number | undefined, active: false, triggered: false, blinking: false },
  Y: { start: 0, progress: 0, raf: undefined as number | undefined, active: false, triggered: false, blinking: false },
  Z: { start: 0, progress: 0, raf: undefined as number | undefined, active: false, triggered: false, blinking: false }
});

type HomeSplitAxisType = 'X' | 'Y' | 'Z';

const startHomePress = (_evt?: Event) => {
  const isTouch = _evt?.type === 'touchstart';

  if (_evt) {
    _evt.preventDefault();
  }

  // Track if touch event was used
  if (isTouch) {
    homePress.touchUsed = true;
  }

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

    // Delay the visual indicator
    if (elapsed < DELAY_BEFORE_VISUAL_MS) {
      homePress.progress = 0;
    } else {
      const adjustedElapsed = elapsed - DELAY_BEFORE_VISUAL_MS;
      const pct = Math.min(100, (adjustedElapsed / (LONG_PRESS_MS_HOME - DELAY_BEFORE_VISUAL_MS)) * 100);
      homePress.progress = pct;
    }

    if (elapsed >= LONG_PRESS_MS_HOME && !homePress.triggered) {
      homePress.triggered = true;
      goHome(); // Execute home command
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

  // If not triggered (incomplete press), handle tap/double-tap for touch
  if (!homePress.triggered && homePress.active) {
    homePress.active = false;
    homeActive = false;
    homePress.progress = 0;

    // Handle double-tap for touch events
    if (homePress.touchUsed) {
      handleHomeDoubleClick();
    } else {
      homePress.blinking = true;
      setTimeout(() => {
        homePress.blinking = false;
      }, 400);
    }
  } else {
    homePress.active = false;
    homeActive = false;
    homePress.progress = 0;
  }

  // Reset triggered after delay
  setTimeout(() => {
    homePress.triggered = false;
    homePress.touchUsed = false;
  }, 100);
};

const cancelHomePress = () => {
  if (homePress.raf) cancelAnimationFrame(homePress.raf);
  homePress.raf = undefined;
  homePress.active = false;
  homeActive = false;
  homePress.progress = 0;
  homePress.triggered = false;
  homePress.touchUsed = false;
  homePress.blinking = false;
};

// Click outside to collapse back to single Home or XY0
const handleGlobalClick = (e: MouseEvent | TouchEvent) => {
  const target = e.target as Node | null;

  // Handle home split collapse
  if (homeSplit.value) {
    const homeContainer = homeGroupRef.value;
    if (homeContainer && (!target || !homeContainer.contains(target))) {
      homeSplit.value = false;
    }
  }

  // Handle axis-zero split collapse
  if (axisZeroSplit.value) {
    const axisZeroContainer = axisZeroGroupRef.value;
    if (axisZeroContainer && (!target || !axisZeroContainer.contains(target))) {
      axisZeroSplit.value = false;
    }
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
    await api.sendCommandViaWebSocket({
      command: `$H${axis}`,
      displayCommand: `$H${axis}`
    });
  } catch (error) {
    console.error(`Failed to home ${axis}:`, error);
  }
};

const getHomeSplitPressState = (axis: HomeSplitAxisType) => {
  return homeSplitPress[axis];
};

const startHomeSplitPress = (axis: HomeSplitAxisType, _evt?: Event) => {
  if (_evt) _evt.preventDefault();
  if (isHoming.value) return;

  const state = getHomeSplitPressState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);

  state.start = performance.now();
  state.progress = 0;
  state.active = true;
  state.triggered = false;

  const tick = () => {
    if (!state.active) return;
    const elapsed = performance.now() - state.start;

    // Delay the visual indicator
    if (elapsed < DELAY_BEFORE_VISUAL_MS) {
      state.progress = 0;
    } else {
      const adjustedElapsed = elapsed - DELAY_BEFORE_VISUAL_MS;
      const pct = Math.min(100, (adjustedElapsed / (LONG_PRESS_MS_HOME - DELAY_BEFORE_VISUAL_MS)) * 100);
      state.progress = pct;
    }

    if (elapsed >= LONG_PRESS_MS_HOME && !state.triggered) {
      state.triggered = true;
      goHomeAxis(axis);
      state.progress = 0;
      state.active = false;
      return;
    }

    state.raf = requestAnimationFrame(tick);
  };

  state.raf = requestAnimationFrame(tick);
};

const endHomeSplitPress = (axis: HomeSplitAxisType) => {
  const state = getHomeSplitPressState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;

  // If not triggered (incomplete press), show blink feedback
  if (!state.triggered && state.active) {
    state.active = false;
    state.progress = 0;
    state.blinking = true;
    setTimeout(() => {
      state.blinking = false;
    }, 400);
  } else {
    state.active = false;
    state.progress = 0;
  }

  // Reset triggered after delay
  setTimeout(() => {
    state.triggered = false;
  }, 100);
};

const cancelHomeSplitPress = (axis: HomeSplitAxisType) => {
  const state = getHomeSplitPressState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;
  state.active = false;
  state.progress = 0;
  state.triggered = false;
  state.blinking = false;
};

// --- Parking location: 1.5s to go to park, 3s to save coordinates ---
const showParkingDialog = ref(false);
const LONG_PRESS_MS_PARK_GO = 1500;
const LONG_PRESS_MS_PARK_SAVE = 3000;
const parkPress = reactive<{ start: number; progress: number; raf?: number; active: boolean; triggered: boolean; saved: boolean; blinking: boolean }>({ start: 0, progress: 0, active: false, triggered: false, saved: false, blinking: false });

const goToPark = async () => {
  if (motionControlsDisabled.value) {
    return;
  }
  try {
    const response = await api.getSetting('parkingLocation');
    if (response === null || !response.parkingLocation) {
      // Not set - don't show dialog, user might be continuing to hold for save
      return;
    }
    // Parse parking location (format: "x,y,z")
    const [x, y, z] = response.parkingLocation.split(',').map(v => parseFloat(v));

    // Send parking G-code commands in sequence
    const safeZ = safeZCommand.value;
    const xStr = formatMachineCoord(x);
    const yStr = formatMachineCoord(y);
    await api.sendCommandViaWebSocket({ command: `G53 G90 G0 Z${safeZ}`, displayCommand: `G53 G90 G0 Z${safeZ}` });
    await api.sendCommandViaWebSocket({ command: `G53 G90 G0 X${xStr} Y${yStr}`, displayCommand: `G53 G90 G0 X${xStr} Y${yStr}` });
    const zStr = formatMachineCoord(z);
    await api.sendCommandViaWebSocket({ command: `G53 G90 G0 Z${zStr}`, displayCommand: `G53 G90 G0 Z${zStr}` });
  } catch (_err) {
    // Network or other errors: ignore during active press
    return;
  }
};

const startParkPress = (_evt?: Event) => {
  if (_evt) _evt.preventDefault();
  if (parkPress.raf) cancelAnimationFrame(parkPress.raf);
  parkPress.start = performance.now();
  parkPress.progress = 0;
  parkPress.active = true;
  parkPress.triggered = false;
  parkPress.saved = false;

  const tick = () => {
    if (!parkPress.active) return;
    const elapsed = performance.now() - parkPress.start;

    // Two-stage progress: 0-1.5s for go-to, 1.5-3s for save (reset and fill again)
    if (elapsed < DELAY_BEFORE_VISUAL_MS) {
      parkPress.progress = 0;
    } else if (elapsed < LONG_PRESS_MS_PARK_GO) {
      // Stage 1: Go to park (0-1.5s)
      const adjustedElapsed = elapsed - DELAY_BEFORE_VISUAL_MS;
      const pct = Math.min(100, (adjustedElapsed / (LONG_PRESS_MS_PARK_GO - DELAY_BEFORE_VISUAL_MS)) * 100);
      parkPress.progress = pct;
    } else if (elapsed < LONG_PRESS_MS_PARK_SAVE) {
      // Stage 2: Save coordinates (1.5-3s) - fill again from 0 to 100%
      const stage2Start = LONG_PRESS_MS_PARK_GO + DELAY_BEFORE_VISUAL_MS;
      if (elapsed < stage2Start) {
        parkPress.progress = 0;
      } else {
        const stage2Elapsed = elapsed - stage2Start;
        const stage2Duration = LONG_PRESS_MS_PARK_SAVE - stage2Start;
        const pct = Math.min(100, (stage2Elapsed / stage2Duration) * 100);
        parkPress.progress = pct;
      }
    }

    // Trigger save coordinates at 3s
    if (elapsed >= LONG_PRESS_MS_PARK_SAVE && !parkPress.saved) {
      parkPress.saved = true;
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

    // Mark at 1.5s but don't execute yet - wait for release
    if (elapsed >= LONG_PRESS_MS_PARK_GO && !parkPress.triggered) {
      parkPress.triggered = true;
    }

    parkPress.raf = requestAnimationFrame(tick);
  };

  parkPress.raf = requestAnimationFrame(tick);
};

const endParkPress = async () => {
  if (parkPress.raf) cancelAnimationFrame(parkPress.raf);
  parkPress.raf = undefined;

  const elapsed = performance.now() - parkPress.start;

  // < 1.5s: Cancel action (blink)
  if (elapsed < LONG_PRESS_MS_PARK_GO) {
    parkPress.active = false;
    parkPress.progress = 0;
    parkPress.blinking = true;
    setTimeout(() => {
      parkPress.blinking = false;
    }, 400);
  }
  // 1.5s to 3s: Execute go-to or show dialog if not set
  else if (elapsed >= LONG_PRESS_MS_PARK_GO && elapsed < LONG_PRESS_MS_PARK_SAVE && !parkPress.saved) {
    parkPress.active = false;
    parkPress.progress = 0;

    // Check if parking location exists and execute go-to
    try {
      const response = await api.getSetting('parkingLocation');
      if (response === null || !response.parkingLocation) {
        // No parking location - show dialog
        showParkingDialog.value = true;
      } else {
        // Execute go-to park
        goToPark();
      }
    } catch {
      showParkingDialog.value = true;
    }
  }
  // >= 3s: Already saved via the tick function
  else {
    parkPress.active = false;
    parkPress.progress = 0;
  }

  // Reset triggered after a short delay
  setTimeout(() => {
    parkPress.triggered = false;
    parkPress.saved = false;
  }, 100);
};

const cancelParkPress = () => {
  if (parkPress.raf) cancelAnimationFrame(parkPress.raf);
  parkPress.raf = undefined;
  parkPress.active = false;
  parkPress.progress = 0;
  parkPress.triggered = false;
  parkPress.saved = false;
};

// Zero axis buttons with long-press
const LONG_PRESS_MS_AXIS_ZERO = 1500;
const axisZeroPress = reactive({
  X: { start: 0, progress: 0, raf: undefined as number | undefined, active: false, triggered: false, blinking: false, touchUsed: false },
  Y: { start: 0, progress: 0, raf: undefined as number | undefined, active: false, triggered: false, blinking: false, touchUsed: false },
  Z: { start: 0, progress: 0, raf: undefined as number | undefined, active: false, triggered: false, blinking: false, touchUsed: false },
  XY: { start: 0, progress: 0, raf: undefined as number | undefined, active: false, triggered: false, blinking: false, touchUsed: false }
});

type AxisZeroType = 'X' | 'Y' | 'Z' | 'XY';

// XY0 split mode (similar to homeSplit)
const axisZeroSplit = ref(false);
const axisZeroGroupRef = ref<HTMLElement | null>(null);
let lastXY0ClickTime = 0;
const DOUBLE_CLICK_THRESHOLD_MS = 400;

const getAxisZeroPressState = (axis: AxisZeroType) => {
  return axisZeroPress[axis];
};

const handleXY0DoubleClick = () => {
  const now = performance.now();
  if (now - lastXY0ClickTime < DOUBLE_CLICK_THRESHOLD_MS) {
    // Double-click detected - expand to X0 and Y0
    axisZeroSplit.value = true;
    lastXY0ClickTime = 0; // Reset to prevent triple-click issues
  } else {
    // First click - record time
    lastXY0ClickTime = now;
  }
};

const startAxisZeroPress = (axis: AxisZeroType, _evt?: Event) => {
  const isTouch = _evt?.type === 'touchstart';

  if (_evt) {
    _evt.preventDefault();
  }

  if (motionControlsDisabled.value) return;

  const state = getAxisZeroPressState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);

  state.start = performance.now();
  state.progress = 0;
  state.active = true;
  state.triggered = false;
  state.touchUsed = isTouch;

  const tick = () => {
    if (!state.active) return;
    const elapsed = performance.now() - state.start;

    // Delay the visual indicator
    if (elapsed < DELAY_BEFORE_VISUAL_MS) {
      state.progress = 0;
    } else {
      const adjustedElapsed = elapsed - DELAY_BEFORE_VISUAL_MS;
      const pct = Math.min(100, (adjustedElapsed / (LONG_PRESS_MS_AXIS_ZERO - DELAY_BEFORE_VISUAL_MS)) * 100);
      state.progress = pct;
    }

    if (elapsed >= LONG_PRESS_MS_AXIS_ZERO && !state.triggered) {
      state.triggered = true;
      if (axis === 'XY') {
        goToZeroXY();
      } else {
        goToZero(axis);
      }
      state.progress = 0;
      state.active = false;
      return;
    }

    state.raf = requestAnimationFrame(tick);
  };

  state.raf = requestAnimationFrame(tick);
};

const endAxisZeroPress = (axis: AxisZeroType) => {
  const state = getAxisZeroPressState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;

  // If not triggered (incomplete press), handle tap/double-tap for touch
  if (!state.triggered && state.active) {
    state.active = false;
    state.progress = 0;

    // Handle double-tap for touch events on XY0 button
    if (state.touchUsed && axis === 'XY') {
      handleXY0DoubleClick();
    } else {
      state.blinking = true;
      setTimeout(() => {
        state.blinking = false;
      }, 400);
    }
  } else {
    state.active = false;
    state.progress = 0;
  }

  // Reset triggered after delay
  setTimeout(() => {
    state.triggered = false;
    state.touchUsed = false;
  }, 100);
};

const cancelAxisZeroPress = (axis: AxisZeroType) => {
  const state = getAxisZeroPressState(axis);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;
  state.active = false;
  state.progress = 0;
  state.triggered = false;
  state.touchUsed = false;
};

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

const goToZeroXY = async () => {
  if (motionControlsDisabled.value) {
    return;
  }
  try {
    await api.sendCommandViaWebSocket({
      command: 'G90 G0 X0 Y0',
      displayCommand: 'G90 G0 X0 Y0'
    });
  } catch (error) {
    console.error('Failed to move XY to zero:', error);
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

// Corner button long-press handlers
const LONG_PRESS_MS_CORNER = 1500;
const cornerPress = reactive({
  topLeft: { start: 0, progress: 0, raf: undefined as number | undefined, active: false, triggered: false, blinking: false },
  topRight: { start: 0, progress: 0, raf: undefined as number | undefined, active: false, triggered: false, blinking: false },
  bottomLeft: { start: 0, progress: 0, raf: undefined as number | undefined, active: false, triggered: false, blinking: false },
  bottomRight: { start: 0, progress: 0, raf: undefined as number | undefined, active: false, triggered: false, blinking: false }
});

type CornerType = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const getCornerPressState = (corner: CornerType) => {
  switch (corner) {
    case 'top-left': return cornerPress.topLeft;
    case 'top-right': return cornerPress.topRight;
    case 'bottom-left': return cornerPress.bottomLeft;
    case 'bottom-right': return cornerPress.bottomRight;
  }
};

const startCornerPress = (corner: CornerType, _evt?: Event) => {
  if (_evt) _evt.preventDefault();
  if (motionControlsDisabled.value) return;

  const state = getCornerPressState(corner);
  if (state.raf) cancelAnimationFrame(state.raf);

  state.start = performance.now();
  state.progress = 0;
  state.active = true;
  state.triggered = false;

  const tick = () => {
    if (!state.active) return;
    const elapsed = performance.now() - state.start;

    // Delay the visual indicator
    if (elapsed < DELAY_BEFORE_VISUAL_MS) {
      state.progress = 0;
    } else {
      const adjustedElapsed = elapsed - DELAY_BEFORE_VISUAL_MS;
      const pct = Math.min(100, (adjustedElapsed / (LONG_PRESS_MS_CORNER - DELAY_BEFORE_VISUAL_MS)) * 100);
      state.progress = pct;
    }

    if (elapsed >= LONG_PRESS_MS_CORNER && !state.triggered) {
      state.triggered = true;
      goToCorner(corner);
      state.progress = 0;
      state.active = false;
      return;
    }

    state.raf = requestAnimationFrame(tick);
  };

  state.raf = requestAnimationFrame(tick);
};

const endCornerPress = (corner: CornerType) => {
  const state = getCornerPressState(corner);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;

  // If not triggered (incomplete press), show blink feedback
  if (!state.triggered && state.active) {
    state.active = false;
    state.progress = 0;
    state.blinking = true;
    setTimeout(() => {
      state.blinking = false;
    }, 400);
  } else {
    state.active = false;
    state.progress = 0;
  }

  // Reset triggered after delay
  setTimeout(() => {
    state.triggered = false;
  }, 100);
};

const cancelCornerPress = (corner: CornerType) => {
  const state = getCornerPressState(corner);
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;
  state.active = false;
  state.progress = 0;
  state.triggered = false;
};

// Corner movement function
const goToCorner = async (corner: CornerType) => {
  if (motionControlsDisabled.value) {
    return;
  }
  const { x, y } = getCornerPosition(corner);
  const safeZ = safeZCommand.value;
  const xStr = formatMachineCoord(x);
  const yStr = formatMachineCoord(y);

  try {
    // Always move to safe Z height first
    await api.sendCommandViaWebSocket({ command: `G53 G90 G0 Z${safeZ}`, displayCommand: `G53 G90 G0 Z${safeZ}` });

    await api.sendCommandViaWebSocket({ command: `G53 G90 G0 X${xStr} Y${yStr}`, displayCommand: `G53 G90 G0 X${xStr} Y${yStr}` });
  } catch (error) {
    console.error('Failed to move to corner:', error);
  }
};
</script>

<style scoped>
.controls-disabled {
  opacity: 0.6;
}

.controls-disabled .step-selector,
.controls-disabled .jog-layout,
.controls-disabled .home-group {
  pointer-events: none;
}

.controls-disabled input,
.controls-disabled button {
  cursor: not-allowed !important;
}
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
  min-width: 50px;
}

.chip.active {
  background: var(--gradient-accent);
  color: #fff;
}

.step-label,
.feed-rate-label {
  font-size: 0.85rem;
}

.feed-rate-input {
  width: 70px;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  text-align: center;
  transition: border-color 0.2s ease;
}

.feed-rate-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.feed-rate-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.6;
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
  width: 60px;
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
  min-width: 120px;
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
  position: relative;
  overflow: hidden;
}

.corner-btn svg {
  width: 20px;
  height: 20px;
  color: var(--color-text-primary);
  position: relative;
  z-index: 1;
}

/* Ensure visibility over accent-pressed background for corners */
.corner-btn:active .long-press-indicator {
  background: rgba(255, 255, 255, 0.35);
  opacity: 1;
}

/* Blink border animation for incomplete press */
@keyframes blink-border {
  0%, 100% { border-color: #ff6b6b; }
  50% { border-color: var(--color-border); }
}

.control.blink-border {
  animation: blink-border 0.4s ease-in-out;
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
  min-width: 55px;
  height: 180px;
  position: relative;
}

.axis-zero-btn {
  flex: 1;
  font-weight: 800;
  position: relative;
  overflow: hidden;
}

/* Container for XY buttons that maintains space */
.axis-zero-xy-container {
  flex: 2;
  position: relative;
  min-height: 0;
  display: flex;
}

/* XY0 combined button occupies the space of 2 buttons */
.axis-zero-xy-combined {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

/* Split XY container */
.axis-zero-split-xy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.axis-zero-split-xy .axis-zero-btn {
  flex: 1;
}

/* Ensure visibility over accent-pressed background for axis zero */
.axis-zero-btn:active .long-press-indicator {
  background: rgba(255, 255, 255, 0.35);
  opacity: 1;
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

/* Ensure visibility over accent-pressed background for home */
.home-button.is-holding .long-press-indicator,
.home-button:active .long-press-indicator {
  background: rgba(255, 255, 255, 0.35);
  opacity: 1;
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
  /* Don't set fixed height on axis-zero-btn - let flex handle it */
  .axis-zero-btn {
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
  .axis-zero-column { height: var(--jog-col-height); display: flex; flex-direction: column; }
  .axis-zero-xy-container { flex: 2; }
  .corner-simple { height: var(--jog-col-height); }
}

/* Tablet portrait: keep zero column narrow so cards do not overflow */
@media (max-width: 1279px) and (min-width: 960px) {
  .axis-zero-column {
    width: 80px;
    gap: 4px;
  }
  /* Don't set fixed height on axis-zero-btn - let flex handle it */
  .axis-zero-btn {
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
  position: relative;
  overflow: hidden;
}

/* Long press indicator - base styles */
.long-press-indicator {
  position: absolute;
  background: var(--color-accent);
  opacity: 0.22;
  pointer-events: none;
}

/* Vertical fill (bottom to top) */
.long-press-vertical {
  left: 0;
  bottom: 0;
  width: 100%;
  height: 0%;
}

/* Horizontal fill (left to right) */
.long-press-horizontal {
  left: 0;
  top: 0;
  width: 0%;
  height: 100%;
}

/* Ensure visibility over accent-pressed background for home split buttons */
.home-split-btn:active .long-press-indicator {
  background: rgba(255, 255, 255, 0.35);
  opacity: 1;
}

/* Park button container needs relative positioning and overflow hidden */
.park-btn-wide {
  position: relative;
  overflow: hidden;
}

/* Ensure visibility over accent-pressed background for park */
.park-btn-wide:active .long-press-indicator {
  background: rgba(255, 255, 255, 0.35);
  opacity: 1;
}

/* Remove highlight when long press is triggered */
.control.long-press-triggered {
  background: var(--color-surface-muted) !important;
  color: var(--color-text-primary) !important;
  transform: none !important;
  box-shadow: none !important;
  border: 1px solid var(--color-border) !important;
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

/* Transition animations for expanding/collapsing XY0 -> X0/Y0 */
.axis-zero-split-enter-active,
.axis-zero-split-leave-active,
.axis-zero-main-enter-active,
.axis-zero-main-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
  will-change: opacity, transform;
}

.axis-zero-split-enter-from,
.axis-zero-main-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

.axis-zero-split-enter-to,
.axis-zero-main-leave-from {
  opacity: 1;
  transform: scale(1);
}

.axis-zero-split-leave-from,
.axis-zero-main-enter-to {
  opacity: 1;
  transform: scale(1);
}

.axis-zero-split-leave-to,
.axis-zero-main-enter-from {
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

/* Simple confirm dialog styling (mirrors GCodeVisualizer). */
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
