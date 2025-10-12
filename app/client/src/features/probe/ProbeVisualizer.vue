<template>
  <div ref="containerRef" class="probe-visualizer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { hideGroup, showGroup, applyToGroup, setGroupColor } from './probe-mesh-utils';
import { loadOBJWithGroups } from './custom-obj-loader';

const props = defineProps<{
  probeType: '3d-probe' | 'standard-block' | 'autozero-touch';
  probingAxis: string;
  selectedCorner: string | null;
  selectedSide: string | null;
  probeActive: boolean;
}>();

const emit = defineEmits<{
  cornerSelected: [corner: string | null];
  sideSelected: [side: string | null];
}>();

const containerRef = ref<HTMLElement>();
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let probeModel: THREE.Group | null = null;
let plateModel: THREE.Group | null = null;
const blinkIntervals = ref<number[]>([]);
let selectedCorner: string | null = null;
let glowInterval: number | null = null;
let isLoadingPlate = false;
let currentPlateFile = '';

// Probe scale mapping by probe type
const PROBE_SCALE_MAP: Record<string, number> = {
  '3d-touch': 1,
  'standard-block': 200,
  'autozero-touch': 1
};

// AutoZero Touch probe position - adjust these values to move the probe
// These are in scaled units (after plate scaling to 10 units)
const AUTOZERO_TOUCH_X_OFFSET = -3;  // Left/right offset from center
const AUTOZERO_TOUCH_Y_OFFSET = -3;   // Front/back offset from center
const AUTOZERO_TOUCH_Z_POSITION = -1; // Up/down position above plate

// Get accent color from CSS variable
const getAccentColor = (): number => {
  const accentColorStr = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
  return parseInt(accentColorStr.replace('#', '0x'), 16);
};

// Reset camera to default view
const resetCamera = () => {
  if (!camera || !controls || !renderer) return;
  camera.position.set(-0.010274938767900303, -15.991323668275516, 9.326571667593097);
  camera.lookAt(-0.010274938767900303, 0.43934016042830804, 0.3383532720640545);
  controls.target.set(-0.010274938767900303, 0.43934016042830804, 0.3383532720640545);
  controls.update();
  renderer.render(scene, camera);
};

// Start glowing effect for edge groups
const startEdgeGlow = (groupName: string) => {
  if (!plateModel) return;

  // Clear any existing glow interval
  if (glowInterval) {
    clearInterval(glowInterval);
  }

  let increasing = true;
  let opacity = 0.3;
  const step = 0.05;

  glowInterval = window.setInterval(() => {
    if (increasing) {
      opacity += step;
      if (opacity >= 1.0) {
        opacity = 1.0;
        increasing = false;
      }
    } else {
      opacity -= step;
      if (opacity <= 0.3) {
        opacity = 0.3;
        increasing = true;
      }
    }

    applyToGroup(plateModel!, groupName, (mesh) => {
      if (mesh.material) {
        mesh.material.transparent = true;
        mesh.material.opacity = opacity;
        mesh.material.emissive = new THREE.Color(getAccentColor());
        mesh.material.emissiveIntensity = opacity;
      }
    });

    if (renderer) {
      renderer.render(scene, camera);
    }
  }, 50);
};

// Stop glowing effect
const stopEdgeGlow = () => {
  if (glowInterval) {
    clearInterval(glowInterval);
    glowInterval = null;
  }
};

const initScene = () => {
  if (!containerRef.value) return;

  // Scene setup
  scene = new THREE.Scene();
  // No background (transparent)

  // Camera setup with front perspective view (Z-up, looking along Y-axis)
  const aspect = containerRef.value.clientWidth / containerRef.value.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.001, 1000);
  camera.position.set(0, -27.026769063068528, 9.428525574214994);
  camera.lookAt(0, -0.5914934468668256, -2.038781781675869);
  camera.up.set(0, 0, 1);

  // Renderer setup with transparent background
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(containerRef.value.clientWidth, containerRef.value.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  containerRef.value.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 10, 7.5);
  scene.add(directionalLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-5, 0, -5);
  scene.add(fillLight);

  // OrbitControls for mouse interaction
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enableZoom = true;
  controls.zoomSpeed = 0.1;
  controls.enablePan = true;
  controls.enableRotate = true;
  controls.screenSpacePanning = true; // Enable screen space panning for Z-axis

  // Change mouse button mappings: middle button for pan, right button for zoom
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.DOLLY
  };

  // Lock horizontal rotation - only allow vertical (X-axis) rotation
  controls.minAzimuthAngle = 0;
  controls.maxAzimuthAngle = 0;

  // Set camera target
  controls.target.set(0, -0.5914934468668256, -2.038781781675869);
  controls.update();

  // Add click and hover handlers for interactive corners
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  renderer.domElement.addEventListener('click', (event) => {
    if (!['XYZ', 'XY', 'X', 'Y'].includes(props.probingAxis)) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(scene.children, true);
    // Filter out hidden/invisible objects
    const visibleIntersects = intersects.filter(i => i.object.visible);

    if (visibleIntersects.length > 0) {
      const clickedObject = visibleIntersects[0].object;
      const groupName = clickedObject.userData.group?.toLowerCase() || '';

      // Handle X axis - clicking on sides
      // AutoZero Touch is axis-independent and doesn't respond to clicks
      if (props.probingAxis === 'X' && plateModel && props.probeType !== 'autozero-touch') {
        let sideGroup: string | null = null;
        let visualSide: 'Left' | 'Right' | null = null;

        // plate-xy.txt has BottomLeft and TopLeft groups
        // After 90-degree rotation: BottomLeft -> visual Right, TopLeft -> visual Left
        if (groupName === 'bottomleft') {
          sideGroup = 'BottomLeft';
          visualSide = 'Right';
        } else if (groupName === 'topleft') {
          sideGroup = 'TopLeft';
          visualSide = 'Left';
        }

        if (sideGroup && visualSide) {
          // Reset previously selected sides to dark gray
          setGroupColor(plateModel, 'BottomLeft', 0x555555);
          setGroupColor(plateModel, 'TopLeft', 0x555555);

          // Highlight the clicked side
          setGroupColor(plateModel, sideGroup, getAccentColor());

          // Move probe to selected side - outside and lower Z
          if (probeModel && plateModel) {
            const plateBBox = new THREE.Box3().setFromObject(plateModel);
            const plateMin = plateBBox.min;
            const plateMax = plateBBox.max;

            // Position probe outside the selected side (after rotation)
            if (visualSide === 'Left') {
              probeModel.position.x = plateMin.x - 2; // Outside left side
            } else if (visualSide === 'Right') {
              probeModel.position.x = plateMax.x + 2; // Outside right side
            }
            probeModel.position.y = 0; // Center on Y axis
            probeModel.position.z = 1; // Lower Z
          }

          // Emit side selection to parent
          emit('sideSelected', visualSide);

          if (renderer) {
            renderer.render(scene, camera);
          }
        }
      }
      // Handle Y axis - clicking on sides (front or back group)
      // AutoZero Touch is axis-independent and doesn't respond to clicks
      else if (props.probingAxis === 'Y' && plateModel && props.probeType !== 'autozero-touch') {
        let sideGroup: string | null = null;
        let visualSide: 'Front' | 'Back' | null = null;

        // plate-xy.txt has BottomLeft and TopLeft groups
        // BottomLeft represents the front/bottom side, TopLeft represents the back/top side
        if (groupName.includes('bottom')) {
          sideGroup = 'BottomLeft';
          visualSide = 'Front';
        } else if (groupName.includes('top')) {
          sideGroup = 'TopLeft';
          visualSide = 'Back';
        }

        if (sideGroup && visualSide) {
          // Reset previously selected sides to dark gray
          setGroupColor(plateModel, 'BottomLeft', 0x555555);
          setGroupColor(plateModel, 'TopLeft', 0x555555);

          // Highlight the clicked side
          setGroupColor(plateModel, sideGroup, getAccentColor());

          // Move probe to selected side - outside and lower Z
          if (probeModel && plateModel) {
            const plateBBox = new THREE.Box3().setFromObject(plateModel);
            const plateMin = plateBBox.min;
            const plateMax = plateBBox.max;

            // Position probe outside the selected side
            if (visualSide === 'Front') {
              probeModel.position.y = plateMin.y - 2; // Outside front side
            } else if (visualSide === 'Back') {
              probeModel.position.y = plateMax.y + 2; // Outside back side
            }
            probeModel.position.x = 0; // Center on X axis
            probeModel.position.z = 1; // Lower Z
          }

          // Emit side selection to parent (separate event, won't affect selectedCorner)
          emit('sideSelected', visualSide);

          if (renderer) {
            renderer.render(scene, camera);
          }
        }
      }
      // Handle XYZ/XY - clicking on corners
      else if (['XYZ', 'XY'].includes(props.probingAxis) && plateModel) {
        // Check if clicked on a corner (TopRight, TopLeft, BottomRight, BottomLeft)
        const isCorner = ['topright', 'topleft', 'bottomright', 'bottomleft'].includes(groupName);

        if (isCorner) {
          // Reset previously selected corner to darker gray
          if (selectedCorner) {
            setGroupColor(plateModel, selectedCorner, 0x555555);
          }

          // Change clicked corner to accent color
          selectedCorner = clickedObject.userData.group;
          setGroupColor(plateModel, selectedCorner, getAccentColor());

          // Emit corner selection to parent
          emit('cornerSelected', selectedCorner);

          if (probeModel && plateModel) {
            // AutoZero Touch stays in fixed position (axis-independent)
            if (props.probeType === 'autozero-touch') {
              // Corner highlighting happens but probe doesn't move
              console.log('[ProbeVisualizer] AutoZero Touch - corner selected but probe stays in place:', selectedCorner);
            }
            // Other probes: move to corner position
            else {
              // Get the bounding box of the plate to find corner positions
              const plateBBox = new THREE.Box3().setFromObject(plateModel);
              const plateMin = plateBBox.min;
              const plateMax = plateBBox.max;

              // Determine corner position based on corner name
              const cornerName = selectedCorner.toLowerCase();
              let targetX = 0, targetY = 0;

              // Inset amount - negative for XY (more outer), positive for XYZ (more inner)
              const inset = props.probingAxis === 'XY' ? -1 : 2;

              // No rotation applied, so corner names match visual positions directly
              if (cornerName.includes('bottom') && cornerName.includes('right')) {
                targetX = plateMax.x - inset;
                targetY = plateMin.y + inset;
              } else if (cornerName.includes('bottom') && cornerName.includes('left')) {
                targetX = plateMin.x + inset;
                targetY = plateMin.y + inset;
              } else if (cornerName.includes('top') && cornerName.includes('right')) {
                targetX = plateMax.x - inset;
                targetY = plateMax.y - inset;
              } else if (cornerName.includes('top') && cornerName.includes('left')) {
                targetX = plateMin.x + inset;
                targetY = plateMax.y - inset;
              }

              // Move probe to corner position
              probeModel.position.x = targetX;
              probeModel.position.y = targetY;
              // Set Z height based on mode and probe type
              if (props.probeType === 'standard-block') {
                const scaledProbeBBox = new THREE.Box3().setFromObject(probeModel);
                const scaledProbeSize = scaledProbeBBox.getSize(new THREE.Vector3());
                probeModel.position.z = props.probingAxis === 'XY' ? scaledProbeSize.z / 2 - 1 : scaledProbeSize.z / 2;
              } else {
                probeModel.position.z = props.probingAxis === 'XY' ? 1 : 4;
              }
            }
          }

          if (renderer) {
            renderer.render(scene, camera);
          }
        }
      }
    }
  });

  renderer.domElement.addEventListener('mousemove', (event) => {
    // AutoZero Touch only responds to corner clicks in XYZ/XY modes, not X/Y side clicks
    if (!['XYZ', 'XY', 'X', 'Y'].includes(props.probingAxis)) {
      renderer.domElement.style.cursor = 'default';
      return;
    }

    // For AutoZero Touch in X/Y modes, no interaction
    if (props.probeType === 'autozero-touch' && ['X', 'Y'].includes(props.probingAxis)) {
      renderer.domElement.style.cursor = 'default';
      return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(scene.children, true);
    // Filter out hidden/invisible objects
    const visibleIntersects = intersects.filter(i => i.object.visible);

    if (visibleIntersects.length > 0) {
      const hoveredObject = visibleIntersects[0].object;
      const groupName = hoveredObject.userData.group?.toLowerCase() || '';

      // Show pointer for corners (XYZ/XY mode) or sides (X/Y modes)
      const isCornerHover = ['topright', 'topleft', 'bottomright', 'bottomleft'].includes(groupName) && ['XYZ', 'XY'].includes(props.probingAxis);
      const isXSideHover = props.probingAxis === 'X' && (groupName.includes('left') || groupName.includes('right'));
      const isYSideHover = props.probingAxis === 'Y' && (groupName.includes('bottom') || groupName.includes('top'));

      if (isCornerHover || isXSideHover || isYSideHover) {
        renderer.domElement.style.cursor = 'pointer';
      } else {
        renderer.domElement.style.cursor = 'default';
      }
    } else {
      renderer.domElement.style.cursor = 'default';
    }
  });

  let lastLogTime = 0;
  controls.addEventListener('change', () => {
    const now = Date.now();
    if (now - lastLogTime > 500) { // Log every 500ms max
      console.log('[CAMERA] Position:', JSON.stringify({x: camera.position.x, y: camera.position.y, z: camera.position.z}));
      console.log('[CAMERA] Target:', JSON.stringify({x: controls.target.x, y: controls.target.y, z: controls.target.z}));
      lastLogTime = now;
    }
    renderer.render(scene, camera);
  });

  // Reset view on right click
  renderer.domElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    resetCamera();
  });

  // Load probe model
  loadProbeModel();

  // Animation loop for controls damping
  const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();
};

const loadProbeModel = async () => {
  // Remove existing models if any
  if (probeModel) {
    scene.remove(probeModel);
    probeModel = null;
  }
  if (plateModel) {
    scene.remove(plateModel);
    plateModel = null;
  }

  // Determine which probe model to load based on probe type
  let modelName = '3dprobe';
  let modelPath = '/assets/probe/3d-probe/';

  if (props.probeType === 'standard-block') {
    modelName = 'cnc-pointer';
    modelPath = '/assets/probe/standard-block/';
  } else if (props.probeType === 'autozero-touch') {
    modelName = 'cnc-pointer';
    modelPath = '/assets/probe/auto-touch/';
  }

  const cacheBust = `?t=${Date.now()}`;

  try {
    const object = await loadOBJWithGroups(
      `${modelName}.txt${cacheBust}`,
      `${modelName}.mtl${cacheBust}`,
      modelPath
    );

    probeModel = object;

    // Ensure materials render both sides
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material) {
          child.material.side = THREE.DoubleSide;
        }
      }
    });

    // Set initial LED color to green (ready state)
    // Try both LED group names (different models use different casing)
    setGroupColor(object, 'Led', 0x00ff00);  // 3dprobe uses 'Led'
    setGroupColor(object, 'LED', 0x00ff00);  // cnc-pointer uses 'LED'

    // Apply custom colors based on probe type
    if (props.probeType === 'standard-block') {
      setGroupColor(object, 'Body', 0xe8e8e8);
      setGroupColor(object, 'Nut', 0x606060);
    } else if (props.probeType === '3d-probe') {
      setGroupColor(object, 'Body', 0x606060);
    } else if (props.probeType === 'autozero-touch') {
      setGroupColor(object, 'AutoPlate', 0xd3d3d3); // Light gray
    }

    probeModel = object;
    scene.add(object);

    // Load the plate model first to determine scale
    await loadPlateModel();

    // Now apply scaling to both probe and plate based on plate size
    if (plateModel && probeModel) {
      const plateBBox = new THREE.Box3().setFromObject(plateModel);
      const plateCenter = plateBBox.getCenter(new THREE.Vector3());
      const plateSize = plateBBox.getSize(new THREE.Vector3());

      // Scale based on plate, not probe
      const maxDim = Math.max(plateSize.x, plateSize.y, plateSize.z);
      const scale = 10 / maxDim; // Scale to 10 units
      console.log('[ProbeVisualizer] Scale:', scale);

      // Center and scale plate
      plateModel.position.sub(plateCenter);
      plateModel.scale.multiplyScalar(scale);
      plateModel.position.z += 3;

      // Center and scale probe
      const probeBBox = new THREE.Box3().setFromObject(probeModel);
      const probeCenter = probeBBox.getCenter(new THREE.Vector3());
      probeModel.position.sub(probeCenter);
      const probeScaleMultiplier = PROBE_SCALE_MAP[props.probeType] || 1;
      const probeScale = probeScaleMultiplier === 1 ? scale : probeScaleMultiplier;
      probeModel.scale.multiplyScalar(probeScale);

      // Calculate Z offset based on scaled probe height for standard-block
      if (props.probeType === 'standard-block') {
        const scaledProbeBBox = new THREE.Box3().setFromObject(probeModel);
        const scaledProbeSize = scaledProbeBBox.getSize(new THREE.Vector3());
        probeModel.position.z += scaledProbeSize.z / 2 ;
      } else if (props.probeType === 'autozero-touch') {
        // AutoZero Touch: position lower on the plate
        console.log('[ProbeVisualizer] Initial load - AutoZero Touch positioning');
        probeModel.position.x = AUTOZERO_TOUCH_X_OFFSET;
        probeModel.position.y = AUTOZERO_TOUCH_Y_OFFSET;
        probeModel.position.z = AUTOZERO_TOUCH_Z_POSITION;
        console.log('[ProbeVisualizer] After position adjustment:', JSON.stringify({x: probeModel.position.x, y: probeModel.position.y, z: probeModel.position.z}));
      } else {
        probeModel.position.z += 4;
      }

      // Rotate plate for X mode after scaling
      if (props.probingAxis === 'X') {
        plateModel.rotation.z = Math.PI / 2;
      }
    }

    // Update camera to view the scaled model
    resetCamera();

    // Apply saved corner selection after models are loaded
    if (['XYZ', 'XY'].includes(props.probingAxis) && props.selectedCorner && plateModel && probeModel) {
      selectedCorner = props.selectedCorner;
      setGroupColor(plateModel, props.selectedCorner, getAccentColor());

      // AutoZero Touch stays in fixed position (axis-independent)
      if (props.probeType === 'autozero-touch') {
        // Corner highlighting happens but probe doesn't move
        console.log('[ProbeVisualizer] Initial load - AutoZero Touch stays in place:', props.selectedCorner);
      }
      // Other probes: move to saved corner position
      else {
        const plateBBox = new THREE.Box3().setFromObject(plateModel);
        const plateMin = plateBBox.min;
        const plateMax = plateBBox.max;
        const cornerName = props.selectedCorner.toLowerCase();
        const inset = props.probingAxis === 'XY' ? -1 : 2;
        let targetX = 0, targetY = 0;

        if (cornerName.includes('bottom') && cornerName.includes('right')) {
          targetX = plateMax.x - inset;
          targetY = plateMin.y + inset;
        } else if (cornerName.includes('bottom') && cornerName.includes('left')) {
          targetX = plateMin.x + inset;
          targetY = plateMin.y + inset;
        } else if (cornerName.includes('top') && cornerName.includes('right')) {
          targetX = plateMax.x - inset;
          targetY = plateMax.y - inset;
        } else if (cornerName.includes('top') && cornerName.includes('left')) {
          targetX = plateMin.x + inset;
          targetY = plateMax.y - inset;
        }

        probeModel.position.x = targetX;
        probeModel.position.y = targetY;
        if (props.probeType === 'standard-block') {
          const scaledProbeBBox = new THREE.Box3().setFromObject(probeModel);
          const scaledProbeSize = scaledProbeBBox.getSize(new THREE.Vector3());
          probeModel.position.z = props.probingAxis === 'XY' ? scaledProbeSize.z / 2 - 1 : scaledProbeSize.z / 2;
        } else {
          probeModel.position.z = props.probingAxis === 'XY' ? 1 : 4;
        }
      }
    }

    // Position probe for Center modes
    // AutoZero Touch doesn't respond to mode changes
    if (['Center - Inner', 'Center - Outer'].includes(props.probingAxis) && probeModel && props.probeType !== 'autozero-touch') {
      const zPosition = props.probingAxis === 'Center - Inner' ? 0 : 4;
      probeModel.position.set(0, 0, zPosition);
    }

    // Re-render after model is loaded
    if (renderer) {
      renderer.render(scene, camera);
    }
  } catch (error) {
    console.error('[CUSTOM_OBJ] Error loading probe model:', error);
  }
};

const loadPlateModel = async () => {
  const cacheBust = `?t=${Date.now()}`;

  // Determine which plate model to load based on probing axis
  let plateFile = 'plate-solid.txt';
  if (['XYZ', 'XY'].includes(props.probingAxis)) {
    plateFile = 'plate-xyz.txt';
  } else if (['X', 'Y'].includes(props.probingAxis)) {
    plateFile = 'plate-xy.txt';
  } else if (props.probingAxis === 'Center - Inner') {
    plateFile = 'plate-hole.txt';
  } else if (props.probingAxis === 'Center - Outer') {
    plateFile = 'plate-solid.txt';
  }

  currentPlateFile = plateFile;

  try {
    const object = await loadOBJWithGroups(
      `${plateFile}${cacheBust}`,
      `plate.mtl${cacheBust}`,
      '/assets/probe/3d-probe/'
    );

    plateModel = object;

    // Set all plate parts to wood color
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material) {
          child.material.side = THREE.DoubleSide;
          child.material.color.setHex(0xDEB887); // Burlywood - lighter wood tone
        }
      }
    });

    // For plate-xyz.txt, color the corners dark gray (clickable indicator)
    if (plateFile === 'plate-xyz.txt') {
      setGroupColor(object, 'TopRight', 0x555555);
      setGroupColor(object, 'TopLeft', 0x555555);
      setGroupColor(object, 'BottomRight', 0x555555);
      setGroupColor(object, 'BottomLeft', 0x555555);
    }

    // For plate-xy.txt, color the sides dark gray (clickable indicator)
    if (plateFile === 'plate-xy.txt') {
      setGroupColor(object, 'BottomLeft', 0x555555);
      setGroupColor(object, 'TopLeft', 0x555555);
    }

    scene.add(object);

    // Re-render after plate is loaded
    if (renderer) {
      renderer.render(scene, camera);
    }
  } catch (error) {
    console.error('[CUSTOM_OBJ] Error loading plate model:', error);
  }
};

const handleResize = () => {
  if (!containerRef.value || !camera || !renderer) return;

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
};

// Watch for probe type changes
watch(() => props.probeType, () => {
  loadProbeModel();
});

// Watch for probe active state changes to update LED color
watch(() => props.probeActive, (isActive) => {
  if (probeModel) {
    // Red when active (triggered), Green when inactive (ready)
    const ledColor = isActive ? 0xff0000 : 0x00ff00;

    // Try both LED group names (different models use different casing)
    setGroupColor(probeModel, 'Led', ledColor);  // 3dprobe uses 'Led'
    setGroupColor(probeModel, 'LED', ledColor);  // cnc-pointer uses 'LED'

    if (renderer) {
      renderer.render(scene, camera);
    }
  }
});

// Watch for selected corner prop changes (from settings)
watch(() => props.selectedCorner, (newCorner) => {
  if (plateModel && newCorner && ['XYZ', 'XY'].includes(props.probingAxis)) {
    // Reset all corners to default color
    setGroupColor(plateModel, 'TopRight', 0x555555);
    setGroupColor(plateModel, 'TopLeft', 0x555555);
    setGroupColor(plateModel, 'BottomRight', 0x555555);
    setGroupColor(plateModel, 'BottomLeft', 0x555555);

    // Set the loaded corner to accent color
    selectedCorner = newCorner;
    setGroupColor(plateModel, newCorner, getAccentColor());

    if (probeModel) {
      // AutoZero Touch stays in fixed position (axis-independent)
      if (props.probeType === 'autozero-touch') {
        // Corner highlighting happens but probe doesn't move
        console.log('[ProbeVisualizer] Corner watcher - AutoZero Touch stays in place:', newCorner);
      }
      // Other probes: move to corner position
      else {
        const plateBBox = new THREE.Box3().setFromObject(plateModel);
        const plateMin = plateBBox.min;
        const plateMax = plateBBox.max;
        const cornerName = newCorner.toLowerCase();
        const inset = props.probingAxis === 'XY' ? -1 : 2;
        let targetX = 0, targetY = 0;

        if (cornerName.includes('bottom') && cornerName.includes('right')) {
          targetX = plateMax.x - inset;
          targetY = plateMin.y + inset;
        } else if (cornerName.includes('bottom') && cornerName.includes('left')) {
          targetX = plateMin.x + inset;
          targetY = plateMin.y + inset;
        } else if (cornerName.includes('top') && cornerName.includes('right')) {
          targetX = plateMax.x - inset;
          targetY = plateMax.y - inset;
        } else if (cornerName.includes('top') && cornerName.includes('left')) {
          targetX = plateMin.x + inset;
          targetY = plateMax.y - inset;
        }

        probeModel.position.x = targetX;
        probeModel.position.y = targetY;
        if (props.probeType === 'standard-block') {
          const scaledProbeBBox = new THREE.Box3().setFromObject(probeModel);
          const scaledProbeSize = scaledProbeBBox.getSize(new THREE.Vector3());
          probeModel.position.z = props.probingAxis === 'XY' ? scaledProbeSize.z / 2 - 1 : scaledProbeSize.z / 2;
        } else {
          probeModel.position.z = props.probingAxis === 'XY' ? 1 : 4;
        }
      }
    }

    if (renderer) {
      renderer.render(scene, camera);
    }
  }
});

// Watch for probing axis changes
watch(() => props.probingAxis, async () => {
  // Determine which plate file should be loaded
  let requiredPlateFile = 'plate-solid.txt';
  if (['XYZ', 'XY'].includes(props.probingAxis)) {
    requiredPlateFile = 'plate-xyz.txt';
  } else if (['X', 'Y'].includes(props.probingAxis)) {
    requiredPlateFile = 'plate-xy.txt';
  } else if (props.probingAxis === 'Center - Inner') {
    requiredPlateFile = 'plate-hole.txt';
  } else if (props.probingAxis === 'Center - Outer') {
    requiredPlateFile = 'plate-solid.txt';
  }

  // Check if the correct plate is already loaded
  // For X/Y modes, we need to reload because rotation is different
  if (currentPlateFile === requiredPlateFile && plateModel && !['X', 'Y'].includes(props.probingAxis)) {
    // Reset probe to center for Z, Center - Inner, Center - Outer, X, and Y modes
    // AutoZero Touch is axis-independent and doesn't respond to mode changes
    if (['Z', 'Center - Inner', 'Center - Outer', 'X', 'Y'].includes(props.probingAxis) && probeModel && props.probeType !== 'autozero-touch') {
      const zPosition = props.probingAxis === 'Center - Inner' ? 0 : 4;
      probeModel.position.set(0, 0, zPosition);
      if (renderer) {
        renderer.render(scene, camera);
      }
    }

    // Start glow animation for Center - Inner mode
    if (props.probingAxis === 'Center - Inner') {
      startEdgeGlow('InnerEdge');
    } else {
      // Stop glow when switching away from Center - Inner
      stopEdgeGlow();
    }

          // Update probe position for XYZ/XY modes (same plate, but different inset/Z)
          // AutoZero Touch is axis-independent and doesn't respond to corner selection
          if (['XYZ', 'XY'].includes(props.probingAxis) && props.selectedCorner && probeModel && props.probeType !== 'autozero-touch') {
            const plateBBox = new THREE.Box3().setFromObject(plateModel);
            const plateMin = plateBBox.min;
            const plateMax = plateBBox.max;
            const cornerName = props.selectedCorner.toLowerCase();
            const inset = props.probingAxis === 'XY' ? -1 : 2;
            let targetX = 0, targetY = 0;

            if (cornerName.includes('bottom') && cornerName.includes('right')) {
              targetX = plateMax.x - inset;
              targetY = plateMin.y + inset;
            } else if (cornerName.includes('bottom') && cornerName.includes('left')) {
              targetX = plateMin.x + inset;
              targetY = plateMin.y + inset;
            } else if (cornerName.includes('top') && cornerName.includes('right')) {
              targetX = plateMax.x - inset;
              targetY = plateMax.y - inset;
            } else if (cornerName.includes('top') && cornerName.includes('left')) {
              targetX = plateMin.x + inset;
              targetY = plateMax.y - inset;
            }
      probeModel.position.x = targetX;
      probeModel.position.y = targetY;
      if (props.probeType === 'standard-block') {
        const scaledProbeBBox = new THREE.Box3().setFromObject(probeModel);
        const scaledProbeSize = scaledProbeBBox.getSize(new THREE.Vector3());
        probeModel.position.z = props.probingAxis === 'XY' ? scaledProbeSize.z / 2 - 1 : scaledProbeSize.z / 2;
      } else {
        probeModel.position.z = props.probingAxis === 'XY' ? 1 : 4;
      }

      if (renderer) {
        renderer.render(scene, camera);
      }
    }

    return;
  }

  // Prevent concurrent plate loading
  if (isLoadingPlate) {
    return;
  }

  // Reload plate model when switching between modes
  if (probeModel && scene) {
    isLoadingPlate = true;

    // Remove old plate model if it exists
    if (plateModel) {
      scene.remove(plateModel);

      // Dispose of old geometry and materials
      plateModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });

      plateModel = null;
    }

    // Reload plate model
    await loadPlateModel();

    // Reapply scaling based on plate
    if (plateModel && probeModel) {
      // Reset scale and rotation first
      plateModel.scale.set(1, 1, 1);
      plateModel.rotation.set(0, 0, 0);
      probeModel.scale.set(1, 1, 1);

      const plateBBox = new THREE.Box3().setFromObject(plateModel);
      const plateCenter = plateBBox.getCenter(new THREE.Vector3());
      const plateSize = plateBBox.getSize(new THREE.Vector3());

      const maxDim = Math.max(plateSize.x, plateSize.y, plateSize.z);
      const scale = 10 / maxDim;

      // Center and scale plate
      plateModel.position.sub(plateCenter);
      plateModel.scale.multiplyScalar(scale);
      plateModel.position.z += 3;

      // Center and scale probe
      const probeBBox = new THREE.Box3().setFromObject(probeModel);
      const probeCenter = probeBBox.getCenter(new THREE.Vector3());
      probeModel.position.sub(probeCenter);
      const probeScaleMultiplier = PROBE_SCALE_MAP[props.probeType] || 1;
      const probeScale = probeScaleMultiplier === 1 ? scale : probeScaleMultiplier;
      probeModel.scale.multiplyScalar(probeScale);

      // Set Z position based on probing axis and probe type
      if (props.probeType === 'standard-block') {
        const scaledProbeBBox = new THREE.Box3().setFromObject(probeModel);
        const scaledProbeSize = scaledProbeBBox.getSize(new THREE.Vector3());
        const zOffset = scaledProbeSize.z / 2;
        probeModel.position.z += zOffset;
      } else if (props.probeType === 'autozero-touch') {
        // AutoZero Touch: position lower on the plate
        console.log('[ProbeVisualizer] Axis watcher - AutoZero Touch positioning');
        probeModel.position.x = AUTOZERO_TOUCH_X_OFFSET;
        probeModel.position.y = AUTOZERO_TOUCH_Y_OFFSET;
        probeModel.position.z = AUTOZERO_TOUCH_Z_POSITION;
        console.log('[ProbeVisualizer] After position adjustment:', JSON.stringify({x: probeModel.position.x, y: probeModel.position.y, z: probeModel.position.z}));
      } else {
        let zOffset = 4;
        if (props.probingAxis === 'Center - Inner') {
          zOffset = 2;
        }
        probeModel.position.z += zOffset;
      }

      // Rotate plate for X mode after scaling
      if (props.probingAxis === 'X') {
        plateModel.rotation.z = Math.PI / 2;
      }
    }

    isLoadingPlate = false;

    // After loading plate, apply mode-specific settings
    if (plateModel && probeModel) {
      // Reset probe to center for Z, Center - Inner, Center - Outer, X, and Y modes
      // AutoZero Touch is axis-independent and doesn't respond to mode changes
      if (['Z', 'Center - Inner', 'Center - Outer', 'X', 'Y'].includes(props.probingAxis) && props.probeType !== 'autozero-touch') {
        probeModel.position.x = 0;
        probeModel.position.y = 0;
      }

      // Start glow animation for Center - Inner mode
      if (props.probingAxis === 'Center - Inner') {
        startEdgeGlow('InnerEdge');
      } else {
        // Stop glow when switching away from Center - Inner
        stopEdgeGlow();
      }

      // Restore corner highlight for XYZ/XY modes
      // AutoZero Touch is axis-independent and doesn't respond to corner selection
      if (['XYZ', 'XY'].includes(props.probingAxis) && props.selectedCorner && props.probeType !== 'autozero-touch') {
        setGroupColor(plateModel, props.selectedCorner, getAccentColor());

        // Also move probe to saved corner position
        const plateBBox = new THREE.Box3().setFromObject(plateModel);
        const plateMin = plateBBox.min;
        const plateMax = plateBBox.max;
        const cornerName = props.selectedCorner.toLowerCase();
        const inset = props.probingAxis === 'XY' ? -1 : 2;
        let targetX = 0, targetY = 0;

        if (cornerName.includes('bottom') && cornerName.includes('right')) {
          targetX = plateMax.x - inset;
          targetY = plateMin.y + inset;
        } else if (cornerName.includes('bottom') && cornerName.includes('left')) {
          targetX = plateMin.x + inset;
          targetY = plateMin.y + inset;
        } else if (cornerName.includes('top') && cornerName.includes('right')) {
          targetX = plateMax.x - inset;
          targetY = plateMax.y - inset;
        } else if (cornerName.includes('top') && cornerName.includes('left')) {
          targetX = plateMin.x + inset;
          targetY = plateMax.y - inset;
        }

        probeModel.position.x = targetX;
        probeModel.position.y = targetY;

        // Set Z based on probe type and axis
        if (props.probeType === 'standard-block') {
          const scaledProbeBBox = new THREE.Box3().setFromObject(probeModel);
          const scaledProbeSize = scaledProbeBBox.getSize(new THREE.Vector3());
          probeModel.position.z = props.probingAxis === 'XY' ? scaledProbeSize.z / 2 - 1 : scaledProbeSize.z / 2;
        } else {
          probeModel.position.z = props.probingAxis === 'XY' ? 1 : 4;
        }
      }
    }

    // Force render after reload
    if (renderer && camera) {
      renderer.render(scene, camera);
    }
  }
});

onMounted(() => {
  initScene();
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);

  // Clear all blink intervals
  blinkIntervals.value.forEach(id => clearInterval(id));

  // Clear glow interval
  stopEdgeGlow();

  if (controls) {
    controls.dispose();
  }
  if (renderer) {
    renderer.dispose();
  }
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
