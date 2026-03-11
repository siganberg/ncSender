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

// Action ID -> Key Combo mapping
// null value means the action is explicitly unset
export const DEFAULT_KEY_BINDINGS: Record<string, string | null> = {
  JogYPlus: 'ArrowUp',
  JogYMinus: 'ArrowDown',
  JogXMinus: 'ArrowLeft',
  JogXPlus: 'ArrowRight',
  JogZPlus: 'PageUp',
  JogZMinus: 'PageDown',
  JobStart: 'Shift+~',
  JobPause: 'Shift+!',
  JobStop: 'Shift+@',
  CycleSteps: 'Shift+Z',
  'SetStep0.1': 'Shift+X',
  SetStep1: 'Shift+C',
  SetStep10: 'Shift+V'
};

export const FALLBACK_ACTIONS = new Set(Object.keys(DEFAULT_KEY_BINDINGS));
