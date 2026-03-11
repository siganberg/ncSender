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

import { ref, watch, onUnmounted } from 'vue';
import { sendRealtime, REALTIME } from '@/features/status/api';
import { useAppStore } from './use-app-store';

const SETTLE_MS = 500;

export function useOverrideControls() {
  const appStore = useAppStore();

  const feedOverride = ref(100);
  const spindleOverride = ref(100);

  const previousFeedOverride = ref(100);
  const previousSpindleOverride = ref(100);

  const userInteracting = ref(false);
  let feedUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
  let spindleUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
  let feedSettleTimeout: ReturnType<typeof setTimeout> | null = null;
  let spindleSettleTimeout: ReturnType<typeof setTimeout> | null = null;

  const sendRealtimeCommand = (command: string) => {
    sendRealtime(command).catch((error) => {
      console.error('Failed to send real-time command:', command, error);
    });
  };

  // Sync slider values with status (only when user is not interacting and not settling)
  watch(() => appStore.status.feedrateOverride, (newValue) => {
    if (!userInteracting.value && !feedUpdateTimeout && !feedSettleTimeout) {
      feedOverride.value = newValue;
      previousFeedOverride.value = newValue;
    }
  }, { immediate: true });

  watch(() => appStore.status.spindleOverride, (newValue) => {
    if (!userInteracting.value && !spindleUpdateTimeout && !spindleSettleTimeout) {
      spindleOverride.value = newValue;
      previousSpindleOverride.value = newValue;
    }
  }, { immediate: true });

  const updateFeedOverride = () => {
    if (feedUpdateTimeout) {
      clearTimeout(feedUpdateTimeout);
    }

    feedUpdateTimeout = setTimeout(() => {
      const target = Number(feedOverride.value);
      const previous = Number(previousFeedOverride.value);
      const diff = target - previous;
      feedUpdateTimeout = null;

      if (diff === 0) return;

      if (target === 100) {
        sendRealtimeCommand(REALTIME.FEED_RESET);
      } else if (diff > 0) {
        const steps = Math.abs(diff) / 10;
        for (let i = 0; i < steps; i++) sendRealtimeCommand(REALTIME.FEED_PLUS_10);
      } else {
        const steps = Math.abs(diff) / 10;
        for (let i = 0; i < steps; i++) sendRealtimeCommand(REALTIME.FEED_MINUS_10);
      }

      previousFeedOverride.value = target;

      // Block watcher while GRBL processes the commands
      if (feedSettleTimeout) clearTimeout(feedSettleTimeout);
      feedSettleTimeout = setTimeout(() => { feedSettleTimeout = null; }, SETTLE_MS);
    }, 100);
  };

  const handleFeedOverrideComplete = () => {
    userInteracting.value = false;
  };

  const resetFeedOverride = () => {
    if (feedUpdateTimeout) {
      clearTimeout(feedUpdateTimeout);
      feedUpdateTimeout = null;
    }
    if (feedSettleTimeout) {
      clearTimeout(feedSettleTimeout);
      feedSettleTimeout = null;
    }
    sendRealtimeCommand(REALTIME.FEED_RESET);
    feedOverride.value = 100;
    previousFeedOverride.value = 100;
  };

  const updateSpindleOverride = () => {
    if (spindleUpdateTimeout) {
      clearTimeout(spindleUpdateTimeout);
    }

    spindleUpdateTimeout = setTimeout(() => {
      const target = Number(spindleOverride.value);
      const previous = Number(previousSpindleOverride.value);
      const diff = target - previous;
      spindleUpdateTimeout = null;

      if (diff === 0) return;

      if (target === 100) {
        sendRealtimeCommand(REALTIME.SPINDLE_RESET);
      } else if (diff > 0) {
        const steps = Math.abs(diff) / 10;
        for (let i = 0; i < steps; i++) sendRealtimeCommand(REALTIME.SPINDLE_PLUS_10);
      } else {
        const steps = Math.abs(diff) / 10;
        for (let i = 0; i < steps; i++) sendRealtimeCommand(REALTIME.SPINDLE_MINUS_10);
      }

      previousSpindleOverride.value = target;

      // Block watcher while GRBL processes the commands
      if (spindleSettleTimeout) clearTimeout(spindleSettleTimeout);
      spindleSettleTimeout = setTimeout(() => { spindleSettleTimeout = null; }, SETTLE_MS);
    }, 100);
  };

  const handleSpindleOverrideComplete = () => {
    userInteracting.value = false;
  };

  const resetSpindleOverride = () => {
    if (spindleUpdateTimeout) {
      clearTimeout(spindleUpdateTimeout);
      spindleUpdateTimeout = null;
    }
    if (spindleSettleTimeout) {
      clearTimeout(spindleSettleTimeout);
      spindleSettleTimeout = null;
    }
    sendRealtimeCommand(REALTIME.SPINDLE_RESET);
    spindleOverride.value = 100;
    previousSpindleOverride.value = 100;
  };

  const startInteracting = () => {
    userInteracting.value = true;
  };

  onUnmounted(() => {
    if (feedUpdateTimeout) clearTimeout(feedUpdateTimeout);
    if (spindleUpdateTimeout) clearTimeout(spindleUpdateTimeout);
    if (feedSettleTimeout) clearTimeout(feedSettleTimeout);
    if (spindleSettleTimeout) clearTimeout(spindleSettleTimeout);
  });

  return {
    feedOverride,
    spindleOverride,
    userInteracting,
    startInteracting,
    updateFeedOverride,
    handleFeedOverrideComplete,
    resetFeedOverride,
    updateSpindleOverride,
    handleSpindleOverrideComplete,
    resetSpindleOverride
  };
}
