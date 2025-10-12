import * as THREE from 'three';
import type { Object3D } from 'three';

// Position constants for AutoZero Touch probe
const AUTOZERO_TOUCH_X_OFFSET = 100;  // Left/right offset from center
const AUTOZERO_TOUCH_Y_OFFSET = 120;   // Front/back offset from center
const AUTOZERO_TOUCH_Z_POSITION = -1; // Up/down position above plate

export interface AutoZeroTouchVisualizerConfig {
  scene: THREE.Scene;
  plate: THREE.Object3D | null;
}

export class AutoZeroTouchVisualizer {
  private scene: THREE.Scene;
  private plate: THREE.Object3D | null;
  private probeModel: THREE.Object3D | null = null;

  constructor(config: AutoZeroTouchVisualizerConfig) {
    this.scene = config.scene;
    this.plate = config.plate;
  }

  async loadModel(): Promise<void> {
    const modelPath = '/assets/probe/auto-touch/';
    const modelName = 'cnc-pointer';

    try {
      const probeModel = await this.loadObjWithMtl(modelPath, modelName);

      // Apply scale
      probeModel.scale.set(1, 1, 1);

      // Position the probe using constants (independent of axis selection)
      this.positionProbe(probeModel);

      // Store reference
      this.probeModel = probeModel;

      // Add to scene
      this.scene.add(probeModel);

      console.log('[AutoZeroTouchVisualizer] Model loaded and positioned:', JSON.stringify({
        x: probeModel.position.x,
        y: probeModel.position.y,
        z: probeModel.position.z
      }));
    } catch (error) {
      console.error('[AutoZeroTouchVisualizer] Failed to load model:', error);
      throw error;
    }
  }

  private positionProbe(probeModel: THREE.Object3D): void {
    // AutoZero Touch uses fixed positioning regardless of selected axis or corner
    probeModel.position.x = AUTOZERO_TOUCH_X_OFFSET;
    probeModel.position.y = AUTOZERO_TOUCH_Y_OFFSET;
    probeModel.position.z = AUTOZERO_TOUCH_Z_POSITION;
  }

  updateAxis(axis: string): void {
    // AutoZero Touch is NOT affected by axis changes
    // This method is intentionally empty but exists for interface compatibility
    console.log('[AutoZeroTouchVisualizer] Axis change ignored (AutoZero Touch is axis-independent)');
  }

  updateCorner(corner: string): void {
    // AutoZero Touch is NOT affected by corner selection
    // This method is intentionally empty but exists for interface compatibility
    console.log('[AutoZeroTouchVisualizer] Corner selection ignored (AutoZero Touch is corner-independent)');
  }

  cleanup(): void {
    if (this.probeModel) {
      this.scene.remove(this.probeModel);
      this.disposeObject(this.probeModel);
      this.probeModel = null;
    }
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(material => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  }

  private async loadObjWithMtl(basePath: string, modelName: string): Promise<THREE.Object3D> {
    const objPath = `${basePath}${modelName}.obj.txt`;
    const mtlPath = `${basePath}${modelName}.mtl.txt`;

    try {
      // Load MTL first
      const mtlResponse = await fetch(mtlPath);
      const mtlText = await mtlResponse.text();
      const materials = this.parseMTL(mtlText, basePath);

      // Load OBJ
      const objResponse = await fetch(objPath);
      const objText = await objResponse.text();
      const geometry = this.parseOBJ(objText, materials);

      return geometry;
    } catch (error) {
      console.error('[AutoZeroTouchVisualizer] Error loading model:', error);
      throw error;
    }
  }

  private parseMTL(mtlText: string, basePath: string): Map<string, THREE.MeshPhongMaterial> {
    const materials = new Map<string, THREE.MeshPhongMaterial>();
    const lines = mtlText.split('\n');
    let currentMaterial: THREE.MeshPhongMaterial | null = null;
    let currentMaterialName = '';

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const command = parts[0];

      if (command === 'newmtl') {
        if (currentMaterial && currentMaterialName) {
          materials.set(currentMaterialName, currentMaterial);
        }
        currentMaterialName = parts[1];
        currentMaterial = new THREE.MeshPhongMaterial();
      } else if (currentMaterial) {
        if (command === 'Kd') {
          currentMaterial.color = new THREE.Color(
            parseFloat(parts[1]),
            parseFloat(parts[2]),
            parseFloat(parts[3])
          );
        } else if (command === 'Ka') {
          currentMaterial.emissive = new THREE.Color(
            parseFloat(parts[1]),
            parseFloat(parts[2]),
            parseFloat(parts[3])
          );
        } else if (command === 'Ks') {
          currentMaterial.specular = new THREE.Color(
            parseFloat(parts[1]),
            parseFloat(parts[2]),
            parseFloat(parts[3])
          );
        } else if (command === 'd' || command === 'Tr') {
          const opacity = command === 'd' ? parseFloat(parts[1]) : 1 - parseFloat(parts[1]);
          currentMaterial.opacity = opacity;
          if (opacity < 1) {
            currentMaterial.transparent = true;
          }
        }
      }
    }

    if (currentMaterial && currentMaterialName) {
      materials.set(currentMaterialName, currentMaterial);
    }

    return materials;
  }

  private parseOBJ(objText: string, materials: Map<string, THREE.MeshPhongMaterial>): THREE.Object3D {
    const lines = objText.split('\n');
    const vertices: THREE.Vector3[] = [];
    const normals: THREE.Vector3[] = [];
    const uvs: THREE.Vector2[] = [];

    const groups = new Map<string, {
      positions: number[];
      normals: number[];
      uvs: number[];
    }>();

    let currentMaterialName = 'default';

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const command = parts[0];

      if (command === 'v') {
        vertices.push(new THREE.Vector3(
          parseFloat(parts[1]),
          parseFloat(parts[2]),
          parseFloat(parts[3])
        ));
      } else if (command === 'vn') {
        normals.push(new THREE.Vector3(
          parseFloat(parts[1]),
          parseFloat(parts[2]),
          parseFloat(parts[3])
        ));
      } else if (command === 'vt') {
        uvs.push(new THREE.Vector2(
          parseFloat(parts[1]),
          parseFloat(parts[2])
        ));
      } else if (command === 'usemtl') {
        currentMaterialName = parts[1];
        if (!groups.has(currentMaterialName)) {
          groups.set(currentMaterialName, {
            positions: [],
            normals: [],
            uvs: []
          });
        }
      } else if (command === 'f') {
        const group = groups.get(currentMaterialName) || groups.get('default')!;
        if (!group) {
          groups.set(currentMaterialName, {
            positions: [],
            normals: [],
            uvs: []
          });
        }

        const faceVertices = [];
        for (let i = 1; i < parts.length; i++) {
          const indices = parts[i].split('/');
          faceVertices.push({
            v: parseInt(indices[0]) - 1,
            vt: indices[1] ? parseInt(indices[1]) - 1 : -1,
            vn: indices[2] ? parseInt(indices[2]) - 1 : -1
          });
        }

        for (let i = 1; i < faceVertices.length - 1; i++) {
          [faceVertices[0], faceVertices[i], faceVertices[i + 1]].forEach(fv => {
            const vertex = vertices[fv.v];
            group.positions.push(vertex.x, vertex.y, vertex.z);

            if (fv.vn >= 0 && normals[fv.vn]) {
              const normal = normals[fv.vn];
              group.normals.push(normal.x, normal.y, normal.z);
            }

            if (fv.vt >= 0 && uvs[fv.vt]) {
              const uv = uvs[fv.vt];
              group.uvs.push(uv.x, uv.y);
            }
          });
        }
      }
    }

    const object = new THREE.Object3D();

    groups.forEach((group, materialName) => {
      if (group.positions.length === 0) return;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(group.positions, 3));

      if (group.normals.length > 0) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(group.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }

      if (group.uvs.length > 0) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(group.uvs, 2));
      }

      const material = materials.get(materialName) || new THREE.MeshPhongMaterial({ color: 0x808080 });
      const mesh = new THREE.Mesh(geometry, material);
      object.add(mesh);
    });

    return object;
  }
}
