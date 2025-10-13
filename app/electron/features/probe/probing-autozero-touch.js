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

  // Inner X side
  if (!spec.isTip) {
    code.push(
      `G38.3 X${safeRapidDistance * isLeft} F${rapidMovement}`,
      `#<probe_hit> = #5070`,
      'O100 IF [#<probe_hit> EQ 1]',
      `  G0 X${-RAPID_PROBE_BOUNCE * isLeft}`,
      'O100 ENDIF'
    );
  }
  code.push(
    `G38.2 X${halfClearance * isLeft} F150`,
    `G0 X${-BOUNCE * isLeft}`,
    `G38.2 X${(BOUNCE + 1) * isLeft} F75`,
    WAIT_COMMAND,
    '#<X1> = #5061',
    `G0 X${-(halfClearance - spec.toolRadius) * isLeft}`
  );

  if (spec.isAuto) {
    // Outer X side
    if (!spec.isTip) {
      code.push(
        `G38.3 X${-safeRapidDistance * isLeft} F${rapidMovement}`,
        `#<probe_hit> = #5070`,
        'O100 IF [#<probe_hit> EQ 1]',
        `  G0 X${RAPID_PROBE_BOUNCE * isLeft}`,
        'O100 ENDIF'
      );
    }
    code.push(
      `G38.2 X${-halfClearance * isLeft} F150`,
      `G0 X${BOUNCE * isLeft}`,
      `G38.2 X${-(BOUNCE + 1) * isLeft} F75`,
      WAIT_COMMAND,
      '#<X2> = #5061',
      'G0 X[[#<X1>-#<X2>]/2]'
    );
  }

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

  // Inner Y side
  if (!spec.isTip) {
    code.push(
      `G38.3 Y${safeRapidDistance * isBottom} F${rapidMovement}`,
      `#<probe_hit> = #5070`,
      'O100 IF [#<probe_hit> EQ 1]',
      `  G0 Y${-RAPID_PROBE_BOUNCE * isBottom}`,
      'O100 ENDIF'
    );
  }
  code.push(
    `G38.2 Y${halfClearance * isBottom} F150`,
    `G0 Y${-BOUNCE * isBottom}`,
    `G38.2 Y${(BOUNCE + 1) * isBottom} F75`,
    WAIT_COMMAND,
    `#<Y1> = #5062`,
    `G0 Y${-(halfClearance - spec.toolRadius) * isBottom}`
  );

  if (spec.isAuto) {
    // Outer Y side
    if (!spec.isTip) {
      code.push(
        `G38.3 Y${-safeRapidDistance * isBottom} F${rapidMovement}`,
        `#<probe_hit> = #5070`,
        'O100 IF [#<probe_hit> EQ 1]',
        `  G0 Y${RAPID_PROBE_BOUNCE * isBottom}`,
        'O100 ENDIF'
      );
    }
    code.push(
      `G38.2 Y${-halfClearance * isBottom} F150`,
      `G0 Y${BOUNCE * isBottom}`,
      `G38.2 Y${-(BOUNCE + 1) * isBottom} F75`,
      WAIT_COMMAND,
      `#<Y2> = #5062`,
      'G0 Y[[#<Y1>-#<Y2>]/2]'
    );
  }

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

  // Inner X side
  if (!spec.isTip) {
    code.push(
      `G38.3 X${safeRapidDistance * isLeft} F${rapidMovement}`,
      `#<probe_hit> = #5070`,
      'O100 IF [#<probe_hit> EQ 1]',
      `  G0 X${-RAPID_PROBE_BOUNCE * isLeft}`,
      'O100 ENDIF'
    );
  }
  code.push(
    `G38.2 X${halfClearance * isLeft} F150`,
    `G0 X${-BOUNCE * isLeft}`,
    `G38.2 X${(BOUNCE + 1) * isLeft} F75`,
    WAIT_COMMAND,
    '#<X1> = #5061',
    `G0 X${-(halfClearance - spec.toolRadius) * isLeft}`
  );

  if (spec.isAuto) {
    // Outer X side
    if (!spec.isTip) {
      code.push(
        `G38.3 X${-safeRapidDistance * isLeft} F${rapidMovement}`,
        `#<probe_hit> = #5070`,
        'O100 IF [#<probe_hit> EQ 1]',
        `  G0 X${RAPID_PROBE_BOUNCE * isLeft}`,
        'O100 ENDIF'
      );
    }
    code.push(
      `G38.2 X${-halfClearance * isLeft} F150`,
      `G0 X${BOUNCE * isLeft}`,
      `G38.2 X${-(BOUNCE + 1) * isLeft} F75`,
      WAIT_COMMAND,
      '#<X2> = #5061',
      'G0 X[[#<X1>-#<X2>]/2]'
    );
  }

  // Inner Y side
  if (!spec.isTip) {
    code.push(
      `G38.3 Y${safeRapidDistance * isBottom} F${rapidMovement}`,
      `#<probe_hit> = #5070`,
      'O100 IF [#<probe_hit> EQ 1]',
      `  G0 Y${-RAPID_PROBE_BOUNCE * isBottom}`,
      'O100 ENDIF'
    );
  }
  code.push(
    `G38.2 Y${halfClearance * isBottom} F150`,
    `G0 Y${-BOUNCE * isBottom}`,
    `G38.2 Y${(BOUNCE + 1) * isBottom} F75`,
    WAIT_COMMAND,
    `#<Y1> = #5062`,
    `G0 Y${-(halfClearance - spec.toolRadius) * isBottom}`
  );

  if (spec.isAuto) {
    // Outer Y side
    if (!spec.isTip) {
      code.push(
        `G38.3 Y${-safeRapidDistance * isBottom} F${rapidMovement}`,
        `#<probe_hit> = #5070`,
        'O100 IF [#<probe_hit> EQ 1]',
        `  G0 Y${RAPID_PROBE_BOUNCE * isBottom}`,
        'O100 ENDIF'
      );
    }
    code.push(
      `G38.2 Y${-halfClearance * isBottom} F150`,
      `G0 Y${BOUNCE * isBottom}`,
      `G38.2 Y${-(BOUNCE + 1) * isBottom} F75`,
      WAIT_COMMAND,
      `#<Y2> = #5062`,
      'G0 Y[[#<Y1>-#<Y2>]/2]'
    );
  }

  // Final Y position


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
