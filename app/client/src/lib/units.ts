/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

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
 * Format step size for jog controls (3 decimals for imperial, as-is for metric)
 * Used by StepControl and JogControls to ensure consistency
 */
export function formatStepSize(mmValue: number, units: UnitsPreference = 'metric'): string {
  if (units === 'imperial') {
    const inches = mmToInches(mmValue);
    return (Math.round(inches * 1000) / 1000).toFixed(3);
  }
  return mmValue.toString();
}

export function formatStepSizeJogDisplay(mmValue: number, units: UnitsPreference = 'metric'): string {
  if (units === 'imperial') {
    return   (mmValue/100).toFixed(3);
  }
  return mmValue.toString();
}

/**
 * Format feed rate for jog controls (rounded to nearest 10 for imperial, rounded for metric)
 * Used by StepControl and JogControls to ensure consistency
 */
export function formatJogFeedRate(mmPerMin: number, units: UnitsPreference = 'metric'): string {
  if (units === 'imperial') {
    const converted = mmPerMinToInPerMin(mmPerMin);
    const rounded = Math.round(converted / 10) * 10;
    return rounded.toString();
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
