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

