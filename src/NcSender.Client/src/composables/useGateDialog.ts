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
 * The server is authoritative. This composable is a pure mirror of the
 * server's `gate:show` / `gate:close` / `gate:active` events. Responding
 * fires `gate:respond`; the server broadcasts `gate:close`, clearing the
 * gate from this store on every client.
 *
 * Steps advance with `gate:step-fire`: the server dispatches the step's
 * commands to the controller and rebroadcasts `gate:show` with an
 * incremented stepProgress — every client stays in sync.
 *
 * Listeners register at module import time, not on component mount, so the
 * WebSocket's initial `gate:active` handshake message (fired by the server
 * on connect) isn't dropped between api.connect() and Vue mounting.
 */

export interface GateButton {
  value: string;
  label: string;
  style?: 'primary' | 'danger' | 'secondary';
  isDefault?: boolean;
  requiresStepsComplete?: boolean;
}

export interface GateStep {
  value: string;
  label: string;
  commands: string[];
}

export interface GateStepConfig {
  holdMs?: number;
  countdownSec?: number;
  chainSteps?: boolean;
}

export interface Gate {
  gateId: string;
  title: string;
  message?: string;
  messageHtml?: boolean;
  variant?: 'info' | 'warning' | 'danger' | 'success';
  buttons: GateButton[];
  steps?: GateStep[];
  stepProgress?: number;
  stepConfig?: GateStepConfig;
  source?: string;
}

const gates = ref<Gate[]>([]);

function upsertGate(gate: Gate): void {
  const idx = gates.value.findIndex((g) => g.gateId === gate.gateId);
  if (idx >= 0) gates.value.splice(idx, 1, gate);
  else           gates.value.push(gate);
}

function removeGate(gateId: string): void {
  const idx = gates.value.findIndex((g) => g.gateId === gateId);
  if (idx >= 0) gates.value.splice(idx, 1);
}

let installed = false;

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

export function respondToGate(gateId: string, value: string): void {
  removeGate(gateId);                    // optimistic local close
  api.sendWebSocketMessage('gate:respond', { gateId, value });
}

export function fireStep(gateId: string, stepIndex: number): void {
  api.sendWebSocketMessage('gate:step-fire', { gateId, stepIndex });
}

export function useGateDialog() {
  return {
    gates,
    topGate: computed(() => gates.value[gates.value.length - 1] ?? null),
    respond: respondToGate,
    fireStep,
  };
}

// Eager registration — see docblock. installGateDialogListeners is idempotent.
installGateDialogListeners();
