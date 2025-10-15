export const DEFAULT_KEY_BINDINGS: Record<string, string> = {
  ArrowUp: 'JogYPlus',
  ArrowDown: 'JogYMinus',
  ArrowLeft: 'JogXMinus',
  ArrowRight: 'JogXPlus',
  PageUp: 'JogZPlus',
  PageDown: 'JogZMinus',
  Escape: 'JogCancel'
};

export const FALLBACK_COMBOS = new Set(Object.keys(DEFAULT_KEY_BINDINGS));
