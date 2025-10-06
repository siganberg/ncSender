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
}>();

const containerRef = ref<HTMLElement>();
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let probeModel: THREE.Group | null = null;
let plateModel: THREE.Group | null = null;
const blinkIntervals = ref<number[]>([]);

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
    if (intersects.length > 0) {
      const clickedObject = intersects[0].object;
      const groupName = clickedObject.userData.group?.toLowerCase() || '';

      if (groupName.includes('corner')) {
        alert(clickedObject.userData.group);
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
    if (intersects.length > 0) {
      const hoveredObject = intersects[0].object;
      const groupName = hoveredObject.userData.group?.toLowerCase() || '';

      if (groupName.includes('corner')) {
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
    camera.position.set(0, -33.85, 10.19);
    camera.lookAt(0, 0, 5);
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

    // Ensure materials render both sides with smooth shading
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material) {
          child.material.side = THREE.DoubleSide;
          child.material.flatShading = false; // Use smooth shading
        }
        // Lighten the Body group
        if (child.userData.group?.toLowerCase().includes('body')) {
          setGroupColor(object, 'Body', 0x666666); // Lighter gray for body
        }
      }
    });

    // Apply mesh visibility rules
    applyMeshVisibilityRules(object);

    // Keep original orientation - only center and scale
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
    camera.position.set(0, -33.85, 10.19);
    camera.lookAt(0, 0, 5);
    controls.update();

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

    // Ensure smooth shading for seamless appearance
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material) {
          child.material.flatShading = false; // Use smooth shading
        }
      }
    });

    // Apply mesh visibility rules
    applyMeshVisibilityRules(object);

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
  // Set all plate groups to the same color (darker gray)
  const plateColor = 0xcccccc;
  setGroupColor(object, 'Plate', plateColor);
  setGroupColor(object, 'OuterPlate', plateColor);
  setGroupColor(object, 'InnerPlate', plateColor);
  setGroupColor(object, 'Center', plateColor);
  setGroupColor(object, 'Corner', plateColor); // Matches all Corner groups

  // Apply visibility and color rules based on probing axis
  if (props.probingAxis === 'Center - Inner') {
    hideGroup(object, 'center');
    setGroupColor(object, 'InnerPlate', 0x4caf50); // Green highlight
  } else if (props.probingAxis === 'Center - Outer') {
    setGroupColor(object, 'OuterPlate', 0x4caf50); // Green highlight
  } else if (['XYZ', 'XY', 'X', 'Y'].includes(props.probingAxis)) {
    showGroup(object, 'center');
    setGroupColor(object, 'Corner', 0x555555); // Darker gray for corners
  } else {
    showGroup(object, 'center');
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

// Watch for probing axis changes and update Center group visibility
watch(() => props.probingAxis, () => {
  if (plateModel) {
    const plateColor = 0xcccccc;

    // Reset all colors first
    setGroupColor(plateModel, 'InnerPlate', plateColor);
    setGroupColor(plateModel, 'OuterPlate', plateColor);
    setGroupColor(plateModel, 'Corner', plateColor);

    if (props.probingAxis === 'Center - Inner') {
      hideGroup(plateModel, 'center');
      setGroupColor(plateModel, 'InnerPlate', 0x4caf50); // Green highlight
      // Lower the probe
      if (probeModel) {
        probeModel.position.z = 1; // Lower position
      }
    } else if (props.probingAxis === 'Center - Outer') {
      showGroup(plateModel, 'center');
      setGroupColor(plateModel, 'OuterPlate', 0x4caf50); // Green highlight
      // Reset probe position
      if (probeModel) {
        probeModel.position.z = 4; // Original position
      }
    } else if (['XYZ', 'XY', 'X', 'Y'].includes(props.probingAxis)) {
      showGroup(plateModel, 'center');
      setGroupColor(plateModel, 'Corner', 0x555555); // Darker gray for corners
      // Reset probe position
      if (probeModel) {
        probeModel.position.z = 4; // Original position
      }
    } else {
      showGroup(plateModel, 'center');
      // Reset probe position
      if (probeModel) {
        probeModel.position.z = 4; // Original position
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
