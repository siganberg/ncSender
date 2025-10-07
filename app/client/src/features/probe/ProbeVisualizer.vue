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
  probeType: '3d-touch' | 'standard-block';
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
let savedProbeCenter: THREE.Vector3 | null = null;
let savedProbeScale: number = 1;

// Get accent color from CSS variable
const getAccentColor = (): number => {
  const accentColorStr = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
  return parseInt(accentColorStr.replace('#', '0x'), 16);
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
  camera.position.set(0.3102797925889344, -35.333541402798375, 11.617066192564842);
  camera.lookAt(0.3102797925889344, -0.18700311367436837, -0.6919443172047409);
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
  controls.enablePan = true;
  controls.enableRotate = true;

  // Lock horizontal rotation - only allow vertical (X-axis) rotation
  controls.minAzimuthAngle = 0;
  controls.maxAzimuthAngle = 0;

  // Set camera target
  controls.target.set(0.3102797925889344, -0.18700311367436837, -0.6919443172047409);
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
      // Log all intersected objects for debugging
      console.log('[CLICK] Visible Intersects:', visibleIntersects.map(i => ({
        group: i.object.userData.group,
        distance: i.distance
      })));

      const clickedObject = visibleIntersects[0].object;
      const groupName = clickedObject.userData.group?.toLowerCase() || '';
      console.log('[CLICK] Clicked group:', clickedObject.userData.group, 'groupName:', groupName);

      // Handle X axis - clicking on sides
      if (props.probingAxis === 'X' && plateModel) {
        let sideGroup: string | null = null;
        let visualSide: 'Left' | 'Right' | null = null;

        // plate-xy.txt has FrontLeft and BackLeft groups
        // After 90-degree rotation: FrontLeft -> visual Right, BackLeft -> visual Left
        if (groupName === 'frontleft') {
          sideGroup = 'FrontLeft';
          visualSide = 'Right';
        } else if (groupName === 'backleft') {
          sideGroup = 'BackLeft';
          visualSide = 'Left';
        }

        if (sideGroup && visualSide) {
          // Reset previously selected sides to dark gray
          setGroupColor(plateModel, 'FrontLeft', 0x555555);
          setGroupColor(plateModel, 'BackLeft', 0x555555);

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
      else if (props.probingAxis === 'Y' && plateModel) {
        let sideGroup: string | null = null;

        if (groupName.includes('front') || groupName.includes('sidefront')) {
          sideGroup = 'Front'; // This will match SideFront, FrontLeft, FrontRight
        } else if (groupName.includes('back') || groupName.includes('sideback')) {
          sideGroup = 'Back'; // This will match SideBack, BackLeft, BackRight
        }

        if (sideGroup) {
          // Reset previously selected side to dark gray
          setGroupColor(plateModel, 'Front', 0x555555);
          setGroupColor(plateModel, 'Back', 0x555555);
          setGroupColor(plateModel, 'SideFront', 0x555555);
          setGroupColor(plateModel, 'SideBack', 0x555555);

          // Highlight all parts of the clicked side
          setGroupColor(plateModel, sideGroup, getAccentColor());
          if (sideGroup === 'Front') {
            setGroupColor(plateModel, 'SideFront', getAccentColor());
          } else if (sideGroup === 'Back') {
            setGroupColor(plateModel, 'SideBack', getAccentColor());
          }

          // Move probe to selected side - outside and lower Z
          if (probeModel && plateModel) {
            const plateBBox = new THREE.Box3().setFromObject(plateModel);
            const plateMin = plateBBox.min;
            const plateMax = plateBBox.max;

            // Position probe outside the selected side
            if (sideGroup === 'Front') {
              probeModel.position.y = plateMin.y - 2; // Outside front side
            } else if (sideGroup === 'Back') {
              probeModel.position.y = plateMax.y + 2; // Outside back side
            }
            probeModel.position.x = 0; // Center on X axis
            probeModel.position.z = 1; // Lower Z
          }

          // Emit side selection to parent (separate event, won't affect selectedCorner)
          emit('sideSelected', sideGroup);

          if (renderer) {
            renderer.render(scene, camera);
          }
        }
      }
      // Handle XYZ/XY - clicking on corners
      else if (['XYZ', 'XY'].includes(props.probingAxis) && plateModel) {
        // Check if clicked on a corner (old format: includes 'corner', new format: BackRight, BackLeft, FrontRight, FrontLeft)
        const isCorner = groupName.includes('corner') ||
                        ['topright', 'topleft', 'bottomright', 'bottomleft'].includes(groupName);

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

          // Move probe to selected corner in XYZ or XY mode
          if (probeModel && plateModel) {
            // Get the bounding box of the plate to find corner positions
            const plateBBox = new THREE.Box3().setFromObject(plateModel);
            const plateMin = plateBBox.min;
            const plateMax = plateBBox.max;

            console.log('[CORNER] Clicked corner:', selectedCorner);
            console.log('[CORNER] Probing axis:', props.probingAxis);
            console.log('[PLATE] BBox min:', JSON.stringify({x: plateMin.x, y: plateMin.y, z: plateMin.z}));
            console.log('[PLATE] BBox max:', JSON.stringify({x: plateMax.x, y: plateMax.y, z: plateMax.z}));

            // Determine corner position based on corner name
            const cornerName = selectedCorner.toLowerCase();
            console.log('[CORNER] cornerName toLowerCase:', cornerName);
            let targetX = 0, targetY = 0;
            let mappedCorner = '';

            // Inset amount - negative for XY (more outer), positive for XYZ (more inner)
            const inset = props.probingAxis === 'XY' ? -1 : 2;

            // No rotation applied, so corner names match visual positions directly
            if (cornerName.includes('bottom') && cornerName.includes('right')) {
              targetX = plateMax.x - inset;
              targetY = plateMin.y + inset;
              mappedCorner = 'BottomRight (max.x, min.y)';
            } else if (cornerName.includes('bottom') && cornerName.includes('left')) {
              targetX = plateMin.x + inset;
              targetY = plateMin.y + inset;
              mappedCorner = 'BottomLeft (min.x, min.y)';
            } else if (cornerName.includes('top') && cornerName.includes('right')) {
              targetX = plateMax.x - inset;
              targetY = plateMax.y - inset;
              mappedCorner = 'TopRight (max.x, max.y)';
            } else if (cornerName.includes('top') && cornerName.includes('left')) {
              targetX = plateMin.x + inset;
              targetY = plateMax.y - inset;
              mappedCorner = 'TopLeft (min.x, max.y)';
            } else {
              console.warn('[CORNER] No corner match found for:', cornerName);
            }

            console.log('[PROBE] Mapped corner:', mappedCorner);
            console.log('[PROBE] Moving to:', JSON.stringify({x: targetX, y: targetY}));
            console.log('[PROBE] Before move - probe position:', JSON.stringify({x: probeModel.position.x, y: probeModel.position.y, z: probeModel.position.z}));

            // Move probe to corner position
            probeModel.position.x = targetX;
            probeModel.position.y = targetY;
            // Set Z height based on mode
            probeModel.position.z = props.probingAxis === 'XY' ? 1 : 4;

            console.log('[PROBE] After move - probe position:', JSON.stringify({x: probeModel.position.x, y: probeModel.position.y, z: probeModel.position.z}));
          }

          if (renderer) {
            renderer.render(scene, camera);
          }
        }
      }
    }
  });

  renderer.domElement.addEventListener('mousemove', (event) => {
    if (!['XYZ', 'XY', 'X', 'Y'].includes(props.probingAxis)) {
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
      const isCornerHover = (groupName.includes('corner') || ['topright', 'topleft', 'bottomright', 'bottomleft'].includes(groupName)) && ['XYZ', 'XY'].includes(props.probingAxis);
      const isXSideHover = props.probingAxis === 'X' && (groupName.includes('left') || groupName.includes('right'));
      const isYSideHover = props.probingAxis === 'Y' && (groupName.includes('front') || groupName.includes('back') || groupName.includes('sidefront') || groupName.includes('sideback'));

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
    camera.position.set(0.3102797925889344, -35.333541402798375, 11.617066192564842);
    camera.lookAt(0.3102797925889344, -0.18700311367436837, -0.6919443172047409);
    controls.target.set(0.3102797925889344, -0.18700311367436837, -0.6919443172047409);
    controls.update();
    renderer.render(scene, camera);
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

  const modelName = '3dprobe'; // Always use the new 3dprobe model
  const cacheBust = `?t=${Date.now()}`;

  try {
    const object = await loadOBJWithGroups(
      `${modelName}.txt${cacheBust}`,
      `${modelName}.mtl${cacheBust}`,
      '/assets/'
    );

    probeModel = object;

    // Ensure materials render both sides
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material) {
          child.material.side = THREE.DoubleSide;
        }
        // Lighten the Body group
        if (child.userData.group?.toLowerCase().includes('body')) {
          setGroupColor(object, 'Body', 0x666666); // Lighter gray for body
        }
      }
    });

    // Set initial LED color to green (ready state)
    setGroupColor(object, 'Led', 0x00ff00);

    // Don't rotate - keep original orientation to match corner/group names
    // object.rotation.z = Math.PI / 2; // Rotate 90 degrees around Z axis

    // Center and scale
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    object.position.sub(center);

    // Scale to fit view - make it bigger
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 10 / maxDim; // Scale to 10 units
    object.scale.multiplyScalar(scale);

    // Move object up (appears higher in view)
    object.position.z += 4;

    scene.add(object);

    // Save probe center and scale for plate reloading
    savedProbeCenter = center.clone();
    savedProbeScale = scale;

    // Load the plate model
    await loadPlateModel(center, scale);

    // Update camera to view the scaled model
    camera.position.set(0.3102797925889344, -35.333541402798375, 11.617066192564842);
    camera.lookAt(0.3102797925889344, -0.18700311367436837, -0.6919443172047409);
    controls.target.set(0.3102797925889344, -0.18700311367436837, -0.6919443172047409);
    controls.update();

    // Apply saved corner selection after models are loaded
    if (['XYZ', 'XY'].includes(props.probingAxis) && props.selectedCorner && plateModel && probeModel) {
      selectedCorner = props.selectedCorner;
      setGroupColor(plateModel, props.selectedCorner, getAccentColor());

      // Move probe to saved corner position
      const plateBBox = new THREE.Box3().setFromObject(plateModel);
      const plateMin = plateBBox.min;
      const plateMax = plateBBox.max;
      const cornerName = props.selectedCorner.toLowerCase();
      const inset = props.probingAxis === 'XY' ? -1 : 2;
      let targetX = 0, targetY = 0;

      if (cornerName.includes('front') && cornerName.includes('right')) {
        targetX = plateMax.x - inset;
        targetY = plateMin.y + inset;
      } else if (cornerName.includes('front') && cornerName.includes('left')) {
        targetX = plateMin.x + inset;
        targetY = plateMin.y + inset;
      } else if (cornerName.includes('back') && cornerName.includes('right')) {
        targetX = plateMax.x - inset;
        targetY = plateMax.y - inset;
      } else if (cornerName.includes('back') && cornerName.includes('left')) {
        targetX = plateMin.x + inset;
        targetY = plateMax.y - inset;
      }

      probeModel.position.x = targetX;
      probeModel.position.y = targetY;
      probeModel.position.z = props.probingAxis === 'XY' ? 1 : 4;
    }

    // Re-render after model is loaded
    if (renderer) {
      renderer.render(scene, camera);
    }
  } catch (error) {
    console.error('[CUSTOM_OBJ] Error loading probe model:', error);
  }
};

const loadPlateModel = async (probeCenter: THREE.Vector3, probeScale: number) => {
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

  console.log('[loadPlateModel] Loading plate file:', plateFile);
  currentPlateFile = plateFile;

  try {
    const object = await loadOBJWithGroups(
      `${plateFile}${cacheBust}`,
      `plate.mtl${cacheBust}`,
      '/assets/'
    );

    console.log('[loadPlateModel] OBJ loaded, setting plateModel');
    console.log('[loadPlateModel] probeCenter:', probeCenter, 'probeScale:', probeScale);
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
      setGroupColor(object, 'FrontLeft', 0x555555);
      setGroupColor(object, 'BackLeft', 0x555555);
    }

    // Rotate plate for X mode (90 degrees around Z axis)
    if (props.probingAxis === 'X') {
      object.rotation.z = Math.PI / 2;
    }

    // Apply same centering and scaling as probe
    object.position.sub(probeCenter);
    object.scale.multiplyScalar(probeScale);

    // Move plate up same as probe (appears higher in view)
    object.position.z += 3;

    console.log('[loadPlateModel] Adding plate to scene');
    scene.add(object);
    console.log('[loadPlateModel] Scene children count:', scene.children.length);
    console.log('[loadPlateModel] Plate position:', object.position);
    console.log('[loadPlateModel] Plate scale:', object.scale);
    console.log('[loadPlateModel] Plate rotation:', object.rotation);
    console.log('[loadPlateModel] Plate visible:', object.visible);

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
    setGroupColor(probeModel, 'Led', ledColor);

    if (renderer) {
      renderer.render(scene, camera);
    }
  }
});

// Watch for selected corner prop changes (from settings)
watch(() => props.selectedCorner, (newCorner) => {
  if (plateModel && newCorner && ['XYZ', 'XY'].includes(props.probingAxis)) {
    // Reset all corners to default color
    setGroupColor(plateModel, 'Corner', 0x555555);

    // Set the loaded corner to accent color
    selectedCorner = newCorner;
    setGroupColor(plateModel, newCorner, getAccentColor());

    // Move probe to the corner position
    if (probeModel) {
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
      probeModel.position.z = props.probingAxis === 'XY' ? 1 : 4;
    }

    if (renderer) {
      renderer.render(scene, camera);
    }
  }
});

// Watch for probing axis changes
watch(() => props.probingAxis, async () => {
  console.log('[ProbeVisualizer] Probing axis changed to:', props.probingAxis);

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

  console.log('[ProbeVisualizer] Current plate file:', currentPlateFile, 'Required:', requiredPlateFile, 'plateModel exists:', !!plateModel);

  // Check if the correct plate is already loaded
  // For X/Y modes, we need to reload because rotation is different
  const needsReload = currentPlateFile !== requiredPlateFile ||
                      (requiredPlateFile === 'plate-xy.txt' && plateModel);

  if (currentPlateFile === requiredPlateFile && plateModel && !['X', 'Y'].includes(props.probingAxis)) {
    console.log('[ProbeVisualizer] Correct plate already loaded, skipping reload');

    // Reset probe to center for Z, Center - Inner, Center - Outer, X, and Y modes
    if (['Z', 'Center - Inner', 'Center - Outer', 'X', 'Y'].includes(props.probingAxis) && probeModel) {
      console.log('[ProbeVisualizer]', props.probingAxis, 'mode - resetting probe to center');
      probeModel.position.set(0, 0, 4);
      if (renderer) {
        renderer.render(scene, camera);
      }
    }

    // Start glow animation for Center - Inner mode
    if (props.probingAxis === 'Center - Inner') {
      console.log('[ProbeVisualizer] Starting inner edge glow for Center - Inner');
      startEdgeGlow('InnerEdge');
    } else {
      // Stop glow when switching away from Center - Inner
      stopEdgeGlow();
    }

          // Update probe position for XYZ/XY modes (same plate, but different inset/Z)
          if (['XYZ', 'XY'].includes(props.probingAxis) && props.selectedCorner && probeModel) {
            console.log('[ProbeVisualizer] Updating probe position for', props.probingAxis, 'mode');
    
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
      probeModel.position.z = props.probingAxis === 'XY' ? 1 : 4;

      console.log('[ProbeVisualizer] Updated probe position:', JSON.stringify({x: targetX, y: targetY, z: probeModel.position.z}));

      if (renderer) {
        renderer.render(scene, camera);
      }
    }

    return;
  }

  // Prevent concurrent plate loading
  if (isLoadingPlate) {
    console.log('[ProbeVisualizer] Already loading plate, skipping');
    return;
  }

  // Reload plate model when switching between modes
  if (probeModel && scene) {
    isLoadingPlate = true;

    // Remove old plate model if it exists
    if (plateModel) {
      console.log('[ProbeVisualizer] Removing old plate model');
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

    // Use saved probe center and scale (not recalculated from current probe bbox)
    if (!savedProbeCenter || !savedProbeScale) {
      console.error('[ProbeVisualizer] savedProbeCenter or savedProbeScale not set!');
      isLoadingPlate = false;
      return;
    }

    console.log('[ProbeVisualizer] Loading new plate model');
    // Reload plate with correct model using saved values
    await loadPlateModel(savedProbeCenter, savedProbeScale);
    console.log('[ProbeVisualizer] Plate model loaded, plateModel:', plateModel);

    isLoadingPlate = false;

    // After loading plate, apply mode-specific settings
    if (plateModel && probeModel) {
      // Reset probe to center for Z, Center - Inner, Center - Outer, X, and Y modes
      if (['Z', 'Center - Inner', 'Center - Outer', 'X', 'Y'].includes(props.probingAxis)) {
        console.log('[ProbeVisualizer]', props.probingAxis, 'mode - resetting probe to center');
        probeModel.position.set(0, 0, 4);
      }

      // Start glow animation for Center - Inner mode
      if (props.probingAxis === 'Center - Inner') {
        console.log('[ProbeVisualizer] Starting inner edge glow for Center - Inner');
        startEdgeGlow('InnerEdge');
      } else {
        // Stop glow when switching away from Center - Inner
        stopEdgeGlow();
      }

      // Restore corner highlight for XYZ/XY modes
      if (['XYZ', 'XY'].includes(props.probingAxis) && props.selectedCorner) {
        console.log('[ProbeVisualizer] Restoring corner highlight after reload:', props.selectedCorner);
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
        probeModel.position.z = props.probingAxis === 'XY' ? 1 : 4;
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
  height: 300px;
  position: relative;
}

.probe-visualizer canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
