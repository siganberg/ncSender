import { computed, reactive, readonly } from 'vue';
import { getSettings, updateSettings } from '@/lib/settings-store.js';
import type { GamepadBinding } from './gamepad-utils';
import { formatGamepadBinding, parseGamepadBinding } from './gamepad-utils';

export interface GamepadState {
  bindings: Record<string, string | null>;
  loaded: boolean;
}

function cloneBindings(bindings: Record<string, string | null>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(bindings));
}

function sanitizeBindings(raw: any): Record<string, string | null> {
  const result: Record<string, string | null> = {};

  if (!raw || typeof raw !== 'object') {
    return result;
  }

  for (const [actionId, bindingStr] of Object.entries(raw)) {
    if (typeof actionId !== 'string') {
      continue;
    }

    if (bindingStr === null) {
      result[actionId] = null;
      continue;
    }

    if (typeof bindingStr === 'string') {
      const parsed = parseGamepadBinding(bindingStr);
      if (parsed) {
        result[actionId] = bindingStr;
      }
    }
  }

  return result;
}

const state = reactive<GamepadState>({
  bindings: {},
  loaded: false
});

const bindingsMap = computed(() => readonly(state.bindings));

async function persistBindings(next: Record<string, string | null>, changedOnly = false): Promise<void> {
  const previous = state.bindings;
  state.bindings = next;
  try {
    if (changedOnly) {
      const changes: Record<string, string | null> = {};
      for (const [actionId, bindingStr] of Object.entries(next)) {
        if (previous[actionId] !== bindingStr) {
          changes[actionId] = bindingStr;
        }
      }
      if (Object.keys(changes).length > 0) {
        await updateSettings({ gamepadBindings: changes });
      }
    } else {
      await updateSettings({ gamepadBindings: cloneBindings(next) });
    }
  } catch (error) {
    state.bindings = previous;
    throw error;
  }
}

export const gamepadBindingStore = {
  state: readonly(state),
  bindings: bindingsMap,

  bootstrap(): void {
    if (state.loaded) {
      return;
    }
    const settings = getSettings();
    state.bindings = sanitizeBindings(settings?.gamepadBindings);
    state.loaded = true;
  },

  reload(): void {
    const settings = getSettings();
    state.bindings = sanitizeBindings(settings?.gamepadBindings);
  },

  getBinding(binding: GamepadBinding): string | undefined {
    const bindingStr = formatGamepadBinding(binding);
    return Object.entries(state.bindings).find(([, assignedBinding]) => assignedBinding === bindingStr)?.[0];
  },

  getBindingForAction(actionId: string): string | null | undefined {
    return state.bindings[actionId];
  },

  getAllBindings(): Record<string, string | null> {
    return cloneBindings(state.bindings);
  },

  async assignBinding(actionId: string, binding: GamepadBinding): Promise<void> {
    const bindingStr = formatGamepadBinding(binding);

    const next = cloneBindings(state.bindings);

    for (const [otherActionId, assignedBinding] of Object.entries(next)) {
      if (assignedBinding === bindingStr && otherActionId !== actionId) {
        next[otherActionId] = null;
      }
    }

    next[actionId] = bindingStr;
    await persistBindings(next, true);
  },

  async clearBindingForAction(actionId: string): Promise<void> {
    if (!state.bindings[actionId]) {
      return;
    }

    const next = cloneBindings(state.bindings);
    next[actionId] = null;
    await persistBindings(next, true);
  },

  async resetToDefaults(): Promise<void> {
    await persistBindings({});
  }
};

function applySettingsDelta(delta: any) {
  if (!delta || typeof delta !== 'object') {
    return;
  }

  if (delta.gamepadBindings) {
    for (const [actionId, bindingStr] of Object.entries(delta.gamepadBindings)) {
      if (typeof actionId !== 'string') {
        continue;
      }

      if (bindingStr === null) {
        state.bindings[actionId] = null;
      } else if (bindingStr === undefined) {
        delete state.bindings[actionId];
      } else if (typeof bindingStr === 'string') {
        const parsed = parseGamepadBinding(bindingStr);
        if (parsed) {
          state.bindings[actionId] = bindingStr;
        }
      }
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('settings-changed', (event: Event) => {
    const detail = (event as CustomEvent)?.detail;
    applySettingsDelta(detail);
  });
}
