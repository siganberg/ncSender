export class GrblHalProtocol {
  name = 'grblHAL';
  supportsSettingEnumeration = true;
  alarmFetchCommand = '$EA';
  fullStatusRequestByte = 0x87;

  matchesGreeting(line) {
    return line.toLowerCase().startsWith('grblhal');
  }

  getInitCommands() {
    return ['$G', '$I', '$#'];
  }

  parseAlarmLine(line) {
    // grblHAL format: [ALARMCODE:N||Description]
    const match = line.match(/\[ALARMCODE:(\d+)\|\|(.*?)\]/);
    if (match) {
      return { id: match[1], description: match[2].trim() };
    }
    return null;
  }

  postProcessStatus(newStatus, prevStatus) {
    // grblHAL: homing detected via Home → Idle transition (H: field handles the rest)
    if (prevStatus === 'Home' && newStatus.status === 'Idle') {
      newStatus.homed = true;
    }
  }

  normalizePinState(pn, activeProbe) {
    // grblHAL maps P:0→Probe, P:1→TLS, no P:→both
    if (activeProbe === 0) {
      return pn.replace('T', '');
    } else if (activeProbe === 1) {
      return pn.replace('P', '').replace('T', '') + (pn.includes('P') ? '' : '') + 'T';
    }
    return pn;
  }
}
