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
  <div class="controller-files">
    <div class="controller-files__toolbar">
      <button class="controller-files__refresh-btn" @click="fetchFiles" :disabled="loading">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"/>
          <polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
        Refresh
      </button>
      <button class="controller-files__refresh-btn" @click="openCreateEditor" :disabled="loading">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        New File
      </button>
      <button class="controller-files__refresh-btn" @click="triggerUpload" :disabled="loading">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Upload
      </button>
      <input
        ref="fileInputRef"
        type="file"
        style="display: none"
        @change="handleFileSelected"
      />
    </div>

    <div class="controller-files__content">
      <div v-if="loading" class="controller-files__empty">
        <div class="controller-files__spinner"></div>
        <p class="controller-files__empty-title">Loading files...</p>
      </div>

      <div v-else-if="error" class="controller-files__empty">
        <svg class="controller-files__empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p class="controller-files__empty-title">Failed to load files</p>
        <p class="controller-files__empty-hint">{{ error }}</p>
      </div>

      <div v-else-if="files.length === 0" class="controller-files__empty">
        <svg class="controller-files__empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <path d="M6 8h.01M10 8h.01M14 8h.01"/>
        </svg>
        <p class="controller-files__empty-title">No files on controller</p>
        <p class="controller-files__empty-hint">The controller's SD card is empty</p>
      </div>

      <template v-else>
        <div class="controller-files__columns">
          <span class="controller-files__column controller-files__column--name">Name</span>
          <span class="controller-files__column controller-files__column--size">Size</span>
          <div class="controller-files__column controller-files__column--actions"></div>
        </div>

        <div class="controller-files__list">
          <div
            v-for="file in files"
            :key="file.name"
            class="controller-files__row"
          >
            <div class="controller-files__file-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
              </svg>
            </div>
            <span class="controller-files__name" :title="file.name">{{ file.name }}</span>
            <span class="controller-files__size">{{ formatFileSize(file.size) }}</span>
            <div class="controller-files__actions">
              <button
                class="controller-files__action-btn controller-files__action-btn--view"
                @click="viewFile(file)"
                title="View"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
              <button
                class="controller-files__action-btn controller-files__action-btn--edit"
                @click="editFile(file)"
                title="Edit"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button
                class="controller-files__action-btn controller-files__action-btn--run"
                @click="runFile(file)"
                title="Run on controller"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </button>
              <button
                class="controller-files__action-btn controller-files__action-btn--delete"
                @click="confirmDelete(file)"
                title="Delete"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>

  <Dialog v-if="showDeleteConfirm" @close="cancelDelete" :show-header="false" size="small" :z-index="10000">
    <ConfirmPanel
      title="Delete File"
      :message="`Are you sure you want to delete &quot;${deleteTarget?.name}&quot; from the controller?`"
      cancel-text="Cancel"
      confirm-text="Delete"
      variant="danger"
      @cancel="cancelDelete"
      @confirm="executeDelete"
    />
  </Dialog>

  <ControllerFileEditor
    v-if="editorMode"
    :mode="editorMode"
    :filename="editorFilename"
    :initial-content="editorContent"
    @close="closeEditor"
    @saved="onEditorSaved"
  />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../../toolpath/api';
import Dialog from '../../../components/Dialog.vue';
import ConfirmPanel from '../../../components/ConfirmPanel.vue';
import ControllerFileEditor from './ControllerFileEditor.vue';

interface ControllerFile {
  name: string;
  size: number;
}

const files = ref<ControllerFile[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const showDeleteConfirm = ref(false);
const deleteTarget = ref<ControllerFile | null>(null);

const editorMode = ref<'view' | 'edit' | 'create' | null>(null);
const editorFilename = ref('');
const editorContent = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const fetchFiles = async () => {
  loading.value = true;
  error.value = null;
  try {
    const result = await api.listControllerFiles();
    if (result.status === 'not-connected') {
      error.value = 'Controller is not connected';
      files.value = [];
    } else if (result.status === 'no-storage') {
      error.value = 'No storage available on controller';
      files.value = [];
    } else {
      files.value = result.files || [];
    }
  } catch (err: any) {
    error.value = err.message || 'Unknown error';
    files.value = [];
  } finally {
    loading.value = false;
  }
};

const runFile = async (file: ControllerFile) => {
  try {
    await api.runControllerFile(file.name);
  } catch (err: any) {
    console.error('Error running controller file:', err.message);
  }
};

const confirmDelete = (file: ControllerFile) => {
  deleteTarget.value = file;
  showDeleteConfirm.value = true;
};

const cancelDelete = () => {
  showDeleteConfirm.value = false;
  deleteTarget.value = null;
};

const executeDelete = async () => {
  if (!deleteTarget.value) return;
  try {
    await api.deleteControllerFile(deleteTarget.value.name);
    await fetchFiles();
  } catch (err: any) {
    console.error('Error deleting controller file:', err.message);
  } finally {
    showDeleteConfirm.value = false;
    deleteTarget.value = null;
  }
};

const openCreateEditor = () => {
  editorFilename.value = '';
  editorContent.value = '';
  editorMode.value = 'create';
};

const triggerUpload = () => {
  fileInputRef.value?.click();
};

const handleFileSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const content = await file.text();
  editorFilename.value = file.name;
  editorContent.value = content;
  editorMode.value = 'create';

  input.value = '';
};

const viewFile = async (file: ControllerFile) => {
  try {
    const result = await api.readControllerFile(file.name);
    editorFilename.value = file.name;
    editorContent.value = result.content;
    editorMode.value = 'view';
  } catch (err: any) {
    console.error('Error reading controller file:', err.message);
  }
};

const editFile = async (file: ControllerFile) => {
  try {
    const result = await api.readControllerFile(file.name);
    editorFilename.value = file.name;
    editorContent.value = result.content;
    editorMode.value = 'edit';
  } catch (err: any) {
    console.error('Error reading controller file:', err.message);
  }
};

const closeEditor = () => {
  editorMode.value = null;
};

const onEditorSaved = () => {
  editorMode.value = null;
  fetchFiles();
};

onMounted(fetchFiles);
</script>

<style scoped>
.controller-files {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.controller-files__toolbar {
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  gap: var(--gap-sm);
}

.controller-files__refresh-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.controller-files__refresh-btn:hover:not(:disabled) {
  background: var(--color-surface);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.controller-files__refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.controller-files__refresh-btn svg {
  width: 18px;
  height: 18px;
}

.controller-files__content {
  flex: 1;
  overflow-y: auto;
}

.controller-files__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 250px;
  padding: 8px;
  color: var(--color-text-secondary);
}

.controller-files__empty-icon {
  width: 64px;
  height: 64px;
  margin-bottom: var(--gap-md);
  opacity: 0.4;
}

.controller-files__empty-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.controller-files__empty-hint {
  margin: var(--gap-xs) 0 0 0;
  font-size: 0.875rem;
  opacity: 0.7;
}

.controller-files__spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: var(--gap-md);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.controller-files__columns {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  position: sticky;
  top: 0;
  z-index: 10;
}

.controller-files__column {
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
}

.controller-files__column--name {
  flex: 1;
}

.controller-files__column--size {
  width: 80px;
  text-align: right;
  padding-right: 12px;
  flex-shrink: 0;
}

.controller-files__column--actions {
  width: 160px;
  flex-shrink: 0;
}

.controller-files__list {
  display: flex;
  flex-direction: column;
  padding: 0 8px 8px 8px;
}

.controller-files__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: var(--radius-small);
  transition: background-color 0.15s ease;
}

.controller-files__row:hover {
  background: var(--color-surface-muted);
}

.controller-files__file-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.controller-files__file-icon svg {
  width: 24px;
  height: 24px;
  color: var(--color-accent);
}

.controller-files__name {
  flex: 1;
  font-size: 0.95rem;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.controller-files__size {
  width: 80px;
  text-align: right;
  padding-right: 12px;
  flex-shrink: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.controller-files__actions {
  width: 160px;
  flex-shrink: 0;
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.controller-files__action-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-small);
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text-secondary);
}

.controller-files__action-btn svg {
  width: 16px;
  height: 16px;
}

.controller-files__action-btn--view:hover,
.controller-files__action-btn--edit:hover {
  background: rgba(26, 188, 156, 0.1);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.controller-files__action-btn--run:hover {
  background: rgba(26, 188, 156, 0.1);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.controller-files__action-btn--delete:hover {
  background: rgba(231, 76, 60, 0.1);
  border-color: var(--color-danger, #e74c3c);
  color: var(--color-danger, #e74c3c);
}
</style>
