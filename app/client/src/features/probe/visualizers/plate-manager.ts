import * as THREE from 'three';
import { applyToGroup, setGroupColor } from '../probe-mesh-utils';
import { loadOBJWithGroups } from '../custom-obj-loader';
import { getPlateScale } from './geometry';
import type { PlateManager, ProbeCorner, ProbeSide, ProbingAxis } from './types';

const DEFAULT_CORNER_COLOR = 0x555555;
const DEFAULT_SIDE_COLOR = 0x555555;
const DEFAULT_PLATE_COLOR = 0xdeb887; // Burlywood

const AXIS_PLATE_MAP: Record<ProbingAxis, string> = {
  Z: 'plate-solid.txt',
  XYZ: 'plate-xyz.txt',
  XY: 'plate-xyz.txt',
  X: 'plate-xy.txt',
  Y: 'plate-xy.txt',
  'Center - Inner': 'plate-hole.txt',
  'Center - Outer': 'plate-solid.txt'
};

const CORNER_GROUPS: ProbeCorner[] = ['TopRight', 'TopLeft', 'BottomRight', 'BottomLeft'];
const SIDE_GROUPS = ['BottomLeft', 'TopLeft'];

export class DefaultPlateManager implements PlateManager {
  private scene: THREE.Scene;
  private render: () => void;
  private plateModel: THREE.Group | null = null;
  private currentAxis: ProbingAxis | null = null;
  private glowInterval: number | null = null;
  private currentScale = 1;

  constructor(scene: THREE.Scene, render: () => void) {
    this.scene = scene;
    this.render = render;
  }

  async ensurePlate(axis: ProbingAxis): Promise<THREE.Group> {
    if (this.currentAxis === axis && this.plateModel) {
      return this.plateModel;
    }

    await this.loadPlate(axis);
    this.currentAxis = axis;

    return this.plateModel!;
  }

  getPlate(): THREE.Group | null {
    return this.plateModel;
  }

  getBoundingBox(): THREE.Box3 | null {
    if (!this.plateModel) return null;
    return new THREE.Box3().setFromObject(this.plateModel);
  }

  getScale(): number {
    return this.currentScale;
  }

  highlightCorner(corner: ProbeCorner | null, accentColor: number): void {
    if (!this.plateModel) return;

    CORNER_GROUPS.forEach(group => {
      setGroupColor(this.plateModel!, group, DEFAULT_CORNER_COLOR);
    });

    if (corner) {
      setGroupColor(this.plateModel, corner, accentColor);
    }

    this.render();
  }

  highlightSide(axis: ProbingAxis, side: ProbeSide | null, accentColor: number): void {
    if (!this.plateModel) return;
    if (!['X', 'Y'].includes(axis)) {
      SIDE_GROUPS.forEach(group => setGroupColor(this.plateModel!, group, DEFAULT_SIDE_COLOR));
      this.render();
      return;
    }

    SIDE_GROUPS.forEach(group => setGroupColor(this.plateModel!, group, DEFAULT_SIDE_COLOR));

    if (side) {
      const targetGroup = this.getSideGroup(axis, side);
      setGroupColor(this.plateModel, targetGroup, accentColor);
    }

    this.render();
  }

  enableInnerGlow(enabled: boolean, accentColor: number): void {
    if (enabled) {
      this.startGlow('InnerEdge', accentColor);
    } else {
      this.stopGlow();
    }
  }

  reset(axis: ProbingAxis): void {
    if (!this.plateModel) return;

    this.plateModel.rotation.set(0, 0, 0);
    if (axis === 'X') {
      this.plateModel.rotation.z = Math.PI / 2;
    }

    // Clear highlighting states
    CORNER_GROUPS.forEach(group => setGroupColor(this.plateModel!, group, DEFAULT_CORNER_COLOR));
    SIDE_GROUPS.forEach(group => setGroupColor(this.plateModel!, group, DEFAULT_SIDE_COLOR));

    this.render();
  }

  dispose(): void {
    if (this.plateModel) {
      this.scene.remove(this.plateModel);
      this.disposeObject(this.plateModel);
      this.plateModel = null;
    }
    this.stopGlow();
    this.currentAxis = null;
    this.currentScale = 1;
  }

  private getSideGroup(axis: ProbingAxis, side: ProbeSide): string {
    if (axis === 'X') {
      return side === 'Left' ? 'TopLeft' : 'BottomLeft';
    }
    // axis === 'Y'
    return side === 'Front' ? 'BottomLeft' : 'TopLeft';
  }

  private async loadPlate(axis: ProbingAxis): Promise<void> {
    const file = AXIS_PLATE_MAP[axis];
    const cacheBust = `?t=${Date.now()}`;

    if (this.plateModel) {
      this.scene.remove(this.plateModel);
      this.disposeObject(this.plateModel);
      this.plateModel = null;
    }

    const object = await loadOBJWithGroups(
      `${file}${cacheBust}`,
      `plate.mtl${cacheBust}`,
      '/assets/probe/3d-probe/'
    );

    object.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        child.material.side = THREE.DoubleSide;
        child.material.color.setHex(DEFAULT_PLATE_COLOR);
      }
    });

    if (file === 'plate-xyz.txt') {
      CORNER_GROUPS.forEach(group => setGroupColor(object, group, DEFAULT_CORNER_COLOR));
    }

    if (file === 'plate-xy.txt') {
      SIDE_GROUPS.forEach(group => setGroupColor(object, group, DEFAULT_SIDE_COLOR));
    }

    this.scene.add(object);
    this.plateModel = object;

    this.scalePlate(axis);
    this.render();
  }

  private scalePlate(axis: ProbingAxis): void {
    if (!this.plateModel) return;

    const plateCenter = new THREE.Box3().setFromObject(this.plateModel).getCenter(new THREE.Vector3());
    const scale = getPlateScale(this.plateModel);

    this.plateModel.position.sub(plateCenter);
    this.plateModel.scale.setScalar(scale);
    this.plateModel.position.z += 3;
    this.currentScale = scale;

    if (axis === 'X') {
      this.plateModel.rotation.z = Math.PI / 2;
    }
  }

  private startGlow(groupName: string, accentColor: number): void {
    if (!this.plateModel) return;

    this.stopGlow();

    let increasing = true;
    let opacity = 0.3;
    const step = 0.05;

    this.glowInterval = window.setInterval(() => {
      if (!this.plateModel) return;

      if (increasing) {
        opacity += step;
        if (opacity >= 1) {
          opacity = 1;
          increasing = false;
        }
      } else {
        opacity -= step;
        if (opacity <= 0.3) {
          opacity = 0.3;
          increasing = true;
        }
      }

      applyToGroup(this.plateModel, groupName, (mesh) => {
        if (!mesh.material) return;
        mesh.material.transparent = true;
        mesh.material.opacity = opacity;
        mesh.material.emissive = new THREE.Color(accentColor);
        mesh.material.emissiveIntensity = opacity;
      });

      this.render();
    }, 50);
  }

  private stopGlow(): void {
    if (this.glowInterval) {
      clearInterval(this.glowInterval);
      this.glowInterval = null;
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
}
