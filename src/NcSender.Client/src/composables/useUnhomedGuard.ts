/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { ref } from 'vue';
import { useAppStore } from './use-app-store';

// Commands that require the machine to be homed before running. Kept as a
// list so we can easily add more triggers later. Patterns match the token
// anywhere in the line, so "T1 M6" and "M6 T1" both trip.
const UNHOMED_BLACKLIST: RegExp[] = [
  /\bM0*6\b/i,   // tool change (M6, M06)
  /\$TLS\b/i,    // tool length setter
];

function needsHoming(command: string): boolean {
  return UNHOMED_BLACKLIST.some((re) => re.test(command));
}

// Module-scoped state so the dialog is a singleton — the same open flag drives
// the mount in App.vue regardless of who called ensureHomed().
const open = ref(false);
let resolver: ((ok: boolean) => void) | null = null;

// Ask the user to confirm running an action while the machine is unhomed.
// - Returns true immediately if the machine is homed.
// - If `commands` is provided, only prompts when at least one command is on
//   the blacklist. Callers that always want the prompt when unhomed can omit
//   the argument (e.g. wrap tool-button clicks that fire an implicit M6).
// - Returns true if the user chose Continue, false if they chose Abort.
// Every call re-prompts — no session memory.
export async function ensureHomed(commands?: string | string[]): Promise<boolean> {
  const store = useAppStore();
  if (store.isHomed.value) return true;
  if (commands !== undefined) {
    const list = Array.isArray(commands) ? commands : [commands];
    if (!list.some(needsHoming)) return true;
  }
  if (open.value && resolver) {
    // A dialog is already up from a concurrent action; wait on its result.
    return new Promise<boolean>((res) => {
      const prev = resolver!;
      resolver = (ok) => { prev(ok); res(ok); };
    });
  }
  return new Promise<boolean>((res) => {
    resolver = res;
    open.value = true;
  });
}

export function useUnhomedGuardDialog() {
  return {
    open,
    confirm: () => {
      const r = resolver;
      resolver = null;
      open.value = false;
      r?.(true);
    },
    abort: () => {
      const r = resolver;
      resolver = null;
      open.value = false;
      r?.(false);
    },
  };
}
