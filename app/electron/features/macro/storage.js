import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getUserDataDir } from '../../utils/paths.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}]`, ...args);
};

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
  return { success: true, id };
}
