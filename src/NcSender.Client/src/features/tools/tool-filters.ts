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

export interface ToolFilters {
  toolId: string;
  name: string;
  type: string;
  diameter: string;
  tlo: string;
}

export interface FilterableTool {
  toolId: number;
  name: string;
  type: string;
  diameter: number;
  offsets: { tlo: number };
}

export const emptyToolFilters = (): ToolFilters => ({ toolId: '', name: '', type: '', diameter: '', tlo: '' });

export const hasToolFilters = (f: ToolFilters) =>
  Object.values(f).some((v) => v.trim() !== '');

const UNIT = String.raw`(?:mm|cm|inches|inch|in|")`;
const NUM = String.raw`-?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*\/\s*\d+)?${UNIT}?`;

// `units` is what the table shows; a number typed with a unit (.25", 6mm, 1cm)
// is converted to it. Without `units`, a unit can't be read.
function readNumber(text: string, units?: 'mm' | 'in'): number | null {
  const m = new RegExp(`^(.*?)(${UNIT})?$`, 'i').exec(text.replace(/\s+/g, ''));
  const t = m?.[1] ?? '';
  const unit = m?.[2]?.toLowerCase();
  if (unit && !units) return null;
  const frac = /^(-?)(\d+)\/(\d+)$/.exec(t);
  const value = frac
    ? (+frac[3] ? (frac[1] ? -1 : 1) * (+frac[2] / +frac[3]) : null)
    : /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(t) ? parseFloat(t) : null;
  if (value === null || !unit) return value;
  const mm = unit === 'mm' ? value : unit === 'cm' ? value * 10 : value * 25.4;
  return units === 'in' ? mm / 25.4 : mm;
}

// A test for a number, from what was typed: 6, <6, >=3, 3-8, 3..8,
// -50--40, or several of those split by commas (any may match). `tol` is
// how close counts as equal. null when it can't be read.
export function parseNumberFilter(text: string, tol: number, units?: 'mm' | 'in'): ((v: number) => boolean) | null {
  const parts = text
    .replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (_, whole, num, den) => String(+whole + +num / +den))
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const tests: ((v: number) => boolean)[] = [];
  for (const raw of parts) {
    const p = raw.replace(/\s+/g, '');
    const cmp = /^(<=|>=|<|>|=)(.+)$/.exec(p);
    if (cmp) {
      const n = readNumber(cmp[2], units);
      if (n === null) return null;
      const op = cmp[1];
      tests.push(op === '<' ? (v) => v < n - tol : op === '<=' ? (v) => v <= n + tol
        : op === '>' ? (v) => v > n + tol : op === '>=' ? (v) => v >= n - tol : (v) => Math.abs(v - n) <= tol);
      continue;
    }
    const range = new RegExp(`^(${NUM})(?:-|\\.\\.|to)(${NUM})$`, 'i').exec(p);
    if (range) {
      const a = readNumber(range[1], units), b = readNumber(range[2], units);
      if (a === null || b === null) return null;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      tests.push((v) => v >= lo - tol && v <= hi + tol);
      continue;
    }
    const n = readNumber(p, units);
    if (n === null) return null;
    tests.push((v) => Math.abs(v - n) <= tol);
  }
  return (v) => tests.some((t) => t(v));
}

// A TLO filter also takes "set" and "not set" / "unset" / "none" (shown as 0).
function parseTloFilter(text: string, tol: number, units?: 'mm' | 'in'): ((v: number) => boolean) | null {
  const t = text.trim().toLowerCase();
  if (t === 'set') return (v) => Math.abs(v) > tol;
  if (/^(not\s*set|unset|none)$/.test(t)) return (v) => Math.abs(v) <= tol;
  return parseNumberFilter(text, tol, units);
}

export function badToolFilters(f: ToolFilters): Partial<Record<keyof ToolFilters, boolean>> {
  const bad: Partial<Record<keyof ToolFilters, boolean>> = {};
  if (f.toolId.trim() && !parseNumberFilter(f.toolId, 0)) bad.toolId = true;
  if (f.diameter.trim() && !parseNumberFilter(f.diameter, 0, 'mm')) bad.diameter = true;
  if (f.tlo.trim() && !parseTloFilter(f.tlo, 0, 'mm')) bad.tlo = true;
  return bad;
}

// Diameter and TLO are in the display units unless typed with a unit,
// compared to the table's decimals.
export function filterTools<T extends FilterableTool>(tools: T[], f: ToolFilters, imperial: boolean): T[] {
  const tol = imperial ? 0.00005 : 0.0005;
  const show = (mm: number) => (imperial ? mm / 25.4 : mm);
  const units = imperial ? 'in' : 'mm';
  const id = f.toolId.trim() ? parseNumberFilter(f.toolId, 0) : null;
  const dia = f.diameter.trim() ? parseNumberFilter(f.diameter, tol, units) : null;
  const tlo = f.tlo.trim() ? parseTloFilter(f.tlo, tol, units) : null;
  const name = f.name.trim().toLowerCase();
  return tools.filter((t) =>
    (!id || id(t.toolId))
    && (!name || t.name.toLowerCase().includes(name))
    && (!f.type || t.type === f.type)
    && (!dia || dia(show(t.diameter)))
    && (!tlo || tlo(show(t.offsets.tlo))));
}
