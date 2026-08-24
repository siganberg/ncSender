/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { ref, computed } from 'vue';
import { api } from '../lib/api';

/**
 * GateDialog — server-owned blocking prompt broadcast to every client.
 *
 * The server is authoritative: this composable is a pure mirror of the
 * server's `gate:show` / `gate:close` / `gate:active` events. Responding
 * fires `gate:respond` back through the WebSocket; the server broadcasts
 * `gate:close` to everyone, which clears the gate from this store.
 *
 * State is module-scoped so App.vue mounts the host once and every caller
 * (composable, dev-tools, future pendant bridge) sees the same list.
 */

export interface GateButton {
  value: string;
  label: string;
  style?: 'primary' | 'danger' | 'secondary';
  isDefault?: boolean;
}

export interface Gate {
  gateId: string;
  title: string;
  message?: string;
  variant?: 'info' | 'warning' | 'danger' | 'success';
  buttons: GateButton[];
  source?: string;
}

const gates = ref<Gate[]>([]);

function upsertGate(gate: Gate): void {
  const idx = gates.value.findIndex((g) => g.gateId === gate.gateId);
  if (idx >= 0) {
    gates.value.splice(idx, 1, gate);
  } else {
    gates.value.push(gate);
  }
}

function removeGate(gateId: string): void {
  const idx = gates.value.findIndex((g) => g.gateId === gateId);
  if (idx >= 0) gates.value.splice(idx, 1);
}

let installed = false;

/**
 * Wire the composable to the WebSocket layer. Idempotent — safe to call
 * multiple times (from HMR, from tests, from App.vue defensively). Called
 * eagerly at module import time (see bottom of file) so listeners are in
 * place before the WebSocket's async `onopen` fires; the server's initial
 * `gate:active` catch-up message arrives while listeners are already
 * registered, letting a fresh page load see any open gate.
 */
export function installGateDialogListeners(): () => void {
  if (installed) return () => {};
  installed = true;

  const off1 = api.on('gate:show', (data: Gate) => {
    if (data?.gateId) upsertGate(data);
  });

  const off2 = api.on('gate:close', (data: { gateId: string }) => {
    if (data?.gateId) removeGate(data.gateId);
  });

  const off3 = api.on('gate:active', (data: { gates: Gate[] }) => {
    const incoming = Array.isArray(data?.gates) ? data.gates : [];
    gates.value = incoming.filter((g) => g && g.gateId);
  });

  return () => {
    off1?.();
    off2?.();
    off3?.();
    installed = false;
  };
}

// Register at module load time so the WS handshake's `gate:active` message
// isn't dropped between api.connect() and App.vue's onMounted. App.vue still
// calls installGateDialogListeners() defensively — it's a no-op after this.
installGateDialogListeners();

/**
 * Respond to a gate. Fires `gate:respond` at the server; the server
 * broadcasts `gate:close` to every client which clears local state.
 * Optimistically remove locally so the dialog dismisses immediately —
 * the incoming gate:close is then a no-op.
 */
export function respondToGate(gateId: string, value: string): void {
  removeGate(gateId);
  api.sendWebSocketMessage('gate:respond', { gateId, value });
}

export function useGateDialog() {
  return {
    gates,
    topGate: computed(() => gates.value[gates.value.length - 1] ?? null),
    respond: respondToGate,
  };
}
