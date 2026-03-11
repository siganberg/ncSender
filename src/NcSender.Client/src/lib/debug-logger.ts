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
