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

export const DIAGONAL_JOG_ACTIONS: Record<string, { xDir: 1 | -1; yDir: 1 | -1 }> = {
  JogXPlusYPlus: { xDir: 1, yDir: 1 },
  JogXPlusYMinus: { xDir: 1, yDir: -1 },
  JogXMinusYPlus: { xDir: -1, yDir: 1 },
  JogXMinusYMinus: { xDir: -1, yDir: -1 }
};

const jogActionLabels: Record<string, string> = {
  JogXPlus: 'Jog X+',
  JogXMinus: 'Jog X-',
  JogYPlus: 'Jog Y+',
  JogYMinus: 'Jog Y-',
  JogZPlus: 'Jog Z+',
  JogZMinus: 'Jog Z-',
  JogXPlusYPlus: 'Jog X+ Y+ (Top Right)',
  JogXPlusYMinus: 'Jog X+ Y- (Bottom Right)',
  JogXMinusYPlus: 'Jog X- Y+ (Top Left)',
  JogXMinusYMinus: 'Jog X- Y- (Bottom Left)'
};

const jogActionDescriptions: Record<string, string> = {
  JogXPlus: 'Step jog along the positive X axis',
  JogXMinus: 'Step jog along the negative X axis',
  JogYPlus: 'Step jog along the positive Y axis',
  JogYMinus: 'Step jog along the negative Y axis',
  JogZPlus: 'Step jog along the positive Z axis',
  JogZMinus: 'Step jog along the negative Z axis',
  JogXPlusYPlus: 'Step jog diagonally to the top right corner',
  JogXPlusYMinus: 'Step jog diagonally to the bottom right corner',
  JogXMinusYPlus: 'Step jog diagonally to the top left corner',
  JogXMinusYMinus: 'Step jog diagonally to the bottom left corner'
};

const jogActionGroup = 'Jogging';

const createJogId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export interface ContinuousJogSession {
  jogId: string;
  stop: (reason?: string) => Promise<void>;
}

function createContinuousSession(jogId: string, onStop: string): ContinuousJogSession {
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
        console.error(`Failed to stop ${onStop}:`, error);
      }
    }
  };
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

export async function performDiagonalJogStep(xDir: 1 | -1, yDir: 1 | -1): Promise<void> {
  const step = keyBindingStore.getStep();
  const { xyFeedRate } = keyBindingStore.getFeedRates();
  const xDistance = Number((step * xDir).toFixed(4));
  const yDistance = Number((step * yDir).toFixed(4));

  const command = `$J=G21 G91 X${xDistance} Y${yDistance} F${xyFeedRate}`;
  await jogStep({
    command,
    displayCommand: command,
    axis: 'X', // Use X as primary axis for diagonal
    direction: xDir,
    feedRate: xyFeedRate,
    distance: step
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

  return createContinuousSession(jogId, 'continuous jog session');
}

export async function startContinuousDiagonalJogSession(xDir: 1 | -1, yDir: 1 | -1): Promise<ContinuousJogSession | null> {
  const { xyFeedRate } = keyBindingStore.getFeedRates();
  const xDistance = CONTINUOUS_DISTANCE_MM * xDir;
  const yDistance = CONTINUOUS_DISTANCE_MM * yDir;
  const command = `$J=G21 G91 X${xDistance} Y${yDistance} F${xyFeedRate}`;
  const jogId = createJogId();

  try {
    await jogStart({
      jogId,
      command,
      displayCommand: command,
      axis: 'X', // Use X as primary axis for diagonal
      direction: xDir,
      feedRate: xyFeedRate
    });
  } catch (error) {
    console.error('Failed to start continuous diagonal jog session:', error);
    return null;
  }

  return createContinuousSession(jogId, 'continuous diagonal jog session');
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

  Object.entries(DIAGONAL_JOG_ACTIONS).forEach(([id, meta]) => {
    commandRegistry.register({
      id,
      label: jogActionLabels[id],
      group: jogActionGroup,
      description: jogActionDescriptions[id],
      handler: () => performDiagonalJogStep(meta.xDir, meta.yDir),
      isEnabled: canJog
    });
  });

  coreActionsRegistered = true;
}
