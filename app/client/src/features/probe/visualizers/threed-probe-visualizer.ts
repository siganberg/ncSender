import * as THREE from 'three';
import type { Object3D, Scene } from 'three';
import { setGroupColor } from '../probe-mesh-utils';
import { loadOBJWithGroups } from '../custom-obj-loader';

export interface ThreeDProbeVisualizerConfig {
  scene: Scene;
  plate: Object3D | null;
  getAccentColor: () => number;
}

export class ThreeDProbeVisualizer {
  private scene: Scene;
  private plate: Object3D | null;
  private probeModel: Object3D | null = null;
  private getAccentColor: () => number;

  constructor(config: ThreeDProbeVisualizerConfig) {
    this.scene = config.scene;
    this.plate = config.plate;
    this.getAccentColor = config.getAccentColor;
  }

  async loadModel(baseScale: number): Promise<void> {
    const modelPath = '/assets/probe/3d-probe/';
    const modelName = '3dprobe';
    const cacheBust = `?t=${Date.now()}`;

    try {
      const object = await loadOBJWithGroups(
        `${modelName}.txt${cacheBust}`,
        `${modelName}.mtl${cacheBust}`,
        modelPath
      );

      // Ensure materials render both sides
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.material) {
            child.material.side = THREE.DoubleSide;
          }
        }
      });

      // Set colors
      setGroupColor(object, 'Led', 0x00ff00); // Green LED for ready state
      setGroupColor(object, 'Body', 0x606060);

      // Get probe bounding box for centering
      const probeBBox = new THREE.Box3().setFromObject(object);
      const probeCenter = probeBBox.getCenter(new THREE.Vector3());

      // Center and scale probe
      object.position.sub(probeCenter);
      object.scale.multiplyScalar(baseScale);

      // Default Z position
      object.position.z += 4;

      this.probeModel = object;
      this.scene.add(object);

      console.log('[ThreeDProbeVisualizer] Model loaded and positioned');
    } catch (error) {
      console.error('[ThreeDProbeVisualizer] Failed to load model:', error);
      throw error;
    }
  }

  updateAxis(axis: string, selectedCorner: string | null, selectedSide: string | null): void {
    if (!this.probeModel || !this.plate) return;

    const plateBBox = new THREE.Box3().setFromObject(this.plate);
    const plateMin = plateBBox.min;
    const plateMax = plateBBox.max;

    // Handle XYZ/XY modes with corner selection
    if (['XYZ', 'XY'].includes(axis) && selectedCorner) {
      const inset = axis === 'XY' ? -1 : 2;
      const cornerName = selectedCorner.toLowerCase();
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

      this.probeModel.position.x = targetX;
      this.probeModel.position.y = targetY;
      this.probeModel.position.z = axis === 'XY' ? 1 : 4;
    }
    // Handle X mode with side selection
    else if (axis === 'X' && selectedSide) {
      if (selectedSide === 'Left') {
        this.probeModel.position.x = plateMin.x - 2;
      } else if (selectedSide === 'Right') {
        this.probeModel.position.x = plateMax.x + 2;
      }
      this.probeModel.position.y = 0;
      this.probeModel.position.z = 1;
    }
    // Handle Y mode with side selection
    else if (axis === 'Y' && selectedSide) {
      if (selectedSide === 'Front') {
        this.probeModel.position.y = plateMin.y - 2;
      } else if (selectedSide === 'Back') {
        this.probeModel.position.y = plateMax.y + 2;
      }
      this.probeModel.position.x = 0;
      this.probeModel.position.z = 1;
    }
    // Handle Center - Inner mode
    else if (axis === 'Center - Inner') {
      this.probeModel.position.x = 0;
      this.probeModel.position.y = 0;
      this.probeModel.position.z = 0;
    }
    // Handle Center - Outer mode
    else if (axis === 'Center - Outer') {
      this.probeModel.position.x = 0;
      this.probeModel.position.y = 0;
      this.probeModel.position.z = 4;
    }
    // Handle Z mode - center the probe
    else if (axis === 'Z') {
      this.probeModel.position.x = 0;
      this.probeModel.position.y = 0;
      this.probeModel.position.z = 4;
    }
  }

  updateCorner(corner: string, axis: string): void {
    if (!this.probeModel || !this.plate) return;

    const plateBBox = new THREE.Box3().setFromObject(this.plate);
    const plateMin = plateBBox.min;
    const plateMax = plateBBox.max;

    const inset = axis === 'XY' ? -1 : 2;
    const cornerName = corner.toLowerCase();
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

    this.probeModel.position.x = targetX;
    this.probeModel.position.y = targetY;
    this.probeModel.position.z = axis === 'XY' ? 1 : 4;
  }

  updateLED(isActive: boolean): void {
    if (!this.probeModel) return;

    const ledColor = isActive ? 0xff0000 : 0x00ff00;
    setGroupColor(this.probeModel, 'Led', ledColor);
  }

  getModel(): Object3D | null {
    return this.probeModel;
  }

  cleanup(): void {
    if (this.probeModel) {
      this.scene.remove(this.probeModel);
      this.disposeObject(this.probeModel);
      this.probeModel = null;
    }
  }

  private disposeObject(obj: Object3D): void {
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
}
