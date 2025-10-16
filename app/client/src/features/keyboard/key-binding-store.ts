import { computed, reactive, readonly } from 'vue';
import { getSettings, updateSettings } from '@/lib/settings-store.js';
import type { KeyboardSettings, KeyboardState } from './types';
import { DEFAULT_KEY_BINDINGS } from './default-bindings';
import { normalizeCombo } from './keyboard-utils';

function cloneBindings(bindings: Record<string, string | null>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(bindings));
}

function sanitizeBindings(raw: any): Record<string, string | null> {
  // Start with defaults
  const result = cloneBindings(DEFAULT_KEY_BINDINGS);

  // If no saved settings, return defaults
  if (!raw || typeof raw !== 'object') {
    return result;
  }

  // Merge saved settings over defaults
  for (const [actionId, combo] of Object.entries(raw)) {
    if (typeof actionId !== 'string') {
      continue;
    }

    // null means explicitly unset
    if (combo === null) {
      result[actionId] = null;
      continue;
    }

    // Validate and normalize the combo
    if (typeof combo === 'string') {
      const normalized = normalizeCombo(combo);
      if (normalized) {
        result[actionId] = normalized;
      }
    }
  }

  return result;
}

function sanitizeKeyboardSettings(raw: any): KeyboardSettings {
  const defaults: KeyboardSettings = {
    shortcutsEnabled: true
  };

  if (!raw || typeof raw !== 'object') {
    return { ...defaults };
  }

  return {
    shortcutsEnabled: raw.shortcutsEnabled !== false
  };
}

const state = reactive<KeyboardState>({
  bindings: cloneBindings(DEFAULT_KEY_BINDINGS),
  settings: sanitizeKeyboardSettings(null),
  featureEnabled: true,
  captureMode: false,
  loaded: false
});

const isFeatureEnabled = computed(() => state.featureEnabled);
const areShortcutsEnabled = computed(() => state.settings.shortcutsEnabled);
const isActive = computed(() => state.loaded && state.featureEnabled && state.settings.shortcutsEnabled);
const bindingsMap = computed(() => readonly(state.bindings));

async function persistBindings(next: Record<string, string | null>, changedOnly = false): Promise<void> {
  const previous = state.bindings;
  state.bindings = next;
  try {
    if (changedOnly) {
      // Only send the changed bindings (for efficiency)
      const changes: Record<string, string | null> = {};
      for (const [actionId, combo] of Object.entries(next)) {
        if (previous[actionId] !== combo) {
          changes[actionId] = combo;
        }
      }
      if (Object.keys(changes).length > 0) {
        await updateSettings({ keyboardBindings: changes });
      }
    } else {
      // Send all bindings (for reset to defaults)
      await updateSettings({ keyboardBindings: cloneBindings(next) });
    }
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

  reload(): void {
    const settings = getSettings();
    state.featureEnabled = settings?.features?.keyboardShortcuts !== false;
    state.settings = sanitizeKeyboardSettings(settings?.keyboard);
    state.bindings = sanitizeBindings(settings?.keyboardBindings);
  },

  getBinding(combo: string | null | undefined): string | undefined {
    const normalized = normalizeCombo(combo ?? '');
    if (!normalized) {
      return undefined;
    }
    // Find action that has this combo assigned
    return Object.entries(state.bindings).find(([, assignedCombo]) => assignedCombo === normalized)?.[0];
  },

  getBindingForAction(actionId: string): string | null | undefined {
    return state.bindings[actionId];
  },

  getAllBindings(): Record<string, string | null> {
    return cloneBindings(state.bindings);
  },

  async assignBinding(actionId: string, combo: string): Promise<void> {
    const normalized = normalizeCombo(combo);
    if (!normalized) {
      throw new Error('Invalid key combination');
    }

    const next = cloneBindings(state.bindings);

    // Check if this combo is already assigned to another action
    for (const [otherActionId, assignedCombo] of Object.entries(next)) {
      if (assignedCombo === normalized && otherActionId !== actionId) {
        // Unset the other action
        next[otherActionId] = null;
      }
    }

    // Assign the combo to this action
    next[actionId] = normalized;
    await persistBindings(next, true);  // Only send changes
  },

  async removeBinding(combo: string): Promise<void> {
    const normalized = normalizeCombo(combo);
    if (!normalized) {
      return;
    }

    const next = cloneBindings(state.bindings);
    // Find action with this combo and set to null
    for (const [actionId, assignedCombo] of Object.entries(next)) {
      if (assignedCombo === normalized) {
        next[actionId] = null;
        await persistBindings(next, true);  // Only send changes
        return;
      }
    }
  },

  async clearBindingForAction(actionId: string): Promise<void> {
    if (!state.bindings[actionId]) {
      return;
    }

    const next = cloneBindings(state.bindings);
    next[actionId] = null;
    await persistBindings(next, true);  // Only send changes
  },

  async deleteBindingForAction(actionId: string): Promise<void> {
    if (!state.bindings[actionId]) {
      return;
    }

    const next = cloneBindings(state.bindings);
    delete next[actionId];
    // Send full bindings to ensure the key is actually removed from the server
    await persistBindings(next, false);
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

  setCaptureMode(active: boolean): void {
    state.captureMode = active;
  },

  isCaptureMode(): boolean {
    return state.captureMode;
  }
};

function applySettingsDelta(delta: any) {
  if (!delta || typeof delta !== 'object') {
    return;
  }

  if (delta.keyboardBindings) {
    // Merge delta bindings into current state (don't replace entire state)
    for (const [actionId, combo] of Object.entries(delta.keyboardBindings)) {
      if (typeof actionId !== 'string') {
        continue;
      }

      if (combo === null) {
        state.bindings[actionId] = null;
      } else if (combo === undefined) {
        // undefined means delete the key entirely
        delete state.bindings[actionId];
      } else if (typeof combo === 'string') {
        const normalized = normalizeCombo(combo);
        if (normalized) {
          state.bindings[actionId] = normalized;
        }
      }
    }
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
