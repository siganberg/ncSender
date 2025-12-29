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

import { api } from '../../lib/api.js';

// Real-time override commands (see GRBL v1.1 spec)
export const REALTIME = {
  FEED_RESET: String.fromCharCode(0x90),
  FEED_PLUS_10: String.fromCharCode(0x91),
  FEED_MINUS_10: String.fromCharCode(0x92),
  FEED_PLUS_1: String.fromCharCode(0x93),
  FEED_MINUS_1: String.fromCharCode(0x94),
  SPINDLE_RESET: String.fromCharCode(0x99),
  SPINDLE_PLUS_10: String.fromCharCode(0x9A),
  SPINDLE_MINUS_10: String.fromCharCode(0x9B),
  SPINDLE_PLUS_1: String.fromCharCode(0x9C),
  SPINDLE_MINUS_1: String.fromCharCode(0x9D)
};

// Human-readable labels for realtime commands
const REALTIME_LABELS: Record<string, string> = {
  [REALTIME.FEED_RESET]: 'Feed Override: Reset to 100%',
  [REALTIME.FEED_PLUS_10]: 'Feed Override: +10%',
  [REALTIME.FEED_MINUS_10]: 'Feed Override: -10%',
  [REALTIME.FEED_PLUS_1]: 'Feed Override: +1%',
  [REALTIME.FEED_MINUS_1]: 'Feed Override: -1%',
  [REALTIME.SPINDLE_RESET]: 'Spindle Override: Reset to 100%',
  [REALTIME.SPINDLE_PLUS_10]: 'Spindle Override: +10%',
  [REALTIME.SPINDLE_MINUS_10]: 'Spindle Override: -10%',
  [REALTIME.SPINDLE_PLUS_1]: 'Spindle Override: +1%',
  [REALTIME.SPINDLE_MINUS_1]: 'Spindle Override: -1%'
};

export function sendRealtime(command: string) {
  const hex = '0x' + command.charCodeAt(0).toString(16).toUpperCase();
  const label = REALTIME_LABELS[command] || 'Realtime command';
  const displayCommand = `${hex} (${label})`;
  return api.sendCommandViaWebSocket({ command, displayCommand, meta: { sourceId: 'client' } });
}

export function zeroXY() {
  return api.sendCommandViaWebSocket({ command: 'G10 L20 X0 Y0', displayCommand: 'G10 L20 X0 Y0', meta: { sourceId: 'client' } });
}

export function zeroAxis(axis: 'X'|'Y'|'Z'|'A') {
  const a = String(axis).toUpperCase();
  return api.sendCommandViaWebSocket({ command: `G10 L20 ${a}0`, displayCommand: `G10 L20 ${a}0`, meta: { sourceId: 'client' } });
}

export { api };
