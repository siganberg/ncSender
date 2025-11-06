export type KeyCombo = string;

export interface KeyboardSettings {
  shortcutsEnabled: boolean;
}

export interface KeyboardState {
  bindings: Record<string, string | null>;  // ActionId -> KeyCombo (null = explicitly unset)
  settings: KeyboardSettings;
  featureEnabled: boolean;
  captureMode: boolean;
  loaded: boolean;
}
