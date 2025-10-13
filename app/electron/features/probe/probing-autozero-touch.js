// AutoZero Touch Probe routines
// For AutoZero touch probe with various bit diameters

const BOUNCE = 3;
const PLATE_THICKNESS = 4; // mm
const AUTO_PLATE_INNER_DIMENSION = 45;
const AUTO_DIAMETER_FALLBACK = 6.35; // Assume 1/4" when auto-detecting
const TIP_EFFECTIVE_DIAMETER = 0.5; // Effective diameter for tip probing
const SAFE_RAPID_MARGIN = 5;
const WAIT_COMMAND = 'G4 P0.1';

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

  if (spec.isTip) {
    code.push('G38.2 Z-25 F150', 'G0 Z1');
  }

  if (spec.isAuto) {
    if (!spec.isTip) {
      code.push(
        `G38.3 X${-safeRapidDistance * isLeft} F${rapidMovement}`,
        `#<probe_hit> = #5070`,
        'O100 IF [#<probe_hit> EQ 1]',
        `  G0 X${1 * isLeft}`,
        'O100 ENDIF'
      );
    }
    code.push(
      `G38.2 X${-halfClearance * isLeft} F150`,
      `G0 X${BOUNCE * isLeft}`,
      `G38.2 X${-(BOUNCE + 1) * isLeft} F75`,
      WAIT_COMMAND,
      `#<X1> = #5061`,
      `G0 X${halfClearance * isLeft}`
    );
  }

  if (!spec.isTip) {
    code.push(
      `G38.3 X${safeRapidDistance * isLeft} F${rapidMovement}`,
      `#<probe_hit> = #5070`,
      'O100 IF [#<probe_hit> EQ 1]',
      `  G0 X${-1 * isLeft}`,
      'O100 ENDIF'
    );
  }
  code.push(
    `G38.2 X${halfClearance * isLeft} F150`,
    `G0 X${-BOUNCE * isLeft}`,
    `G38.2 X${(BOUNCE + 1) * isLeft} F75`,
    WAIT_COMMAND
  );

  if (spec.isAuto) {
    code.push(
      `#<X2> = #5061`,
      'G0 X-[[#<X2>-#<X1>]/2]'
    );
  } else {
    code.push(`G0 X${-((halfClearance - spec.toolRadius / 2) * isLeft)}`);
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
  const isFront = selectedSide === 'Front' ? 1 : -1;
  const halfClearance = AUTO_PLATE_INNER_DIMENSION / 2;
  const safeRapidDistance = computeSafeRapidDistance(spec.effectiveDiameter);

  const code = [
    `; Probe Y - ${selectedSide} (AutoZero Touch - ${spec.displayDiameter})`,
    `#<wasMetric> = #<_metric>`,
    'G91 G21'
  ];

  if (spec.isTip) {
    code.push('G38.2 Z-25 F150', 'G0 Z1');
  }

  if (spec.isAuto) {
    if (!spec.isTip) {
      code.push(
        `G38.3 Y${-safeRapidDistance * isFront} F${rapidMovement}`,
        `#<probe_hit> = #5070`,
        'O100 IF [#<probe_hit> EQ 1]',
        `  G0 Y${1 * isFront}`,
        'O100 ENDIF'
      );
    }
    code.push(
      `G38.2 Y${-halfClearance * isFront} F150`,
      `G0 Y${BOUNCE * isFront}`,
      `G38.2 Y${-(BOUNCE + 1) * isFront} F75`,
      WAIT_COMMAND,
      `#<Y1> = #5062`,
      `G0 Y${halfClearance * isFront}`
    );
  }

  if (!spec.isTip) {
    code.push(
      `G38.3 Y${safeRapidDistance * isFront} F${rapidMovement}`,
      `#<probe_hit> = #5070`,
      'O100 IF [#<probe_hit> EQ 1]',
      `  G0 Y${-1 * isFront}`,
      'O100 ENDIF'
    );
  }
  code.push(
    `G38.2 Y${halfClearance * isFront} F150`,
    `G0 Y${-BOUNCE * isFront}`,
    `G38.2 Y${(BOUNCE + 1) * isFront} F75`,
    WAIT_COMMAND
  );

  if (spec.isAuto) {
    code.push(
      `#<Y2> = #5062`,
      'G0 Y-[[#<Y2>-#<Y1>]/2]'
    );
  } else {
    code.push(`G0 Y${-((halfClearance - spec.toolRadius / 2) * isFront)}`);
  }

  code.push(
    `G10 L20 Y${halfClearance * isFront}`,
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
    skipZMovement = false,
    returnToXYZero = false,
    moveToZero: legacyMoveToZero = false
  } = options;

  const spec = resolveBitSpecification(selectedBitDiameter);
  const isLeft = selectedCorner === 'TopLeft' || selectedCorner === 'BottomLeft' ? 1 : -1;
  const isBottom = selectedCorner === 'BottomLeft' || selectedCorner === 'BottomRight' ? 1 : -1;
  const halfClearance = AUTO_PLATE_INNER_DIMENSION / 2;
  const safeRapidDistance = computeSafeRapidDistance(spec.effectiveDiameter);
  const shouldReturnToXYZero = returnToXYZero || legacyMoveToZero;

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

  if (spec.isAuto) {
    if (!spec.isTip) {
      code.push(
        `G38.3 X${-safeRapidDistance * isLeft} F${rapidMovement}`,
        `#<probe_hit> = #5070`,
        'O100 IF [#<probe_hit> EQ 1]',
        `  G0 X${1 * isLeft}`,
        'O100 ENDIF'
      );
    }
    code.push(
      `G38.2 X${-halfClearance * isLeft} F150`,
      `G0 X${BOUNCE * isLeft}`,
      `G38.2 X${-(BOUNCE + 1) * isLeft} F75`,
      WAIT_COMMAND,
      `#<X1> = #5061`,
      `G0 X${(halfClearance - spec.toolRadius) * isLeft}`
    );
  }

  if (!spec.isTip) {
    code.push(
      `G38.3 X${safeRapidDistance * isLeft} F${rapidMovement}`,
      `#<probe_hit> = #5070`,
      'O100 IF [#<probe_hit> EQ 1]',
      `  G0 X${-1 * isLeft}`,
      'O100 ENDIF'
    );
  }
  code.push(
    `G38.2 X${halfClearance * isLeft} F150`,
    `G0 X${-BOUNCE * isLeft}`,
    `G38.2 X${(BOUNCE + 1) * isLeft} F75`,
    WAIT_COMMAND
  );

  if (spec.isAuto) {
    code.push(
      `#<X2> = #5061`,
      'G0 X-[[#<X2>-#<X1>]/2]'
    );
  } else {
    code.push(`G0 X${-((halfClearance - spec.toolRadius) * isLeft)}`);
  }

  if (shouldReturnToXYZero) {
    code.push('G0 X0');
  }

  if (spec.isAuto) {
    if (!spec.isTip) {
      code.push(
        `G38.3 Y${-safeRapidDistance * isBottom} F${rapidMovement}`,
        `#<probe_hit> = #5070`,
        'O100 IF [#<probe_hit> EQ 1]',
        `  G0 Y${1 * isBottom}`,
        'O100 ENDIF'
      );
    }
    code.push(
      `G38.2 Y${-halfClearance * isBottom} F150`,
      `G0 Y${BOUNCE * isBottom}`,
      `G38.2 Y${-(BOUNCE + 1) * isBottom} F75`,
      WAIT_COMMAND,
      `#<Y1> = #5062`,
      `G0 Y${(halfClearance - spec.toolRadius) * isBottom}`
    );
  }

  if (!spec.isTip) {
    code.push(
      `G38.3 Y${safeRapidDistance * isBottom} F${rapidMovement}`,
      `#<probe_hit> = #5070`,
      'O100 IF [#<probe_hit> EQ 1]',
      `  G0 Y${-1 * isBottom}`,
      'O100 ENDIF'
    );
  }
  code.push(
    `G38.2 Y${halfClearance * isBottom} F150`,
    `G0 Y${-BOUNCE * isBottom}`,
    `G38.2 Y${(BOUNCE + 1) * isBottom} F75`,
    WAIT_COMMAND
  );

  if (spec.isAuto) {
    code.push(
      `#<Y2> = #5062`,
      'G0 Y-[[#<Y2>-#<Y1>]/2]',
      `G10 L20 X${halfClearance * isLeft} Y${halfClearance * isBottom}`
    );
  } else {
    const targetOffset = halfClearance - spec.toolRadius;
    code.push(
      `G0 Y${-(targetOffset) * isBottom}`,
      `G10 L20 X${targetOffset * isLeft} Y${targetOffset * isBottom}`
    );
  }

  code.push('G90');
  if (!spec.isTip) {
    code.push(`G38.3 X0 Y0 F${rapidMovement}`);
    if (moveToZWorkspace) {
      code.push(`G38.3 Z0 F${rapidMovement}`);
    }
  } else if (moveToZWorkspace) {
    code.push(`G38.2 Z0 F${rapidMovement}`);
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
