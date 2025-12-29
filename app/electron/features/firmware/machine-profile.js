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

import fs from 'node:fs/promises';
import path from 'node:path';
import { getUserDataDir } from '../../utils/paths.js';

const FIRMWARE_FILENAME = 'firmware.json';

export async function readMachineProfileFromCache() {
  const userDir = getUserDataDir();
  const firmwarePath = path.join(userDir, FIRMWARE_FILENAME);
  try {
    const text = await fs.readFile(firmwarePath, 'utf8');
    const fw = JSON.parse(text);
    const settings = fw?.settings || {};

    // grbl/grblHAL standard IDs
    const vmax = {
      x: parseFloat(String(settings['110']?.value ?? '')),
      y: parseFloat(String(settings['111']?.value ?? '')),
      z: parseFloat(String(settings['112']?.value ?? ''))
    };
    const accel = {
      x: parseFloat(String(settings['120']?.value ?? '')),
      y: parseFloat(String(settings['121']?.value ?? '')),
      z: parseFloat(String(settings['122']?.value ?? ''))
    };
    const travel = {
      x: parseFloat(String(settings['130']?.value ?? '')),
      y: parseFloat(String(settings['131']?.value ?? '')),
      z: parseFloat(String(settings['132']?.value ?? ''))
    };

    const profile = {};
    // Junction deviation ($11) in mm (classic grbl). For grblHAL this may differ if remapped,
    // but firmware.json keeps the mapping unified for this controller build.
    const jd = parseFloat(String(settings['11']?.value ?? ''));
    if (Number.isFinite(vmax.x) || Number.isFinite(vmax.y) || Number.isFinite(vmax.z)) profile.vmaxMmPerMin = vmax;
    if (Number.isFinite(accel.x) || Number.isFinite(accel.y) || Number.isFinite(accel.z)) profile.accelMmPerSec2 = accel;
    if (Number.isFinite(travel.x) || Number.isFinite(travel.y) || Number.isFinite(travel.z)) profile.travelMm = travel;
    if (Number.isFinite(jd)) profile.junctionDeviationMm = jd;

    return profile;
  } catch {
    return {};
  }
}
