// Action ID -> Key Combo mapping
// null value means the action is explicitly unset
export const DEFAULT_KEY_BINDINGS: Record<string, string | null> = {
  JogYPlus: 'ArrowUp',
  JogYMinus: 'ArrowDown',
  JogXMinus: 'ArrowLeft',
  JogXPlus: 'ArrowRight',
  JogZPlus: 'PageUp',
  JogZMinus: 'PageDown',
  JobStart: 'Shift+~',
  JobPause: 'Shift+!',
  JobStop: 'Shift+@',
  CycleSteps: 'Shift+Z',
  'SetStep0.1': 'Shift+X',
  SetStep1: 'Shift+C',
  SetStep10: 'Shift+V'
};

export const FALLBACK_ACTIONS = new Set(Object.keys(DEFAULT_KEY_BINDINGS));
