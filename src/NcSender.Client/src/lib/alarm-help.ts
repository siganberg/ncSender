/**
 * Friendly alarm messaging for the visualizer alarm dialog.
 *
 * The controller's own alarm text (grblHAL `$EA`) is terse and written for
 * developers. This table adds a plain-language title and a short "how to
 * fix it" line per alarm code. The controller text is still shown as the
 * detail so nothing is lost.
 */
export interface AlarmHelp {
  title: string;
  fix: string;
}

const ALARM_HELP: Record<number, AlarmHelp> = {
  1: {
    title: 'Hard limit hit',
    fix: 'A limit switch was triggered while moving. Unlock, then re-home the machine before continuing. Position may be lost.',
  },
  2: {
    title: 'Move outside machine travel',
    fix: 'The job or jog asked for a position beyond the machine limits. Unlock, then check the work zero and job size. Position is retained.',
  },
  3: {
    title: 'Reset while moving',
    fix: 'The machine was reset or E-stopped during motion. Unlock, then re-home before continuing. Position may be lost.',
  },
  4: {
    title: 'Probe already triggered',
    fix: 'The probe was touching before the cycle started. Lift the tool off the probe or check for a shorted probe wire, then unlock and retry.',
  },
  5: {
    title: 'Probe did not make contact',
    fix: 'Nothing was touched within the probing distance. Check the probe is connected and positioned under the tool, then unlock and retry.',
  },
  6: {
    title: 'Homing was interrupted',
    fix: 'The homing cycle was reset before it finished. Unlock, then run homing again.',
  },
  7: {
    title: 'Door opened during homing',
    fix: 'Close the safety door, unlock, then run homing again.',
  },
  8: {
    title: 'Homing pull-off failed',
    fix: 'An axis could not back off its limit switch. Check the switch and wiring or increase the pull-off distance ($27), then re-home.',
  },
  9: {
    title: 'Limit switch not found',
    fix: 'An axis travelled its full search distance without hitting a switch. Check the switch and wiring or the max travel settings ($130-$132), then re-home.',
  },
  10: {
    title: 'Emergency stop pressed',
    fix: 'Release the E-stop button, then press Unlock. Re-home afterwards if the machine was moving.',
  },
  11: {
    title: 'Homing required',
    fix: 'The machine does not know where it is. Unlock, then press Home before jogging or running a job.',
  },
  12: {
    title: 'Limit switch engaged',
    fix: 'An axis is sitting on a limit switch. Unlock, jog away from the switch, then continue.',
  },
  13: {
    title: 'Probe protection triggered',
    fix: 'The probe touched something while not probing. Move the tool clear of the probe, then unlock.',
  },
  14: {
    title: 'Spindle did not reach speed',
    fix: 'The spindle failed to reach the commanded RPM in time. Check the VFD and spindle, then unlock and retry.',
  },
  15: {
    title: 'Second limit switch not found',
    fix: 'The auto-squared axis could not find its second switch. Check both switches and wiring, then re-home.',
  },
  16: {
    title: 'Controller self-test failed',
    fix: 'The controller failed its power-on check. Power-cycle the controller. If it repeats, check the board and drivers.',
  },
  17: {
    title: 'Motor fault',
    fix: 'A motor driver reported a fault. If this appeared right after enabling the motor fault inputs, the input reads backwards: invert that axis in $745 (Settings > Firmware, or the setup wizard), then unlock. Otherwise check the motor wiring and driver temperature, power-cycle, then re-home.',
  },
  18: {
    title: 'Homing not configured correctly',
    fix: 'Homing settings are invalid. Check the homing configuration ($22, $23, $44-$47) before homing again.',
  },
  19: {
    title: 'Modbus communication error',
    fix: 'The controller lost contact with the VFD. Check the RS485 cable and VFD power, then unlock.',
  },
  20: {
    title: 'I/O expander not responding',
    fix: 'The controller could not talk to its I/O expander. Check its wiring and power-cycle the controller.',
  },
  21: {
    title: 'Controller storage failure',
    fix: 'The controller could not read or write its settings memory. Power-cycle it. If it repeats, the board may need service.',
  },
};

/**
 * Alarm with no code. Typical right after power-on: grblHAL boots into the
 * alarm state (E-stop latched, homing required, limit engaged) without ever
 * sending an ALARM:N line, so the only hint is the pin state in the status
 * report. Fall back to a generic "power-on" message with the E-stop cycle
 * most boards need before they will unlock.
 */
const POWER_ON_CHECK: AlarmHelp = {
  title: 'Power-on safety check',
  fix: 'Press the E-stop button in, release it, then press Unlock. The controller asks for this once after every power-on to confirm the E-stop works.',
};

function getUnknownAlarmHelp(pins: string): AlarmHelp {
  if (pins.includes('E')) return POWER_ON_CHECK;
  if (pins.includes('D')) {
    return {
      title: 'Safety door open',
      fix: 'Close the door, then press Unlock.',
    };
  }
  if (/[XYZABC]/.test(pins)) return ALARM_HELP[12];
  // Many grblHAL boards (Sienci SLB and others) boot into an alarm with no
  // code and insist on one E-stop cycle first, so the user proves the E-stop
  // works before the machine will move.
  return POWER_ON_CHECK;
}

/**
 * @param code        alarm code from the controller, if any
 * @param pins        Pn pin-state string from the status report
 * @param fromStartup the code was only seen in the status-report substate
 *                    (board was already alarmed when we connected), never as an
 *                    ALARM:N line raised while connected. Alarm 10 in that
 *                    state is the power-on E-stop latch, not a pressed button.
 */
export function getAlarmHelp(
  code: number | string | null | undefined,
  pins = '',
  fromStartup = false,
): AlarmHelp | null {
  const n = typeof code === 'string' ? parseInt(code, 10) : code;
  if (n == null || !Number.isFinite(n)) return getUnknownAlarmHelp(pins);
  if (n === 10 && fromStartup) return POWER_ON_CHECK;
  return ALARM_HELP[n] ?? null;
}
