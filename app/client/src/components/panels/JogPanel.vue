<template>
  <section class="card" :class="{ 'is-disabled': isDisabled }">
    <header class="card__header">
      <h2>Jog Controls</h2>
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
    </header>
    <div class="jog-layout">
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
        <div class="center-indicator"></div>
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
      
      <!-- Z Controls on the side -->
      <div class="z-home-controls">
        <div class="z-controls">
          <button :class="['control', 'z-button', { pressed: isButtonPressed('Z-1') }]" aria-label="Jog Z positive"
                  @mousedown="jogStart('Z', 1, $event)" @mouseup="jogEnd('Z', 1, $event)"
                  @touchstart="jogStart('Z', 1, $event)" @touchend="jogEnd('Z', 1, $event)">Z+</button>
          <button :class="['control', 'z-button', { pressed: isButtonPressed('Z--1') }]" aria-label="Jog Z negative"
                  @mousedown="jogStart('Z', -1, $event)" @mouseup="jogEnd('Z', -1, $event)"
                  @touchstart="jogStart('Z', -1, $event)" @touchend="jogEnd('Z', -1, $event)">Z-</button>
        </div>
        <button class="control home-button" @click="goHome">Home</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { api } from '../../lib/api.js';
import { ref, onMounted, onBeforeUnmount } from 'vue';

const emit = defineEmits<{
  (e: 'update:stepSize', value: number): void;
}>();

const props = defineProps<{
  jogConfig: {
    stepSize: number;
    stepOptions: number[];
  };
  isDisabled?: boolean;
}>();

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
</script>

<style scoped>
.card.is-disabled {
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
  gap: var(--gap-md);
  align-items: center;
}

.xy-joystick {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 4px;
  width: 180px;
  height: 180px;
}

.center-indicator {
  width: 100%;
  height: 100%;
  border: 2px solid var(--color-border);
  border-radius: 50%;
  background: var(--color-surface);
  position: relative;
}

.center-indicator::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  background: var(--color-text-secondary);
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
  border: 2px solid transparent;
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

.control:hover {
  border: 2px solid var(--color-accent);
}

.control:active,
.control.pressed {
  background: var(--color-accent);
  color: white;
  transform: scale(0.98);
  box-shadow: 0 0 10px rgba(26, 188, 156, 0.5);
  border: 2px solid var(--color-accent);
}

.control.corner {
  font-size: 1.2rem;
}

.control.axis {
  font-weight: bold;
}

.z-home-controls {
  display: flex;
  gap: var(--gap-xs);
}

.z-controls {
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
  height: 180px;
}

.z-button {
  width: 60px;
  flex: 1; /* Each button takes equal height */
  background: var(--color-surface-muted);
  font-weight: bold;
}

.home-button {
  width: 60px;
  height: 180px;
  background: var(--color-surface-muted);
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
    flex-direction: row;
    height: auto;
    width: 150px;
  }
  
  .z-button {
    flex: 1;
    height: 50px;
  }
}
</style>
