// 3D Probe routines
// For ball-point 3D touch probes

export const zParkHeight = 4;

export const getZProbeRoutine = (zOffset = 0) => {
  return [
    '; Probe Z',
    `#<return_units> = [20 + #<_metric>]`,
    'G21 G91',
    'G38.2 Z-25 F200',
    'G0 Z4',
    'G38.2 Z-5 F75',
    'G4 P0.3',
    `G10 L20 Z${zOffset}`,
    `G0 Z${zParkHeight}`,
    'G90',
    'G[#<return_units>]'
  ];
};

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
    `#<return_units> = [20 + #<_metric>]`,
    'G10 L20 X0',
    'G91 G21',
    `G38.2 X${fastProbe} F150`,
    `G91 G0 X${bounce}`,
    `G38.2 X${slowProbe} F75`,
    'G4 P0.3',
    `G10 L20 X${offset}`,
    `G0 X${moveAway}`,
    'G90',
    'G[#<return_units>]'
  ];
};

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
    `#<return_units> = [20 + #<_metric>]`,
    'G10 L20 Y0',
    'G91 G21',
    `G38.2 Y${fastProbe} F150`,
    `G91 G0 Y${bounce}`,
    `G38.2 Y${slowProbe} F75`,
    'G4 P0.3',
    `G10 L20 Y${offset}`,
    `G0 Y${moveAway}`,
    'G90',
    'G[#<return_units>]'
  ];
};

export const getXYProbeRoutine = ({ selectedCorner, toolDiameter = 6, skipPrepMove = false, zPlunge = 3 }) => {
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

  const zRetract = zPlunge + zParkHeight;

  const code = [
    `; Probe XY - ${selectedCorner}`,
    `#<return_units> = [20 + #<_metric>]`,
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
    `G0 Z${zRetract}`,
    'G90 G0 X0 Y0',
    'G21',
    'G[#<return_units>]'
  );

  return code;
};

export const getXYZProbeRoutine = ({ selectedCorner, toolDiameter = 6, zPlunge = 3, zOffset = 0 }) => {
  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft';
  const xMove = isLeft ? -(toolDiameter + 16) : (toolDiameter + 16);
  const code = [];

  code.push(...getZProbeRoutine(zOffset));

  code.push(
    'G91',
    `G0 X${xMove}`,
    `G0 Z-${zPlunge+zParkHeight}`
  );

  code.push(...getXYProbeRoutine({ selectedCorner, toolDiameter, skipPrepMove: true, zPlunge }));

  return code;
};

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
    `#<return_units> = [20 + #<_metric>]`,
    `#<X_SIZE> = ${xDimension} (Estimated X dimension, mm)`,
    `#<Y_SIZE> = ${yDimension} (Estimated Y dimension, mm)`,
    `#<RAPID_SEARCH> = ${rapidMovement}`,
    'G21 (mm mode)',
    "G91 (incremental)",
  ];

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
    'G90',
    'G[#<return_units>]'
  );

  return code;
};

export const getCenterOuterRoutine = ({ xDimension, yDimension, toolDiameter = 2, rapidMovement = 2000, probeZFirst = false, zPlunge = 3, zOffset = 0 }) => {
  const halfX = xDimension / 2;
  const halfY = yDimension / 2;
  const searchFeed = 150;
  const slowFeed = 75;
  const bounce = 2;
  const maxSearchLimit = 30;
  const safeDistance = 5;
  const zHop = zPlunge + zParkHeight;

  const safeRapidX = halfX + toolDiameter + safeDistance;
  const safeRapidY = halfY + toolDiameter + safeDistance;

  const code = [];

  if (probeZFirst) {
    code.push(...getZProbeRoutine(zOffset));
  }

  code.push(
    '; Probing Center - Outer',
    `#<return_units> = [20 + #<_metric>]`,
    `#<X_SIZE> = ${xDimension} (Estimated X dimension, mm)`,
    `#<Y_SIZE> = ${yDimension} (Estimated Y dimension, mm)`,
    `#<RAPID_SEARCH> = ${rapidMovement}`,
    'G21 (mm mode)',
    'G91 (incremental)',
  );

  if (safeRapidX > 0) {
    code.push(`G38.3 X-${safeRapidX} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G38.3 Z-${zHop} F200`,
    `G38.2 X${maxSearchLimit} F${searchFeed}`,
    `G0 X-${bounce}`,
    `G38.2 X${bounce+1} F${slowFeed}`,
    `#<X1> = #5061`,
    `G0 X-${bounce}`,
    `G0 Z${zHop}`,
    `G0 X${bounce}`,
    `G0 X${halfX}`
  );

  if (safeRapidX > 0) {
    code.push(`G38.3 X${safeRapidX} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G38.3 Z-${zHop} F200`,
    `G38.2 X-${maxSearchLimit} F${searchFeed}`,
    `G0 X${bounce}`,
    `G38.2 X-${bounce+1} F${slowFeed}`,
    `#<X2> = #5061`,
    `G0 X${bounce}`,
    `G0 Z${zHop}`,
    `G0 X-${bounce}`,
    'G0 X-[[#<X2>-#<X1>]/2]'
  );

  if (safeRapidY > 0) {
    code.push(`G38.3 Y-${safeRapidY} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G38.3 Z-${zHop} F200`,
    `G38.2 Y${maxSearchLimit} F${searchFeed}`,
    `G0 Y-${bounce}`,
    `G38.2 Y+${bounce+1} F${slowFeed}`,
    `#<Y1> = #5062`,
    `G0 Y-${bounce}`,
    `G0 Z${zHop}`,
    `G0 Y${bounce}`,
    `G0 Y${halfY}`
  );

  if (safeRapidY > 0) {
    code.push(`G38.3 Y${safeRapidY} F#<RAPID_SEARCH>`);
  }

  code.push(
    `G38.3 Z-${zHop} F200`,
    `G38.2 Y-${maxSearchLimit} F${searchFeed}`,
    `G0 Y${bounce}`,
    `G38.2 Y-${bounce+1} F${slowFeed}`,
    `#<Y2> = #5062`,
    `G0 Y${bounce}`,
    `G0 Z${zHop}`,
    `G0 Y-${bounce}`,
    `G0 Y-[[#<Y2>-#<Y1>]/2]`,
    'G10 L20 X0 Y0',
    'G90',
    'G[#<return_units>]'
  );

  return code;
};
