/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

import { ref, reactive, watch, onUnmounted } from 'vue';
import { sendRealtime, REALTIME } from '@/features/status/api';
import { useAppStore } from './use-app-store';

const SETTLE_MS = 500;
const SEND_DEBOUNCE_MS = 100;

export const OVERRIDE_MIN = 10;
export const OVERRIDE_MAX = 200;

interface OverrideCommands {
  reset: string;
  plus10: string;
  minus10: string;
  plus1: string;
  minus1: string;
}

const FEED_COMMANDS: OverrideCommands = {
  reset: REALTIME.FEED_RESET,
  plus10: REALTIME.FEED_PLUS_10,
  minus10: REALTIME.FEED_MINUS_10,
  plus1: REALTIME.FEED_PLUS_1,
  minus1: REALTIME.FEED_MINUS_1
};

const SPINDLE_COMMANDS: OverrideCommands = {
  reset: REALTIME.SPINDLE_RESET,
  plus10: REALTIME.SPINDLE_PLUS_10,
  minus10: REALTIME.SPINDLE_MINUS_10,
  plus1: REALTIME.SPINDLE_PLUS_1,
  minus1: REALTIME.SPINDLE_MINUS_1
};

export const clampOverride = (value: number) =>
  Math.min(OVERRIDE_MAX, Math.max(OVERRIDE_MIN, Math.round(value)));

export function overrideCommandsFor(from: number, to: number, commands: OverrideCommands): string[] {
  if (to === from) return [];
  if (to === 100) return [commands.reset];
  const diff = to - from;
  const tens = Math.trunc(Math.abs(diff) / 10);
  const ones = Math.abs(diff) % 10;
  const out: string[] = [];
  for (let i = 0; i < tens; i++) out.push(diff > 0 ? commands.plus10 : commands.minus10);
  for (let i = 0; i < ones; i++) out.push(diff > 0 ? commands.plus1 : commands.minus1);
  return out;
}

function createOverride(readReported: () => number, commands: OverrideCommands) {
  const value = ref(100);
  let sentValue = 100;
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const send = (command: string) => {
    sendRealtime(command).catch((error) => {
      console.error('Failed to send real-time command:', command, error);
    });
  };

  watch(readReported, (reported) => {
    if (sendTimer || settleTimer || typeof reported !== 'number') return;
    value.value = reported;
    sentValue = reported;
  }, { immediate: true });

  const flush = () => {
    sendTimer = null;
    const target = value.value;
    overrideCommandsFor(sentValue, target, commands).forEach(send);
    sentValue = target;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settleTimer = null; }, SETTLE_MS);
  };

  const set = (target: number) => {
    value.value = clampOverride(target);
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(flush, SEND_DEBOUNCE_MS);
  };

  const dispose = () => {
    if (sendTimer) clearTimeout(sendTimer);
    if (settleTimer) clearTimeout(settleTimer);
  };

  return reactive({
    value,
    set,
    step: (delta: number) => set(value.value + delta),
    reset: () => set(100),
    dispose
  });
}

export function useOverrideControls() {
  const appStore = useAppStore();

  const feed = createOverride(() => appStore.status.feedrateOverride, FEED_COMMANDS);
  const spindle = createOverride(() => appStore.status.spindleOverride, SPINDLE_COMMANDS);

  let repeatDelay: ReturnType<typeof setTimeout> | null = null;
  let repeatTimer: ReturnType<typeof setInterval> | null = null;
  const stopRepeat = () => {
    if (repeatDelay) clearTimeout(repeatDelay);
    if (repeatTimer) clearInterval(repeatTimer);
    repeatDelay = null;
    repeatTimer = null;
  };
  const startRepeat = (stepOnce: () => void) => {
    stopRepeat();
    stepOnce();
    repeatDelay = setTimeout(() => {
      repeatTimer = setInterval(stepOnce, 150);
    }, 400);
  };

  onUnmounted(() => {
    stopRepeat();
    feed.dispose();
    spindle.dispose();
  });

  return {
    feed,
    spindle,
    startRepeat,
    stopRepeat
  };
}
