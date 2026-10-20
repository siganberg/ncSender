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

// Known machines for the setup wizard. Each profile holds the controller
// settings the wizard edits (travel, motors, inputs, homing, limits) plus a
// few homing ones it only carries over ($23-$26, $44-$46), per firmware.
// Nothing else: network, spindle and VFD settings stay as the board has them.
//
// Sienci Labs numbers are the ones gSender ships as its machine defaults
// (src/app/src/features/Config/assets/MachineDefaults, GPLv3).

export type FirmwareKind = 'grblhal' | 'grbl' | 'fluidnc';

export interface NewCoreOverride {
  // grblHAL build from which these values replace the profile's own.
  minBuild: number;
  values: Record<string, string>;
}

export interface MachineProfile {
  id: string;
  brand: string;
  model: string;
  size: string;
  // Board names this machine ships with, as $I reports them; a board matches
  // when its name contains one ("SuperLongBoard" matches "SuperLongBoard Ext").
  boards?: string[];
  // Settings by firmware, as `$id` without the `$`. A profile shows only for
  // the firmware it has settings for.
  firmware: Partial<Record<FirmwareKind, Record<string, string>>>;
  newCore?: NewCoreOverride;
}

// SuperLongBoard firmware from build 20250627 (the ATCi core) reads the probe
// and toolsetter inversion as a pair and the motor fault inputs inverted.
const SLB_NEW_CORE: NewCoreOverride = { minBuild: 20250627, values: { '6': '3', '745': '15' } };

const SLB = ['SuperLongBoard'];
const SLB_EXT = ['SuperLongBoard Ext'];

export const MACHINE_PROFILES: MachineProfile[] = [
  {
    id: 'altmill-2x4', brand: 'Sienci Labs', model: 'AltMill', size: '2x4', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '6', '5': '15', '6': '1', '20': '1', '21': '1', '22': '79', '23': '1', '24': '150', '25': '4300', '26': '25', '27': '1.5', '40': '1', '44': '4', '45': '3', '46': '0', '100': '320', '101': '320', '102': '200', '103': '79.0123', '110': '15000', '111': '15000', '112': '6000', '113': '8000', '120': '1500', '121': '1500', '122': '1500', '123': '1000', '130': '1260', '131': '648', '132': '170', '744': '15', '745': '0' } },
  },
  {
    id: 'altmill-4x4', brand: 'Sienci Labs', model: 'AltMill', size: '4x4', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '6', '5': '15', '6': '1', '20': '1', '21': '1', '22': '79', '23': '1', '24': '150', '25': '4300', '26': '25', '27': '1.5', '40': '1', '44': '4', '45': '3', '46': '0', '100': '320', '101': '320', '102': '200', '103': '79.0123', '110': '15000', '111': '15000', '112': '6000', '113': '8000', '120': '1500', '121': '1500', '122': '1500', '123': '1000', '130': '1260', '131': '1248', '132': '170', '744': '15', '745': '0' } },
  },
  {
    id: 'altmill-4x8', brand: 'Sienci Labs', model: 'AltMill', size: '4x8', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '6', '5': '15', '6': '1', '20': '1', '21': '1', '22': '79', '23': '1', '24': '150', '25': '4300', '26': '25', '27': '1.5', '40': '1', '44': '4', '45': '3', '46': '0', '100': '320', '101': '214.4403444', '102': '200', '103': '79.0123', '110': '15000', '111': '25000', '112': '6000', '113': '8000', '120': '1500', '121': '1500', '122': '1500', '123': '1000', '130': '1260', '131': '2661', '132': '220', '744': '15', '745': '0' } },
  },
  {
    id: 'longmill-mk3-30x30', brand: 'Sienci Labs', model: 'LongMill MK3', size: '30x30', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '6', '5': '15', '6': '3', '20': '1', '21': '1', '22': '79', '23': '9', '24': '150', '25': '4300', '26': '25', '27': '2', '40': '1', '44': '4', '45': '2', '46': '1', '100': '100', '101': '100', '102': '100', '103': '79.01235', '110': '7000', '111': '7000', '112': '4000', '113': '8000', '120': '750', '121': '750', '122': '750', '123': '1000', '130': '805', '131': '830', '132': '129' } },
  },
  {
    id: 'longmill-mk3-48x30', brand: 'Sienci Labs', model: 'LongMill MK3', size: '48x30', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '6', '5': '15', '6': '3', '20': '1', '21': '1', '22': '79', '23': '9', '24': '150', '25': '4300', '26': '25', '27': '2', '40': '1', '44': '4', '45': '2', '46': '1', '100': '100', '101': '100', '102': '100', '103': '79.01235', '110': '7000', '111': '7000', '112': '4000', '113': '8000', '120': '750', '121': '750', '122': '750', '123': '1000', '130': '1296', '131': '830', '132': '129' } },
  },
  {
    id: 'longmill-mk2-12x30', brand: 'Sienci Labs', model: 'LongMill MK2', size: '12x30', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '6', '5': '15', '6': '1', '20': '0', '21': '0', '22': '0', '23': '11', '24': '150', '25': '4300', '26': '25', '27': '1.5', '40': '0', '44': '4', '45': '3', '46': '0', '100': '800', '101': '800', '102': '800', '103': '79.01234568', '110': '4000', '111': '4000', '112': '4000', '113': '8000', '120': '750', '121': '750', '122': '750', '123': '1000', '130': '810', '131': '355', '132': '120' } },
  },
  {
    id: 'longmill-mk2-30x30', brand: 'Sienci Labs', model: 'LongMill MK2', size: '30x30', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '6', '5': '15', '6': '1', '20': '0', '21': '0', '22': '0', '23': '11', '24': '150', '25': '4300', '26': '25', '27': '1.5', '40': '0', '44': '4', '45': '3', '46': '0', '100': '800', '101': '800', '102': '800', '103': '79.01234568', '110': '4000', '111': '4000', '112': '4000', '113': '8000', '120': '750', '121': '750', '122': '750', '123': '1000', '130': '810', '131': '855', '132': '120' } },
  },
  {
    id: 'longmill-mk2-48x30', brand: 'Sienci Labs', model: 'LongMill MK2', size: '48x30', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '6', '5': '15', '6': '1', '20': '0', '21': '0', '22': '0', '23': '11', '24': '150', '25': '4300', '26': '25', '27': '1.5', '40': '0', '44': '4', '45': '3', '46': '0', '100': '800', '101': '800', '102': '800', '103': '79.01234568', '110': '4000', '111': '4000', '112': '4000', '113': '8000', '120': '750', '121': '750', '122': '750', '123': '1000', '130': '1270', '131': '855', '132': '120' } },
  },
  {
    id: 'longmill-mk1-12x12', brand: 'Sienci Labs', model: 'LongMill MK1', size: '12x12', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '2', '5': '15', '6': '1', '20': '0', '21': '0', '22': '0', '23': '11', '24': '150', '25': '4300', '26': '25', '27': '1.5', '40': '0', '44': '4', '45': '3', '46': '0', '100': '800', '101': '800', '102': '800', '103': '79.01234568', '110': '4000', '111': '4000', '112': '4000', '113': '8000', '120': '750', '121': '750', '122': '750', '123': '1000', '130': '285', '131': '320', '132': '110' } },
  },
  {
    id: 'longmill-mk1-12x30', brand: 'Sienci Labs', model: 'LongMill MK1', size: '12x30', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '2', '5': '15', '6': '1', '20': '0', '21': '0', '22': '0', '23': '11', '24': '150', '25': '4300', '26': '25', '27': '1.5', '40': '0', '44': '4', '45': '3', '46': '0', '100': '800', '101': '800', '102': '800', '103': '79.01234568', '110': '4000', '111': '4000', '112': '4000', '113': '8000', '120': '750', '121': '750', '122': '750', '123': '1000', '130': '770', '131': '320', '132': '110' } },
  },
  {
    id: 'longmill-mk1-30x30', brand: 'Sienci Labs', model: 'LongMill MK1', size: '30x30', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '2', '5': '15', '6': '1', '20': '0', '21': '0', '22': '0', '23': '11', '24': '150', '25': '4300', '26': '25', '27': '1.5', '40': '0', '44': '4', '45': '3', '46': '0', '100': '800', '101': '800', '102': '800', '103': '79.01234568', '110': '4000', '111': '4000', '112': '4000', '113': '8000', '120': '750', '121': '750', '122': '750', '123': '1000', '130': '770', '131': '820', '132': '110' } },
  },
  {
    id: 'longmill-mk1-48x30', brand: 'Sienci Labs', model: 'LongMill MK1', size: '48x30', newCore: SLB_NEW_CORE, boards: SLB,
    firmware: { grblhal: { '3': '2', '5': '15', '6': '1', '20': '0', '21': '0', '22': '0', '23': '11', '24': '150', '25': '4300', '26': '25', '27': '1.5', '40': '0', '44': '4', '45': '3', '46': '0', '100': '800', '101': '800', '102': '800', '103': '79.01234568', '110': '4000', '111': '4000', '112': '4000', '113': '8000', '120': '750', '121': '750', '122': '750', '123': '1000', '130': '1230', '131': '820', '132': '110' } },
  },
  // Onefinity on the SuperLongBoard Ext with closed-loop motors. No settings
  // yet, so they stay out of the list until a real machine's $$ fills them.
  {
    id: 'onefinity-journeyman-slb-ext', brand: 'Onefinity', model: 'Journeyman', size: 'SLB-EXT', boards: SLB_EXT,
    firmware: {},
  },
  {
    id: 'onefinity-foreman-slb-ext', brand: 'Onefinity', model: 'Foreman', size: 'SLB-EXT', boards: SLB_EXT,
    firmware: {},
  },
];

// The build date in a grblHAL version string ("1.1f.20260525:"), or 0.
export function firmwareBuild(version: string | null | undefined): number {
  const m = /\.(\d{8})/.exec(version ?? '');
  return m ? Number(m[1]) : 0;
}

export function profilesFor(kind: string | null | undefined): MachineProfile[] {
  return MACHINE_PROFILES.filter(p => !!kind && !!p.firmware[kind as FirmwareKind]);
}

export function fitsBoard(profile: MachineProfile, board: string | null | undefined): boolean {
  const name = (board ?? '').toLowerCase();
  return !!name && !!profile.boards?.some(b => name.includes(b.toLowerCase()));
}

// The settings to write for this profile on this controller.
export function profileSettings(profile: MachineProfile, kind: FirmwareKind, build: number): Record<string, string> {
  const base = { ...(profile.firmware[kind] ?? {}) };
  if (kind === 'grblhal' && profile.newCore && build >= profile.newCore.minBuild) {
    for (const [id, value] of Object.entries(profile.newCore.values)) {
      if (id in base) base[id] = value;
    }
  }
  return base;
}
