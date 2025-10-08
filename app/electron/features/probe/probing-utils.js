// Probing utilities for 3D touch probe
// Based on gSender probing implementation

// Corner constants (clockwise from bottom-left)
export const BL = 0; // Bottom Left
export const TL = 1; // Top Left
export const TR = 2; // Top Right
export const BR = 3; // Bottom Right

/**
 * Returns probe directions for X and Y based on corner
 * @param {number} corner - Corner constant (BL, TL, TR, BR)
 * @returns {[number, number]} - [xDirection, yDirection] (1 for positive, -1 for negative)
 */
export const getProbeDirections = (corner) => {
  if (corner === BL) return [1, 1];
  if (corner === TL) return [1, -1];
  if (corner === TR) return [-1, -1];
  if (corner === BR) return [-1, 1];
  return [0, 0];
};

/**
 * Generate G-code for Z-axis probing
 */
export const getZProbeRoutine = () => {
  return [
    '; Probe Z',
    'G21 G91',
    'G38.2 Z-25 F200',
    'G91 G0 Z4',
    'G38.2 Z-5 F75',
    'G4 P0.3',
    'G10 L20 P0 Z0',
    'G0 Z4',
    'G90',
  ];
};

/**
 * Generate G-code for single axis standard routine
 * @param {string} axis - Axis to probe ('X', 'Y', or 'Z')
 * @param {number} probeDistance - Distance to probe
 * @param {number} retract - Distance to retract after touch
 * @param {number} probeFast - Fast probe feedrate
 * @param {number} probeSlow - Slow probe feedrate
 * @param {number} thickness - Probe plate thickness
 */
export const getSingleAxisStandardRoutine = (axis, probeDistance, retract, probeFast, probeSlow, thickness) => {
  axis = axis.toUpperCase();
  return [
    `; ${axis}-probe`,
    `G38.2 ${axis}${probeDistance} F${probeFast}`,
    `G91 G0 ${axis}${retract}`,
    `G38.2 ${axis}${-Math.abs(retract) - 1} F${probeSlow}`,
    'G4 P0.3',
    `G10 L20 P0 ${axis}${thickness}`,
    `G0 ${axis}${retract}`,
  ];
};

/**
 * Generate G-code for X-axis probing
 */
export const getXProbeRoutine = ({ selectedSide, toolDiameter = 6 }) => {
  const toolRadius = toolDiameter / 2;
  const isLeft = selectedSide === 'Left';

  const fastProbe = isLeft ? 30 : -30;
  const bounce = isLeft ? -4 : 4;
  const slowProbe = isLeft ? 5 : -5;
  const offset = isLeft ? -toolRadius : toolRadius;
  const moveAway = isLeft ? -4 : 4;

  return [
    `; Probe X - ${selectedSide}`,
    'G10 L20 P0 X0',
    'G91 G21',
    `G38.2 X${fastProbe} F150`,
    `G91 G0 X${bounce}`,
    `G38.2 X${slowProbe} F75`,
    'G4 P0.3',
    `G10 L20 P0 X${offset}`,
    `G0 X${moveAway}`,
    'G90',
  ];
};

/**
 * Generate G-code for Y-axis probing
 */
export const getYProbeRoutine = ({ selectedSide, toolDiameter = 6 }) => {
  const toolRadius = toolDiameter / 2;
  const isFront = selectedSide === 'Front';

  const fastProbe = isFront ? 30 : -30;
  const bounce = isFront ? -4 : 4;
  const slowProbe = isFront ? 5 : -5;
  const offset = isFront ? -toolRadius : toolRadius;
  const moveAway = isFront ? -4 : 4;

  return [
    `; Probe Y - ${selectedSide}`,
    'G10 L20 P0 Y0',
    'G91 G21',
    `G38.2 Y${fastProbe} F150`,
    `G91 G0 Y${bounce}`,
    `G38.2 Y${slowProbe} F75`,
    'G4 P0.3',
    `G10 L20 P0 Y${offset}`,
    `G0 Y${moveAway}`,
    'G90',
  ];
};

/**
 * Generate G-code for XY corner probing
 * Material corners: TopLeft, TopRight, BottomLeft, BottomRight
 * Coordinate system: 0,0 is at TopLeft (back-left)
 * Bottom (toward operator) = -Y, Top (away) = +Y
 * Left = -X, Right = +X
 */
export const getXYProbeRoutine = ({ selectedCorner, toolDiameter = 6 }) => {
  const toolRadius = toolDiameter / 2;

  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft';
  const isBottom = selectedCorner === 'BottomLeft' || selectedCorner === 'BottomRight';

  const xProbe = isLeft ? 30 : -30;
  const yProbe = isBottom ? 30 : -30;
  const xRetract = isLeft ? -4 : 4;
  const yRetract = isBottom ? -4 : 4;
  const xSlow = isLeft ? 5 : -5;
  const ySlow = isBottom ? 5 : -5;
  const xOffset = isLeft ? -toolRadius : toolRadius;
  const yOffset = isBottom ? -toolRadius : toolRadius;

  const xMove = isLeft ? (toolDiameter + 16) : -(toolDiameter + 16);
  const yMove = isBottom ? (toolDiameter + 16) : -(toolDiameter + 16);

  const code = [
    `; Probe XY - ${selectedCorner}`,
    'G21',
    'G10 L20 P0 X0 Y0',
    'G91 G21',
  ];

  // Probe X first
  code.push(
    `G38.2 X${xProbe} F150`,
    `G91 G0 X${xRetract}`,
    `G38.2 X${xSlow} F75`,
    'G4 P0.3',
    `G10 L20 P0 X${xOffset}`,
    `G0 X${xRetract}`,
  );

  // Position for Y probe
  code.push(
    `G0 X${xRetract * 2}`,
    `G0 Y${yMove}`,
    `G0 X${-xMove}`,
  );

  // Probe Y
  code.push(
    `G38.2 Y${yProbe} F150`,
    `G91 G0 Y${yRetract}`,
    `G38.2 Y${ySlow} F75`,
    'G4 P0.3',
    `G10 L20 P0 Y${yOffset}`,
    `G0 Y${yRetract}`,
  );

  // Return to origin
  code.push(
    'G0 Z10',
    'G90 G0 X0 Y0',
    'G21',
  );

  return code;
};

/**
 * Generate G-code for XYZ corner probing
 * Material corners: TopLeft, TopRight, BottomLeft, BottomRight
 * Coordinate system: 0,0 is at TopLeft (back-left)
 * Bottom (toward operator) = -Y, Top (away) = +Y
 * Left = -X, Right = +X
 */
export const getXYZProbeRoutine = ({ selectedCorner, toolDiameter = 6 }) => {
  const toolRadius = toolDiameter / 2;

  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft';
  const isBottom = selectedCorner === 'BottomLeft' || selectedCorner === 'BottomRight';

  const xProbe = isLeft ? 30 : -30;
  const yProbe = isBottom ? 30 : -30;
  const xRetract = isLeft ? -4 : 4;
  const yRetract = isBottom ? -4 : 4;
  const xSlow = isLeft ? 5 : -5;
  const ySlow = isBottom ? 5 : -5;
  const xOffset = isLeft ? -toolRadius : toolRadius;
  const yOffset = isBottom ? -toolRadius : toolRadius;

  const xMove = isLeft ? (toolDiameter + 16) : -(toolDiameter + 16);
  const yMove = isBottom ? (toolDiameter + 16) : -(toolDiameter + 16);

  const code = [
    `; Probe XYZ - ${selectedCorner}`,
    'G21',
    'G10 L20 P0 X0 Y0',
    'G91 G21',
  ];

  // Probe Z
  code.push(
    'G38.2 Z-25 F200',
    'G0 Z4',
    'G38.2 Z-5 F75',
    'G4 P0.3',
    'G10 L20 P0 Z0',
    'G0 Z4',
  );

  // Position for X probe - move to clear position from corner
  const yPosition = isBottom ? yMove : -yMove;
  code.push(
    `G0 X${xRetract} Y${yRetract}`,
    `G0 Y${yPosition}`,
  );

  // Probe X
  code.push(
    `G38.2 X${xProbe} F150`,
    `G91 G0 X${xRetract}`,
    `G38.2 X${xSlow} F75`,
    'G4 P0.3',
    `G10 L20 P0 X${xOffset}`,
    `G0 X${xRetract}`,
  );

  // Position for Y probe
  code.push(
    `G0 X${xRetract * 2}`,
    `G0 Y${yMove}`,
    `G0 X${-xMove}`,
  );

  // Probe Y
  code.push(
    `G38.2 Y${yProbe} F150`,
    `G91 G0 Y${yRetract}`,
    `G38.2 Y${ySlow} F75`,
    'G4 P0.3',
    `G10 L20 P0 Y${yOffset}`,
    `G0 Y${yRetract}`,
  );

  // Return to origin
  code.push(
    'G0 Z19',
    'G90 G0 X0 Y0',
    'G21',
  );

  return code;
};

/**
 * Generate G-code for Center - Inner probing
 */
export const getCenterInnerRoutine = ({ xDimension, yDimension, ballPointDiameter = 6 }) => {
  const ballRadius = ballPointDiameter / 2;
  const halfX = xDimension / 2;
  const halfY = yDimension / 2;
  const clearance = 8 + ballRadius;
  const searchFeed = 150;
  const latchFeed = 75;
  const bounce = 2;
  const maxSearchLimit = 30;

  const maxRapidDistanceX = halfX - clearance;
  const maxRapidDistanceY = halfY - clearance;
  const useRapidX = maxRapidDistanceX >= clearance;
  const useRapidY = maxRapidDistanceY >= clearance;

  const searchFeedRate = 2000;

  const code = [
    '; Probe Center - Inner',
    '%START_X=posx',
    '%START_Y=posy',
    '%START_Z=posz',
    `%BALL_RADIUS=${ballRadius}`,
    `%SEARCH_FEED=${searchFeed}`,
    `%LATCH_FEED=${latchFeed}`,
    'G90',
  ];

  // Probe X left
  if (useRapidX) {
    code.push(`G90 G38.3 X[START_X - ${maxRapidDistanceX}] F${searchFeedRate}`);
  }
  code.push(
    `G91 G38.2 X-${maxSearchLimit} F[SEARCH_FEED]`,
    `G91 G0 X${bounce}`,
    `G91 G38.2 X-${maxSearchLimit} F[LATCH_FEED]`,
    'G4 P0.3',
    '%X_LEFT=[posx - BALL_RADIUS]',
  );

  // Return to center and probe X right
  code.push(`G90 G0 X[START_X] Y[START_Y]`);
  if (useRapidX) {
    code.push(`G90 G38.3 X[START_X + ${maxRapidDistanceX}] F${searchFeedRate}`);
  }
  code.push(
    `G91 G38.2 X${maxSearchLimit} F[SEARCH_FEED]`,
    `G91 G0 X-${bounce}`,
    `G91 G38.2 X${maxSearchLimit} F[LATCH_FEED]`,
    'G4 P0.3',
    '%X_RIGHT=[posx + BALL_RADIUS]',
  );

  // Return to center and probe Y back
  code.push(`G90 G0 X[START_X] Y[START_Y]`);
  if (useRapidY) {
    code.push(`G90 G38.3 Y[START_Y - ${maxRapidDistanceY}] F${searchFeedRate}`);
  }
  code.push(
    `G91 G38.2 Y-${maxSearchLimit} F[SEARCH_FEED]`,
    `G91 G0 Y${bounce}`,
    `G91 G38.2 Y-${maxSearchLimit} F[LATCH_FEED]`,
    'G4 P0.3',
    '%Y_BACK=[posy - BALL_RADIUS]',
  );

  // Return to center and probe Y front
  code.push(`G90 G0 X[START_X] Y[START_Y]`);
  if (useRapidY) {
    code.push(`G90 G38.3 Y[START_Y + ${maxRapidDistanceY}] F${searchFeedRate}`);
  }
  code.push(
    `G91 G38.2 Y${maxSearchLimit} F[SEARCH_FEED]`,
    `G91 G0 Y-${bounce}`,
    `G91 G38.2 Y${maxSearchLimit} F[LATCH_FEED]`,
    'G4 P0.3',
    '%Y_FRONT=[posy + BALL_RADIUS]',
  );

  // Calculate and move to center
  code.push(
    '%CENTER_X=[(X_LEFT + X_RIGHT) / 2]',
    '%CENTER_Y=[(Y_BACK + Y_FRONT) / 2]',
    'G90 G0 X[CENTER_X] Y[CENTER_Y]',
    'G10 L20 P0 X0 Y0',
  );

  return code;
};

/**
 * Generate G-code for Center - Outer probing
 */
export const getCenterOuterRoutine = ({ xDimension, yDimension, ballPointDiameter = 6, probeZFirst }) => {
  const ballRadius = ballPointDiameter / 2;
  const clearance = 10 + ballRadius;
  const maxSearchLimit = 30;
  const searchFeed = 150;
  const latchFeed = 75;
  const bounce = 2;
  const zDown = -7;
  const safeZHeight = probeZFirst ? '5' : '[START_Z + 5]';

  const searchFeedRate = 2000;

  const code = [
    '; Probe Center - Outer',
    '%START_X=posx',
    '%START_Y=posy',
    '%START_Z=posz',
    `%BALL_RADIUS=${ballRadius}`,
    `%SEARCH_FEED=${searchFeed}`,
    `%LATCH_FEED=${latchFeed}`,
    `%MAX_SEARCH_LIMIT=${maxSearchLimit}`,
    'G90',
  ];

  // Probe Z if requested
  if (probeZFirst) {
    code.push(
      'G91 G21',
      'G38.2 Z-25 F200',
      'G0 Z4',
      'G38.2 Z-5 F75',
      'G4 P0.3',
      'G10 L20 P0 Z0',
      'G0 Z5',
      'G90',
    );
  }

  // Move to safe Z first
  code.push(`G90 G38.3 Z${safeZHeight} F1000`);

  // Probe X left
  code.push(
    `G91 G38.3 X-${xDimension / 2 + clearance} F${searchFeedRate}`,
    `G91 G38.3 Z${zDown} F500`,
    `G91 G38.2 X[MAX_SEARCH_LIMIT] F[SEARCH_FEED]`,
    `G91 G0 X-${bounce}`,
    `G91 G38.2 X3 F[LATCH_FEED]`,
    'G4 P0.3',
    '%X_LEFT=[posx - BALL_RADIUS]',
    `G91 G0 X-${bounce}`,
    `G90 G0 Z${safeZHeight}`,
  );

  // Probe X right
  code.push(
    `G91 G38.3 X${xDimension + clearance + bounce} F${searchFeedRate}`,
    `G91 G38.3 Z${zDown} F500`,
    `G91 G38.2 X-[MAX_SEARCH_LIMIT] F[SEARCH_FEED]`,
    `G91 G0 X${bounce}`,
    `G91 G38.2 X-3 F[LATCH_FEED]`,
    'G4 P0.3',
    '%X_RIGHT=[posx + BALL_RADIUS]',
    `G91 G0 X${bounce}`,
    `G90 G0 Z${safeZHeight}`,
  );

  // Move back to start position for Y probing
  code.push(`G90 G0 X[START_X] Y[START_Y]`);

  // Probe Y back
  code.push(
    `G91 G38.3 Y-${yDimension / 2 + clearance} F${searchFeedRate}`,
    `G91 G38.3 Z${zDown} F500`,
    `G91 G38.2 Y[MAX_SEARCH_LIMIT] F[SEARCH_FEED]`,
    `G91 G0 Y-${bounce}`,
    `G91 G38.2 Y3 F[LATCH_FEED]`,
    'G4 P0.3',
    '%Y_BACK=[posy - BALL_RADIUS]',
    `G91 G0 Y-${bounce}`,
    `G90 G0 Z${safeZHeight}`,
  );

  // Probe Y front
  code.push(
    `G91 G38.3 Y${yDimension + clearance + bounce} F${searchFeedRate}`,
    `G91 G38.3 Z${zDown} F500`,
    `G91 G38.2 Y-[MAX_SEARCH_LIMIT] F[SEARCH_FEED]`,
    `G91 G0 Y${bounce}`,
    `G91 G38.2 Y-3 F[LATCH_FEED]`,
    'G4 P0.3',
    '%Y_FRONT=[posy + BALL_RADIUS]',
    `G91 G0 Y${bounce}`,
    `G90 G0 Z${safeZHeight}`,
  );

  // Calculate and move to center
  code.push(
    '%CENTER_X=[(X_LEFT + X_RIGHT) / 2]',
    '%CENTER_Y=[(Y_BACK + Y_FRONT) / 2]',
    'G0 X[CENTER_X] Y[CENTER_Y]',
    'G10 L20 P0 X0 Y0',
  );

  return code;
};

/**
 * Master function to generate probe G-code based on mode
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
