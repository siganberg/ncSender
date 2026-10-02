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
import type { ProbeCorner, ProbeSide, ProbingAxis } from './types';

export interface CornerPositionOptions {
  inset: number;
}

export const getCornerPosition = (
  plate: THREE.Object3D,
  corner: ProbeCorner,
  { inset }: CornerPositionOptions
): { x: number; y: number } => {
  const plateBBox = new THREE.Box3().setFromObject(plate);
  const plateMin = plateBBox.min;
  const plateMax = plateBBox.max;

  switch (corner) {
    case 'BottomRight':
      return { x: plateMax.x - inset, y: plateMin.y + inset };
    case 'BottomLeft':
      return { x: plateMin.x + inset, y: plateMin.y + inset };
    case 'TopRight':
      return { x: plateMax.x - inset, y: plateMax.y - inset };
    case 'TopLeft':
    default:
      return { x: plateMin.x + inset, y: plateMax.y - inset };
  }
};

// How far outside the material's edge the probe's centre sits when probing a
// side (X or Y): close enough that it reads as touching that edge.
const SIDE_GAP = 1.2;

export const getSidePosition = (
  plate: THREE.Object3D,
  axis: ProbingAxis,
  side: ProbeSide
): { x: number; y: number } => {
  const plateBBox = new THREE.Box3().setFromObject(plate);
  const plateMin = plateBBox.min;
  const plateMax = plateBBox.max;

  if (axis === 'X') {
    return {
      x: side === 'Left' ? plateMin.x - SIDE_GAP : plateMax.x + SIDE_GAP,
      y: 0
    };
  }

  if (axis === 'Y') {
    return {
      x: 0,
      y: side === 'Front' ? plateMin.y - SIDE_GAP : plateMax.y + SIDE_GAP
    };
  }

  return { x: 0, y: 0 };
};

export const getPlateScale = (plate: THREE.Object3D): number => {
  const bbox = new THREE.Box3().setFromObject(plate);
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  return maxDim === 0 ? 1 : 10 / maxDim;
};

