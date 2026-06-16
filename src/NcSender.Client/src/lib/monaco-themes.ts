import * as monaco from 'monaco-editor';

/**
 * Single shared Monaco theme used by every editor in the app and its plugins.
 *
 * Monaco's `monaco.editor.setTheme(...)` is GLOBAL — it affects every mounted
 * editor instance. Defining one theme that contains the union of all token
 * rules across languages (G-code, server logs, etc.) means we never have to
 * fight over the global theme: every editor mounts with the same name and
 * stays correct regardless of which other editor mounts/unmounts.
 *
 * Token names are scoped per-language, so G-code and log rules co-exist in
 * the same theme without conflict.
 *
 * Theme tracking is centralized here: we own the single source of truth for
 * the current monacoTheme and the single MutationObserver on body.class.
 * Components import `monacoTheme` and pass it through the editor's :theme
 * prop — no per-component observers, no per-component setTheme calls, so
 * nothing races when an unrelated body-class change fires (e.g. the virtual
 * keyboard adding `virtual-keyboard-open`).
 */

import { computed, ref } from 'vue';

const DARK_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    // Generic
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'number', foreground: 'B5CEA8' },

    // G-code
    { token: 'gcode-rapid', foreground: 'FF8C00', fontStyle: 'bold' },
    { token: 'gcode-cutting', foreground: '569CD6', fontStyle: 'bold' },
    { token: 'gcode-g', foreground: 'C586C0' },
    { token: 'gcode-m', foreground: 'DCDCAA' },
    { token: 'gcode-tool', foreground: '4EC9B0' },
    { token: 'gcode-spindle', foreground: 'CE9178' },
    { token: 'gcode-feed', foreground: 'B5CEA8' },
    { token: 'gcode-coord-x', foreground: 'F14C4C' },
    { token: 'gcode-coord-y', foreground: '4EC9B0' },
    { token: 'gcode-coord-z', foreground: '569CD6' },
    { token: 'gcode-coord-other', foreground: '9CDCFE' },
    { token: 'gcode-line-number', foreground: '858585' },

    // Server logs
    { token: 'log.timestamp', foreground: '6A9955' },
    { token: 'log.error', foreground: 'F14C4C', fontStyle: 'bold' },
    { token: 'log.warn', foreground: 'CCA700', fontStyle: 'bold' },
    { token: 'log.info', foreground: '3794FF', fontStyle: 'bold' },
    { token: 'log.debug', foreground: '888888', fontStyle: 'bold' },
    { token: 'log.module', foreground: 'C586C0' },
    { token: 'log.number', foreground: 'B5CEA8' },
    { token: 'log.string', foreground: 'CE9178' },
    { token: 'log.url', foreground: '4EC9B0', fontStyle: 'underline' },
    { token: 'log.ip', foreground: '569CD6' },
  ],
  colors: {},
};

const LIGHT_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '008000', fontStyle: 'italic' },
    { token: 'number', foreground: '098658' },

    // G-code
    { token: 'gcode-rapid', foreground: 'E67E22', fontStyle: 'bold' },
    { token: 'gcode-cutting', foreground: '2E86C1', fontStyle: 'bold' },
    { token: 'gcode-g', foreground: 'AF00DB' },
    { token: 'gcode-m', foreground: '795E26' },
    { token: 'gcode-tool', foreground: '267F99' },
    { token: 'gcode-spindle', foreground: 'A31515' },
    { token: 'gcode-feed', foreground: '098658' },
    { token: 'gcode-coord-x', foreground: 'C72828' },
    { token: 'gcode-coord-y', foreground: '267F99' },
    { token: 'gcode-coord-z', foreground: '2E86C1' },
    { token: 'gcode-coord-other', foreground: '0070C1' },
    { token: 'gcode-line-number', foreground: '999999' },

    // Server logs
    { token: 'log.timestamp', foreground: '008000' },
    { token: 'log.error', foreground: 'C41E3A', fontStyle: 'bold' },
    { token: 'log.warn', foreground: 'B8860B', fontStyle: 'bold' },
    { token: 'log.info', foreground: '0066CC', fontStyle: 'bold' },
    { token: 'log.debug', foreground: '808080', fontStyle: 'bold' },
    { token: 'log.module', foreground: 'AF00DB' },
    { token: 'log.number', foreground: '098658' },
    { token: 'log.string', foreground: 'A31515' },
    { token: 'log.url', foreground: '267F99', fontStyle: 'underline' },
    { token: 'log.ip', foreground: '0000FF' },
  ],
  colors: {
    'editor.background': '#f8f8f8',
    'editorGutter.background': '#f8f8f8',
  },
};

const _isLightTheme = ref(document.body.classList.contains('theme-light'));

export const isLightTheme = computed(() => _isLightTheme.value);
export const monacoTheme = computed(() => _isLightTheme.value ? 'ncsender-light' : 'ncsender-dark');

let initialized = false;

export function registerNcSenderThemes(): void {
  if (initialized) return;
  monaco.editor.defineTheme('ncsender-dark', DARK_THEME);
  monaco.editor.defineTheme('ncsender-light', LIGHT_THEME);
  monaco.editor.setTheme(monacoTheme.value);

  new MutationObserver(() => {
    const nowLight = document.body.classList.contains('theme-light');
    if (nowLight === _isLightTheme.value) return;
    _isLightTheme.value = nowLight;
    monaco.editor.setTheme(monacoTheme.value);
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  initialized = true;
}

export function getNcSenderTheme(isLight: boolean): string {
  return isLight ? 'ncsender-light' : 'ncsender-dark';
}
