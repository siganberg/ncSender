// Probing utilities for 3D touch probe
// Simplified implementation without variables

/**
 * Generate G-code for Z-axis probing
 */
export const getZProbeRoutine = () => {
  return [
    '; Probe Z',
    'G91 G21',
    'G38.2 Z-25 F200',
    'G91 G0 Z4',
    'G38.2 Z-5 F75',
    'G4 P0.3',
    'G10 L20 P0 Z0',
    'G0 Z4',
    'G21',
    'G90',
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
    'G21',
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
    'G21',
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

  // Determine directions based on corner
  // TopLeft: probe right (+X) and toward bottom (-Y)
  // TopRight: probe left (-X) and toward bottom (-Y)
  // BottomLeft: probe right (+X) and toward bottom (-Y)
  // BottomRight: probe left (-X) and toward bottom (-Y)
  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft';
  const isBottom = selectedCorner === 'BottomLeft' || selectedCorner === 'BottomRight';

  const xProbe = isLeft ? 30 : -30;
  const yProbe = -30; // Always probe toward bottom (-Y)
  const xRetract = isLeft ? -4 : 4;
  const yRetract = -4; // Always retract toward bottom (-Y) away from material
  const xSlow = isLeft ? 5 : -5;
  const ySlow = -5; // Always slow probe toward bottom (-Y)
  const xOffset = isLeft ? -toolRadius : toolRadius;
  const yOffset = -toolRadius; // Always offset for bottom edge

  const xMove = isLeft ? (toolDiameter + 16) : -(toolDiameter + 16);
  const yMove = (toolDiameter + 16); // Distance to move along edges

  const code = [
    `; Probe XY - ${selectedCorner}`,
    'G21',
    'G10 L20 P0 X0 Y0',
    'G91 G21',
  ];

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

  code.push(
    'G0 Z19',
    'G90 G0 X0 Y0',
    'G21',
    'G91',
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
  const yRetract = isBottom ? 4 : -4;
  const xSlow = isLeft ? 5 : -5;
  const ySlow = isBottom ? 5 : -5;
  const xOffset = isLeft ? -toolRadius : toolRadius;
  const yOffset = isBottom ? toolRadius : -toolRadius;

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
    'G91',
  );

  return code;
};

/**
 * Generate G-code for Center - Inner probing
 */
export const getCenterInnerRoutine = ({ xDimension, yDimension, ballPointDiameter = 6 }) => {
  const ballRadius = ballPointDiameter / 2;

  return [
    '; Probe Center - Inner',
    'G91 G21',
    // Probe X left
    'G38.2 X-30 F150',
    'G0 X2',
    'G38.2 X-5 F75',
    'G4 P0.3',
    `G10 L20 P0 X${-ballRadius}`,
    'G0 X2',
    // Return to center and probe X right
    `G90 G0 X${xDimension/2}`,
    'G91',
    'G38.2 X30 F150',
    'G0 X-2',
    'G38.2 X5 F75',
    'G4 P0.3',
    `G10 L20 P0 X${xDimension/2 + ballRadius}`,
    'G0 X-2',
    // Move to calculated center
    `G90 G0 X${xDimension/2}`,
    'G91',
    // Probe Y back
    'G38.2 Y-30 F150',
    'G0 Y2',
    'G38.2 Y-5 F75',
    'G4 P0.3',
    `G10 L20 P0 Y${-ballRadius}`,
    'G0 Y2',
    // Return to center and probe Y front
    `G90 G0 Y${yDimension/2}`,
    'G91',
    'G38.2 Y30 F150',
    'G0 Y-2',
    'G38.2 Y5 F75',
    'G4 P0.3',
    `G10 L20 P0 Y${yDimension/2 + ballRadius}`,
    'G0 Y-2',
    // Set final center position
    `G90 G0 X${xDimension/2} Y${yDimension/2}`,
    'G10 L20 P0 X0 Y0',
    'G90 G0 X0 Y0',
  ];
};

/**
 * Generate G-code for Center - Outer probing
 */
export const getCenterOuterRoutine = ({ xDimension, yDimension, ballPointDiameter = 6, probeZFirst }) => {
  const ballRadius = ballPointDiameter / 2;
  const clearance = 10 + ballRadius;

  const code = ['; Probe Center - Outer'];

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

  code.push(
    'G91 G21',
    // Move to left side and probe X
    `G90 G0 X${-(xDimension/2 + clearance)}`,
    'G91 G0 Z-7',
    'G38.2 X30 F150',
    'G0 X-2',
    'G38.2 X5 F75',
    'G4 P0.3',
    `G10 L20 P0 X${-xDimension/2 - ballRadius}`,
    'G0 X-2',
    'G0 Z7',
    // Move to right side and probe X
    `G90 G0 X${xDimension/2 + clearance}`,
    'G91 G0 Z-7',
    'G38.2 X-30 F150',
    'G0 X2',
    'G38.2 X-5 F75',
    'G4 P0.3',
    `G10 L20 P0 X${xDimension/2 + ballRadius}`,
    'G0 X2',
    'G0 Z7',
    // Move to center X, probe Y
    'G90 G0 X0',
    `G0 Y${-(yDimension/2 + clearance)}`,
    'G91 G0 Z-7',
    'G38.2 Y30 F150',
    'G0 Y-2',
    'G38.2 Y5 F75',
    'G4 P0.3',
    `G10 L20 P0 Y${-yDimension/2 - ballRadius}`,
    'G0 Y-2',
    'G0 Z7',
    // Move to front and probe Y
    `G90 G0 Y${yDimension/2 + clearance}`,
    'G91 G0 Z-7',
    'G38.2 Y-30 F150',
    'G0 Y2',
    'G38.2 Y-5 F75',
    'G4 P0.3',
    `G10 L20 P0 Y${yDimension/2 + ballRadius}`,
    'G0 Y2',
    'G0 Z7',
    // Move to calculated center
    'G90 G0 X0 Y0',
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
