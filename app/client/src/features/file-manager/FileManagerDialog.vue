<template>
  <Dialog v-if="show" @close="emit('close')" size="medium">
    <div class="file-manager">
      <div class="file-manager__header">
        <svg width="32" height="32"><use href="#emoji-folder"></use></svg>
        <h2 class="file-manager__title">File Manager</h2>
      </div>
      <div class="file-manager__content">
        <div v-if="uploadedFiles.length === 0" class="file-manager__empty">
          <svg width="64" height="64"><use href="#emoji-upload"></use></svg>
          <p>No files uploaded yet</p>
          <p class="file-manager__empty-hint">Upload a G-code file to get started</p>
        </div>
        <div v-else class="file-list">
          <div
            v-for="file in uploadedFiles"
            :key="file.name"
            class="file-item"
            @dblclick="loadFileFromManager(file.name)"
            @touchstart="handleFileTouchStart($event, file.name)"
          >
            <div class="file-item__icon">
              <svg width="40" height="40"><use href="#emoji-package"></use></svg>
            </div>
            <div class="file-item__info">
              <div class="file-item__name">{{ file.name }}</div>
              <div class="file-item__meta">{{ formatFileSize(file.size) }} • {{ formatDate(file.uploadedAt) }}</div>
            </div>
            <div class="file-item__actions">
              <svg width="50" height="50" @click.stop="loadFileFromManager(file.name)" class="file-item__load-btn" title="Load file"><use href="#emoji-upload"></use></svg>
              <svg width="45" height="45" @click.stop="deleteFile(file.name)" class="file-item__delete-btn" title="Delete file"><use href="#emoji-trash"></use></svg>
            </div>
          </div>
        </div>
      </div>
      <div class="file-manager__footer">
        <button @click="emit('close')" class="file-manager__close-btn">Close</button>
      </div>
    </div>
  </Dialog>

  <!-- Delete Confirmation Dialog -->
  <Dialog v-if="showDeleteConfirm" @close="cancelDelete" :show-header="false" size="small" :z-index="10000">
    <ConfirmPanel
      title="Delete File"
      :message="'Are you sure you want to delete ' + fileToDelete + '?'"
      cancel-text="Cancel"
      confirm-text="Delete"
      variant="danger"
      @cancel="cancelDelete"
      @confirm="confirmDelete"
    />
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '../toolpath/api';
import Dialog from '../../components/Dialog.vue';
import ConfirmPanel from '../../components/ConfirmPanel.vue';

interface Props {
  show: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const uploadedFiles = ref<Array<{ name: string; size: number; uploadedAt: string }>>([]);
const showDeleteConfirm = ref(false);
const fileToDelete = ref<string | null>(null);

let lastTapTime = 0;
let lastTapFile = '';

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;

  return date.toLocaleDateString();
};

const loadFileFromManager = async (filename: string) => {
  try {
    await api.loadGCodeFile(filename);
    emit('close');
  } catch (error) {
    console.error('Error loading file:', error);
  }
};

const deleteFile = (filename: string) => {
  fileToDelete.value = filename;
  showDeleteConfirm.value = true;
};

const handleFileTouchStart = (event: TouchEvent, filename: string) => {
  const currentTime = Date.now();
  const tapDelay = 300;

  if (currentTime - lastTapTime < tapDelay && lastTapFile === filename) {
    event.preventDefault();
    loadFileFromManager(filename);
    lastTapTime = 0;
    lastTapFile = '';
  } else {
    lastTapTime = currentTime;
    lastTapFile = filename;
  }
};

const confirmDelete = async () => {
  if (!fileToDelete.value) return;

  try {
    await api.deleteGCodeFile(fileToDelete.value);
    await fetchUploadedFiles();
    showDeleteConfirm.value = false;
    fileToDelete.value = null;
  } catch (error) {
    console.error('Error deleting file:', error);
    showDeleteConfirm.value = false;
    fileToDelete.value = null;
  }
};

const cancelDelete = () => {
  showDeleteConfirm.value = false;
  fileToDelete.value = null;
};

const fetchUploadedFiles = async () => {
  try {
    const data = await api.listGCodeFiles();
    uploadedFiles.value = data.files || [];
  } catch (error) {
    console.error('Error fetching uploaded files:', error);
    uploadedFiles.value = [];
  }
};

watch(() => props.show, async (isOpen) => {
  if (isOpen) {
    await fetchUploadedFiles();
  }
});
</script>

<style scoped>
.file-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 500px;
  overflow: hidden;
  border-radius: 16px;
}

.file-manager__header {
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.file-manager__icon {
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, var(--color-accent), rgba(26, 188, 156, 0.7));
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.file-manager__title {
  margin: 0;
  font-size: 1.5rem;
  color: var(--color-text-primary);
}

.file-manager__content {
  flex: 1;
  overflow-y: auto;
  padding: var(--gap-md);
}

.file-manager__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  color: var(--color-text-secondary);
}

.file-manager__empty svg {
  margin-bottom: var(--gap-md);
  opacity: 0.5;
}

.file-manager__empty p {
  margin: 0;
  font-size: 1rem;
}

.file-manager__empty-hint {
  font-size: 0.875rem;
  opacity: 0.7;
  margin-top: var(--gap-xs) !important;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  padding: var(--gap-sm) var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  transition: all 0.2s ease;
  cursor: pointer;
}

.file-item:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.file-item__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  font-size: 32px;
}

.file-item__info {
  flex: 1;
  min-width: 0;
}

.file-item__name {
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-item__meta {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin-top: 4px;
}

.file-item__actions {
  display: flex;
  gap: var(--gap-xs);
  flex-shrink: 0;
}

.file-item__load-btn {
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-item__load-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.1);
}

.file-item__delete-btn {
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-item__delete-btn:hover {
  transform: translateY(-1px);
  filter: brightness(1.1);
}

.file-manager__footer {
  padding: var(--gap-md);
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: center;
  background: var(--color-surface);
}

.file-manager__close-btn {
  padding: 10px 32px;
  background: var(--gradient-accent);
  color: white;
  border: none;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-manager__close-btn:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
  transform: translateY(-1px);
}
</style>
