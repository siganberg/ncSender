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
  <div class="macro-panel" :class="{ 'editor-open': selectedMacroId !== null }">
    <div class="macro-list-column">
      <div class="macro-list-header">
        <input
          type="text"
          v-model="searchQuery"
          placeholder="Search macros..."
          class="search-input"
        />
        <button class="btn-new" @click="createNewMacro">+ New</button>
      </div>
      <div class="macro-list-content">
        <div v-if="filteredMacros.length === 0" class="empty-state">
          <p v-if="searchQuery">No macros match your search</p>
          <p v-else>No macros yet. Click "+ New" to create one.</p>
        </div>
        <div
          v-for="macro in filteredMacros"
          :key="macro.id"
          :class="['macro-item', { active: selectedMacroId === macro.id }]"
          @click="selectMacro(macro.id)"
        >
          <div class="macro-item-content">
            <div class="macro-header">
              <span class="macro-id">P{{ macro.id }}</span>
              <h3 class="macro-name">{{ macro.name }}</h3>
            </div>
            <p v-if="macro.description" class="macro-description">{{ macro.description }}</p>
            <p v-else class="macro-preview">{{ getCommandPreview(macro.body) }}</p>
          </div>
          <button
            class="macro-play-btn"
            @click.stop="runMacroFromList(macro.id)"
            :disabled="!connected"
            title="Run macro (M98 P{{ macro.id }})"
          >
            ▶
          </button>
        </div>
      </div>
    </div>

    <div class="macro-editor-column">
      <div v-if="selectedMacroId !== null" class="macro-editor">
        <div class="editor-header">
          <button class="btn-icon btn-close" @click="closeEditor" title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <div class="editor-actions">
            <button class="btn-icon btn-save" @click="saveMacro" :disabled="!isFormValid" title="Save">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            </button>
            <button class="btn-icon btn-run" @click="runMacro" :disabled="!connected || selectedMacroId === 'new'" title="Run">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
            <button class="btn-icon btn-delete" @click="confirmDelete" :disabled="selectedMacroId === 'new'" title="Delete">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="editor-form">
          <div class="form-row">
            <div class="form-group-inline form-group-id">
              <label>ID</label>
              <input
                type="number"
                v-model.number="formData.id"
                :placeholder="nextIdPlaceholder"
                :min="9001"
                :max="9999"
                class="form-input form-input-id"
                :disabled="selectedMacroId !== 'new'"
              />
            </div>
            <div class="form-group-inline form-group-name">
              <label>Name</label>
              <input
                type="text"
                v-model="formData.name"
                placeholder="Macro name"
                class="form-input"
              />
            </div>
          </div>
          <div class="form-group-inline">
            <label>Description</label>
            <input
              type="text"
              v-model="formData.description"
              placeholder="Optional description"
              class="form-input"
            />
          </div>
          <div class="form-group commands-group">
            <label>G-code Commands</label>
            <div class="commands-editor">
              <CodeEditor
                v-model:value="formData.content"
                language="gcode"
                :theme="monacoTheme"
                :options="editorOptions"
              />
            </div>
          </div>
          <div class="form-hint" v-if="selectedMacroId === 'new'">
            Invoke with: <code>M98 P{{ formData.id || (macroStore.idInfo.value?.nextId || '9001') }}</code>
          </div>
          <div class="form-hint" v-else-if="typeof selectedMacroId === 'number'">
            Invoke with: <code>M98 P{{ selectedMacroId }}</code>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Delete Confirmation Dialog -->
  <Dialog v-if="showDeleteConfirm" @close="cancelDelete" :show-header="false" size="small" :z-index="10000">
    <ConfirmPanel
      title="Delete Macro"
      :message="`Are you sure you want to delete the macro &quot;${macroToDelete}&quot; (P${selectedMacroId})?`"
      cancel-text="Cancel"
      confirm-text="Delete"
      variant="danger"
      @cancel="cancelDelete"
      @confirm="performDelete"
    />
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useM98MacroStore } from './store';
import type { M98Macro } from './types';
import Dialog from '../../components/Dialog.vue';
import ConfirmPanel from '../../components/ConfirmPanel.vue';
import { CodeEditor } from 'monaco-editor-vue3';
import * as monaco from 'monaco-editor';

const props = defineProps<{
  connected?: boolean;
}>();

const macroStore = useM98MacroStore();
const searchQuery = ref('');
const selectedMacroId = ref<number | 'new' | null>(null);
const showDeleteConfirm = ref(false);
const macroToDelete = ref<string>('');
const formData = ref({
  id: undefined as number | undefined,
  name: '',
  description: '',
  content: ''
});

// Monaco editor setup
const isLightTheme = ref(document.body.classList.contains('theme-light'));
const monacoTheme = computed(() => isLightTheme.value ? 'gcode-light' : 'gcode-dark');

const editorOptions = {
  minimap: { enabled: false },
  lineNumbers: 'on' as const,
  scrollBeyondLastLine: false,
  wordWrap: 'on' as const,
  automaticLayout: true,
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  renderLineHighlight: 'none' as const,
  folding: false,
  glyphMargin: false,
  lineDecorationsWidth: 8,
  lineNumbersMinChars: 2,
  stickyScroll: { enabled: false },
  scrollbar: {
    vertical: 'auto' as const,
    horizontal: 'hidden' as const,
    useShadows: false,
    verticalScrollbarSize: 6
  }
};

// Watch for theme changes
const themeObserver = new MutationObserver(() => {
  isLightTheme.value = document.body.classList.contains('theme-light');
});

// Apply theme change to Monaco editor
watch(monacoTheme, (newTheme) => {
  monaco.editor.setTheme(newTheme);
});

const nextIdPlaceholder = computed(() => {
  const info = macroStore.idInfo.value;
  return info?.nextId ? `Auto (${info.nextId})` : '9001-9999';
});

const filteredMacros = computed(() => {
  if (!searchQuery.value) {
    return macroStore.macros.value;
  }
  const query = searchQuery.value.toLowerCase();
  return macroStore.macros.value.filter(macro =>
    macro.name.toLowerCase().includes(query) ||
    macro.description?.toLowerCase().includes(query) ||
    macro.body.toLowerCase().includes(query) ||
    String(macro.id).includes(query)
  );
});

const isFormValid = computed(() => {
  const hasContent = formData.value.content.trim() !== '';
  if (selectedMacroId.value === 'new') {
    const id = formData.value.id;
    const validId = id === undefined || (id >= 9001 && id <= 9999);
    return hasContent && validId;
  }
  return hasContent;
});

const getCommandPreview = (body: string) => {
  const firstLine = body.split('\n')[0];
  return firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
};

const createNewMacro = async () => {
  await macroStore.loadNextId();
  selectedMacroId.value = 'new';
  formData.value = {
    id: undefined,
    name: '',
    description: '',
    content: ''
  };
};

const selectMacro = (id: number) => {
  selectedMacroId.value = id;
};

const closeEditor = () => {
  selectedMacroId.value = null;
};

const saveMacro = async () => {
  if (selectedMacroId.value === null || !isFormValid.value) return;

  try {
    if (selectedMacroId.value === 'new') {
      const newMacro = await macroStore.createMacro({
        id: formData.value.id,
        name: formData.value.name || undefined,
        description: formData.value.description || undefined,
        content: formData.value.content
      });
      selectedMacroId.value = newMacro.id;
    } else {
      const updated = await macroStore.updateMacro(selectedMacroId.value, {
        name: formData.value.name || undefined,
        description: formData.value.description || undefined,
        content: formData.value.content
      });
      formData.value.content = updated.content;
      formData.value.name = updated.name;
      formData.value.description = updated.description || '';
    }
  } catch (error) {
    console.error('Failed to save macro:', error);
  }
};

const runMacro = async () => {
  if (selectedMacroId.value === null || selectedMacroId.value === 'new' || !props.connected) return;

  try {
    await macroStore.executeMacro(selectedMacroId.value);
  } catch (error) {
    console.error('Failed to execute macro:', error);
  }
};

const runMacroFromList = async (macroId: number) => {
  if (!props.connected) return;

  try {
    await macroStore.executeMacro(macroId);
  } catch (error) {
    console.error('Failed to execute macro:', error);
  }
};

const confirmDelete = () => {
  if (selectedMacroId.value === null || selectedMacroId.value === 'new') return;

  const macro = macroStore.macros.value.find(m => m.id === selectedMacroId.value);
  if (macro) {
    macroToDelete.value = macro.name;
    showDeleteConfirm.value = true;
  }
};

const cancelDelete = () => {
  showDeleteConfirm.value = false;
  macroToDelete.value = '';
};

const performDelete = async () => {
  if (selectedMacroId.value === null || selectedMacroId.value === 'new') return;

  try {
    await macroStore.deleteMacro(selectedMacroId.value);
    selectedMacroId.value = null;
    showDeleteConfirm.value = false;
    macroToDelete.value = '';
  } catch (error) {
    console.error('Failed to delete macro:', error);
    showDeleteConfirm.value = false;
    macroToDelete.value = '';
  }
};

watch(selectedMacroId, (newId) => {
  if (newId !== null && newId !== 'new') {
    const macro = macroStore.macros.value.find(m => m.id === newId);
    if (macro) {
      formData.value = {
        id: macro.id,
        name: macro.name,
        description: macro.description || '',
        content: macro.content
      };
    }
  } else if (newId === null) {
    formData.value = {
      id: undefined,
      name: '',
      description: '',
      content: ''
    };
  }
});

onMounted(() => {
  macroStore.loadMacros();
  macroStore.loadNextId();
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
});

onUnmounted(() => {
  themeObserver.disconnect();
});
</script>

<style scoped>
.macro-panel {
  display: flex;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.macro-list-column {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  overflow: hidden;
  width: 100%;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.macro-panel.editor-open .macro-list-column {
  width: 240px;
  border-right: 1px solid var(--color-border);
  padding-right: 15px;
  flex-shrink: 0;
}

@media (max-width: 1200px) {
  .macro-panel.editor-open .macro-list-column {
    width: 35vw !important;
  }
}

.macro-list-header {
  display: flex;
  gap: var(--gap-xs);
}

.search-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.8rem;
  width: 100%;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.btn-new {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-small);
  background: var(--gradient-accent);
  color: white;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.btn-new:hover {
  opacity: 0.9;
}

.macro-list-content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
}

.macro-item {
  position: relative;
  padding: var(--gap-sm);
  border: 2px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: flex-start;
  gap: var(--gap-xs);
}

.macro-item:hover {
  border-color: var(--color-accent);
  background: var(--color-surface-muted);
}

.macro-item.active {
  border: 2px solid var(--color-accent);
  background: var(--color-surface-muted);
}

.macro-item-content {
  flex: 1;
  min-width: 0;
}

.macro-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.macro-id {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-accent);
  background: var(--color-surface-muted);
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.macro-name {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.macro-play-btn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius-small);
  background: var(--gradient-accent);
  color: white;
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.macro-play-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: scale(1.05);
}

.macro-play-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.macro-description,
.macro-preview {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.macro-preview {
  font-family: 'JetBrains Mono', monospace;
  opacity: 0.7;
}

.macro-editor-column {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 1;
  margin-left: 15px;
  min-width: 0;
  opacity: 0;
  transform: translateX(30px);
  transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.macro-panel.editor-open .macro-editor-column {
  opacity: 1;
  transform: translateX(0);
}

.macro-editor {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  height: 100%;
  overflow: hidden;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.editor-actions {
  display: flex;
  gap: var(--gap-xs);
}

.btn-icon {
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon:hover:not(:disabled) {
  background: var(--color-surface);
  transform: translateY(-1px);
}

.btn-icon:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-close:hover:not(:disabled) {
  background: var(--color-surface);
}

.btn-save:hover:not(:disabled) {
  background: var(--gradient-accent);
  color: white;
}

.btn-run:hover:not(:disabled) {
  background: var(--gradient-accent);
  color: white;
}

.btn-delete:hover:not(:disabled) {
  background: #ff6b6b;
  color: white;
}

.editor-form {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
  min-height: 0;
}

.form-row {
  display: flex;
  gap: var(--gap-sm);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group-inline {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.form-group-id {
  flex-shrink: 0;
}

.form-group-name {
  flex: 1;
  min-width: 0;
}

.form-group-inline label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  min-width: 80px;
}

.form-group-inline .form-input {
  flex: 1;
}

.form-input-id {
  width: 120px !important;
  flex: none !important;
  font-family: 'JetBrains Mono', monospace;
}

.form-group label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.form-input,
.form-select,
.form-textarea {
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-family: var(--font-family);
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}

.form-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.form-textarea {
  resize: vertical;
  font-family: var(--font-family);
}

.commands-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.commands-editor {
  flex: 1;
  min-height: 200px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  overflow: hidden;
}

.form-hint {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  padding: 4px 0;
}

.form-hint code {
  font-family: 'JetBrains Mono', monospace;
  background: var(--color-surface-muted);
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--color-accent);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  font-style: italic;
  font-size: 0.9rem;
  text-align: center;
  padding: var(--gap-md);
}
</style>
