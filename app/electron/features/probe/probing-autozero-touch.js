// AutoZero Touch Probe routines
// For AutoZero touch probe with various bit diameters

// Constants for probe movements
const BOUNCE = 4;

export const getZProbeRoutine = (selectedBitDiameter = 'Auto') => {
  return [
    `; Probe Z - AutoZero Touch (${selectedBitDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G21 G91',
    'G38.2 Z-25 F200',
    `G0 Z${BOUNCE}`,
    `G38.2 Z-${BOUNCE + 1} F75`,
    'G4 P0.3',
    'G10 L20 Z0',
    'G0 Z10',
    'G90',
    'O100 IF [#<wasMetric> EQ 0] G20 O100 ENDIF'
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

  const fastProbe = isLeft ? 30 : -30;
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
    'O100 IF [#<wasMetric> EQ 0] G20 O100 ENDIF'
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

  const fastProbe = isFront ? 30 : -30;
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
    'O100 IF [#<wasMetric> EQ 0] G20 O100 ENDIF'
  ];
};

export const getXYProbeRoutine = ({ selectedCorner, selectedBitDiameter = 'Auto', skipPrepMove = false }) => {
  let diameter = 0;

  if (selectedBitDiameter === 'Auto') {
    diameter = 0;
  } else if (selectedBitDiameter === 'Tip') {
    diameter = 0;
  } else {
    diameter = parseFloat(selectedBitDiameter);
  }

  const toolRadius = diameter / 2;

  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft';
  const isBottom = selectedCorner === 'BottomLeft' || selectedCorner === 'BottomRight';

  const xProbe = isLeft ? 30 : -30;
  const yProbe = isBottom ? 30 : -30;
  const xRetract = isLeft ? -BOUNCE : BOUNCE;
  const yRetract = isBottom ? -BOUNCE : BOUNCE;
  const xSlow = isLeft ? (BOUNCE + 1) : -(BOUNCE + 1);
  const ySlow = isBottom ? (BOUNCE + 1) : -(BOUNCE + 1);
  const xOffset = isLeft ? -toolRadius : toolRadius;
  const yOffset = isBottom ? -toolRadius : toolRadius;

  const xMove = isLeft ? (diameter + 16) : -(diameter + 16);
  const yMove = isBottom ? (diameter + 16) : -(diameter + 16);

  const code = [
    `; Probe XY - ${selectedCorner} (AutoZero Touch - ${selectedBitDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G91 G21',
  ];

  if (!skipPrepMove) {
    code.push(
      `G0 X${xRetract} Y${yRetract}`,
      `G0 Y${yMove}`
    );
  }

  code.push(
    `G38.2 X${xProbe} F150`,
    `G0 X${xRetract}`,
    `G38.2 X${xSlow} F75`,
    'G4 P0.3',
    `G10 L20 X${xOffset}`,
  );

  code.push(
    `G0 X${xRetract * 2}`,
    `G0 Y${-yMove+yRetract}`,
    `G0 X${xMove}`,
  );

  code.push(
    `G38.2 Y${yProbe} F150`,
    `G91 G0 Y${yRetract}`,
    `G38.2 Y${ySlow} F75`,
    'G4 P0.3',
    `G10 L20 Y${yOffset}`,
    `G0 Y${yRetract}`,
  );

  code.push(
    'G0 Z10',
    'G90 G0 X0 Y0',
    'G21',
    'O100 IF [#<wasMetric> EQ 0] G20 O100 ENDIF'
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

  code.push(
    'G91',
    `G0 X${xMove}`,
    'G0 Z-14'
  );

  code.push(...getXYProbeRoutine({ selectedCorner, selectedBitDiameter, skipPrepMove: true }));

  return code;
};
