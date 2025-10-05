import { api } from '../../lib/api.js';

// Real-time override commands (see GRBL v1.1 spec)
export const REALTIME = {
  FEED_RESET: String.fromCharCode(0x90),
  FEED_PLUS_10: String.fromCharCode(0x91),
  FEED_MINUS_10: String.fromCharCode(0x92),
  FEED_PLUS_1: String.fromCharCode(0x93),
  FEED_MINUS_1: String.fromCharCode(0x94),
  SPINDLE_RESET: String.fromCharCode(0x99),
  SPINDLE_PLUS_10: String.fromCharCode(0x9A),
  SPINDLE_MINUS_10: String.fromCharCode(0x9B),
  SPINDLE_PLUS_1: String.fromCharCode(0x9C),
  SPINDLE_MINUS_1: String.fromCharCode(0x9D)
};

export function sendRealtime(command: string) {
  return api.sendCommandViaWebSocket({ command });
}

export function zeroXY() {
  return api.sendCommandViaWebSocket({ command: 'G10 L20 X0 Y0', displayCommand: 'G10 L20 X0 Y0' });
}

export function zeroAxis(axis: 'X'|'Y'|'Z'|'A') {
  const a = String(axis).toUpperCase();
  return api.sendCommandViaWebSocket({ command: `G10 L20 ${a}0`, displayCommand: `G10 L20 ${a}0` });
}

export { api };
