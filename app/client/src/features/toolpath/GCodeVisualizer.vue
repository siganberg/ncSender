<template>
  <section class="viewport">
    <!-- Full canvas with floating toolbars -->
    <div ref="canvas" class="viewport__canvas">
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

      <!-- Legend - upper right -->
      <div class="floating-toolbar floating-toolbar--legend">
        <div class="legend-item" :class="{ 'legend-item--disabled': !showRapids }" @click="toggleRapids">
          <span>Rapid (G0)</span>
          <span class="dot dot--rapid" :class="{ 'dot--disabled': !showRapids }"></span>
        </div>
        <div class="legend-item" :class="{ 'legend-item--disabled': !showCutting }" @click="toggleCutting">
          <span>Cutting (G1/G2/G3)</span>
          <span class="dot dot--cutting" :class="{ 'dot--disabled': !showCutting }"></span>
        </div>
        <div class="legend-item" :class="{ 'legend-item--disabled': !showSpindle }" @click="toggleSpindle">
          <span>Spindle</span>
          <span class="dot dot--spindle" :class="{ 'dot--disabled': !showSpindle }"></span>
        </div>
      </div>

      <!-- Tools list - bottom right above current tool -->
      <div v-if="numberOfToolsToShow > 0" class="tools-legend tools-legend--bottom">
        <div
          v-for="t in numberOfToolsToShow"
          :key="t"
          class="tools-legend__item"
          :class="{
            'active': currentTool === t,
            'used': toolsUsed.includes(t),
            'disabled': isToolChanging,
            'long-press-triggered': toolPress[t]?.triggered,
            'blink-border': toolPress[t]?.blinking
          }"
          :title="currentTool === t ? `Tool T${t} (Current)` : `Tool T${t} (Hold to change)`"
          @mousedown="startToolPress(t, $event)"
          @mouseup="endToolPress(t)"
          @mouseleave="cancelToolPress(t)"
          @touchstart="startToolPress(t, $event)"
          @touchend="endToolPress(t)"
          @touchcancel="cancelToolPress(t)"
        >
          <div class="long-press-indicator long-press-horizontal" :style="{ width: `${toolPress[t]?.progress || 0}%` }"></div>
          <span class="tools-legend__label">T{{ t }}</span>
          <svg class="tools-legend__icon" width="36" height="14" viewBox="0 0 36 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="1" y="4" width="34" height="6" rx="2" class="bit-body"/>
            <rect x="4" y="5" width="10" height="4" rx="1" class="bit-shank"/>
          </svg>
        </div>
      </div>

      <!-- Coolant controls - lower left -->
      <div class="coolant-controls">
        <div class="spindle-toggle">
          <label class="switch">
            <input type="checkbox" :checked="floodEnabled" @change="toggleFlood">
            <span class="slider"></span>
          </label>
          <span>Flood</span>
        </div>
        <div class="spindle-toggle">
          <label class="switch">
            <input type="checkbox" :checked="mistEnabled" @change="toggleMist">
            <span class="slider"></span>
          </label>
          <span>Mist</span>
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

      <!-- Out of bounds warning -->
      <div class="out-of-bounds-warning" v-if="showOutOfBoundsWarning">
        <svg class="warning-icon" width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 20h20L12 2z" fill="#ff8888" opacity="0.9"/>
          <path d="M11 10h2v5h-2zm0 6h2v2h-2z" fill="#b84444"/>
        </svg>
        <span>{{ outOfBoundsMessage }}</span>
      </div>

      <!-- Progress bar above controls -->
      <div class="progress-bar-container">
        <ProgressBar />
      </div>

      <!-- Control buttons - bottom center -->
      <div class="control-buttons" :class="{ 'controls-disabled': !store.isConnected.value || !store.isHomed.value }">
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
      </div>

      <!-- Probe button - bottom right -->
      <button class="probe-button" @click="openProbeDialog" title="Probe">
        <span class="probe-label">Probe</span>
        <img src="/assets/probe.svg" alt="Probe" class="probe-icon" />
      </button>
    </div>
  </section>

  <!-- Probe Dialog -->
  <Dialog v-if="showProbeDialog" @close="showProbeDialog = false" size="medium-minus">
    <div class="probe-dialog">
      <div class="probe-dialog__header">
        <h2 class="probe-dialog__title">Probe</h2>
      </div>
      <div class="probe-dialog__content">
        <div class="probe-dialog__columns">
          <div class="probe-dialog__column probe-dialog__column--controls">
            <p class="probe-instructions">
              Position the probe needle as shown in the image. Push the probe needle gently to test that it triggers properly (green light should activate). Ensure the probe is positioned correctly for the selected probing axis.
            </p>

            <div class="probe-control-row">
              <div class="probe-control-group">
                <label class="probe-label">Probe Type</label>
                <select v-model="probeType" class="probe-select">
                  <option value="3d-touch">3D-Touch Probe</option>
                  <option value="standard-block">Standard Block</option>
                </select>
              </div>

              <div class="probe-control-group">
                <label class="probe-label">Probing Axis</label>
                <select v-model="probingAxis" class="probe-select">
                  <option value="Z">Z</option>
                  <option value="XYZ">XYZ</option>
                  <option value="XY">XY</option>
                  <option value="X">X</option>
                  <option value="Y">Y</option>
                  <option value="Center - Inner">Center - Inner</option>
                  <option value="Center - Outer">Center - Outer</option>
                </select>
              </div>
            </div>

            <template v-if="probeType === '3d-touch'">
              <div class="probe-control-row probe-control-row--three">
                <div class="probe-control-group">
                  <label class="probe-label">Diameter</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="ballPointDiameter"
                      type="number"
                      step="0.1"
                      min="0.1"
                      class="probe-input"
                      @input="validateBallPointDiameter"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                  <span v-if="errors.ballPointDiameter" class="probe-error">{{ errors.ballPointDiameter }}</span>
                </div>

                <div class="probe-control-group">
                  <label class="probe-label">Z-Plunge</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="zPlunge"
                      type="number"
                      step="0.1"
                      min="0.1"
                      class="probe-input"
                      @input="validateZPlunge"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                  <span v-if="errors.zPlunge" class="probe-error">{{ errors.zPlunge }}</span>
                </div>

                <div class="probe-control-group">
                  <label class="probe-label">Z-Offset</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="zOffset"
                      type="number"
                      step="0.01"
                      class="probe-input"
                      @input="validateZOffset"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                  <span v-if="errors.zOffset" class="probe-error">{{ errors.zOffset }}</span>
                </div>
              </div>
            </template>

            <!-- Center probing fields (Center - Inner and Center - Outer) -->
            <template v-if="['Center - Inner', 'Center - Outer'].includes(probingAxis)">
              <div class="probe-control-row probe-control-row--three">
                <div class="probe-control-group">
                  <label class="probe-label">X Dimension</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="xDimension"
                      type="number"
                      step="0.1"
                      min="0.1"
                      class="probe-input"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                </div>

                <div class="probe-control-group">
                  <label class="probe-label">Y Dimension</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="yDimension"
                      type="number"
                      step="0.1"
                      min="0.1"
                      class="probe-input"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                </div>

                <div class="probe-control-group">
                  <label class="probe-label">Rapid Movement</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="rapidMovement"
                      type="number"
                      step="100"
                      min="1000"
                      max="5000"
                      class="probe-input"
                    />
                    <span class="probe-unit">mm/min</span>
                  </div>
                </div>
              </div>

              <!-- Probe Z First toggle - only for Center - Outer -->
              <div v-if="probingAxis === 'Center - Outer'" class="probe-control-group probe-control-group--toggle probe-control-group--toggle-left">
                <label class="probe-label">Probe Z First</label>
                <label class="switch">
                  <input type="checkbox" v-model="probeZFirst">
                  <span class="slider"></span>
                </label>
              </div>
            </template>
          </div>
          <div class="probe-dialog__column probe-dialog__column--viewer">
            <ProbeVisualizer
              :probe-type="probeType"
              :probing-axis="probingAxis"
              :selected-corner="selectedCorner"
              :selected-side="selectedSide"
              :probe-active="probeActive"
              @corner-selected="selectedCorner = $event"
              @side-selected="selectedSide = $event"
            />
            <div v-if="['Center - Inner', 'Center - Outer'].includes(probingAxis)" class="probe-warning">
              <strong>Important:</strong> Measure dimension as close as possible to prevent probe damage.
            </div>
            <div v-if="['XYZ', 'XY'].includes(probingAxis)" class="probe-instruction">
              Click on a corner to select where to start probing
            </div>
            <div v-if="probingAxis === 'X'" class="probe-instruction">
              Click on the left or right side to select where to probe
            </div>
            <div v-if="probingAxis === 'Y'" class="probe-instruction">
              Click on the front or back side to select where to probe
            </div>
          </div>
        </div>
      </div>
      <div class="probe-dialog__footer">
        <button @click="closeProbeDialog" class="probe-dialog__btn probe-dialog__btn--secondary">Cancel</button>
        <button @click="startProbe" class="probe-dialog__btn probe-dialog__btn--primary" :disabled="!isProbeReady">Start Probe</button>
      </div>
    </div>
  </Dialog>

  <!-- Delete Confirmation Dialog -->
  <Dialog v-if="showDeleteConfirm" @close="cancelDelete" :show-header="false" size="small" :z-index="10000">
    <ConfirmPanel
      title="Delete File"
      :message="'Are you sure you want to delete ' + fileToDelete + '?'"
      cancel-text="Cancel"
      confirm-text="Delete"
      variant="danger"
      @cancel="cancelDelete"
      @confirm="confirmDelete"
    />
  </Dialog>

  <!-- File Manager Dialog -->
  <Dialog v-if="showFileManager" @close="showFileManager = false" size="medium">
    <div class="file-manager">
      <div class="file-manager__header">
        <svg width="32" height="32"><use href="#emoji-folder"></use></svg>
        <h2 class="file-manager__title">File Manager</h2>
      </div>
      <div class="file-manager__content">
        <div v-if="uploadedFiles.length === 0" class="file-manager__empty">
          <svg width="64" height="64"><use href="#emoji-upload"></use></svg>
          <p>No files uploaded yet</p>
          <p class="file-manager__empty-hint">Upload a G-code file to get started</p>
        </div>
        <div v-else class="file-list">
          <div
            v-for="file in uploadedFiles"
            :key="file.name"
            class="file-item"
            @dblclick="loadFileFromManager(file.name)"
            @touchstart="handleFileTouchStart($event, file.name)"
          >
            <div class="file-item__icon">
              <svg width="40" height="40"><use href="#emoji-package"></use></svg>
            </div>
            <div class="file-item__info">
              <div class="file-item__name">{{ file.name }}</div>
              <div class="file-item__meta">{{ formatFileSize(file.size) }} • {{ formatDate(file.uploadedAt) }}</div>
            </div>
            <div class="file-item__actions">
              <svg width="50" height="50" @click.stop="loadFileFromManager(file.name)" class="file-item__load-btn" title="Load file"><use href="#emoji-upload"></use></svg>
              <svg width="45" height="45" @click.stop="deleteFile(file.name)" class="file-item__delete-btn" title="Delete file"><use href="#emoji-trash"></use></svg>
            </div>
          </div>
        </div>
      </div>
      <div class="file-manager__footer">
        <button @click="showFileManager = false" class="file-manager__close-btn">Close</button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import * as THREE from 'three';
import GCodeVisualizer from './visualizer/gcode-visualizer.js';
import { createGridLines, createCoordinateAxes, createDynamicAxisLabels, generateCuttingPointer } from './visualizer/helpers.js';
import { api } from './api';
import { api as mainApi } from '../../lib/api.js';
import { getSettings, updateSettings } from '../../lib/settings-store.js';
import { useToolpathStore } from './store';
import Dialog from '../../components/Dialog.vue';
import ConfirmPanel from '../../components/ConfirmPanel.vue';
import ProgressBar from '../../components/ProgressBar.vue';
import ProbeVisualizer from '../probe/ProbeVisualizer.vue';
// Probing is now handled server-side

const store = useToolpathStore();

const presets = [
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Side' },
  { id: 'iso', label: '3D' }
] as const;

const props = withDefaults(defineProps<{
  view: 'top' | 'front' | 'iso';
  theme: 'light' | 'dark';
  connected?: boolean;
  machineState?: 'idle' | 'run' | 'hold' | 'alarm' | 'offline' | 'door' | 'check' | 'home' | 'sleep' | 'tool';
  jobLoaded?: { filename: string; currentLine: number; totalLines: number; status: 'running' | 'paused' | 'stopped' | 'completed' } | null;
  workCoords?: { x: number; y: number; z: number; a: number };
  workOffset?: { x: number; y: number; z: number; a: number };
  gridSizeX?: number;
  gridSizeY?: number;
  zMaxTravel?: number | null;
  spindleRpm?: number;
  alarmMessage?: string;
  currentTool?: number;
  isToolChanging?: boolean;
}>(), {
  view: 'iso', // Default to 3D view
  theme: 'dark', // Default to dark theme
  connected: false,
  workCoords: () => ({ x: 0, y: 0, z: 0, a: 0 }),
  workOffset: () => ({ x: 0, y: 0, z: 0, a: 0 }),
  gridSizeX: 1260,
  gridSizeY: 1284,
  zMaxTravel: null,
  spindleRpm: 0,
  jobLoaded: null,
  isToolChanging: false
});

const emit = defineEmits<{
  (e: 'change-view', value: 'top' | 'front' | 'iso'): void;
}>();

// Job control computed properties
const isOnHold = computed(() => {
  const state = props.machineState?.toLowerCase();
  return state === 'hold' || state === 'door';
});

const canStartOrResume = computed(() => {
  if (!props.connected) return false;
  const state = props.machineState?.toLowerCase();

  // Condition 1: Can start new job if we have a loaded program and machine is idle
  if (props.jobLoaded?.filename && state === 'idle') {
    return true;
  }

  // Condition 2: Can resume job if machine is on hold or door (regardless of jobLoaded)
  if (state === 'hold' || state === 'door') {
    return true;
  }

  return false;
});

const canPause = computed(() => {
  if (!props.connected || !props.jobLoaded?.filename) return false;
  const state = props.machineState?.toLowerCase();
  return state === 'run';
});

const canStop = computed(() => {
  if (!props.connected || !props.jobLoaded?.filename) return false;
  const state = props.machineState?.toLowerCase();
  return state === 'run' || state === 'hold' || state === 'door';
});

const isJobRunning = computed(() => {
  return props.jobLoaded?.status === 'running';
});

// Template refs
const canvas = ref<HTMLElement>();
const fileInput = ref<HTMLInputElement>();

// Reactive state
const hasFile = ref(false);
const isLoading = ref(false);
const showRapids = ref(true); // Default to shown like gSender
const showCutting = ref(true); // Default to shown (includes both feed and arcs)
const showSpindle = ref(true); // Default to shown
const spindleViewMode = ref(false); // Spindle view mode - off by default
const autoFitMode = ref(true); // Auto-fit mode - on by default
const floodEnabled = ref(false); // Flood coolant - off by default
const mistEnabled = ref(false); // Mist coolant - off by default
const showFileManager = ref(false);
const uploadedFiles = ref<Array<{ name: string; size: number; uploadedAt: string }>>([]);
const showDeleteConfirm = ref(false);
const fileToDelete = ref<string | null>(null);
const showProbeDialog = ref(false);

// Probe dialog state
const probeType = ref<'3d-touch' | 'standard-block'>('3d-touch');
const ballPointDiameter = ref(2);
const zPlunge = ref(3);
const zOffset = ref(-0.1);
const probingAxis = ref('Z');
const selectedCorner = ref<string | null>(null);
const selectedSide = ref<string | null>(null); // For X mode (not persisted)
const probeActive = ref(false); // Probe pin active state from CNC
const probeEverActivated = ref(false); // Track if probe was ever activated (doesn't reset to false)
const probingInProgress = ref(false); // Track if probing is currently running
let abortProbing = false; // Flag to abort probing sequence

// Computed property to check if probe button should be enabled
const isProbeReady = computed(() => {
  if (!probeEverActivated.value) return false;

  // For X and Y modes, also require a side to be selected
  if (probingAxis.value === 'X' || probingAxis.value === 'Y') {
    return selectedSide.value !== null && selectedSide.value !== '';
  }

  // For XY and XYZ modes, require a corner to be selected
  if (probingAxis.value === 'XY' || probingAxis.value === 'XYZ') {
    return selectedCorner.value !== null && selectedCorner.value !== '';
  }

  // For other modes (Z, Center-Inner, Center-Outer), just need probe active
  return true;
});

// Center probing settings
const xDimension = ref(100);
const yDimension = ref(100);
const rapidMovement = ref(2000);
const probeZFirst = ref(false); // For Center - Outer only
const errors = ref({
  ballPointDiameter: '',
  zPlunge: '',
  zOffset: ''
});
const lastExecutedLine = ref<number>(0); // Track the last executed line number
const showOutOfBoundsWarning = ref(false); // Show warning if G-code exceeds boundaries
const outOfBoundsAxes = ref<string[]>([]);
const outOfBoundsDirections = ref<string[]>([]);
const outOfBoundsMessage = computed(() => {
  const base = 'Warning: Toolpath exceeds machine boundaries';
  if (!showOutOfBoundsWarning.value) return '';

  // Prefer direction list; map Z+/Z- to friendly phrases, keep X/Y as-is
  const dirs = outOfBoundsDirections.value || [];
  if (dirs.length > 0) {
    const zMax = typeof props.zMaxTravel === 'number' ? props.zMaxTravel : null;
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
const numberOfToolsToShow = ref<number>(4);

// Tool press state for long-press interaction
const toolPress = ref<Record<number, { start: number; progress: number; raf?: number; active: boolean; triggered: boolean; blinking: boolean }>>({});

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

// Mouse/touch controls
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let isRotating = false;
let isPanning = false;
let cameraTarget = new THREE.Vector3(0, 0, 0);

// Spindle position interpolation with exponential smoothing
let targetSpindlePosition = { x: 0, y: 0, z: 0 };
let currentSpindlePosition = { x: 0, y: 0, z: 0 };
const spindleSmoothFactor = 0.2; // Lower = smoother but slower (0.05-0.2 recommended)

const initThreeJS = () => {
  if (!canvas.value) return;

  // Scene
  scene = new THREE.Scene();
  updateSceneBackground();

  // Orthographic Camera - Z-up orientation (standard CNC view)
  const aspect = canvas.value.clientWidth / canvas.value.clientHeight;
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
  renderer.setSize(canvas.value.clientWidth, canvas.value.clientHeight);
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

  // Grid with numbers and major/minor lines
  gridGroup = createGridLines({ // 10mm spacing with numbers
    gridSizeX: props.gridSizeX,
    gridSizeY: props.gridSizeY,
    workOffset: props.workOffset
  });
  scene.add(gridGroup);

  axesGroup = createCoordinateAxes(50);
  scene.add(axesGroup);

  // Add initial axis labels
  axisLabelsGroup = createDynamicAxisLabels(null);
  scene.add(axisLabelsGroup);

  // G-code visualizer
  gcodeVisualizer = new GCodeVisualizer();
  scene.add(gcodeVisualizer.group);
  // Improve rapid color contrast in light theme
  if (props.theme === 'light') {
    gcodeVisualizer.setRapidColor(0xE67E22); // orange for light theme
  }

  // Add cutting pointer/spindle
  cuttingPointer = generateCuttingPointer();
  cuttingPointer.position.set(0, 0, 0); // Start at origin
  scene.add(cuttingPointer);

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
};


const setupControls = () => {
  if (!canvas.value || !renderer) return;

  const element = renderer.domElement;

  // Mouse events
  element.addEventListener('mousedown', onMouseDown);
  element.addEventListener('mousemove', onMouseMove);
  element.addEventListener('mouseup', onMouseUp);
  element.addEventListener('wheel', onWheel, { passive: false });

  // Touch events for mobile
  element.addEventListener('touchstart', onTouchStart, { passive: false });
  element.addEventListener('touchmove', onTouchMove, { passive: false });
  element.addEventListener('touchend', onTouchEnd);
};

const onMouseDown = (event: MouseEvent) => {
  isDragging = true;
  previousMousePosition = { x: event.clientX, y: event.clientY };

  // Only allow rotation in 3D view, not in top or side views
  const isOrthographicView = props.view === 'top' || props.view === 'front';
  isRotating = event.button === 0 && !isOrthographicView; // Left click for rotation (3D only)
  isPanning = event.button === 1 || (event.button === 0 && isOrthographicView); // Middle click for all views, left click in ortho views
};

const onMouseMove = (event: MouseEvent) => {
  if (!isDragging || !camera) return;

  const deltaX = event.clientX - previousMousePosition.x;
  const deltaY = event.clientY - previousMousePosition.y;

  if (isRotating) {
    // Rotate camera around scene center maintaining Z-up
    const spherical = new THREE.Spherical();
    spherical.setFromVector3(camera.position.clone().sub(cameraTarget));

    spherical.theta -= deltaX * 0.01;
    spherical.phi += deltaY * 0.01;

    // Limit vertical rotation (phi from 0.1 to PI-0.1)
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));

    camera.position.setFromSpherical(spherical).add(cameraTarget);
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

  // Scale pointer based on frustum size so it remains visible at all zoom levels
  const frustumWidth = camera.right - camera.left;
  let scale = frustumWidth * 0.01; // 1% of visible width

  // Cap the maximum scale to prevent spindle from appearing too large when zoomed out
  const maxScale = 5; // Maximum scale limit
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

const onTouchStart = (event: TouchEvent) => {
  if (event.touches.length === 1) {
    const touch = event.touches[0];
    onMouseDown({ clientX: touch.clientX, clientY: touch.clientY, button: 0 } as MouseEvent);
  } else if (event.touches.length === 2) {
    // Two fingers - setup for panning
    isDragging = true;
    isPanning = true;
    isRotating = false;

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

const onTouchEnd = () => {
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
    }

    // Rotate cutting pointer when spindle is spinning (throttled to 30 fps)
    if (props.spindleRpm > 0) {
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

const handleGCodeUpdate = async (data: { filename: string; content: string; timestamp: string }) => {
  try {
    // Reset completed lines before rendering new G-code
    if (gcodeVisualizer) {
      gcodeVisualizer.resetCompletedLines();
    }

    // Set grid bounds for out-of-bounds detection
    const gridSizeX = props.gridSizeX || 1260;
    const gridSizeY = props.gridSizeY || 1284;
    const workOffsetX = props.workOffset?.x || 0;
    const workOffsetY = props.workOffset?.y || 0;
    const workOffsetZ = props.workOffset?.z || 0;
    const zMax = typeof props.zMaxTravel === 'number' ? props.zMaxTravel : null;

    const minX = -workOffsetX;
    const maxX = gridSizeX - workOffsetX;
    const minY = -gridSizeY - workOffsetY;
    const maxY = -workOffsetY;
    const minZ = zMax != null ? -zMax - workOffsetZ : undefined;
    const maxZ = zMax != null ? -workOffsetZ : undefined;

    gcodeVisualizer.setGridBounds({ minX, maxX, minY, maxY, minZ, maxZ });

    gcodeVisualizer.render(data.content);

    // Detect tools used based on M6 lines with tool numbers
    toolsUsed.value = extractToolsFromGCode(data.content);

    // Check if G-code has out of bounds movements
    showOutOfBoundsWarning.value = gcodeVisualizer.hasOutOfBoundsMovement();
    outOfBoundsAxes.value = gcodeVisualizer.getOutOfBoundsAxes();
    outOfBoundsDirections.value = gcodeVisualizer.getOutOfBoundsDirections();

    // Reset all line type visibility to true when loading new G-code
    showRapids.value = true;
    showCutting.value = true;

    // Fit camera to content with automatic centering and zoom
    const bounds = gcodeVisualizer.getBounds();
    if (bounds && bounds.size.length() > 0) {
      currentGCodeBounds = bounds; // Store bounds for later use
      // Fit to current view (honors user's selection / default)
      if (autoFitMode.value) {
        fitCameraToBounds(bounds);
      }
    }

    hasFile.value = true;

    // Set initial visibility for all line types
    gcodeVisualizer.setRapidVisibility(showRapids.value);
    gcodeVisualizer.setCuttingVisibility(showCutting.value);

    // Check if we have a last executed line (from server state on page load)
    // and mark all lines up to that point as completed
    if (lastExecutedLine.value > 0) {
      const completedLines = [];
      for (let i = 1; i <= lastExecutedLine.value; i++) {
        completedLines.push(i);
      }
      gcodeVisualizer.markLinesCompleted(completedLines);
    }

    // Update axis labels based on G-code bounds
    if (axisLabelsGroup) {
      scene.remove(axisLabelsGroup);
    }
    axisLabelsGroup = createDynamicAxisLabels(bounds);
    scene.add(axisLabelsGroup);
  } catch (error) {
    console.error('Error rendering G-code:', error);
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

// Probe functions
const openProbeDialog = () => {
  // Reset probe activation state when opening dialog
  probeEverActivated.value = false;
  showProbeDialog.value = true;
};

const startProbe = async () => {
  try {
    probingInProgress.value = true;
    abortProbing = false;

    const options = {
      probingAxis: probingAxis.value,
      selectedCorner: selectedCorner.value,
      selectedSide: selectedSide.value,
      xDimension: xDimension.value,
      yDimension: yDimension.value,
      rapidMovement: rapidMovement.value,
      probeZFirst: probeZFirst.value,
      toolDiameter: ballPointDiameter.value || 6
    };

    console.log('[Probe] Starting probe operation:', options);

    // Call server API to start probing
    const response = await fetch('/api/probe/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to start probe');
    }

    console.log('[Probe] Probe operation started:', result);
  } catch (error) {
    console.error('[Probe] Error starting probe:', error);
    probingInProgress.value = false;
  }
};

const closeProbeDialog = async () => {
  if (probingInProgress.value) {
    try {
      console.log('[Probe] Closing dialog - stopping probe job');

      // Call server API to stop probing
      const response = await fetch('/api/probe/stop', {
        method: 'POST',
      });

      const result = await response.json();

      if (response.ok) {
        console.log('[Probe] Probe stopped:', result);
      } else {
        console.error('[Probe] Error stopping probe:', result.error);
      }
    } catch (error) {
      console.error('[Probe] Error stopping probe:', error);
    }
  }
  showProbeDialog.value = false;
  probingInProgress.value = false;
};

// File manager helpers
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;

  return date.toLocaleDateString();
};

const loadFileFromManager = async (filename: string) => {
  try {
    // Load the file - the API should trigger the gcode-updated event
    await api.loadGCodeFile(filename);
    showFileManager.value = false;
  } catch (error) {
    console.error('Error loading file:', error);
  }
};

const deleteFile = (filename: string) => {
  fileToDelete.value = filename;
  showDeleteConfirm.value = true;
};

let lastTapTime = 0;
let lastTapFile = '';

const handleFileTouchStart = (event: TouchEvent, filename: string) => {
  const currentTime = Date.now();
  const tapDelay = 300; // Double tap detection window (ms)

  if (currentTime - lastTapTime < tapDelay && lastTapFile === filename) {
    // Double tap detected
    event.preventDefault();
    loadFileFromManager(filename);
    lastTapTime = 0;
    lastTapFile = '';
  } else {
    // First tap
    lastTapTime = currentTime;
    lastTapFile = filename;
  }
};

const confirmDelete = async () => {
  if (!fileToDelete.value) return;

  try {
    await api.deleteGCodeFile(fileToDelete.value);
    await fetchUploadedFiles();
    showDeleteConfirm.value = false;
    fileToDelete.value = null;
  } catch (error) {
    console.error('Error deleting file:', error);
    showDeleteConfirm.value = false;
    fileToDelete.value = null;
  }
};

const cancelDelete = () => {
  showDeleteConfirm.value = false;
  fileToDelete.value = null;
};

const fetchUploadedFiles = async () => {
  try {
    const data = await api.listGCodeFiles();
    uploadedFiles.value = data.files || [];
  } catch (error) {
    console.error('Error fetching uploaded files:', error);
    uploadedFiles.value = [];
  }
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
    await api.stopGCodeJob();
  } catch (error) {
    console.error('Error stopping job:', error);
  }
};

const getGridBounds = () => {
  const gridSizeX = props.gridSizeX || 1260;
  const gridSizeY = props.gridSizeY || 1284;
  const workOffsetX = props.workOffset?.x || 0;
  const workOffsetY = props.workOffset?.y || 0;

  // Grid boundaries (from helpers.js createGridLines)
  // minX = -workOffset.x
  // maxX = gridSizeX - workOffset.x
  // minY = -gridSizeY - workOffset.y
  // maxY = -workOffset.y

  const minX = -workOffsetX;
  const maxX = gridSizeX - workOffsetX;
  const minY = -gridSizeY - workOffsetY;
  const maxY = -workOffsetY;

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
  const padding = 1.01; // 1% padding for very tight fit
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
      const projectedWidth = Math.sqrt(sizeX * sizeX + sizeY * sizeY) * 0.9; // XY diagonal scaled
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
  const distance = Math.max(sizeX, sizeY, sizeZ) * 2; // Safe distance

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

  // Update orthographic camera aspect ratio
  const aspect = width / height;
  const frustumHeight = camera.top - camera.bottom;
  const frustumWidth = frustumHeight * aspect;

  camera.left = -frustumWidth / 2;
  camera.right = frustumWidth / 2;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
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
  // Suppress grid/OOB recomputation during tool change
  if (props.isToolChanging) {
    // Also ensure any transient warning is hidden during toolchange
    showOutOfBoundsWarning.value = false;
    return;
  }

  if (scene && gridGroup) {
    scene.remove(gridGroup);
  }

  gridGroup = createGridLines({
    gridSizeX: props.gridSizeX,
    gridSizeY: props.gridSizeY,
    workOffset: newOffset
  });

  if (scene) {
    scene.add(gridGroup);
  }

  // Update grid bounds for out-of-bounds detection (will auto re-render G-code)
  if (gcodeVisualizer) {
    const gridSizeX = props.gridSizeX || 1260;
    const gridSizeY = props.gridSizeY || 1284;
    const workOffsetX = newOffset?.x || 0;
    const workOffsetY = newOffset?.y || 0;
    const workOffsetZ = newOffset?.z || 0;
    const zMax = typeof props.zMaxTravel === 'number' ? props.zMaxTravel : null;

    const minX = -workOffsetX;
    const maxX = gridSizeX - workOffsetX;
    const minY = -gridSizeY - workOffsetY;
    const maxY = -workOffsetY;

    const minZ = zMax != null ? -zMax - workOffsetZ : undefined;
    const maxZ = zMax != null ? -workOffsetZ : undefined;

    gcodeVisualizer.setGridBounds({ minX, maxX, minY, maxY, minZ, maxZ });

    // Update out of bounds warning after re-rendering
    showOutOfBoundsWarning.value = gcodeVisualizer.hasOutOfBoundsMovement();
    outOfBoundsAxes.value = gcodeVisualizer.getOutOfBoundsAxes();
    outOfBoundsDirections.value = gcodeVisualizer.getOutOfBoundsDirections();
  }

  // Re-fit camera if Auto-Fit is OFF (to show updated grid bounds)
  if (!autoFitMode.value) {
    fitCameraToBounds(getGridBounds());
  }
}, { deep: true });

// When toolchange ends, recompute bounds and OOB once using the latest work offset
watch(() => props.isToolChanging, (nowChanging, wasChanging) => {
  if (nowChanging === false && wasChanging === true) {
    // Re-run the workOffset watcher body with current props.workOffset
    const newOffset = props.workOffset;

    if (scene && gridGroup) {
      scene.remove(gridGroup);
    }

    gridGroup = createGridLines({
      gridSizeX: props.gridSizeX,
      gridSizeY: props.gridSizeY,
      workOffset: newOffset
    });

    if (scene) {
      scene.add(gridGroup);
    }

    if (gcodeVisualizer) {
      const gridSizeX = props.gridSizeX || 1260;
      const gridSizeY = props.gridSizeY || 1284;
      const workOffsetX = newOffset?.x || 0;
      const workOffsetY = newOffset?.y || 0;
      const workOffsetZ = newOffset?.z || 0;
      const zMax = typeof props.zMaxTravel === 'number' ? props.zMaxTravel : null;

      const minX = -workOffsetX;
      const maxX = gridSizeX - workOffsetX;
      const minY = -gridSizeY - workOffsetY;
      const maxY = -workOffsetY;

      const minZ = zMax != null ? -zMax - workOffsetZ : undefined;
      const maxZ = zMax != null ? -workOffsetZ : undefined;

      gcodeVisualizer.setGridBounds({ minX, maxX, minY, maxY, minZ, maxZ });

      // Update out of bounds warning after re-rendering
      showOutOfBoundsWarning.value = gcodeVisualizer.hasOutOfBoundsMovement();
      outOfBoundsAxes.value = gcodeVisualizer.getOutOfBoundsAxes();
      outOfBoundsDirections.value = gcodeVisualizer.getOutOfBoundsDirections();
    }

    // Re-fit camera if Auto-Fit is OFF (to show updated grid bounds)
    if (!autoFitMode.value) {
      fitCameraToBounds(getGridBounds());
    }
  }
});

  // Watch for grid size changes to update the grid and bounds
  watch(() => [props.gridSizeX, props.gridSizeY], () => {
  if (scene && gridGroup) {
    scene.remove(gridGroup);
  }

  gridGroup = createGridLines({
    gridSizeX: props.gridSizeX,
    gridSizeY: props.gridSizeY,
    workOffset: props.workOffset
  });

  // (zMaxTravel watcher is defined below as a top-level watcher)

  if (scene) {
    scene.add(gridGroup);
  }

  // Update grid bounds for out-of-bounds detection (will auto re-render G-code)
  if (gcodeVisualizer) {
    const gridSizeX = props.gridSizeX || 1260;
    const gridSizeY = props.gridSizeY || 1284;
    const workOffsetX = props.workOffset?.x || 0;
    const workOffsetY = props.workOffset?.y || 0;
    const workOffsetZ = props.workOffset?.z || 0;
    const zMax = typeof props.zMaxTravel === 'number' ? props.zMaxTravel : null;

    const minX = -workOffsetX;
    const maxX = gridSizeX - workOffsetX;
    const minY = -gridSizeY - workOffsetY;
    const maxY = -workOffsetY;

    const minZ = zMax != null ? -zMax - workOffsetZ : undefined;
    const maxZ = zMax != null ? -workOffsetZ : undefined;

    gcodeVisualizer.setGridBounds({ minX, maxX, minY, maxY, minZ, maxZ });

    // Update out of bounds warning after re-rendering
    showOutOfBoundsWarning.value = gcodeVisualizer.hasOutOfBoundsMovement();
    outOfBoundsAxes.value = gcodeVisualizer.getOutOfBoundsAxes();
    outOfBoundsDirections.value = gcodeVisualizer.getOutOfBoundsDirections();
  }

  // Re-fit camera if Auto-Fit is OFF (to show updated grid bounds)
  if (!autoFitMode.value) {
    fitCameraToBounds(getGridBounds());
  }
});

// Watch for file manager dialog open to fetch files
watch(() => showFileManager.value, (isOpen) => {
  if (isOpen) {
    fetchUploadedFiles();
  }
});

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

// Watch for probe settings changes
watch(() => probeType.value, async (value) => {
  if (!isInitialLoad) {
    try {
      await updateSettings({ probeType: value });
    } catch (error) {
      console.error('[GCodeVisualizer] Failed to save probe type setting', JSON.stringify({ error: error.message }));
    }
  }
});

watch(() => probingAxis.value, async (value) => {
  // Reset side selection when switching probing axis
  selectedSide.value = null;

  if (!isInitialLoad) {
    try {
      await updateSettings({ probingAxis: value }, { broadcast: false });
    } catch (error) {
      console.error('[GCodeVisualizer] Failed to save probing axis setting', JSON.stringify({ error: error.message }));
    }
  }
});

watch(() => selectedCorner.value, async (value) => {
  if (!isInitialLoad) {
    // Only save corner selection for XYZ/XY modes (not for X/Y modes which use sides)
    if (value && !['Left', 'Right'].includes(value)) {
      try {
        await updateSettings({ probeSelectedCorner: value });
      } catch (error) {
        console.error('[GCodeVisualizer] Failed to save selected corner setting', JSON.stringify({ error: error.message }));
      }
    }
    // Don't save or clear when selecting sides (Left/Right)
  }
});

watch(() => ballPointDiameter.value, async (value) => {
  if (!isInitialLoad) {
    try {
      await updateSettings({ probeBallPointDiameter: value });
    } catch (error) {
      console.error('[GCodeVisualizer] Failed to save ball point diameter setting', JSON.stringify({ error: error.message }));
    }
  }
});

watch(() => zPlunge.value, async (value) => {
  if (!isInitialLoad) {
    try {
      await updateSettings({ probeZPlunge: value });
    } catch (error) {
      console.error('[GCodeVisualizer] Failed to save Z plunge setting', JSON.stringify({ error: error.message }));
    }
  }
});

watch(() => zOffset.value, async (value) => {
  if (!isInitialLoad) {
    try {
      await updateSettings({ probeZOffset: value });
    } catch (error) {
      console.error('[GCodeVisualizer] Failed to save Z offset setting', JSON.stringify({ error: error.message }));
    }
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

const toggleFlood = async () => {
  floodEnabled.value = !floodEnabled.value;
  try {
    const command = floodEnabled.value ? 'M8' : 'M9';
    await api.sendCommandViaWebSocket({
      command,
      displayCommand: command
    });
  } catch (error) {
    console.error('Failed to toggle flood coolant:', error);
    floodEnabled.value = !floodEnabled.value; // Revert on error
  }
};

const toggleMist = async () => {
  mistEnabled.value = !mistEnabled.value;
  try {
    const command = mistEnabled.value ? 'M7' : 'M9';
    await api.sendCommandViaWebSocket({
      command,
      displayCommand: command
    });
  } catch (error) {
    console.error('Failed to toggle mist coolant:', error);
    mistEnabled.value = !mistEnabled.value; // Revert on error
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

// Probe validation functions
const validateBallPointDiameter = () => {
  if (ballPointDiameter.value <= 0) {
    errors.value.ballPointDiameter = 'Must be a positive number';
  } else {
    errors.value.ballPointDiameter = '';
  }
};

const validateZPlunge = () => {
  if (zPlunge.value <= 0) {
    errors.value.zPlunge = 'Must be a positive number';
  } else {
    errors.value.zPlunge = '';
  }
};

const validateZOffset = () => {
  if (isNaN(zOffset.value)) {
    errors.value.zOffset = 'Must be a valid number';
  } else {
    errors.value.zOffset = '';
  }
};

// Tool press functionality - long press to change tool
const LONG_PRESS_MS_TOOL = 1500;
const DELAY_BEFORE_VISUAL_MS = 150;

const startToolPress = (toolNumber: number, _evt?: Event) => {
  if (_evt) _evt.preventDefault();
  if (props.isToolChanging || props.currentTool === toolNumber) return;

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
      // Send M6 T{toolNumber} command
      api.sendCommandViaWebSocket({ command: `M6 T${toolNumber}`, displayCommand: `M6 T${toolNumber}` });
      state.progress = 0;
      state.active = false;
      return;
    }

    state.raf = requestAnimationFrame(tick);
  };

  state.raf = requestAnimationFrame(tick);
};

const endToolPress = (toolNumber: number) => {
  const state = toolPress.value[toolNumber];
  if (!state) return;

  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;

  // If not triggered (incomplete press), show blink feedback
  if (!state.triggered && state.active) {
    state.active = false;
    state.progress = 0;
    state.blinking = true;
    setTimeout(() => {
      state.blinking = false;
    }, 400);
  } else {
    state.active = false;
    state.progress = 0;
  }

  // Reset triggered after delay
  setTimeout(() => {
    state.triggered = false;
  }, 100);
};

const cancelToolPress = (toolNumber: number) => {
  const state = toolPress.value[toolNumber];
  if (!state) return;

  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = undefined;
  state.active = false;
  state.progress = 0;
  state.triggered = false;
};

onMounted(async () => {
  // Load settings from store (already loaded in main.ts)
  const settings = getSettings();
  if (settings) {
    if (typeof settings.numberOfTools === 'number') {
      numberOfToolsToShow.value = settings.numberOfTools;
    }
    if (typeof settings.autoFit === 'boolean') {
      autoFitMode.value = settings.autoFit;
    }
    if (typeof settings.spindleView === 'boolean') {
      spindleViewMode.value = settings.spindleView;
    }
    // Load probe settings
    if (settings.probeType) {
      probeType.value = settings.probeType;
    }
    if (settings.probingAxis) {
      probingAxis.value = settings.probingAxis;
    }
    if (settings.probeSelectedCorner) {
      // Migrate old corner names to new terminology
      const cornerMigrationMap: Record<string, string> = {
        'FrontRight': 'BottomRight',
        'FrontLeft': 'BottomLeft',
        'BackRight': 'TopRight',
        'BackLeft': 'TopLeft'
      };
      selectedCorner.value = cornerMigrationMap[settings.probeSelectedCorner] || settings.probeSelectedCorner;
    }
    if (typeof settings.probeBallPointDiameter === 'number') {
      ballPointDiameter.value = settings.probeBallPointDiameter;
    }
    if (typeof settings.probeZPlunge === 'number') {
      zPlunge.value = settings.probeZPlunge;
    }
    if (typeof settings.probeZOffset === 'number') {
      zOffset.value = settings.probeZOffset;
    }
  }

  // Wait for next tick to ensure all watchers have fired with isInitialLoad=true
  await nextTick();

  // Mark initial load complete so watchers can save changes
  isInitialLoad = false;

  initThreeJS();
  window.addEventListener('resize', handleResize);

  // Listen for settings changes (partial/delta updates)
  window.addEventListener('settings-changed', (event: any) => {
    const changedSettings = event.detail;

    // Apply only the changed settings
    if ('numberOfTools' in changedSettings) {
      numberOfToolsToShow.value = changedSettings.numberOfTools;
    }
    // Future settings can be added here
    // if ('someOtherSetting' in changedSettings) { ... }
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

  // Listen for server state updates to track job progress
  let prevJobStatus: 'running' | 'paused' | 'stopped' | undefined = undefined;
  api.onServerStateUpdated((state) => {
    const status = state.jobLoaded?.status as 'running' | 'paused' | 'stopped' | undefined;

    // Update probe active state
    if (state.machineState?.probeActive !== undefined) {
      probeActive.value = state.machineState.probeActive;
      // Once probe is activated, keep button enabled
      if (state.machineState.probeActive) {
        probeEverActivated.value = true;
      }
    }

    // If a run is starting, reset completed markers so we start fresh
    if (status === 'running' && prevJobStatus !== 'running') {
      lastExecutedLine.value = 0;
      if (gcodeVisualizer) {
        gcodeVisualizer.resetCompletedLines();
      }
      markedLines.clear();
    }

    if (state.jobLoaded && state.jobLoaded.currentLine && status === 'running') {
      if (state.jobLoaded.currentLine > lastExecutedLine.value) {
        lastExecutedLine.value = state.jobLoaded.currentLine;
      }
    }

    // Reset visualizer segments when job stops/completes or when program is cleared
    if (!state.jobLoaded || status === 'stopped') {
      lastExecutedLine.value = 0;
      if (gcodeVisualizer) {
        gcodeVisualizer.resetCompletedLines();
      }
      markedLines.clear();
    }

    // If the user closed the job progress panel, also reset completed segments
    const sp = (state.jobLoaded as any)?.showProgress;
    if (sp === false) {
      lastExecutedLine.value = 0;
      if (gcodeVisualizer) {
        gcodeVisualizer.resetCompletedLines();
      }
      markedLines.clear();
    }

    prevJobStatus = status;
  });

  // Listen to cnc-command-result events to mark completed lines
  // Set up after visualizer is initialized to ensure gcodeVisualizer exists
  api.on('cnc-command-result', (result: any) => {
    if (!result || !gcodeVisualizer) return;

    const lineNumber = result?.meta?.lineNumber;

    if (result?.sourceId === 'gcode-runner' &&
        lineNumber &&
        result?.status === 'success' &&
        !markedLines.has(lineNumber)) {
      gcodeVisualizer.markLineCompleted(lineNumber);
      markedLines.add(lineNumber);
    }
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

    // Check for existing G-code program after viewport is fully initialized
    if (api.ws && api.ws.readyState === WebSocket.OPEN) {
      api.checkCurrentProgram();
    }
  }, 100);
});

onUnmounted(() => {
  if (animationId) {
    cancelAnimationFrame(animationId);
  }

  if (renderer) {
    renderer.dispose();
  }

  if (resizeObserver) {
    resizeObserver.disconnect();
  }

  window.removeEventListener('resize', handleResize);
});

// Track which line numbers have been marked as completed
const markedLines = new Set<number>();

// Watch for coolant state changes from machine status
watch(() => store.status.floodCoolant, (newValue) => {
  if (newValue !== undefined) {
    floodEnabled.value = newValue;
  }
});

watch(() => store.status.mistCoolant, (newValue) => {
  if (newValue !== undefined) {
    mistEnabled.value = newValue;
  }
});
</script>

<style scoped>
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

.floating-toolbar--legend {
  top: 76px;
  right: 16px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
}

.tools-legend {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tools-legend--bottom {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none; /* display-only to avoid blocking controls */
}

.tools-legend__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--color-surface-muted);
  padding: 6px 12px;
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  transition: background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
  box-shadow: inset 0 0 0 1px var(--color-border);
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  pointer-events: auto;
}

.tools-legend__item.used {
  background: rgba(26, 188, 156, 0.1);
  box-shadow: inset 0 0 0 1px var(--color-accent);
}

.tools-legend__item.active {
  opacity: 1;
  background: var(--color-accent);
  color: #fff;
  box-shadow: none;
  transform: none;
  cursor: default;
}

/* When tool is both active AND used by program, add inner border to show it's in the program */
.tools-legend__item.active.used {
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.4);
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

.tools-legend__item.long-press-triggered {
  background: var(--color-surface-muted) !important;
  color: var(--color-text-primary) !important;
  transform: none !important;
  box-shadow: inset 0 0 0 1px var(--color-border) !important;
}

@keyframes blink-border-tool {
  0%, 100% { box-shadow: inset 0 0 0 2px #ff6b6b; }
  50% { box-shadow: inset 0 0 0 1px var(--color-border); }
}

.tools-legend__item.blink-border {
  animation: blink-border-tool 0.4s ease-in-out;
}

.tools-legend__label {
  min-width: 32px;
  text-align: right;
  font-size: 0.95rem;
  font-weight: 500;
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
  font-size: 14px;
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

.view-button {
  border: none;
  border-radius: var(--radius-small);
  padding: 10px 16px;
  cursor: pointer;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font-size: 14px;
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
  font-size: 0.9rem;
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
  justify-content: flex-end;
  gap: 8px;
  background: transparent;
  padding: 6px 10px;
  border-radius: var(--radius-small);
  font-size: 0.9rem;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  min-width: 180px;
}

.legend-item span:first-child {
  flex: 0 1 auto;
  text-align: right;
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
  background: #ffffff;
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
  bottom: 80px;
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
  padding: 16px 28px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 110px;
  justify-content: center;
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

/* File Manager Styles */
.file-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 500px;
  overflow: hidden;
  border-radius: 16px;
}

.file-manager__header {
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.file-manager__icon {
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, var(--color-accent), rgba(26, 188, 156, 0.7));
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.file-manager__title {
  margin: 0;
  font-size: 1.5rem;
  color: var(--color-text-primary);
}

.file-manager__content {
  flex: 1;
  overflow-y: auto;
  padding: var(--gap-md);
}

.file-manager__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  color: var(--color-text-secondary);
}

.file-manager__empty svg {
  margin-bottom: var(--gap-md);
  opacity: 0.5;
}

.file-manager__empty p {
  margin: 0;
  font-size: 1rem;
}

.file-manager__empty-hint {
  font-size: 0.875rem;
  opacity: 0.7;
  margin-top: var(--gap-xs) !important;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  padding: var(--gap-sm) var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  transition: all 0.2s ease;
  cursor: pointer;
}

.file-item:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.file-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  font-size: 32px;
}

.file-item__info {
  flex: 1;
  min-width: 0;
}

.file-item__name {
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-item__meta {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin-top: 4px;
}

.file-item__actions {
  display: flex;
  gap: var(--gap-xs);
  flex-shrink: 0;
}

.file-item__load-btn {
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-item__load-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.1);
}

.file-item__delete-btn {
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-item__delete-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.1);
}

.file-manager__footer {
  padding: var(--gap-md);
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: center;
  background: var(--color-surface);
}

.file-manager__close-btn {
  padding: 10px 32px;
  background: var(--gradient-accent);
  color: white;
  border: none;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-manager__close-btn:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
  transform: translateY(-1px);
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

.probe-icon {
  width: 48px;
  height: 48px;
  filter: invert(64%) sepia(48%) saturate(527%) hue-rotate(115deg) brightness(93%) contrast(91%);
}

.probe-label {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-accent);
}

.probe-button:hover .probe-icon {
  filter: brightness(0) invert(1);
}

.probe-button:hover .probe-label {
  color: white;
}

/* Probe dialog */
.probe-dialog {
  display: flex;
  flex-direction: column;
  max-width: 900px !important;
}

.probe-dialog__header {
  padding-bottom: 12px;
  padding: 10px 10px 12px 10px;
  text-align: center;
}

.probe-dialog__title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.probe-dialog__content {
  padding: 10px 20px 10px 20px;
  min-width: 900px;
  color: var(--color-text-primary);
}

.probe-dialog__columns {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 20px;
  min-height: 400px;
}

.probe-dialog__column {
  display: flex;
  flex-direction: column;
}

.probe-dialog__column h3 {
  margin: 0 0 16px 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.probe-dialog__column--controls {
  padding-right: 20px;
}

.probe-dialog__column--viewer {
  padding-left: 20px;
}

.probe-instructions {
  margin: 0 0 20px 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-primary);
}

.probe-warning {
  margin: 0 0 16px 0;
  padding: 10px 12px;
  font-size: 0.85rem;
  line-height: 1.4;
  color: #ff9800;
  background: rgba(255, 152, 0, 0.1);
  border-radius: 4px;
}

.probe-control-group--toggle {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
}

.probe-control-group--toggle-left {
  justify-content: flex-start;
}

.probe-control-group--toggle .probe-label {
  margin-bottom: 0;
}

.probe-instruction {
  margin-top: 12px;
  padding: 8px 12px;
  font-size: 0.85rem;
  text-align: center;
  color: var(--color-text-secondary);
  background: var(--color-bg-secondary);
  border-radius: 4px;
}

.probe-control-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.probe-control-row--three {
  grid-template-columns: 1fr 1fr 1fr;
}

.probe-control-group {
  margin-bottom: 12px;
}

.probe-label {
  display: block;
  margin-bottom: 4px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.probe-input,
.probe-select {
  width: 100%;
  padding: 6px 10px;
  font-size: 0.9rem;
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  transition: border-color 0.2s ease;
  text-align: right;
}

.probe-input:focus,
.probe-select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.probe-input[type="number"] {
  -moz-appearance: textfield;
  text-align: right;
}

.probe-input::-webkit-outer-spin-button,
.probe-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.probe-input-with-unit {
  display: flex;
  align-items: center;
  gap: 6px;
}

.probe-unit {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.probe-error {
  display: block;
  margin-top: 4px;
  font-size: 0.85rem;
  color: #ff6b6b;
}

.probe-dialog__footer {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 0 10px 20px 10px;
}

.probe-dialog__btn {
  padding: 10px 24px;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid var(--color-border);
}

.probe-dialog__btn--secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

.probe-dialog__btn--secondary:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.probe-dialog__btn--primary {
  background: var(--gradient-accent);
  color: white;
  border-color: var(--color-accent);
}

.probe-dialog__btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.probe-dialog__btn--primary:disabled {
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  border-color: var(--color-border);
  cursor: not-allowed;
  opacity: 0.5;
}

.probe-dialog__btn--primary:disabled:hover {
  transform: none;
  box-shadow: none;
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
</style>
