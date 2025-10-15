import { commandRegistry } from '@/lib/command-registry';
import { api } from '@/lib/api.js';
import { useAppStore } from '@/composables/use-app-store';
import { keyBindingStore } from './key-binding-store';
import { jogStart, jogStop, jogHeartbeat, jogStep } from '../jog/api';

const CONTINUOUS_DISTANCE_MM = 3000;
const HEARTBEAT_INTERVAL_MS = 250;

export const JOG_ACTIONS: Record<string, { axis: 'X' | 'Y' | 'Z'; direction: 1 | -1 }> = {
  JogXPlus: { axis: 'X', direction: 1 },
  JogXMinus: { axis: 'X', direction: -1 },
  JogYPlus: { axis: 'Y', direction: 1 },
  JogYMinus: { axis: 'Y', direction: -1 },
  JogZPlus: { axis: 'Z', direction: 1 },
  JogZMinus: { axis: 'Z', direction: -1 }
};

const jogActionLabels: Record<string, string> = {
  JogXPlus: 'Jog X+',
  JogXMinus: 'Jog X-',
  JogYPlus: 'Jog Y+',
  JogYMinus: 'Jog Y-',
  JogZPlus: 'Jog Z+',
  JogZMinus: 'Jog Z-'
};

const jogActionDescriptions: Record<string, string> = {
  JogXPlus: 'Step jog along the positive X axis',
  JogXMinus: 'Step jog along the negative X axis',
  JogYPlus: 'Step jog along the positive Y axis',
  JogYMinus: 'Step jog along the negative Y axis',
  JogZPlus: 'Step jog along the positive Z axis',
  JogZMinus: 'Step jog along the negative Z axis'
};

const jogActionGroup = 'Jogging';

const createJogId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export interface ContinuousJogSession {
  jogId: string;
  stop: (reason?: string) => Promise<void>;
}

export async function performJogStep(axis: 'X' | 'Y' | 'Z', direction: 1 | -1): Promise<void> {
  const step = keyBindingStore.getStep();
  const { xyFeedRate, zFeedRate } = keyBindingStore.getFeedRates();
  const distance = Number((step * direction).toFixed(4));
  const feedRate = axis === 'Z' ? zFeedRate : xyFeedRate;

  const command = `$J=G21 G91 ${axis}${distance} F${feedRate}`;
  await jogStep({
    command,
    displayCommand: command,
    axis,
    direction,
    feedRate,
    distance
  });
}

export async function startContinuousJogSession(axis: 'X' | 'Y' | 'Z', direction: 1 | -1): Promise<ContinuousJogSession | null> {
  const { xyFeedRate, zFeedRate } = keyBindingStore.getFeedRates();
  const feedRate = axis === 'Z' ? zFeedRate : xyFeedRate;
  const command = `$J=G21 G91 ${axis}${CONTINUOUS_DISTANCE_MM * direction} F${feedRate}`;
  const jogId = createJogId();

  try {
    await jogStart({
      jogId,
      command,
      displayCommand: command,
      axis,
      direction,
      feedRate
    });
  } catch (error) {
    console.error('Failed to start continuous jog session:', error);
    return null;
  }

  const sendHeartbeat = () => {
    jogHeartbeat(jogId).catch((error) => {
      console.error('Failed to send jog heartbeat:', error);
    });
  };

  sendHeartbeat();
  const heartbeatTimer = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

  let stopped = false;

  return {
    jogId,
    stop: async (reason = 'keyboard-stop') => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(heartbeatTimer);
      try {
        await jogStop(jogId, reason);
      } catch (error) {
        console.error('Failed to stop continuous jog session:', error);
      }
    }
  };
}

let coreActionsRegistered = false;

export function registerCoreKeyboardActions(): void {
  if (coreActionsRegistered) {
    return;
  }

  const store = useAppStore();

  const canJog = () => {
    if (!keyBindingStore.isActive.value) {
      return false;
    }
    const { isConnected, isHomed, isProbing, isJobRunning } = store;
    return isConnected.value && isHomed.value && !isProbing.value && !isJobRunning.value;
  };

  Object.entries(JOG_ACTIONS).forEach(([id, meta]) => {
    commandRegistry.register({
      id,
      label: jogActionLabels[id],
      group: jogActionGroup,
      description: jogActionDescriptions[id],
      handler: () => performJogStep(meta.axis, meta.direction),
      isEnabled: canJog
    });
  });

  coreActionsRegistered = true;
}
