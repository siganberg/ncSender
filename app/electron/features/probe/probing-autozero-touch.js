// AutoZero Touch Probe routines
// For AutoZero touch probe with various bit diameters

// Constants for probe movements
const BOUNCE = 3;
const PLATE_THICKNESS = 4; // mm
const MAX_TRAVEL_SEARCH = 30;
const AUTO_PLATE_INNER_DIMENSION = 45

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
    'G0 Z10',
    'G90',
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  ];
};

export const getXProbeRoutine = ({ selectedSide, selectedBitDiameter = 'Auto' }) => {
  let diameter = 0;

  if (selectedBitDiameter === 'Auto') {
    diameter = 0;
  } else if (selectedBitDiameter === 'Tip') {
    diameter = 0;
  } else {
    diameter = parseFloat(selectedBitDiameter);
  }

  const toolRadius = diameter / 2;
  const isLeft = selectedSide === 'Left';

  const fastProbe = isLeft ? MAX_TRAVEL_SEARCH : -MAX_TRAVEL_SEARCH;
  const bounce = isLeft ? -BOUNCE : BOUNCE;
  const slowProbe = isLeft ? (BOUNCE + 1) : -(BOUNCE + 1);
  const offset = isLeft ? -toolRadius : toolRadius;
  const moveAway = isLeft ? -BOUNCE : BOUNCE;

  return [
    `; Probe X - ${selectedSide} (AutoZero Touch - ${selectedBitDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G10 L20 X0',
    'G91 G21',
    `G38.2 X${fastProbe} F150`,
    `G91 G0 X${bounce}`,
    `G38.2 X${slowProbe} F75`,
    'G4 P0.3',
    `G10 L20 X${offset}`,
    `G0 X${moveAway}`,
    'G90',
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  ];
};

export const getYProbeRoutine = ({ selectedSide, selectedBitDiameter = 'Auto' }) => {
  let diameter = 0;

  if (selectedBitDiameter === 'Auto') {
    diameter = 0;
  } else if (selectedBitDiameter === 'Tip') {
    diameter = 0;
  } else {
    diameter = parseFloat(selectedBitDiameter);
  }

  const toolRadius = diameter / 2;
  const isFront = selectedSide === 'Front';

  const fastProbe = isFront ? MAX_TRAVEL_SEARCH : -MAX_TRAVEL_SEARCH;
  const bounce = isFront ? -BOUNCE : BOUNCE;
  const slowProbe = isFront ? (BOUNCE + 1) : -(BOUNCE + 1);
  const offset = isFront ? -toolRadius : toolRadius;
  const moveAway = isFront ? -BOUNCE : BOUNCE;

  return [
    `; Probe Y - ${selectedSide} (AutoZero Touch - ${selectedBitDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G10 L20 Y0',
    'G91 G21',
    `G38.2 Y${fastProbe} F150`,
    `G91 G0 Y${bounce}`,
    `G38.2 Y${slowProbe} F75`,
    'G4 P0.3',
    `G10 L20 Y${offset}`,
    `G0 Y${moveAway}`,
    'G90',
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  ];
};

export const getXYProbeRoutine = ({ selectedCorner, selectedBitDiameter = 'Auto', rapidMovement = 2000 }) => {
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
    'G38.3 X0 Y0 F2000',
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  );

  return code;
};

export const getXYZProbeRoutine = ({ selectedCorner, selectedBitDiameter = 'Auto' }) => {
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

  code.push(...getXYProbeRoutine({ selectedCorner, selectedBitDiameter }));

  // TODO: Moe the 0 workoffset.

  return code;
};
