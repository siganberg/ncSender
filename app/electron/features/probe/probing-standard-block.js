// Standard Block Probe routines
// For rectangular touch probe blocks

export const getZProbeRoutine = (zThickness = 25) => {
  return [
    '; Probe Z - Standard Block',
    `#<wasMetric> = #<_metric>`,
    'G21 G91',
    'G38.2 Z-30 F200',
    'G0 Z4',
    'G38.2 Z-5 F75',
    'G4 P0.3',
    `G10 L20 Z${zThickness}`,
    'G0 Z10',
    'G90',
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  ];
};

export const getXProbeRoutine = ({ selectedSide, xyThickness = 50 }) => {
  const isLeft = selectedSide === 'Left';
  const fastProbe = isLeft ? 30 : -30;
  const bounce = isLeft ? -4 : 4;
  const slowProbe = isLeft ? 5 : -5;
  const offset = isLeft ? -xyThickness : xyThickness;
  const moveAway = isLeft ? -4 : 4;

  return [
    `; Probe X - ${selectedSide} (Standard Block)`,
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

export const getYProbeRoutine = ({ selectedSide, xyThickness = 50 }) => {
  const isFront = selectedSide === 'Front';
  const fastProbe = isFront ? 30 : -30;
  const bounce = isFront ? -4 : 4;
  const slowProbe = isFront ? 5 : -5;
  const offset = isFront ? -xyThickness : xyThickness;
  const moveAway = isFront ? -4 : 4;

  return [
    `; Probe Y - ${selectedSide} (Standard Block)`,
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

export const getXYProbeRoutine = ({ selectedCorner, xyThickness = 50, skipPrepMove = false }) => {
  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft';
  const isBottom = selectedCorner === 'BottomLeft' || selectedCorner === 'BottomRight';

  const xProbe = isLeft ? 30 : -30;
  const yProbe = isBottom ? 30 : -30;
  const xRetract = isLeft ? -4 : 4;
  const yRetract = isBottom ? -4 : 4;
  const xSlow = isLeft ? 5 : -5;
  const ySlow = isBottom ? 5 : -5;
  const xOffset = isLeft ? -xyThickness : xyThickness;
  const yOffset = isBottom ? -xyThickness : xyThickness;

  const xMove = isLeft ? (xyThickness + 16) : -(xyThickness + 16);
  const yMove = isBottom ? (xyThickness + 16) : -(xyThickness + 16);

  const code = [
    `; Probe XY - ${selectedCorner} (Standard Block)`,
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
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  );

  return code;
};

export const getXYZProbeRoutine = ({ selectedCorner, xyThickness = 50, zThickness = 25, zProbeDistance = 3 }) => {
  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft';
  const xMove = isLeft ? -(xyThickness + 16) : (xyThickness + 16);
  const code = [];

  code.push(...getZProbeRoutine(zThickness));

  code.push(
    'G91',
    `G0 X${xMove}`,
    `G0 Z-${zProbeDistance + 10}`
  );

  code.push(...getXYProbeRoutine({ selectedCorner, xyThickness, skipPrepMove: true }));

  return code;
};
