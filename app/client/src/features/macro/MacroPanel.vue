<template>
  <div class="macro-panel" :class="{ 'editor-open': selectedMacroId }">
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
            <h3 class="macro-name">{{ macro.name }}</h3>
            <p v-if="macro.description" class="macro-description">{{ macro.description }}</p>
            <p v-else class="macro-preview">{{ getCommandPreview(macro.commands) }}</p>
          </div>
          <button
            class="macro-play-btn"
            @click.stop="runMacroFromList(macro.id)"
            :disabled="!connected"
            title="Run macro"
          >
            ▶
          </button>
        </div>
      </div>
    </div>

    <div class="macro-editor-column" v-if="selectedMacroId">
      <div class="macro-editor">
        <div class="editor-header">
          <button class="btn-primary" @click="saveMacro" :disabled="!isFormValid">Save</button>
          <button class="btn-primary" @click="runMacro" :disabled="!connected || selectedMacroId === 'new'">Run</button>
          <button class="btn-danger" @click="confirmDelete" :disabled="selectedMacroId === 'new'">Delete</button>
        </div>
        <div class="editor-form">
          <div class="form-group">
            <label>Name</label>
            <input
              type="text"
              v-model="formData.name"
              placeholder="Macro name"
              class="form-input"
            />
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea
              v-model="formData.description"
              placeholder="Optional description"
              class="form-textarea"
              rows="2"
            ></textarea>
          </div>
          <div class="form-group">
            <label>Commands</label>
            <textarea
              v-model="formData.commands"
              placeholder="G-code commands (one per line)"
              class="form-textarea commands-textarea"
              rows="15"
            ></textarea>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Delete Confirmation Dialog -->
  <Dialog v-if="showDeleteConfirm" @close="cancelDelete" :show-header="false" size="small" :z-index="10000">
    <ConfirmPanel
      title="Delete Macro"
      :message="`Are you sure you want to delete the macro &quot;${macroToDelete}&quot;?`"
      cancel-text="Cancel"
      confirm-text="Delete"
      variant="danger"
      @cancel="cancelDelete"
      @confirm="performDelete"
    />
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useMacroStore } from './store';
import { api as consoleApi } from '../console/api';
import type { Macro } from './types';
import Dialog from '../../components/Dialog.vue';
import ConfirmPanel from '../../components/ConfirmPanel.vue';

const props = defineProps<{
  connected?: boolean;
}>();

const macroStore = useMacroStore();
const searchQuery = ref('');
const selectedMacroId = ref<string | null>(null);
const showDeleteConfirm = ref(false);
const macroToDelete = ref<string>('');
const formData = ref({
  name: '',
  description: '',
  commands: ''
});

const filteredMacros = computed(() => {
  if (!searchQuery.value) {
    return macroStore.macros.value;
  }
  const query = searchQuery.value.toLowerCase();
  return macroStore.macros.value.filter(macro =>
    macro.name.toLowerCase().includes(query) ||
    macro.description?.toLowerCase().includes(query) ||
    macro.commands.toLowerCase().includes(query)
  );
});

const isFormValid = computed(() => {
  return formData.value.name.trim() !== '' && formData.value.commands.trim() !== '';
});

const getCommandPreview = (commands: string) => {
  const firstLine = commands.split('\n')[0];
  return firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine;
};

const createNewMacro = () => {
  selectedMacroId.value = 'new';
  formData.value = {
    name: '',
    description: '',
    commands: ''
  };
};

const selectMacro = (id: string) => {
  selectedMacroId.value = id;
};

const saveMacro = async () => {
  if (!selectedMacroId.value || !isFormValid.value) return;

  try {
    if (selectedMacroId.value === 'new') {
      const newMacro = await macroStore.createMacro({
        name: formData.value.name,
        description: formData.value.description,
        commands: formData.value.commands
      });
      selectedMacroId.value = newMacro.id;
    } else {
      await macroStore.updateMacro(selectedMacroId.value, {
        name: formData.value.name,
        description: formData.value.description,
        commands: formData.value.commands
      });
    }
  } catch (error) {
    console.error('Failed to save macro:', error);
  }
};

const runMacro = async () => {
  if (!selectedMacroId.value || selectedMacroId.value === 'new' || !props.connected) return;

  const commands = formData.value.commands.split('\n').filter(line => line.trim() !== '');

  for (const command of commands) {
    try {
      await consoleApi.sendCommandViaWebSocket({
        command: command.trim(),
        displayCommand: command.trim(),
        meta: {
          recordHistory: false
        }
      });
    } catch (error) {
      console.error('Failed to send command:', command, error);
    }
  }
};

const runMacroFromList = async (macroId: string) => {
  if (!props.connected) return;

  const macro = macroStore.macros.value.find(m => m.id === macroId);
  if (!macro) return;

  const commands = macro.commands.split('\n').filter(line => line.trim() !== '');

  for (const command of commands) {
    try {
      await consoleApi.sendCommandViaWebSocket({
        command: command.trim(),
        displayCommand: command.trim(),
        meta: {
          recordHistory: false
        }
      });
    } catch (error) {
      console.error('Failed to send command:', command, error);
    }
  }
};

const confirmDelete = () => {
  if (!selectedMacroId.value || selectedMacroId.value === 'new') return;

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
  if (!selectedMacroId.value) return;

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
  if (newId) {
    const macro = macroStore.macros.value.find(m => m.id === newId);
    if (macro) {
      formData.value = {
        name: macro.name,
        description: macro.description || '',
        commands: macro.commands
      };
    }
  } else {
    formData.value = {
      name: '',
      description: '',
      commands: ''
    };
  }
});

onMounted(() => {
  macroStore.loadMacros();
});
</script>

<style scoped>
.macro-panel {
  display: grid;
  grid-template-columns: 1fr 0fr;
  gap: 0;
  height: 100%;
  overflow: hidden;
  transition: grid-template-columns 0.3s ease;
}

.macro-panel.editor-open {
  grid-template-columns: 240px 1fr;
  gap: 15px;
}

.macro-list-column {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  overflow: hidden;
  transition: all 0.3s ease;
}

.macro-panel.editor-open .macro-list-column {
  border-right: 1px solid var(--color-border);
  padding-right: 15px;
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

.macro-name {
  margin: 0 0 4px 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--color-text-primary);
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
  opacity: 0;
  animation: slideIn 0.3s ease forwards;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
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
  gap: var(--gap-xs);
}

.btn-primary {
  padding: 8px 20px;
  border: none;
  border-radius: var(--radius-small);
  background: var(--gradient-accent);
  color: white;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-danger {
  padding: 8px 20px;
  border: none;
  border-radius: var(--radius-small);
  background: #ff6b6b;
  color: white;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  margin-left: auto;
}

.btn-danger:hover {
  background: #ff5252;
}

.editor-form {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
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

.form-textarea {
  resize: vertical;
  font-family: var(--font-family);
}

.commands-textarea {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  line-height: 1.5;
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

@media (max-width: 1024px) {
  .macro-panel {
    grid-template-columns: 1fr;
    grid-template-rows: 300px 1fr;
  }
}
</style>
