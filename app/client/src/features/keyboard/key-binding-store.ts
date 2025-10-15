import { computed, reactive, readonly } from 'vue';
import { getSettings, updateSettings } from '@/lib/settings-store.js';
import type { KeyboardSettings, KeyboardState } from './types';
import { DEFAULT_KEY_BINDINGS } from './default-bindings';
import { normalizeCombo } from './keyboard-utils';

function cloneBindings(bindings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(bindings));
}

function sanitizeBindings(raw: any): Record<string, string> {
  if (!raw || typeof raw !== 'object') {
    return cloneBindings(DEFAULT_KEY_BINDINGS);
  }

  const sanitized: Record<string, string> = {};
  for (const [combo, action] of Object.entries(raw)) {
    if (typeof combo !== 'string' || typeof action !== 'string') {
      continue;
    }
    const normalized = normalizeCombo(combo);
    if (!normalized) {
      continue;
    }
    sanitized[normalized] = action;
  }

  if (Object.keys(sanitized).length === 0) {
    return cloneBindings(DEFAULT_KEY_BINDINGS);
  }

  return sanitized;
}

function sanitizeKeyboardSettings(raw: any): KeyboardSettings {
  const defaults: KeyboardSettings = {
    shortcutsEnabled: true,
    step: 1,
    xyFeedRate: 3000,
    zFeedRate: 1500
  };

  if (!raw || typeof raw !== 'object') {
    return { ...defaults };
  }

  const parsedStep = Number(raw.step);
  const parsedXY = Number(raw.xyFeedRate);
  const parsedZ = Number(raw.zFeedRate);

  return {
    shortcutsEnabled: raw.shortcutsEnabled !== false,
    step: Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : defaults.step,
    xyFeedRate: Number.isFinite(parsedXY) && parsedXY > 0 ? parsedXY : defaults.xyFeedRate,
    zFeedRate: Number.isFinite(parsedZ) && parsedZ > 0 ? parsedZ : defaults.zFeedRate
  };
}

const state = reactive<KeyboardState>({
  bindings: cloneBindings(DEFAULT_KEY_BINDINGS),
  settings: sanitizeKeyboardSettings(null),
  featureEnabled: true,
  captureMode: false,
  loaded: false
});

const runtimeJog = reactive({
  step: null as number | null,
  xyFeedRate: null as number | null,
  zFeedRate: null as number | null
});

const isFeatureEnabled = computed(() => state.featureEnabled);
const areShortcutsEnabled = computed(() => state.settings.shortcutsEnabled);
const isActive = computed(() => state.loaded && state.featureEnabled && state.settings.shortcutsEnabled);
const bindingsMap = computed(() => readonly(state.bindings));

async function persistBindings(next: Record<string, string>): Promise<void> {
  const previous = state.bindings;
  state.bindings = next;
  try {
    await updateSettings({ keyboardBindings: cloneBindings(next) });
  } catch (error) {
    state.bindings = previous;
    throw error;
  }
}

async function persistKeyboardSettings(next: KeyboardSettings): Promise<void> {
  const previous = { ...state.settings };
  state.settings = next;
  try {
    await updateSettings({ keyboard: { ...next } });
  } catch (error) {
    state.settings = previous;
    throw error;
  }
}

async function persistFeatureFlag(value: boolean): Promise<void> {
  const previous = state.featureEnabled;
  state.featureEnabled = value;
  try {
    await updateSettings({ features: { keyboardShortcuts: value } });
  } catch (error) {
    state.featureEnabled = previous;
    throw error;
  }
}

export const keyBindingStore = {
  state: readonly(state),
  isFeatureEnabled,
  areShortcutsEnabled,
  isActive,
  bindings: bindingsMap,

  bootstrap(): void {
    if (state.loaded) {
      return;
    }
    const settings = getSettings();
    state.featureEnabled = settings?.features?.keyboardShortcuts !== false;
    state.settings = sanitizeKeyboardSettings(settings?.keyboard);
    state.bindings = sanitizeBindings(settings?.keyboardBindings);
    state.loaded = true;
  },

  getBinding(combo: string | null | undefined): string | undefined {
    const normalized = normalizeCombo(combo ?? '');
    if (!normalized) {
      return undefined;
    }
    return state.bindings[normalized];
  },

  getBindingForAction(actionId: string): string | undefined {
    return Object.entries(state.bindings).find(([, action]) => action === actionId)?.[0];
  },

  getAllBindings(): Record<string, string> {
    return cloneBindings(state.bindings);
  },

  async assignBinding(actionId: string, combo: string): Promise<void> {
    const normalized = normalizeCombo(combo);
    if (!normalized) {
      throw new Error('Invalid key combination');
    }

    const next = cloneBindings(state.bindings);
    for (const [existingCombo, existingAction] of Object.entries(next)) {
      if (existingCombo === normalized || existingAction === actionId) {
        delete next[existingCombo];
      }
    }
    next[normalized] = actionId;
    await persistBindings(next);
  },

  async removeBinding(combo: string): Promise<void> {
    const normalized = normalizeCombo(combo);
    if (!normalized || !state.bindings[normalized]) {
      return;
    }

    const next = cloneBindings(state.bindings);
    delete next[normalized];
    await persistBindings(next);
  },

  async clearBindingForAction(actionId: string): Promise<void> {
    const next = cloneBindings(state.bindings);
    let dirty = false;
    for (const [combo, action] of Object.entries(next)) {
      if (action === actionId) {
        delete next[combo];
        dirty = true;
      }
    }

    if (dirty) {
      await persistBindings(next);
    }
  },

  async resetToDefaults(): Promise<void> {
    await persistBindings(cloneBindings(DEFAULT_KEY_BINDINGS));
  },

  async setShortcutsEnabled(value: boolean): Promise<void> {
    if (state.settings.shortcutsEnabled === value) {
      return;
    }
    await persistKeyboardSettings({ ...state.settings, shortcutsEnabled: value });
  },

  async setFeatureEnabled(value: boolean): Promise<void> {
    if (state.featureEnabled === value) {
      return;
    }
    await persistFeatureFlag(value);
  },

  async updateJogSettings(partial: Partial<Omit<KeyboardSettings, 'shortcutsEnabled'>>): Promise<void> {
    const next: KeyboardSettings = {
      ...state.settings,
      ...partial
    };
    if (next.step <= 0 || next.xyFeedRate <= 0 || next.zFeedRate <= 0) {
      throw new Error('Jog settings must be positive numbers');
    }
    await persistKeyboardSettings(next);
  },

  setCaptureMode(active: boolean): void {
    state.captureMode = active;
  },

  isCaptureMode(): boolean {
    return state.captureMode;
  },

  getStep(): number {
    return runtimeJog.step != null ? runtimeJog.step : state.settings.step;
  },

  getFeedRates(): { xyFeedRate: number; zFeedRate: number } {
    return {
      xyFeedRate: runtimeJog.xyFeedRate != null ? runtimeJog.xyFeedRate : state.settings.xyFeedRate,
      zFeedRate: runtimeJog.zFeedRate != null ? runtimeJog.zFeedRate : state.settings.zFeedRate
    };
  },

  updateRuntimeJogContext(context: { step: number; xyFeedRate: number; zFeedRate: number }): void {
    if (Number.isFinite(context.step) && context.step > 0) {
      runtimeJog.step = context.step;
    }
    if (Number.isFinite(context.xyFeedRate) && context.xyFeedRate > 0) {
      runtimeJog.xyFeedRate = context.xyFeedRate;
    }
    if (Number.isFinite(context.zFeedRate) && context.zFeedRate > 0) {
      runtimeJog.zFeedRate = context.zFeedRate;
    }
  },

  clearRuntimeJogContext(): void {
    runtimeJog.step = null;
    runtimeJog.xyFeedRate = null;
    runtimeJog.zFeedRate = null;
  }
};

function applySettingsDelta(delta: any) {
  if (!delta || typeof delta !== 'object') {
    return;
  }

  if (delta.keyboardBindings) {
    state.bindings = sanitizeBindings(delta.keyboardBindings);
  }

  if (delta.keyboard) {
    const merged = {
      ...state.settings,
      ...(typeof delta.keyboard === 'object' ? delta.keyboard : {})
    };
    state.settings = sanitizeKeyboardSettings(merged);
  }

  if (delta.features && typeof delta.features === 'object' && Object.prototype.hasOwnProperty.call(delta.features, 'keyboardShortcuts')) {
    state.featureEnabled = delta.features.keyboardShortcuts !== false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('settings-changed', (event: Event) => {
    const detail = (event as CustomEvent)?.detail;
    applySettingsDelta(detail);
  });
}
