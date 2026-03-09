export class FluidNcProtocol {
  name = 'FluidNC';
  supportsSettingEnumeration = false;
  alarmFetchCommand = '$A';
  fullStatusRequestByte = null;

  matchesGreeting(line) {
    return line.toLowerCase().includes('fluidnc');
  }

  getInitCommands() {
    return ['$G', '$I', '$#'];
  }

  parseAlarmLine(line) {
    // FluidNC format: "N: Description" (e.g. "1: Hard Limit")
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const id = line.substring(0, colonIdx).trim();
      if (/^\d+$/.test(id)) {
        return { id, description: line.substring(colonIdx + 1).trim() };
      }
    }
    return null;
  }

  postProcessStatus(newStatus, _prevStatus) {
    // FluidNC has no H: field in status reports — always report as homed
    // so the UI doesn't gate on "homing required". Homing is up to the user.
    newStatus.homed = true;
  }

  normalizePinState(pn, _activeProbe) {
    // FluidNC reports Pn:P (probe) and Pn:T (TLS) natively — no normalization needed
    return pn;
  }
}
