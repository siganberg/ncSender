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

// Convenience wrappers for jog operations.
export function jogStart(opts: { jogId: string; command: string; displayCommand?: string; axis: 'X'|'Y'|'Z'|'A'; direction: -1|1; feedRate: number; }) {
  return api.startJogSession(opts);
}

export function jogStop(jogId: string, reason: string = 'client-stop') {
  return api.stopJogSession(jogId, reason);
}

export function jogHeartbeat(jogId: string) {
  return api.sendJogHeartbeat(jogId);
}

export function jogStep(opts: { command: string; displayCommand?: string; axis: 'X'|'Y'|'Z'|'A'; direction: -1|1; feedRate: number; distance: number; commandId?: string; }) {
  return api.sendJogStep(opts);
}

export { api };
