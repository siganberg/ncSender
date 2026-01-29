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

import { parseM98Command } from '../../utils/gcode-patterns.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('M98Expander');

const MAX_DEPTH = 16;
const MIN_ID = 9001;
const MAX_ID = 9999;

export class M98Expander {
  constructor(storage) {
    this.storage = storage;
  }

  async expand(command, callStack = []) {
    const { matched, macroId } = parseM98Command(command);

    if (!matched) {
      return [command];
    }

    if (macroId < MIN_ID || macroId > MAX_ID) {
      throw new Error(`Invalid macro ID: ${macroId}. Must be ${MIN_ID}-${MAX_ID}`);
    }

    if (callStack.includes(macroId)) {
      throw new Error(`Macro recursion detected: ${[...callStack, macroId].join(' → ')}`);
    }

    if (callStack.length >= MAX_DEPTH) {
      throw new Error(`Max macro depth (${MAX_DEPTH}) exceeded`);
    }

    const macro = this.storage.getMacro(macroId);
    if (!macro) {
      throw new Error(`Macro not found: ${macroId}`);
    }

    // Only expand one level - return raw lines, let command processor handle nested M98s
    const lines = macro.body.split('\n').map(l => l.trim()).filter(l => l);

    log(`Expanded M98 P${macroId} (${lines.length} lines, depth ${callStack.length + 1})`);
    return lines;
  }

  getCallStack() {
    return [];
  }

  async validate(command) {
    try {
      await this.expand(command);
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }
}
