<template>
  <AppShell>
    <template #top-toolbar>
      <TopToolbar
        :job-state="jobState"
        :workspace="workspace"
        :connected="status.connected"
        @toggle-theme="toggleTheme"
        @connect="showConnectionModal = true"
        @disconnect="disconnect"
        @emergency-stop="emergencyStop"
      />
    </template>

    <template #main>
      <GCodeVisualizer
        :view="viewport"
        :theme="theme"
        @change-view="viewport = $event"
      />
      <RightPanel
        :status="status"
        :console-lines="consoleLines"
        :jog-config="jogConfig"
      />
    </template>

    <template #utility-bar>
      <UtilityBar
        :connected="status.connected"
        :theme="theme"
        @toggle-theme="toggleTheme"
      />
    </template>
  </AppShell>

  <ConnectionModal 
    :visible="showConnectionModal"
    @close="showConnectionModal = false"
    @connected="onCNCConnected"

  />
</template>

<script setup lang="ts">
import { computed, reactive, ref, watchEffect, onMounted, onUnmounted } from 'vue';
import AppShell from './components/AppShell.vue';
import TopToolbar from './components/TopToolbar.vue';
import GCodeVisualizer from './components/GCodeVisualizer.vue';
import RightPanel from './components/RightPanel.vue';
import UtilityBar from './components/UtilityBar.vue';
import ConnectionModal from './components/ConnectionModal.vue';

const theme = ref<'light' | 'dark'>('dark'); // Default to dark mode
const jobState = ref<'idle' | 'running' | 'paused'>('idle');
const workspace = ref('G54');
const viewport = ref<'top' | 'front' | 'iso'>('iso');
const showConnectionModal = ref(false);

const status = reactive({
  connected: false,
  machineCoords: { x: 0, y: 0, z: 0, a: 0 },
  workCoords: { x: 0, y: 0, z: 0, a: 0 },
  alarms: [] as string[],
  feedRate: 0,
  spindleRpm: 0,
  state: 'Idle'
});

const jogConfig = reactive({
  stepSize: 1,
  stepOptions: [0.1, 1, 10]
});

const consoleLines = ref([
  { id: 1, level: 'info', message: 'Console ready. Connect to CNC controller to begin.', timestamp: new Date().toLocaleTimeString() }
]);

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

// CNC Communication functions
const disconnect = async () => {
  try {
    await fetch('/api/disconnect', { method: 'POST' });
  } catch (error) {
    addConsoleMessage('Failed to disconnect', 'error');
  }
};



const emergencyStop = async () => {
  if (status.connected) {
    try {
      await (window as any).ncSender.cnc.sendRealTimeCommand('soft_reset');
      addConsoleMessage('Emergency stop executed', 'warning');
    } catch (error) {
      addConsoleMessage('Failed to execute emergency stop', 'error');
    }
  }
};

const addConsoleMessage = (message: string, level: 'info' | 'warning' | 'error' | 'success' = 'info') => {
  const timestamp = new Date().toLocaleTimeString();
  const id = Date.now() + Math.random();
  consoleLines.value.unshift({ id, level, message, timestamp });
  
  // Keep only the last 100 messages
  if (consoleLines.value.length > 100) {
    consoleLines.value = consoleLines.value.slice(0, 100);
  }
};

// Event listener cleanup functions
let removeStatusListener: (() => void) | null = null;
let removeDataListener: (() => void) | null = null;
let removeStatusReportListener: (() => void) | null = null;
let removeSystemMessageListener: (() => void) | null = null;
let removeResponseListener: (() => void) | null = null;

// Setup CNC event listeners
onMounted(async () => {
  try {
    const response = await fetch('/api/status');
    const cncStatus = await response.json();
    status.connected = cncStatus.isConnected;
  } catch (error) {
    console.error('Failed to get initial status:', error);
  }

  if ((window as any).ncSender?.cnc) {
    // Listen for connection status changes
    removeStatusListener = (window as any).ncSender.cnc.onStatus((data: any) => {
      status.connected = data.status === 'connected';
      addConsoleMessage(data.message, data.status === 'connected' ? 'success' : 'warning');
    });

    // Listen for raw data from CNC
    removeDataListener = (window as any).ncSender.cnc.onData((data: string) => {
      addConsoleMessage(`RX: ${data}`, 'info');
    });

    // Listen for status reports
    removeStatusReportListener = (window as any).ncSender.cnc.onStatusReport((statusReport: any) => {
      if (statusReport.state) {
        status.state = statusReport.state;
      }
      if (statusReport.machinePosition) {
        Object.assign(status.machineCoords, statusReport.machinePosition);
      }
      if (statusReport.workPosition) {
        Object.assign(status.workCoords, statusReport.workPosition);
      }
      if (statusReport.feedRate !== undefined) {
        status.feedRate = statusReport.feedRate;
      }
      if (statusReport.spindleSpeed !== undefined) {
        status.spindleRpm = statusReport.spindleSpeed;
      }
    });

    // Listen for system messages
    removeSystemMessageListener = (window as any).ncSender.cnc.onSystemMessage((message: string) => {
      addConsoleMessage(`System: ${message}`, 'info');
    });

    // Listen for command responses
    removeResponseListener = (window as any).ncSender.cnc.onResponse((response: string) => {
      addConsoleMessage(`Response: ${response}`, 'info');
    });
  }

  addConsoleMessage('ncSender application started', 'success');
});

// Cleanup event listeners
onUnmounted(() => {
  removeStatusListener?.();
  removeDataListener?.();
  removeStatusReportListener?.();
  removeSystemMessageListener?.();
  removeResponseListener?.();
});

</script>
