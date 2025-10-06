import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

interface ParsedGroup {
  name: string;
  vertices: THREE.Vector3[];
  normals: THREE.Vector3[];
  uvs: THREE.Vector2[];
  faces: Array<{
    vertexIndices: number[];
    normalIndices: number[];
    uvIndices: number[];
    materialName?: string;
  }>;
}

/**
 * Custom OBJ loader that preserves group structure
 * Creates separate meshes for each group in the OBJ file
 */
export class CustomOBJLoader {
  private materials: any = null;
  private basePath: string = '';

  setMaterials(materials: any) {
    this.materials = materials;
    return this;
  }

  setPath(path: string) {
    this.basePath = path;
    return this;
  }

  async load(url: string): Promise<THREE.Group> {
    const fullUrl = this.basePath + url;
    const response = await fetch(fullUrl);
    const objText = await response.text();

    return this.parse(objText);
  }

  private parse(objText: string): THREE.Group {
    const lines = objText.split('\n');

    // Global arrays (1-indexed to match OBJ format)
    const globalVertices: THREE.Vector3[] = [new THREE.Vector3()]; // dummy at index 0
    const globalNormals: THREE.Vector3[] = [new THREE.Vector3()];
    const globalUVs: THREE.Vector2[] = [new THREE.Vector2()];

    const groups: ParsedGroup[] = [];
    let currentGroup: ParsedGroup | null = null;
    let currentMaterial: string | undefined;

    console.log('[CUSTOM_OBJ] Starting parse...');

    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const parts = trimmed.split(/\s+/);
      const command = parts[0];

      switch (command) {
        case 'v': {
          // Vertex: v x y z
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);
          globalVertices.push(new THREE.Vector3(x, y, z));
          break;
        }

        case 'vn': {
          // Normal: vn x y z
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);
          globalNormals.push(new THREE.Vector3(x, y, z));
          break;
        }

        case 'vt': {
          // UV: vt u v
          const u = parseFloat(parts[1]);
          const v = parseFloat(parts[2]);
          globalUVs.push(new THREE.Vector2(u, v));
          break;
        }

        case 'g': {
          // Group: g groupName
          const groupName = parts.slice(1).join(' ') || 'default';
          currentGroup = {
            name: groupName,
            vertices: [],
            normals: [],
            uvs: [],
            faces: []
          };
          groups.push(currentGroup);
          console.log(`[CUSTOM_OBJ] Found group: ${groupName}`);
          break;
        }

        case 'usemtl': {
          // Material: usemtl materialName
          currentMaterial = parts[1];
          break;
        }

        case 'f': {
          // Face: f v1/vt1/vn1 v2/vt2/vn2 v3/vt3/vn3 ...
          if (!currentGroup) {
            // Create default group if none exists
            currentGroup = {
              name: 'default',
              vertices: [],
              normals: [],
              uvs: [],
              faces: []
            };
            groups.push(currentGroup);
          }

          const vertexIndices: number[] = [];
          const normalIndices: number[] = [];
          const uvIndices: number[] = [];

          // Parse face vertices (skip first element which is 'f')
          for (let i = 1; i < parts.length; i++) {
            const indices = parts[i].split('/');

            const vIndex = parseInt(indices[0]);
            const vtIndex = indices[1] ? parseInt(indices[1]) : 0;
            const vnIndex = indices[2] ? parseInt(indices[2]) : 0;

            vertexIndices.push(vIndex);
            uvIndices.push(vtIndex);
            normalIndices.push(vnIndex);
          }

          currentGroup.faces.push({
            vertexIndices,
            normalIndices,
            uvIndices,
            materialName: currentMaterial
          });
          break;
        }
      }
    });

    console.log(`[CUSTOM_OBJ] Parsed ${groups.length} groups`);
    console.log(`[CUSTOM_OBJ] Total vertices: ${globalVertices.length - 1}`);

    // Build Three.js Group with a mesh for each OBJ group
    const rootGroup = new THREE.Group();

    groups.forEach((group) => {
      if (group.faces.length === 0) return;

      console.log(`[CUSTOM_OBJ] Building mesh for group: ${group.name} (${group.faces.length} faces)`);

      const geometry = new THREE.BufferGeometry();
      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];

      // Convert faces to triangles
      group.faces.forEach((face) => {
        // Triangulate polygon (simple fan triangulation)
        for (let i = 1; i < face.vertexIndices.length - 1; i++) {
          // Triangle: 0, i, i+1
          [0, i, i + 1].forEach((idx) => {
            const vIndex = face.vertexIndices[idx];
            const vertex = globalVertices[vIndex];
            positions.push(vertex.x, vertex.y, vertex.z);

            const nIndex = face.normalIndices[idx];
            if (nIndex > 0 && globalNormals[nIndex]) {
              const normal = globalNormals[nIndex];
              normals.push(normal.x, normal.y, normal.z);
            } else {
              normals.push(0, 0, 1); // default normal
            }

            const uvIndex = face.uvIndices[idx];
            if (uvIndex > 0 && globalUVs[uvIndex]) {
              const uv = globalUVs[uvIndex];
              uvs.push(uv.x, uv.y);
            } else {
              uvs.push(0, 0); // default UV
            }
          });
        }
      });

      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

      // Get material
      let material: THREE.Material = new THREE.MeshPhongMaterial({
        color: 0xcccccc,
        side: THREE.DoubleSide
      });

      if (this.materials && group.faces[0].materialName) {
        const matName = group.faces[0].materialName;
        if (this.materials.materials && this.materials.materials[matName]) {
          material = this.materials.materials[matName];
          material.side = THREE.DoubleSide;
        }
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = group.name;
      mesh.userData.group = group.name;

      rootGroup.add(mesh);
    });

    console.log(`[CUSTOM_OBJ] Created ${rootGroup.children.length} meshes`);
    return rootGroup;
  }
}

/**
 * Load OBJ file with MTL and preserve group structure
 */
export const loadOBJWithGroups = async (
  objUrl: string,
  mtlUrl: string,
  basePath: string = ''
): Promise<THREE.Group> => {
  // Load MTL first
  const mtlLoader = new MTLLoader();
  mtlLoader.setPath(basePath);

  return new Promise((resolve, reject) => {
    mtlLoader.load(
      mtlUrl,
      (materials) => {
        materials.preload();

        // Load OBJ with custom loader
        const objLoader = new CustomOBJLoader();
        objLoader.setPath(basePath);
        objLoader.setMaterials(materials);

        objLoader.load(objUrl)
          .then(resolve)
          .catch(reject);
      },
      undefined,
      reject
    );
  });
};
