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
 * The Tool Library's one search box. What is typed is split into terms, and
 * every term must match a tool:
 *
 *   ball        a word: in the description or the type
 *   6           a bare number: tool ID 6, or diameter 6 (in the table's units)
 *   6mm  1/4"   a number with a unit: diameter only, converted
 *   1/8         a fraction: diameter, in inches
 *   <4mm  >=6   a comparison: diameter
 *   3-8  3..8   a range: diameter
 *   t12  #12    tool ID only
 *   no tlo      tools with no tool length offset;  tlo: tools with one
 *
 * Each term says how it was read (for the chips under the box) and which
 * cells of a tool it matched (to highlight them). Sizes are compared as the
 * table shows them, so 3/32 finds a bit shown as 0.0937.
 */
import { parseUnitValue } from '@/lib/unit-input';
import { formatCoordinate, getDistanceUnitLabel, type UnitsPreference } from '@/lib/units';

export type SearchCell = 'id' | 'diameter' | 'tlo';
export type SearchTermKind = 'text' | 'id' | 'diameter' | 'idOrDiameter' | 'tloSet' | 'tloNotSet' | 'unread';

export interface SearchableTool {
  toolId: number;
  name: string;
  type: string;
  diameter: number;
  offsets: { tlo: number };
}

export interface SearchTerm {
  kind: SearchTermKind;
  /** What it was read as, for the chip: "6.35 mm", "< 4 mm", "12", or the word. */
  value: string;
  /** A word to highlight in the description and the type. */
  word?: string;
  /** The cells it matched in this tool ([] for a word), or null when it doesn't match. */
  match(tool: SearchableTool): SearchCell[] | null;
}

const UNIT = String.raw`(?:mm|cm|inches|inch|in|")`;
const NUMBER = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+\.?\d*|\.\d+)`;

// A typed length in the table's units (see lib/unit-input); plain when it is a
// bare number, which may as well be a tool ID.
function readLength(text: string, units: UnitsPreference): { value: number; plain: boolean } | null {
  const value = parseUnitValue(text, { imperial: units === 'imperial', kind: 'length' });
  if (value == null || value < 0) return null;
  return { value, plain: /^(?:\d+\.?\d*|\.\d+)$/.test(text.trim()) };
}

// "no tlo", a mixed number or a number with its unit after a space stay one term.
const TERMS = new RegExp(
  String.raw`no\s+tlo|\d+\s+\d+\/\d+\s*${UNIT}?|(?:\d+\.?\d*|\.\d+)\s+(?:mm|cm|inches|inch|in)(?![a-z])|[<>]=?\s*\S+|\S+`,
  'gi');

/** typeLabel: a tool type as the table shows it ("Ball End Mill"), so its words can be searched. */
export function parseToolSearch(query: string, units: UnitsPreference, typeLabel: (type: string) => string = (type) => type): SearchTerm[] {
  const decimals = units === 'imperial' ? 4 : 3;
  const half = 0.5 * 10 ** -decimals + 1e-9;
  const unitLabel = getDistanceUnitLabel(units);
  const shown = (mm: number) => parseFloat(formatCoordinate(mm, units));
  const say = (v: number) => `${+v.toFixed(decimals)} ${unitLabel}`;

  const text = (term: string, kind: 'text' | 'unread'): SearchTerm => {
    const word = term.toLowerCase();
    return {
      kind, value: term, word,
      match: (t) => (t.name.toLowerCase().includes(word)
        || typeLabel(t.type).toLowerCase().includes(word)
        || t.type.toLowerCase().includes(word) ? [] : null),
    };
  };

  return (query.match(TERMS) ?? []).map((raw): SearchTerm => {
    const term = raw.trim();
    const t = term.toLowerCase();

    if (/^no\s+tlo$/.test(t)) return { kind: 'tloNotSet', value: '', match: (x) => (Math.abs(x.offsets.tlo) < 1e-9 ? ['tlo'] : null) };
    if (t === 'tlo') return { kind: 'tloSet', value: '', match: (x) => (Math.abs(x.offsets.tlo) >= 1e-9 ? ['tlo'] : null) };

    const id = /^(?:t|#)(\d+)$/.exec(t);
    if (id) return { kind: 'id', value: id[1], match: (x) => (x.toolId === +id[1] ? ['id'] : null) };

    const compare = /^(<=|>=|<|>)\s*(.+)$/.exec(t);
    if (compare) {
      const n = readLength(compare[2], units);
      if (!n) return text(term, 'unread');
      const op = compare[1], v = n.value;
      const ok = (d: number) => (op === '<' ? d < v - half : op === '<=' ? d <= v + half : op === '>' ? d > v + half : d >= v - half);
      return { kind: 'diameter', value: `${op} ${say(v)}`, match: (x) => (ok(shown(x.diameter)) ? ['diameter'] : null) };
    }

    const range = new RegExp(`^(${NUMBER})(?:-|\\.\\.)(${NUMBER})\\s*(${UNIT})?$`, 'i').exec(t);
    if (range) {
      const a = readLength(range[1] + (range[3] ?? ''), units);
      const b = readLength(range[2] + (range[3] ?? ''), units);
      if (a && b) {
        const lo = Math.min(a.value, b.value), hi = Math.max(a.value, b.value);
        return {
          kind: 'diameter', value: `${+lo.toFixed(decimals)} – ${say(hi)}`,
          match: (x) => { const d = shown(x.diameter); return d >= lo - half && d <= hi + half ? ['diameter'] : null; },
        };
      }
    }

    const n = readLength(t, units);
    if (n && !n.plain) {
      return { kind: 'diameter', value: say(n.value), match: (x) => (Math.abs(shown(x.diameter) - n.value) <= half ? ['diameter'] : null) };
    }
    if (n) {
      return {
        kind: 'idOrDiameter', value: String(n.value),
        match: (x) => {
          const cells: SearchCell[] = [];
          if (x.toolId === n.value) cells.push('id');
          if (Math.abs(shown(x.diameter) - n.value) <= half) cells.push('diameter');
          return cells.length ? cells : null;
        },
      };
    }

    return text(term, /[<>=]/.test(t) ? 'unread' : 'text');
  });
}

/** The cells the search matched in this tool, or null when a term doesn't match it. */
export function matchTool(tool: SearchableTool, terms: SearchTerm[]): Set<SearchCell> | null {
  const cells = new Set<SearchCell>();
  for (const term of terms) {
    const hit = term.match(tool);
    if (!hit) return null;
    hit.forEach((c) => cells.add(c));
  }
  return cells;
}

/** A text cut into parts, the searched words marked. */
export function highlightParts(text: string, terms: SearchTerm[]): { text: string; hit: boolean }[] {
  const words = terms.map((t) => t.word).filter((w): w is string => !!w);
  if (!words.length || !text) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const marked = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + word.length)) {
      marked.fill(true, at, at + word.length);
    }
  }
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marked[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marked[i] });
  }
  return parts;
}
