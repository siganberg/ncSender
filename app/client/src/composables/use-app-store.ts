import { reactive, ref, readonly, computed } from 'vue';
import { api } from '@/lib/api.js';
import { saveGCodeToIDB, clearGCodeIDB, isIDBEnabled } from '@/lib/gcode-store.js';
import { isTerminalIDBEnabled, appendTerminalLineToIDB, updateTerminalLineByIdInIDB, clearTerminalIDB } from '@/lib/terminal-store.js';
import { getSettings } from '@/lib/settings-store.js';

// Types
type ConsoleStatus = 'pending' | 'success' | 'error';

interface ConsoleLine {
  id: string | number;
  level: 'info' | 'error' | 'warning';
  message: string;
  timestamp: string;
  status?: ConsoleStatus;
  type?: 'command' | 'response';
  sourceId?: string;
  meta?: any;
}

interface StatusReport {
  status?: string;
  workspace?: string;
  WCO?: string;
  MPos?: string;
  feedrateOverride?: number;
  rapidOverride?: number;
  spindleOverride?: number;
  tool?: number;
  homed?: boolean;
  feedRate?: number;
  feedRateCommanded?: number;
  spindleRpm?: number;
  floodCoolant?: boolean;
  mistCoolant?: boolean;
  spindleActive?: boolean;
}

// SHARED STATE (synchronized across all clients via WebSocket broadcasts)
const serverState = reactive({
  machineState: null as any,
  senderStatus: 'connecting' as string,
  jobLoaded: null as {
    filename: string;
    currentLine: number;
    totalLines: number;
    status: 'running' | 'paused' | 'stopped' | 'completed' | null;
    remainingSec?: number | null;
    progressPercent?: number | null;
    runtimeSec?: number | null;
    sourceId?: string;
  } | null
});

const status = reactive({
  connected: false,
  machineState: 'offline',
  machineCoords: { x: 0, y: 0, z: 0, a: 0 },
  workCoords: { x: 0, y: 0, z: 0, a: 0 },
  wco: { x: 0, y: 0, z: 0 },
  alarms: [] as string[],
  feedRate: 0,
  spindleRpm: 0,
  feedrateOverride: 100,
  rapidOverride: 100,
  spindleOverride: 100,
  tool: 0,
  homed: false,
  floodCoolant: false,
  mistCoolant: false,
  spindleActive: false
});

const consoleLines = ref<ConsoleLine[]>([]);
const commandLinesMap = new Map<string | number, { line: ConsoleLine, index: number }>();

// CLIENT-SPECIFIC STATE
const websocketConnected = ref(false);
const lastAlarmCode = ref<number | string | undefined>(undefined);
const alarmMessage = ref<string>('');
// Grid size defaults - should be loaded from firmware settings $130/$131
// These defaults are only used if firmware settings cannot be read
const gridSizeX = ref(0);
const gridSizeY = ref(0);
// Z maximum travel ($132). GRBL convention: Z spans from 0 to -$132
const zMaxTravel = ref<number | null>(null);
const machineDimsLoaded = ref(false);
type AxisHome = 'min' | 'max';
type HomeCorner = 'front-left' | 'front-right' | 'back-left' | 'back-right';
const machineOrientation = reactive({
  xHome: 'min' as AxisHome,
  yHome: 'max' as AxisHome,
  zHome: 'max' as AxisHome,
  homeCorner: 'back-left' as HomeCorner
});
const gcodeContent = ref<string>(''); // Deprecated for UI rendering; kept for compatibility
const gcodeFilename = ref<string>('');
const gcodeLineCount = ref<number>(0);
const gcodeCompletedUpTo = ref<number>(0);

// INTERNAL STATE
let storeInitialized = false;
let lastJobStatus: 'running' | 'paused' | 'stopped' | undefined = undefined;
let lastJobFilename: string | undefined = undefined;
let responseLineIdCounter = 0;
let prevShowProgress: boolean | undefined = undefined;

// COMPUTED PROPERTIES (created once at module level)
const senderStatus = computed(() => {
  // If WebSocket is not connected, always show 'connecting'
  if (!websocketConnected.value) {
    return 'connecting';
  }

  const raw = serverState.senderStatus || 'connecting';
  const machineStatus = (serverState.machineState?.status || '').toLowerCase();

  if (raw === 'tool-changing' && machineStatus === 'hold') {
    return 'hold';
  }

  // Map Door to Hold when "Use Door as Pause" is enabled
  const settings = getSettings();
  const useDoorAsPause = settings?.useDoorAsPause ?? false;
  if (useDoorAsPause && raw === 'running' && machineStatus === 'door') {
    return 'hold';
  }

  return raw;
});
const isConnected = computed(() => status.connected && websocketConnected.value);
const currentJobFilename = computed(() => serverState.jobLoaded?.filename);
const isHomed = computed(() => status.homed === true);
const isProbing = computed(() => senderStatus.value === 'probing');
const isJobRunning = computed(() => serverState.jobLoaded?.status === 'running' || senderStatus.value === 'running');

// Helper function to apply status report updates
const applyStatusReport = (report: StatusReport | null | undefined) => {
  if (!report) return;

  if (report.status) {
    status.machineState = report.status;
  }

  if (report.WCO) {
    const [x, y, z] = report.WCO.split(',').map(Number);
    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
      status.wco.x = x;
      status.wco.y = y;
      status.wco.z = z;
    }
  }

  if (report.MPos) {
    const [x, y, z] = report.MPos.split(',').map(Number);
    status.machineCoords = { x, y, z, a: 0 };
    status.workCoords.x = status.machineCoords.x - status.wco.x;
    status.workCoords.y = status.machineCoords.y - status.wco.y;
    status.workCoords.z = status.machineCoords.z - status.wco.z;
  }

  if (typeof (report as any).feedRate === 'number') {
    status.feedRate = (report as any).feedRate;
  }
  if (typeof (report as any).spindleRpm === 'number') {
    status.spindleRpm = (report as any).spindleRpm;
  }

  if (typeof report.feedrateOverride === 'number') {
    status.feedrateOverride = report.feedrateOverride;
  }
  if (typeof report.rapidOverride === 'number') {
    status.rapidOverride = report.rapidOverride;
  }
  if (typeof report.spindleOverride === 'number') {
    status.spindleOverride = report.spindleOverride;
  }

  if (typeof report.tool === 'number') {
    status.tool = report.tool;
  }

  if (typeof report.homed === 'boolean') {
    status.homed = report.homed;
  }

  if (typeof report.floodCoolant === 'boolean') {
    status.floodCoolant = report.floodCoolant;
  }

  if (typeof report.mistCoolant === 'boolean') {
    status.mistCoolant = report.mistCoolant;
  }

  if (typeof report.spindleActive === 'boolean') {
    status.spindleActive = report.spindleActive;
  }
};

// Helper function to add or update command line in console
const addOrUpdateCommandLine = (payload: any) => {
  if (!payload) return null;

  if (api.isJogCancelCommand(payload.command)) {
    return null;
  }

  // Skip gcode-runner commands - they're not displayed in terminal
  // Visualizer listens to cnc-command-result events directly
  if (payload.sourceId === 'gcode-runner') {
    return null;
  }

  let message = payload.message || payload.displayCommand || payload.command || 'Command';

  // Format error messages specially
  if (payload.status === 'error' && payload.error?.message) {
    const lineInfo = payload.meta?.lineNumber ? ` (Line: ${payload.meta.lineNumber})` : '';
    message = `${message}; --> ${payload.error.message}${lineInfo}`;
  }

  // Use Map for O(1) lookup instead of array.find()
  const existingEntry = commandLinesMap.get(payload.id);

  if (existingEntry) {
    // Update existing entry - preserve original timestamp
    const updatedLine = {
      ...existingEntry.line,
      message,
      status: payload.status ?? existingEntry.line.status,
      level: payload.status === 'error' ? 'error' : existingEntry.line.level,
      sourceId: payload.sourceId ?? existingEntry.line.sourceId,
      meta: payload.meta ?? existingEntry.line.meta
    };

    // Update both structures with O(1) operations
    consoleLines.value[existingEntry.index] = updatedLine;
    commandLinesMap.set(payload.id, { line: updatedLine, index: existingEntry.index });

    return { line: updatedLine, timestamp: existingEntry.line.timestamp };
  }

  // New entry - generate timestamp from payload or current time
  const timestamp = payload.timestamp ? new Date(payload.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  const newLine: ConsoleLine = {
    id: payload.id ?? `${Date.now()}-pending`,
    level: payload.status === 'error' ? 'error' : 'info',
    message,
    timestamp,
    status: payload.status ?? 'pending',
    type: 'command',
    sourceId: payload.sourceId,
    meta: payload.meta
  };

  // Add to both array (for reactivity) and map (for fast lookup)
  const newIndex = consoleLines.value.length;
  consoleLines.value.push(newLine);
  commandLinesMap.set(newLine.id, { line: newLine, index: newIndex });

  // Persist to IndexedDB if available (exclude gcode-runner chatter)
  if (isTerminalIDBEnabled() && newLine.sourceId !== 'gcode-runner') {
    appendTerminalLineToIDB(newLine).catch(() => {});
  }

  // Keep a larger buffer since we now exclude gcode-runner (virtual scroller handles this efficiently)
  const maxLines = isTerminalIDBEnabled() ? 5000 : 5000;
  if (consoleLines.value.length > maxLines) {
    const removed = consoleLines.value.shift();
    if (removed) {
      commandLinesMap.delete(removed.id);
    }
    // Rebuild map indices after shift
    consoleLines.value.forEach((line, idx) => {
      const entry = commandLinesMap.get(line.id);
      if (entry) {
        entry.index = idx;
      }
    });
  }

  return { line: newLine, timestamp };
};

// Helper function to add response line to console
const addResponseLine = (data: string) => {
  const timestamp = new Date().toLocaleTimeString();
  const responseLine: ConsoleLine = {
    id: `response-${Date.now()}-${responseLineIdCounter++}`,
    level: 'info',
    message: data,
    timestamp: timestamp,
    type: 'response'
  };
  const newIndex = consoleLines.value.length;
  consoleLines.value.push(responseLine);
  commandLinesMap.set(responseLine.id, { line: responseLine, index: newIndex });

  // Persist to IDB if available
  if (isTerminalIDBEnabled()) {
    appendTerminalLineToIDB(responseLine).catch(() => {});
  }

  // Enforce buffer size limit (keep larger buffer since we exclude gcode-runner)
  const maxLines = isTerminalIDBEnabled() ? 5000 : 5000;
  if (consoleLines.value.length > maxLines) {
    const removed = consoleLines.value.shift();
    if (removed) {
      commandLinesMap.delete(removed.id);
    }
    // Rebuild map indices after shift
    consoleLines.value.forEach((line, idx) => {
      const entry = commandLinesMap.get(line.id);
      if (entry) {
        entry.index = idx;
      }
    });
  }
};

// Helper to try loading machine dimensions once
const tryLoadMachineDimensionsOnce = async () => {
  if (!status.connected || !websocketConnected.value) {
    console.log('[Store] Skipping machine dimensions load: not connected');
    return;
  }
  if (machineDimsLoaded.value) {
    console.log('[Store] Machine dimensions already loaded');
    return;
  }

  console.log('[Store] Loading machine dimensions from firmware settings...');
  try {
    // Read from cached firmware data served by the backend (no controller calls)
    // IDs: X max travel = 130, Y max travel = 131, Z max travel = 132
    const firmware = await api.getFirmwareSettings(false).catch(() => null as any);

    if (!firmware || !firmware.settings) {
      console.warn('[Store] Firmware settings not available');
      return;
    }

    const xVal = parseFloat(String(firmware?.settings?.['130']?.value ?? ''));
    const yVal = parseFloat(String(firmware?.settings?.['131']?.value ?? ''));
    const zVal = parseFloat(String(firmware?.settings?.['132']?.value ?? ''));

    console.log(`[Store] Raw firmware values: $130=${xVal}, $131=${yVal}, $132=${zVal}`);

    if (!Number.isNaN(xVal) && xVal > 0) {
      gridSizeX.value = xVal;
      console.log(`[Store] Set gridSizeX = ${xVal}`);
    }
    if (!Number.isNaN(yVal) && yVal > 0) {
      gridSizeY.value = yVal;
      console.log(`[Store] Set gridSizeY = ${yVal}`);
    }
    if (!Number.isNaN(zVal) && zVal > 0) {
      zMaxTravel.value = zVal;
      console.log(`[Store] Set zMaxTravel = ${zVal}`);
    }

    const dirInvertRaw = parseInt(String(firmware?.settings?.['3']?.value ?? ''), 10);
    const homingInvertRaw = parseInt(String(firmware?.settings?.['23']?.value ?? ''), 10);
    if (!Number.isNaN(dirInvertRaw) && !Number.isNaN(homingInvertRaw)) {
      const mask = dirInvertRaw ^ homingInvertRaw;
      const xHome: AxisHome = (mask & 0b001) ? 'max' : 'min';
      const yHome: AxisHome = (mask & 0b010) ? 'max' : 'min';
      const zHome: AxisHome = (mask & 0b100) ? 'max' : 'min';

      let homeCorner: HomeCorner = 'back-left';
      if (xHome === 'min' && yHome === 'min') homeCorner = 'front-left';
      else if (xHome === 'max' && yHome === 'min') homeCorner = 'front-right';
      else if (xHome === 'min' && yHome === 'max') homeCorner = 'back-left';
      else if (xHome === 'max' && yHome === 'max') homeCorner = 'back-right';

      machineOrientation.xHome = xHome;
      machineOrientation.yHome = yHome;
      machineOrientation.zHome = zHome;
      machineOrientation.homeCorner = homeCorner;
    }

    machineDimsLoaded.value = true;
    console.log(`[Store] Loaded machine dimensions from firmware: X=${gridSizeX.value}, Y=${gridSizeY.value}, Z=${zMaxTravel.value ?? 'n/a'}`);
  } catch (e) {
    console.warn('[Store] Could not load machine dimensions ($130/$131/$132):', (e && (e as any).message) ? (e as any).message : e);
  }
};

// Helper to fetch alarm description
const fetchAlarmDescription = async (code: number | string | undefined) => {
  if (code === undefined || code === null) {
    alarmMessage.value = '';
    return;
  }

  try {
    const response = await fetch(`${api.baseUrl}/api/alarm/${code}`);
    if (!response.ok) {
      alarmMessage.value = 'Unknown Alarm';
      return;
    }
    const data = await response.json();
    alarmMessage.value = data.description;
  } catch (error) {
    console.error('Failed to fetch alarm description:', error);
    alarmMessage.value = 'Error fetching alarm description';
  }
};

// Initialize WebSocket event listeners (called once at app startup)
export function initializeStore() {
  if (storeInitialized) {
    console.warn('Store already initialized, skipping...');
    return;
  }

  console.log('Initializing app store and WebSocket event listeners...');

  // WebSocket connection events
  api.on('connected', () => {
    console.log('WebSocket connected');
    websocketConnected.value = true;
  });

  api.on('disconnected', () => {
    console.log('WebSocket disconnected');
    websocketConnected.value = false;
  });

  api.on('error', () => {
    console.log('WebSocket connection error');
    websocketConnected.value = false;
  });

  // CNC error events (including alarms)
  api.on('cnc-error', async (errorData) => {
    if (!errorData) return;

    // Add error to terminal with warning icon
    const errorMessage = errorData.message || 'Unknown error';
    const errorCode = errorData.code ? `[Error ${errorData.code}] ` : '';
    addOrUpdateCommandLine({
      id: `error-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      message: `${errorCode}${errorMessage}`,
      level: 'error',
      status: 'error',
      type: 'response',
      timestamp: new Date().toISOString()
    });

    // Check if it's an alarm (errorData.message contains "ALARM:X")
    if (errorData.message && errorData.message.toUpperCase().startsWith('ALARM:')) {
      const alarmMatch = errorData.message.match(/alarm:(\d+)/i);
      if (alarmMatch) {
        const code = parseInt(alarmMatch[1]);
        lastAlarmCode.value = code;
        await fetchAlarmDescription(code);
      }
    }
  });

  // Server state updates (main synchronization event)
  api.onServerStateUpdated(async (newServerState) => {
    Object.assign(serverState, newServerState);

    const derivedSenderStatus = senderStatus.value;
    const machineConnected = serverState.machineState?.connected === true;

    const previouslyConnected = status.connected;
    // Only treat as connected when controller reports connected and status is not setup-required/connecting
    status.connected = machineConnected && !['setup-required', 'connecting'].includes(derivedSenderStatus);

    if (previouslyConnected && !status.connected) {
      machineDimsLoaded.value = false;
    }

    // Apply machine status details when available from controller
    if (machineConnected && serverState.machineState) {
      applyStatusReport(serverState.machineState);
    } else {
      status.machineState = 'offline';
    }

    // Clear alarm indicators if senderStatus is no longer alarm
    if (derivedSenderStatus !== 'alarm') {
      lastAlarmCode.value = undefined;
      alarmMessage.value = '';
    }

    // Try to load machine dimensions when connected
    if (status.connected && websocketConnected.value) {
      await tryLoadMachineDimensionsOnce();
    }

    // If a run starts (status transitions into running), reset completed tracking
    const currentStatus = serverState.jobLoaded?.status as any;
    const currentFilename = serverState.jobLoaded?.filename as string | undefined;
    const currentLine = serverState.jobLoaded?.currentLine;

    if (currentStatus === 'running' && lastJobStatus !== 'running') {
      gcodeCompletedUpTo.value = 0;
    }

    // If job is stopped/paused/completed, restore completed line tracking
    // This ensures that late-joining clients or page reloads get the correct state
    if ((currentStatus === 'stopped' || currentStatus === 'paused' || currentStatus === 'completed') &&
        typeof currentLine === 'number' && currentLine > 0 &&
        gcodeCompletedUpTo.value !== currentLine) {
      gcodeCompletedUpTo.value = currentLine;
    }

    // If user closed the job progress panel (status changed to null), reset G-code completion markers
    try {
      const status = serverState.jobLoaded?.status;
      if (prevShowProgress === true && status === null) {
        gcodeCompletedUpTo.value = 0;
      }
      prevShowProgress = (status === 'running' || status === 'paused' || status === 'stopped' || status === 'completed');
    } catch {}
    lastJobStatus = currentStatus;
    if (currentFilename) lastJobFilename = currentFilename;

    // Do not auto-clear the G-code viewer when job stops/completes.
    // We keep the last loaded file so users can review it.
  });

  // Console/command events
  api.on('cnc-command', (commandEvent) => {
    addOrUpdateCommandLine(commandEvent);
  });

  api.on('cnc-command-result', (result) => {
    if (!result) return;
    if (api.isJogCancelCommand(result.command)) return;
    const updated = addOrUpdateCommandLine(result);
    if (isTerminalIDBEnabled() && result?.id && result?.sourceId !== 'gcode-runner') {
      updateTerminalLineByIdInIDB(result.id, {
        message: updated?.line?.message ?? result.displayCommand ?? result.command,
        status: result.status,
        level: result.status === 'error' ? 'error' : 'info',
        sourceId: result.sourceId,
        meta: result.meta
      }).catch(() => {});
    }

    // Update completed line tracking for viewers
    const ln = (result as any)?.meta?.lineNumber;
    if ((result as any)?.sourceId === 'gcode-runner' && typeof ln === 'number' && ln > 0) {
      if (ln > gcodeCompletedUpTo.value) {
        gcodeCompletedUpTo.value = ln;
      }
    }
  });

  api.onData((data) => {
    addResponseLine(data);
  });

  // G-code content updates
  api.onGCodeUpdated((data) => {
    if (data?.content) {
      // Only reset completed tracking if this is a DIFFERENT file than what's currently loaded
      // Check both the local filename AND the server's loaded job filename
      const isNewFile = data.filename !== gcodeFilename.value &&
                       data.filename !== serverState.jobLoaded?.filename;
      const hasActiveJob = serverState.jobLoaded?.status === 'running' ||
                          serverState.jobLoaded?.status === 'paused' ||
                          serverState.jobLoaded?.status === 'stopped' ||
                          serverState.jobLoaded?.status === 'completed';

      // Reset only if it's a new file OR no active job state
      if (isNewFile || !hasActiveJob) {
        gcodeCompletedUpTo.value = 0;
      }

      if (isIDBEnabled()) {
        saveGCodeToIDB(data.filename || '', data.content)
          .then(({ lineCount }) => {
            gcodeLineCount.value = lineCount;
            gcodeFilename.value = data.filename || '';
            // Avoid keeping the entire content string in reactive state for memory
            gcodeContent.value = '';
          })
          .catch((err) => {
            console.error('Failed to persist G-code to IndexedDB:', err);
            // Fallback: keep in memory if save failed
            const lines = data.content.split('\n');
            while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
              lines.pop();
            }
            gcodeContent.value = data.content;
            gcodeFilename.value = data.filename || '';
            gcodeLineCount.value = lines.length;
          });
      } else {
        const lines = data.content.split('\n');
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
          lines.pop();
        }
        gcodeContent.value = data.content;
        gcodeFilename.value = data.filename || '';
        gcodeLineCount.value = lines.length;
      }
    }
  });

  storeInitialized = true;
  console.log('App store initialized successfully');
}

// Seed initial state from server (for late-joining clients)
export async function seedInitialState() {
  console.log('Seeding initial state from server...');

  // Set initial WebSocket state
  if (api.ws) {
    websocketConnected.value = api.ws.readyState === 1; // WebSocket.OPEN = 1
  } else {
    websocketConnected.value = false;
  }

  // Seed UI from last known server state; if incomplete, fetch full server-state snapshot
  try {
    let state = api.lastServerState;
    const needsFetch = !state || typeof state !== 'object' || state.jobLoaded === undefined || state.machineState === undefined;
    if (needsFetch) {
      try {
        state = await api.getServerState();
        // Hydrate api cache too, so future deltas merge correctly
        api.lastServerState = state;
      } catch (fetchErr) {
        console.warn('Failed to fetch full server state; proceeding with partial WS cache:', (fetchErr as any)?.message || fetchErr);
      }
    }

    if (state && typeof state === 'object') {
      Object.assign(serverState, state);

      const derivedSenderStatus = serverState.senderStatus || 'connecting';
      const machineConnected = serverState.machineState?.connected === true;

      status.connected = machineConnected && !['setup-required', 'connecting'].includes(derivedSenderStatus);

      if (machineConnected && serverState.machineState) {
        applyStatusReport(serverState.machineState);
      } else {
        status.machineState = 'offline';
      }

      if (derivedSenderStatus !== 'alarm') {
        lastAlarmCode.value = undefined;
        alarmMessage.value = '';
      }

      // Attempt to load machine dimensions if already connected
      if (status.connected && websocketConnected.value) {
        await tryLoadMachineDimensionsOnce();
      }

      // Restore completed line tracking from server state if job is stopped/paused/completed
      const jobStatus = serverState.jobLoaded?.status;
      const currentLine = serverState.jobLoaded?.currentLine;
      if (jobStatus && (jobStatus === 'stopped' || jobStatus === 'paused' || jobStatus === 'completed') && typeof currentLine === 'number' && currentLine > 0) {
        gcodeCompletedUpTo.value = currentLine;
        console.log(`[Store] Restored completed line tracking from server: ${currentLine}`);
      }
    }
  } catch (e) {
    console.warn('Unable to seed initial server state:', e);
  }

  console.log('Initial state seeded successfully');
}

// Composable for components to access the store
export function useAppStore() {
    return {
    // Shared state (read-only for components)
    serverState: readonly(serverState),
    status: readonly(status),
    consoleLines: readonly(consoleLines),

    // Client-specific state (read-only)
    websocketConnected: readonly(websocketConnected),
    lastAlarmCode: readonly(lastAlarmCode),
      alarmMessage: readonly(alarmMessage),
      gridSizeX: readonly(gridSizeX),
      gridSizeY: readonly(gridSizeY),
      zMaxTravel: readonly(zMaxTravel),
      machineOrientation: readonly(machineOrientation),
      gcodeContent: readonly(gcodeContent),
      gcodeFilename: readonly(gcodeFilename),
      gcodeLineCount: readonly(gcodeLineCount),
      gcodeCompletedUpTo: readonly(gcodeCompletedUpTo),

    // Computed properties
    senderStatus,
    isConnected,
    currentJobFilename,
    isHomed,
    isProbing,
    isJobRunning,

    // Actions
    clearConsole: () => {
      consoleLines.value = [];
      commandLinesMap.clear();
      if (isTerminalIDBEnabled()) {
        clearTerminalIDB().catch(() => {});
      }
    },

    clearGCodePreview: () => {
      if (isIDBEnabled()) {
        clearGCodeIDB().catch(() => {});
      }
      gcodeContent.value = '';
      gcodeFilename.value = '';
      gcodeLineCount.value = 0;
      gcodeCompletedUpTo.value = 0;
    },

    setLastAlarmCode: async (code: number | string | undefined) => {
      lastAlarmCode.value = code;
      await fetchAlarmDescription(code);
    },

    // Expose internal helpers for special cases
    _internals: {
      applyStatusReport,
      tryLoadMachineDimensionsOnce,
      fetchAlarmDescription
    }
  };
}
