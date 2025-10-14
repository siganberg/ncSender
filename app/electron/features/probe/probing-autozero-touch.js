// AutoZero Touch Probe routines
// For AutoZero touch probe with various bit diameters

const BOUNCE = 3;
const PLATE_THICKNESS = 4; // mm
const AUTO_PLATE_INNER_DIMENSION = 45;
const AUTO_DIAMETER_FALLBACK = 6.35; // Assume 1/4" when auto-detecting
const TIP_EFFECTIVE_DIAMETER = 0.5; // Effective diameter for tip probing
const SAFE_RAPID_MARGIN = 0;
const WAIT_COMMAND = 'G4 P0.1';
const RAPID_PROBE_BOUNCE = 2; // mm to bounce back if rapid probe (G38.3) hits

const resolveBitSpecification = (selectedBitDiameter = 'Auto') => {
  const normalized =
    typeof selectedBitDiameter === 'string'
      ? selectedBitDiameter.trim()
      : selectedBitDiameter;

  if (normalized === 'Tip') {
    return {
      displayDiameter: 'Tip',
      isAuto: true,
      isTip: true,
      rawDiameter: 0,
      effectiveDiameter: TIP_EFFECTIVE_DIAMETER,
      toolRadius: 0
    };
  }

  if (normalized === 'Auto') {
    return {
      displayDiameter: 'Auto',
      isAuto: true,
      isTip: false,
      rawDiameter: 0,
      effectiveDiameter: AUTO_DIAMETER_FALLBACK,
      toolRadius: AUTO_DIAMETER_FALLBACK/2
    };
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return {
      displayDiameter: 'Auto',
      isAuto: true,
      isTip: false,
      rawDiameter: 0,
      effectiveDiameter: AUTO_DIAMETER_FALLBACK,
      toolRadius: AUTO_DIAMETER_FALLBACK/2
    };
  }

  return {
    displayDiameter: parsed.toString(),
    isAuto: false,
    isTip: false,
    rawDiameter: parsed,
    effectiveDiameter: parsed,
    toolRadius: parsed / 2
  };
};

const computeSafeRapidDistance = (effectiveDiameter) =>
  AUTO_PLATE_INNER_DIMENSION / 2 - effectiveDiameter - SAFE_RAPID_MARGIN;

const buildAxisProbeSequence = ({
  axis,
  directionSign,
  spec,
  halfClearance,
  safeRapidDistance,
  rapidMovement
}) => {
  const axisUpper = axis.toUpperCase();
  const axisRegister = axisUpper === 'X' ? '#5061' : axisUpper === 'Y' ? '#5062' : null;

  if (!axisRegister) {
    throw new Error(`Unsupported axis ${axis} for AutoZero probing routine.`);
  }

  const axisCode = [];

  if (!spec.isTip) {
    axisCode.push(
      `G38.3 ${axisUpper}${safeRapidDistance * directionSign} F${rapidMovement}`,
      `#<probe_hit> = #5070`,
      'O100 IF [#<probe_hit> EQ 1]',
      `  G0 ${axisUpper}${-RAPID_PROBE_BOUNCE * directionSign}`,
      'O100 ENDIF'
    );
  }

  axisCode.push(
    `G38.2 ${axisUpper}${halfClearance * directionSign} F150`,
    `G0 ${axisUpper}${-BOUNCE * directionSign}`,
    `G38.2 ${axisUpper}${(BOUNCE + 1) * directionSign} F75`,
    WAIT_COMMAND,
    `#<${axisUpper}1> = ${axisRegister}`,
    `G0 ${axisUpper}${-(halfClearance - spec.toolRadius) * directionSign}`
  );

  if (spec.isAuto) {
    if (!spec.isTip) {
      axisCode.push(
        `G38.3 ${axisUpper}${-safeRapidDistance * directionSign} F${rapidMovement}`,
        `#<probe_hit> = #5070`,
        'O100 IF [#<probe_hit> EQ 1]',
        `  G0 ${axisUpper}${RAPID_PROBE_BOUNCE * directionSign}`,
        'O100 ENDIF'
      );
    }
    axisCode.push(
      `G38.2 ${axisUpper}${-halfClearance * directionSign} F150`,
      `G0 ${axisUpper}${BOUNCE * directionSign}`,
      `G38.2 ${axisUpper}${-(BOUNCE + 1) * directionSign} F75`,
      WAIT_COMMAND,
      `#<${axisUpper}2> = ${axisRegister}`,
      `G0 ${axisUpper}[[#<${axisUpper}1>-#<${axisUpper}2>]/2]`
    );
  }

  return axisCode;
};

export const getZProbeRoutine = (selectedBitDiameter = 'Auto') => {
  return [
    `; Probe Z - AutoZero Touch (${selectedBitDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G21 G91',
    'G38.2 Z-25 F200',
    `G0 Z${BOUNCE}`,
    `G38.2 Z-${BOUNCE + 1} F75`,
    WAIT_COMMAND,
    `G10 L20 Z${PLATE_THICKNESS}`,
    'G0 Z5',
    'G90',
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  ];
};

export const getXProbeRoutine = ({ selectedSide, selectedBitDiameter = 'Auto', rapidMovement = 2000 }) => {
  const spec = resolveBitSpecification(selectedBitDiameter);
  const isLeft = selectedSide === 'Left' ? 1 : -1;
  const halfClearance = AUTO_PLATE_INNER_DIMENSION / 2;
  const safeRapidDistance = computeSafeRapidDistance(spec.effectiveDiameter);

  const code = [
    `; Probe X - ${selectedSide} (AutoZero Touch - ${spec.displayDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G91 G21'
  ];

  code.push(...buildAxisProbeSequence({
    axis: 'X',
    directionSign: isLeft,
    spec,
    halfClearance,
    safeRapidDistance,
    rapidMovement
  }));

  code.push(
    `G10 L20 X${halfClearance * isLeft}`,
    'G90',
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  );

  return code;
};

export const getYProbeRoutine = ({ selectedSide, selectedBitDiameter = 'Auto', rapidMovement = 2000 }) => {
  const spec = resolveBitSpecification(selectedBitDiameter);
  const isBottom = selectedSide === 'Front' ? 1 : -1;
  const halfClearance = AUTO_PLATE_INNER_DIMENSION / 2;
  const safeRapidDistance = computeSafeRapidDistance(spec.effectiveDiameter);

  const code = [
    `; Probe Y - ${selectedSide} (AutoZero Touch - ${spec.displayDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G91 G21'
  ];

  code.push(...buildAxisProbeSequence({
    axis: 'Y',
    directionSign: isBottom,
    spec,
    halfClearance,
    safeRapidDistance,
    rapidMovement
  }));

  code.push(
    `G10 L20 Y${halfClearance * isBottom}`,
    'G90',
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  );

  return code;
};

export const getXYProbeRoutine = (options = {}) => {
  const {
    selectedCorner,
    selectedBitDiameter = 'Auto',
    rapidMovement = 2000,
    moveToZWorkspace = false,
    skipZMovement = false
  } = options;

  const spec = resolveBitSpecification(selectedBitDiameter);
  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft' ? 1 : -1;
  const isBottom = selectedCorner === 'BottomLeft' || selectedCorner === 'BottomRight' ? 1 : -1;
  const halfClearance = AUTO_PLATE_INNER_DIMENSION / 2;
  const safeRapidDistance = computeSafeRapidDistance(spec.effectiveDiameter);

  const code = [
    `; Probe XY - ${selectedCorner} (AutoZero Touch - ${spec.displayDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G91 G21'
  ];

  if (!skipZMovement && spec.isTip) {
    code.push(
      'G38.2 Z-15 F150',
      'G0 Z1'
    );
  }

  code.push(...buildAxisProbeSequence({
    axis: 'X',
    directionSign: isLeft,
    spec,
    halfClearance,
    safeRapidDistance,
    rapidMovement
  }));

  code.push(...buildAxisProbeSequence({
    axis: 'Y',
    directionSign: isBottom,
    spec,
    halfClearance,
    safeRapidDistance,
    rapidMovement
  }));

  code.push(
    `G10 L20 X${halfClearance * isLeft} Y${halfClearance * isBottom}`,
    'G90',
    `G38.3 X0 Y0 F${rapidMovement}`
  );

  if (moveToZWorkspace) {
    code.push(`G38.3 Z0 F${rapidMovement}`);
  }

  code.push(
    'O100 IF [#<wasMetric> EQ 0]',
    '  G20',
    'O100 ENDIF'
  );

  return code;
};

export const getXYZProbeRoutine = (options) => {
  const { selectedCorner, selectedBitDiameter = 'Auto', rapidMovement = 2000 } = options;
  const spec = resolveBitSpecification(selectedBitDiameter);

  const compositeOptions = {
    selectedCorner,
    selectedBitDiameter: spec.displayDiameter,
    rapidMovement,
    moveToZWorkspace: true,
    skipZMovement: true
  };

  const code = [
    ...getZProbeRoutine(spec.displayDiameter)
  ];

  code.push(...getXYProbeRoutine(compositeOptions));

  return code;
};
