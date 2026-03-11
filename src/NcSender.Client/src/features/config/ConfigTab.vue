<template>
  <div class="config-tab">
    <div class="config-header">
      <div class="header-left">
        <h3>Controller Config</h3>
        <span v-if="hasChanges" class="unsaved-badge">Unsaved changes</span>
      </div>
      <div class="header-right">
        <button
          class="btn btn-secondary"
          @click="loadConfig"
          :disabled="loading || saving"
          title="Reload config from controller"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" :class="{ spinning: loading }">
            <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
            <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
          </svg>
          Refresh
        </button>
        <button
          v-if="canSave"
          class="btn btn-primary"
          @click="saveConfig"
          :disabled="!hasChanges || saving || loading"
          title="Upload config to controller"
        >
          <svg v-if="saving" class="spinning" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
            <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
          </svg>
          {{ saving ? 'Uploading...' : 'Save to Controller' }}
        </button>
      </div>
    </div>

    <div v-if="loading && !configContent" class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading config from controller...</p>
    </div>

    <div v-else-if="error" class="error-state">
      <p class="error-message">{{ error }}</p>
      <button @click="loadConfig" class="btn btn-secondary">Retry</button>
    </div>

    <div v-else-if="configContent !== null" class="editor-container">
      <CodeEditor
        v-model:value="editedContent"
        language="yaml"
        :theme="monacoTheme"
        :options="editorOptions"
        @editorDidMount="handleEditorMount"
        class="config-editor"
      />
    </div>

    <div v-else class="empty-state">
      <p>Connect to a FluidNC controller to view its configuration</p>
      <button @click="loadConfig" class="btn btn-secondary" :disabled="loading">Load Config</button>
    </div>

    <div v-if="saveMessage" class="save-message" :class="saveMessage.type">
      {{ saveMessage.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { CodeEditor } from 'monaco-editor-vue3';
import * as monaco from 'monaco-editor';
import type * as Monaco from 'monaco-editor';
import { api } from '@/lib/api';
import { useAppStore } from '@/composables/use-app-store';

const store = useAppStore();

const configContent = ref<string | null>(null);
const editedContent = ref('');
const canSave = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const saveMessage = ref<{ text: string; type: 'success' | 'error' } | null>(null);
const editorInstance = ref<Monaco.editor.IStandaloneCodeEditor | null>(null);

const hasChanges = computed(() =>
  configContent.value !== null && editedContent.value !== configContent.value
);

// Theme detection
const isLightTheme = ref(document.body.classList.contains('theme-light'));
const monacoTheme = computed(() => isLightTheme.value ? 'vs-light' : 'vs-dark');

watch(monacoTheme, (newTheme) => {
  monaco.editor.setTheme(newTheme);
});

let themeObserver: MutationObserver | null = null;

onMounted(() => {
  themeObserver = new MutationObserver(() => {
    isLightTheme.value = document.body.classList.contains('theme-light');
  });
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  if (store.status.connected) {
    loadConfig();
  }
});

onUnmounted(() => {
  themeObserver?.disconnect();
});

const editorOptions: Monaco.editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  fontSize: 13,
  tabSize: 2,
  insertSpaces: true,
  renderWhitespace: 'selection',
  automaticLayout: true,
  folding: true,
  glyphMargin: false,
  lineDecorationsWidth: 0,
  lineNumbersMinChars: 3,
  padding: { top: 8, bottom: 8 },
};

function handleEditorMount(editor: Monaco.editor.IStandaloneCodeEditor) {
  editorInstance.value = editor;
}

async function loadConfig() {
  loading.value = true;
  error.value = null;
  saveMessage.value = null;
  try {
    const resp = await api.getConfig();
    configContent.value = resp.content;
    editedContent.value = resp.content;
    canSave.value = resp.canSave;
  } catch (e: any) {
    error.value = e.message || 'Failed to load config';
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  saveMessage.value = null;
  try {
    await api.saveConfig(editedContent.value);
    configContent.value = editedContent.value;
    saveMessage.value = { text: 'Config uploaded successfully. Restart the controller to apply changes.', type: 'success' };
    setTimeout(() => { saveMessage.value = null; }, 8000);
  } catch (e: any) {
    saveMessage.value = { text: e.message || 'Failed to save config', type: 'error' };
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.config-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: var(--gap-sm);
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 0 var(--gap-sm) 0;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.header-left h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.unsaved-badge {
  background: #e67e22;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.header-right {
  display: flex;
  gap: var(--gap-sm);
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--gap-sm) var(--gap-md);
  border: none;
  border-radius: var(--border-radius);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.15s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-border);
}

.btn-primary {
  background: var(--color-primary, #3b82f6);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.editor-container {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  overflow: hidden;
  height: 100%;
}

.editor-container :deep(.monaco-editor) {
  height: 100% !important;
}

.loading-state,
.error-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: var(--gap-md);
  color: var(--color-text-secondary);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary, #3b82f6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.error-message {
  color: #ef4444;
}

.save-message {
  padding: var(--gap-sm) var(--gap-md);
  border-radius: var(--border-radius);
  font-size: 0.85rem;
  flex-shrink: 0;
}

.save-message.success {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.save-message.error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinning {
  animation: spin 0.8s linear infinite;
}
</style>
