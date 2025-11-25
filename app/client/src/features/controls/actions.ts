import { commandRegistry } from '@/lib/command-registry';
import { api } from '@/lib/api.js';
import { useAppStore } from '@/composables/use-app-store';
import { keyBindingStore } from './key-binding-store';
import { jogStart, jogStop, jogHeartbeat, jogStep } from '../jog/api';
import { getSettings, updateSettings } from '@/lib/settings-store.js';

const CONTINUOUS_DISTANCE_MM = 3000;
const HEARTBEAT_INTERVAL_MS = 250;

function getJogSettings(): { step: number; xyFeedRate: number; zFeedRate: number } {
  const store = useAppStore();
  const step = store.jogConfig.stepSize;
  const feedRate = store.jogConfig.feedRate;
  const xyFeed = Number.isFinite(feedRate) && feedRate > 0 ? feedRate : 3000;
  const zFeed = Math.max(1, xyFeed / 2);
  return { step, xyFeedRate: xyFeed, zFeedRate: zFeed };
}

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
  JogXPlus: 'Jog X+ (Right)',
  JogXMinus: 'Jog X- (Left)',
  JogYPlus: 'Jog Y+ (Top)',
  JogYMinus: 'Jog Y- (Bottom)',
  JogZPlus: 'Jog Z+ (Up)',
  JogZMinus: 'Jog Z- (Down)',
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
  const { step, xyFeedRate, zFeedRate } = getJogSettings();
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
  const { step, xyFeedRate } = getJogSettings();
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
  const { xyFeedRate, zFeedRate } = getJogSettings();
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
  const { xyFeedRate } = getJogSettings();
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

  // Job Control Actions
  const jobGroup = 'Job';

  const canStartOrResume = () => {
    if (!keyBindingStore.isActive.value) {
      return false;
    }
    const { isConnected, serverState, senderStatus } = store;
    const status = senderStatus.value;
    const hasJob = Boolean(serverState.jobLoaded?.filename);
    const isOnHold = status === 'hold' || status === 'door';

    return isConnected.value && hasJob && (status === 'idle' || isOnHold);
  };

  const canPause = () => {
    if (!keyBindingStore.isActive.value) {
      return false;
    }
    const { isConnected, serverState, senderStatus } = store;
    const status = senderStatus.value;
    const hasJob = Boolean(serverState.jobLoaded?.filename);

    return isConnected.value && hasJob && (status === 'running' || status === 'tool-changing');
  };

  const canStop = () => {
    if (!keyBindingStore.isActive.value) {
      return false;
    }
    const { isJobRunning } = store;
    return isJobRunning.value;
  };

  commandRegistry.register({
    id: 'JobStart',
    label: 'Start / Resume Job',
    group: jobGroup,
    description: 'Start or resume the current G-code job',
    handler: async () => {
      try {
        const status = store.senderStatus.value;
        const isOnHold = status === 'hold' || status === 'door';

        if (isOnHold) {
          await api.controlGCodeJob('resume');
        } else if (store.serverState.jobLoaded?.filename) {
          await api.startGCodeJob(store.serverState.jobLoaded.filename);
        }
      } catch (error) {
        console.error('Failed to start/resume job:', error);
      }
    },
    isEnabled: canStartOrResume
  });

  commandRegistry.register({
    id: 'JobPause',
    label: 'Pause Job',
    group: jobGroup,
    description: 'Pause the running G-code job',
    handler: async () => {
      try {
        await api.controlGCodeJob('pause');
      } catch (error) {
        console.error('Failed to pause job:', error);
      }
    },
    isEnabled: canPause
  });

  commandRegistry.register({
    id: 'JobStop',
    label: 'Stop Job',
    group: jobGroup,
    description: 'Stop the running G-code job',
    handler: async () => {
      try {
        await api.stopGCodeJob();
      } catch (error) {
        console.error('Failed to stop job:', error);
      }
    },
    isEnabled: canStop
  });

  // Jog Step Controls
  const STEP_CYCLE = [0.1, 1, 10];

  commandRegistry.register({
    id: 'CycleSteps',
    label: 'Cycle Jog Steps',
    group: jogActionGroup,
    description: 'Cycle through jog step sizes: 0.1 → 1 → 10',
    handler: () => {
      const { step: currentStep } = getJogSettings();
      const currentIndex = STEP_CYCLE.findIndex(s => Math.abs(s - currentStep) < 0.001);
      const nextIndex = (currentIndex + 1) % STEP_CYCLE.length;
      const nextStep = STEP_CYCLE[nextIndex];
      store.jogConfig.stepSize = nextStep;
    },
    isEnabled: () => keyBindingStore.isActive.value
  });

  commandRegistry.register({
    id: 'SetStep0.1',
    label: 'Set Step 0.1',
    group: jogActionGroup,
    description: 'Set jog step size to 0.1mm',
    handler: () => {
      store.jogConfig.stepSize = 0.1;
    },
    isEnabled: () => keyBindingStore.isActive.value
  });

  commandRegistry.register({
    id: 'SetStep1',
    label: 'Set Step 1',
    group: jogActionGroup,
    description: 'Set jog step size to 1mm',
    handler: () => {
      store.jogConfig.stepSize = 1;
    },
    isEnabled: () => keyBindingStore.isActive.value
  });

  commandRegistry.register({
    id: 'SetStep10',
    label: 'Set Step 10',
    group: jogActionGroup,
    description: 'Set jog step size to 10mm',
    handler: () => {
      store.jogConfig.stepSize = 10;
    },
    isEnabled: () => keyBindingStore.isActive.value
  });

  // Machine Control Actions
  const machineGroup = 'Machine';

  const canHome = () => {
    if (!keyBindingStore.isActive.value) {
      return false;
    }
    const { isConnected } = store;
    return isConnected.value;
  };

  commandRegistry.register({
    id: 'Home',
    label: 'Home Machine',
    group: machineGroup,
    description: 'Home the machine',
    handler: async () => {
      try {
        await api.sendCommand('$H');
      } catch (error) {
        console.error('Failed to home machine:', error);
      }
    },
    isEnabled: canHome,
    requiresLongPress: true
  });

  // Probe Actions
  const probeGroup = 'Probe';

  commandRegistry.register({
    id: 'StartProbe',
    label: 'Start Probe',
    group: probeGroup,
    description: 'Start probing (only when probe dialog is open)',
    handler: () => {
      window.dispatchEvent(new Event('probe-start-shortcut'));
    },
    isEnabled: () => keyBindingStore.isActive.value
  });

  coreActionsRegistered = true;
}
