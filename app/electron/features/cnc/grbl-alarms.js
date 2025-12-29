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

// Standard GRBL/grblHAL alarm codes
// These are fallback descriptions when alarms.json is not available
export const grblAlarms = {
  1: 'Hard limit has been triggered. Machine position is likely lost due to sudden halt. Re-homing is highly recommended.',
  2: 'Soft limit alarm. G-code motion target exceeds machine travel. Machine position retained. Alarm may be safely unlocked.',
  3: 'Reset/E-stop while in motion. Machine position is likely lost due to sudden halt. Re-homing is highly recommended.',
  4: 'Probe fail. Probe is not in the expected initial state before starting probe cycle when G38.2 and G38.3 is not triggered and G38.4 and G38.5 is triggered.',
  5: 'Probe fail. Probe did not contact the workpiece within the programmed travel for G38.2 and G38.4.',
  6: 'Homing fail. The active homing cycle was reset.',
  7: 'Homing fail. Safety door was opened during homing cycle.',
  8: 'Homing fail. Pull off travel failed to clear limit switch. Try increasing pull-off setting or check wiring.',
  9: 'Homing fail. Could not find limit switch within search distances. Try increasing max travel, decreasing pull-off distance, or check wiring.',
  10: 'EStop asserted. Clear and reset',
  11: 'Homing required. Execute homing command ($H) to continue.',
  12: 'Limit switch engaged. Clear before continuing.',
  13: 'Probe protection triggered. Clear before continuing.',
  14: 'Spindle at speed timeout. Clear before continuing.',
  15: 'Homing fail. Could not find second limit switch for auto squared axis within search distances. Try increasing max travel, decreasing pull-off distance, or check wiring.',
  16: 'Power on selftest (POS) failed.',
  17: 'Motor fault.',
  18: 'Homing fail. Bad configuration.'
};
