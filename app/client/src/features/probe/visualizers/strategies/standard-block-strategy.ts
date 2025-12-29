/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

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

const STANDARD_BLOCK_X_OFFSET = -3.8;
const STANDARD_BLOCK_Y_OFFSET = -3.8;
const STANDARD_BLOCK_Z_POSITION = -0.95;
const STANDARD_BLOCK_SCALE_MULTIPLIER = 0.6;
const XY_AXIS_RADIAL_OFFSET = 0.018;
const XY_AXIS_Z_OFFSET = -0.02;

const cornerRotations: Record<ProbeCorner, number> = {
  BottomLeft: 0,
  TopLeft: -Math.PI / 2,
  TopRight: -Math.PI,
  BottomRight: -(3 * Math.PI) / 2
};

export class StandardBlockStrategy implements ProbeStrategy {
  readonly type = 'standard-block';
  readonly supports: ProbeStrategySupports = {
    corners: true,
    sides: ['X', 'Y']
  };

  private context: ProbeStrategyContext | null = null;
  private probeModel: THREE.Group | null = null;

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

    setGroupColor(object, 'LED', 0x5cb85c);
    setGroupColor(object, 'Body', 0xe8e8e8);
    setGroupColor(object, 'Nut', 0x606060);

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
      this.moveToCorner(axis, selections.corner);
    } else if ((axis === 'X' || axis === 'Y') && selections.side) {
      this.moveToSide(axis, selections.side);
    } else {
      this.positionDefault(this.probeModel);
      this.resetProbeGroups();
    }

    this.context?.render();
  }

  handleCornerChange(axis: ProbingAxis, corner: ProbeCorner): void {
    if (!this.probeModel) return;
    if (!['XYZ', 'XY'].includes(axis)) return;
    this.moveToCorner(axis, corner);
    this.context?.render();
  }

  handleSideChange(axis: ProbingAxis, side: ProbeSide): void {
    if (!this.probeModel) return;
    if (!((axis === 'X' && (side === 'Left' || side === 'Right')) || (axis === 'Y' && (side === 'Front' || side === 'Back')))) {
      this.resetProbeGroups();
      return;
    }

    this.moveToSide(axis, side);
    this.context?.render();
  }

  handleProbeActiveChange(isActive: boolean): void {
    if (!this.probeModel) return;
    const ledColor = isActive ? 0xff0000 : 0x5cb85c;
    setGroupColor(this.probeModel, 'LED', ledColor);
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
    object.scale.multiplyScalar(plateScale * STANDARD_BLOCK_SCALE_MULTIPLIER);
  }

  private positionDefault(object: THREE.Object3D): void {
    object.position.x = STANDARD_BLOCK_X_OFFSET;
    object.position.y = STANDARD_BLOCK_Y_OFFSET;
    object.position.z = STANDARD_BLOCK_Z_POSITION;
    object.rotation.z = 0;
  }

  private moveToCorner(axis: ProbingAxis, corner: ProbeCorner): void {
    if (!this.probeModel) return;

    const rotation = cornerRotations[corner];
    const { radius, initialAngle } = this.getDefaultPolar();
    const newAngle = initialAngle + rotation;

    this.probeModel.position.x = radius * Math.cos(newAngle);
    this.probeModel.position.y = radius * Math.sin(newAngle);
    this.probeModel.position.z = STANDARD_BLOCK_Z_POSITION;
    this.probeModel.rotation.z = rotation;

    const isXYAxis = axis === 'XY';
    if (isXYAxis) {
      this.moveProbeGroups(corner, XY_AXIS_RADIAL_OFFSET, XY_AXIS_Z_OFFSET);
    } else {
      this.resetProbeGroups();
    }
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
    this.probeModel.position.z = STANDARD_BLOCK_Z_POSITION;
    this.probeModel.rotation.z = rotation;

    this.moveSpindleForSide(axis, side);
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
      STANDARD_BLOCK_X_OFFSET * STANDARD_BLOCK_X_OFFSET +
      STANDARD_BLOCK_Y_OFFSET * STANDARD_BLOCK_Y_OFFSET
    );
    const initialAngle = Math.atan2(STANDARD_BLOCK_Y_OFFSET, STANDARD_BLOCK_X_OFFSET);
    return { radius, initialAngle };
  }

  private moveProbeGroups(corner: ProbeCorner, radialOffset: number, zOffset: number): void {
    if (!this.probeModel) return;

    this.probeModel.traverse((child) => {
      if (child.name === 'Nut' || child.name === 'LED' || child.name === 'Body') {
        child.position.x = -radialOffset;
        child.position.y = -radialOffset;
        child.position.z = zOffset;
      }
    });
  }

  private resetProbeGroups(): void {
    if (!this.probeModel) return;

    this.probeModel.traverse((child) => {
      if (child.name === 'Nut' || child.name === 'LED' || child.name === 'Body') {
        child.position.set(0, 0, 0);
      }
    });
  }

  private moveSpindleForSide(axis: ProbingAxis, side: ProbeSide): void {
    if (!this.probeModel) return;

    let offsetX = 0;
    let offsetY = 0;

    if (axis === 'X') {
      if (side === 'Left') {
        offsetX = -XY_AXIS_RADIAL_OFFSET;
        offsetY = 0;
      } else if (side === 'Right') {
        offsetX = 0;
        offsetY = -XY_AXIS_RADIAL_OFFSET;
      }
    } else if (axis === 'Y') {
      if (side === 'Front') {
        offsetX = 0;
        offsetY = -XY_AXIS_RADIAL_OFFSET;
      } else if (side === 'Back') {
        offsetX = -XY_AXIS_RADIAL_OFFSET;
        offsetY = 0;
      }
    }

    this.probeModel.traverse((child) => {
      if (child.name === 'Nut' || child.name === 'LED' || child.name === 'Body') {
        child.position.x = offsetX;
        child.position.y = offsetY;
        child.position.z = XY_AXIS_Z_OFFSET;
      }
    });
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
