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

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getUserDataDir } from '../../utils/paths.js';
import { readSettings, saveSettings } from '../../core/settings-manager.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('MacroStorage');

const DEFAULT_MACROS = [
  {
    id: '44426f3c-e00f-4b8e-945d-6f61d57b424a',
    name: 'Macro Sample',
    description: 'Finds the hole center using probe',
    commands: `G91 G1 X100 F1000
G91 G1 X-100 F1000`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

const MACROS_PATH = path.join(getUserDataDir(), 'macros.json');

function ensureMacrosFile() {
  if (!fs.existsSync(MACROS_PATH)) {
    try {
      const macrosDir = path.dirname(MACROS_PATH);
      fs.mkdirSync(macrosDir, { recursive: true });
      fs.writeFileSync(MACROS_PATH, JSON.stringify(DEFAULT_MACROS, null, 2), 'utf8');
      log('Created default macros file');
    } catch (error) {
      log('Failed to create default macros file:', error);
    }
  }
}

export function readMacros() {
  if (!fs.existsSync(MACROS_PATH)) {
    ensureMacrosFile();
  }

  try {
    const raw = fs.readFileSync(MACROS_PATH, 'utf8');
    if (!raw) {
      return [...DEFAULT_MACROS];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...DEFAULT_MACROS];
  } catch (error) {
    log('Failed to load macros. Using defaults.', error);
    return [...DEFAULT_MACROS];
  }
}

export function getMacro(id) {
  const macros = readMacros();
  return macros.find(m => m.id === id);
}

export function saveMacros(macros) {
  ensureMacrosFile();

  try {
    fs.writeFileSync(MACROS_PATH, JSON.stringify(macros, null, 2), 'utf8');
    return macros;
  } catch (error) {
    log('Failed to save macros:', error);
    throw error;
  }
}

export function createMacro(macroData) {
  const macros = readMacros();

  const newMacro = {
    id: randomUUID(),
    name: macroData.name || 'Untitled Macro',
    description: macroData.description || '',
    commands: macroData.commands || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  macros.push(newMacro);
  saveMacros(macros);

  return newMacro;
}

export function updateMacro(id, updates) {
  const macros = readMacros();
  const index = macros.findIndex(m => m.id === id);

  if (index === -1) {
    throw new Error(`Macro with id ${id} not found`);
  }

  macros[index] = {
    ...macros[index],
    ...updates,
    id: macros[index].id,
    createdAt: macros[index].createdAt,
    updatedAt: new Date().toISOString()
  };

  saveMacros(macros);
  return macros[index];
}

export function deleteMacro(id) {
  const macros = readMacros();
  const filteredMacros = macros.filter(m => m.id !== id);

  if (filteredMacros.length === macros.length) {
    throw new Error(`Macro with id ${id} not found`);
  }

  saveMacros(filteredMacros);

  // Also remove any keyboard shortcut assigned to this macro
  try {
    const settings = readSettings();
    if (settings && settings.keyboardBindings) {
      const actionId = `Macro:${id}`;
      if (actionId in settings.keyboardBindings) {
        const updatedBindings = { ...settings.keyboardBindings };
        delete updatedBindings[actionId];
        saveSettings({
          ...settings,
          keyboardBindings: updatedBindings
        });
        log(`Removed keyboard binding for deleted macro: ${actionId}`);
      }
    }
  } catch (error) {
    log('Failed to remove keyboard binding for deleted macro:', error);
    // Don't fail the macro deletion if keyboard binding cleanup fails
  }

  return { success: true, id };
}
