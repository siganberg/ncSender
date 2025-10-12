// AutoZero Touch Probe routines
// For AutoZero touch probe with various bit diameters

// Constants for probe movements
const BOUNCE = 3;
const PLATE_THICKNESS = 4; // mm
const MAX_TRAVEL_SEARCH = 30;
const AUTO_PLATE_INNER_DIMENSION = 45
const AUTO_PLATE_SIDE_THICKNESS = 10

export const getZProbeRoutine = (selectedBitDiameter = 'Auto') => {
  return [
    `; Probe Z - AutoZero Touch (${selectedBitDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G21 G91',
    'G38.2 Z-25 F200',
    `G0 Z${BOUNCE}`,
    `G38.2 Z-${BOUNCE + 1} F75`,
    'G4 P0.3',
    `G10 L20 Z${PLATE_THICKNESS}`,
    'G0 Z5',
    'G90',
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  ];
};

export const getXProbeRoutine = ({ selectedSide, selectedBitDiameter = 'Auto', rapidMovement = 2000 }) => {

  let diameter = 0;

  if (selectedBitDiameter === 'Auto') {
    diameter = 0;
  } else if (selectedBitDiameter === 'Tip') {
    diameter = 0;
  } else {
    diameter = parseFloat(selectedBitDiameter);
  }

  const toolRadius = diameter / 2;
  const isLeft = selectedSide === 'Left' ? 1 : -1;
  const halfClearance = AUTO_PLATE_INNER_DIMENSION / 2
  const safeRapidDistance = halfClearance - (diameter == 0 ? 6.35 : diameter) - 5;

  const code = [
    `; Probe X - ${selectedSide} (AutoZero Touch - ${selectedBitDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G91 G21',
    'G38.2 Z-25 F150',
    'G0 Z5'
  ];

  if (toolRadius == 0) {
    // Left side probe
    code.push(
      `G38.3 X${-safeRapidDistance * isLeft} F${rapidMovement}`,
      `G38.2 X${-halfClearance * isLeft} F150`,
      `G0 X${BOUNCE *isLeft}`,
      `G38.2 X${-(BOUNCE+1) * isLeft} F75`,
      'G4 P0.3',
      `#<X1> = #5061`,
      `G0 X${halfClearance * isLeft}`
    );
  }

  code.push(
    // Right side probe
    `G38.3 X${safeRapidDistance * isLeft} F${rapidMovement}`,
    `G38.2 X${halfClearance * isLeft} F150`,
    `G0 X${-BOUNCE * isLeft}`,
    `G38.2 X${(BOUNCE+1) * isLeft} F75`,
    'G4 P0.3',
  );

  if (toolRadius == 0) {
    code.push(
      `#<X2> = #5061`,
      'G0 X-[[#<X2>-#<X1>]/2]'
    );
  }
  else {
    code.push(`G0 X${-((halfClearance-(toolRadius/2))*isLeft)}`);
  }

  code.push(
    `G10 L20 X${halfClearance*isLeft}`,
    'G90',
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  );

  return code;
};

export const getYProbeRoutine = ({ selectedSide, selectedBitDiameter = 'Auto', rapidMovement = 2000 }) => {
  let diameter = 0;

  if (selectedBitDiameter === 'Auto') {
    diameter = 0;
  } else if (selectedBitDiameter === 'Tip') {
    diameter = 0;
  } else {
    diameter = parseFloat(selectedBitDiameter);
  }

  const toolRadius = diameter / 2;
  const isFront = selectedSide === 'Front' ? 1 : -1;
  const halfClearance = AUTO_PLATE_INNER_DIMENSION / 2
  const safeRapidDistance = halfClearance - (diameter == 0 ? 6.35 : diameter) - 5;

  const code = [
    `; Probe Y - ${selectedSide} (AutoZero Touch - ${selectedBitDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G91 G21',
    'G38.2 Z-25 F150',
    'G0 Z5'
  ];

  if (toolRadius == 0) {
    // Left side probe
    code.push(
      `G38.3 Y${-safeRapidDistance * isFront} F${rapidMovement}`,
      `G38.2 Y${-halfClearance * isFront} F150`,
      `G0 Y${BOUNCE * isFront}`,
      `G38.2 Y${-(BOUNCE+1) * isFront} F75`,
      'G4 P0.3',
      `#<Y1> = #5062`,
      `G0 Y${halfClearance * isFront}`
    );
  }

  code.push(
    // Right side probe
    `G38.3 Y${safeRapidDistance * isFront} F${rapidMovement}`,
    `G38.2 Y${halfClearance * isFront} F150`,
    `G0 Y${-BOUNCE * isFront}`,
    `G38.2 Y${(BOUNCE+1) * isFront} F75`,
    'G4 P0.3',
  );

  if (toolRadius == 0) {
    code.push(
      `#<Y2> = #5062`,
      'G0 Y-[[#<Y2>-#<Y1>]/2]'
    );
  }
  else {
    code.push(`G0 Y${-((halfClearance-(toolRadius/2))*isFront)}`);
  }

  code.push(
    `G10 L20 Y${halfClearance*isFront}`,
    'G90',
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  );

  return code;
};

export const getXYProbeRoutine = ({ selectedCorner, selectedBitDiameter = 'Auto', rapidMovement = 2000, moveToZero = false, skipZMovement = false }) => {
  let diameter = 0;

  if (selectedBitDiameter === 'Auto') {
    diameter = 0;
  } else if (selectedBitDiameter === 'Tip') {
    diameter = 0;
  } else {
    diameter = parseFloat(selectedBitDiameter);
  }


  const toolRadius = diameter / 2;
  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft' ? 1 : -1;
  const isBottom = selectedCorner === 'BottomLeft' || selectedCorner === 'BottomRight' ? 1 : -1;
  const halfClearance = AUTO_PLATE_INNER_DIMENSION / 2

  // For Auto bit diameter, we're just gonna assusme it is 6.35mm (1/4") for now.
  // TOOD: Maybe we can just disable the rapid move for Auto bit diameter?
  const safeRapidDistance = halfClearance - (diameter == 0 ? 6.35 : diameter) - 5;

  const code = [
    `; Probe XY - ${selectedCorner} (AutoZero Touch - ${selectedBitDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G91 G21',
  ];

  if (skipZMovement === false) {
    code.push(
      'G38.2 Z-15 F150',
      'G0 Z5'
    );
  }

  if (toolRadius == 0) {
    // Left side probe
    code.push(
      `G38.3 X${-safeRapidDistance * isLeft} F${rapidMovement}`,
      `G38.2 X${-halfClearance * isLeft} F150`,
      `G0 X${BOUNCE *isLeft}`,
      `G38.2 X${-(BOUNCE+1) * isLeft} F75`,
      'G4 P0.3',
      `#<X1> = #5061`,
      `G0 X${halfClearance * isLeft}`
    );
  }

  code.push(
    // Right side probe
    `G38.3 X${safeRapidDistance * isLeft} F${rapidMovement}`,
    `G38.2 X${halfClearance * isLeft} F150`,
    `G0 X${-BOUNCE * isLeft}`,
    `G38.2 X${(BOUNCE+1) * isLeft} F75`,
    'G4 P0.3',
  );

  if (toolRadius == 0) {
    code.push(
      `#<X2> = #5061`,
      'G0 X-[[#<X2>-#<X1>]/2]'
    );
  }
  else {
    code.push(`G0 X${-((halfClearance-(toolRadius/2))*isLeft)}`);
  }

   if (toolRadius == 0) {
    // Bottom side probe
    code.push(
      `G38.3 Y${-safeRapidDistance * isBottom} F${rapidMovement}`,
      `G38.2 Y${-halfClearance * isBottom} F150`,
      `G0 Y${BOUNCE * isBottom}`,
      `G38.2 Y${-(BOUNCE+1) * isBottom} F75`,
      'G4 P0.3',
      `#<Y1> = #5062`,
      `G0 Y${halfClearance * isBottom}`
    );
  }

  // Top side probe
  code.push(
    `G38.3 Y${safeRapidDistance * isBottom} F${rapidMovement}`,
    `G38.2 Y${halfClearance * isBottom} F150`,
    `G0 Y${-BOUNCE * isBottom}`,
    `G38.2 Y${(BOUNCE+1) * isBottom} F75`,
    'G4 P0.3'
  );

  if (toolRadius == 0) {
    code.push(
      `#<Y2> = #5062`,
      'G0 Y-[[#<Y2>-#<Y1>]/2]',
      `G10 L20 X${halfClearance*isLeft} Y${halfClearance*isBottom}`,
    );
  }
  else {
    code.push(
      `G0 Y${-(halfClearance-(toolRadius/2))*isBottom}`,
      `G10 L20 X${(halfClearance-(toolRadius/2))*isLeft} Y${(halfClearance-(toolRadius/2))*isBottom}`);
  }

  // Set offsets and final retract
  code.push(
    'G90',
    `G38.3 X0 Y0 F${rapidMovement}`,
    moveToZero ? `G38.3 Z0 F${rapidMovement}` : '' ,
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  );

  return code;
};

export const getXYZProbeRoutine = ({ selectedCorner, selectedBitDiameter = 'Auto', rapidMovement = 2000 }) => {
  let diameter = 0;

  if (selectedBitDiameter === 'Auto') {
    diameter = 0;
  } else if (selectedBitDiameter === 'Tip') {
    diameter = 0;
  } else {
    diameter = parseFloat(selectedBitDiameter);
  }

  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft';
  const xMove = isLeft ? -(diameter + 16) : (diameter + 16);
  const code = [];

  code.push(...getZProbeRoutine(selectedBitDiameter));

  const moveToZero = true;
  const skipZMovement = true;

  code.push(...getXYProbeRoutine({ selectedCorner, selectedBitDiameter, moveToZero, skipZMovement  }));

  return code;
};
