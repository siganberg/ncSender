// Auxiliary output providers.
//
// An auxiliary output is saved as its "on" command. Each kind of output is a
// provider that recognises its own "on" command and knows the matching "off"
// command. Settings and the visualizer switches only ever ask
// auxOffCommand(on); a new kind of output is a new entry in PROVIDERS.

interface AuxOutputProvider {
  /** The "off" command for this "on" command, or null if it isn't this kind. */
  off(on: string): string | null;
}

// --- Wireless I/O -----------------------------------------------------
//
// The bridge (device "xio") has four switched outputs, OUT1..OUT4 on the board,
// out 0..3 on the wire. Its "on" command is the G-code sentinel
// "(DONGLE:xio:out <n> 1)", so the same text also works in a macro. A switch
// sends it like any command: the server relays it to the bridge, and plugin
// guards (the Pneumatic ATC refuses a clamp release while the spindle runs)
// see it on the way.

export const BRIDGE_DEVICE = 'xio';
export const BRIDGE_OUTPUT_COUNT = 4;

const BRIDGE_COMMAND = /^\(DONGLE:xio:out\s+(\d+)\s+([01])\)$/i;

export const bridgeOnCommand = (index: number): string => `(DONGLE:${BRIDGE_DEVICE}:out ${index} 1)`;

/** Output index of a bridge "on" command, or null for anything else. */
export function bridgeOutputIndex(command: string | undefined | null): number | null {
  const m = (command || '').trim().match(BRIDGE_COMMAND);
  return m && m[2] === '1' ? Number(m[1]) : null;
}

/** What the bridge is told for an on/off command ("out 2 1"), or null. */
export function bridgePayload(command: string | undefined | null): string | null {
  const m = (command || '').trim().match(BRIDGE_COMMAND);
  return m ? `out ${m[1]} ${m[2]}` : null;
}

/** Output states from a bridge status or edge line ("… out0=1 out1=0 …"). */
export function parseBridgeOutputs(payload: string | undefined | null): Record<number, boolean> {
  const states: Record<number, boolean> = {};
  for (const m of (payload || '').matchAll(/\bout(\d+)=([01])\b/g)) states[Number(m[1])] = m[2] === '1';
  return states;
}

// --- Providers ----------------------------------------------------------------

const PROVIDERS: AuxOutputProvider[] = [
  // Controller coolant pins.
  { off: (on) => (on === 'M7' || on === 'M8' ? 'M9' : null) },
  // Controller aux output: M64 P<n> -> M65 P<n>.
  {
    off: (on) => {
      const m = on.match(/M64\s+(P\d+)/i);
      return m ? `M65 ${m[1]}` : null;
    },
  },
  // Wireless I/O output.
  {
    off: (on) => {
      const index = bridgeOutputIndex(on);
      return index === null ? null : `(DONGLE:${BRIDGE_DEVICE}:out ${index} 0)`;
    },
  },
];

/** The "off" command for an auxiliary output's "on" command ('' if unknown). */
export function auxOffCommand(on: string | undefined | null): string {
  if (!on) return '';
  for (const provider of PROVIDERS) {
    const off = provider.off(on);
    if (off !== null) return off;
  }
  return '';
}
