import { getSettings } from './settings-store.js';

let debugEnabled = false;

// Initialize debug state from settings
export function initDebugLogger() {
  const settings = getSettings();
  debugEnabled = settings?.debugLogging === true;
}

// Update debug state when settings change
export function setDebugEnabled(enabled: boolean) {
  debugEnabled = enabled;
}

// Check if debug is enabled
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

// Debug log - only logs if debugLogging is enabled
export function debugLog(...args: any[]) {
  // Check settings dynamically to handle timing issues
  const settings = getSettings();
  const enabled = settings?.debugLogging === true;

  if (enabled) {
    console.log('[DEBUG]', ...args);
  }
}

// Debug warn - only logs if debugLogging is enabled
export function debugWarn(...args: any[]) {
  // Check settings dynamically to handle timing issues
  const settings = getSettings();
  const enabled = settings?.debugLogging === true;
  if (enabled) {
    console.warn('[DEBUG]', ...args);
  }
}

// Debug error - always logs (errors should always be visible)
export function debugError(...args: any[]) {
  console.error('[ERROR]', ...args);
}

// Debug info - only logs if debugLogging is enabled
export function debugInfo(...args: any[]) {
  if (debugEnabled) {
    console.info('[DEBUG]', ...args);
  }
}
