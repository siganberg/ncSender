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

/*
 * What is typed into a length or feed field, read into the field's own units.
 * A number with no unit is already in them; a unit converts it:
 *
 *   6.35  .25  1,5            as typed (a comma is a decimal point)
 *   6.35mm  0.635cm  .25in    converted
 *   1/4"  1-1/2"  1 1/2 in    fractions and mixed numbers
 *   1/4                       a fraction with no unit is inches in a length field
 *   100ipm  2540mm/min  25mm/s   feeds, to per minute
 *
 * 1,000 is refused: it may be a thousand or one.
 */

export interface UnitField {
  imperial: boolean;
  kind: 'length' | 'feed';
}

/** The field a unit label ("mm", "in", "mm/min", "in/min") stands for; null for any other. */
export function unitField(label?: string | null): UnitField | null {
  switch (label) {
    case 'mm': return { imperial: false, kind: 'length' };
    case 'in': return { imperial: true, kind: 'length' };
    case 'mm/min': return { imperial: false, kind: 'feed' };
    case 'in/min': return { imperial: true, kind: 'feed' };
    default: return null;
  }
}

const MM_PER_INCH = 25.4;

// A typed unit, as mm (lengths) or mm/min (feeds) per one of it.
const LENGTH_UNITS: Record<string, number> = {
  mm: 1, cm: 10, in: MM_PER_INCH, inch: MM_PER_INCH, inches: MM_PER_INCH, '"': MM_PER_INCH, '″': MM_PER_INCH, "''": MM_PER_INCH,
};
const FEED_UNITS: Record<string, number> = {
  mm: 1, 'mm/min': 1, mmpm: 1, 'mm/s': 60, 'mm/sec': 60, 'm/min': 1000,
  in: MM_PER_INCH, inch: MM_PER_INCH, '"': MM_PER_INCH, 'in/min': MM_PER_INCH, 'inch/min': MM_PER_INCH, ipm: MM_PER_INCH,
  'in/s': MM_PER_INCH * 60, 'in/sec': MM_PER_INCH * 60, ips: MM_PER_INCH * 60,
};

const TYPED = /^([+-]?)\s*(?:(?:(\d+)(?:\s+|-))?(\d+)\s*\/\s*(\d+)|(\d+(?:[.,]\d*)?|[.,]\d+))\s*([^\d\s].*)?$/;

/**
 * The typed text as a number in the field's units, or null when it can't be
 * read. With no field (seconds, a count) only a plain number or fraction reads.
 */
export function parseUnitValue(text: string, field: UnitField | null): number | null {
  const m = TYPED.exec(text.trim().toLowerCase());
  if (!m) return null;

  let value: number;
  const fraction = m[3] !== undefined;
  if (fraction) {
    if (!+m[4]) return null;
    value = +(m[2] ?? 0) + +m[3] / +m[4];
  } else {
    if (/^[1-9]\d{0,2},\d{3}$/.test(m[5])) return null;
    value = parseFloat(m[5].replace(',', '.'));
  }
  if (!Number.isFinite(value)) return null;
  if (m[1] === '-') value = -value;

  const unit = (m[6] ?? '').replace(/[\s.]/g, '');
  if (!field) return unit ? null : value;

  let perUnit: number | undefined;
  if (unit) perUnit = (field.kind === 'feed' ? FEED_UNITS : LENGTH_UNITS)[unit];
  else if (fraction && field.kind === 'length') perUnit = MM_PER_INCH;
  else return value;
  if (perUnit === undefined) return null;

  const own = field.imperial ? MM_PER_INCH : 1;
  if (perUnit === own) return value;
  return Number((value * perUnit / own).toFixed(field.imperial ? 4 : 3));
}

// Only what a value can be written with gets into a field: digits, the signs
// of a number or fraction, and the letters of the units that field reads.
const OTHER_LENGTH = /[^\d.,/+\- "″'mcinhes]/gi;
const OTHER_FEED = /[^\d.,/+\- "″'mcinhesp]/gi;
const OTHER_PLAIN = /[^\d.,/+\- ]/g;

/** The text without the characters this field never reads. */
export function unitChars(text: string, field: UnitField | null): string {
  return text.replace(!field ? OTHER_PLAIN : field.kind === 'feed' ? OTHER_FEED : OTHER_LENGTH, '');
}

/** For `beforeinput`: refuses a typed character the field never reads. */
export function refuseOtherChars(e: Event, field: UnitField | null): void {
  const data = (e as InputEvent).data;
  if (data && unitChars(data, field) !== data) e.preventDefault();
}

/** For `input`: drops such characters from what was pasted or dropped in. */
export function dropOtherChars(el: HTMLInputElement, field: UnitField | null): void {
  const clean = unitChars(el.value, field);
  if (clean !== el.value) el.value = clean;
}

/**
 * Puts a field's value on screen. While the field is being typed in, text that
 * already means that number is left alone: writing "12" over a typed "12."
 * would take the decimal point away mid-number.
 */
export function showValue(el: HTMLInputElement | null, shown: string): void {
  if (!el || el.value === shown) return;
  if (document.activeElement === el) {
    const typed = plainNumber(el.value);
    if (typed != null && typed === plainNumber(shown)) return;
  }
  el.value = shown;
}

/** What is typed so far, when it is already a plain number: fields follow it live. */
export function plainNumber(text: string): number | null {
  const raw = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(raw)) return null;
  return Number(raw);
}
