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

import { createApp } from 'vue';
import App from './App.vue';
import '@/assets/styles/base.css';
import { loadInitData } from './lib/init';
import { initializeKeyboardShortcuts } from './features/controls';
import { initializeStore, seedInitialState } from './composables/use-app-store';
import { registerWebComponents } from './web-components';
import { api } from './lib/api.js';

// Additive plugin bridge: expose a minimal server-event subscription on window.ncSender so
// plugin dialogs (which run in the app page) can react to WS events — e.g. the generic
// "dongle:device-message" / "dongle:device-changed" broadcasts. Merged onto whatever the
// Electron preload already provides (getApiBaseUrl, updates); existing keys are untouched.
{
  const bridge: any = ((window as any).ncSender = (window as any).ncSender || {});
  if (typeof bridge.onServerEvent !== 'function') {
    // onServerEvent(type, cb) -> unsubscribe(); mirrors api.on's contract.
    const subs = new Map<string, Map<(data: any) => void, () => void>>();
    bridge.onServerEvent = (type: string, cb: (data: any) => void): (() => void) => {
      const off = api.on(type, cb);
      let byCb = subs.get(type);
      if (!byCb) { byCb = new Map(); subs.set(type, byCb); }
      byCb.set(cb, off);
      return () => { off(); subs.get(type)?.delete(cb); };
    };
    bridge.offServerEvent = (type: string, cb: (data: any) => void): void => {
      const off = subs.get(type)?.get(cb);
      if (off) { off(); subs.get(type)!.delete(cb); }
    };
  }
}

// Disable context menu globally for touch screen compatibility
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  return false;
}, { passive: false });

// Disable text selection on touch devices, except in allowed areas
document.addEventListener('selectstart', (e) => {
  const target = e.target as Node | null;
  const el = (target && target.nodeType === Node.ELEMENT_NODE)
    ? (target as Element)
    : (target as any)?.parentElement as Element | null;

  // Allow selection in inputs, textareas, contenteditable, console history, and G-code viewer
  if (el && el.closest('input, textarea, [contenteditable], .console-output, .gcode-content, .gcode-line, .line-content')) {
    return true;
  }

  e.preventDefault();
  return false;
}, { passive: false });

// Async initialization
(async () => {
  // Load all init data in a single API call (settings, macros, license, firmware, plugins, etc.)
  const initData = await loadInitData();

  // Initialize centralized store and WebSocket event listeners
  initializeStore();

  // Initialize keyboard shortcuts after settings and store are ready
  initializeKeyboardShortcuts(initData);

  // Seed initial state from server
  await seedInitialState(initData);

  // Register web components for plugins
  registerWebComponents();

  const app = createApp(App);

  // Patch Vue's addEventListener to use passive: false for touch events
  const originalAddEventListener = Element.prototype.addEventListener;
  Element.prototype.addEventListener = function(type: string, listener: any, options?: any) {
    if (type === 'touchstart' || type === 'touchmove' || type === 'wheel') {
      if (typeof options === 'boolean') {
        options = { capture: options, passive: false };
      } else if (typeof options === 'object' && options !== null) {
        options = { ...options, passive: false };
      } else {
        options = { passive: false };
      }
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  app.mount('#app');

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  }
})();
