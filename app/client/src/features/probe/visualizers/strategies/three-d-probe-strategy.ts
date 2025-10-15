import * as THREE from 'three';
import { setGroupColor } from '../../probe-mesh-utils';
import { loadOBJWithGroups } from '../../custom-obj-loader';
import { getCornerPosition, getSidePosition } from '../geometry';
import type {
  ProbeStrategy,
  ProbeStrategyContext,
  ProbeStrategySupports,
  ProbingAxis,
  SelectionState,
  ProbeCorner,
  ProbeSide
} from '../types';

export class ThreeDProbeStrategy implements ProbeStrategy {
  readonly type = '3d-probe';
  readonly supports: ProbeStrategySupports = {
    corners: true,
    sides: ['X', 'Y']
  };

  private context: ProbeStrategyContext | null = null;
  private probeModel: THREE.Group | null = null;

  async load(context: ProbeStrategyContext): Promise<void> {
    this.context = context;

    const modelPath = '/assets/probe/3d-probe/';
    const modelName = '3dprobe';
    const cacheBust = `?t=${Date.now()}`;

    const object = await loadOBJWithGroups(
      `${modelName}.txt${cacheBust}`,
      `${modelName}.mtl${cacheBust}`,
      modelPath
    );

    object.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        child.material.side = THREE.DoubleSide;
      }
    });

    setGroupColor(object, 'Led', 0x00ff00);
    setGroupColor(object, 'Body', 0x606060);

    this.centerProbe(object);

    this.probeModel = object;
    context.scene.add(object);
    context.render();
  }

  dispose(): void {
    if (!this.context || !this.probeModel) return;

    this.context.scene.remove(this.probeModel);
    this.disposeObject(this.probeModel);
    this.probeModel = null;
  }

  async handleAxisChange(axis: ProbingAxis, selections: SelectionState): Promise<void> {
    if (!this.context || !this.probeModel) return;

    const plate = this.context.plateManager.getPlate();
    if (!plate) return;

    if (['XYZ', 'XY'].includes(axis) && selections.corner) {
      this.moveToCorner(axis, selections.corner);
      return;
    }

    if ((axis === 'X' || axis === 'Y') && selections.side) {
      this.moveToSide(axis, selections.side);
      return;
    }

    if (axis === 'Center - Inner') {
      this.probeModel.position.set(0, 0, 1.5);
    } else {
      this.probeModel.position.set(0, 0, 4);
    }

    this.context.render();
  }

  handleCornerChange(axis: ProbingAxis, corner: ProbeCorner): void {
    if (!this.context || !this.probeModel) return;
    if (!['XYZ', 'XY'].includes(axis)) return;
    this.moveToCorner(axis, corner);
  }

  handleSideChange(axis: ProbingAxis, side: ProbeSide): void {
    if (!this.context || !this.probeModel) return;
    if (!(axis === 'X' || axis === 'Y')) return;
    this.moveToSide(axis, side);
  }

  handleProbeActiveChange(isActive: boolean): void {
    if (!this.probeModel) return;
    const ledColor = isActive ? 0xff0000 : 0x00ff00;
    setGroupColor(this.probeModel, 'Led', ledColor);
  }

  getModel(): THREE.Object3D | null {
    return this.probeModel;
  }

  private moveToCorner(axis: ProbingAxis, corner: ProbeCorner): void {
    if (!this.context || !this.probeModel) return;
    const plate = this.context.plateManager.getPlate();
    if (!plate) return;

    const inset = axis === 'XY' ? -1 : 1.7;
    const { x, y } = getCornerPosition(plate, corner, { inset });

    this.probeModel.position.set(x, y, axis === 'XY' ? 1 : 3);
    this.context.render();
  }

  private moveToSide(axis: ProbingAxis, side: ProbeSide): void {
    if (!this.context || !this.probeModel) return;
    const plate = this.context.plateManager.getPlate();
    if (!plate) return;

    const { x, y } = getSidePosition(plate, axis, side);
    this.probeModel.position.set(x, y, 1);
    this.context.render();
  }

  private centerProbe(object: THREE.Object3D): void {
    if (!this.context) return;

    const bbox = new THREE.Box3().setFromObject(object);
    const center = bbox.getCenter(new THREE.Vector3());
    object.position.sub(center);

    const plateScale = this.context.plateManager.getScale();
    object.scale.multiplyScalar(plateScale);
    object.position.z += 4;
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

