<template>
  <Dialog v-if="show" @close="emit('close')" size="medium">
    <div class="file-manager">
      <div class="file-manager__header">
        <div class="file-manager__title-row">
          <svg class="file-manager__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <h2 class="file-manager__title">File Manager</h2>
          <span class="file-manager__count" v-if="uploadedFiles.length > 0">{{ filteredFiles.length }} {{ filteredFiles.length === 1 ? 'file' : 'files' }}</span>
        </div>
        <div class="file-manager__search-row">
          <div class="file-manager__search-wrapper">
            <svg class="file-manager__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              class="file-manager__search"
              v-model="searchQuery"
              placeholder="Search files..."
            >
            <button
              v-if="searchQuery"
              class="file-manager__search-clear"
              @click="searchQuery = ''"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <div class="file-manager__sort">
            <select v-model="sortBy" class="file-manager__sort-select">
              <option value="date">Recent</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
            </select>
          </div>
        </div>
      </div>

      <div class="file-manager__content">
        <div v-if="uploadedFiles.length === 0" class="file-manager__empty">
          <svg class="file-manager__empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
          <p class="file-manager__empty-title">No files uploaded yet</p>
          <p class="file-manager__empty-hint">Upload a G-code file to get started</p>
        </div>

        <div v-else-if="filteredFiles.length === 0" class="file-manager__empty">
          <svg class="file-manager__empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <p class="file-manager__empty-title">No files found</p>
          <p class="file-manager__empty-hint">Try a different search term</p>
        </div>

        <div v-else class="file-list">
          <div
            v-for="file in filteredFiles"
            :key="file.name"
            class="file-item"
            :class="{ 'file-item--active': loadingFile === file.name }"
            @dblclick="loadFileFromManager(file.name)"
            @touchstart="handleFileTouchStart($event, file.name)"
          >
            <div class="file-item__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
              </svg>
              <span class="file-item__badge">NC</span>
            </div>
            <div class="file-item__info">
              <div class="file-item__name" :title="file.name">{{ file.name }}</div>
              <div class="file-item__meta">
                <span class="file-item__size">{{ formatFileSize(file.size) }}</span>
                <span class="file-item__separator">•</span>
                <span class="file-item__date">{{ formatDate(file.uploadedAt) }}</span>
              </div>
            </div>
            <div class="file-item__actions">
              <button
                class="file-item__load-btn"
                @click.stop="loadFileFromManager(file.name)"
                :disabled="loadingFile === file.name"
                title="Load file"
              >
                <svg v-if="loadingFile !== file.name" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
                <span v-else class="file-item__spinner"></span>
                Load
              </button>
              <button
                class="file-item__delete-btn"
                @click.stop="deleteFile(file.name)"
                title="Delete file"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3,6 5,6 21,6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
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
import { ref, watch, computed } from 'vue';
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
const searchQuery = ref('');
const sortBy = ref<'date' | 'name' | 'size'>('date');
const loadingFile = ref<string | null>(null);

let lastTapTime = 0;
let lastTapFile = '';

const filteredFiles = computed(() => {
  let result = [...uploadedFiles.value];

  // Filter by search
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase().trim();
    result = result.filter(file => file.name.toLowerCase().includes(query));
  }

  // Sort
  result.sort((a, b) => {
    switch (sortBy.value) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'size':
        return b.size - a.size;
      case 'date':
      default:
        return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    }
  });

  return result;
});

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
    loadingFile.value = filename;
    await api.loadGCodeFile(filename);
    emit('close');
  } catch (error) {
    console.error('Error loading file:', error);
  } finally {
    loadingFile.value = null;
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
    searchQuery.value = '';
    await fetchUploadedFiles();
  }
});
</script>

<style scoped>
.file-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.file-manager__header {
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}

.file-manager__title-row {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.file-manager__icon {
  width: 28px;
  height: 28px;
  color: var(--color-accent);
}

.file-manager__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.file-manager__count {
  margin-left: auto;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  background: var(--color-surface-muted);
  padding: 4px 10px;
  border-radius: 12px;
}

.file-manager__search-row {
  display: flex;
  gap: var(--gap-sm);
}

.file-manager__search-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.file-manager__search-icon {
  position: absolute;
  left: 12px;
  width: 18px;
  height: 18px;
  color: var(--color-text-secondary);
  pointer-events: none;
}

.file-manager__search {
  width: 100%;
  padding: 10px 36px 10px 40px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.file-manager__search:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
}

.file-manager__search::placeholder {
  color: var(--color-text-secondary);
}

.file-manager__search-clear {
  position: absolute;
  right: 8px;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.2s ease;
}

.file-manager__search-clear:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.file-manager__search-clear svg {
  width: 14px;
  height: 14px;
}

.file-manager__sort-select {
  padding: 10px 12px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  min-width: 100px;
}

.file-manager__sort-select:focus {
  outline: none;
  border-color: var(--color-accent);
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
  min-height: 250px;
  color: var(--color-text-secondary);
}

.file-manager__empty-icon {
  width: 64px;
  height: 64px;
  margin-bottom: var(--gap-md);
  opacity: 0.4;
}

.file-manager__empty-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
  color: var(--color-text-primary);
}

.file-manager__empty-hint {
  margin: var(--gap-xs) 0 0 0;
  font-size: 0.875rem;
  opacity: 0.7;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: var(--gap-md);
  padding: 12px 16px;
  background: var(--color-surface-muted);
  border: 1px solid transparent;
  border-radius: var(--radius-medium);
  transition: all 0.2s ease;
  cursor: pointer;
}

.file-item:hover {
  background: var(--color-surface);
  border-color: var(--color-border);
}

.file-item--active {
  border-color: var(--color-accent);
  background: rgba(26, 188, 156, 0.05);
}

.file-item__icon {
  position: relative;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.file-item__icon svg {
  width: 36px;
  height: 36px;
  color: var(--color-accent);
}

.file-item__badge {
  position: absolute;
  bottom: 0;
  right: -2px;
  font-size: 9px;
  font-weight: 700;
  background: var(--color-accent);
  color: white;
  padding: 1px 4px;
  border-radius: 3px;
  letter-spacing: 0.5px;
}

.file-item__info {
  flex: 1;
  min-width: 0;
}

.file-item__name {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-item__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-top: 4px;
}

.file-item__separator {
  opacity: 0.5;
}

.file-item__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.file-item__load-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: var(--radius-small);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-item__load-btn:hover:not(:disabled) {
  background: var(--color-accent-hover, #16a085);
  transform: translateY(-1px);
}

.file-item__load-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.file-item__load-btn svg {
  width: 16px;
  height: 16px;
}

.file-item__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.file-item__delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: transparent;
  color: var(--color-text-secondary);
  border: 1px solid transparent;
  border-radius: var(--radius-small);
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-item__delete-btn:hover {
  background: rgba(231, 76, 60, 0.1);
  color: #e74c3c;
  border-color: rgba(231, 76, 60, 0.3);
}

.file-item__delete-btn svg {
  width: 18px;
  height: 18px;
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
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}
</style>
