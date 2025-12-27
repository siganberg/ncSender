<template>
  <section class="viewport">
    <!-- Full canvas with floating toolbars -->
    <div ref="canvas" class="viewport__canvas">
      <!-- Loading Overlay -->
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-content">
          <div class="loading-header">
            <span class="loading-message">{{ loadingMessage }}</span>
            <div class="loading-percent">{{ loadingProgress }}%</div>
          </div>
          <div class="loading-bar-container">
            <div class="loading-bar" :style="{ width: `${loadingProgress}%` }"></div>
          </div>
        </div>
      </div>

      <!-- Top floating toolbar -->
      <div class="floating-toolbar floating-toolbar--top">
        <div class="view-buttons" role="group" aria-label="Change viewport">
          <div class="preset-buttons">
            <button
              v-for="preset in presets"
              :key="preset.id"
              :class="['view-button', { active: view === preset.id }]"
              @click="handleViewButtonClick(preset.id)"
            >
              {{ preset.label }}
            </button>
          </div>
          <div class="toggle-group">
            <div class="spindle-toggle">
              <label class="switch">
                <input type="checkbox" :checked="spindleViewMode" @change="spindleViewMode = !spindleViewMode">
                <span class="slider"></span>
              </label>
              <span>Spindle View</span>
            </div>
            <div class="spindle-toggle">
              <label class="switch">
                <input type="checkbox" :checked="autoFitMode" @change="autoFitMode = !autoFitMode">
                <span class="slider"></span>
              </label>
              <span>Auto-Fit</span>
            </div>
          </div>
        </div>
        <div class="file-controls">
          <input
            ref="fileInput"
            type="file"
            accept=".nc,.gcode,.tap,.txt"
            @change="handleFileLoad"
            style="display: none"
          />
          <button v-if="hasFile" @click="clearFile" class="clear-button" :disabled="isJobRunning">
            Clear
          </button>
          <button @click="fileInput?.click()" class="load-button upload-button" title="Upload G-code" :disabled="isJobRunning">
            <svg width="26" height="26"><use href="#emoji-upload"></use></svg>
          </button>
          <button @click="showFileManager = true" class="load-button folder-button" title="Open Folder" :disabled="isJobRunning">
            <svg width="24" height="24"><use href="#emoji-folder"></use></svg>
          </button>
        </div>
      </div>

      <!-- Segment Legend - right side center -->
      <div class="floating-toolbar floating-toolbar--right">
        <div class="legend-group" role="group" aria-label="Current segment legend">
          <div
            v-for="tool in toolPathColors"
            :key="tool.number"
            class="legend-item"
            :class="{ 'legend-item--disabled': !tool.visible }"
            @click="toggleTool(tool.number)"
          >
            <span
              class="dot"
              :class="{ 'dot--disabled': !tool.visible }"
              :style="{ backgroundColor: '#' + tool.color.toString(16).padStart(6, '0') }"
            ></span>
            <span class="legend-label">Tool T{{ tool.number }}</span>
          </div>
          <div class="legend-item" :class="{ 'legend-item--disabled': !showSpindle }" @click="toggleSpindle">
            <span class="dot dot--spindle" :class="{ 'dot--disabled': !showSpindle }"></span>
            <span class="legend-label">Spindle</span>
          </div>
        </div>
      </div>

      <!-- Tools list - bottom right above current tool -->
      <div v-if="numberOfToolsToShow > 0 || showManualTool || showTlsTool || showProbeTool" class="tools-legend tools-legend--bottom">
        <!-- Scroll Up Button -->
        <button
          v-if="numberOfToolsToShow > 8"
          class="tools-scroll-btn tools-scroll-btn--up"
          @mousedown="startScrollPress('up')"
          @mouseup="stopScrollPress"
          @mouseleave="stopScrollPress"
          @touchstart="startScrollPress('up')"
          @touchend="stopScrollPress"
          @touchcancel="stopScrollPress"
          aria-label="Scroll tools up"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 8L6 14L18 14L12 8Z" fill="currentColor"/>
          </svg>
        </button>

        <!-- Scrollable container for numbered tools -->
        <div v-if="numberOfToolsToShow > 0" ref="toolsScrollContainer" class="tools-scrollable">
          <div
            v-for="t in numberOfToolsToShow"
            :key="t"
            class="tools-legend__item"
            :class="{
              'active': currentTool === t,
              'used': toolsUsed.includes(t),
              'disabled': isToolActionsDisabled,
              'long-press-triggered': toolPress[t]?.triggered,
              'blink-border': toolPress[t]?.blinking,
              'expanded': showToolInfo === t
            }"
            :style="toolsUsed.includes(t) ? { boxShadow: `inset 0 0 0 3px ${getToolColor(t)}` } : {}"
            :title="getToolTooltip(t)"
            @mousedown="isToolActionsDisabled ? null : startToolPress(t, $event)"
            @mouseup="isToolActionsDisabled ? null : endToolPress(t)"
            @mouseleave="isToolActionsDisabled ? null : cancelToolPress(t)"
            @touchstart="isToolActionsDisabled ? null : startToolPress(t, $event)"
            @touchend="isToolActionsDisabled ? null : endToolPress(t)"
            @touchcancel="isToolActionsDisabled ? null : cancelToolPress(t)"
          >
            <div class="long-press-indicator long-press-horizontal" :style="{ width: `${toolPress[t]?.progress || 0}%` }"></div>
            <span class="tools-legend__label">T{{ t }}</span>
            <svg class="tools-legend__icon" width="36" height="14" viewBox="0 0 36 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="1" y="4" width="34" height="6" rx="2" class="bit-body"/>
              <rect x="4" y="5" width="10" height="4" rx="1" class="bit-shank"/>
            </svg>
            <span v-if="showToolInfo === t && toolInventory && toolInventory[t]" class="tool-name-expanded">
              <template v-if="toolInventory[t].diameter || toolInventory[t].type">
                <span v-if="toolInventory[t].diameter">Ø{{ toolInventory[t].diameter.toFixed(3) }}mm</span>
                <span v-if="toolInventory[t].diameter && toolInventory[t].type"> - </span>
                <span v-if="toolInventory[t].type">{{
                  { 'flat': 'Flat End Mill', 'ball': 'Ball End Mill', 'v-bit': 'V-Bit',
                    'drill': 'Drill', 'chamfer': 'Chamfer', 'surfacing': 'Surfacing', 'thread-mill': 'Thread Mill', 'probe': 'Probe'
                  }[toolInventory[t].type] || toolInventory[t].type
                }}</span>
              </template>
              <template v-else>{{ toolInventory[t].name }}</template>
            </span>
          </div>
        </div>

        <!-- Scroll Down Button -->
        <button
          v-if="numberOfToolsToShow > 8"
          class="tools-scroll-btn tools-scroll-btn--down"
          @mousedown="startScrollPress('down')"
          @mouseup="stopScrollPress"
          @mouseleave="stopScrollPress"
          @touchstart="startScrollPress('down')"
          @touchend="stopScrollPress"
          @touchcancel="stopScrollPress"
          aria-label="Scroll tools down"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 16L6 10L18 10L12 16Z" fill="currentColor"/>
          </svg>
        </button>

        <!-- Manual Tool -->
        <div
          v-if="showManualTool"
          :key="'manual'"
          class="tools-legend__item manual-tool"
          :class="{
            'active': currentTool > numberOfToolsToShow && currentTool < 99,
            'used': toolsUsed.some(t => t > numberOfToolsToShow && t < 99),
            'disabled': isToolActionsDisabled,
            'long-press-triggered': toolPress['manual']?.triggered,
            'blink-border': toolPress['manual']?.blinking
          }"
          :title="`${manualToolLabel} (Hold to change)`"
          @mousedown="isToolActionsDisabled ? null : startToolPress('manual', $event)"
          @mouseup="isToolActionsDisabled ? null : endToolPress('manual')"
          @mouseleave="isToolActionsDisabled ? null : cancelToolPress('manual')"
          @touchstart="isToolActionsDisabled ? null : startToolPress('manual', $event)"
          @touchend="isToolActionsDisabled ? null : endToolPress('manual')"
          @touchcancel="isToolActionsDisabled ? null : cancelToolPress('manual')"
        >
          <div class="long-press-indicator long-press-horizontal" :style="{ width: `${toolPress['manual']?.progress || 0}%` }"></div>
          <span class="tools-legend__label">{{ manualToolLabel }}</span>
        </div>

        <!-- TLS Tool -->
        <div
          v-if="showTlsTool"
          :key="'tls'"
          class="tools-legend__item tls-tool"
          :class="{
            'disabled': isToolActionsDisabled || currentTool === 0,
            'glow': shouldTLSGlow,
            'long-press-triggered': toolPress['tls']?.triggered,
            'blink-border': toolPress['tls']?.blinking
          }"
          title="TLS - Tool Length Setter (Hold to measure current tool)"
          @mousedown="isToolActionsDisabled || currentTool === 0 ? null : startToolPress('tls', $event)"
          @mouseup="isToolActionsDisabled || currentTool === 0 ? null : endToolPress('tls')"
          @mouseleave="isToolActionsDisabled || currentTool === 0 ? null : cancelToolPress('tls')"
          @touchstart="isToolActionsDisabled || currentTool === 0 ? null : startToolPress('tls', $event)"
          @touchend="isToolActionsDisabled || currentTool === 0 ? null : endToolPress('tls')"
          @touchcancel="isToolActionsDisabled || currentTool === 0 ? null : cancelToolPress('tls')"
        >
          <div class="long-press-indicator long-press-horizontal" :style="{ width: `${toolPress['tls']?.progress || 0}%` }"></div>
          <span class="tools-legend__label">TLS</span>
        </div>

        <!-- Probe Tool -->
        <div
          v-if="showProbeTool"
          :key="'probe'"
          class="tools-legend__item probe-tool"
          :class="{
            'active': currentTool === 99,
            'disabled': isToolActionsDisabled,
            'long-press-triggered': toolPress['probe']?.triggered,
            'blink-border': toolPress['probe']?.blinking
          }"
          title="Probe (Hold to load T99)"
          @mousedown="isToolActionsDisabled ? null : startToolPress('probe', $event)"
          @mouseup="isToolActionsDisabled ? null : endToolPress('probe')"
          @mouseleave="isToolActionsDisabled ? null : cancelToolPress('probe')"
          @touchstart="isToolActionsDisabled ? null : startToolPress('probe', $event)"
          @touchend="isToolActionsDisabled ? null : endToolPress('probe')"
          @touchcancel="isToolActionsDisabled ? null : cancelToolPress('probe')"
        >
          <div class="long-press-indicator long-press-horizontal" :style="{ width: `${toolPress['probe']?.progress || 0}%` }"></div>
          <span class="tools-legend__label">Probe</span>
        </div>
      </div>

      <!-- I/O Switches controls - lower left -->
      <div class="coolant-controls">
        <div
          v-for="(switchConfig, key) in enabledIOSwitches"
          :key="key"
          class="spindle-toggle"
        >
          <label class="switch">
            <input
              type="checkbox"
              :checked="ioSwitchStates[key]"
              @change="toggleIOSwitch(key)"
              :disabled="isCoolantDisabled"
            >
            <span class="slider"></span>
          </label>
          <span>{{ switchConfig.label }}</span>
        </div>
      </div>

      <!-- Alarm message -->
      <div class="alarm-message-warning" v-if="alarmMessage">
        <svg class="warning-icon" width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 20h20L12 2z" fill="#ff8888" opacity="0.9"/>
          <path d="M11 10h2v5h-2zm0 6h2v2h-2z" fill="#b84444"/>
        </svg>
        <span>Alert: {{ alarmMessage }}</span>
      </div>

      <!-- Out of bounds warning (only show when job is running, not in pre-run state) -->
      <div class="out-of-bounds-warning" v-if="showOutOfBoundsWarning && !showPreRunState">
        <svg class="warning-icon" width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 20h20L12 2z" fill="#ff8888" opacity="0.9"/>
          <path d="M11 10h2v5h-2zm0 6h2v2h-2z" fill="#b84444"/>
        </svg>
        <span>{{ outOfBoundsMessage }}</span>
      </div>

      <!-- Progress bar above controls -->
      <div class="progress-bar-container">
        <ProgressBar :warning-message="showPreRunState && showOutOfBoundsWarning ? outOfBoundsMessage : undefined" />
      </div>

      <!-- Control buttons - bottom center -->
      <div class="control-buttons" :class="{ 'controls-disabled': !store.isConnected.value || !store.isHomed.value || store.isProbing.value }">
        <button
          class="control-btn control-btn--primary"
          :disabled="!canStartOrResume || (isJobRunning && !isOnHold)"
          @click="handleCycle"
          :title="isOnHold ? 'Resume Job' : 'Start Job'"
        >
          <svg class="btn-icon"><use href="#emoji-play"></use></svg>
          {{ isOnHold ? 'Resume' : 'Cycle' }}
        </button>
        <button
          class="control-btn control-btn--secondary"
          :disabled="!canPause"
          @click="handlePause"
          title="Pause Job"
        >
          <svg class="btn-icon"><use href="#emoji-pause"></use></svg>
          Pause
        </button>
        <button
          class="control-btn control-btn--danger"
          :disabled="!canStop"
          @click="handleStop"
          title="Stop Job"
        >
          <svg class="btn-icon"><use href="#emoji-stop"></use></svg>
          Stop
        </button>
        <button
          class="control-btn control-btn--start-from-line"
          :disabled="!canStartFromLine"
          @click="openStartFromLineDialog()"
          title="Start from specific line"
        >
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 6h16M4 12h16M4 18h7" />
            <path d="M15 15l4 4m0-4l-4 4" />
          </svg>
          From Line
        </button>
      </div>

      <!-- Probe button - bottom right -->
      <button class="probe-button" @click="openProbeDialog" title="Probe" :disabled="isProbeDisabled">
        <span class="probe-label">Probe</span>
        <div class="probe-icon" role="img" aria-label="Probe"></div>
      </button>
    </div>
  </section>

  <!-- Probe Dialog -->
  <ProbeDialog
    :show="showProbeDialog"
    :is-probing="store.isProbing.value"
    :probe-active="getPinState('P')"
    @close="showProbeDialog = false"
  />

  <!-- File Manager Dialog -->
  <FileManagerDialog
    :show="showFileManager"
    @close="showFileManager = false"
  />

  <!-- Start from Line Dialog -->
  <StartFromLineDialog
    :show="showStartFromLineDialog"
    :filename="props.jobLoaded?.filename || ''"
    :total-lines="props.jobLoaded?.totalLines || 0"
    :initial-line="startFromLineInitial"
    @close="showStartFromLineDialog = false"
    @started="handleStartFromLineSuccess"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick, reactive } from 'vue';
import * as THREE from 'three';
import GCodeVisualizer from './visualizer/gcode-visualizer.js';
import { createGridLines, createSideViewGrid, createCoordinateAxes, createDynamicAxisLabels, createHomeIndicator, generateCuttingPointer } from './visualizer/helpers.js';
import { api } from './api';
import { getSettings, updateSettings, settingsStore } from '../../lib/settings-store.js';
import { useToolpathStore } from './store';
import { useAppStore } from '../../composables/use-app-store';
import Dialog from '../../components/Dialog.vue';
import ConfirmPanel from '../../components/ConfirmPanel.vue';
import ProgressBar from '../../components/ProgressBar.vue';
import ProbeDialog from '../probe/ProbeDialog.vue';
import FileManagerDialog from '../file-manager/FileManagerDialog.vue';
import StartFromLineDialog from './StartFromLineDialog.vue';
// Probing is now handled server-side

const store = useToolpathStore();
const appStore = useAppStore();
const { isJobRunning, isConnected: storeIsConnected } = appStore;

type AxisHome = 'min' | 'max';
type MachineOrientation = {
  xHome: AxisHome;
  yHome: AxisHome;
  zHome: AxisHome;
  homeCorner: 'front-left' | 'front-right' | 'back-left' | 'back-right';
};

const presets = [
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Side' },
  { id: 'iso', label: '3D' }
] as const;

const DEFAULT_GRID_SIZE_MM = 400;
const DEFAULT_Z_TRAVEL_MM = 100;

const props = withDefaults(defineProps<{
  view: 'top' | 'front' | 'iso';
  theme: 'light' | 'dark';
  senderStatus?: string;
  machineState?: { isToolChanging?: boolean };
  jobLoaded?: { filename: string; currentLine: number; totalLines: number; status: 'running' | 'paused' | 'stopped' | 'completed' } | null;
  workCoords?: { x: number; y: number; z: number; a: number };
  workOffset?: { x: number; y: number; z: number; a: number };
  gridSizeX?: number;
  gridSizeY?: number;
  zMaxTravel?: number | null;
  machineOrientation?: MachineOrientation;
  spindleRpmTarget?: number;
  spindleRpmActual?: number;
  alarmMessage?: string;
  currentTool?: number;
  toolLengthSet?: boolean;
}>(), {
  view: 'top', // Default to top view
  theme: 'dark', // Default to dark theme
  senderStatus: 'connecting',
  machineState: () => ({ isToolChanging: false }),
  workCoords: () => ({ x: 0, y: 0, z: 0, a: 0 }),
  workOffset: () => ({ x: 0, y: 0, z: 0, a: 0 }),
  gridSizeX: DEFAULT_GRID_SIZE_MM,
  gridSizeY: DEFAULT_GRID_SIZE_MM,
  zMaxTravel: DEFAULT_Z_TRAVEL_MM,
  machineOrientation: () => ({ xHome: 'min', yHome: 'max', zHome: 'max', homeCorner: 'back-left' }),
  spindleRpmTarget: 0,
  spindleRpmActual: 0,
  jobLoaded: null,
  toolLengthSet: false
});

const emit = defineEmits<{
  (e: 'change-view', value: 'top' | 'front' | 'iso'): void;
}>();

const normalizedSenderStatus = computed(() => (props.senderStatus || '').toLowerCase());

const isToolChanging = computed(() => normalizedSenderStatus.value === 'tool-changing');
const isConnecting = computed(() => normalizedSenderStatus.value === 'connecting');
const isAlarm = computed(() => normalizedSenderStatus.value === 'alarm');
const isHomingRequired = computed(() => normalizedSenderStatus.value === 'homing-required');
const isHoming = computed(() => normalizedSenderStatus.value === 'homing');

// TLS button should glow when a tool is loaded but tool length is not set
const shouldTLSGlow = computed(() => {
  return (props.currentTool ?? 0) > 0 && !props.toolLengthSet;
});

const isMachineConnected = computed(() => {
  const status = normalizedSenderStatus.value;
  return storeIsConnected.value && status !== 'setup-required' && status !== 'connecting';
});

// Job control computed properties
const isOnHold = computed(() => {
  const state = normalizedSenderStatus.value;
  return state === 'hold' || state === 'door';
});

const canStartOrResume = computed(() => {
  if (!isMachineConnected.value) return false;
  const state = normalizedSenderStatus.value;

  if (props.jobLoaded?.filename && state === 'idle') {
    return true;
  }

  if (state === 'hold' || state === 'door') {
    return true;
  }

  return false;
});

const canPause = computed(() => {
  if (!isMachineConnected.value || !props.jobLoaded?.filename) return false;
  const state = normalizedSenderStatus.value;
  return state === 'running' || state === 'tool-changing';
});

const canStop = computed(() => {
  if (!isMachineConnected.value || !props.jobLoaded?.filename) return false;
  const state = normalizedSenderStatus.value;
  return state === 'running' || state === 'hold' || state === 'door' || state === 'tool-changing';
});

const isToolActionsDisabled = computed(() => isToolChanging.value || isJobRunning.value || isConnecting.value || isAlarm.value || isHomingRequired.value || isHoming.value);
const isProbeDisabled = computed(() => isJobRunning.value || isConnecting.value || isAlarm.value || isHomingRequired.value || isHoming.value);
const isCoolantDisabled = computed(() => isConnecting.value || isAlarm.value || isHomingRequired.value || isHoming.value);

// Template refs
const canvas = ref<HTMLElement>();
const fileInput = ref<HTMLInputElement>();

// Configuration: Enable/disable auto-snap on tool buttons scroll
const ENABLE_TOOL_BUTTON_SNAP = false;

// Reactive state
const hasFile = ref(false);
const isLoading = ref(false);
const loadingProgress = ref(0);
const loadingMessage = ref('');
const showRapids = ref(true); // Default to shown
const showCutting = ref(true); // Default to shown (includes both feed and arcs)
const showSpindle = ref(true); // Default to shown
const spindleViewMode = ref(false); // Spindle view mode - off by default
const autoFitMode = ref(false); // Auto-fit mode - off by default
const toolPathColors = ref<{ number: number; color: number; visible: boolean }[]>([]); // Tool colors for legend
const showFileManager = ref(false);
const showProbeDialog = ref(false);
const showStartFromLineDialog = ref(false);
const startFromLineInitial = ref(1);

// Helper to get pin state from Pn string
const getPinState = (pinKey: string): boolean => {
  const pnString = appStore.status.Pn || '';
  return pnString.includes(pinKey);
};

// I/O Switches - dynamically loaded from settings
const ioSwitchesConfig = ref<any>({});
const ioSwitchStates = reactive<Record<string, boolean>>({});

// Helper function to compute OFF command based on ON command
const getOffCommand = (onCommand: string): string => {
  if (!onCommand) return '';
  if (onCommand === 'M7' || onCommand === 'M8') return 'M9';
  // M64 P<n> -> M65 P<n>
  const m64Match = onCommand.match(/M64\s+(P\d+)/i);
  if (m64Match) {
    return `M65 ${m64Match[1]}`;
  }
  return '';
};

// Helper to extract pin number from M64 Pn command
const getM64PinNumber = (onCommand: string): number | null => {
  if (!onCommand) return null;
  const m64Match = onCommand.toUpperCase().match(/M64\s*P(\d+)/);
  if (m64Match) {
    return parseInt(m64Match[1], 10);
  }
  return null;
};

const enabledIOSwitches = computed(() => {
  const enabled: Record<string, any> = {};
  const config = ioSwitchesConfig.value;

  // Support new auxOutputs array format
  if (Array.isArray(config)) {
    for (const output of config) {
      if (output && output.enabled) {
        const key = output.id || output.name?.toLowerCase().replace(/\s+/g, '-') || `aux-${Math.random()}`;
        enabled[key] = {
          label: output.name || `Output`,
          on: output.on,
          off: getOffCommand(output.on)
        };
        // Initialize state if not exists
        if (!(key in ioSwitchStates)) {
          ioSwitchStates[key] = false;
        }
      }
    }
  } else {
    // Legacy ioSwitches object format
    const switchOrder = ['flood', 'mist'];
    for (const key of switchOrder) {
      const switchConfig = config[key];
      if (switchConfig && switchConfig.enabled) {
        const onCommand = switchConfig.on;
        const defaultLabel = key.charAt(0).toUpperCase() + key.slice(1);
        enabled[key] = {
          label: switchConfig.name || defaultLabel,
          on: onCommand,
          off: getOffCommand(onCommand)
        };
        // Initialize state if not exists
        if (!(key in ioSwitchStates)) {
          ioSwitchStates[key] = false;
        }
      }
    }
  }
  return enabled;
});
const lastExecutedLine = ref<number>(0); // Track the last executed line number
const showOutOfBoundsWarning = ref(false); // Show warning if G-code exceeds boundaries
const showPreRunState = computed(() => {
  // Pre-run state: file loaded but job not yet started (status is null)
  return !!props.jobLoaded?.filename && props.jobLoaded?.status === null;
});
const toolInventory = ref<Record<number, any> | null>(null); // Tool inventory data from plugin
const showToolInfo = ref<number | null>(null); // Currently displayed tool info popup
const outOfBoundsAxes = ref<string[]>([]);
const outOfBoundsDirections = ref<string[]>([]);
const outOfBoundsMessage = computed(() => {
  const base = 'Warning: Toolpath exceeds machine boundaries';
  if (!showOutOfBoundsWarning.value) return '';

  // Prefer direction list; map Z+/Z- to friendly phrases, keep X/Y as-is
  const dirs = outOfBoundsDirections.value || [];
  if (dirs.length > 0) {
    const zMax = resolveZTravel(props.zMaxTravel);
    const mapped = dirs.map((d) => {
      if (d === 'Z+') return 'Z above 0';
      if (d === 'Z-') return zMax != null ? `Z below machine limit (-${zMax})` : 'Z below machine limit';
      return d;
    });
    return `${base} at ${mapped.join(', ')}`;
  }

  // Fallback to axes list
  if (outOfBoundsAxes.value && outOfBoundsAxes.value.length > 0) {
    return `${base} at ${outOfBoundsAxes.value.join(', ')}`;
  }

  return base;
});
let currentGCodeBounds: any = null; // Store current G-code bounds
let isInitialLoad = true; // Flag to prevent watchers from firing during initial settings load

// Tools detected from program (lines containing M6 with Tn)
const toolsUsed = ref<number[]>([]);

// Number of tools to display (from settings)
const numberOfToolsToShow = ref<number>(0);
const showManualTool = ref<boolean>(false);
const showTlsTool = ref<boolean>(false);
const showProbeTool = ref<boolean>(false);

// Manual tool label - show tool number when manual tool is active
const manualToolLabel = computed(() => {
  const tool = props.currentTool ?? 0;
  const toolCount = numberOfToolsToShow.value;
  const isManualToolActive = tool > toolCount && tool < 99;

  if (toolCount === 0 && showManualTool.value) {
    return `T${tool}`;
  }
  if (isManualToolActive) {
    return `Manual (T${tool})`;
  }
  return 'Manual';
});

// Tool press state for long-press interaction
const toolPress = ref<Record<number | string, { start: number; progress: number; raf?: number; active: boolean; triggered: boolean; blinking: boolean }>>({});

// Three.js objects
let scene: THREE.Scene;
let camera: THREE.OrthographicCamera;
let renderer: THREE.WebGLRenderer;
let controls: any;
let gcodeVisualizer: GCodeVisualizer;
let animationId: number;
let axisLabelsGroup: THREE.Group;
let cuttingPointer: THREE.Group;
let resizeObserver: ResizeObserver;
let directionalLight: THREE.DirectionalLight;
let gridGroup: THREE.Group;
let axesGroup: THREE.Group;
let homeIndicatorGroup: THREE.Group | null = null;

const defaultOrientation: MachineOrientation = {
  xHome: 'min',
  yHome: 'max',
  zHome: 'max',
  homeCorner: 'back-left'
};

const resolvedOrientation = computed(() => props.machineOrientation ?? defaultOrientation);

const computeAxisBounds = (size: number | undefined, offset: number, home: AxisHome) => {
  const axisSize = typeof size === 'number' && !Number.isNaN(size) ? size : 0;
  if (home === 'max') {
    return {
      min: -axisSize - offset,
      max: -offset
    };
  }
  return {
    min: -offset,
    max: axisSize - offset
  };
};

const resolveGridSize = (value?: number) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return DEFAULT_GRID_SIZE_MM;
};

const resolveZTravel = (value?: number | null) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return DEFAULT_Z_TRAVEL_MM;
};

const computeGridBoundsFrom = (workOffset = props.workOffset) => {
  const gridSizeX = resolveGridSize(props.gridSizeX);
  const gridSizeY = resolveGridSize(props.gridSizeY);
  const workOffsetX = workOffset?.x ?? 0;
  const workOffsetY = workOffset?.y ?? 0;
  const workOffsetZ = workOffset?.z ?? 0;
  const orientation = resolvedOrientation.value;

  const xBounds = computeAxisBounds(gridSizeX, workOffsetX, orientation.xHome);
  const yBounds = computeAxisBounds(gridSizeY, workOffsetY, orientation.yHome);

  const zMax = resolveZTravel(props.zMaxTravel);
  const zBounds = zMax != null ? computeAxisBounds(zMax, workOffsetZ, orientation.zHome) : null;

  return {
    minX: xBounds.min,
    maxX: xBounds.max,
    minY: yBounds.min,
    maxY: yBounds.max,
    minZ: zBounds ? zBounds.min : undefined,
    maxZ: zBounds ? zBounds.max : undefined
  };
};

const applyBoundsAndWarnings = (bounds: ReturnType<typeof computeGridBoundsFrom>) => {
  if (!gcodeVisualizer) return;
  gcodeVisualizer.setGridBounds(bounds);
  showOutOfBoundsWarning.value = gcodeVisualizer.hasOutOfBoundsMovement();
  outOfBoundsAxes.value = gcodeVisualizer.getOutOfBoundsAxes();
  outOfBoundsDirections.value = gcodeVisualizer.getOutOfBoundsDirections();
};

const rebuildGrid = (workOffset = props.workOffset, viewType: 'top' | 'front' | 'iso' = props.view) => {
  if (scene && gridGroup) {
    scene.remove(gridGroup);
  }

  if (viewType === 'front') {
    gridGroup = createSideViewGrid({
      gridSizeX: resolveGridSize(props.gridSizeX),
      gridSizeZ: resolveZTravel(props.zMaxTravel),
      workOffset,
      orientation: resolvedOrientation.value,
      units: appStore.unitsPreference.value
    });
  } else {
    gridGroup = createGridLines({
      gridSizeX: resolveGridSize(props.gridSizeX),
      gridSizeY: resolveGridSize(props.gridSizeY),
      workOffset,
      orientation: resolvedOrientation.value,
      units: appStore.unitsPreference.value
    });
  }

  if (scene) {
    scene.add(gridGroup);
  }

  const bounds = computeGridBoundsFrom(workOffset);
  applyBoundsAndWarnings(bounds);
  refreshHomeIndicator();

  if (!autoFitMode.value) {
    fitCameraToBounds(getGridBounds());
  }

  return bounds;
};

// Mouse/touch controls
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let isRotating = false;
let isPanning = false;
let cameraTarget = new THREE.Vector3(0, 0, 0);
let pendingResizeFrame: number | null = null;

// Spindle position interpolation with exponential smoothing
let targetSpindlePosition = { x: 0, y: 0, z: 0 };
let currentSpindlePosition = { x: 0, y: 0, z: 0 };
const spindleSmoothFactor = 0.2; // Lower = smoother but slower (0.05-0.2 recommended)
const machineOriginPosition = new THREE.Vector3();

const disposeHomeIndicator = () => {
  if (!homeIndicatorGroup) return;
  homeIndicatorGroup.traverse((child: any) => {
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        if (mat?.map && typeof mat.map.dispose === 'function') {
          mat.map.dispose();
        }
        if (typeof mat?.dispose === 'function') {
          mat.dispose();
        }
      });
    }
    if (child.geometry && typeof child.geometry.dispose === 'function') {
      child.geometry.dispose();
    }
  });
  homeIndicatorGroup = null;
};

const computeMachineOriginPosition = () => {
  const workOffset = props.workOffset || { x: 0, y: 0, z: 0 };
  const xOffset = typeof workOffset.x === 'number' ? workOffset.x : 0;
  const yOffset = typeof workOffset.y === 'number' ? workOffset.y : 0;
  machineOriginPosition.set(-xOffset, -yOffset, 0);
  return machineOriginPosition;
};

const refreshHomeIndicator = () => {
  if (!scene) return;

  if (homeIndicatorGroup) {
    scene.remove(homeIndicatorGroup);
    disposeHomeIndicator();
  }

  homeIndicatorGroup = createHomeIndicator();
  scene.add(homeIndicatorGroup);

  const basePosition = computeMachineOriginPosition();
  if (spindleViewMode.value) {
    const offset = {
      x: -currentSpindlePosition.x,
      y: -currentSpindlePosition.y,
      z: -currentSpindlePosition.z
    };
    homeIndicatorGroup.position.set(
      basePosition.x + offset.x,
      basePosition.y + offset.y,
      basePosition.z + offset.z
    );
  } else {
    homeIndicatorGroup.position.copy(basePosition);
  }
};

const initThreeJS = () => {
  if (!canvas.value) return;

  // Scene
  scene = new THREE.Scene();
  updateSceneBackground();

  // Orthographic Camera - Z-up orientation (standard CNC view)
  const measuredWidth = canvas.value.clientWidth;
  const measuredHeight = canvas.value.clientHeight;
  const safeWidth = measuredWidth > 0 ? measuredWidth : 1;
  const safeHeight = measuredHeight > 0 ? measuredHeight : 1;
  const aspect = safeWidth / safeHeight;
  const frustumSize = 200; // Initial viewport size in world units
  camera = new THREE.OrthographicCamera(
    (-frustumSize * aspect) / 2, // left
    (frustumSize * aspect) / 2,  // right
    frustumSize / 2,             // top
    -frustumSize / 2,            // bottom
    0.1,                         // near
    10000                        // far - increased to support large grid views
  );
  // Position camera in 3D isometric view with Z pointing up
  camera.position.set(100, -100, 100);
  camera.lookAt(0, 0, 0);
  camera.up.set(0, 0, 1); // Set Z as the up direction

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(safeWidth, safeHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvas.value.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambientLight);

  directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  if (props.theme === 'dark') {
    directionalLight.position.set(50, 50, 50);
  } else {
    directionalLight.position.set(50, -20, 20);
  }
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  // Grid with numbers and major/minor lines (use appropriate grid for initial view)
  if (props.view === 'front') {
    gridGroup = createSideViewGrid({
      gridSizeX: resolveGridSize(props.gridSizeX),
      gridSizeZ: resolveZTravel(props.zMaxTravel),
      workOffset: props.workOffset,
      orientation: resolvedOrientation.value,
      units: appStore.unitsPreference.value
    });
  } else {
    gridGroup = createGridLines({
      gridSizeX: resolveGridSize(props.gridSizeX),
      gridSizeY: resolveGridSize(props.gridSizeY),
      workOffset: props.workOffset,
      orientation: resolvedOrientation.value,
      units: appStore.unitsPreference.value
    });
  }
  scene.add(gridGroup);

  axesGroup = createCoordinateAxes(50);
  scene.add(axesGroup);

  // Add initial axis labels
  axisLabelsGroup = createDynamicAxisLabels(null, props.view);
  scene.add(axisLabelsGroup);

  // G-code visualizer
  gcodeVisualizer = new GCodeVisualizer();
  scene.add(gcodeVisualizer.group);
  // Improve rapid color contrast in light theme
  if (props.theme === 'light') {
    gcodeVisualizer.setRapidColor(0xE67E22); // orange for light theme
  }

  const initialBounds = computeGridBoundsFrom(props.workOffset);
  gcodeVisualizer.setGridBounds(initialBounds);

  // Add cutting pointer/spindle
  cuttingPointer = generateCuttingPointer();
  cuttingPointer.position.set(0, 0, 0); // Start at origin
  scene.add(cuttingPointer);

  refreshHomeIndicator();

  // Set initial pointer scale
  updatePointerScale();

  // Set initial pointer opacity after a delay (for async OBJ loading)
  setTimeout(() => {
    updatePointerOpacity();
  }, 500);

  // Add mouse/touch controls
  setupControls();

  // Start animation loop
  animate();

  // Align renderer with layout as soon as dimensions are available
  handleResize();
};


const setupControls = () => {
  if (!canvas.value || !renderer) return;

  const element = renderer.domElement;

  // Mouse events
  element.addEventListener('mousedown', onMouseDown);
  element.addEventListener('mousemove', onMouseMove);
  element.addEventListener('mouseup', onMouseUp);
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('click', onCanvasClick);

  // Touch events for mobile
  element.addEventListener('touchstart', onTouchStart, { passive: false });
  element.addEventListener('touchmove', onTouchMove, { passive: false });
  element.addEventListener('touchend', onTouchEnd);
};

// Track mouse movement to distinguish click from drag
let mouseDownPosition = { x: 0, y: 0 };
let mouseMoved = false;

// Track touch for double-tap detection
let lastTapTime = 0;
let lastTapPosition = { x: 0, y: 0 };

// Handle click on canvas to select toolpath segment
const onCanvasClick = (event: MouseEvent) => {
  // Only process if mouse didn't move much (not a drag)
  const dx = event.clientX - mouseDownPosition.x;
  const dy = event.clientY - mouseDownPosition.y;
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) return;

  // Only handle left clicks
  if (event.button !== 0) return;

  // Check if we have a toolpath to click on
  if (!gcodeVisualizer || !camera || !renderer) return;

  // Use screen-space detection for accurate clicking on overlapping segments
  const rect = renderer.domElement.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;

  // Find the closest segment to the click point in screen space
  const lineNumber = gcodeVisualizer.getLineNumberFromScreenPoint(
    screenX, screenY, camera, rect.width, rect.height, 15
  );

  if (lineNumber) {
    // Check for double-click to open Start From Line dialog
    if (event.detail === 2) {
      openStartFromLineDialog(lineNumber);
    } else {
      // Single click - update selected lines in store
      const lines = new Set<number>([lineNumber]);
      appStore.setSelectedGCodeLines(lines);
    }
  } else {
    // Clicked empty space - clear selection
    appStore.clearSelectedGCodeLines();
  }
};

const onMouseDown = (event: MouseEvent) => {
  isDragging = true;
  previousMousePosition = { x: event.clientX, y: event.clientY };
  mouseDownPosition = { x: event.clientX, y: event.clientY };

  // Only allow rotation in 3D view, not in top or side views
  const isOrthographicView = props.view === 'top' || props.view === 'front';
  isPanning = event.button === 0; // Left click for panning in all views
  isRotating = event.button === 2 && !isOrthographicView; // Right click for rotation (3D only)
};

const onMouseMove = (event: MouseEvent) => {
  if (!isDragging || !camera) return;

  const deltaX = event.clientX - previousMousePosition.x;
  const deltaY = event.clientY - previousMousePosition.y;

  if (isRotating) {
    // Onshape-style trackball rotation
    // Rotate around screen axes, not spherical coordinates
    const rotationSpeed = 0.005;

    // Get camera's right and up vectors (in world space)
    const right = new THREE.Vector3();
    const up = new THREE.Vector3(0, 0, 1); // Always use world Z-up for vertical rotation

    right.setFromMatrixColumn(camera.matrix, 0); // Camera's right vector
    right.z = 0; // Project onto XY plane to keep rotation around Z-axis
    right.normalize();

    // Create rotation around the up axis (Z) for horizontal mouse movement
    const horizontalRotation = new THREE.Quaternion();
    horizontalRotation.setFromAxisAngle(up, -deltaX * rotationSpeed);

    // Create rotation around the right axis for vertical mouse movement
    const verticalRotation = new THREE.Quaternion();
    verticalRotation.setFromAxisAngle(right, -deltaY * rotationSpeed);

    // Combine rotations
    const combinedRotation = new THREE.Quaternion();
    combinedRotation.multiplyQuaternions(horizontalRotation, verticalRotation);

    // Apply rotation to camera position around the target
    const offset = camera.position.clone().sub(cameraTarget);
    offset.applyQuaternion(combinedRotation);
    camera.position.copy(cameraTarget).add(offset);

    camera.up.set(0, 0, 1); // Maintain Z-up orientation
    camera.lookAt(cameraTarget);
  } else if (isPanning) {
    // Pan camera by moving both position and target
    // For orthographic camera, base speed on frustum size instead of distance
    const frustumWidth = camera.right - camera.left;
    const panSpeed = frustumWidth * 0.0005; // Reduced from 0.001 to 0.0005 for slower panning

    // Calculate pan vectors based on camera orientation
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();

    right.setFromMatrixColumn(camera.matrix, 0); // Get camera's right vector
    up.setFromMatrixColumn(camera.matrix, 1);    // Get camera's up vector

    // Apply panning
    const panDelta = new THREE.Vector3()
      .addScaledVector(right, -deltaX * panSpeed)
      .addScaledVector(up, deltaY * panSpeed);

    camera.position.add(panDelta);
    cameraTarget.add(panDelta);
    camera.lookAt(cameraTarget);
  }

  previousMousePosition = { x: event.clientX, y: event.clientY };
};

const onMouseUp = () => {
  isDragging = false;
  isRotating = false;
  isPanning = false;
};

const updatePointerScale = () => {
  if (!camera || !cuttingPointer) return;

  const frustumWidth = camera.right - camera.left;
  let scale = frustumWidth * 0.01; // 1% of visible width

  const maxScale = 5; // Maximum scale limit for pointer
  scale = Math.min(scale, maxScale);

  cuttingPointer.scale.set(scale, scale, scale);
};

const onWheel = (event: WheelEvent) => {
  event.preventDefault();
  if (!camera) return;

  // For orthographic camera, zoom by adjusting the frustum size
  const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9;

  camera.left *= zoomFactor;
  camera.right *= zoomFactor;
  camera.top *= zoomFactor;
  camera.bottom *= zoomFactor;

  // Limit zoom range
  const frustumWidth = camera.right - camera.left;
  if (frustumWidth < 1) {
    // Prevent zooming in too far
    const scale = 1 / frustumWidth;
    camera.left *= scale;
    camera.right *= scale;
    camera.top *= scale;
    camera.bottom *= scale;
  } else if (frustumWidth > 2000) {
    // Prevent zooming out too far
    const scale = 2000 / frustumWidth;
    camera.left *= scale;
    camera.right *= scale;
    camera.top *= scale;
    camera.bottom *= scale;
  }

  camera.updateProjectionMatrix();
  updatePointerScale();
};

// Touch events with two-finger panning support
let lastTouchDistance = 0;
let lastTwoFingerCenter = { x: 0, y: 0 };

let touchStartPosition = { x: 0, y: 0 };

const onTouchStart = (event: TouchEvent) => {
  if (event.touches.length === 1) {
    const touch = event.touches[0];
    touchStartPosition = { x: touch.clientX, y: touch.clientY };
    onMouseDown({ clientX: touch.clientX, clientY: touch.clientY, button: 0 } as MouseEvent);
  } else if (event.touches.length === 2) {
    // Two fingers - setup for rotation
    isDragging = true;
    const isOrthographicView = props.view === 'top' || props.view === 'front';
    isRotating = !isOrthographicView; // Rotation only in 3D view
    isPanning = false;

    const touch1 = event.touches[0];
    const touch2 = event.touches[1];

    lastTwoFingerCenter = {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2
    };
    previousMousePosition = lastTwoFingerCenter;

    // Store distance for pinch zoom
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
  }
};

const onTouchMove = (event: TouchEvent) => {
  event.preventDefault();
  if (event.touches.length === 1) {
    const touch = event.touches[0];
    onMouseMove({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent);
  } else if (event.touches.length === 2) {
    const touch1 = event.touches[0];
    const touch2 = event.touches[1];

    // Calculate new center for panning
    const newCenter = {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2
    };

    // Pan based on center movement
    onMouseMove({ clientX: newCenter.x, clientY: newCenter.y } as MouseEvent);

    // Handle pinch zoom
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (lastTouchDistance > 0) {
      const zoomFactor = lastTouchDistance / distance;

      camera.left *= zoomFactor;
      camera.right *= zoomFactor;
      camera.top *= zoomFactor;
      camera.bottom *= zoomFactor;

      // Limit zoom range
      const frustumWidth = camera.right - camera.left;
      if (frustumWidth < 1) {
        const scale = 1 / frustumWidth;
        camera.left *= scale;
        camera.right *= scale;
        camera.top *= scale;
        camera.bottom *= scale;
      } else if (frustumWidth > 2000) {
        const scale = 2000 / frustumWidth;
        camera.left *= scale;
        camera.right *= scale;
        camera.top *= scale;
        camera.bottom *= scale;
      }

      camera.updateProjectionMatrix();
      updatePointerScale();
    }

    lastTouchDistance = distance;
    lastTwoFingerCenter = newCenter;
  }
};

const onTouchEnd = (event: TouchEvent) => {
  // Check if this was a tap (no significant movement)
  const dx = touchStartPosition.x - mouseDownPosition.x;
  const dy = touchStartPosition.y - mouseDownPosition.y;
  const wasTap = Math.abs(dx) < 10 && Math.abs(dy) < 10;

  if (wasTap && gcodeVisualizer && camera && renderer) {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTime;
    const distFromLastTap = Math.sqrt(
      Math.pow(touchStartPosition.x - lastTapPosition.x, 2) +
      Math.pow(touchStartPosition.y - lastTapPosition.y, 2)
    );

    // Check if it's a double-tap (within 300ms and 30px of last tap)
    const isDoubleTap = timeSinceLastTap < 300 && distFromLastTap < 30;

    // Use screen-space detection for accurate tapping on overlapping segments
    if (gcodeVisualizer && camera && renderer) {
      const rect = renderer.domElement.getBoundingClientRect();
      const screenX = touchStartPosition.x - rect.left;
      const screenY = touchStartPosition.y - rect.top;

      // Find the closest segment to the tap point in screen space
      const lineNumber = gcodeVisualizer.getLineNumberFromScreenPoint(
        screenX, screenY, camera, rect.width, rect.height, 20
      );

      if (lineNumber) {
        if (isDoubleTap) {
          // Double-tap - open Start From Line dialog
          openStartFromLineDialog(lineNumber);
        } else {
          // Single tap - select the line
          const lines = new Set<number>([lineNumber]);
          appStore.setSelectedGCodeLines(lines);
        }
      } else if (!isDoubleTap) {
        // Tapped empty space - clear selection
        appStore.clearSelectedGCodeLines();
      }
    }

    // Update last tap tracking
    lastTapTime = now;
    lastTapPosition = { ...touchStartPosition };
  }

  onMouseUp();
  lastTouchDistance = 0;
};

const updateSceneBackground = () => {
  if (!scene) return;

  // Set background color based on theme
  const backgroundColor = props.theme === 'dark' ? 0x111827 : 0xf8fafc; // Dark blue-gray vs light gray
  scene.background = new THREE.Color(backgroundColor);
};

let lastSpindleUpdateTime = 0;
const spindleUpdateInterval = 1000 / 30; // 30 fps for spindle animation

const animate = () => {
  animationId = requestAnimationFrame(animate);

  // Smoothly interpolate spindle position with exponential smoothing (no bouncing)
  if (cuttingPointer) {
    // Simple exponential moving average - always approaches target, never overshoots
    currentSpindlePosition.x += (targetSpindlePosition.x - currentSpindlePosition.x) * spindleSmoothFactor;
    currentSpindlePosition.y += (targetSpindlePosition.y - currentSpindlePosition.y) * spindleSmoothFactor;
    currentSpindlePosition.z += (targetSpindlePosition.z - currentSpindlePosition.z) * spindleSmoothFactor;

    // In spindle view mode, spindle stays at origin and everything else moves
    if (spindleViewMode.value) {
      // Keep spindle at origin
      cuttingPointer.position.set(0, 0, 0);

      // Move gcode/grid/axes in opposite direction
      const offset = {
        x: -currentSpindlePosition.x,
        y: -currentSpindlePosition.y,
        z: -currentSpindlePosition.z
      };
      if (gcodeVisualizer && gcodeVisualizer.group) {
        gcodeVisualizer.group.position.set(offset.x, offset.y, offset.z);
      }
      if (gridGroup) gridGroup.position.set(offset.x, offset.y, offset.z);
      if (axesGroup) axesGroup.position.set(offset.x, offset.y, offset.z);
      if (axisLabelsGroup) axisLabelsGroup.position.set(offset.x, offset.y, offset.z);
      if (homeIndicatorGroup) {
        const basePosition = computeMachineOriginPosition();
        homeIndicatorGroup.position.set(
          basePosition.x + offset.x,
          basePosition.y + offset.y,
          basePosition.z + offset.z
        );
      }

      // Update camera target to origin but maintain camera position relative to it
      if (camera && cameraTarget.x !== 0 || cameraTarget.y !== 0 || cameraTarget.z !== 0) {
        const cameraOffset = camera.position.clone().sub(cameraTarget);
        cameraTarget.set(0, 0, 0);
        camera.position.copy(cameraTarget).add(cameraOffset);
        camera.lookAt(cameraTarget);
      }
    } else {
      // Normal mode: spindle follows position
      cuttingPointer.position.set(currentSpindlePosition.x, currentSpindlePosition.y, currentSpindlePosition.z);
      if (homeIndicatorGroup) {
        const basePosition = computeMachineOriginPosition();
        homeIndicatorGroup.position.copy(basePosition);
      }
    }

    // Rotate cutting pointer when spindle is spinning (throttled to 30 fps)
    if (props.spindleRpmActual > 0) {
      const now = performance.now();
      if (now - lastSpindleUpdateTime >= spindleUpdateInterval) {
        // Rotate around Z axis (spindle axis after rotation)
        // 10 rotations per second at 30 fps = (10 * 2π) / 30 radians per update
        const rotationSpeed = (10 * 2 * Math.PI) / 30;
        cuttingPointer.rotation.z += rotationSpeed;
        lastSpindleUpdateTime = now;
      }
    } else {
      // Spindle stopped - reset rotation to 0
      cuttingPointer.rotation.z = 0;
    }
  }

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
};

const handleFileLoad = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) {
    return;
  }

  isLoading.value = true;
  try {
    // Upload file to server
    const result = await api.uploadGCodeFile(file);
    // File content will be received via WebSocket and handled in onGCodeUpdated

    // Clear the file input
    if (fileInput.value) {
      fileInput.value.value = '';
    }
  } catch (error) {
    console.error('Error loading file:', error);
  } finally {
    isLoading.value = false;
  }
};

const handleGCodeUpdate = async (data: { filename: string; content?: string; timestamp: string }) => {
  try {
    // If no content provided, show loading and wait for gcode-content-ready event (new metadata-only flow)
    if (!data.content) {
      isLoading.value = true;
      loadingMessage.value = 'Downloading G-code...';
      loadingProgress.value = 0;
      return;
    }

    const content = data.content;

    // Show loading for rendering
    isLoading.value = true;
    loadingMessage.value = 'Rendering toolpath...';
    loadingProgress.value = 50;

    // Reset completed lines before rendering new G-code
    if (gcodeVisualizer) {
      gcodeVisualizer.resetCompletedLines();
      gcodeVisualizer.clearSelectedLines();
    }
    // Clear selected lines in store when new file loads
    appStore.clearSelectedGCodeLines();

    // Set grid bounds for out-of-bounds detection
    const gridBounds = computeGridBoundsFrom(props.workOffset);
    gcodeVisualizer.setGridBounds(gridBounds);

    loadingProgress.value = 70;
    gcodeVisualizer.render(content);
    loadingProgress.value = 90;

    // Get tool colors from visualizer
    toolPathColors.value = gcodeVisualizer.getToolsInfo();

    // Detect tools used based on M6 lines with tool numbers
    toolsUsed.value = extractToolsFromGCode(content);

    // Check if G-code has out of bounds movements (only when sender is idle and not tool changing)
    const currentStatus = props.senderStatus?.toLowerCase();
    const isToolChanging = props.machineState?.isToolChanging === true;
    if (currentStatus === 'idle' && !isToolChanging) {
      showOutOfBoundsWarning.value = gcodeVisualizer.hasOutOfBoundsMovement();
      outOfBoundsAxes.value = gcodeVisualizer.getOutOfBoundsAxes();
      outOfBoundsDirections.value = gcodeVisualizer.getOutOfBoundsDirections();
    }

    // Reset all line type visibility to true when loading new G-code
    showRapids.value = true;
    showCutting.value = true;

    // Fit camera to content with automatic centering and zoom
    const gcodeBounds = gcodeVisualizer.getBounds();
    if (gcodeBounds && gcodeBounds.size.length() > 0) {
      currentGCodeBounds = gcodeBounds; // Store bounds for later use
      // Fit to current view (honors user's selection / default)
      if (autoFitMode.value) {
        fitCameraToBounds(gcodeBounds);
      }
    }

    hasFile.value = true;

    // Set initial visibility for all line types
    gcodeVisualizer.setRapidVisibility(showRapids.value);
    gcodeVisualizer.setCuttingVisibility(showCutting.value);

    // Check if we have a last executed line (from server state on page load)
    // and mark all lines up to that point as completed
    // Check both lastExecutedLine (reactive state) and props.jobLoaded (server state on page-reload)
    // Include 'running' status - user may have refreshed page while job was running
    const jobStatus = props.jobLoaded?.status;
    const propsCurrentLine = props.jobLoaded?.currentLine ?? 0;
    const lineToRestore = Math.max(lastExecutedLine.value,
      (jobStatus === 'running' || jobStatus === 'stopped' || jobStatus === 'paused' || jobStatus === 'completed') ? propsCurrentLine : 0
    );

    if (lineToRestore > 0) {
      const completedLines = [];
      for (let i = 1; i <= lineToRestore; i++) {
        completedLines.push(i);
      }
      gcodeVisualizer.markLinesCompleted(completedLines);
      // Also update markedLines to keep track
      completedLines.forEach(ln => markedLines.add(ln));
    }

    // Update axis labels based on G-code bounds
    if (axisLabelsGroup) {
      scene.remove(axisLabelsGroup);
    }
    axisLabelsGroup = createDynamicAxisLabels(gcodeBounds, props.view);
    scene.add(axisLabelsGroup);
    updatePointerScale();

    // Complete loading
    loadingProgress.value = 100;
    setTimeout(() => {
      isLoading.value = false;
    }, 300);
  } catch (error) {
    console.error('Error rendering G-code:', error);
    isLoading.value = false;
  }
};

const clearFile = async () => {
  try {
    // Clear on server and notify all clients
    await api.clearGCode();
  } catch (error) {
    console.error('Error clearing G-code:', error);
    // Fallback to local clear if API fails
    handleGCodeClear();
  }
};

const handleGCodeClear = () => {
  if (gcodeVisualizer) {
    gcodeVisualizer.clear();
  }
  // Clear tool colors
  toolPathColors.value = [];
  // Also clear G-code preview content
  if (store && typeof store.clearGCodePreview === 'function') {
    store.clearGCodePreview();
  }
  hasFile.value = false;
  showOutOfBoundsWarning.value = false;
  toolsUsed.value = [];
  if (fileInput.value) {
    fileInput.value.value = '';
  }
};

const toggleRapids = () => {
  showRapids.value = !showRapids.value;
  if (gcodeVisualizer) {
    gcodeVisualizer.setRapidVisibility(showRapids.value);
  }
};

const toggleCutting = () => {
  showCutting.value = !showCutting.value;
  if (gcodeVisualizer) {
    gcodeVisualizer.setCuttingVisibility(showCutting.value);
  }
};

const toggleSpindle = () => {
  showSpindle.value = !showSpindle.value;
  if (cuttingPointer) {
    cuttingPointer.visible = showSpindle.value;
  }
};

const toggleTool = (toolNumber: number) => {
  if (!gcodeVisualizer) return;

  // Find and toggle the tool in our local array
  const tool = toolPathColors.value.find(t => t.number === toolNumber);
  if (tool) {
    tool.visible = !tool.visible;
    gcodeVisualizer.setToolVisibility(toolNumber, tool.visible);
  }
};

// Get tool color from the color palette
const getToolColor = (toolNumber: number): string => {
  const tool = toolPathColors.value.find(t => t.number === toolNumber);
  if (tool) {
    return '#' + tool.color.toString(16).padStart(6, '0');
  }
  return '#1abc9c'; // Fallback to default accent color
};

// Probe dialog
const openProbeDialog = () => {
  showProbeDialog.value = true;
};

// Control button handlers
const handleCycle = async () => {
  if (!props.jobLoaded?.filename && !isOnHold.value) return;

  try {
    if (isOnHold.value) {
      // Resume job
      await api.controlGCodeJob('resume');
    } else {
      // Start new job
      await api.startGCodeJob(props.jobLoaded.filename);
    }
  } catch (error) {
    console.error('Error controlling job:', error);
  }
};

const handlePause = async () => {
  try {
    await api.controlGCodeJob('pause');
  } catch (error) {
    console.error('Error pausing job:', error);
  }
};

const handleStop = async () => {
  try {
    // Send soft reset to stop/cancel any active operation
    await api.sendCommandViaWebSocket({
      command: '\x18'
    });
  } catch (error) {
    console.error('Error stopping job:', error);
  }
};

const openStartFromLineDialog = (lineNumber?: number) => {
  // Use provided lineNumber, or jobLoaded.currentLine from server state, or default to 1
  const suggestedLine = lineNumber ?? (props.jobLoaded?.currentLine || 0);
  startFromLineInitial.value = suggestedLine > 0 ? suggestedLine : 1;
  showStartFromLineDialog.value = true;
};

const handleStartFromLineSuccess = (_data: { line: number }) => {
  // Job started successfully - no action needed here
};

const canStartFromLine = computed(() => {
  return props.jobLoaded?.filename &&
         props.jobLoaded?.totalLines > 0 &&
         store.isConnected.value &&
         store.isHomed.value &&
         !isJobRunning.value &&
         !store.isProbing.value;
});

const getGridBounds = () => {
  const { minX, maxX, minY, maxY } = computeGridBoundsFrom(props.workOffset);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;

  const bounds = {
    center: new THREE.Vector3(
      centerX,
      centerY,
      0
    ),
    size: new THREE.Vector3(
      sizeX,
      sizeY,
      Math.max(sizeX, sizeY) * 0.15 // 15% of max grid dimension for Z
    )
  };

  return bounds;
};

const fitCameraToBounds = (bounds: any, viewType?: 'top' | 'front' | 'iso') => {
  if (!bounds || !camera) return;

  // Use current view type if not specified
  const currentView = viewType || props.view;

  // For orthographic camera, adjust frustum to fit the G-code bounds
  const padding = 1.1; // 10% padding to give the camera breathing room
  const aspect = (camera.right - camera.left) / (camera.top - camera.bottom);

  const sizeX = bounds.size.x * padding;
  const sizeY = bounds.size.y * padding;
  const sizeZ = bounds.size.z * padding;

  // Set frustum based on the view type
  let frustumWidth, frustumHeight;

  switch (currentView) {
    case 'top':
      // Top view: fit X and Y dimensions
      if (sizeX / aspect > sizeY) {
        frustumWidth = sizeX;
        frustumHeight = sizeX / aspect;
      } else {
        frustumHeight = sizeY;
        frustumWidth = sizeY * aspect;
      }
      break;
    case 'front':
      // Front view: fit X and Z dimensions
      if (sizeX / aspect > sizeZ) {
        frustumWidth = sizeX;
        frustumHeight = sizeX / aspect;
      } else {
        frustumHeight = sizeZ;
        frustumWidth = sizeZ * aspect;
      }
      break;
    case 'iso':
    default:
      // 3D view: calculate the projected size for isometric view
      // The camera is positioned at (0.7, -0.7, 0.7), so we need to calculate
      // the apparent size from this viewing angle
      const projectedWidth = Math.sqrt(sizeX * sizeX + sizeY * sizeY); // XY diagonal
      const projectedHeight = Math.max(sizeZ, projectedWidth * 0.7); // Include Z height

      if (projectedWidth / aspect > projectedHeight) {
        frustumWidth = projectedWidth;
        frustumHeight = projectedWidth / aspect;
      } else {
        frustumHeight = projectedHeight;
        frustumWidth = projectedHeight * aspect;
      }
      break;
  }

  camera.left = -frustumWidth / 2;
  camera.right = frustumWidth / 2;
  camera.top = frustumHeight / 2;
  camera.bottom = -frustumHeight / 2;
  camera.updateProjectionMatrix();

  // Update pointer scale after changing frustum
  updatePointerScale();

  // Update camera target and position
  // For 3D view, adjust the target to pan the view up for better centering
  if (currentView === 'iso') {
    cameraTarget.set(bounds.center.x, bounds.center.y, bounds.center.z - bounds.size.z * 0.2);
  } else {
    cameraTarget.copy(bounds.center);
  }
  camera.up.set(0, 0, 1);

  // Position camera based on view type
  const distance = Math.max(sizeX, sizeY, sizeZ) * 2.2; // Step back a little further for breathing room

  switch (currentView) {
    case 'top':
      camera.position.set(bounds.center.x, bounds.center.y, bounds.center.z + distance);
      camera.up.set(0, 1, 0);
      break;
    case 'front':
      camera.position.set(bounds.center.x, bounds.center.y - distance, bounds.center.z);
      camera.up.set(0, 0, 1);
      break;
    case 'iso':
    default:
      // Isometric 3D view with Z up
      camera.position.set(
        bounds.center.x + distance * 0.7,
        bounds.center.y - distance * 0.7,
        bounds.center.z + distance * 0.7
      );
      camera.up.set(0, 0, 1);
      break;
  }

  camera.lookAt(cameraTarget);
};

const handleViewButtonClick = async (viewType: 'top' | 'front' | 'iso') => {
  // Save view preference to settings
  try {
    await updateSettings({ defaultGcodeView: viewType });
  } catch (error) {
    console.error('[GCodeVisualizer] Failed to save view setting.', JSON.stringify({ error: error.message }));
  }

  // Reset all line type visibility to true when changing views
  showRapids.value = true;
  showCutting.value = true;

  // Update visualizer visibility
  if (gcodeVisualizer) {
    gcodeVisualizer.setRapidVisibility(showRapids.value);
    gcodeVisualizer.setCuttingVisibility(showCutting.value);
  }

  // Always emit the view change (even if it's the same view)
  emit('change-view', viewType);

  // Always fit to view when clicking a view button
  if (autoFitMode.value && currentGCodeBounds) {
    fitCameraToBounds(currentGCodeBounds, viewType);
  } else {
    fitCameraToBounds(getGridBounds(), viewType);
  }
};

const handleResize = () => {
  if (!canvas.value || !camera || !renderer) return;

  const width = canvas.value.clientWidth;
  const height = canvas.value.clientHeight;

  if (width <= 0 || height <= 0) {
    if (pendingResizeFrame == null) {
      pendingResizeFrame = requestAnimationFrame(() => {
        pendingResizeFrame = null;
        handleResize();
      });
    }
    return;
  }

  if (pendingResizeFrame != null) {
    cancelAnimationFrame(pendingResizeFrame);
    pendingResizeFrame = null;
  }

  const aspect = width / height;
  const frustumHeight = camera.top - camera.bottom;
  const frustumWidth = frustumHeight * aspect;

  camera.left = -frustumWidth / 2;
  camera.right = frustumWidth / 2;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);

  updatePointerScale();
};

// View presets with Z-up orientation
const setCameraView = (viewType: 'top' | 'front' | 'iso') => {
  if (!camera) return;

  const distance = camera.position.distanceTo(cameraTarget);
  const center = currentGCodeBounds ? currentGCodeBounds.center : new THREE.Vector3(0, 0, 0);

  // Update camera target
  cameraTarget.copy(center);

  switch (viewType) {
    case 'top':
      // Top view - looking down along Z axis with proper CNC orientation
      // Y points up on screen, X points right on screen
      camera.position.set(center.x, center.y, center.z + distance);
      camera.up.set(0, 1, 0); // Y axis points up in top view
      break;
    case 'front':
      // Front view - looking along Y axis with Z up
      camera.position.set(center.x, center.y - distance, center.z);
      camera.up.set(0, 0, 1); // Z axis points up in front view
      break;
    case 'iso':
      // Isometric 3D view with Z up
      camera.position.set(
        center.x + distance * 0.7,
        center.y - distance * 0.7,
        center.z + distance * 0.7
      );
      camera.up.set(0, 0, 1); // Z axis points up in 3D view
      break;
  }

  camera.lookAt(cameraTarget);
};

// Update pointer opacity based on view
const updatePointerOpacity = () => {
  if (!cuttingPointer) return;

  const opacity = props.view === 'top' ? 0.3 : 1.0;
  cuttingPointer.traverse((child) => {
    if (child.isMesh && child.material) {
      child.material.opacity = opacity;
    }
  });
};

// Watch for view changes
watch(() => props.view, (newView) => {
  setCameraView(newView);
  // Rebuild grid for the new view (top/3D uses XY grid, side uses XZ grid)
  rebuildGrid(props.workOffset, newView);
  // Rebuild axis labels (hide Y in side view)
  if (scene && axisLabelsGroup) {
    scene.remove(axisLabelsGroup);
    axisLabelsGroup = createDynamicAxisLabels(currentGCodeBounds, newView);
    scene.add(axisLabelsGroup);
  }
  // Auto fit to view when changing views with the specific view type
  if (autoFitMode.value && currentGCodeBounds) {
    fitCameraToBounds(currentGCodeBounds, newView);
  } else {
    fitCameraToBounds(getGridBounds(), newView);
  }
  // Update pointer opacity
  updatePointerOpacity();
});

// Watch for theme changes
watch(() => props.theme, (newTheme) => {
  updateSceneBackground();

  // Update light position based on theme
  if (directionalLight) {
    if (newTheme === 'dark') {
      directionalLight.position.set(50, 50, 50);
    } else {
      directionalLight.position.set(50, -20, 20);
    }
  }
  // Update rapid color for visibility by theme
  if (gcodeVisualizer) {
    if (newTheme === 'light') {
      gcodeVisualizer.setRapidColor(0xE67E22);
    } else {
      gcodeVisualizer.setRapidColor(0x00FF66);
    }
  }

  refreshHomeIndicator();
});

// Watch for work coordinate changes to update cutting pointer target position
watch(() => props.workCoords, (newCoords) => {
  if (newCoords) {
    targetSpindlePosition.x = newCoords.x;
    targetSpindlePosition.y = newCoords.y;
    targetSpindlePosition.z = newCoords.z;

    // Initialize current position on first coordinate update
    if (currentSpindlePosition.x === 0 && currentSpindlePosition.y === 0 && currentSpindlePosition.z === 0) {
      currentSpindlePosition.x = newCoords.x;
      currentSpindlePosition.y = newCoords.y;
      currentSpindlePosition.z = newCoords.z;
    }
  }
}, { deep: true, immediate: true });

// Watch for work offset changes to update the grid
watch(() => props.workOffset, (newOffset) => {
  if (isToolChanging.value) {
    showOutOfBoundsWarning.value = false;
    return;
  }
  rebuildGrid(newOffset);
}, { deep: true });

// When toolchange ends, recompute bounds and OOB once using the latest work offset
watch(isToolChanging, (nowChanging, wasChanging) => {
  if (nowChanging === false && wasChanging === true) {
    rebuildGrid(props.workOffset);
  }
});

// Auto-expand tool button when current tool changes
watch(() => props.currentTool, (newTool) => {
  if (newTool && newTool > 0 && toolInventory.value && toolInventory.value[newTool]) {
    showToolInfo.value = newTool;
  }
});

// Collapse tool button when job completes or machine goes idle
watch(() => [normalizedSenderStatus.value, props.jobLoaded?.status], ([senderStatus, jobStatus]) => {
  if (senderStatus === 'idle' || jobStatus === 'completed' || jobStatus === 'stopped') {
    showToolInfo.value = null;
  }
});

// Watch for grid size changes to update the grid and bounds
watch(() => [props.gridSizeX, props.gridSizeY], () => {
  rebuildGrid(props.workOffset);
});

// Watch for units preference changes to rebuild grid with new spacing/labels
watch(() => appStore.unitsPreference.value, () => {
  rebuildGrid(props.workOffset);
});

// Watch for Z travel changes to update limits
watch(() => props.zMaxTravel, () => {
  const bounds = computeGridBoundsFrom(props.workOffset);
  applyBoundsAndWarnings(bounds);
  if (!autoFitMode.value) {
    fitCameraToBounds(getGridBounds());
  }
});

// Watch for machine orientation changes to rebuild the grid
watch(() => props.machineOrientation, () => {
  rebuildGrid(props.workOffset);
}, { deep: true });


// Watch for auto-fit mode changes
watch(() => autoFitMode.value, async (isAutoFit) => {
  // Don't save during initial load
  if (!isInitialLoad) {
    try {
      await updateSettings({ autoFit: isAutoFit });
    } catch (error) {
      console.error('[GCodeVisualizer] Failed to save auto-fit setting', JSON.stringify({ error: error.message }));
    }
  }

  // Update camera view
  if (isAutoFit && currentGCodeBounds) {
    fitCameraToBounds(currentGCodeBounds);
  } else {
    fitCameraToBounds(getGridBounds());
  }
});

// Watch for spindle view mode changes
watch(() => spindleViewMode.value, async (isSpindleView) => {
  // Don't save during initial load
  if (!isInitialLoad) {
    try {
      await updateSettings({ spindleView: isSpindleView });
    } catch (error) {
      console.error('[GCodeVisualizer] Failed to save spindle view setting', JSON.stringify({ error: error.message }));
    }
  }

  if (isSpindleView) {
    // In spindle view mode, move gcode/grid/axes so spindle stays centered at (0,0,0)
    // The spindle position stays at camera origin, so we offset everything else
    if (gcodeVisualizer && gcodeVisualizer.group) {
      // Offset will be calculated based on current spindle position
      const offset = {
        x: -currentSpindlePosition.x,
        y: -currentSpindlePosition.y,
        z: -currentSpindlePosition.z
      };
      gcodeVisualizer.group.position.set(offset.x, offset.y, offset.z);
      if (gridGroup) gridGroup.position.set(offset.x, offset.y, offset.z);
      if (axesGroup) axesGroup.position.set(offset.x, offset.y, offset.z);
      if (axisLabelsGroup) axisLabelsGroup.position.set(offset.x, offset.y, offset.z);
      if (homeIndicatorGroup) {
        const basePosition = computeMachineOriginPosition();
        homeIndicatorGroup.position.set(
          basePosition.x + offset.x,
          basePosition.y + offset.y,
          basePosition.z + offset.z
        );
      }
    }

    // Center camera on spindle (0,0,0) while maintaining current zoom level and angle
    if (camera) {
      // Calculate the offset from current target to camera
      const cameraOffset = camera.position.clone().sub(cameraTarget);

      // Set new target to origin (where spindle will be)
      cameraTarget.set(0, 0, 0);

      // Move camera by the same offset from new target (maintains viewing angle)
      camera.position.copy(cameraTarget).add(cameraOffset);
      camera.lookAt(cameraTarget);
    }
  } else {
    // Normal mode - reset all positions
    if (gcodeVisualizer && gcodeVisualizer.group) {
      gcodeVisualizer.group.position.set(0, 0, 0);
    }
    if (gridGroup) gridGroup.position.set(0, 0, 0);
    if (axesGroup) axesGroup.position.set(0, 0, 0);
    if (axisLabelsGroup) axisLabelsGroup.position.set(0, 0, 0);
    if (homeIndicatorGroup) {
      const basePosition = computeMachineOriginPosition();
      homeIndicatorGroup.position.copy(basePosition);
    }

    // Respect Auto-Fit setting when exiting spindle view mode
    // Important: recompute bounds after resetting transforms so we don't use
    // stale, offset bounds captured while in spindle view.
    if (autoFitMode.value) {
      if (gcodeVisualizer && gcodeVisualizer.group) {
        const box = new THREE.Box3().setFromObject(gcodeVisualizer.group);
        const freshBounds = {
          min: box.min,
          max: box.max,
          center: box.getCenter(new THREE.Vector3()),
          size: box.getSize(new THREE.Vector3())
        };
        currentGCodeBounds = freshBounds;
        fitCameraToBounds(freshBounds);
      } else {
        fitCameraToBounds(getGridBounds());
      }
    } else {
      fitCameraToBounds(getGridBounds());
    }
  }
});

const toggleIOSwitch = async (switchKey: string) => {
  const currentState = ioSwitchStates[switchKey];
  const newState = !currentState;
  ioSwitchStates[switchKey] = newState;

  try {
    const switchConfig = enabledIOSwitches.value[switchKey];
    const command = newState ? switchConfig.on : switchConfig.off;

    if (command) {
      await api.sendCommandViaWebSocket({
        command,
        displayCommand: command
      });
    }
  } catch (error) {
    console.error(`Failed to toggle ${switchKey}:`, error);
    ioSwitchStates[switchKey] = currentState; // Revert on error
  }
};

// Parse tools from G-code content by scanning for lines that include M6 and Tn
function extractToolsFromGCode(content: string): number[] {
  if (typeof content !== 'string' || !content) return [];

  const lines = content.split('\n');
  const seen = new Set<number>();
  const order: number[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\((?:[^)]*)\)/g, '').replace(/;.*$/, '').trim(); // strip comments
    if (!line) continue;

    if (/\bM0?6\b/i.test(line)) {
      // Try to find Tn on same line
      const m = line.match(/\bT(\d+)\b/i);
      if (m) {
        const t = parseInt(m[1], 10);
        if (Number.isFinite(t) && !seen.has(t)) {
          seen.add(t);
          order.push(t);
        }
      }
    }
  }

  return order;
}

// Tool press functionality - long press to change tool
const LONG_PRESS_MS_TOOL = 1500;
const DELAY_BEFORE_VISUAL_MS = 150;

const startToolPress = (toolNumber: number | string, _evt?: Event) => {
  if (_evt) _evt.preventDefault();
  if (isToolChanging.value) return;

  if (!toolPress.value[toolNumber]) {
    toolPress.value[toolNumber] = { start: 0, progress: 0, raf: undefined, active: false, triggered: false, blinking: false };
  }

  const state = toolPress.value[toolNumber];
  if (state.raf) cancelAnimationFrame(state.raf);

  state.start = performance.now();
  state.progress = 0;
  state.active = true;
  state.triggered = false;

  const tick = () => {
    if (!state.active) return;
    const elapsed = performance.now() - state.start;

    // Delay the visual indicator
    if (elapsed < DELAY_BEFORE_VISUAL_MS) {
      state.progress = 0;
    } else {
      const adjustedElapsed = elapsed - DELAY_BEFORE_VISUAL_MS;
      const pct = Math.min(100, (adjustedElapsed / (LONG_PRESS_MS_TOOL - DELAY_BEFORE_VISUAL_MS)) * 100);
      state.progress = pct;
    }

    if (elapsed >= LONG_PRESS_MS_TOOL && !state.triggered) {
      state.triggered = true;

      // Handle TLS specially - send $TLS command directly
      if (toolNumber === 'tls') {
        sendTLSCommand();
        state.progress = 0;
        state.active = false;
        return;
      }

      // Determine tool number to send
      let toolToLoad: number;
      if (toolNumber === 'manual') {
        // Manual tool - use a number greater than numberOfToolsToShow
        toolToLoad = props.currentTool > numberOfToolsToShow.value ? 0 : numberOfToolsToShow.value + 1;
      } else if (toolNumber === 'probe') {
        // Probe tool - T99 is reserved for probe
        toolToLoad = props.currentTool === 99 ? 0 : 99;
      } else {
        // Regular numbered tool - if this is the current tool, send T0 to unload, otherwise send the tool number
        toolToLoad = props.currentTool === toolNumber ? 0 : toolNumber as number;
      }

      sendToolChangeMacro(toolToLoad);
      state.progress = 0;
      state.active = false;
      return;
    }

    state.raf = requestAnimationFrame(tick);
  };

  state.raf = requestAnimationFrame(tick);
};

const endToolPress = (toolNumber: number | string) => {
  const state = toolPress.value[toolNumber];
  if (!state) return;

  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;

  // If not triggered (incomplete press), check if we should toggle expansion
  if (!state.triggered && state.active) {
    state.active = false;
    state.progress = 0;

    // If this is a numbered tool with inventory data, toggle expansion instead of blink
    if (typeof toolNumber === 'number' && toolInventory.value?.[toolNumber]) {
      toggleToolInfo(toolNumber);
    } else {
      // No inventory data - close any expanded tool and show blink feedback
      showToolInfo.value = null;
      state.blinking = true;
      setTimeout(() => {
        state.blinking = false;
      }, 400);
    }
  } else {
    state.active = false;
    state.progress = 0;
  }

  // Reset triggered after delay
  setTimeout(() => {
    state.triggered = false;
  }, 100);
};

const sendToolChangeMacro = async (toolNumber: number) => {
  try {
    await api.triggerToolChange(toolNumber);
  } catch (error) {
    console.error('[GCodeVisualizer] Failed to request tool change macro', error);
  }
};

const sendTLSCommand = async () => {
  try {
    await api.triggerTLS();
  } catch (error) {
    console.error('[GCodeVisualizer] Failed to execute TLS', error);
  }
};

const cancelToolPress = (toolNumber: number | string) => {
  const state = toolPress.value[toolNumber];
  if (!state) return;

  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;
  state.active = false;
  state.progress = 0;
  state.triggered = false;
};

// Ref for scrollable tools container
const toolsScrollContainer = ref<HTMLElement | null>(null);

// Long-press state for scroll buttons
let scrollAnimationFrame: number | null = null;
let scrollDirection: 'up' | 'down' | null = null;
let scrollTimeout: number | null = null;
let idleScrollTimeout: number | null = null; // Timeout to return to current tool after idle
let isMouseOverTools = false; // Track if mouse is over the tools container

// Drag scroll state for tools container
let isToolsDragging = false;
let toolsDragStartY = 0;
let toolsDragStartScrollTop = 0;

// Smooth continuous scroll using requestAnimationFrame
const smoothScroll = () => {
  if (!toolsScrollContainer.value || !scrollDirection) return;

  const scrollSpeed = 2; // Pixels per frame for smooth scrolling
  const delta = scrollDirection === 'up' ? -scrollSpeed : scrollSpeed;

  toolsScrollContainer.value.scrollTop += delta;

  // Continue scrolling
  scrollAnimationFrame = requestAnimationFrame(smoothScroll);
};

// Snap scroll position to nearest button alignment
const snapToNearestButton = () => {
  if (!toolsScrollContainer.value) return;

  const buttonHeight = 44;
  const gap = 10;
  const itemHeight = buttonHeight + gap;
  const currentScroll = toolsScrollContainer.value.scrollTop;

  // Find nearest snap point (multiple of itemHeight)
  const nearestIndex = Math.round(currentScroll / itemHeight);
  const snapPosition = nearestIndex * itemHeight;

  toolsScrollContainer.value.scrollTo({
    top: snapPosition,
    behavior: 'smooth'
  });
};

// Start continuous scroll on long press
const startScrollPress = (direction: 'up' | 'down') => {
  scrollDirection = direction;
  if (scrollAnimationFrame === null) {
    scrollAnimationFrame = requestAnimationFrame(smoothScroll);
  }
};

// Stop continuous scroll and snap to nearest button
const stopScrollPress = () => {
  if (scrollAnimationFrame !== null) {
    cancelAnimationFrame(scrollAnimationFrame);
    scrollAnimationFrame = null;
  }
  scrollDirection = null;

  // Snap to nearest button position (if enabled)
  if (ENABLE_TOOL_BUTTON_SNAP) {
    snapToNearestButton();
  }
};

// Handle mouse wheel scroll - snap to nearest button after scrolling stops
const handleToolsScroll = () => {
  // Clear previous snap timeout
  if (scrollTimeout !== null) {
    clearTimeout(scrollTimeout);
  }

  // Set new timeout - snap to position after 150ms of no scrolling (if enabled)
  if (ENABLE_TOOL_BUTTON_SNAP) {
    scrollTimeout = window.setTimeout(() => {
      snapToNearestButton();
      scrollTimeout = null;
    }, 150);
  }
};

// Prevent wheel events from reaching the G-code visualizer
const handleToolsWheel = (event: WheelEvent) => {
  event.stopPropagation(); // Prevent event from bubbling to visualizer
};

// Handle mouse entering tools container
const handleToolsMouseEnter = () => {
  isMouseOverTools = true;

  // Clear idle timeout when mouse enters
  if (idleScrollTimeout !== null) {
    clearTimeout(idleScrollTimeout);
    idleScrollTimeout = null;
  }
};

// Handle mouse leaving tools container
const handleToolsMouseLeave = () => {
  isMouseOverTools = false;

  // End drag if in progress
  if (isToolsDragging) {
    handleDragEnd();
  }

  // Start 5-second idle timeout to return to current tool
  if (idleScrollTimeout !== null) {
    clearTimeout(idleScrollTimeout);
  }

  idleScrollTimeout = window.setTimeout(() => {
    scrollToCurrentTool();
    idleScrollTimeout = null;
  }, 5000);
};

// Handle drag start (mouse or touch)
const handleDragStart = (event: MouseEvent | TouchEvent) => {
  if (!toolsScrollContainer.value) return;

  // Clear any pending snap timeout
  if (scrollTimeout !== null) {
    clearTimeout(scrollTimeout);
    scrollTimeout = null;
  }

  isToolsDragging = true;

  // Get Y position from mouse or touch event
  if (event instanceof MouseEvent) {
    toolsDragStartY = event.clientY;
    event.preventDefault(); // Prevent text selection
  } else {
    toolsDragStartY = event.touches[0].clientY;
  }

  toolsDragStartScrollTop = toolsScrollContainer.value.scrollTop;

  // Add cursor style
  toolsScrollContainer.value.style.cursor = 'grabbing';
};

// Handle drag move (mouse or touch)
const handleDragMove = (event: MouseEvent | TouchEvent) => {
  if (!isToolsDragging || !toolsScrollContainer.value) return;

  // Get current Y position
  let currentY: number;
  if (event instanceof MouseEvent) {
    currentY = event.clientY;
  } else {
    currentY = event.touches[0].clientY;
    event.preventDefault(); // Prevent page scroll on touch devices
  }

  // Calculate delta and update scroll position
  const deltaY = toolsDragStartY - currentY;
  toolsScrollContainer.value.scrollTop = toolsDragStartScrollTop + deltaY;
};

// Handle drag end (mouse up, touch end, or mouse leave)
const handleDragEnd = () => {
  if (!isToolsDragging || !toolsScrollContainer.value) return;

  isToolsDragging = false;

  // Restore cursor
  toolsScrollContainer.value.style.cursor = 'grab';

  // Snap to nearest button (if enabled)
  if (ENABLE_TOOL_BUTTON_SNAP) {
    snapToNearestButton();
  }
};

// Scroll to show the current active tool
const scrollToCurrentTool = () => {
  if (!toolsScrollContainer.value || !props.currentTool) return;

  const toolNumber = props.currentTool;
  const buttonHeight = 44;
  const gap = 10;
  const itemHeight = buttonHeight + gap;

  // Calculate scroll position to center the current tool (or show it in view)
  // Scroll to position where current tool is at index 3 (middle of 8 visible tools)
  const targetIndex = toolNumber - 1; // Zero-based index
  const scrollPosition = Math.max(0, (targetIndex - 3) * itemHeight);

  toolsScrollContainer.value.scrollTo({
    top: scrollPosition,
    behavior: 'smooth'
  });
};

// Watch for current tool changes and scroll to it
watch(() => props.currentTool, () => {
  scrollToCurrentTool();
}, { flush: 'post' }); // Run after DOM updates

// Setup scroll and mouse event listeners when container is mounted
watch(toolsScrollContainer, (container, oldContainer, onCleanup) => {
  if (container) {
    container.addEventListener('scroll', handleToolsScroll);
    container.addEventListener('wheel', handleToolsWheel, { passive: false });
    container.addEventListener('mouseenter', handleToolsMouseEnter);
    container.addEventListener('mouseleave', handleToolsMouseLeave);

    // Drag scrolling - mouse events
    container.addEventListener('mousedown', handleDragStart);
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);

    // Drag scrolling - touch events
    container.addEventListener('touchstart', handleDragStart, { passive: false });
    container.addEventListener('touchmove', handleDragMove, { passive: false });
    document.addEventListener('touchend', handleDragEnd);

    // Set cursor to indicate draggable
    container.style.cursor = 'grab';

    // Scroll to current tool on initial mount
    setTimeout(() => scrollToCurrentTool(), 100);

    // Cleanup function to remove event listeners
    onCleanup(() => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchend', handleDragEnd);
    });
  }
});

// Load tool inventory from core tools API
const loadToolInventory = async () => {
  try {
    const response = await fetch(`${api.baseUrl}/api/tools`);
    if (response.ok) {
      const tools = await response.json();
      // Convert tools array to lookup map by toolNumber for quick access
      if (Array.isArray(tools)) {
        const inventory: Record<number, any> = {};
        tools.forEach((tool: any) => {
          if (tool.toolNumber !== null && tool.toolNumber !== undefined) {
            inventory[tool.toolNumber] = tool;
          }
        });
        toolInventory.value = inventory;
      }
    }
  } catch (err) {
    // Error loading tools - gracefully degrade to basic tooltips
    toolInventory.value = null;
  }
};

// Get enhanced tooltip for tool (includes inventory data if available)
const getToolTooltip = (toolNumber: number): string => {
  const baseText = props.currentTool === toolNumber
    ? `Tool T${toolNumber} (Current - Hold to unload)`
    : `Tool T${toolNumber} (Hold to change)`;

  const toolInfo = toolInventory.value?.[toolNumber];
  if (!toolInfo) return baseText;

  const details: string[] = [];
  if (toolInfo.name) details.push(toolInfo.name);
  if (toolInfo.diameter) details.push(`Ø${toolInfo.diameter.toFixed(3)}mm`);
  if (toolInfo.type) {
    const typeMap: Record<string, string> = {
      'flat': 'Flat End Mill',
      'ball': 'Ball End Mill',
      'v-bit': 'V-Bit',
      'drill': 'Drill',
      'chamfer': 'Chamfer',
      'surfacing': 'Surfacing',
      'probe': 'Probe'
    };
    details.push(typeMap[toolInfo.type] || toolInfo.type);
  }

  return details.length > 0 ? `${baseText}\n${details.join(' • ')}` : baseText;
};

// Toggle tool expansion (for click/tap interaction)
const toggleToolInfo = (toolNumber: number) => {
  if (showToolInfo.value === toolNumber) {
    showToolInfo.value = null;
  } else {
    showToolInfo.value = toolNumber;
  }
};

onMounted(async () => {
  // Load settings from store (already loaded in main.ts)
  const settings = getSettings();
  if (settings) {
    if (typeof settings.tool?.count === 'number') {
      numberOfToolsToShow.value = settings.tool.count;
    }
    if (typeof settings.tool?.manual === 'boolean') {
      showManualTool.value = settings.tool.manual;
    }
    if (typeof settings.tool?.tls === 'boolean') {
      showTlsTool.value = settings.tool.tls;
    }
    if (typeof settings.tool?.probe === 'boolean') {
      showProbeTool.value = settings.tool.probe;
    }
    if (typeof settings.autoFit === 'boolean') {
      autoFitMode.value = settings.autoFit;
    }
    if (typeof settings.spindleView === 'boolean') {
      spindleViewMode.value = settings.spindleView;
    }
    // Load I/O Switches configuration with defaults (support new auxOutputs or legacy ioSwitches)
    if (settings.auxOutputs && Array.isArray(settings.auxOutputs)) {
      ioSwitchesConfig.value = settings.auxOutputs;
    } else if (settings.ioSwitches) {
      ioSwitchesConfig.value = settings.ioSwitches;
    } else {
      ioSwitchesConfig.value = [
        { id: 'flood', enabled: true, name: 'Flood', on: 'M8' },
        { id: 'mist', enabled: true, name: 'Mist', on: 'M7' }
      ];
    }
  }

  // Initialize I/O switch states from machine status
  const initSwitchStates = () => {
    const config = ioSwitchesConfig.value;
    const activePins = appStore.status.outputPinsState || [];
    if (Array.isArray(config)) {
      for (const output of config) {
        if (!output.enabled) continue;
        const key = output.id;
        const onCmd = output.on;
        if (onCmd === 'M8') {
          ioSwitchStates[key] = appStore.status.floodCoolant ?? false;
        } else if (onCmd === 'M7') {
          ioSwitchStates[key] = appStore.status.mistCoolant ?? false;
        } else {
          // Check M64 Pn commands against outputPinsState
          const pinNumber = getM64PinNumber(onCmd);
          if (pinNumber !== null) {
            ioSwitchStates[key] = activePins.includes(pinNumber);
          } else {
            ioSwitchStates[key] = false;
          }
        }
      }
    } else {
      for (const [switchKey, switchConfig] of Object.entries(config)) {
        if (!(switchConfig as any).enabled) continue;
        const onCmd = (switchConfig as any).on;
        if (onCmd === 'M8') {
          ioSwitchStates[switchKey] = appStore.status.floodCoolant ?? false;
        } else if (onCmd === 'M7') {
          ioSwitchStates[switchKey] = appStore.status.mistCoolant ?? false;
        } else {
          const pinNumber = getM64PinNumber(onCmd);
          if (pinNumber !== null) {
            ioSwitchStates[switchKey] = activePins.includes(pinNumber);
          }
        }
      }
    }
  };
  initSwitchStates();

  // Wait for next tick to ensure all watchers have fired with isInitialLoad=true
  await nextTick();

  // Mark initial load complete so watchers can save changes
  isInitialLoad = false;

  // Load tool inventory from plugin (if available)
  await loadToolInventory();

  initThreeJS();
  window.addEventListener('resize', handleResize);

  // Listen for settings changes (partial/delta updates)
  window.addEventListener('settings-changed', (event: any) => {
    const changedSettings = event.detail;

    // Apply only the changed settings
    if (changedSettings.tool?.count !== undefined) {
      numberOfToolsToShow.value = changedSettings.tool.count;
    }
    if (changedSettings.tool?.manual !== undefined) {
      showManualTool.value = changedSettings.tool.manual;
    }
    if (changedSettings.tool?.tls !== undefined) {
      showTlsTool.value = changedSettings.tool.tls;
    }
    if (changedSettings.tool?.probe !== undefined) {
      showProbeTool.value = changedSettings.tool.probe;
    }
    // Update I/O Switches config when settings change (support new auxOutputs or legacy ioSwitches)
    if (changedSettings.auxOutputs !== undefined) {
      ioSwitchesConfig.value = changedSettings.auxOutputs;
    } else if (changedSettings.ioSwitches !== undefined) {
      ioSwitchesConfig.value = changedSettings.ioSwitches;
    }
    // Future settings can be added here
    // if ('someOtherSetting' in changedSettings) { ... }
  });

  // Watch for settings store changes (for reactive updates from Settings dialog)
  // Support new auxOutputs array or legacy ioSwitches object
  watch(() => settingsStore.data?.auxOutputs, (newAuxOutputs) => {
    if (newAuxOutputs) {
      ioSwitchesConfig.value = newAuxOutputs;
    }
  }, { deep: true });
  watch(() => settingsStore.data?.ioSwitches, (newIOSwitches) => {
    // Only use legacy format if auxOutputs is not present
    if (newIOSwitches && !settingsStore.data?.auxOutputs) {
      ioSwitchesConfig.value = newIOSwitches;
    }
  }, { deep: true });

  // Watch for flood coolant status changes and sync with flood switch
  watch(() => appStore.status.floodCoolant, (newValue) => {
    if ('flood' in ioSwitchStates) {
      const config = ioSwitchesConfig.value;
      const isEnabled = Array.isArray(config)
        ? config.some(o => o.id === 'flood' && o.enabled)
        : config.flood?.enabled;
      if (isEnabled) {
        ioSwitchStates.flood = newValue ?? false;
      }
    }
  });

  // Watch for mist coolant status changes and sync with mist switch
  watch(() => appStore.status.mistCoolant, (newValue) => {
    if ('mist' in ioSwitchStates) {
      const config = ioSwitchesConfig.value;
      const isEnabled = Array.isArray(config)
        ? config.some(o => o.id === 'mist' && o.enabled)
        : config.mist?.enabled;
      if (isEnabled) {
        ioSwitchStates.mist = newValue ?? false;
      }
    }
  });

  // Watch for output pins state changes and sync with M64 Pn switches
  watch(() => appStore.status.outputPinsState, (activePins) => {
    const config = ioSwitchesConfig.value;
    const pins = activePins || [];
    if (Array.isArray(config)) {
      for (const output of config) {
        if (!output.enabled) continue;
        const pinNumber = getM64PinNumber(output.on);
        if (pinNumber !== null) {
          ioSwitchStates[output.id] = pins.includes(pinNumber);
        }
      }
    } else {
      for (const [switchKey, switchConfig] of Object.entries(config)) {
        if (!(switchConfig as any).enabled) continue;
        const pinNumber = getM64PinNumber((switchConfig as any).on);
        if (pinNumber !== null) {
          ioSwitchStates[switchKey] = pins.includes(pinNumber);
        }
      }
    }
  }, { deep: true });

  // Listen for tools updates via WebSocket
  api.on('tools-updated', () => {
    // Re-fetch tool inventory data when tools are updated
    loadToolInventory();
  });

  // Watch for container size changes
  if (canvas.value) {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        handleResize();
      }
    });
    resizeObserver.observe(canvas.value);
  }

  // Set up WebSocket listeners for G-code events
  api.onGCodeUpdated(handleGCodeUpdate);
  api.on('gcode-content-ready', handleGCodeUpdate);

  // Listen for download progress
  api.on('gcode-download-progress', (progress: { percent: number }) => {
    if (isLoading.value && loadingMessage.value === 'Downloading G-code...') {
      loadingProgress.value = Math.min(Math.round(progress.percent * 0.5), 50); // 0-50%
    }
  });

  // Check if there's already G-code loaded (for page reloads)
  // The WebSocket sends gcode-updated on connection, but there's a race condition
  // where the visualizer might mount before the event arrives. Load from IDB if available.
  // Only load from cache if the server has a job loaded - otherwise clear the visualizer
  try {
    if (props.jobLoaded?.filename) {
      const { getGCodeFromIDB } = await import('../../lib/gcode-store.js');
      const gcodeData = await getGCodeFromIDB();
      if (gcodeData?.content) {
        await handleGCodeUpdate({
          filename: gcodeData.filename,
          content: gcodeData.content,
          timestamp: new Date().toISOString()
        });
      }
    }
  } catch {
    // No existing G-code to load on mount (this is normal for first load)
  }

  // Listen for server state updates to track job progress
  let prevJobStatus: 'running' | 'paused' | 'stopped' | 'completed' | undefined = undefined;
  let hasRestoredInitialState = false;
  api.onServerStateUpdated((state: any) => {
    const status = state.jobLoaded?.status as 'running' | 'paused' | 'stopped' | 'completed' | undefined;

    // Restore lastExecutedLine from server state on initial load (for page reloads)
    // This handles the case when user refreshes page while job is running/paused/stopped/completed
    let didRestoreThisUpdate = false;
    if (!hasRestoredInitialState && state.jobLoaded && gcodeVisualizer) {
      const currentLine = state.jobLoaded.currentLine;
      // Include 'running' status - user may have refreshed page while job was running
      if (status && typeof currentLine === 'number' && currentLine > 0) {
        lastExecutedLine.value = currentLine;
        // Re-apply completed segments up to the restored line
        for (let i = 1; i <= currentLine; i++) {
          if (!markedLines.has(i)) {
            gcodeVisualizer.markLineCompleted(i);
            markedLines.add(i);
          }
        }
        didRestoreThisUpdate = true;
      }
      hasRestoredInitialState = true;
    }

    // If a run is starting (not a page reload restore), reset completed markers so we start fresh
    // Skip reset if we just restored initial state - that means it's a page reload, not a new run
    if (status === 'running' && prevJobStatus !== 'running' && !didRestoreThisUpdate) {
      lastExecutedLine.value = 0;
      if (gcodeVisualizer) {
        gcodeVisualizer.resetCompletedLines();
      }
      markedLines.clear();
    }

    // Reset visualizer segments when file is unloaded
    if (!state.jobLoaded) {
      lastExecutedLine.value = 0;
      if (gcodeVisualizer) {
        gcodeVisualizer.resetCompletedLines();
      }
      markedLines.clear();
    }

    // If the user closed the job progress panel (status changed to null), also reset completed segments
    const statusValue = state.jobLoaded?.status;
    if (statusValue === null) {
      lastExecutedLine.value = 0;
      if (gcodeVisualizer) {
        gcodeVisualizer.resetCompletedLines();
      }
      markedLines.clear();
    }

    prevJobStatus = status;
  });

  // Watch for jobLoaded changes to handle clearing
  watch(() => props.jobLoaded?.filename, (newValue, oldValue) => {
    if (oldValue && !newValue) {
      // Program was cleared
      handleGCodeClear();
    }
  });

  // Initialize camera to the provided view (honors defaultGcodeView)
  setTimeout(() => {
    setCameraView(props.view);
    // No need to emit here; parent already owns the state

    // Ensure initial framing even when Auto-Fit is OFF and no G-code is loaded
    if (autoFitMode.value && currentGCodeBounds) {
      fitCameraToBounds(currentGCodeBounds, props.view);
    } else {
      fitCameraToBounds(getGridBounds(), props.view);
    }

  }, 100);
});

onUnmounted(() => {
  if (animationId) {
    cancelAnimationFrame(animationId);
  }

  if (pendingResizeFrame != null) {
    cancelAnimationFrame(pendingResizeFrame);
    pendingResizeFrame = null;
  }

  if (renderer) {
    renderer.dispose();
  }

  if (resizeObserver) {
    resizeObserver.disconnect();
  }

  window.removeEventListener('resize', handleResize);

  if (scene && homeIndicatorGroup) {
    scene.remove(homeIndicatorGroup);
    disposeHomeIndicator();
  }
});

// Track which line numbers have been marked as completed
const markedLines = new Set<number>();

watch(
  () => props.jobLoaded?.currentLine ?? 0,
  (newVal, oldVal) => {
    const nextRaw = typeof newVal === 'number' ? newVal : 0;
    const prevRaw = typeof oldVal === 'number' ? oldVal : 0;
    const next = Number.isFinite(nextRaw) ? Math.max(0, Math.floor(nextRaw)) : 0;
    const prev = Number.isFinite(prevRaw) ? Math.max(0, Math.floor(prevRaw)) : 0;

    if (lastExecutedLine.value !== next) {
      lastExecutedLine.value = next;
    }

    const visualizerReady = !!(gcodeVisualizer && gcodeVisualizer.lineNumberMap && gcodeVisualizer.lineNumberMap.size > 0);
    if (!visualizerReady) {
      if (next === 0) {
        markedLines.clear();
      }
      return;
    }

    if (next <= 0) {
      if (prev > 0) {
        gcodeVisualizer.resetCompletedLines();
      }
      markedLines.clear();
      return;
    }

    if (next < prev) {
      gcodeVisualizer.resetCompletedLines();
      markedLines.clear();
      for (let i = 1; i <= next; i++) {
        if (!markedLines.has(i)) {
          gcodeVisualizer.markLineCompleted(i);
          markedLines.add(i);
        }
      }
      return;
    }

    if (next > prev) {
      const start = Math.max(prev + 1, 1);
      for (let i = start; i <= next; i++) {
        if (!markedLines.has(i)) {
          gcodeVisualizer.markLineCompleted(i);
          markedLines.add(i);
        }
      }
    }
  },
  { immediate: true }
);

// Watch for selected lines changes from G-Code Preview
watch(() => [...appStore.selectedGCodeLines.value], (newLines) => {
  if (gcodeVisualizer) {
    gcodeVisualizer.highlightSelectedLines(newLines);
  }
}, { deep: true });

// Watch for Start From Line requests from G-Code Preview (double-click on line number)
watch(() => appStore.startFromLineRequest.value, (lineNumber) => {
  if (lineNumber !== null && lineNumber > 0) {
    openStartFromLineDialog(lineNumber);
    appStore.clearStartFromLineRequest();
  }
});

</script>

<style scoped>
/* Loading Overlay */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.loading-content {
  background: var(--color-surface);
  border-radius: 12px;
  padding: 24px 32px;
  min-width: 400px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.loading-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.loading-message {
  font-size: 14px;
  color: var(--color-text-secondary);
  font-weight: 500;
}

.loading-percent {
  font-size: 32px;
  font-weight: bold;
  color: var(--color-primary);
  min-width: 80px;
  text-align: right;
}

.loading-bar-container {
  height: 24px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.loading-bar {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%);
  transition: width 0.3s ease;
  border-radius: 12px;
  box-shadow: 0 0 15px rgba(59, 130, 246, 0.7);
}

/* Disable control buttons when not homed */
.controls-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.viewport {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  box-shadow: var(--shadow-elevated);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0; /* Allows flex child to shrink below content size */
  width: 100%;
}

.floating-toolbar {
  position: absolute;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  background: transparent;
  border-radius: 8px;
  padding: 4px 8px;
  flex-wrap: wrap;
  gap: 8px;
  pointer-events: auto; /* Ensure buttons are clickable */
}

.floating-toolbar--top {
  top: 16px;
  left: 16px;
  right: 16px;
}

.floating-toolbar--right {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: auto;
}

.tools-legend {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-end;
}

.tools-legend--bottom {
  position: absolute;
  right: 16px;
  top: 48%;
  transform: translateY(-50%);
  pointer-events: none; /* display-only to avoid blocking controls */
}

.tools-scrollable {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-end;
  max-height: 422px; /* 8 buttons × 44px + 7 gaps × 10px = 352px + 70px */
  overflow-y: auto;
  overflow-x: visible;
  align-self: flex-end;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
  pointer-events: auto; /* Catch pointer events in gap areas */
  cursor: pointer; /* Show pointer cursor */
}

/* Hide scrollbar for Chrome, Safari and Opera */
.tools-scrollable::-webkit-scrollbar {
  display: none;
}

.tools-scroll-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 122px;
  height: 32px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  pointer-events: auto;
  transition: background 0.15s ease, transform 0.1s ease;
  flex-shrink: 0;
}

.tools-scroll-btn:hover {
  background: var(--color-surface);
}

.tools-scroll-btn:active {
  transform: scale(0.95);
}

.tools-scroll-btn svg {
  opacity: 0.7;
}

.tools-legend__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--color-surface-muted);
  padding: 10px 20px;
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  transition: background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease, min-width 0.3s ease, max-width 0.3s ease;
  box-shadow: inset 0 0 0 1px var(--color-border);
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  pointer-events: auto;
  width: 122px;
  min-width: 122px;
  max-width: 122px;
  min-height: 44px;
  flex-shrink: 0;
  white-space: nowrap;
}

.tools-legend__item.active {
  opacity: 1;
  background: var(--color-accent);
  color: #fff;
  transform: none;
  cursor: default;
}

.tools-legend__item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

.tools-legend__item .long-press-indicator {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: var(--color-accent);
  opacity: 0.22;
  pointer-events: none;
  transition: width 0.05s linear;
}

.tools-legend__item:active .long-press-indicator {
  background: rgba(255, 255, 255, 0.35);
  opacity: 1;
}

.tools-legend__item.long-press-triggered:not(.active) {
  background: var(--color-surface-muted) !important;
  color: var(--color-text-primary) !important;
  transform: none !important;
  /* Keep the tool segment color border - don't override it */
}

@keyframes blink-border-tool {
  0%, 100% { box-shadow: inset 0 0 0 2px #ff6b6b; }
  50% { box-shadow: inset 0 0 0 1px var(--color-border); }
}

.tools-legend__item.blink-border {
  animation: blink-border-tool 0.4s ease-in-out;
}

@keyframes glow-pulse {
  0%, 100% {
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.6), inset 0 0 0 2px rgba(239, 68, 68, 0.4);
  }
  50% {
    box-shadow: 0 0 16px rgba(239, 68, 68, 0.8), inset 0 0 0 2px rgba(239, 68, 68, 0.6);
  }
}

.tools-legend__item.glow {
  animation: glow-pulse 2s ease-in-out infinite;
  background: rgba(239, 68, 68, 0.1);
}

.tools-legend__label {
  min-width: 32px;
  text-align: right;
  font-size: 1.2rem;
  font-weight: 500;
}

.tools-legend__item.manual-tool,
.tools-legend__item.tls-tool,
.tools-legend__item.probe-tool {
  width: auto;
  min-width: 122px;
  justify-content: center;
}

.tools-legend__item.manual-tool .tools-legend__label,
.tools-legend__item.tls-tool .tools-legend__label,
.tools-legend__item.probe-tool .tools-legend__label {
  text-align: center;
  flex: none;
}

.tools-legend__item.manual-tool .tools-legend__label {
  font-size: 1rem;
}

.tools-legend__icon {
  display: block;
  width: 40px;
  height: 16px;
}

.tools-legend__icon .bit-body {
  fill: currentColor;
  opacity: 0.3;
}

.tools-legend__icon .bit-shank {
  fill: currentColor;
  opacity: 0.6;
}

.tools-legend__item.active .bit-body {
  opacity: 0.5;
}

.tools-legend__item.active .bit-shank {
  opacity: 0.8;
}

.manual-tool-indicator {
  display: flex;
  gap: 3px;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 16px;
}

.manual-tool-indicator .bar {
  width: 3px;
  height: 12px;
  background: currentColor;
  opacity: 0.4;
  border-radius: 1px;
}

.tools-legend__item.active .manual-tool-indicator .bar {
  opacity: 0.7;
}

.tls-tool-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 16px;
}

.tls-tool-indicator svg {
  width: 20px;
  height: 20px;
  opacity: 0.4;
}

.tools-legend__item.active .tls-tool-indicator svg {
  opacity: 0.7;
}

.floating-toolbar.floating-toolbar--bottom {
  bottom: 16px;
  left: 16px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
}

.file-controls {
  display: flex;
  gap: var(--gap-xs);
}

.load-button, .clear-button, .toggle-button {
  border: none;
  border-radius: var(--radius-small);
  padding: 8px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 500;
  background: var(--color-accent);
  color: white;
  width: 70px;
}

.load-button:disabled, .clear-button:disabled, .toggle-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  filter: grayscale(50%);
}

.clear-button {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

.upload-button {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

.folder-button {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

.toggle-button {
  background: #6c757d;
}

.load-button:hover:not(:disabled), .clear-button:hover:not(:disabled), .toggle-button:hover:not(:disabled) {
  opacity: 0.8;
}

h2 {
  margin: 0;
}

.view-buttons {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
}

.preset-buttons {
  display: flex;
  gap: var(--gap-xs);
}

.toggle-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.legend-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 220px;
  margin-top: -8px;
}

.view-button {
  border: none;
  border-radius: var(--radius-small);
  padding: 10px 16px;
  cursor: pointer;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-size: 16px;
  font-weight: 500;
}

.view-button.active {
  background: var(--gradient-accent);
  color: #fff;
}

.spindle-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: transparent;
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  font-size: 16px;
  font-weight: 500;
}

.spindle-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
}

.switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: 0.3s;
  border-radius: 22px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.3);
}

.slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--color-accent);
}

input:checked + .slider:before {
  transform: translateX(18px);
}

/* Disabled state for switch */
.switch input:disabled + .slider {
  opacity: 0.5;
  cursor: not-allowed;
}

.viewport__canvas {
  flex: 1;
  position: relative;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: repeating-linear-gradient(
    45deg,
    rgba(26, 188, 156, 0.05),
    rgba(26, 188, 156, 0.05) 20px,
    transparent 20px,
    transparent 40px
  );
  overflow: hidden; /* Ensures canvas corners are clipped to container */
  isolation: isolate; /* Creates a new stacking context */
  min-height: 0; /* Allows flex child to shrink below content size */
  height: 100%;
  width: 100%;
}

.viewport__canvas canvas {
  border-radius: 8px;
  width: 100% !important;
  height: 100% !important;
}


.legend-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  background: transparent;
  padding: 8px 12px;
  border-radius: var(--radius-small);
  font-size: 16px;
  font-weight: 500;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  width: 100%;
}

.legend-label {
  flex: 1 1 auto;
  text-align: left;
  font-size: 16px;
}

.legend-item .dot {
  flex-shrink: 0;
}

.legend-item:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateY(-1px);
}

.legend-item--disabled {
  opacity: 0.5;
}

/* Coolant controls - lower left */
.coolant-controls {
  position: absolute;
  bottom: 16px;
  left: 16px;
  background: var(--color-surface-muted);
  padding: 8px 12px;
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Tool indicator - lower right */
.tool-indicator {
  position: absolute;
  bottom: 16px;
  right: 16px;
  background: rgba(26, 188, 156, 0.2); /* accent tint */
  padding: 8px 16px;
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  z-index: 10;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  box-shadow: inset 0 0 0 2px var(--color-accent);
}

.tool-label {
  font-size: 0.75rem;
  opacity: 0.7;
}

.tool-value {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-accent);
}

.legend-item--disabled:hover {
  background: rgba(255, 255, 255, 0.05);
}

.dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-block;
  transition: all 0.15s ease;
}

.dot--disabled {
  opacity: 0.3;
  filter: grayscale(100%);
}

.dot--rapid {
  background: #00ff66; /* match visualizer rapid (dark theme) */
}

.dot--cutting {
  background: #3e85c7;
}

.dot--spindle {
  background: #9ea3aa;
}

/* Light theme: use high-contrast rapid color */
body.theme-light .dot--rapid {
  background: #E67E22;
}

@media (max-width: 1279px) and (orientation: portrait) {
  .viewport {
    height: 45vh;
    min-height: 300px;
    max-height: 45vh;
  }
}

@media (max-width: 959px) {
  .viewport__legend {
    flex-wrap: wrap;
  }
}

@media (max-width: 959px) and (orientation: portrait) {
  .viewport {
    height: 40vh;
    min-height: 280px;
    max-height: 40vh;
  }
}

/* Alarm message warning */
.alarm-message-warning {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  backdrop-filter: blur(8px);
  border: 2px solid #b84444;
  color: #ff8888;
  padding: 10px 20px;
  border-radius: var(--radius-medium);
  font-size: 0.9rem;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 11;
  animation: warningPulse 2s ease-in-out infinite;
}

/* Out of bounds warning */
.out-of-bounds-warning {
  position: absolute;
  bottom: 180px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  backdrop-filter: blur(8px);
  border: 2px solid #b84444;
  color: #ff8888;
  padding: 10px 20px;
  border-radius: var(--radius-medium);
  font-size: 0.9rem;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 11;
  animation: warningPulse 2s ease-in-out infinite;
}

@keyframes warningPulse {
  0%, 50%, 100% {
    border-color: #dc3545;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 20px rgba(220, 53, 69, 0.6);
  }
  25%, 75% {
    border-color: #dc3545;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 30px rgba(220, 53, 69, 0.9);
  }
}

.warning-icon {
  flex-shrink: 0;
}

/* Progress bar container */
.progress-bar-container {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 92px; /* sit above the control buttons */
  width: min(520px, calc(100% - 48px));
  z-index: 9;
}

/* Control buttons */
.control-buttons {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  z-index: 10;
}

.control-btn {
  border: none;
  border-radius: var(--radius-medium);
  padding: 18px 22px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 110px;
  justify-content: center;
  white-space: nowrap;
}

.control-btn:hover {
  transform: translateY(-1px);
}

.control-btn:active {
  transform: translateY(0);
}

.control-btn--primary {
  background: var(--gradient-accent);
  color: white;
  box-shadow: 0 4px 12px -4px rgba(26, 188, 156, 0.5);
}

.control-btn--primary:hover {
  box-shadow: 0 6px 16px -6px rgba(26, 188, 156, 0.6);
}

.control-btn--secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.1);
}

.control-btn--secondary:hover {
  background: var(--color-surface);
  box-shadow: 0 4px 12px -4px rgba(0, 0, 0, 0.15);
}

.control-btn--danger {
  background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.8));
  color: white;
  box-shadow: 0 4px 12px -4px rgba(255, 107, 107, 0.5);
}

.control-btn--danger:hover {
  box-shadow: 0 6px 16px -6px rgba(255, 107, 107, 0.6);
}

.control-btn--start-from-line {
  background: linear-gradient(135deg, #8b5cf6, rgba(139, 92, 246, 0.8));
  color: white;
  box-shadow: 0 4px 12px -4px rgba(139, 92, 246, 0.5);
}

.control-btn--start-from-line:hover {
  box-shadow: 0 6px 16px -6px rgba(139, 92, 246, 0.6);
}

.control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
}

.btn-icon {
  width: 16px;
  height: 16px;
  display: inline-block;
  vertical-align: middle;
  fill: currentColor;
}

/* Probe button - bottom right */
.probe-button {
  position: absolute;
  bottom: 16px;
  right: 16px;
  background: var(--color-surface-muted);
  color: var(--color-accent);
  border: 2px solid var(--color-accent);
  border-radius: var(--radius-small);
  width: 80px;
  height: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 10;
}

.probe-button:hover {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.probe-button:active {
  transform: translateY(0);
}

.probe-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.probe-icon {
  width: 48px;
  height: 48px;
  /* Use mask to apply accent color dynamically */
  -webkit-mask: url(/assets/probe/3d-probe/probe.svg) no-repeat center;
  mask: url(/assets/probe/3d-probe/probe.svg) no-repeat center;
  -webkit-mask-size: contain;
  mask-size: contain;
  background-color: var(--color-accent);
}

.probe-label {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-accent);
}

.probe-button:hover .probe-icon {
  background-color: white;
}

.probe-button:hover .probe-label {
  color: white;
}

/* Confirmation Dialog */
.confirm-dialog {
  padding: var(--gap-lg);
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}

.confirm-dialog__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.confirm-dialog__message {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.confirm-dialog__actions {
  display: flex;
  gap: var(--gap-sm);
  justify-content: flex-end;
  margin-top: var(--gap-sm);
}

.confirm-dialog__btn {
  padding: 10px 24px;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.confirm-dialog__btn--cancel {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}

.confirm-dialog__btn--cancel:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.confirm-dialog__btn--danger {
  background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.8));
  color: white;
}

.confirm-dialog__btn--danger:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(255, 107, 107, 0.3);
}

/* Tool Expansion */
.tools-legend__item.expanded {
  min-width: 310px;
  max-width: 310px;
  justify-content: flex-end;
  overflow: visible;
}

.tool-name-expanded {
  font-size: 0.95rem;
  color: var(--color-text-primary);
  opacity: 0;
  animation: fadeInFromRight 0.3s ease forwards;
  animation-delay: 0.15s;
  margin-right: auto;
  margin-left: 0;
  padding-right: 8px;
  font-weight: 500;
  order: -1;
}

.tools-legend__item.active .tool-name-expanded {
  color: #fff;
}

@keyframes fadeInFromRight {
  from {
    opacity: 0;
    transform: translateX(10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
