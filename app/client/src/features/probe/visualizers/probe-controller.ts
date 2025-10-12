import type { Scene } from 'three';
import type {
  SelectionState,
  ProbeType,
  ProbingAxis,
  ProbeStrategy,
  ProbeStrategySupports,
  ProbeCorner,
  ProbeSide,
  PlateManager
} from './types';
import { DefaultPlateManager } from './plate-manager';
import { AutoZeroTouchStrategy } from './strategies/autozero-touch-strategy';
import { StandardBlockStrategy } from './strategies/standard-block-strategy';
import { ThreeDProbeStrategy } from './strategies/three-d-probe-strategy';

interface ControllerDeps {
  scene: Scene;
  render: () => void;
  getAccentColor: () => number;
}

export class ProbeController {
  private scene: Scene;
  private render: () => void;
  private getAccentColor: () => number;
  private plateManager: PlateManager;
  private strategy: ProbeStrategy | null = null;
  private loadToken = 0;

  constructor(deps: ControllerDeps) {
    this.scene = deps.scene;
    this.render = deps.render;
    this.getAccentColor = deps.getAccentColor;
    this.plateManager = new DefaultPlateManager(this.scene, this.render);
  }

  getPlateManager(): PlateManager {
    return this.plateManager;
  }

  getStrategy(): ProbeStrategy | null {
    return this.strategy;
  }

  async setProbeType(type: ProbeType, axis: ProbingAxis, selections: SelectionState): Promise<void> {
    const token = ++this.loadToken;

    if (this.strategy && this.strategy.type === type) {
      await this.ensurePlate(axis, selections, token, this.strategy.supports);
      if (token !== this.loadToken) return;
      await this.strategy.handleAxisChange(axis, selections);
      return;
    }

    if (this.strategy) {
      this.strategy.dispose();
      this.strategy = null;
    }

    const strategy = this.createStrategy(type);
    await this.ensurePlate(axis, selections, token, strategy.supports);
    const context = {
      scene: this.scene,
      render: this.render,
      plateManager: this.plateManager,
      getAccentColor: this.getAccentColor
    };

    await strategy.load(context);
    if (token !== this.loadToken) {
      strategy.dispose();
      return;
    }

    this.strategy = strategy;
    await this.strategy.handleAxisChange(axis, selections);
  }

  async handleAxisChange(axis: ProbingAxis, selections: SelectionState): Promise<void> {
    const token = ++this.loadToken;
    await this.ensurePlate(axis, selections, token, this.strategy?.supports ?? null);
    if (token !== this.loadToken) return;
    if (this.strategy) {
      await this.strategy.handleAxisChange(axis, selections);
    }
  }

  handleCornerChange(axis: ProbingAxis, corner: ProbeCorner | null): void {
    const accent = this.getAccentColor();
    if (corner && ['XYZ', 'XY'].includes(axis)) {
      this.plateManager.highlightCorner(corner, accent);
    } else {
      this.plateManager.highlightCorner(null, accent);
    }

    if (corner && this.strategy && this.strategy.supports.corners) {
      this.strategy.handleCornerChange(axis, corner);
    }
  }

  handleSideChange(axis: ProbingAxis, side: ProbeSide | null): void {
    const accent = this.getAccentColor();
    const supportsSide = this.strategy?.supports.sides?.includes(axis) ?? false;
    const targetSide = supportsSide ? side : null;
    this.plateManager.highlightSide(axis, targetSide, accent);
    if (supportsSide && side) {
      this.strategy?.handleSideChange(axis, side);
    }
  }

  handleProbeActiveChange(isActive: boolean): void {
    this.strategy?.handleProbeActiveChange(isActive);
  }

  dispose(): void {
    this.strategy?.dispose();
    this.strategy = null;
    this.plateManager.dispose();
  }

  private async ensurePlate(
    axis: ProbingAxis,
    selections: SelectionState,
    token: number,
    supports: ProbeStrategySupports | null
  ): Promise<void> {
    await this.plateManager.ensurePlate(axis);
    if (token !== this.loadToken) {
      return;
    }

    this.plateManager.reset(axis);

    const accent = this.getAccentColor();
    this.plateManager.enableInnerGlow(axis === 'Center - Inner', accent);

    const canHighlightCorner = Boolean(supports?.corners) && selections.corner && ['XYZ', 'XY'].includes(axis);
    if (canHighlightCorner) {
      this.plateManager.highlightCorner(selections.corner, accent);
    } else {
      this.plateManager.highlightCorner(null, accent);
    }

    const canHighlightSide = Boolean(supports?.sides?.includes(axis)) && selections.side;
    if (canHighlightSide) {
      this.plateManager.highlightSide(axis, selections.side, accent);
    } else {
      this.plateManager.highlightSide(axis, null, accent);
    }
  }

  private createStrategy(type: ProbeType): ProbeStrategy {
    switch (type) {
      case 'standard-block':
        return new StandardBlockStrategy();
      case 'autozero-touch':
        return new AutoZeroTouchStrategy();
      case '3d-probe':
      default:
        return new ThreeDProbeStrategy();
    }
  }
}
