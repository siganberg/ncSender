import { GrblHalProtocol } from './grblhal-protocol.js';
import { FluidNcProtocol } from './fluidnc-protocol.js';

const protocols = [
  new FluidNcProtocol(),
  new GrblHalProtocol()
];

export function detectProtocol(greetingLine) {
  for (const protocol of protocols) {
    if (protocol.matchesGreeting(greetingLine)) {
      return protocol;
    }
  }
  // Default to grblHAL for unrecognized Grbl-like greetings
  return new GrblHalProtocol();
}
