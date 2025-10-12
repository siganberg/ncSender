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

const STANDARD_BLOCK_SCALE = 200;

export class StandardBlockStrategy implements ProbeStrategy {
  readonly type = 'standard-block';
  readonly supports: ProbeStrategySupports = {
    corners: true,
    sides: ['X', 'Y']
  };

  private context: ProbeStrategyContext | null = null;
  private probeModel: THREE.Group | null = null;
  private scaledSize: THREE.Vector3 | null = null;

  async load(context: ProbeStrategyContext): Promise<void> {
    this.context = context;

    const modelPath = '/assets/probe/standard-block/';
    const modelName = 'cnc-pointer';
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

    setGroupColor(object, 'LED', 0x00ff00);
    setGroupColor(object, 'Body', 0xe8e8e8);
    setGroupColor(object, 'Nut', 0x606060);

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
    this.scaledSize = null;
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

    this.setCenteredHeight(axis);
    this.probeModel.position.x = 0;
    this.probeModel.position.y = 0;
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
    setGroupColor(this.probeModel, 'LED', ledColor);
  }

  getModel(): THREE.Object3D | null {
    return this.probeModel;
  }

  private moveToCorner(axis: ProbingAxis, corner: ProbeCorner): void {
    if (!this.context || !this.probeModel || !this.scaledSize) return;
    const plate = this.context.plateManager.getPlate();
    if (!plate) return;

    const inset = axis === 'XY' ? -1 : 2;
    const { x, y } = getCornerPosition(plate, corner, { inset });
    const z = axis === 'XY' ? this.scaledSize.z / 2 - 1 : this.scaledSize.z / 2;

    this.probeModel.position.set(x, y, z);
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

  private setCenteredHeight(axis: ProbingAxis): void {
    if (!this.probeModel) return;
    const z = axis === 'Center - Inner' ? 0 : 4;
    this.probeModel.position.z = z;
  }

  private centerProbe(object: THREE.Object3D): void {
    const bbox = new THREE.Box3().setFromObject(object);
    const center = bbox.getCenter(new THREE.Vector3());
    object.position.sub(center);
    object.scale.multiplyScalar(STANDARD_BLOCK_SCALE);

    const scaledBBox = new THREE.Box3().setFromObject(object);
    this.scaledSize = scaledBBox.getSize(new THREE.Vector3());
    object.position.z += this.scaledSize.z / 2;
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
