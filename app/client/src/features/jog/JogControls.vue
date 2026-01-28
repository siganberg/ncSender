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
  <div class="jog-controls" :class="[{ 'jog-disabled': disabled }, customClass]">
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
        <button class="jog-center" @click="handleCenterClick" aria-label="Soft Reset" title="Stop / Soft Reset">
          <svg viewBox="0 0 24 24" fill="currentColor" class="stop-icon">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </button>
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
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useAppStore } from '@/composables/use-app-store';
import {formatJogFeedRate, formatStepSize, formatStepSizeJogDisplay} from '@/lib/units';

const props = withDefaults(defineProps<{
  currentStep?: number;
  disabled?: boolean;
  feedRate?: number;
  customClass?: string;
  xTravel?: number;
  yTravel?: number;
  zTravel?: number;
}>(), {
  currentStep: 1,
  feedRate: 2000,
  disabled: false
});

const { unitsPreference } = useAppStore();

// Format step size for commands using centralized utility
const formatStepForCommand = (mmValue: number, continuous: boolean): string => {
  return formatStepSizeJogDisplay(mmValue, continuous, unitsPreference.value);
};


// Format feed rate for commands using centralized utility
const formatFeedRateForCommand = (mmPerMin: number): string => {
  return formatJogFeedRate(mmPerMin,  unitsPreference.value);
};

let jogTimer: number | null = null;
let heartbeatTimer: number | null = null;

// Handle center button click - send soft reset
const handleCenterClick = async () => {
  try {
    await api.sendCommandViaWebSocket({
      command: String.fromCharCode(0x18)
    });
  } catch (error) {
    console.error('Failed to send soft reset:', error);
  }
};
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

const DEFAULT_CONTINUOUS_DISTANCE = 400;

const getAxisTravel = (axis: 'X' | 'Y' | 'Z'): number => {
  const raw = axis === 'X' ? props.xTravel : axis === 'Y' ? props.yTravel : props.zTravel;
  const fallback = DEFAULT_CONTINUOUS_DISTANCE;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
};

const jog = async (axis: 'X' | 'Y' | 'Z', direction: 1 | -1) => {
  const isImperial = unitsPreference.value === 'imperial';
  const unitsCode = isImperial ? 'G20' : 'G21';
  const stepFormatted = formatStepForCommand(props.currentStep, false);
  const feedRateRaw = axis === 'Z' ? props.feedRate / 2 : props.feedRate;
  const feedRateFormatted = formatFeedRateForCommand(feedRateRaw);
  const distanceSign = direction > 0 ? '' : '-';
  const command = `$J=${unitsCode} G91 ${axis}${distanceSign}${stepFormatted} F${feedRateFormatted}`;
  try {
    await jogStep({
      command,
      displayCommand: command,
      axis,
      direction,
      feedRate: feedRateRaw,
      distance: Number(stepFormatted) * direction
    });
  } catch (error) {
    console.error('Failed to execute jog step:', error);
  }
};

const jogDiagonal = async (xDirection: 1 | -1, yDirection: 1 | -1) => {
  const isImperial = unitsPreference.value === 'imperial';
  const unitsCode = isImperial ? 'G20' : 'G21';
  const stepFormatted = formatStepForCommand(props.currentStep, false);
  const feedRateFormatted = formatFeedRateForCommand(props.feedRate);
  const xSign = xDirection > 0 ? '' : '-';
  const ySign = yDirection > 0 ? '' : '-';
  const command = `$J=${unitsCode} G91 X${xSign}${stepFormatted} Y${ySign}${stepFormatted} F${feedRateFormatted}`;
  try {
    await jogStep({
      command,
      displayCommand: command,
      axis: 'XY',
      direction: null,
      feedRate: props.feedRate,
      distance: { x: Number(stepFormatted) * xDirection, y: Number(stepFormatted) * yDirection }
    });
  } catch (error) {
    console.error('Failed to execute diagonal jog step:', error);
  }
};

const continuousJog = async (axis: 'X' | 'Y' | 'Z', direction: 1 | -1) => {
  const isImperial = unitsPreference.value === 'imperial';
  const unitsCode = isImperial ? 'G20' : 'G21';
  const feedRateRaw = axis === 'Z' ? props.feedRate / 2 : props.feedRate;
  const feedRateFormatted = formatFeedRateForCommand(feedRateRaw);
  const travel = getAxisTravel(axis);
  const travelFormatted = formatStepForCommand(travel, true);
  const travelSign = direction > 0 ? '' : '-';
  const command = `$J=${unitsCode} G91 ${axis}${travelSign}${travelFormatted} F${feedRateFormatted}`;
  const jogId = createJogId();
  activeJogId = jogId;

  try {
    await jogStart({
      jogId,
      command,
      displayCommand: command,
      axis,
      direction,
      feedRate: feedRateRaw
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
  const xTravel = getAxisTravel('X');
  const yTravel = getAxisTravel('Y');
  const isImperial = unitsPreference.value === 'imperial';
  const unitsCode = isImperial ? 'G20' : 'G21';
  const xTravelFormatted = formatStepForCommand(xTravel, true);
  const yTravelFormatted = formatStepForCommand(yTravel, true);
  const feedRateFormatted = formatFeedRateForCommand(props.feedRate);
  const xSign = xDirection > 0 ? '' : '-';
  const ySign = yDirection > 0 ? '' : '-';
  const command = `$J=${unitsCode} G91 X${xSign}${xTravelFormatted} Y${ySign}${yTravelFormatted} F${feedRateFormatted}`;
  const jogId = createJogId();
  activeJogId = jogId;

  try {
    await jogStart({
      jogId,
      command,
      displayCommand: command,
      axis: 'XY',
      direction: null,
      feedRate: props.feedRate
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

const stopJog = async () => {
  if (!activeJogId) {
    return;
  }

  const jogId = activeJogId;
  activeJogId = null;
  stopHeartbeat();

  try {
    await api.sendCommandViaWebSocket({
      command: String.fromCharCode(0x85)
    });
  } catch (error) {
    console.error('Failed to send immediate jog cancel:', error);
  }

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
  height: 100%;
}

.jog-disabled {
  pointer-events: none;
}

/* Disable all elements except center button */
.jog-disabled .jog-btn {
  opacity: 0.5;
}

.jog-disabled .jog-z {
  opacity: 0.5;
}

/* Stop button is ALWAYS enabled - even when jog is disabled (for emergency stop/unlock) */
.jog-disabled .jog-center {
  pointer-events: auto !important;
  opacity: 1 !important;
  cursor: pointer !important;
}

.jog-grid {
  display: flex;
  gap: 4px;
  align-items: stretch;
  justify-content: center;
  height: 100%;

}

.jog-xy {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 4px;
  width: 180px;
  height: 100%

}

.jog-controls.jog-controls-probe {
  height: unset;
}

.jog-controls-probe .jog-grid {
  height: unset;
}

.jog-controls-probe .jog-xy {

  height: 180px !important;;
}

.jog-controls-mobile .jog-xy {
  width: 100% !important;
}

.jog-controls-mobile .jog-z {
  width: 90px !important;
}

.plugin-dialog .jog-xy{
   width: 180px !important;
}



.jog-z {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 60px;
}

.jog-btn {
  border-radius: var(--radius-small) !important;
  border: 1px solid var(--color-border) !important;
  background: var(--color-surface-muted) !important;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  color: var(--color-text-primary) !important;
  -webkit-touch-callout: default;
  touch-action: manipulation;
  padding: unset !important;
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
  border: 1px solid #dc2626 !important;
  border-radius: var(--radius-small) !important;
  background: #dc2626 !important;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  color: white !important;
  font-size: 1rem;
  font-weight: 600;
  user-select: none;
  -webkit-touch-callout: default;
  touch-action: manipulation;
  padding: unset !important;
}

.jog-center:hover {
  background: #b91c1c !important;
  border-color: #b91c1c !important;
}

.jog-center:active {
  background: #991b1b !important;
  border-color: #991b1b !important;
  transform: scale(0.98);
}

.jog-center .stop-icon {
  width: 20px;
  height: 20px;
  color: white;
}
</style>
