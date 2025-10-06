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

const initScene = () => {
  if (!containerRef.value) return;

  // Scene setup
  scene = new THREE.Scene();
  // No background (transparent)

  // Camera setup with front perspective view (Z-up, looking along Y-axis)
  const aspect = containerRef.value.clientWidth / containerRef.value.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.001, 1000);
  camera.position.set(0, 2, .5);
  camera.lookAt(0, 0, 0.01);
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

      // Handle X axis - clicking on sides (left or right group)
      if (props.probingAxis === 'X' && plateModel) {
        let sideGroup: string | null = null;

        if (groupName.includes('left')) {
          sideGroup = 'Left'; // This will match SideLeft, BackLeft, FrontLeft
        } else if (groupName.includes('right')) {
          sideGroup = 'Right'; // This will match SideRight, BackRight, FrontRight
        }

        if (sideGroup) {
          // Reset previously selected side to dark gray
          setGroupColor(plateModel, 'Left', 0x555555);
          setGroupColor(plateModel, 'Right', 0x555555);

          // Highlight all parts of the clicked side
          setGroupColor(plateModel, sideGroup, 0x4caf50);

          // Move probe to selected side - outside and lower Z
          if (probeModel && plateModel) {
            const plateBBox = new THREE.Box3().setFromObject(plateModel);
            const plateMin = plateBBox.min;
            const plateMax = plateBBox.max;

            // Position probe outside the selected side
            if (sideGroup === 'Left') {
              probeModel.position.x = plateMin.x - 2; // Outside left side
            } else if (sideGroup === 'Right') {
              probeModel.position.x = plateMax.x + 2; // Outside right side
            }
            probeModel.position.y = 0; // Center on Y axis
            probeModel.position.z = 1; // Lower Z
          }

          // Emit side selection to parent (separate event, won't affect selectedCorner)
          emit('sideSelected', sideGroup);

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
          setGroupColor(plateModel, sideGroup, 0x4caf50);
          if (sideGroup === 'Front') {
            setGroupColor(plateModel, 'SideFront', 0x4caf50);
          } else if (sideGroup === 'Back') {
            setGroupColor(plateModel, 'SideBack', 0x4caf50);
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
      else if (groupName.includes('corner') && plateModel) {
        // Reset previously selected corner to darker gray
        if (selectedCorner) {
          setGroupColor(plateModel, selectedCorner, 0x555555);
        }

        // Change clicked corner to accent color
        selectedCorner = clickedObject.userData.group;
        setGroupColor(plateModel, selectedCorner, 0x4caf50);

        // Emit corner selection to parent
        emit('cornerSelected', selectedCorner);

        // Move probe to selected corner in XYZ or XY mode
        if (['XYZ', 'XY'].includes(props.probingAxis) && probeModel && plateModel) {
          // Get the bounding box of the plate to find corner positions
          const plateBBox = new THREE.Box3().setFromObject(plateModel);
          const plateMin = plateBBox.min;
          const plateMax = plateBBox.max;

          console.log('[CORNER] Clicked corner:', selectedCorner);
          console.log('[PLATE] BBox min:', JSON.stringify({x: plateMin.x, y: plateMin.y, z: plateMin.z}));
          console.log('[PLATE] BBox max:', JSON.stringify({x: plateMax.x, y: plateMax.y, z: plateMax.z}));

          // Determine corner position based on corner name
          // Now with proper orientation from the start
          const cornerName = selectedCorner.toLowerCase();
          let targetX = 0, targetY = 0;
          let mappedCorner = '';

          // Inset amount - negative for XY (more outer), positive for XYZ (more inner)
          const inset = props.probingAxis === 'XY' ? -1 : 2;

          if (cornerName.includes('front') && cornerName.includes('right')) {
            targetX = plateMax.x - inset;
            targetY = plateMin.y + inset;
            mappedCorner = 'FrontRight (max.x, min.y)';
          } else if (cornerName.includes('front') && cornerName.includes('left')) {
            targetX = plateMin.x + inset;
            targetY = plateMin.y + inset;
            mappedCorner = 'FrontLeft (min.x, min.y)';
          } else if (cornerName.includes('back') && cornerName.includes('right')) {
            targetX = plateMax.x - inset;
            targetY = plateMax.y - inset;
            mappedCorner = 'BackRight (max.x, max.y)';
          } else if (cornerName.includes('back') && cornerName.includes('left')) {
            targetX = plateMin.x + inset;
            targetY = plateMax.y - inset;
            mappedCorner = 'BackLeft (min.x, max.y)';
          }

          console.log('[PROBE] Mapped corner:', mappedCorner);
          console.log('[PROBE] Moving to:', JSON.stringify({x: targetX, y: targetY}));

          // Move probe to corner position
          probeModel.position.x = targetX;
          probeModel.position.y = targetY;
          // Set Z height based on mode
          probeModel.position.z = props.probingAxis === 'XY' ? 1 : 4;
        }

        if (renderer) {
          renderer.render(scene, camera);
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
      const isCornerHover = groupName.includes('corner');
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
    camera.position.set(0, -35.631578947368226, 10.726315789473626);
    camera.lookAt(0, 0, 0);
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

    // Apply mesh visibility rules
    applyMeshVisibilityRules(object);

    // Fix orientation first - rotate to align with standard CNC coordinate system
    // Z-up (already correct), but we need to rotate around Z axis to fix X/Y orientation
    object.rotation.z = Math.PI / 2; // Rotate 90 degrees around Z axis

    // Center and scale after rotation
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

    // Load the plate model
    await loadPlateModel(center, scale);

    // Update camera to view the scaled model
    camera.position.set(0, -35.631578947368226, 10.726315789473626);
    camera.lookAt(0, 0, 0);
    controls.update();

    // Apply saved corner selection after models are loaded
    if (['XYZ', 'XY'].includes(props.probingAxis) && props.selectedCorner && plateModel && probeModel) {
      selectedCorner = props.selectedCorner;
      setGroupColor(plateModel, props.selectedCorner, 0x4caf50);

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

  try {
    const object = await loadOBJWithGroups(
      `plate.txt${cacheBust}`,
      `plate.mtl${cacheBust}`,
      '/assets/'
    );

    plateModel = object;

    // Set plate colors - corners and sides should be dark gray by default
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material) {
          child.material.side = THREE.DoubleSide;
          const groupName = child.userData.group?.toLowerCase() || '';
          // Set corners and sides to dark gray, everything else to light gray
          if (groupName.includes('corner') || groupName.includes('side')) {
            child.material.color.setHex(0x555555); // Dark gray for corners and sides
          } else {
            child.material.color.setHex(0xcccccc); // Light gray for other parts
          }
        }
      }
    });

    // Apply mesh visibility rules
    applyMeshVisibilityRules(object);

    // Fix orientation - same rotation as probe
    object.rotation.z = Math.PI / 2; // Rotate 90 degrees around Z axis

    // Apply same centering and scaling as probe
    object.position.sub(probeCenter);
    object.scale.multiplyScalar(probeScale);

    // Move plate up same as probe (appears higher in view)
    object.position.z += 3;

    scene.add(object);

    // Re-render after plate is loaded
    if (renderer) {
      renderer.render(scene, camera);
    }
  } catch (error) {
    console.error('[CUSTOM_OBJ] Error loading plate model:', error);
  }
};

const applyMeshVisibilityRules = (object: THREE.Group) => {
  // Apply visibility and color rules based on probing axis
  if (props.probingAxis === 'Center - Inner') {
    hideGroup(object, 'center');
    hideGroup(object, 'EdgeOuter');
    showGroup(object, 'EdgeCenter');
    setGroupColor(object, 'Inner', 0x4caf50); // Green highlight for Inner parts
  } else if (props.probingAxis === 'Center - Outer') {
    hideGroup(object, 'EdgeCenter');
    showGroup(object, 'EdgeOuter');
    setGroupColor(object, 'Outer', 0x4caf50); // Green highlight for Outer parts
  } else if (['XYZ', 'XY', 'X', 'Y'].includes(props.probingAxis)) {
    showGroup(object, 'center');
    hideGroup(object, 'EdgeOuter');
    hideGroup(object, 'EdgeCenter');
    setGroupColor(object, 'Corner', 0x555555); // Darker gray for corners
  } else {
    showGroup(object, 'center');
    hideGroup(object, 'EdgeOuter');
    hideGroup(object, 'EdgeCenter');
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

// Watch for selected corner prop changes (from settings)
watch(() => props.selectedCorner, (newCorner) => {
  if (plateModel && newCorner && ['XYZ', 'XY'].includes(props.probingAxis)) {
    // Reset all corners to default color
    setGroupColor(plateModel, 'Corner', 0x555555);

    // Set the loaded corner to accent color
    selectedCorner = newCorner;
    setGroupColor(plateModel, newCorner, 0x4caf50);

    // Move probe to the corner position
    if (probeModel) {
      const plateBBox = new THREE.Box3().setFromObject(plateModel);
      const plateMin = plateBBox.min;
      const plateMax = plateBBox.max;
      const cornerName = newCorner.toLowerCase();
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

    if (renderer) {
      renderer.render(scene, camera);
    }
  }
});

// Watch for probing axis changes and update Center group visibility
watch(() => props.probingAxis, () => {
  if (plateModel) {
    // Reset all non-corner/side parts to default light gray, keep corners/sides dark
    plateModel.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const groupName = child.userData.group?.toLowerCase() || '';
        if (!groupName.includes('corner') && !groupName.includes('side')) {
          child.material.color.setHex(0xcccccc); // Reset non-corner/side parts to light gray
        } else {
          child.material.color.setHex(0x555555); // Keep corners and sides dark gray
        }
      }
    });

    if (props.probingAxis === 'Center - Inner') {
      hideGroup(plateModel, 'center');
      hideGroup(plateModel, 'EdgeOuter');
      showGroup(plateModel, 'EdgeCenter');
      setGroupColor(plateModel, 'Inner', 0x4caf50); // Green highlight for Inner parts
      setGroupColor(plateModel, 'EdgeCenter', 0x4caf50); // Green highlight for EdgeCenter
      // Lower the probe
      if (probeModel) {
        probeModel.position.set(0, 0, 1); // Lower position
      }
    } else if (props.probingAxis === 'Center - Outer') {
      showGroup(plateModel, 'center');
      hideGroup(plateModel, 'EdgeCenter');
      showGroup(plateModel, 'EdgeOuter');
      setGroupColor(plateModel, 'Outer', 0x4caf50); // Green highlight for Outer parts
      setGroupColor(plateModel, 'EdgeOuter', 0x4caf50); // Green highlight for EdgeOuter
      // Reset probe position
      if (probeModel) {
        probeModel.position.set(0, 0, 4); // Original position
      }
    } else if (['XYZ', 'XY', 'X', 'Y'].includes(props.probingAxis)) {
      showGroup(plateModel, 'center');
      hideGroup(plateModel, 'EdgeOuter');
      hideGroup(plateModel, 'EdgeCenter');

      // Reset all side colors to dark gray (no restoration for X/Y modes)
      setGroupColor(plateModel, 'Left', 0x555555);
      setGroupColor(plateModel, 'Right', 0x555555);
      setGroupColor(plateModel, 'Front', 0x555555);
      setGroupColor(plateModel, 'Back', 0x555555);
      setGroupColor(plateModel, 'SideFront', 0x555555);
      setGroupColor(plateModel, 'SideBack', 0x555555);

      // Restore saved corner selection for XYZ/XY modes
      if (['XYZ', 'XY'].includes(props.probingAxis) && props.selectedCorner) {
        selectedCorner = props.selectedCorner;
        setGroupColor(plateModel, props.selectedCorner, 0x4caf50);

        // Move probe to saved corner position
        if (probeModel) {
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
      } else {
        selectedCorner = null; // Reset corner selection for X/Y modes
        emit('cornerSelected', null); // Emit reset to parent
        // Reset probe position
        if (probeModel) {
          probeModel.position.set(0, 0, 4); // Original position
        }
      }
    } else {
      showGroup(plateModel, 'center');
      hideGroup(plateModel, 'EdgeOuter');
      hideGroup(plateModel, 'EdgeCenter');
      // Reset probe position to center
      if (probeModel) {
        probeModel.position.set(0, 0, 4); // Original position
      }
    }
    if (renderer) {
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
  height: 100%;
  min-height: 400px;
  position: relative;
}

.probe-visualizer canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
