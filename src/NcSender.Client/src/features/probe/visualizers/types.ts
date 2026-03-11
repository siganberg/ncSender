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

import type * as THREE from 'three';

export type ProbeType = '3d-probe' | 'standard-block' | 'autozero-touch';
export type ProbingAxis =
  | 'Z'
  | 'XYZ'
  | 'XY'
  | 'X'
  | 'Y'
  | 'Center - Inner'
  | 'Center - Outer';

export type ProbeCorner = 'TopRight' | 'TopLeft' | 'BottomRight' | 'BottomLeft';
export type ProbeSide = 'Left' | 'Right' | 'Front' | 'Back';

export interface SelectionState {
  corner: ProbeCorner | null;
  side: ProbeSide | null;
}

export interface PlateManager {
  ensurePlate(axis: ProbingAxis): Promise<THREE.Group>;
  getPlate(): THREE.Group | null;
  getBoundingBox(): THREE.Box3 | null;
  getScale(): number;
  highlightCorner(corner: ProbeCorner | null, accentColor: number): void;
  highlightSide(axis: ProbingAxis, side: ProbeSide | null, accentColor: number): void;
  enableInnerGlow(enabled: boolean, accentColor: number): void;
  reset(axis: ProbingAxis): void;
  dispose(): void;
}

export interface ProbeStrategyContext {
  scene: THREE.Scene;
  render: () => void;
  plateManager: PlateManager;
  getAccentColor: () => number;
}

export interface ProbeStrategySupports {
  corners: boolean;
  sides: ProbingAxis[];
}

export interface ProbeStrategy {
  readonly type: ProbeType;
  readonly supports: ProbeStrategySupports;
  load(context: ProbeStrategyContext): Promise<void>;
  dispose(): void;
  handleAxisChange(axis: ProbingAxis, selections: SelectionState): void | Promise<void>;
  handleCornerChange(axis: ProbingAxis, corner: ProbeCorner): void;
  handleSideChange(axis: ProbingAxis, side: ProbeSide): void;
  handleProbeActiveChange(isActive: boolean): void;
  getModel(): THREE.Object3D | null;
}

