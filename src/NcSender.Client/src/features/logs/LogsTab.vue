<!--
  This file is part of ncSender.

  ncSender is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  ncSender is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with ncSender. If not, see <https://www.gnu.org/licenses/>.
-->

<template>
  <div class="logs-tab">
    <div class="logs-header">
      <div class="header-left">
        <h3>Server Logs</h3>
        <span class="log-count" v-if="logFiles.length > 0">
          {{ logFiles.length }} log file{{ logFiles.length !== 1 ? 's' : '' }}
        </span>
      </div>
      <div class="header-right">
        <select v-model="selectedFile" class="log-select" :disabled="loading || logFiles.length === 0">
          <option v-if="logFiles.length === 0" value="">No logs available</option>
          <option v-for="file in logFiles" :key="file.name" :value="file.name">
            {{ formatDate(file.date) }} ({{ formatSize(file.size) }})
          </option>
        </select>
        <button
          class="btn btn-secondary"
          @click="refreshLogs"
          :disabled="loading"
          title="Refresh"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" :class="{ spinning: loading }">
            <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
            <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
          </svg>
        </button>
        <button
          class="btn btn-primary"
          @click="downloadLog"
          :disabled="!selectedFile || loading"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/>
            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z"/>
          </svg>
          Download
        </button>
      </div>
    </div>

    <div class="logs-content">
      <div v-if="loading && !logContent" class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading logs...</p>
      </div>

      <div v-else-if="error" class="error-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
          <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2"/>
        </svg>
        <p>{{ error }}</p>
        <button class="btn btn-secondary" @click="refreshLogs">Retry</button>
      </div>

      <div v-else-if="logFiles.length === 0" class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
          <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z"/>
          <path d="M4.5 12.5A.5.5 0 0 1 5 12h3a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5m0-2A.5.5 0 0 1 5 10h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5m0-2A.5.5 0 0 1 5 8h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5m0-2A.5.5 0 0 1 5 6h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5"/>
        </svg>
        <p>No log files found</p>
        <p class="empty-hint">Log files are created when the server runs</p>
      </div>

      <div v-else-if="logContent" class="editor-container">
        <CodeEditor
          :value="logContent"
          language="serverlog"
          :theme="monacoTheme"
          :options="editorOptions"
          @editorDidMount="handleEditorMount"
        />
      </div>

      <div v-else class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
          <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z"/>
        </svg>
        <p>Select a log file to view</p>
      </div>
    </div>

    <div v-if="logsDir" class="logs-footer">
      <span class="logs-path">Log files location: {{ logsDir }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { CodeEditor } from 'monaco-editor-vue3';
import * as monaco from 'monaco-editor';
import type * as Monaco from 'monaco-editor';
import { api } from '@/lib/api';

interface LogFile {
  name: string;
  size: number;
  date: string;
  modifiedAt: string;
}

const logFiles = ref<LogFile[]>([]);
const selectedFile = ref('');
const logContent = ref('');
const loading = ref(false);
const error = ref<string | null>(null);
const logsDir = ref<string | null>(null);
const editorInstance = ref<Monaco.editor.IStandaloneCodeEditor | null>(null);

// Theme detection
const isLightTheme = ref(document.body.classList.contains('theme-light'));
const monacoTheme = computed(() => isLightTheme.value ? 'serverlog-light' : 'serverlog-dark');

// Apply theme change to Monaco editor
watch(monacoTheme, (newTheme) => {
  monaco.editor.setTheme(newTheme);
});

// Track if language is already registered (module-level to persist across mounts)
let languageRegistered = false;

// Watch for theme changes
let themeObserver: MutationObserver | null = null;

onMounted(() => {
  if (!languageRegistered) {
    registerLogLanguage();
    languageRegistered = true;
  }
  loadLogFiles();

  // Watch for theme changes
  themeObserver = new MutationObserver(() => {
    isLightTheme.value = document.body.classList.contains('theme-light');
  });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
  }
});

// Editor options - optimized for large log files
const editorOptions: Monaco.editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  readOnlyMessage: { value: '' },
  minimap: { enabled: false },
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  wordWrap: 'off',
  automaticLayout: true,
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  renderLineHighlight: 'none',
  selectionHighlight: false,
  occurrencesHighlight: 'off',
  folding: false,
  glyphMargin: false,
  lineDecorationsWidth: 8,
  lineNumbersMinChars: 4,
  // Performance optimizations for large files
  largeFileOptimizations: true,
  maxTokenizationLineLength: 500,
  renderWhitespace: 'none',
  renderControlCharacters: false,
  links: false,
  scrollbar: {
    vertical: 'visible',
    horizontal: 'auto',
    useShadows: false,
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8
  }
};

function registerLogLanguage() {
  // Check if language is already registered
  const languages = monaco.languages.getLanguages();
  if (languages.some(lang => lang.id === 'serverlog')) {
    return;
  }

  // Register language
  monaco.languages.register({ id: 'serverlog' });

  // Define tokenizer - simplified for performance
  monaco.languages.setMonarchTokensProvider('serverlog', {
    tokenizer: {
      root: [
        // Timestamp [2025-12-29T10:30:45.123Z]
        [/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/, 'log.timestamp'],
        // Log levels
        [/\[ERROR\]/, 'log.error'],
        [/\[WARN\]/, 'log.warn'],
        [/\[INFO\]/, 'log.info'],
        [/\[DEBUG\]/, 'log.debug'],
        // Module names [ModuleName]
        [/\[[A-Za-z][A-Za-z0-9_:-]*\]/, 'log.module'],
        // Quoted strings
        [/"[^"]*"/, 'log.string'],
        [/'[^']*'/, 'log.string'],
        // URLs
        [/https?:\/\/\S+/, 'log.url'],
        // IP addresses
        [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/, 'log.ip'],
        // Numbers (standalone)
        [/\b-?\d+\.?\d*\b/, 'log.number'],
      ]
    }
  });

  // Define themes (wrapped in try-catch to handle re-registration)
  try {
    monaco.editor.defineTheme('serverlog-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
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
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
      }
    });

    monaco.editor.defineTheme('serverlog-light', {
      base: 'vs',
      inherit: true,
      rules: [
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
        'editor.background': '#ffffff',
        'editor.foreground': '#000000',
      }
    });
  } catch (e) {
    // Themes may already be defined, ignore error
  }
}

async function loadLogFiles() {
  loading.value = true;
  error.value = null;

  try {
    const response = await fetch(`${api.baseUrl}/api/logs`);
    if (!response.ok) {
      throw new Error('Failed to fetch log files');
    }

    const data = await response.json();
    logFiles.value = data.files || [];
    logsDir.value = data.logsDir || null;

    // Select the most recent log file by default
    if (logFiles.value.length > 0 && !selectedFile.value) {
      selectedFile.value = logFiles.value[0].name;
    }
  } catch (err: any) {
    error.value = err.message || 'Failed to load log files';
  } finally {
    loading.value = false;
  }
}

async function loadLogContent(filename: string) {
  if (!filename) {
    logContent.value = '';
    return;
  }

  loading.value = true;
  error.value = null;

  try {
    const response = await fetch(`${api.baseUrl}/api/logs/${encodeURIComponent(filename)}`);
    if (!response.ok) {
      throw new Error('Failed to fetch log content');
    }

    const data = await response.json();
    logContent.value = (data.content || '').trimEnd();
    scrollToBottom();
  } catch (err: any) {
    error.value = err.message || 'Failed to load log content';
    logContent.value = '';
  } finally {
    loading.value = false;
  }
}

// Watch for file selection changes
watch(selectedFile, (newFile) => {
  if (newFile) {
    loadLogContent(newFile);
  }
});

function refreshLogs() {
  loadLogFiles().then(() => {
    if (selectedFile.value) {
      loadLogContent(selectedFile.value);
    }
  });
}

function downloadLog() {
  if (!selectedFile.value) return;

  const url = `${api.baseUrl}/api/logs/${encodeURIComponent(selectedFile.value)}/download`;
  const link = document.createElement('a');
  link.href = url;
  link.download = selectedFile.value;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function handleEditorMount(editor: Monaco.editor.IStandaloneCodeEditor) {
  editorInstance.value = editor;
  // Scroll to bottom on initial mount if content exists
  scrollToBottom();
}

function scrollToBottom() {
  nextTick(() => {
    if (editorInstance.value) {
      const model = editorInstance.value.getModel();
      if (model) {
        const lineCount = model.getLineCount();
        editorInstance.value.revealLine(lineCount, 1); // 1 = ScrollType.Immediate
      }
    }
  });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<style scoped>
.logs-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 4px;
  padding: 16px;
}

.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.log-count {
  font-size: 12px;
  color: var(--color-text-muted);
  background: var(--color-surface-elevated);
  padding: 2px 8px;
  border-radius: 10px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.log-select {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  min-width: 200px;
  cursor: pointer;
}

.log-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--color-accent);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-secondary {
  background: var(--color-surface-elevated);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-surface-hover);
}

.logs-content {
  flex: 1;
  min-height: 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
}

.loading-state,
.error-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--color-text-muted);
  padding: 40px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinning {
  animation: spin 1s linear infinite;
}

.error-state svg {
  color: var(--color-error);
}

.empty-hint {
  font-size: 12px;
  opacity: 0.7;
}

.editor-container {
  height: 100%;
}

.editor-container :deep(.monaco-editor) {
  height: 100% !important;
}

.logs-footer {
  flex-shrink: 0;
  padding: 0 2px;
  background: var(--color-surface-elevated);
  border-radius: 6px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.logs-path {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-style: italic;
  font-size: 13px;
}
</style>
