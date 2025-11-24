import * as THREE from 'three';
import { setGroupColor } from '../../probe-mesh-utils';
import { loadOBJWithGroups } from '../../custom-obj-loader';
import type {
  ProbeStrategy,
  ProbeStrategyContext,
  ProbeStrategySupports,
  ProbingAxis,
  SelectionState,
  ProbeCorner,
  ProbeSide
} from '../types';

const AUTOZERO_TOUCH_X_OFFSET = -3.3;
const AUTOZERO_TOUCH_Y_OFFSET = -3.3;
const AUTOZERO_TOUCH_Z_POSITION = -0.95;

const cornerRotations: Record<ProbeCorner, number> = {
  BottomLeft: 0,
  TopLeft: -Math.PI / 2,
  TopRight: -Math.PI,
  BottomRight: -(3 * Math.PI) / 2
};

export class AutoZeroTouchStrategy implements ProbeStrategy {
  readonly type = 'autozero-touch';
  readonly supports: ProbeStrategySupports = {
    corners: true,
    sides: ['X', 'Y']
  };

  private context: ProbeStrategyContext | null = null;
  private probeModel: THREE.Group | null = null;

  async load(context: ProbeStrategyContext): Promise<void> {
    this.context = context;

    const modelPath = '/assets/probe/auto-touch/';
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

    setGroupColor(object, 'LED', 0xff0000);
    setGroupColor(object, 'Led', 0xff0000);
    setGroupColor(object, 'AutoPlate', 0xd3d3d3);

    this.centerProbe(object);
    this.positionDefault(object);

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
    if (!this.probeModel) return;

    if (['XYZ', 'XY'].includes(axis) && selections.corner) {
      this.moveToCorner(selections.corner);
    } else if ((axis === 'X' || axis === 'Y') && selections.side) {
      this.moveToSide(axis, selections.side);
    } else {
      this.positionDefault(this.probeModel);
    }

    this.context?.render();
  }

  handleCornerChange(axis: ProbingAxis, corner: ProbeCorner): void {
    if (!this.probeModel) return;
    if (!['XYZ', 'XY'].includes(axis)) return;
    this.moveToCorner(corner);
    this.context?.render();
  }

  handleSideChange(axis: ProbingAxis, side: ProbeSide): void {
    if (!this.probeModel) return;
    if (!((axis === 'X' && (side === 'Left' || side === 'Right')) || (axis === 'Y' && (side === 'Front' || side === 'Back')))) {
      return;
    }

    this.moveToSide(axis, side);
    this.context?.render();
  }

  handleProbeActiveChange(isActive: boolean): void {
    if (!this.probeModel) return;
    const ledColor = isActive ? 0x00ff00 : 0xff0000;
    setGroupColor(this.probeModel, 'LED', ledColor);
    setGroupColor(this.probeModel, 'Led', ledColor);
  }

  getModel(): THREE.Object3D | null {
    return this.probeModel;
  }

  private centerProbe(object: THREE.Object3D): void {
    if (!this.context) return;

    const bbox = new THREE.Box3().setFromObject(object);
    const center = bbox.getCenter(new THREE.Vector3());
    object.position.sub(center);

    const plateScale = this.context.plateManager.getScale();
    object.scale.multiplyScalar(plateScale);
  }

  private positionDefault(object: THREE.Object3D): void {
    object.position.x = AUTOZERO_TOUCH_X_OFFSET;
    object.position.y = AUTOZERO_TOUCH_Y_OFFSET;
    object.position.z = AUTOZERO_TOUCH_Z_POSITION;
    object.rotation.z = 0;
  }

  private moveToCorner(corner: ProbeCorner): void {
    if (!this.probeModel) return;

    const rotation = cornerRotations[corner];
    const { radius, initialAngle } = this.getDefaultPolar();
    const newAngle = initialAngle + rotation;

    this.probeModel.position.x = radius * Math.cos(newAngle);
    this.probeModel.position.y = radius * Math.sin(newAngle);
    this.probeModel.position.z = AUTOZERO_TOUCH_Z_POSITION;
    this.probeModel.rotation.z = rotation;
  }

  private moveToSide(axis: ProbingAxis, side: ProbeSide): void {
    if (!this.probeModel) return;

    const rotation = this.getSideRotation(axis, side);
    if (rotation === null) {
      this.positionDefault(this.probeModel);
      return;
    }

    const { radius, initialAngle } = this.getDefaultPolar();
    const newAngle = initialAngle + rotation;

    this.probeModel.position.x = radius * Math.cos(newAngle);
    this.probeModel.position.y = radius * Math.sin(newAngle);
    this.probeModel.position.z = AUTOZERO_TOUCH_Z_POSITION;
    this.probeModel.rotation.z = rotation;
  }

  private getSideRotation(axis: ProbingAxis, side: ProbeSide): number | null {
    if (axis === 'X') {
      if (side === 'Left') return 0;
      if (side === 'Right') return Math.PI / 2;
      return null;
    }

    if (axis === 'Y') {
      if (side === 'Front') return 0;
      if (side === 'Back') return -Math.PI / 2;
      return null;
    }

    return null;
  }

  private getDefaultPolar(): { radius: number; initialAngle: number } {
    const radius = Math.sqrt(
      AUTOZERO_TOUCH_X_OFFSET * AUTOZERO_TOUCH_X_OFFSET +
      AUTOZERO_TOUCH_Y_OFFSET * AUTOZERO_TOUCH_Y_OFFSET
    );
    const initialAngle = Math.atan2(AUTOZERO_TOUCH_Y_OFFSET, AUTOZERO_TOUCH_X_OFFSET);
    return { radius, initialAngle };
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
