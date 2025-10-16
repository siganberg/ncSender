export const DEFAULT_KEY_BINDINGS: Record<string, string> = {
  ArrowUp: 'JogYPlus',
  ArrowDown: 'JogYMinus',
  ArrowLeft: 'JogXMinus',
  ArrowRight: 'JogXPlus',
  PageUp: 'JogZPlus',
  PageDown: 'JogZMinus',
  'Shift+~': 'JobStart',
  'Shift+!': 'JobPause',
  'Shift+@': 'JobStop',
  'Shift+Z': 'CycleSteps',
  'Shift+X': 'SetStep0.1',
  'Shift+C': 'SetStep1',
  'Shift+V': 'SetStep10'
};

export const FALLBACK_COMBOS = new Set(Object.keys(DEFAULT_KEY_BINDINGS));
