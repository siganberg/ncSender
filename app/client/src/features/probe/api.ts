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

export interface ProbeOptions {
  probingAxis: string;
  probeSelectedCorner?: string | null;
  probeSelectedSide?: string | null;
  probeBallPointDiameter: number;
  probeZPlunge: number;
  probeZOffset: number;
  probeXDimension?: number;
  probeYDimension?: number;
  probeRapidMovement: number;
  probeZFirst?: boolean;
}

/**
 * Start a probing operation
 */
export async function startProbe(options: ProbeOptions) {
  const response = await fetch(`${api.baseUrl}/api/probe/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start probing operation');
  }

  return response.json();
}

/**
 * Stop/abort probing operation
 */
export async function stopProbe() {
  const response = await fetch(`${api.baseUrl}/api/probe/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to stop probing operation');
  }

  return response.json();
}

// Re-export the main API singleton for convenience
export { api };
