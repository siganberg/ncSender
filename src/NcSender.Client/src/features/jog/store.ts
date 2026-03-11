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

import { computed } from 'vue';
import { useAppStore } from '../../composables/use-app-store';

// Feature-scoped jog store exposing only what JogPanel needs.
export function useJogStore() {
  const app = useAppStore();

  return {
    isConnected: app.isConnected,
    isHomed: app.isHomed,
    homingCycle: app.homingCycle,
    isProbing: app.isProbing,
    machineState: computed(() => app.status.machineState),
    senderStatus: app.senderStatus
  };
}
