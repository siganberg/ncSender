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
// "dongle:device-message" / "dongle:device-changed" broadcasts.
//
// In the packaged Electron kiosk the preload defines `window.ncSender` via
// contextBridge.exposeInMainWorld, which makes the property NON-WRITABLE. A naive
// `window.ncSender = window.ncSender || {}` throws a TypeError in strict mode there, and
// because this whole block runs synchronously at module load, that error aborts main.ts
// before Vue can mount — the kiosk was rendering a white screen. Guarded now so any
// failure here is diagnostic-only; plugins that need onServerEvent gracefully fall through
// their existing `typeof window.ncSender?.onServerEvent === 'function'` check.
try {
  const existing = (window as any).ncSender;
  // Only try to attach when there's no contextBridge object in the way. If a preload
  // already exposed `window.ncSender`, extending it would either throw (frozen proxy)
  // or silently fail — leave it alone.
  if (!existing) {
    const subs = new Map<string, Map<(data: any) => void, () => void>>();
    const bridge = {
      onServerEvent(type: string, cb: (data: any) => void): (() => void) {
        const off = api.on(type, cb);
        let byCb = subs.get(type);
        if (!byCb) { byCb = new Map(); subs.set(type, byCb); }
        byCb.set(cb, off);
        return () => { off(); subs.get(type)?.delete(cb); };
      },
      offServerEvent(type: string, cb: (data: any) => void): void {
        const off = subs.get(type)?.get(cb);
        if (off) { off(); subs.get(type)!.delete(cb); }
      },
    };
    Object.defineProperty(window, 'ncSender', { value: bridge, configurable: true, writable: true });
  } else if (Object.isExtensible(existing) && typeof existing.onServerEvent !== 'function') {
    // Rare: preload used a plain object (not contextBridge). Safe to augment in-place.
    const subs = new Map<string, Map<(data: any) => void, () => void>>();
    existing.onServerEvent = (type: string, cb: (data: any) => void): (() => void) => {
      const off = api.on(type, cb);
      let byCb = subs.get(type);
      if (!byCb) { byCb = new Map(); subs.set(type, byCb); }
      byCb.set(cb, off);
      return () => { off(); subs.get(type)?.delete(cb); };
    };
    existing.offServerEvent = (type: string, cb: (data: any) => void): void => {
      const off = subs.get(type)?.get(cb);
      if (off) { off(); subs.get(type)!.delete(cb); }
    };
  }
  // else: preload froze window.ncSender via contextBridge — we can't attach here. Plugins
  // that need onServerEvent will see the guard fail and fall back to polling. To provide
  // the bridge in kiosk mode, expose onServerEvent from preload.js via ipcRenderer instead.
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[ncSender] plugin bridge attach failed (non-fatal):', err);
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

// Async initialization. Wrapped in try/catch so an error in loadInitData /
// seedInitialState / createApp doesn't silently kill the boot and leave a
// white screen (previously the async IIFE swallowed rejections and never
// called app.mount). If anything above app.mount() throws we render an
// inline diagnostic card into #app so at least the failure is visible on
// the target (e.g. Q6A kiosk) and the user has something to send back.
function showBootError(where: string, err: unknown): void {
  try {
    const msg = err instanceof Error ? (err.stack || err.message) : String(err);
    // eslint-disable-next-line no-console
    console.error(`[ncSender boot] ${where} failed:`, err);
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = '';
    const card = document.createElement('div');
    card.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1a1a2e;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:32px;box-sizing:border-box;';
    const inner = document.createElement('div');
    inner.style.cssText = 'max-width:720px;width:100%;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:24px 28px;';
    const title = document.createElement('div');
    title.textContent = 'ncSender failed to start';
    title.style.cssText = 'font-size:1.15rem;font-weight:600;margin-bottom:6px;color:#f87171;';
    const sub = document.createElement('div');
    sub.textContent = `Stage: ${where}`;
    sub.style.cssText = 'font-size:0.85rem;color:#94a3b8;margin-bottom:14px;';
    const pre = document.createElement('pre');
    pre.textContent = msg;
    pre.style.cssText = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.8rem;color:#e2e8f0;background:#020617;border:1px solid #1e293b;border-radius:6px;padding:12px 14px;overflow:auto;max-height:40vh;margin:0 0 14px 0;';
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.8rem;color:#94a3b8;';
    hint.innerHTML = 'Try quitting and relaunching. If it keeps happening, share this stack with the ncSender maintainer.';
    inner.append(title, sub, pre, hint);
    card.append(inner);
    root.append(card);
  } catch {
    /* last-resort: don't rethrow while trying to report an error */
  }
}

(async () => {
  let initData;
  try {
    // Load all init data in a single API call (settings, macros, license, firmware, plugins, etc.)
    initData = await loadInitData();
  } catch (err) {
    showBootError('loadInitData', err);
    return;
  }

  try {
    // Initialize centralized store and WebSocket event listeners
    initializeStore();

    // Initialize keyboard shortcuts after settings and store are ready
    initializeKeyboardShortcuts(initData);

    // Seed initial state from server
    await seedInitialState(initData);
  } catch (err) {
    showBootError('initializeStore / seedInitialState', err);
    return;
  }

  // Register web components for plugins
  try {
    registerWebComponents();
  } catch (err) {
    // Non-fatal — plugins might not have all web components, keep booting.
    // eslint-disable-next-line no-console
    console.error('[ncSender boot] registerWebComponents failed:', err);
  }

  try {
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

    // Vue error handler — any render/lifecycle error inside the app propagates
    // here. Log to console AND, if the mount has produced literally nothing
    // visible, drop the diagnostic card so the user isn't stuck on white.
    app.config.errorHandler = (err, _instance, info) => {
      // eslint-disable-next-line no-console
      console.error('[ncSender vue]', info, err);
    };

    app.mount('#app');
  } catch (err) {
    showBootError('createApp / mount', err);
    return;
  }

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  }
})();
