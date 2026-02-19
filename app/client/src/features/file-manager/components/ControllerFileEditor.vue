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
  <Dialog @close="$emit('close')" size="medium" :z-index="10000" :close-on-backdrop-click="false" show-header>
    <template #title>
      <span v-if="mode === 'create'">New File</span>
      <span v-else-if="mode === 'edit'">Edit: {{ filename }}</span>
      <span v-else>{{ filename }}</span>
    </template>

    <div class="editor">
      <div v-if="mode === 'create'" class="editor__filename-row">
        <label class="editor__label">Filename</label>
        <input
          v-model="editFilename"
          class="editor__filename-input"
          placeholder="e.g. program.nc"
          :disabled="transferring"
        />
      </div>

      <textarea
        v-model="editContent"
        class="editor__textarea"
        :readonly="mode === 'view'"
        :disabled="transferring"
        spellcheck="false"
      ></textarea>

      <div v-if="transferring" class="editor__progress">
        <div class="editor__progress-bar">
          <div class="editor__progress-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <span class="editor__progress-text">{{ progressPercent }}%</span>
      </div>

      <div v-if="errorMessage" class="editor__error">{{ errorMessage }}</div>

      <div class="editor__footer">
        <button class="editor__btn editor__btn--cancel" @click="$emit('close')" :disabled="transferring">
          {{ mode === 'view' ? 'Close' : 'Cancel' }}
        </button>
        <button
          v-if="mode !== 'view'"
          class="editor__btn editor__btn--save"
          @click="handleSave"
          :disabled="transferring || (mode === 'create' && !editFilename.trim())"
        >
          {{ mode === 'create' ? 'Upload' : 'Save' }}
        </button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../../toolpath/api';
import Dialog from '../../../components/Dialog.vue';

const props = defineProps<{
  mode: 'view' | 'edit' | 'create';
  filename?: string;
  initialContent?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved'): void;
}>();

const editFilename = ref(props.filename || '');
const editContent = ref(props.initialContent || '');
const transferring = ref(false);
const progressPercent = ref(0);
const errorMessage = ref<string | null>(null);

const handleSave = async () => {
  errorMessage.value = null;
  transferring.value = true;
  progressPercent.value = 0;

  const onProgress = (event: any) => {
    progressPercent.value = event.percent || 0;
  };

  try {
    if (props.mode === 'create') {
      await api.uploadControllerFile(editFilename.value.trim(), editContent.value, onProgress);
    } else {
      await api.saveControllerFile(props.filename!, editContent.value, onProgress);
    }
    emit('saved');
  } catch (err: any) {
    errorMessage.value = err.message || 'Transfer failed';
  } finally {
    transferring.value = false;
  }
};
</script>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: var(--gap-md);
  gap: var(--gap-sm);
  min-height: 0;
}

.editor__filename-row {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.editor__label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.editor__filename-input {
  flex: 1;
  padding: 8px 12px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.editor__filename-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.editor__textarea {
  flex: 1;
  min-height: 0;
  padding: 12px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-family: monospace;
  font-size: 0.85rem;
  line-height: 1.5;
  resize: none;
  tab-size: 4;
}

.editor__textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}

.editor__textarea[readonly] {
  opacity: 0.8;
}

.editor__progress {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.editor__progress-bar {
  flex: 1;
  height: 6px;
  background: var(--color-surface-muted);
  border-radius: 3px;
  overflow: hidden;
}

.editor__progress-fill {
  height: 100%;
  background: var(--color-accent);
  transition: width 0.2s ease;
}

.editor__progress-text {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  min-width: 36px;
  text-align: right;
}

.editor__error {
  padding: 8px 12px;
  background: rgba(231, 76, 60, 0.1);
  border: 1px solid rgba(231, 76, 60, 0.3);
  border-radius: var(--radius-small);
  color: var(--color-danger, #e74c3c);
  font-size: 0.85rem;
}

.editor__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-sm);
}

.editor__btn {
  padding: 8px 16px;
  border-radius: var(--radius-small);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.editor__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.editor__btn--cancel {
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
}

.editor__btn--cancel:hover:not(:disabled) {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.editor__btn--save {
  background: var(--color-accent);
  border: 1px solid var(--color-accent);
  color: #fff;
}

.editor__btn--save:hover:not(:disabled) {
  filter: brightness(1.1);
}
</style>
