import { MessageStateTracker } from '../core/state-diff.js';
import { getSetting, DEFAULT_SETTINGS } from '../core/settings-manager.js';

export function createServerContext() {
  const commandHistory = [];
  const MAX_HISTORY_SIZE = 200;

  const serverState = {
    machineState: {
      connected: false,
      isToolChanging: false,
      isProbing: false
    },
    senderStatus: 'connecting',
    greetingMessage: null,
    jobLoaded: null
  };

  const messageStateTracker = new MessageStateTracker();

  const computeSenderStatus = () => {
    const connectionSettings = getSetting('connection') ?? DEFAULT_SETTINGS.connection;
    const connectionType = connectionSettings?.type;
    const normalizedType = typeof connectionType === 'string' ? connectionType.toLowerCase() : undefined;

    const requireSetup = () => {
      if (normalizedType === 'usb') {
        const usbPort = connectionSettings?.usbPort;
        const baudRate = connectionSettings?.baudRate ?? DEFAULT_SETTINGS.connection.baudRate;
        return !usbPort || !baudRate;
      }

      if (normalizedType === 'ethernet') {
        const ip = connectionSettings?.ip;
        const port = connectionSettings?.port;
        return !ip || !port;
      }

      return false;
    };

    if (!normalizedType || requireSetup()) {
      return 'setup-required';
    }

    const connected = serverState.machineState?.connected === true;
    const machineStatusRaw = serverState.machineState?.status;
    const machineStatus = typeof machineStatusRaw === 'string' ? machineStatusRaw.toLowerCase() : undefined;
    const homed = serverState.machineState?.homed;
    const lastAlarmCode = getSetting('lastAlarmCode');
    const isToolChanging = serverState.machineState?.isToolChanging === true;
    const isProbing = serverState.machineState?.isProbing === true;
    const jobLoadedStatus = serverState.jobLoaded?.status;
    const jobIsRunning = jobLoadedStatus === 'running';
    const useDoorAsPause = getSetting('useDoorAsPause') === true;

    if (!connected) {
      return 'connecting';
    }

    if (lastAlarmCode !== undefined && lastAlarmCode !== null) {
      return 'alarm';
    }
    if (machineStatus === 'alarm') {
      return 'alarm';
    }

    if (machineStatus === 'hold') {
      return 'hold';
    }

    if (machineStatus === 'door') {
      return useDoorAsPause ? 'hold' : 'door';
    }

    if (isToolChanging) {
      return 'tool-changing';
    }

    if (isProbing) {
      return 'probing';
    }

    if (machineStatus === 'home') {
      return 'homing';
    }

    if (machineStatus === 'jog') {
      return 'jogging';
    }

    if (machineStatus === 'run' || jobIsRunning) {
      return 'running';
    }

    if (machineStatus === 'check') {
      return 'check';
    }

    if (machineStatus === 'sleep') {
      return 'sleep';
    }

    if (machineStatus === 'tool') {
      return 'tool-changing';
    }

    if (machineStatus === 'idle' && homed === false) {
      return 'homing-required';
    }

    if (machineStatus === 'idle') {
      return 'idle';
    }

    return connected ? 'idle' : 'connecting';
  };

  const updateSenderStatus = () => {
    const nextStatus = computeSenderStatus();
    if (serverState.senderStatus !== nextStatus) {
      console.log(`[Context] senderStatus changed: '${serverState.senderStatus}' -> '${nextStatus}' (machineStatus: '${serverState.machineState?.status}')`);
      serverState.senderStatus = nextStatus;
      return true;
    }
    return false;
  };

  const computeJobProgressFields = () => {
    if (!serverState || !serverState.jobLoaded) return;
    const jl = serverState.jobLoaded;
    const tl = Number(jl.totalLines) || 0;
    const cl = Number(jl.currentLine) || 0;

    // If progressProvider is active (telemetry-estimator), use actualElapsedSec
    if (jl.progressProvider === 'telemetry-estimator' && typeof jl.actualElapsedSec === 'number') {
      jl.runtimeSec = jl.actualElapsedSec;
      // progressPercent and remainingSec already set by estimator
    } else {
      // Fallback to timestamp-based calculation for legacy or non-estimator jobs
      const startIso = jl.jobStartTime;
      if (startIso) {
        const endOrNowMs = jl.jobEndTime ? Date.parse(jl.jobEndTime) : Date.now();
        let elapsedMs = endOrNowMs - Date.parse(startIso);
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0) elapsedMs = 0;
        let pausedMs = (Number(jl.jobPausedTotalSec) || 0) * 1000;
        if (!jl.jobEndTime && jl.jobPauseAt) {
          const pauseAtMs = Date.parse(jl.jobPauseAt);
          if (Number.isFinite(pauseAtMs) && pauseAtMs < endOrNowMs) {
            pausedMs += (endOrNowMs - pauseAtMs);
          }
        }
        const runtimeSec = Math.max(0, Math.floor((elapsedMs - pausedMs) / 1000));
        jl.runtimeSec = runtimeSec;

        if (!jl.progressProvider) {
          let percent = 0;
          if (tl > 0) {
            percent = Math.round((Math.max(0, Math.min(cl, tl)) / tl) * 100);
          }
          if (jl.status === 'completed') percent = 100;
          jl.progressPercent = percent;

          if (cl > 0 && tl > 0) {
            const linesRemaining = Math.max(0, tl - cl);
            const avg = runtimeSec / cl;
            jl.remainingSec = Math.round(linesRemaining * avg);
          } else {
            jl.remainingSec = null;
          }
        }
      }
    }
  };

  const updateJobStatus = (jobManager) => {
    const jobStatus = jobManager.getJobStatus();
    if (jobStatus) {
      const prev = serverState.jobLoaded || {};
      const totalLines = (jobStatus.totalLines && jobStatus.totalLines > 0)
        ? jobStatus.totalLines
        : prev.totalLines;
      serverState.jobLoaded = { ...prev, ...jobStatus, totalLines };
    }
  };

  return {
    serverState,
    commandHistory,
    MAX_HISTORY_SIZE,
    messageStateTracker,
    computeSenderStatus,
    updateSenderStatus,
    computeJobProgressFields,
    updateJobStatus
  };
}
