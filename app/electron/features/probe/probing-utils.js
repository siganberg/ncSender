import * as probe3D from './probing-3d-probe.js';
import * as probeStandardBlock from './probing-standard-block.js';
import * as probeAutozero from './probing-autozero-touch.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('ProbingUtils');

const CORNER_VALUES = new Set(['TopRight', 'TopLeft', 'BottomRight', 'BottomLeft']);
const X_SIDE_VALUES = new Set(['Left', 'Right']);
const Y_SIDE_VALUES = new Set(['Front', 'Back']);
const SIDE_VALUES = new Set([...X_SIDE_VALUES, ...Y_SIDE_VALUES]);
const BIT_DIAMETER_SPECIAL = new Set(['Auto', 'Tip']);

const STRATEGIES = {
  '3d-probe': {
    axes: {
      Z: {
        numbers: {
          zOffset: { defaultValue: 0 }
        },
        run: (options) => probe3D.getZProbeRoutine(options.zOffset)
      },
      XYZ: {
        strings: {
          selectedCorner: { allowed: CORNER_VALUES, required: true }
        },
        numbers: {
          toolDiameter: { defaultValue: 6, min: 0 },
          zPlunge: { defaultValue: 3, min: 0 },
          zOffset: { defaultValue: 0 }
        },
        run: (options) => probe3D.getXYZProbeRoutine(options)
      },
      XY: {
        strings: {
          selectedCorner: { allowed: CORNER_VALUES, required: true }
        },
        numbers: {
          toolDiameter: { defaultValue: 6, min: 0 }
        },
        run: (options) => probe3D.getXYProbeRoutine(options)
      },
      X: {
        strings: {
          selectedSide: { allowed: X_SIDE_VALUES, required: true }
        },
        numbers: {
          toolDiameter: { defaultValue: 6, min: 0 }
        },
        run: (options) => probe3D.getXProbeRoutine(options)
      },
      Y: {
        strings: {
          selectedSide: { allowed: Y_SIDE_VALUES, required: true }
        },
        numbers: {
          toolDiameter: { defaultValue: 6, min: 0 }
        },
        run: (options) => probe3D.getYProbeRoutine(options)
      },
      'Center - Inner': {
        numbers: {
          xDimension: { defaultValue: 0, min: 0 },
          yDimension: { defaultValue: 0, min: 0 },
          toolDiameter: { defaultValue: 2, min: 0 },
          rapidMovement: { defaultValue: 2000, min: 1 },
          zPlunge: { defaultValue: 3, min: 0 }
        },
        run: (options) => probe3D.getCenterInnerRoutine(options)
      },
      'Center - Outer': {
        numbers: {
          xDimension: { defaultValue: 0, min: 0 },
          yDimension: { defaultValue: 0, min: 0 },
          toolDiameter: { defaultValue: 2, min: 0 },
          rapidMovement: { defaultValue: 2000, min: 1 },
          zPlunge: { defaultValue: 3, min: 0 },
          zOffset: { defaultValue: 0 }
        },
        booleans: {
          probeZFirst: { defaultValue: false }
        },
        run: (options) => probe3D.getCenterOuterRoutine(options)
      }
    }
  },
  'standard-block': {
    axes: {
      Z: {
        numbers: {
          zThickness: { defaultValue: 15, min: 0 }
        },
        run: (options) => probeStandardBlock.getZProbeRoutine(options.zThickness)
      },
      XYZ: {
        strings: {
          selectedCorner: { allowed: CORNER_VALUES, required: true }
        },
        numbers: {
          xyThickness: { defaultValue: 10, min: 0 },
          zThickness: { defaultValue: 15, min: 0 },
          zProbeDistance: { defaultValue: 3, min: 0 },
          bitDiameter: { defaultValue: 6.35, min: 0.1 }
        },
        run: (options) => probeStandardBlock.getXYZProbeRoutine(options)
      },
      XY: {
        strings: {
          selectedCorner: { allowed: CORNER_VALUES, required: true }
        },
        numbers: {
          xyThickness: { defaultValue: 10, min: 0 },
          bitDiameter: { defaultValue: 6.35, min: 0.1 }
        },
        run: (options) => probeStandardBlock.getXYProbeRoutine(options)
      },
      X: {
        strings: {
          selectedSide: { allowed: X_SIDE_VALUES, required: true }
        },
        numbers: {
          xyThickness: { defaultValue: 10, min: 0 },
          bitDiameter: { defaultValue: 6.35, min: 0.1 }
        },
        run: (options) => probeStandardBlock.getXProbeRoutine(options)
      },
      Y: {
        strings: {
          selectedSide: { allowed: Y_SIDE_VALUES, required: true }
        },
        numbers: {
          xyThickness: { defaultValue: 10, min: 0 },
          bitDiameter: { defaultValue: 6.35, min: 0.1 }
        },
        run: (options) => probeStandardBlock.getYProbeRoutine(options)
      }
    }
  },
  'autozero-touch': {
    axes: {
      Z: {
        strings: {
          selectedBitDiameter: { validator: validateBitDiameter, required: true }
        },
        run: (options) => probeAutozero.getZProbeRoutine(options.selectedBitDiameter)
      },
      XYZ: {
        strings: {
          selectedCorner: { allowed: CORNER_VALUES, required: true },
          selectedBitDiameter: { validator: validateBitDiameter, required: true }
        },
        numbers: {
          rapidMovement: { defaultValue: 2000, min: 1 }
        },
        booleans: {
          returnToXYZero: { defaultValue: false },
          skipZMovement: { defaultValue: false }
        },
        run: (options) => probeAutozero.getXYZProbeRoutine(options)
      },
      XY: {
        strings: {
          selectedCorner: { allowed: CORNER_VALUES, required: true },
          selectedBitDiameter: { validator: validateBitDiameter, required: true }
        },
        numbers: {
          rapidMovement: { defaultValue: 2000, min: 1 }
        },
        booleans: {
          returnToXYZero: { defaultValue: false },
          skipZMovement: { defaultValue: false }
        },
        run: (options) => probeAutozero.getXYProbeRoutine(options)
      },
      X: {
        strings: {
          selectedSide: { allowed: X_SIDE_VALUES, required: true },
          selectedBitDiameter: { validator: validateBitDiameter, required: true }
        },
        numbers: {
          rapidMovement: { defaultValue: 2000, min: 1 }
        },
        run: (options) => probeAutozero.getXProbeRoutine(options)
      },
      Y: {
        strings: {
          selectedSide: { allowed: Y_SIDE_VALUES, required: true },
          selectedBitDiameter: { validator: validateBitDiameter, required: true }
        },
        numbers: {
          rapidMovement: { defaultValue: 2000, min: 1 }
        },
        run: (options) => probeAutozero.getYProbeRoutine(options)
      }
    }
  }
};

export const PROBE_TYPES = Object.keys(STRATEGIES);
export const PROBE_AXES_BY_TYPE = Object.fromEntries(
  Object.entries(STRATEGIES).map(([type, strategy]) => [type, Object.keys(strategy.axes)])
);

export const validateProbeOptions = (rawOptions) => {
  const errors = [];
  const safe = {};
  const source = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};

  const probeType = typeof source.probeType === 'string' ? source.probeType.trim() : '';
  if (!probeType || !STRATEGIES[probeType]) {
    errors.push('Invalid probe type');
  }

  const probingAxis = typeof source.probingAxis === 'string' ? source.probingAxis.trim() : '';
  const strategy = STRATEGIES[probeType];
  const axisConfig = strategy?.axes?.[probingAxis];

  if (!probingAxis || !axisConfig) {
    errors.push('Invalid probing axis for selected probe type');
  }

  safe.probeType = probeType;
  safe.probingAxis = probingAxis;

  // Map standardBlockBitDiameter to bitDiameter for Standard Block probe
  if (probeType === 'standard-block' && source.standardBlockBitDiameter !== undefined) {
    source.bitDiameter = source.standardBlockBitDiameter;
  }

  if (axisConfig) {
    applyStringRules({ source, target: safe, errors }, axisConfig.strings);
    applyNumberRules({ source, target: safe, errors }, axisConfig.numbers);
    applyBooleanRules({ source, target: safe }, axisConfig.booleans);
  }

  // Carry forward optional selections if they pass basic sanity checks
  if (source.selectedCorner && !safe.selectedCorner) {
    const corner = normalizeCorner(source.selectedCorner);
    if (corner) {
      safe.selectedCorner = corner;
    }
  }

  if (source.selectedSide && !safe.selectedSide) {
    const side = normalizeSide(source.selectedSide);
    if (side) {
      safe.selectedSide = side;
    }
  }

  if (source.selectedBitDiameter && !safe.selectedBitDiameter) {
    const bitResult = validateBitDiameter(source.selectedBitDiameter);
    if (bitResult.valid) {
      safe.selectedBitDiameter = bitResult.value;
    } else {
      errors.push(bitResult.error ?? 'Invalid bit diameter');
    }
  }

  if (
    axisConfig?.booleans?.returnToXYZero &&
    safe.returnToXYZero === undefined &&
    typeof source.moveToZero === 'boolean'
  ) {
    safe.returnToXYZero = source.moveToZero;
  }

  return {
    options: safe,
    errors
  };
};

export const generateProbeCode = (options) => {
  const { probeType, probingAxis } = options;
  log('Generating probe code:', { probeType, probingAxis });

  const strategy = STRATEGIES[probeType];
  const axisStrategy = strategy?.axes?.[probingAxis];

  if (!axisStrategy) {
    log('Unknown probe type or axis:', { probeType, probingAxis });
    return [];
  }

  return axisStrategy.run(options) || [];
};

function applyStringRules(context, rules = {}) {
  const { source, target, errors } = context;
  Object.entries(rules).forEach(([key, rule]) => {
    const value = typeof source[key] === 'string' ? source[key].trim() : '';
    if (!value) {
      if (rule.required) {
        errors.push(`Missing required field: ${key}`);
      }
      return;
    }

    if (rule.allowed && !rule.allowed.has(value)) {
      errors.push(`Invalid value for ${key}: ${value}`);
      return;
    }

    if (rule.validator) {
      const result = rule.validator(value);
      if (!result.valid) {
        errors.push(result.error ?? `Invalid value for ${key}`);
        return;
      }
      target[key] = result.value;
      return;
    }

    target[key] = value;
  });
}

function applyNumberRules(context, rules = {}) {
  const { source, target, errors } = context;
  Object.entries(rules).forEach(([key, rule]) => {
    const raw = source[key];
    const defaultValue = rule.defaultValue ?? null;
    const parsed = raw === undefined || raw === null || raw === '' ? defaultValue : Number(raw);

    if (!Number.isFinite(parsed)) {
      errors.push(`Invalid numeric value for ${key}`);
      return;
    }

    if (rule.min !== undefined && parsed < rule.min) {
      errors.push(`${key} must be greater than or equal to ${rule.min}`);
      return;
    }

    if (rule.max !== undefined && parsed > rule.max) {
      errors.push(`${key} must be less than or equal to ${rule.max}`);
      return;
    }

    target[key] = parsed;
  });
}

function applyBooleanRules(context, rules = {}) {
  const { source, target } = context;
  Object.entries(rules).forEach(([key, rule]) => {
    const defaultValue = rule.defaultValue ?? false;
    const raw = source[key];
    if (typeof raw === 'boolean') {
      target[key] = raw;
      return;
    }

    if (typeof raw === 'string') {
      const lowered = raw.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(lowered)) {
        target[key] = true;
        return;
      }
      if (['false', '0', 'no', 'off'].includes(lowered)) {
        target[key] = false;
        return;
      }
    }

    target[key] = defaultValue;
  });
}

function normalizeCorner(value) {
  const stringValue = typeof value === 'string' ? value.trim() : '';
  if (stringValue && CORNER_VALUES.has(stringValue)) {
    return stringValue;
  }
  return null;
}

function normalizeSide(value) {
  const stringValue = typeof value === 'string' ? value.trim() : '';
  if (stringValue && SIDE_VALUES.has(stringValue)) {
    return stringValue;
  }
  return null;
}

function validateBitDiameter(value) {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Bit diameter must be a string' };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, error: 'Bit diameter is required' };
  }

  if (BIT_DIAMETER_SPECIAL.has(trimmed)) {
    return { valid: true, value: trimmed };
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { valid: false, error: 'Bit diameter must be a positive number or a supported keyword' };
  }

  return { valid: true, value: numeric.toString() };
}
