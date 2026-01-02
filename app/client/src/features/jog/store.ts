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

  // $22 home cycle bitmask: bit 0 = enabled, bit 1 = single axis, bit 2 = startup required, bit 3 = set origin
  // Note: homeCycle is on serverState.machineState (the object), not status.machineState (the string)
  const homeCycle = computed(() => app.serverState.machineState?.homeCycle ?? 7);
  const homingEnabled = computed(() => (homeCycle.value & 1) === 1);

  return {
    isConnected: app.isConnected,
    isHomed: app.isHomed,
    isProbing: app.isProbing,
    machineState: computed(() => app.serverState.machineState),
    senderStatus: app.senderStatus,
    homeCycle,
    homingEnabled
  };
}
