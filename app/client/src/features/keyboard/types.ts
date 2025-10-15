export type KeyCombo = string;

export interface KeyboardSettings {
  shortcutsEnabled: boolean;
  step: number;
  xyFeedRate: number;
  zFeedRate: number;
}

export interface KeyboardState {
  bindings: Record<KeyCombo, string>;
  settings: KeyboardSettings;
  featureEnabled: boolean;
  captureMode: boolean;
  loaded: boolean;
}
