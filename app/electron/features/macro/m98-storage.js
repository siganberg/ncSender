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
import { createLogger } from '../../core/logger.js';

const { log, error: logError } = createLogger('M98Storage');

const MACRO_DIR = path.join(getUserDataDir(), 'macros');
const MIN_ID = 9001;
const MAX_ID = 9999;

export function ensureMacroDir() {
  if (!fs.existsSync(MACRO_DIR)) {
    fs.mkdirSync(MACRO_DIR, { recursive: true });
    log('Created macros directory');
  }
}

export function validateMacroId(id) {
  const numId = typeof id === 'string' ? parseInt(id, 10) : id;
  if (!Number.isFinite(numId) || numId < MIN_ID || numId > MAX_ID) {
    return { valid: false, error: `Invalid macro ID: ${id}. Must be ${MIN_ID}-${MAX_ID}` };
  }
  return { valid: true, id: numId };
}

function getMacroFilePath(id) {
  return path.join(MACRO_DIR, `${id}.macro`);
}

export function parseMacroHeader(content) {
  const lines = content.split('\n');
  let name = null;
  let description = null;

  for (const line of lines) {
    const trimmed = line.trim();

    const programMatch = trimmed.match(/^\(\s*PROGRAM:\s*(.+?)\s*\)$/i);
    if (programMatch) {
      name = programMatch[1];
      continue;
    }

    const descMatch = trimmed.match(/^\(\s*DESC:\s*(.+?)\s*\)$/i);
    if (descMatch) {
      description = descMatch[1];
      continue;
    }

    if (trimmed && !trimmed.startsWith('(') && !trimmed.startsWith(';')) {
      break;
    }
  }

  return { name, description };
}

function extractBody(content) {
  const lines = content.split('\n');
  const bodyLines = [];
  let pastHeaders = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!pastHeaders) {
      if (trimmed.match(/^\(\s*PROGRAM:/i) || trimmed.match(/^\(\s*DESC:/i)) {
        continue;
      }
      if (trimmed === '' || trimmed.startsWith(';')) {
        continue;
      }
      pastHeaders = true;
    }

    bodyLines.push(line);
  }

  return bodyLines.join('\n').trim();
}

export function listMacros() {
  ensureMacroDir();

  const files = fs.readdirSync(MACRO_DIR);
  const macros = [];

  for (const file of files) {
    if (!file.endsWith('.macro')) continue;

    const idStr = file.replace('.macro', '');
    const id = parseInt(idStr, 10);

    if (!Number.isFinite(id) || id < MIN_ID || id > MAX_ID) continue;

    const filePath = path.join(MACRO_DIR, file);
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const { name, description } = parseMacroHeader(content);
    const body = extractBody(content);

    macros.push({
      id,
      name: name || `Macro ${id}`,
      description: description || null,
      body,
      content,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString()
    });
  }

  macros.sort((a, b) => a.id - b.id);
  return macros;
}

export function getMacro(id) {
  const validation = validateMacroId(id);
  if (!validation.valid) {
    return null;
  }

  const filePath = getMacroFilePath(validation.id);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const { name, description } = parseMacroHeader(content);
  const body = extractBody(content);

  return {
    id: validation.id,
    name: name || `Macro ${validation.id}`,
    description: description || null,
    body,
    content,
    createdAt: stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString()
  };
}

export function getNextAvailableId() {
  ensureMacroDir();

  const files = fs.readdirSync(MACRO_DIR);
  const usedIds = new Set();

  for (const file of files) {
    if (!file.endsWith('.macro')) continue;
    const id = parseInt(file.replace('.macro', ''), 10);
    if (Number.isFinite(id)) {
      usedIds.add(id);
    }
  }

  for (let id = MIN_ID; id <= MAX_ID; id++) {
    if (!usedIds.has(id)) {
      return id;
    }
  }

  return null;
}

function buildMacroContent(name, description, body) {
  const lines = [];

  if (name) {
    lines.push(`( PROGRAM: ${name} )`);
  }
  if (description) {
    lines.push(`( DESC: ${description} )`);
  }

  const bodyContent = body?.trim() || '';
  if (bodyContent) {
    lines.push(bodyContent);
  }

  return lines.join('\n');
}

export function saveMacro(id, { name, description, body, content }) {
  ensureMacroDir();

  const validation = validateMacroId(id);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const filePath = getMacroFilePath(validation.id);

  let fileContent;
  if (content !== undefined) {
    const contentBody = extractBody(content);
    const contentHeaders = parseMacroHeader(content);
    const effectiveName = name !== undefined ? name : contentHeaders.name;
    const effectiveDesc = description !== undefined ? description : contentHeaders.description;
    fileContent = buildMacroContent(effectiveName, effectiveDesc, contentBody);
  } else {
    fileContent = buildMacroContent(name, description, body);
  }

  fs.writeFileSync(filePath, fileContent, 'utf8');
  log(`Saved macro ${validation.id}`);

  return getMacro(validation.id);
}

export function createMacro({ name, description, body, content, id }) {
  let macroId = id;

  if (macroId !== undefined) {
    const validation = validateMacroId(macroId);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    macroId = validation.id;

    const filePath = getMacroFilePath(macroId);
    if (fs.existsSync(filePath)) {
      throw new Error(`Macro ${macroId} already exists`);
    }
  } else {
    macroId = getNextAvailableId();
    if (macroId === null) {
      throw new Error('No available macro IDs (9001-9999 range exhausted)');
    }
  }

  return saveMacro(macroId, { name, description, body, content });
}

export function updateMacro(id, updates) {
  const validation = validateMacroId(id);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const existing = getMacro(validation.id);
  if (!existing) {
    throw new Error(`Macro not found: ${validation.id}`);
  }

  const updated = {
    name: updates.name !== undefined ? updates.name : existing.name,
    description: updates.description !== undefined ? updates.description : existing.description,
    body: updates.body !== undefined ? updates.body : existing.body,
    content: updates.content
  };

  return saveMacro(validation.id, updated);
}

export function deleteMacro(id) {
  const validation = validateMacroId(id);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const filePath = getMacroFilePath(validation.id);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Macro not found: ${validation.id}`);
  }

  fs.unlinkSync(filePath);
  log(`Deleted macro ${validation.id}`);

  return { success: true, id: validation.id };
}

export function getMacroDir() {
  return MACRO_DIR;
}

export function getIdRange() {
  return { min: MIN_ID, max: MAX_ID };
}
