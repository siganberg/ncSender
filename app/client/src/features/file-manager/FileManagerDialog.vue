<template>
  <Dialog v-if="show" @close="emit('close')" size="medium">
    <div class="file-manager">
      <div class="file-manager__header">
        <div class="file-manager__title-row">
          <svg class="file-manager__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <h2 class="file-manager__title">
            File Manager
            <span class="file-manager__title-count">
              ({{ fileCount }} {{ fileCount === 1 ? 'file' : 'files' }})
            </span>
          </h2>
        </div>
        <div class="file-manager__toolbar">
          <button class="file-manager__new-folder-btn" @click="createNewFolder" title="New Folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              <line x1="12" y1="11" x2="12" y2="17"/>
              <line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
            New Folder
          </button>
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
        </div>
      </div>

      <!-- Filter indicator -->
      <div v-if="searchQuery && filteredTree.length > 0" class="file-manager__filter-indicator">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
        </svg>
        <span>Showing {{ filteredFileCount }} of {{ fileCount }} files</span>
        <button @click="searchQuery = ''" class="file-manager__filter-clear">
          Clear filter
        </button>
      </div>

      <div
        class="file-manager__content"
        @dragover.prevent="handleRootDragOver"
        @dragleave="handleRootDragLeave"
        @drop.prevent="handleRootDrop"
        :class="{ 'file-manager__content--drop-target': isRootDropTarget }"
      >
        <div v-if="tree.length === 0 && !searchQuery" class="file-manager__empty">
          <svg class="file-manager__empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="12" y1="18" x2="12" y2="12"/>
            <line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
          <p class="file-manager__empty-title">No files uploaded yet</p>
          <p class="file-manager__empty-hint">Upload a G-code file to get started</p>
        </div>

        <div v-else-if="filteredTree.length === 0 && searchQuery" class="file-manager__empty">
          <svg class="file-manager__empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <p class="file-manager__empty-title">No files found</p>
          <p class="file-manager__empty-hint">Try a different search term</p>
        </div>

        <div v-else class="file-tree">
          <template v-for="node in filteredTree" :key="node.id">
            <TreeItem
              :node="node"
              :depth="0"
              :expanded-folders="expandedFolders"
              :loading-file="loadingFile"
              :renaming-id="renamingId"
              :drag-over-id="dragOverId"
              :drag-position="dragPosition"
              @toggle="toggleFolder"
              @load="loadFile"
              @delete="confirmDeleteItem"
              @rename-start="startRename"
              @rename-end="finishRename"
              @drag-start="handleDragStart"
              @drag-over="handleDragOver"
              @drag-leave="handleDragLeave"
              @drop="handleDrop"
            />
          </template>
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
      :title="deleteTarget?.type === 'folder' ? 'Delete Folder' : 'Delete File'"
      :message="deleteConfirmMessage"
      cancel-text="Cancel"
      confirm-text="Delete"
      variant="danger"
      @cancel="cancelDelete"
      @confirm="executeDelete"
    />
  </Dialog>

  <!-- New Folder Dialog -->
  <Dialog v-if="showNewFolderDialog" @close="cancelNewFolder" :show-header="false" size="small" :z-index="10000">
    <div class="new-folder-dialog">
      <h3 class="new-folder-dialog__title">New Folder</h3>
      <input
        ref="newFolderInput"
        type="text"
        class="new-folder-dialog__input"
        v-model="newFolderName"
        placeholder="Folder name"
        @keydown.enter="submitNewFolder"
        @keydown.escape="cancelNewFolder"
      >
      <div class="new-folder-dialog__actions">
        <button class="new-folder-dialog__cancel" @click="cancelNewFolder">Cancel</button>
        <button class="new-folder-dialog__submit" @click="submitNewFolder" :disabled="!newFolderName.trim()">Create</button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { api } from '../toolpath/api';
import Dialog from '../../components/Dialog.vue';
import ConfirmPanel from '../../components/ConfirmPanel.vue';
import TreeItem from './components/TreeItem.vue';

interface FileNode {
  id: string;
  name: string;
  type: 'file';
  path: string;
  size: number;
  uploadedAt: string;
}

interface FolderNode {
  id: string;
  name: string;
  type: 'folder';
  path: string;
  children: TreeNode[];
}

type TreeNode = FileNode | FolderNode;

interface Props {
  show: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const tree = ref<TreeNode[]>([]);
const manuallyExpandedFolders = ref(new Set<string>());
const searchExpandedFolders = ref(new Set<string>());
const searchQuery = ref('');
const loadingFile = ref<string | null>(null);
const renamingId = ref<string | null>(null);

// Combined expanded folders: manual + search-based
const expandedFolders = computed(() => {
  const combined = new Set(manuallyExpandedFolders.value);
  if (searchQuery.value) {
    searchExpandedFolders.value.forEach(id => combined.add(id));
  }
  return combined;
});

// Delete state
const showDeleteConfirm = ref(false);
const deleteTarget = ref<TreeNode | null>(null);

// New folder state
const showNewFolderDialog = ref(false);
const newFolderName = ref('');
const newFolderParentPath = ref('');
const newFolderInput = ref<HTMLInputElement | null>(null);

// Drag state
const draggedNode = ref<TreeNode | null>(null);
const dragOverId = ref<string | null>(null);
const dragPosition = ref<'before' | 'inside' | 'after' | null>(null);
const isRootDropTarget = ref(false);

const fileCount = computed(() => {
  const countFiles = (nodes: TreeNode[]): number => {
    return nodes.reduce((count, node) => {
      if (node.type === 'file') return count + 1;
      return count + countFiles(node.children);
    }, 0);
  };
  return countFiles(tree.value);
});

const filteredFileCount = computed(() => {
  const countFiles = (nodes: TreeNode[]): number => {
    return nodes.reduce((count, node) => {
      if (node.type === 'file') return count + 1;
      return count + countFiles(node.children);
    }, 0);
  };
  return countFiles(filteredTree.value);
});

const filteredTree = computed(() => {
  if (!searchQuery.value) {
    searchExpandedFolders.value.clear();
    return tree.value;
  }

  const query = searchQuery.value.toLowerCase().trim();
  const autoExpand = new Set<string>();

  const filterNodes = (nodes: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];

    for (const node of nodes) {
      if (node.type === 'file') {
        if (node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)) {
          result.push(node);
        }
      } else {
        const filteredChildren = filterNodes(node.children);
        if (filteredChildren.length > 0 || node.name.toLowerCase().includes(query)) {
          result.push({
            ...node,
            children: filteredChildren
          });
          // Track folders to auto-expand for search results
          if (filteredChildren.length > 0) {
            autoExpand.add(node.id);
          }
        }
      }
    }

    return result;
  };

  const result = filterNodes(tree.value);
  searchExpandedFolders.value = autoExpand;
  return result;
});

const deleteConfirmMessage = computed(() => {
  if (!deleteTarget.value) return '';
  if (deleteTarget.value.type === 'folder') {
    return `Are you sure you want to delete the folder "${deleteTarget.value.name}" and all its contents?`;
  }
  return `Are you sure you want to delete "${deleteTarget.value.name}"?`;
});

const toggleFolder = (folderId: string) => {
  if (manuallyExpandedFolders.value.has(folderId)) {
    manuallyExpandedFolders.value.delete(folderId);
  } else {
    manuallyExpandedFolders.value.add(folderId);
  }
};

const loadFile = async (node: FileNode) => {
  try {
    loadingFile.value = node.path;
    await api.loadGCodeFile(node.path);
    emit('close');
  } catch (error) {
    console.error('Error loading file:', error);
  } finally {
    loadingFile.value = null;
  }
};

const confirmDeleteItem = (node: TreeNode) => {
  deleteTarget.value = node;
  showDeleteConfirm.value = true;
};

const cancelDelete = () => {
  showDeleteConfirm.value = false;
  deleteTarget.value = null;
};

const executeDelete = async () => {
  if (!deleteTarget.value) return;

  try {
    if (deleteTarget.value.type === 'folder') {
      await api.deleteFolder(deleteTarget.value.path);
    } else {
      await api.deleteGCodeFile(deleteTarget.value.path);
    }
    await fetchTree();
  } catch (error) {
    console.error('Error deleting item:', error);
  } finally {
    showDeleteConfirm.value = false;
    deleteTarget.value = null;
  }
};

const createNewFolder = () => {
  newFolderName.value = '';
  newFolderParentPath.value = '';
  showNewFolderDialog.value = true;
  nextTick(() => {
    newFolderInput.value?.focus();
  });
};

const cancelNewFolder = () => {
  showNewFolderDialog.value = false;
  newFolderName.value = '';
};

const submitNewFolder = async () => {
  const name = newFolderName.value.trim();
  if (!name) return;

  try {
    const folderPath = newFolderParentPath.value
      ? `${newFolderParentPath.value}/${name}`
      : name;
    await api.createFolder(folderPath);
    await fetchTree();
    showNewFolderDialog.value = false;
    newFolderName.value = '';
  } catch (error) {
    console.error('Error creating folder:', error);
  }
};

const startRename = (node: TreeNode) => {
  renamingId.value = node.id;
};

const finishRename = async (node: TreeNode, newName: string) => {
  renamingId.value = null;

  if (!newName.trim() || newName === node.name) return;

  try {
    await api.renameItem(node.path, newName.trim());
    await fetchTree();
  } catch (error) {
    console.error('Error renaming item:', error);
  }
};

// Drag and drop handlers
const handleDragStart = (node: TreeNode) => {
  draggedNode.value = node;
};

const handleDragOver = (event: { node: TreeNode; position: 'before' | 'inside' | 'after'; clientY: number }) => {
  if (!draggedNode.value) return;
  if (draggedNode.value.id === event.node.id) return;

  // Prevent dropping folder into itself or its children
  if (draggedNode.value.type === 'folder' && event.node.path.startsWith(draggedNode.value.path + '/')) {
    return;
  }

  dragOverId.value = event.node.id;
  dragPosition.value = event.position;
  isRootDropTarget.value = false;
};

const handleDragLeave = () => {
  dragOverId.value = null;
  dragPosition.value = null;
};

const handleRootDragOver = (e: DragEvent) => {
  if (!draggedNode.value) return;

  // Only show root drop if not over any item
  const target = e.target as HTMLElement;
  if (target.closest('.tree-item')) return;

  isRootDropTarget.value = true;
  dragOverId.value = null;
  dragPosition.value = null;
};

const handleRootDragLeave = () => {
  isRootDropTarget.value = false;
};

const handleRootDrop = async () => {
  if (!draggedNode.value || !isRootDropTarget.value) return;

  // Move to root
  const sourcePath = draggedNode.value.path;
  const destPath = draggedNode.value.name;

  if (sourcePath !== destPath) {
    try {
      await api.moveItem(sourcePath, destPath);
      await fetchTree();
    } catch (error) {
      console.error('Error moving item:', error);
    }
  }

  draggedNode.value = null;
  isRootDropTarget.value = false;
};

const handleDrop = async (event: { source: TreeNode; target: TreeNode; position: 'before' | 'inside' | 'after' }) => {
  const { source, target, position } = event;

  let destinationPath: string;

  if (position === 'inside' && target.type === 'folder') {
    // Drop into folder
    destinationPath = `${target.path}/${source.name}`;
  } else {
    // Drop before/after - use target's parent folder
    const parentPath = target.path.includes('/')
      ? target.path.substring(0, target.path.lastIndexOf('/'))
      : '';
    destinationPath = parentPath ? `${parentPath}/${source.name}` : source.name;
  }

  if (source.path !== destinationPath) {
    try {
      await api.moveItem(source.path, destinationPath);
      await fetchTree();
    } catch (error) {
      console.error('Error moving item:', error);
    }
  }

  draggedNode.value = null;
  dragOverId.value = null;
  dragPosition.value = null;
};

const fetchTree = async () => {
  try {
    const data = await api.listGCodeFiles();
    tree.value = data.tree || [];
  } catch (error) {
    console.error('Error fetching files:', error);
    tree.value = [];
  }
};

watch(() => props.show, async (isOpen) => {
  if (isOpen) {
    searchQuery.value = '';
    await fetchTree();
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

.file-manager__title-count {
  font-weight: 400;
  font-size: 1rem;
  color: var(--color-text-secondary);
}

.file-manager__toolbar {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
}

.file-manager__new-folder-btn {
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

.file-manager__new-folder-btn:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.file-manager__new-folder-btn svg {
  width: 18px;
  height: 18px;
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

.file-manager__filter-indicator {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  padding: 10px var(--gap-md);
  background: rgba(26, 188, 156, 0.1);
  border-bottom: 1px solid rgba(26, 188, 156, 0.2);
  color: var(--color-accent);
  font-size: 0.85rem;
}

.file-manager__filter-indicator svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.file-manager__filter-indicator span {
  flex: 1;
}

.file-manager__filter-clear {
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-small);
  color: var(--color-accent);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-manager__filter-clear:hover {
  background: var(--color-accent);
  color: white;
}

.file-manager__content {
  flex: 1;
  overflow-y: auto;
  padding: var(--gap-sm);
  transition: background-color 0.2s ease;
}

.file-manager__content--drop-target {
  background: rgba(26, 188, 156, 0.05);
  outline: 2px dashed var(--color-accent);
  outline-offset: -4px;
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

.file-tree {
  display: flex;
  flex-direction: column;
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

/* New Folder Dialog */
.new-folder-dialog {
  padding: var(--gap-lg);
}

.new-folder-dialog__title {
  margin: 0 0 var(--gap-md) 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.new-folder-dialog__input {
  width: 100%;
  padding: 12px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.95rem;
  margin-bottom: var(--gap-md);
}

.new-folder-dialog__input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.new-folder-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-sm);
}

.new-folder-dialog__cancel,
.new-folder-dialog__submit {
  padding: 10px 20px;
  border-radius: var(--radius-small);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.new-folder-dialog__cancel {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
}

.new-folder-dialog__cancel:hover {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

.new-folder-dialog__submit {
  background: var(--color-accent);
  border: none;
  color: white;
}

.new-folder-dialog__submit:hover:not(:disabled) {
  background: var(--color-accent-hover, #16a085);
}

.new-folder-dialog__submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
