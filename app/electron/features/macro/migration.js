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
import { getUserDataDir } from '../../utils/paths.js';
import { readSettings, saveSettings } from '../../core/settings-manager.js';
import { createMacro, ensureMacroDir, getMacroDir } from './m98-storage.js';
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('MacroMigration');

const OLD_MACROS_PATH = path.join(getUserDataDir(), 'macros.json');
const MIGRATION_MARKER = path.join(getMacroDir(), '.migrated');

export function needsMigration() {
  if (fs.existsSync(MIGRATION_MARKER)) {
    return false;
  }

  if (fs.existsSync(OLD_MACROS_PATH)) {
    return true;
  }

  return false;
}

export function runMigration() {
  if (!needsMigration()) {
    log('Migration not needed');
    return { migrated: false, count: 0 };
  }

  ensureMacroDir();

  let oldMacros = [];
  try {
    const raw = fs.readFileSync(OLD_MACROS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    oldMacros = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logError('Failed to read old macros.json:', err);
    markMigrationComplete();
    return { migrated: false, count: 0, error: 'Failed to read macros.json' };
  }

  if (oldMacros.length === 0) {
    log('No macros to migrate');
    markMigrationComplete();
    return { migrated: true, count: 0 };
  }

  const idMapping = {};
  let currentId = 9001;
  let migratedCount = 0;

  for (const oldMacro of oldMacros) {
    if (currentId > 9999) {
      logError('Ran out of macro IDs during migration');
      break;
    }

    try {
      const content = buildMacroContent(oldMacro);
      createMacro({
        id: currentId,
        content
      });

      idMapping[oldMacro.id] = currentId;
      log(`Migrated "${oldMacro.name}" (${oldMacro.id}) -> ${currentId}`);
      migratedCount++;
      currentId++;
    } catch (err) {
      logError(`Failed to migrate macro "${oldMacro.name}":`, err);
    }
  }

  migrateKeyboardBindings(idMapping);

  backupOldMacros();

  markMigrationComplete();

  log(`Migration complete: ${migratedCount} macros migrated`);
  return { migrated: true, count: migratedCount, idMapping };
}

function buildMacroContent(macro) {
  const lines = [];

  if (macro.name) {
    lines.push(`( PROGRAM: ${macro.name} )`);
  }
  if (macro.description) {
    lines.push(`( DESC: ${macro.description} )`);
  }

  const commands = macro.commands?.trim() || '';
  if (commands) {
    lines.push(commands);
  }

  return lines.join('\n');
}

function migrateKeyboardBindings(idMapping) {
  try {
    const settings = readSettings();
    if (!settings || !settings.keyboardBindings) {
      return;
    }

    let modified = false;
    const updatedBindings = {};

    for (const [actionId, binding] of Object.entries(settings.keyboardBindings)) {
      if (actionId.startsWith('Macro:')) {
        const oldId = actionId.replace('Macro:', '');
        const newId = idMapping[oldId];

        if (newId) {
          const newActionId = `Macro:${newId}`;
          updatedBindings[newActionId] = binding;
          log(`Migrated keyboard binding: ${actionId} -> ${newActionId}`);
          modified = true;
        }
      } else {
        updatedBindings[actionId] = binding;
      }
    }

    if (modified) {
      saveSettings({
        ...settings,
        keyboardBindings: updatedBindings
      });
      log('Updated keyboard bindings with new macro IDs');
    }
  } catch (err) {
    logError('Failed to migrate keyboard bindings:', err);
  }
}

function backupOldMacros() {
  const backupPath = OLD_MACROS_PATH + '.backup';
  try {
    if (fs.existsSync(OLD_MACROS_PATH) && !fs.existsSync(backupPath)) {
      fs.copyFileSync(OLD_MACROS_PATH, backupPath);
      log(`Backed up macros.json to ${backupPath}`);
    }
  } catch (err) {
    logError('Failed to backup macros.json:', err);
  }
}

function markMigrationComplete() {
  try {
    ensureMacroDir();
    fs.writeFileSync(MIGRATION_MARKER, new Date().toISOString(), 'utf8');
  } catch (err) {
    logError('Failed to write migration marker:', err);
  }
}

export function getMigrationStatus() {
  return {
    completed: fs.existsSync(MIGRATION_MARKER),
    hasOldMacros: fs.existsSync(OLD_MACROS_PATH),
    needsMigration: needsMigration()
  };
}
