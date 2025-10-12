<template>
  <div ref="containerRef" class="probe-visualizer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import type { WatchStopHandle } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ProbeController } from './visualizers/probe-controller';
import type {
  ProbeType,
  ProbingAxis,
  ProbeCorner,
  ProbeSide,
  SelectionState
} from './visualizers/types';

const props = defineProps<{
  probeType: ProbeType;
  probingAxis: ProbingAxis;
  selectedCorner: string | null;
  selectedSide: string | null;
  probeActive: boolean;
}>();

const emit = defineEmits<{
  cornerSelected: [corner: ProbeCorner | null];
  sideSelected: [side: ProbeSide | null];
}>();

const CORNERS: ProbeCorner[] = ['TopRight', 'TopLeft', 'BottomRight', 'BottomLeft'];
const SIDES: ProbeSide[] = ['Left', 'Right', 'Front', 'Back'];

const containerRef = ref<HTMLElement | null>(null);
const controller = ref<ProbeController | null>(null);
const selectionState = ref<SelectionState>({
  corner: normalizeCorner(props.selectedCorner),
  side: normalizeSide(props.selectedSide)
});

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let controls: OrbitControls | null = null;
let animationFrame = 0;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

const CAMERA_LOG_INTERVAL_MS = 500;
let lastCameraLog = 0;

const getAccentColor = (): number => {
  const accentColorStr = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
  return parseInt(accentColorStr.replace('#', '0x'), 16);
};

const renderScene = () => {
  if (scene && camera && renderer) {
    renderer.render(scene, camera);
  }
};

const resetCamera = () => {
  if (!camera || !controls || !renderer) return;
  camera.position.set(0.06712719516456761, -15.055168073827874, 7.4374412642715955);
  camera.lookAt(0.06712719516456761, 0.44892946315514726, 0.07238395350471344);
  controls.target.set(0.06712719516456761, 0.44892946315514726, 0.07238395350471344);
  controls.update();
  renderScene();
};

const logCameraState = () => {
  if (!camera || !controls) return;
  const now = Date.now();
  if (now - lastCameraLog < CAMERA_LOG_INTERVAL_MS) return;
  lastCameraLog = now;
  console.log('[ProbeVisualizer] Camera', {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z }
  });
};

function normalizeCorner(value: string | null): ProbeCorner | null {
  if (!value || !CORNERS.includes(value as ProbeCorner)) return null;
  return value as ProbeCorner;
}

function normalizeSide(value: string | null): ProbeSide | null {
  if (!value || !SIDES.includes(value as ProbeSide)) return null;
  return value as ProbeSide;
}

function groupToCorner(groupName: string): ProbeCorner | null {
  const normalized = groupName.toLowerCase();
  if (normalized === 'topright') return 'TopRight';
  if (normalized === 'topleft') return 'TopLeft';
  if (normalized === 'bottomright') return 'BottomRight';
  if (normalized === 'bottomleft') return 'BottomLeft';
  return null;
}

function groupToSide(axis: ProbingAxis, groupName: string): ProbeSide | null {
  const normalized = groupName.toLowerCase();
  if (axis === 'X') {
    if (normalized === 'topleft') return 'Left';
    if (normalized === 'bottomleft') return 'Right';
  }
  if (axis === 'Y') {
    if (normalized.includes('bottom')) return 'Front';
    if (normalized.includes('top')) return 'Back';
  }
  return null;
}

const initScene = () => {
  if (!containerRef.value) return;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    45,
    containerRef.value.clientWidth / containerRef.value.clientHeight,
    0.001,
    1000
  );
  camera.position.set(0.06712719516456761, -15.055168073827874, 7.4374412642715955);
  camera.lookAt(0.06712719516456761, 0.44892946315514726, 0.07238395350471344);
  camera.up.set(0, 0, 1);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(containerRef.value.clientWidth, containerRef.value.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  containerRef.value.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 10, 7.5);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-5, 0, -5);

  scene.add(ambientLight);
  scene.add(directionalLight);
  scene.add(fillLight);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enableZoom = true;
  controls.zoomSpeed = 0.1;
  controls.enablePan = true;
  controls.enableRotate = true;
  controls.screenSpacePanning = true;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.DOLLY
  };
  controls.minAzimuthAngle = 0;
  controls.maxAzimuthAngle = 0;
  controls.target.set(0.06712719516456761, 0.44892946315514726, 0.07238395350471344);
  controls.update();
  controls.addEventListener('change', () => {
    logCameraState();
    renderScene();
  });

  renderer.domElement.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    resetCamera();
  });

  renderer.domElement.addEventListener('click', handleCanvasClick);
  renderer.domElement.addEventListener('mousemove', handleCanvasHover);

  const animate = () => {
    animationFrame = requestAnimationFrame(animate);
    controls?.update();
    renderScene();
  };
  animate();

  window.addEventListener('resize', handleResize);
};

const destroyScene = () => {
  window.removeEventListener('resize', handleResize);

  if (renderer) {
    renderer.domElement.removeEventListener('click', handleCanvasClick);
    renderer.domElement.removeEventListener('mousemove', handleCanvasHover);
  }

  cancelAnimationFrame(animationFrame);
  controls?.dispose();
  renderer?.dispose();

  if (scene) {
    scene.clear();
  }

  scene = null;
  camera = null;
  renderer = null;
  controls = null;
};

const initController = () => {
  if (!scene) return;
  controller.value = new ProbeController({
    scene,
    render: renderScene,
    getAccentColor
  });
};

const handleResize = () => {
  if (!containerRef.value || !camera || !renderer) return;
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  renderScene();
};

const handleCanvasClick = (event: MouseEvent) => {
  if (!renderer || !camera || !scene) return;

  const axis = props.probingAxis;
  const supports = controller.value?.getStrategy()?.supports;
  if (!supports) return;

  const interactiveAxes: ProbingAxis[] = ['XYZ', 'XY', 'X', 'Y'];
  if (!interactiveAxes.includes(axis)) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true).filter(i => i.object.visible);
  if (intersects.length === 0) return;

  const groupName = (intersects[0].object.userData.group || '').toString();
  const lowerName = groupName.toLowerCase();

  if (['XYZ', 'XY'].includes(axis) && supports.corners) {
    const corner = groupToCorner(lowerName);
    if (corner) {
      selectionState.value.corner = corner;
      controller.value?.handleCornerChange(axis, corner);
      emit('cornerSelected', corner);
      renderScene();
      return;
    }
  }

  if ((axis === 'X' || axis === 'Y') && supports.sides.includes(axis)) {
    const side = groupToSide(axis, lowerName);
    if (side) {
      selectionState.value.side = side;
      controller.value?.handleSideChange(axis, side);
      emit('sideSelected', side);
      renderScene();
    }
  }
};

const handleCanvasHover = (event: MouseEvent) => {
  if (!renderer || !camera || !scene) return;

  const axis = props.probingAxis;
  const supports = controller.value?.getStrategy()?.supports;
  if (!supports) {
    renderer.domElement.style.cursor = 'default';
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children, true).filter(i => i.object.visible);
  if (intersects.length === 0) {
    renderer.domElement.style.cursor = 'default';
    return;
  }

  const groupName = (intersects[0].object.userData.group || '').toString();
  const lowerName = groupName.toLowerCase();

  const cornerHover = ['XYZ', 'XY'].includes(axis) && supports.corners && !!groupToCorner(lowerName);
  const sideHover = (axis === 'X' || axis === 'Y') && supports.sides.includes(axis) && !!groupToSide(axis, lowerName);

  renderer.domElement.style.cursor = cornerHover || sideHover ? 'pointer' : 'default';
};

let stopTypeAxisWatch: WatchStopHandle | null = null;
let stopCornerWatch: WatchStopHandle | null = null;
let stopSideWatch: WatchStopHandle | null = null;
let stopActiveWatch: WatchStopHandle | null = null;

onMounted(() => {
  initScene();
  initController();

  if (!controller.value) return;

  stopTypeAxisWatch = watch(
    () => [props.probeType, props.probingAxis] as const,
    ([type, axis]) => {
      if (!controller.value) return;
      controller.value
        .setProbeType(type as ProbeType, axis as ProbingAxis, selectionState.value)
        .then(() => {
          if (!controller.value) return;
          if (selectionState.value.corner) {
            controller.value.handleCornerChange(axis as ProbingAxis, selectionState.value.corner);
          }
          if (selectionState.value.side) {
            controller.value.handleSideChange(axis as ProbingAxis, selectionState.value.side);
          }
        })
        .catch((error) => {
          console.error('[ProbeVisualizer] Failed to set probe type', error);
        });
    },
    { immediate: true }
  );

  stopCornerWatch = watch(
    () => props.selectedCorner,
    (value) => {
      const corner = normalizeCorner(value);
      selectionState.value.corner = corner;
      if (!controller.value) return;
      controller.value.handleCornerChange(props.probingAxis, corner);
    }
  );

  stopSideWatch = watch(
    () => props.selectedSide,
    (value) => {
      const side = normalizeSide(value);
      selectionState.value.side = side;
      if (!controller.value) return;
      controller.value.handleSideChange(props.probingAxis, side ?? null);
    }
  );

  stopActiveWatch = watch(
    () => props.probeActive,
    (isActive) => {
      controller.value?.handleProbeActiveChange(isActive);
    },
    { immediate: true }
  );
});

onUnmounted(() => {
  stopTypeAxisWatch?.();
  stopCornerWatch?.();
  stopSideWatch?.();
  stopActiveWatch?.();
  controller.value?.dispose();
  controller.value = null;
  destroyScene();
});
</script>

<style scoped>
.probe-visualizer {
  width: 100%;
  height: 200px;
  position: relative;
}

.probe-visualizer canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
