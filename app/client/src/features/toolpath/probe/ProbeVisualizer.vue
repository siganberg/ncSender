<template>
  <div ref="containerRef" class="probe-visualizer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { hideGroup, applyToGroup } from './probe-mesh-utils';
import { loadOBJWithGroups } from './custom-obj-loader';

const props = defineProps<{
  probeType: '3d-touch' | 'standard-block';
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
  controls.addEventListener('change', () => {
    renderer.render(scene, camera);
  });

  // Reset view on right click
  renderer.domElement.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    camera.position.set(0, 35, 5);
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

    // Debug: log the object structure
    const meshes: any[] = [];
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshes.push({
          name: child.name,
          group: child.userData.group,
          materialName: child.material?.name,
          materialType: child.material?.type,
          geometry: {
            vertices: child.geometry.attributes.position?.count || 0
          }
        });

        // Ensure materials render both sides
        if (child.material) {
          child.material.side = THREE.DoubleSide;
        }
      }
    });

    console.log('[CUSTOM_OBJ] Probe meshes:', JSON.stringify(meshes, null, 2));
    console.log('[CUSTOM_OBJ] Children count:', object.children.length);

    // Apply mesh visibility rules
    applyMeshVisibilityRules(object);

    // Keep original orientation - only center and scale
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    console.log('[CUSTOM_OBJ] Bounding box size:', JSON.stringify({x: size.x, y: size.y, z: size.z}));
    console.log('[CUSTOM_OBJ] Center:', JSON.stringify({x: center.x, y: center.y, z: center.z}));

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
    camera.position.set(0, 35, 5);
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

    console.log('[CUSTOM_OBJ] Loaded plate model');

    // Log plate meshes for debugging
    const plateMeshes: any[] = [];
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        plateMeshes.push({
          name: child.name,
          group: child.userData.group,
          materialName: child.material?.name,
          vertices: child.geometry.attributes.position?.count || 0
        });
      }
    });
    console.log('[CUSTOM_OBJ] Plate meshes:', JSON.stringify(plateMeshes, null, 2));

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
  // Hide the Center group (the circular hole in the middle of the plate)
  hideGroup(object, 'center');

  // Future customizations can be added here:
  // setGroupColor(object, 'plate', 0xff0000);  // Red plate
  // setGroupOpacity(object, 'led', 0.5);       // Semi-transparent LED
  // const blinkId = blinkGroup(object, 'led', 500, () => {
  //   if (renderer) renderer.render(scene, camera);
  // });
  // blinkIntervals.value.push(blinkId);
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
