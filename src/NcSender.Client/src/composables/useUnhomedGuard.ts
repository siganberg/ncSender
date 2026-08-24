/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { useAppStore } from './use-app-store';
import { getApiBaseUrl } from '../lib/api-base';

// Commands that require the machine to be homed before running. Kept as a
// client-side fast-path — the server has an authoritative copy of the same
// list and will re-check on POST /api/gate/ensure-homed.
const UNHOMED_BLACKLIST: RegExp[] = [
  /\bM0*6\b/i,   // tool change (M6, M06)
  /\$TLS\b/i,    // tool length setter
];

function needsHoming(command: string): boolean {
  return UNHOMED_BLACKLIST.some((re) => re.test(command));
}

// Ask the user to confirm running an action while the machine is unhomed.
// - Returns true immediately if the machine is homed (client-side fast path).
// - If `commands` is provided, only prompts when at least one is blacklisted.
// - Otherwise defers to the server: opens a GateDialog broadcast to every
//   connected client (browser tabs + pendant), and returns true iff the user
//   chose "Continue" on any client.
//
// Concurrent callers share one gate on the server (Key: "safety.unhomed")
// so two fast M6 clicks show one prompt, not two.
export async function ensureHomed(commands?: string | string[]): Promise<boolean> {
  const store = useAppStore();
  if (store.isHomed.value) return true;

  const list = commands === undefined
    ? undefined
    : (Array.isArray(commands) ? commands : [commands]);
  if (list && !list.some(needsHoming)) return true;

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/gate/ensure-homed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: list ?? null }),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return !!body?.proceed;
  } catch {
    return false;                     // network failure = don't run the command
  }
}
