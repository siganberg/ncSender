// Probing utilities for 3D touch probe
// Based on gSender probing implementation

// Corner constants (clockwise from bottom-left)
export const BL = 0; // Bottom Left
export const TL = 1; // Top Left
export const TR = 2; // Top Right
export const BR = 3; // Bottom Right
export const zParkHeight = 4; // Height to park Z axis when moving between probes

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
    'G0 Z4',
    'G38.2 Z-5 F75',
    'G4 P0.3',
    'G10 L20 Z0',
    `G0 Z${zParkHeight}`,
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
    `G10 L20 ${axis}${thickness}`,
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
    'G10 L20 X0',
    'G91 G21',
    `G38.2 X${fastProbe} F150`,
    `G91 G0 X${bounce}`,
    `G38.2 X${slowProbe} F75`,
    'G4 P0.3',
    `G10 L20 X${offset}`,
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
    'G10 L20 Y0',
    'G91 G21',
    `G38.2 Y${fastProbe} F150`,
    `G91 G0 Y${bounce}`,
    `G38.2 Y${slowProbe} F75`,
    'G4 P0.3',
    `G10 L20 Y${offset}`,
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
export const getXYProbeRoutine = ({ selectedCorner, toolDiameter = 6, skipPrepMove = false }) => {
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
    'G91 G21',
  ];

  // Prepare for X probe
  if (!skipPrepMove) {
    code.push(
      `G0 X${xRetract} Y${yRetract}`,
      `G0 Y${yMove}`
    );
  }


  // Probe X first
  code.push(

    `G38.2 X${xProbe} F150`,
    `G0 X${xRetract}`,
    `G38.2 X${xSlow} F75`,
    'G4 P0.3',
    `G10 L20 X${xOffset}`,
  );

  // Position for Y probe
  code.push(
    `G0 X${xRetract * 2}`,
    `G0 Y${-yMove+yRetract}`,
    `G0 X${xMove}`,
  );

  // Probe Y
  code.push(
    `G38.2 Y${yProbe} F150`,
    `G91 G0 Y${yRetract}`,
    `G38.2 Y${ySlow} F75`,
    'G4 P0.3',
    `G10 L20 Y${yOffset}`,
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
export const getXYZProbeRoutine = ({ selectedCorner, toolDiameter = 6, zPlunge = 3 }) => {

  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft';
  const xMove = isLeft ? -(toolDiameter + 16) : (toolDiameter + 16);
  const code = [];

  // Probe Z first
  code.push(...getZProbeRoutine());

  // Prepare for XY probe - move away from corner and position for X probe
  code.push(
    'G91',
    `G0 X${xMove}`,
    `G0 Z-${zPlunge+zParkHeight}`
  );

  // Then probe XY (skip the prep move since we already did it)
  code.push(...getXYProbeRoutine({ selectedCorner, toolDiameter, skipPrepMove: true }));

  return code;
};

/**
 * Generate G-code for Center - Inner probing
 */
export const getCenterInnerRoutine = ({ xDimension, yDimension, toolDiameter = 2, rapidMovement = 2000 }) => {

  const ballPointDiameter = toolDiameter;
  const halfX = xDimension / 2;
  const halfY = yDimension / 2;
  const searchFeed = 150;
  const slowFeed = 75;
  const bounce = 2;
  const maxSearchLimit = 30;
  const safeDistane = 5;


  const safeRapidX = halfX - toolDiameter - safeDistane;
  const safeRapidY = halfY - toolDiameter - safeDistane;


  const code = [
    '; Probing Center - Inner',
    `#<X_SIZE> = ${xDimension} (Estimated X dimension, mm)`,
    `#<Y_SIZE> = ${yDimension} (Estimated Y dimension, mm)`,
    `#<RAPID_SEARCH> = ${rapidMovement}`,
    'G21 (mm mode)',
    "G91 (incremental)",
  ];

  // X dimension
  if (safeRapidX > 0) {
    code.push(`G38.3 X-${safeRapidX} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G38.2 X-${maxSearchLimit} F${searchFeed}`,
    `G0 X${bounce}`,
    `G38.2 X-3 F${slowFeed}`,
    `#<X1> = #5061`,
    `G0 X${halfX}`
  );

  if (safeRapidX > 0) {
    code.push(`G38.3 X${safeRapidX-toolDiameter/2} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G38.2 X${maxSearchLimit} F${searchFeed}`,
    `G0 X-${bounce}`,
    `G38.2 X3 F${slowFeed}`,
    `#<X2> = #5061`,
    'G0 X-[[#<X2>-#<X1>]/2]'
  );

  // Y dimesion
  if (safeRapidY > 0) {
    code.push(`G38.3 Y-${safeRapidY} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G38.2 Y-${maxSearchLimit} F${searchFeed}`,
    `G0 Y${bounce}`,
    `G38.2 Y-3 F${slowFeed}`,
    `#<Y1> = #5062`,
    `G0 Y${halfY}`
  );

  if (safeRapidY > 0) {
    code.push(`G38.3 Y${safeRapidY-toolDiameter/2} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G38.2 Y${maxSearchLimit} F${searchFeed}`,
    `G0 Y-${bounce}`,
    `G38.2 Y3 F${slowFeed}`,
    `#<Y2> = #5062`,
    `G0 Y-[[#<Y2>-#<Y1>]/2]`,
    'G10 L20 X0 Y0',
    'G90'
  );

  return code;
};

/**
 * Generate G-code for Center - Outer probing
 */
export const getCenterOuterRoutine = ({ xDimension, yDimension, toolDiameter = 2, rapidMovement = 2000, probeZFirst = false, zPlunge = 3 }) => {
  const halfX = xDimension / 2;
  const halfY = yDimension / 2;
  const searchFeed = 150;
  const slowFeed = 75;
  const bounce = 2;
  const maxSearchLimit = 30;
  const safeDistance = 5;
  const zHop = zPlunge + zParkHeight; // TODO: replace 3 with actually zPlunge

  const safeRapidX = halfX + toolDiameter + safeDistance;
  const safeRapidY = halfY + toolDiameter + safeDistance;

  const code = [];

  // Probe Z first if requested
  if (probeZFirst) {
    code.push(...getZProbeRoutine());
  }

  code.push(
    '; Probing Center - Outer',
    `#<X_SIZE> = ${xDimension} (Estimated X dimension, mm)`,
    `#<Y_SIZE> = ${yDimension} (Estimated Y dimension, mm)`,
    `#<RAPID_SEARCH> = ${rapidMovement}`,
    'G21 (mm mode)',
    'G91 (incremental)',
  );

  // X dimension - probe left (negative direction)
  if (safeRapidX > 0) {
    code.push(`G38.3 X-${safeRapidX} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G0 Z-${zHop}`,
    `G38.2 X${maxSearchLimit} F${searchFeed}`,
    `G0 X-${bounce}`,
    `G38.2 X${bounce+1} F${slowFeed}`,
    `#<X1> = #5061`,
    `G0 X-${bounce}`,
    `G0 Z${zHop}`,
    `G0 X${bounce}`,
    `G0 X${halfX}`
  );

  // X dimension - probe right (positive direction)
  if (safeRapidX > 0) {
    code.push(`G38.3 X${safeRapidX} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G0 Z-${zHop}`,
    `G38.2 X-${maxSearchLimit} F${searchFeed}`,
    `G0 X${bounce}`,
    `G38.2 X-${bounce+1} F${slowFeed}`,
    `#<X2> = #5061`,
    `G0 X${bounce}`,
    `G0 Z${zHop}`,
    `G0 X-${bounce}`,
    'G0 X-[[#<X2>-#<X1>]/2]'
  );

  // Y dimension - probe bottom (negative direction)
  if (safeRapidY > 0) {
    code.push(`G38.3 Y-${safeRapidY} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G0 Z-${zHop}`,
    `G38.2 Y${maxSearchLimit} F${searchFeed}`,
    `G0 Y-${bounce}`,
    `G38.2 Y+${bounce+1} F${slowFeed}`,
    `#<Y1> = #5062`,
    `G0 Y-${bounce}`,
    `G0 Z${zHop}`,
    `G0 Y${bounce}`,
    `G0 Y${halfY}`
  );

  // Y dimension - probe top (positive direction)
  if (safeRapidY > 0) {
    code.push(`G38.3 Y${safeRapidY} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G0 Z-${zHop}`,
    `G38.2 Y-${maxSearchLimit} F${searchFeed}`,
    `G0 Y${bounce}`,
    `G38.2 Y-${bounce+1} F${slowFeed}`,
    `#<Y2> = #5062`,
    `G0 Y${bounce}`,
    `G0 Z${zHop}`,
    `G0 Y-[[#<Y2>-#<Y1>]/2]`,
    'G10 L20 X0 Y0',
    'G90'
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
