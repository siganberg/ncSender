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

const DEFAULT_GAMEPAD_BINDINGS: Record<string, string> = {
  JogXPlus: 'Axis 0+',
  JogXMinus: 'Axis 0-',
  JogYPlus: 'Axis 1+',
  JogYMinus: 'Axis 1-',
  JogZPlus: 'Axis 3+',
  JogZMinus: 'Axis 3-',
  SetJogStepSize0_1: 'Button 0',
  SetJogStepSize1: 'Button 1',
  SetJogStepSize10: 'Button 3'
};

function sanitizeBindings(raw: any): Record<string, string | null> {
  const result: Record<string, string | null> = {};

  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_GAMEPAD_BINDINGS };
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

  for (const [actionId, defaultBinding] of Object.entries(DEFAULT_GAMEPAD_BINDINGS)) {
    if (!(actionId in result)) {
      result[actionId] = defaultBinding;
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
    await persistBindings({ ...DEFAULT_GAMEPAD_BINDINGS });
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
