<template>
  <div class="jog-controls" :class="{ 'jog-disabled': disabled }">
    <!-- Step selector with feed rate -->
    <div class="jog-step-selector">
      <span class="jog-label">Step</span>
      <button
        v-for="step in stepOptions"
        :key="step"
        :class="['chip', { active: step === currentStep }]"
        @click="$emit('update:step', step)"
      >
        {{ step }}
      </button>
      <span class="jog-label feed-rate-label">Feed Rate</span>
      <input
        type="text"
        class="feed-rate-input"
        :value="feedRateInput"
        @input="handleFeedRateInput"
        @blur="validateFeedRate"
        placeholder="0.00"
      />
    </div>

    <!-- XY Joystick + Z Controls -->
    <div class="jog-grid">
      <!-- XY Joystick (3x3 grid) -->
      <div class="jog-xy">
        <!-- Top Row -->
        <button
          :class="['jog-btn', 'jog-corner', { pressed: isButtonPressed('diagonal--1-1') }]"
          aria-label="Jog X negative Y positive"
          @mousedown="handleJogDiagonalStart(-1, 1, $event)"
          @mouseup="handleJogDiagonalEnd(-1, 1, $event)"
          @touchstart="handleJogDiagonalStart(-1, 1, $event)"
          @touchend="handleJogDiagonalEnd(-1, 1, $event)"
        >↖</button>
        <button
          :class="['jog-btn', 'jog-axis', { pressed: isButtonPressed('Y-1') }]"
          aria-label="Jog Y positive"
          @mousedown="handleJogStart('Y', 1, $event)"
          @mouseup="handleJogEnd('Y', 1, $event)"
          @touchstart="handleJogStart('Y', 1, $event)"
          @touchend="handleJogEnd('Y', 1, $event)"
        >Y+</button>
        <button
          :class="['jog-btn', 'jog-corner', { pressed: isButtonPressed('diagonal-1-1') }]"
          aria-label="Jog X positive Y positive"
          @mousedown="handleJogDiagonalStart(1, 1, $event)"
          @mouseup="handleJogDiagonalEnd(1, 1, $event)"
          @touchstart="handleJogDiagonalStart(1, 1, $event)"
          @touchend="handleJogDiagonalEnd(1, 1, $event)"
        >↗</button>

        <!-- Middle Row -->
        <button
          :class="['jog-btn', 'jog-axis', { pressed: isButtonPressed('X--1') }]"
          aria-label="Jog X negative"
          @mousedown="handleJogStart('X', -1, $event)"
          @mouseup="handleJogEnd('X', -1, $event)"
          @touchstart="handleJogStart('X', -1, $event)"
          @touchend="handleJogEnd('X', -1, $event)"
        >X-</button>
        <button class="jog-center" @click="$emit('center-click')" aria-label="Stop/Cancel"></button>
        <button
          :class="['jog-btn', 'jog-axis', { pressed: isButtonPressed('X-1') }]"
          aria-label="Jog X positive"
          @mousedown="handleJogStart('X', 1, $event)"
          @mouseup="handleJogEnd('X', 1, $event)"
          @touchstart="handleJogStart('X', 1, $event)"
          @touchend="handleJogEnd('X', 1, $event)"
        >X+</button>

        <!-- Bottom Row -->
        <button
          :class="['jog-btn', 'jog-corner', { pressed: isButtonPressed('diagonal--1--1') }]"
          aria-label="Jog X negative Y negative"
          @mousedown="handleJogDiagonalStart(-1, -1, $event)"
          @mouseup="handleJogDiagonalEnd(-1, -1, $event)"
          @touchstart="handleJogDiagonalStart(-1, -1, $event)"
          @touchend="handleJogDiagonalEnd(-1, -1, $event)"
        >↙</button>
        <button
          :class="['jog-btn', 'jog-axis', { pressed: isButtonPressed('Y--1') }]"
          aria-label="Jog Y negative"
          @mousedown="handleJogStart('Y', -1, $event)"
          @mouseup="handleJogEnd('Y', -1, $event)"
          @touchstart="handleJogStart('Y', -1, $event)"
          @touchend="handleJogEnd('Y', -1, $event)"
        >Y-</button>
        <button
          :class="['jog-btn', 'jog-corner', { pressed: isButtonPressed('diagonal-1--1') }]"
          aria-label="Jog X positive Y negative"
          @mousedown="handleJogDiagonalStart(1, -1, $event)"
          @mouseup="handleJogDiagonalEnd(1, -1, $event)"
          @touchstart="handleJogDiagonalStart(1, -1, $event)"
          @touchend="handleJogDiagonalEnd(1, -1, $event)"
        >↘</button>
      </div>

      <!-- Z Controls -->
      <div class="jog-z">
        <button
          :class="['jog-btn', 'jog-z-btn', { pressed: isButtonPressed('Z-1') }]"
          aria-label="Jog Z positive"
          @mousedown="handleJogStart('Z', 1, $event)"
          @mouseup="handleJogEnd('Z', 1, $event)"
          @touchstart="handleJogStart('Z', 1, $event)"
          @touchend="handleJogEnd('Z', 1, $event)"
        >Z+</button>
        <button
          :class="['jog-btn', 'jog-z-btn', { pressed: isButtonPressed('Z--1') }]"
          aria-label="Jog Z negative"
          @mousedown="handleJogStart('Z', -1, $event)"
          @mouseup="handleJogEnd('Z', -1, $event)"
          @touchstart="handleJogStart('Z', -1, $event)"
          @touchend="handleJogEnd('Z', -1, $event)"
        >Z-</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { api, jogStart, jogStop, jogHeartbeat, jogStep } from './api';
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';

const props = defineProps<{
  currentStep: number;
  stepOptions?: number[];
  disabled?: boolean;
  feedRate?: number;
}>();

defineEmits<{
  (e: 'update:step', value: number): void;
  (e: 'center-click'): void;
}>();

const stepOptions = props.stepOptions || [0.1, 1, 10];

// Feed rate management based on step size
const feedRateDefaults = {
  0.1: 500,
  1: 3000,
  10: 8000
};

const feedRateInput = ref(String(feedRateDefaults[props.currentStep as keyof typeof feedRateDefaults] || 500));
const feedRate = ref(feedRateDefaults[props.currentStep as keyof typeof feedRateDefaults] || 500);

// Watch for step size changes and update feed rate
watch(() => props.currentStep, (newStepSize) => {
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
    const defaultRate = feedRateDefaults[props.currentStep as keyof typeof feedRateDefaults] || 500;
    feedRate.value = defaultRate;
    feedRateInput.value = String(defaultRate);
  } else {
    feedRate.value = parsed;
    feedRateInput.value = parsed.toFixed(2);
  }
};

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
  const distance = props.currentStep * direction;
  const jogFeedRate = axis === 'Z' ? feedRate.value / 2 : feedRate.value;
  const command = `$J=G21 G91 ${axis}${distance} F${jogFeedRate}`;
  try {
    await jogStep({
      command,
      displayCommand: command,
      axis,
      direction,
      feedRate: jogFeedRate,
      distance
    });
  } catch (error) {
    console.error('Failed to execute jog step:', error);
  }
};

const jogDiagonal = async (xDirection: 1 | -1, yDirection: 1 | -1) => {
  const xDistance = props.currentStep * xDirection;
  const yDistance = props.currentStep * yDirection;
  const command = `$J=G21 G91 X${xDistance} Y${yDistance} F${feedRate.value}`;
  try {
    await jogStep({
      command,
      displayCommand: command,
      axis: 'XY',
      direction: null,
      feedRate: feedRate.value,
      distance: { x: xDistance, y: yDistance }
    });
  } catch (error) {
    console.error('Failed to execute diagonal jog step:', error);
  }
};

const continuousJog = async (axis: 'X' | 'Y' | 'Z', direction: 1 | -1) => {
  const jogFeedRate = axis === 'Z' ? feedRate.value / 2 : feedRate.value;
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

  if (props.disabled) {
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

  if (props.disabled) {
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
</script>

<style scoped>
.jog-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.jog-disabled {
  pointer-events: none;
}

/* Disable all elements except center button */
.jog-disabled .jog-step-selector {
  opacity: 0.5;
}

.jog-disabled .jog-btn {
  opacity: 0.5;
}

.jog-disabled .jog-z {
  opacity: 0.5;
}

/* Allow center button to be clickable and fully visible when disabled */
.jog-disabled .jog-center {
  pointer-events: auto;
  opacity: 1;
}

.jog-step-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}

.jog-label {
  font-size: 0.85rem;
  color: var(--color-text-primary);
}

.chip {
  border: none;
  border-radius: 999px;
  padding: 6px 12px;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  cursor: pointer;
  min-width: 50px;
  transition: all 0.2s ease;
}

.chip.active {
  background: var(--gradient-accent);
  color: #fff;
}

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

.jog-grid {
  display: flex;
  gap: 8px;
  align-items: stretch;
  justify-content: center;
}

.jog-xy {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 4px;
  width: 180px;
  height: 180px;
}

.jog-z {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 60px;
}

.jog-btn {
  border-radius: var(--radius-small);
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  color: var(--color-text-primary);
  -webkit-touch-callout: default;
  touch-action: manipulation;
}

.jog-btn:hover {
  border: 1px solid var(--color-accent);
}

.jog-btn:active,
.jog-btn.pressed {
  background: var(--color-accent);
  color: white;
  transform: scale(0.98);
  box-shadow: 0 0 10px rgba(26, 188, 156, 0.5);
  border: 1px solid var(--color-accent);
}

.jog-corner {
  font-size: 1.2rem;
}

.jog-axis {
  font-weight: bold;
}

.jog-z-btn {
  flex: 1;
  font-weight: bold;
}

.jog-center {
  width: 100%;
  height: 100%;
  border: 2px solid #ff6b6b;
  border-radius: 50%;
  background: var(--color-surface);
  position: relative;
  cursor: pointer;
  transition: all 0.2s ease;
}

.jog-center:hover {
  background: rgba(255, 107, 107, 0.1);
  border-color: #ff4444;
}

.jog-center:active {
  background: rgba(255, 107, 107, 0.2);
  transform: scale(0.95);
}

.jog-center::after {
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
</style>
