// Main probing utilities router
// Delegates to specific probe type modules

import * as probe3D from './probing-3d-probe.js';
import * as probeStandardBlock from './probing-standard-block.js';
import * as probeAutozero from './probing-autozero-touch.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}] [PROBING-UTILS]`, ...args);
};

export const generateProbeCode = (options) => {
  const { probeType, probingAxis } = options;

  log('Generating probe code:', { probeType, probingAxis });

  if (probeType === '3d-probe') {
    return generate3DProbeCode(options);
  } else if (probeType === 'standard-block') {
    return generateStandardBlockCode(options);
  } else if (probeType === 'autozero-touch') {
    return generateAutozeroCode(options);
  }

  log('Unknown probe type:', probeType);
  return [];
};

function generate3DProbeCode(options) {
  const { probingAxis } = options;

  switch (probingAxis) {
    case 'Z':
      return probe3D.getZProbeRoutine(options.zOffset);
    case 'XYZ':
      return probe3D.getXYZProbeRoutine(options);
    case 'XY':
      return probe3D.getXYProbeRoutine(options);
    case 'X':
      return probe3D.getXProbeRoutine(options);
    case 'Y':
      return probe3D.getYProbeRoutine(options);
    case 'Center - Inner':
      return probe3D.getCenterInnerRoutine(options);
    case 'Center - Outer':
      return probe3D.getCenterOuterRoutine(options);
    default:
      log('Unknown 3D probe axis:', probingAxis);
      return [];
  }
}

function generateStandardBlockCode(options) {
  const { probingAxis } = options;

  switch (probingAxis) {
    case 'Z':
      return probeStandardBlock.getZProbeRoutine(options.zThickness);
    case 'XYZ':
      return probeStandardBlock.getXYZProbeRoutine(options);
    case 'XY':
      return probeStandardBlock.getXYProbeRoutine(options);
    case 'X':
      return probeStandardBlock.getXProbeRoutine(options);
    case 'Y':
      return probeStandardBlock.getYProbeRoutine(options);
    default:
      log('Unknown standard block probe axis:', probingAxis);
      return [];
  }
}

function generateAutozeroCode(options) {
  const { probingAxis } = options;

  switch (probingAxis) {
    case 'Z':
      return probeAutozero.getZProbeRoutine(options.selectedBitDiameter);
    case 'XYZ':
      return probeAutozero.getXYZProbeRoutine(options);
    case 'XY':
      return probeAutozero.getXYProbeRoutine(options);
    case 'X':
      return probeAutozero.getXProbeRoutine(options);
    case 'Y':
      return probeAutozero.getYProbeRoutine(options);
    default:
      log('Unknown AutoZero probe axis:', probingAxis);
      return [];
  }
}
