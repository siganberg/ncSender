<template>
  <section class="viewport">
    <!-- Full canvas with floating toolbars -->
    <div ref="canvas" class="viewport__canvas">
      <!-- Top floating toolbar -->
      <div class="floating-toolbar floating-toolbar--top">
        <div class="view-buttons" role="group" aria-label="Change viewport">
          <button
            v-for="preset in presets"
            :key="preset.id"
            :class="['view-button', { active: view === preset.id }]"
            @click="handleViewButtonClick(preset.id)"
          >
            {{ preset.label }}
          </button>
        </div>
        <div class="file-controls">
          <input 
            ref="fileInput"
            type="file" 
            accept=".nc,.gcode,.tap,.txt"
            @change="handleFileLoad"
            style="display: none"
          />
          <button @click="fileInput?.click()" class="load-button">
            Load G-code
          </button>
          <button v-if="hasFile" @click="clearFile" class="clear-button">
            Clear
          </button>
        </div>
      </div>

      <!-- Bottom floating legend -->
      <div class="floating-toolbar floating-toolbar--bottom">
        <div class="legend-item" :class="{ 'legend-item--disabled': !showRapids }" @click="toggleRapids">
          <span class="dot dot--rapid" :class="{ 'dot--disabled': !showRapids }"></span>
          <span>Rapid (G0)</span>
        </div>
        <div class="legend-item" :class="{ 'legend-item--disabled': !showCutting }" @click="toggleCutting">
          <span class="dot dot--cutting" :class="{ 'dot--disabled': !showCutting }"></span>
          <span>Cutting (G1/G2/G3)</span>
        </div>
      </div>

      <!-- Control buttons - bottom center -->
      <div class="control-buttons">
        <button
          class="control-btn control-btn--primary"
          :disabled="!canStartOrResume"
          @click="handleCycle"
          :title="isOnHold ? 'Resume Job' : 'Start Job'"
        >
          {{ isOnHold ? '▶ Resume' : '▶ Cycle' }}
        </button>
        <button
          class="control-btn control-btn--secondary"
          :disabled="!canPause"
          @click="handlePause"
          title="Pause Job"
        >
          ⏸ Pause
        </button>
        <button
          class="control-btn control-btn--danger"
          :disabled="!canStop"
          @click="handleStop"
          title="Stop Job"
        >
          ⏹ Stop
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import GCodeVisualizer from '../lib/visualizer/gcode-visualizer.js';
import { createGridLines, createCoordinateAxes, createDynamicAxisLabels } from '../lib/visualizer/helpers.js';
import { api } from '../lib/api.js';

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
  loadedGCodeProgram?: string | null;
}>(), {
  view: 'iso', // Default to 3D view
  theme: 'dark', // Default to dark theme
  connected: false
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
  if (props.loadedGCodeProgram && state === 'idle') {
    return true;
  }

  // Condition 2: Can resume job if machine is on hold or door (regardless of loadedGCodeProgram)
  if (state === 'hold' || state === 'door') {
    return true;
  }

  return false;
});

const canPause = computed(() => {
  if (!props.connected || !props.loadedGCodeProgram) return false;
  const state = props.machineState?.toLowerCase();
  return state === 'run';
});

const canStop = computed(() => {
  if (!props.connected || !props.loadedGCodeProgram) return false;
  const state = props.machineState?.toLowerCase();
  return state === 'run' || state === 'hold' || state === 'door';
});

// Template refs
const canvas = ref<HTMLElement>();
const fileInput = ref<HTMLInputElement>();

// Reactive state
const hasFile = ref(false);
const isLoading = ref(false);
const showRapids = ref(true); // Default to shown like gSender
const showCutting = ref(true); // Default to shown (includes both feed and arcs)
let currentGCodeBounds: any = null; // Store current G-code bounds

// Three.js objects
let scene: THREE.Scene;
let camera: THREE.OrthographicCamera;
let renderer: THREE.WebGLRenderer;
let controls: any;
let gcodeVisualizer: GCodeVisualizer;
let animationId: number;
let axisLabelsGroup: THREE.Group;
let resizeObserver: ResizeObserver;

// Mouse/touch controls
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let isRotating = false;
let isPanning = false;
let cameraTarget = new THREE.Vector3(0, 0, 0);

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
    2000                         // far
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

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(50, 50, 50);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  // Grid with numbers and major/minor lines
  const grid = createGridLines(); // 10mm spacing with numbers
  scene.add(grid);

  const axes = createCoordinateAxes(50);
  scene.add(axes);
  
  // Add initial axis labels
  axisLabelsGroup = createDynamicAxisLabels(null);
  scene.add(axisLabelsGroup);

  // G-code visualizer
  gcodeVisualizer = new GCodeVisualizer();
  scene.add(gcodeVisualizer.group);

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
  element.addEventListener('wheel', onWheel);

  // Touch events for mobile
  element.addEventListener('touchstart', onTouchStart);
  element.addEventListener('touchmove', onTouchMove);
  element.addEventListener('touchend', onTouchEnd);
};

const onMouseDown = (event: MouseEvent) => {
  isDragging = true;
  previousMousePosition = { x: event.clientX, y: event.clientY };
  
  // Only allow rotation in 3D view, not in top or side views
  const isOrthographicView = props.view === 'top' || props.view === 'front';
  isRotating = event.button === 0 && !isOrthographicView; // Left click for rotation (3D only)
  isPanning = (event.button === 1 && !isOrthographicView) || (event.button === 0 && isOrthographicView); // Middle click in 3D only, left click in ortho views
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
};

// Touch events (simplified)
const onTouchStart = (event: TouchEvent) => {
  if (event.touches.length === 1) {
    const touch = event.touches[0];
    onMouseDown({ clientX: touch.clientX, clientY: touch.clientY, button: 0 } as MouseEvent);
  }
};

const onTouchMove = (event: TouchEvent) => {
  event.preventDefault();
  if (event.touches.length === 1) {
    const touch = event.touches[0];
    onMouseMove({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent);
  }
};

const onTouchEnd = () => {
  onMouseUp();
};

const updateSceneBackground = () => {
  if (!scene) return;
  
  // Set background color based on theme
  const backgroundColor = props.theme === 'dark' ? 0x111827 : 0xf8fafc; // Dark blue-gray vs light gray
  scene.background = new THREE.Color(backgroundColor);
};

const animate = () => {
  animationId = requestAnimationFrame(animate);
  
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
};

const handleFileLoad = async (event: Event) => {
  console.log('File load event triggered');
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) {
    console.log('No file selected');
    return;
  }

  console.log('Selected file:', file.name, file.size, 'bytes');
  isLoading.value = true;
  try {
    // Upload file to server
    console.log('Uploading file to server...');
    const result = await api.uploadGCodeFile(file);
    console.log('Upload result:', result);
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

const handleGCodeUpdate = (data: { filename: string; content: string; timestamp: string }) => {
  console.log('handleGCodeUpdate called with:', data);
  try {
    gcodeVisualizer.render(data.content);

    // Reset all line type visibility to true when loading new G-code
    showRapids.value = true;
    showCutting.value = true;

    // Fit camera to content with automatic centering and zoom
    const bounds = gcodeVisualizer.getBounds();
    if (bounds && bounds.size.length() > 0) {
      currentGCodeBounds = bounds; // Store bounds for later use
      fitCameraToBounds(bounds);

      // Emit view change to update UI
      emit('change-view', 'iso');
    }

    hasFile.value = true;

    // Set initial visibility for all line types
    gcodeVisualizer.setRapidVisibility(showRapids.value);
    gcodeVisualizer.setCuttingVisibility(showCutting.value);

    // Update axis labels based on G-code bounds
    if (axisLabelsGroup) {
      scene.remove(axisLabelsGroup);
    }
    axisLabelsGroup = createDynamicAxisLabels(bounds);
    scene.add(axisLabelsGroup);

    console.log(`G-code file "${data.filename}" loaded successfully`);
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
  hasFile.value = false;
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

// Control button handlers
const handleCycle = async () => {
  if (!props.loadedGCodeProgram && !isOnHold.value) return;

  try {
    if (isOnHold.value) {
      // Resume job
      await api.controlGCodeJob('resume');
      console.log('Job resumed');
    } else {
      // Start new job
      await api.startGCodeJob(props.loadedGCodeProgram!);
      console.log('Job started:', props.loadedGCodeProgram);
    }
  } catch (error) {
    console.error('Error controlling job:', error);
  }
};

const handlePause = async () => {
  try {
    await api.controlGCodeJob('pause');
    console.log('Job paused');
  } catch (error) {
    console.error('Error pausing job:', error);
  }
};

const handleStop = async () => {
  try {
    await api.stopGCodeJob();
    console.log('Job stopped');
  } catch (error) {
    console.error('Error stopping job:', error);
  }
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

const handleViewButtonClick = (viewType: 'top' | 'front' | 'iso') => {
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
  if (currentGCodeBounds) {
    fitCameraToBounds(currentGCodeBounds, viewType);
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

// Watch for view changes
watch(() => props.view, (newView) => {
  setCameraView(newView);
  // Auto fit to view when changing views with the specific view type
  if (currentGCodeBounds) {
    fitCameraToBounds(currentGCodeBounds, newView);
  }
});

// Watch for theme changes
watch(() => props.theme, () => {
  updateSceneBackground();
});

onMounted(() => {
  initThreeJS();
  window.addEventListener('resize', handleResize);

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
  console.log('Setting up G-code event listeners');
  api.onGCodeUpdated(handleGCodeUpdate);

  // Watch for loadedGCodeProgram changes to handle clearing
  watch(() => props.loadedGCodeProgram, (newValue, oldValue) => {
    if (oldValue && !newValue) {
      // Program was cleared
      handleGCodeClear();
    }
  });

  // Set initial 3D view with Z-up orientation
  setTimeout(() => {
    setCameraView('iso');
    emit('change-view', 'iso');

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
</script>

<style scoped>
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
  align-items: center;
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
  padding: 8px 12px;
  cursor: pointer;
  font-size: 14px;
  background: var(--color-accent);
  color: white;
}

.clear-button {
  background: #ff6b6b;
}

.toggle-button {
  background: #6c757d;
}

.load-button:hover, .clear-button:hover, .toggle-button:hover {
  opacity: 0.8;
}

h2 {
  margin: 0;
}

.view-buttons {
  display: flex;
  gap: var(--gap-xs);
}

.view-button {
  border: none;
  border-radius: var(--radius-small);
  padding: 10px 16px;
  cursor: pointer;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
}

.view-button.active {
  background: var(--gradient-accent);
  color: #fff;
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
  gap: 6px;
  background: transparent;
  padding: 4px 8px;
  border-radius: var(--radius-small);
  font-size: 0.85rem;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.legend-item:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateY(-1px);
}

.legend-item--disabled {
  opacity: 0.5;
}

.legend-item--disabled:hover {
  background: rgba(255, 255, 255, 0.05);
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  transition: all 0.15s ease;
}

.dot--disabled {
  opacity: 0.3;
  filter: grayscale(100%);
}

.dot--rapid {
  background: #0ef6ae;
}

.dot--cutting {
  background: #3e85c7;
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
  padding: 12px 20px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 90px;
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
</style>
