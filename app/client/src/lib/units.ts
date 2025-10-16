/**
 * Unit conversion and formatting utilities for metric/imperial support
 */

export type UnitsPreference = 'metric' | 'imperial';

// Conversion constants
const MM_PER_INCH = 25.4;

/**
 * Convert millimeters to inches
 */
export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}

/**
 * Convert inches to millimeters
 */
export function inchesToMm(inches: number): number {
  return inches * MM_PER_INCH;
}

/**
 * Convert mm/min to in/min
 */
export function mmPerMinToInPerMin(mmPerMin: number): number {
  return mmPerMin / MM_PER_INCH;
}

/**
 * Convert in/min to mm/min
 */
export function inPerMinToMmPerMin(inPerMin: number): number {
  return inPerMin * MM_PER_INCH;
}

/**
 * Format a coordinate value with appropriate precision and units
 */
export function formatCoordinate(value: number, units: UnitsPreference = 'metric'): string {
  if (!Number.isFinite(value)) return '0.000';

  if (units === 'imperial') {
    const inches = mmToInches(value);
    return inches.toFixed(4);
  }

  return value.toFixed(3);
}

/**
 * Format a distance value with appropriate precision and units
 */
export function formatDistance(value: number, units: UnitsPreference = 'metric'): string {
  return formatCoordinate(value, units);
}

/**
 * Format a feed rate with appropriate precision and units
 */
export function formatFeedRate(mmPerMin: number, units: UnitsPreference = 'metric'): string {
  if (!Number.isFinite(mmPerMin)) return '0';

  if (units === 'imperial') {
    const inPerMin = mmPerMinToInPerMin(mmPerMin);
    return inPerMin.toFixed(2);
  }

  return Math.round(mmPerMin).toString();
}

/**
 * Get the unit label for coordinates/distances
 */
export function getDistanceUnitLabel(units: UnitsPreference = 'metric'): string {
  return units === 'imperial' ? 'in' : 'mm';
}

/**
 * Get the unit label for feed rates
 */
export function getFeedRateUnitLabel(units: UnitsPreference = 'metric'): string {
  return units === 'imperial' ? 'in/min' : 'mm/min';
}

/**
 * Get the G-code modal command for the unit system
 */
export function getUnitGCode(units: UnitsPreference = 'metric'): string {
  return units === 'imperial' ? 'G20' : 'G21';
}

/**
 * Format an axis label with value and units (e.g., "X: 10.000 mm")
 */
export function formatAxisLabel(axis: string, value: number, units: UnitsPreference = 'metric'): string {
  const formattedValue = formatCoordinate(value, units);
  const unitLabel = getDistanceUnitLabel(units);
  return `${axis}: ${formattedValue} ${unitLabel}`;
}

/**
 * Parse a user input value, converting to mm if in imperial mode
 */
export function parseDistanceInput(input: string, units: UnitsPreference = 'metric'): number {
  const value = parseFloat(input);
  if (!Number.isFinite(value)) return 0;

  if (units === 'imperial') {
    return inchesToMm(value);
  }

  return value;
}

/**
 * Parse a feed rate input value, converting to mm/min if in imperial mode
 */
export function parseFeedRateInput(input: string, units: UnitsPreference = 'metric'): number {
  const value = parseFloat(input);
  if (!Number.isFinite(value)) return 0;

  if (units === 'imperial') {
    return inPerMinToMmPerMin(value);
  }

  return value;
}
