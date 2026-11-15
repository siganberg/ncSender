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

import { LENGTH_UNIT_PATTERN, formatCoordinate, parseLength, type UnitsPreference } from '@/lib/units';

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

const NUM = String.raw`-?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*\/\s*\d+)?${LENGTH_UNIT_PATTERN}?`;

// With `units` (what the table shows), a number may carry a unit (.25", 6mm)
// and is converted to them; without, it can't.
function readNumber(text: string, units?: UnitsPreference): number | null {
  if (!units && new RegExp(`${LENGTH_UNIT_PATTERN}$`, 'i').test(text.trim())) return null;
  return parseLength(text, units);
}

const EPS = 1e-9;

// A test for a number, from what was typed: 6, <6, >=3, 3-8, 3..8,
// -50--40, or several of those split by ", " (any may match). With
// `decimals` (what the table shows), the shown value equals a typed number
// within half its last digit, so 3/32 finds a bit shown as 0.0937, and
// <, = and > never overlap. null when it can't be read; "6,35" is (a
// decimal comma, or 6 and 35?).
export function parseNumberFilter(text: string, units?: UnitsPreference, decimals?: number): ((v: number) => boolean) | null {
  if (/\d,\d/.test(text)) return null;
  const parts = text
    .replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (_, whole, num, den) => String(+whole + +num / +den))
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const read = (t: string) => readNumber(t, units);
  const half = (decimals === undefined ? 0 : 0.5 * 10 ** -decimals) + EPS;
  const tests: ((v: number) => boolean)[] = [];
  for (const raw of parts) {
    const p = raw.replace(/\s+/g, '');
    const cmp = /^(<=|>=|<|>|=)(.+)$/.exec(p);
    if (cmp) {
      const n = read(cmp[2]);
      if (n === null) return null;
      const op = cmp[1];
      tests.push(op === '<' ? (v) => v < n - half : op === '<=' ? (v) => v <= n + half
        : op === '>' ? (v) => v > n + half : op === '>=' ? (v) => v >= n - half : (v) => Math.abs(v - n) <= half);
      continue;
    }
    const range = new RegExp(`^(${NUM})(?:-|\\.\\.|to)(${NUM})$`, 'i').exec(p);
    if (range) {
      const a = read(range[1]), b = read(range[2]);
      if (a === null || b === null) return null;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      tests.push((v) => v >= lo - half && v <= hi + half);
      continue;
    }
    const n = read(p);
    if (n === null) return null;
    tests.push((v) => Math.abs(v - n) <= half);
  }
  return (v) => tests.some((t) => t(v));
}

// A TLO filter also takes "set" and "not set" / "unset" / "none" (shown as 0).
function parseTloFilter(text: string, units?: UnitsPreference, decimals?: number): ((v: number) => boolean) | null {
  const t = text.trim().toLowerCase();
  if (t === 'set') return (v) => Math.abs(v) > EPS;
  if (/^(not\s*set|unset|none)$/.test(t)) return (v) => Math.abs(v) <= EPS;
  return parseNumberFilter(text, units, decimals);
}

export function badToolFilters(f: ToolFilters): Partial<Record<keyof ToolFilters, boolean>> {
  const bad: Partial<Record<keyof ToolFilters, boolean>> = {};
  if (f.toolId.trim() && !parseNumberFilter(f.toolId)) bad.toolId = true;
  if (f.diameter.trim() && !parseNumberFilter(f.diameter, 'metric')) bad.diameter = true;
  if (f.tlo.trim() && !parseTloFilter(f.tlo, 'metric')) bad.tlo = true;
  return bad;
}

// Diameter and TLO are compared as the table shows them, in its units and
// decimals; typed values are in those units unless typed with a unit.
export function filterTools<T extends FilterableTool>(tools: T[], f: ToolFilters, imperial: boolean): T[] {
  const units: UnitsPreference = imperial ? 'imperial' : 'metric';
  const decimals = imperial ? 4 : 3;
  const show = (mm: number) => parseFloat(formatCoordinate(mm, units));
  const id = f.toolId.trim() ? parseNumberFilter(f.toolId) : null;
  const dia = f.diameter.trim() ? parseNumberFilter(f.diameter, units, decimals) : null;
  const tlo = f.tlo.trim() ? parseTloFilter(f.tlo, units, decimals) : null;
  const name = f.name.trim().toLowerCase();
  return tools.filter((t) =>
    (!id || id(t.toolId))
    && (!name || t.name.toLowerCase().includes(name))
    && (!f.type || t.type === f.type)
    && (!dia || dia(show(t.diameter)))
    && (!tlo || tlo(show(t.offsets.tlo))));
}
