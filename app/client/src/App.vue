<template>
  <AppShell>
    <template #top-toolbar>
      <TopToolbar
        :workspace="workspace"
        :connected="status.connected"
        :machine-state="status.machineState"
        @toggle-theme="toggleTheme"
        :on-show-settings="openSettings"
      />
    </template>

    <template #main>
      <ToolpathViewport
        :view="viewport"
        :theme="theme"
        :connected="status.connected"
        :machine-state="status.machineState"
        :loaded-g-code-program="serverState.loadedGCodeProgram"
        @change-view="viewport = $event"
      />
      <RightPanel
        :status="status"
        :console-lines="consoleLines"
        :jog-config="jogConfig"
        @update:jog-step="jogConfig.stepSize = $event"
        @clear-console="clearConsole"
      />
    </template>

    <!-- Utility bar hidden for now -->
    <!-- <template #utility-bar>
      <UtilityBar
        :connected="status.connected"
        :theme="theme"
        @toggle-theme="toggleTheme"
      />
    </template> -->
  </AppShell>

  <!-- Dialog moved outside AppShell to avoid overflow clipping -->
  <Dialog v-if="showSettings" @close="showSettings = false">
    <template #title>Settings</template>
    <div>
      <p>Settings content will go here.</p>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watchEffect, onMounted } from 'vue';
import AppShell from './components/AppShell.vue';
import TopToolbar from './components/TopToolbar.vue';
import ToolpathViewport from './components/ToolpathViewport.vue';
import RightPanel from './components/RightPanel.vue';
import UtilityBar from './components/UtilityBar.vue';
import Dialog from './components/Dialog.vue';
import { api } from './lib/api.js';

const theme = ref<'light' | 'dark'>('dark'); // Default to dark mode
const workspace = ref('G54');
const viewport = ref<'top' | 'front' | 'iso'>('iso');
const showSettings = ref(false);

const openSettings = () => {
  showSettings.value = true;
};

const clearConsole = () => {
  consoleLines.value = [];
  commandLinesMap.clear();
};

const status = reactive({
  connected: false,
  machineState: 'idle' as 'idle' | 'run' | 'hold' | 'alarm' | 'offline' | 'door' | 'check' | 'home' | 'sleep' | 'tool',
  machineCoords: { x: 0, y: 0, z: 0, a: 0 },
  workCoords: { x: 0, y: 0, z: 0, a: 0 },
  wco: { x: 0, y: 0, z: 0, a: 0 },
  alarms: [] as string[],
  feedRate: 0,
  spindleRpm: 0,
  feedrateOverride: 100,
  rapidOverride: 100,
  spindleOverride: 100
});

const jogConfig = reactive({
  stepSize: 1,
  stepOptions: [0.1, 1, 10]
});

const serverState = reactive({
  loadedGCodeProgram: null as string | null,
  online: false,
  machineState: null as any
});

type ConsoleStatus = 'pending' | 'success' | 'error';
type ConsoleLine = {
  id: string | number;
  level: string;
  message: string;
  timestamp: string;
  status?: ConsoleStatus;
  type?: 'command' | 'response';
  originId?: string | null;
  meta?: Record<string, unknown> | null;
};

type StatusReport = {
  machineState?: string;
  WCO?: string;
  MPos?: string;
  FS?: string;
  feedrateOverride?: number;
  rapidOverride?: number;
  spindleOverride?: number;
  [key: string]: unknown;
};

const consoleLines = ref<ConsoleLine[]>([]);
// Map for O(1) command lookup by ID with array index
const commandLinesMap = new Map<string | number, { line: ConsoleLine, index: number }>();

const applyStatusReport = (report: StatusReport | null | undefined) => {
  if (!report) {
    return;
  }

  if (report.status) {
    status.machineState = report.status as typeof status.machineState;
  }

  if (report.WCO) {
    const [x, y, z] = report.WCO.split(',').map(Number);
    status.wco = { x, y, z, a: 0 };
  }

  if (report.MPos) {
    const [x, y, z] = report.MPos.split(',').map(Number);
    status.machineCoords = { x, y, z, a: 0 };
    status.workCoords.x = status.machineCoords.x - status.wco.x;
    status.workCoords.y = status.machineCoords.y - status.wco.y;
    status.workCoords.z = status.machineCoords.z - status.wco.z;
  }

  if (report.FS) {
    const [feed, spindle] = report.FS.split(',').map(Number);
    status.feedRate = feed;
    status.spindleRpm = spindle;
  }

  // Update override values if present
  if (typeof report.feedrateOverride === 'number') {
    status.feedrateOverride = report.feedrateOverride;
  }
  if (typeof report.rapidOverride === 'number') {
    status.rapidOverride = report.rapidOverride;
  }
  if (typeof report.spindleOverride === 'number') {
    status.spindleOverride = report.spindleOverride;
  }
};

onMounted(async () => {
  // Fetch initial server state
  try {
    const initialServerState = await api.getServerState();
    Object.assign(serverState, initialServerState);
    status.connected = serverState.online;
    if (serverState.machineState && serverState.online) {
      applyStatusReport(serverState.machineState);
    } else if (!serverState.online) {
      status.machineState = 'offline';
    }
  } catch (error) {
    console.error('Failed to fetch server state:', error);
  }

  // Listen for server state updates (includes machine state)
  api.onServerStateUpdated((newServerState) => {
    Object.assign(serverState, newServerState);
    status.connected = serverState.online;
    if (serverState.machineState && serverState.online) {
      applyStatusReport(serverState.machineState);
    } else if (!serverState.online) {
      status.machineState = 'offline';
    }
  });

  // Listen for new commands
  const addOrUpdateCommandLine = (payload) => {
    if (!payload) return null;

    if (api.isJogCancelCommand(payload.command)) {
      return null;
    }

    const message = payload.displayCommand || payload.command || 'Command';
    const timestamp = payload.timestamp ? new Date(payload.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

    // Use Map for O(1) lookup instead of array.find()
    const existingEntry = commandLinesMap.get(payload.id);

    if (existingEntry) {
      // Create new object to trigger Vue reactivity
      const updatedLine = {
        ...existingEntry.line,
        message,
        timestamp,
        status: payload.status ?? existingEntry.line.status,
        level: payload.status === 'error' ? 'error' : existingEntry.line.level,
        originId: payload.originId ?? existingEntry.line.originId,
        meta: payload.meta ?? existingEntry.line.meta
      };

      // Update both structures with O(1) operations
      consoleLines.value[existingEntry.index] = updatedLine;
      commandLinesMap.set(payload.id, { line: updatedLine, index: existingEntry.index });

      return { line: updatedLine, timestamp };
    }

    const newLine = {
        id: payload.id ?? `${Date.now()}-pending`,
        level: payload.status === 'error' ? 'error' : 'info',
        message,
        timestamp,
        status: payload.status ?? 'pending',
        type: 'command',
        originId: payload.originId ?? null,
        meta: payload.meta ?? null
      };

    // Add to both array (for reactivity) and map (for fast lookup)
    const newIndex = consoleLines.value.length;
    consoleLines.value.push(newLine);
    commandLinesMap.set(newLine.id, { line: newLine, index: newIndex });

    return { line: newLine, timestamp };
  };

  api.on('cnc-command', (commandEvent) => {
    addOrUpdateCommandLine(commandEvent);
  });

  // Listen for command responses
  api.onData((data) => {
    const responseLine = { id: Date.now(), level: 'info', message: data, timestamp: '', type: 'response' };
    const newIndex = consoleLines.value.length;
    consoleLines.value.push(responseLine);
    commandLinesMap.set(responseLine.id, { line: responseLine, index: newIndex });
  });

  // Auto-clear console when a new job starts (detect by line number 1)
  let lastJobStartTime = 0;

  api.on('cnc-command-result', (result) => {
    if (!result) return;

    if (api.isJogCancelCommand(result.command)) {
      return;
    }

    // Auto-clear console when starting a new job (line 1)
    // if (result.meta?.lineNumber === 1 && result.status === 'pending') {
    //   const now = Date.now();
    //   // Only clear if it's been more than 2 seconds since last job start (avoid duplicate clears)
    //   if (now - lastJobStartTime > 2000) {
    //     console.log('New job detected, clearing console history');
    //     clearConsole();
    //     lastJobStartTime = now;
    //   }
    // }

    const updateResult = addOrUpdateCommandLine(result);

    if (result.status === 'error' && result.error?.message) {
      const errorLine = {
        id: `${result.id ?? Date.now()}-error-${Math.random().toString(16).slice(2)}`,
        level: 'error',
        message: `${result.error.message}${result.error.code ? ` (code: ${result.error.code})` : ''}`,
        timestamp: '',
        type: 'response'
      };
      const newIndex = consoleLines.value.length;
      consoleLines.value.push(errorLine);
      commandLinesMap.set(errorLine.id, { line: errorLine, index: newIndex });
    }
  });


});

const applyTheme = (value: 'light' | 'dark') => {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add(value === 'dark' ? 'theme-dark' : 'theme-light');
  document.documentElement.style.colorScheme = value;
};

watchEffect(() => applyTheme(theme.value));

const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
};

const themeLabel = computed(() => (theme.value === 'dark' ? 'Dark' : 'Light'));

</script>
