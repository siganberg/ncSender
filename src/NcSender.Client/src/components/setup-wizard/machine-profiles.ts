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

// Known machines for the setup wizard. The list itself lives in
// siganberg/ncSender.machine-profiles and comes from /api/machine-profiles;
// these are its types and the rules for using it.

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

// Everything a profile may set: the settings the wizard edits or carries
// over. Whatever else a downloaded list holds is ignored.
const ALLOWED = new Set([
  '3', '5', '6', '20', '21', '22', '23', '24', '25', '26', '27', '40', '44', '45', '46',
  '100', '101', '102', '103', '110', '111', '112', '113', '120', '121', '122', '123',
  '130', '131', '132', '744', '745',
]);

// The build date in a grblHAL version string ("1.1f.20260525:"), or 0.
export function firmwareBuild(version: string | null | undefined): number {
  const m = /\.(\d{8})/.exec(version ?? '');
  return m ? Number(m[1]) : 0;
}

export function profilesFor(profiles: MachineProfile[], kind: string | null | undefined): MachineProfile[] {
  return profiles.filter(p => !!kind && Object.keys(p.firmware?.[kind as FirmwareKind] ?? {}).length > 0);
}

export function fitsBoard(profile: MachineProfile, board: string | null | undefined): boolean {
  const name = (board ?? '').toLowerCase();
  return !!name && !!profile.boards?.some(b => name.includes(b.toLowerCase()));
}

// The settings to write for this profile on this controller.
export function profileSettings(profile: MachineProfile, kind: FirmwareKind, build: number): Record<string, string> {
  const base = Object.fromEntries(Object.entries(profile.firmware[kind] ?? {}).filter(([id]) => ALLOWED.has(id)));
  if (kind === 'grblhal' && profile.newCore && build >= profile.newCore.minBuild) {
    for (const [id, value] of Object.entries(profile.newCore.values)) {
      if (id in base) base[id] = value;
    }
  }
  return base;
}
