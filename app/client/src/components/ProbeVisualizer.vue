<template>
  <div ref="containerRef" class="probe-visualizer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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

const loadProbeModel = () => {
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

  const mtlLoader = new MTLLoader();
  mtlLoader.setPath('/assets/');
  mtlLoader.load(
    `${modelName}.mtl`,
    (materials) => {
      materials.preload();

      const objLoader = new OBJLoader();
      objLoader.setMaterials(materials);
      objLoader.setPath('/assets/');
      objLoader.load(
        `${modelName}.txt`,
        (object) => {
          probeModel = object;

          // Debug: log the object structure
          const meshes: any[] = [];
          object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              const parentName = child.parent?.name?.toLowerCase() || '';

              meshes.push({
                name: child.name,
                parent: child.parent?.name || 'root',
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

          console.log('Meshes:', JSON.stringify(meshes, null, 2));
          console.log('Children count:', object.children.length);

          // Keep original orientation - only center and scale
          const box = new THREE.Box3().setFromObject(object);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          console.log('Bounding box size:', JSON.stringify({x: size.x, y: size.y, z: size.z}));
          console.log('Center:', JSON.stringify({x: center.x, y: center.y, z: center.z}));

          object.position.sub(center);

          // Scale to fit view - make it bigger
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = 10 / maxDim; // Scale to 10 units
          object.scale.multiplyScalar(scale);

          // Move object up (appears higher in view)
          object.position.z += 4;

          scene.add(object);

          // Load the plate model
          loadPlateModel(center, scale);

          // Update camera to view the scaled model
          camera.position.set(0, 35, 5);
          camera.lookAt(0, 0, 5);
          controls.update();

          // Re-render after model is loaded
          if (renderer) {
            renderer.render(scene, camera);
          }
        },
        (progress) => {
          console.log('Loading model:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
          console.error('Error loading OBJ:', error);
        }
      );
    },
    (progress) => {
      console.log('Loading materials:', (progress.loaded / progress.total * 100) + '%');
    },
    (error) => {
      console.error('Error loading MTL:', error);
    }
  );
};

const loadPlateModel = (probeCenter: THREE.Vector3, probeScale: number) => {
  const mtlLoader = new MTLLoader();
  mtlLoader.setPath('/assets/');
  mtlLoader.load(
    'plate.mtl',
    (materials) => {
      materials.preload();

      const objLoader = new OBJLoader();
      objLoader.setMaterials(materials);
      objLoader.setPath('/assets/');
      objLoader.load(
        'plate.txt',
        (object) => {
          plateModel = object;

          console.log('Loaded plate model');

          // Traverse and set double-sided materials
          object.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              if (child.material) {
                child.material.side = THREE.DoubleSide;
              }
            }
          });

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
        },
        (progress) => {
          console.log('Loading plate model:', (progress.loaded / progress.total * 100) + '%');
        },
        (error) => {
          console.error('Error loading plate OBJ:', error);
        }
      );
    },
    (progress) => {
      console.log('Loading plate materials:', (progress.loaded / progress.total * 100) + '%');
    },
    (error) => {
      console.error('Error loading plate MTL:', error);
    }
  );
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
