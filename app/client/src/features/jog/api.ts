import { api } from '../../lib/api.js';

// Convenience wrappers for jog operations.
export function jogStart(opts: { jogId: string; command: string; displayCommand?: string; axis: 'X'|'Y'|'Z'|'A'; direction: -1|1; feedRate: number; }) {
  return api.startJogSession(opts);
}

export function jogStop(jogId: string, reason: string = 'client-stop') {
  return api.stopJogSession(jogId, reason);
}

export function jogHeartbeat(jogId: string) {
  return api.sendJogHeartbeat(jogId);
}

export function jogStep(opts: { command: string; displayCommand?: string; axis: 'X'|'Y'|'Z'|'A'; direction: -1|1; feedRate: number; distance: number; commandId?: string; }) {
  return api.sendJogStep(opts);
}

export { api };
