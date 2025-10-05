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

export { api };
