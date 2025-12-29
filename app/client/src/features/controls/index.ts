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

import { registerCoreKeyboardActions } from './actions';
import { keyBindingStore } from './key-binding-store';
import { gamepadBindingStore } from './gamepad-binding-store';
import { getKeyboardManager } from './keyboard-manager';
import { getGamepadManager } from './gamepad-manager';
import { useMacroStore } from '../macro/store';

export function initializeKeyboardShortcuts(): void {
  keyBindingStore.bootstrap();
  gamepadBindingStore.bootstrap();
  registerCoreKeyboardActions();
  getKeyboardManager();
  getGamepadManager();
  try {
    const macroStore = useMacroStore();
    macroStore.loadMacros?.().catch(() => {
      // Macro loading is non-critical for keyboard initialization
    });
  } catch (error) {
    console.warn('Failed to pre-load macros for keyboard shortcuts:', error);
  }
}

export { keyBindingStore } from './key-binding-store';
export { normalizeCombo, comboFromEvent } from './keyboard-utils';
