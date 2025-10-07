// Probing utilities for 3D touch probe
// Based on gSender implementation

/**
 * Generate G-code for Center - Inner (Auto Endmill) probing
 * @param {Object} options - Probing options
 * @returns {Array} Array of G-code commands
 */
export const getCenterInnerRoutine = ({ xDimension, yDimension, rapidMovement }) => {
  const code = [];
  const xOff = xDimension / 2;
  const yOff = yDimension / 2;

  code.push(
    '; Probe Center - Inner (Auto Endmill)',
    `%X_OFF = ${xOff}`,
    `%Y_OFF = ${yOff}`,
    '%PROBE_DELAY=0.15',
    'G21 G91',
    'G38.2 Z-25 F200',
    'G21 G91 G0 Z2.5',
    'G38.2 Z-5 F75',
    'G4 P[PROBE_DELAY]',
    'G10 L20 P0 Z0',
    'G21 G91 G0 Z2.5',
    'G21 G91 G0 X-13',
    'G38.2 X-30 F150',
    'G21 G91 G0 X2',
    'G38.2 X-5 F75',
    'G4 P[PROBE_DELAY]',
    '%X_LEFT=posx',
    'G21 G91 G0 X26',
    'G38.2 X30 F150',
    'G21 G91 G0 X-2',
    'G38.2 X5 F75',
    'G4 P[PROBE_DELAY]',
    '%X_RIGHT=posx',
    '%X_CENTER=((X_RIGHT - X_LEFT)/2)*-1',
    'G91 G0 X[X_CENTER]',
    'G21 G91 G0 Y-13',
    'G38.2 Y-30 F250',
    'G21 G91 G0 Y2',
    'G38.2 Y-5 F75',
    'G4 P[PROBE_DELAY]',
    '%Y_BOTTOM = posy',
    'G21 G91 G0 Y26',
    'G38.2 Y30 F250',
    'G21 G91 G0 Y-2',
    'G38.2 Y5 F75',
    'G4 P[PROBE_DELAY]',
    '%Y_TOP = posy',
    '%Y_CENTER = ((Y_TOP - Y_BOTTOM)/2) * -1',
    'G0 Y[Y_CENTER]',
    'G21 G10 L20 P0 X[X_OFF] Y[Y_OFF]',
    'G21 G90 G0 X0 Y0',
    'G21 G0 G90 Z1'
  );

  return code;
};

/**
 * Generate G-code for Center - Outer probing
 * @param {Object} options - Probing options
 * @returns {Array} Array of G-code commands
 */
export const getCenterOuterRoutine = ({ xDimension, yDimension, rapidMovement, probeZFirst }) => {
  const code = [];
  const xOff = xDimension / 2;
  const yOff = yDimension / 2;

  code.push(
    '; Probe Center - Outer',
    `%X_OFF = ${xOff}`,
    `%Y_OFF = ${yOff}`,
    '%PROBE_DELAY=0.15',
    'G21 G91'
  );

  if (probeZFirst) {
    code.push(
      'G38.2 Z-25 F200',
      'G21 G91 G0 Z2.5',
      'G38.2 Z-5 F75',
      'G4 P[PROBE_DELAY]',
      'G10 L20 P0 Z0',
      'G21 G91 G0 Z2.5'
    );
  }

  code.push(
    'G21 G91 G0 X13',
    'G38.2 X30 F150',
    'G21 G91 G0 X-2',
    'G38.2 X5 F75',
    'G4 P[PROBE_DELAY]',
    '%X_LEFT=posx',
    'G21 G91 G0 X-26',
    'G38.2 X-30 F150',
    'G21 G91 G0 X2',
    'G38.2 X-5 F75',
    'G4 P[PROBE_DELAY]',
    '%X_RIGHT=posx',
    '%X_CENTER=((X_LEFT - X_RIGHT)/2)',
    'G91 G0 X[X_CENTER]',
    'G21 G91 G0 Y13',
    'G38.2 Y30 F250',
    'G21 G91 G0 Y-2',
    'G38.2 Y5 F75',
    'G4 P[PROBE_DELAY]',
    '%Y_BOTTOM = posy',
    'G21 G91 G0 Y-26',
    'G38.2 Y-30 F250',
    'G21 G91 G0 Y2',
    'G38.2 Y-5 F75',
    'G4 P[PROBE_DELAY]',
    '%Y_TOP = posy',
    '%Y_CENTER = ((Y_BOTTOM - Y_TOP)/2)',
    'G0 Y[Y_CENTER]',
    'G21 G10 L20 P0 X[X_OFF] Y[Y_OFF]',
    'G21 G90 G0 X0 Y0',
    'G21 G0 G90 Z1'
  );

  return code;
};

/**
 * Generate G-code for Z-axis probing
 * @param {Object} options - Probing options
 * @returns {Array} Array of G-code commands
 */
export const getZProbeRoutine = () => {
  return [
    '; Probe Z',
    'G21 G91',
    'G38.2 Z-25 F200',
    'G21 G91 G0 Z2.5',
    'G38.2 Z-5 F75',
    'G4 P0.15',
    'G10 L20 P0 Z0',
    'G21 G91 G0 Z2.5'
  ];
};

/**
 * Generate G-code for XYZ corner probing
 * @param {Object} options - Probing options
 * @returns {Array} Array of G-code commands
 */
export const getXYZProbeRoutine = ({ selectedCorner, toolDiameter = 6 }) => {
  const code = [];
  const toolRadius = toolDiameter / 2;

  // Determine probe directions based on corner
  let xDir = 1, yDir = 1;
  if (selectedCorner === 'BackLeft' || selectedCorner === 'FrontLeft') {
    xDir = 1; // Probe right
  } else {
    xDir = -1; // Probe left
  }

  if (selectedCorner === 'FrontLeft' || selectedCorner === 'FrontRight') {
    yDir = 1; // Probe back
  } else {
    yDir = -1; // Probe front
  }

  const xProbeDistance = 30 * xDir;
  const yProbeDistance = 30 * yDir;
  const xRetract = 2 * (xDir * -1);
  const yRetract = 2 * (yDir * -1);

  code.push(
    `; Probe XYZ - Corner: ${selectedCorner}`,
    'G21 G91',
    // Probe Z
    'G38.2 Z-25 F200',
    'G21 G91 G0 Z2.5',
    'G38.2 Z-5 F75',
    'G4 P0.15',
    'G10 L20 P0 Z0',
    'G21 G91 G0 Z2.5',
    // Move into position for X
    `G0 X${toolDiameter + 5}`,
    'G0 Z-15',
    // Probe X
    `G38.2 X${xProbeDistance} F150`,
    `G21 G91 G0 X${xRetract}`,
    `G38.2 X${xProbeDistance / 5} F75`,
    'G4 P0.15',
    `G10 L20 P0 X${-toolRadius * xDir}`,
    `G0 X${xRetract * 2}`,
    // Move into position for Y
    `G0 Y${toolDiameter + 5}`,
    // Probe Y
    `G38.2 Y${yProbeDistance} F150`,
    `G21 G91 G0 Y${yRetract}`,
    `G38.2 Y${yProbeDistance / 5} F75`,
    'G4 P0.15',
    `G10 L20 P0 Y${-toolRadius * yDir}`,
    // Return to start
    'G0 Z17.5',
    'G90 G0 X0 Y0',
    'G0 Z1'
  );

  return code;
};

/**
 * Generate G-code for XY corner probing
 * @param {Object} options - Probing options
 * @returns {Array} Array of G-code commands
 */
export const getXYProbeRoutine = ({ selectedCorner, toolDiameter = 6 }) => {
  const code = [];
  const toolRadius = toolDiameter / 2;

  // Determine probe directions based on corner
  let xDir = 1, yDir = 1;
  if (selectedCorner === 'BackLeft' || selectedCorner === 'FrontLeft') {
    xDir = 1;
  } else {
    xDir = -1;
  }

  if (selectedCorner === 'FrontLeft' || selectedCorner === 'FrontRight') {
    yDir = 1;
  } else {
    yDir = -1;
  }

  const xProbeDistance = 30 * xDir;
  const yProbeDistance = 30 * yDir;
  const xRetract = 2 * (xDir * -1);
  const yRetract = 2 * (yDir * -1);

  code.push(
    `; Probe XY - Corner: ${selectedCorner}`,
    'G21 G91',
    // Probe X
    `G38.2 X${xProbeDistance} F150`,
    `G21 G91 G0 X${xRetract}`,
    `G38.2 X${xProbeDistance / 5} F75`,
    'G4 P0.15',
    `G10 L20 P0 X${-toolRadius * xDir}`,
    `G0 X${xRetract * 2}`,
    // Move into position for Y
    `G0 Y${toolDiameter + 5}`,
    // Probe Y
    `G38.2 Y${yProbeDistance} F150`,
    `G21 G91 G0 Y${yRetract}`,
    `G38.2 Y${yProbeDistance / 5} F75`,
    'G4 P0.15',
    `G10 L20 P0 Y${-toolRadius * yDir}`,
    // Return to start
    'G90 G0 X0 Y0'
  );

  return code;
};

/**
 * Generate G-code for X-axis probing
 * @param {Object} options - Probing options
 * @returns {Array} Array of G-code commands
 */
export const getXProbeRoutine = ({ selectedSide, toolDiameter = 6 }) => {
  const code = [];
  const toolRadius = toolDiameter / 2;
  const xDir = selectedSide === 'Left' ? 1 : -1;
  const xProbeDistance = 30 * xDir;
  const xRetract = 2 * (xDir * -1);

  code.push(
    `; Probe X - Side: ${selectedSide}`,
    'G21 G91',
    `G38.2 X${xProbeDistance} F150`,
    `G21 G91 G0 X${xRetract}`,
    `G38.2 X${xProbeDistance / 5} F75`,
    'G4 P0.15',
    `G10 L20 P0 X${-toolRadius * xDir}`,
    'G90 G0 X0'
  );

  return code;
};

/**
 * Generate G-code for Y-axis probing
 * @param {Object} options - Probing options
 * @returns {Array} Array of G-code commands
 */
export const getYProbeRoutine = ({ selectedSide, toolDiameter = 6 }) => {
  const code = [];
  const toolRadius = toolDiameter / 2;
  const yDir = selectedSide === 'Front' ? 1 : -1;
  const yProbeDistance = 30 * yDir;
  const yRetract = 2 * (yDir * -1);

  code.push(
    `; Probe Y - Side: ${selectedSide}`,
    'G21 G91',
    `G38.2 Y${yProbeDistance} F150`,
    `G21 G91 G0 Y${yRetract}`,
    `G38.2 Y${yProbeDistance / 5} F75`,
    'G4 P0.15',
    `G10 L20 P0 Y${-toolRadius * yDir}`,
    'G90 G0 Y0'
  );

  return code;
};

/**
 * Master function to generate probe G-code based on mode
 * @param {Object} options - Probing options
 * @returns {Array} Array of G-code commands
 */
export const generateProbeCode = (options) => {
  const { probingAxis } = options;

  switch (probingAxis) {
    case 'Z':
      return getZProbeRoutine(options);
    case 'XYZ':
      return getXYZProbeRoutine(options);
    case 'XY':
      return getXYProbeRoutine(options);
    case 'X':
      return getXProbeRoutine(options);
    case 'Y':
      return getYProbeRoutine(options);
    case 'Center - Inner':
      return getCenterInnerRoutine(options);
    case 'Center - Outer':
      return getCenterOuterRoutine(options);
    default:
      return [];
  }
};
