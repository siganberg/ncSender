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
