import type { KeyCombo } from './types';

const MODIFIER_ORDER = ['Ctrl', 'Meta', 'Alt', 'Shift'] as const;
const MODIFIER_ALIASES: Record<string, string> = {
  control: 'Ctrl',
  ctrl: 'Ctrl',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift'
};

const SPECIAL_KEY_MAP: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  escape: 'Escape',
  esc: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  home: 'Home',
  end: 'End'
};

export function normalizeCombo(combo: string | null | undefined): KeyCombo | null {
  if (!combo) {
    return null;
  }

  const rawParts = combo.split('+').map(part => part.trim()).filter(Boolean);
  if (rawParts.length === 0) {
    return null;
  }

  const modifiers = new Set<string>();
  const keys: string[] = [];

  for (const raw of rawParts) {
    const lower = raw.toLowerCase();
    if (MODIFIER_ALIASES[lower]) {
      modifiers.add(MODIFIER_ALIASES[lower]);
      continue;
    }

    const special = SPECIAL_KEY_MAP[lower];
    if (special) {
      keys.push(special);
      continue;
    }

    if (lower.length === 1) {
      keys.push(lower.toUpperCase());
      continue;
    }

    keys.push(raw.replace(/^[a-z]/, match => match.toUpperCase()));
  }

  if (keys.length === 0) {
    return null;
  }

  const orderedModifiers = MODIFIER_ORDER.filter(name => modifiers.has(name));
  return [...orderedModifiers, ...keys].join('+');
}

function formatPrimaryKey(eventKey: string): string | null {
  if (!eventKey) {
    return null;
  }

  const lower = eventKey.toLowerCase();
  if (MODIFIER_ALIASES[lower]) {
    return null;
  }

  if (SPECIAL_KEY_MAP[lower]) {
    return SPECIAL_KEY_MAP[lower];
  }

  if (lower.length === 1) {
    return eventKey.toUpperCase();
  }

  return eventKey.replace(/^[a-z]/, match => match.toUpperCase());
}

export function comboFromEvent(event: KeyboardEvent): KeyCombo | null {
  const parts: string[] = [];
  if (event.ctrlKey || event.key === 'Control') {
    parts.push('Ctrl');
  }
  if (event.metaKey || event.key === 'Meta') {
    parts.push('Meta');
  }
  if (event.altKey || event.key === 'Alt') {
    parts.push('Alt');
  }
  if (event.shiftKey || event.key === 'Shift') {
    parts.push('Shift');
  }

  const key = formatPrimaryKey(event.key);
  if (key) {
    parts.push(key);
  }

  return normalizeCombo(parts.join('+'));
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  const editableSelectors = 'input, textarea, [contenteditable="true"], [contenteditable=""], .monaco-editor';
  return target.matches(editableSelectors) || Boolean(target.closest(editableSelectors));
}
