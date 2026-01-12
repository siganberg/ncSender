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
  <div class="tree-item-wrapper">
    <!-- Drop indicator line (before) -->
    <div
      v-if="dragOverId === node.id && dragPosition === 'before'"
      class="tree-item__drop-line"
      :style="{ marginLeft: `${depth * 20 + 12}px` }"
    ></div>

    <div
      class="tree-item"
      :class="itemClasses"
      :style="{ paddingLeft: `${depth * 20 + 12}px` }"
      :draggable="!isRenaming"
      @dragstart="onDragStart"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      @dragend="onDragEnd"
      @click="handleClick"
      @dblclick="handleDoubleClick"
    >
      <!-- Folder expand/collapse toggle -->
      <button
        v-if="node.type === 'folder'"
        class="tree-item__toggle"
        :class="{ 'tree-item__toggle--expanded': isExpanded }"
        @click.stop="$emit('toggle', node.id)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
      <span v-else class="tree-item__toggle-spacer"></span>

      <!-- Icon -->
      <span class="tree-item__icon">
        <!-- Folder icon -->
        <svg v-if="node.type === 'folder'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path v-if="isExpanded" d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          <path v-else d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <!-- File icon -->
        <template v-else>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
          </svg>
          <span class="tree-item__badge">NC</span>
        </template>
      </span>

      <!-- Name (editable when renaming) -->
      <input
        v-if="isRenaming"
        ref="renameInput"
        type="text"
        class="tree-item__name-input"
        v-model="editName"
        @blur="finishRename"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
        @keydown.escape="cancelRename"
        @click.stop
      />
      <span v-else class="tree-item__name" :title="node.name">
        {{ node.name }}
      </span>

      <!-- Size column -->
      <span class="tree-item__size">
        <template v-if="node.type === 'file' && !isRenaming">
          {{ formatFileSize(node.size) }}
        </template>
      </span>

      <!-- Date column -->
      <span class="tree-item__date">
        <template v-if="node.type === 'file' && !isRenaming">
          {{ formatDate((node as FileNode).uploadedAt) }}
        </template>
      </span>

      <!-- Actions -->
      <div class="tree-item__actions" v-if="!isRenaming">
        <button
          v-if="node.type === 'file' && !loadingDisabled"
          class="tree-item__load-btn"
          @click.stop="$emit('load', node)"
          :disabled="isLoading"
          title="Load file"
        >
          <span v-if="isLoading" class="tree-item__spinner"></span>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
        <button
          class="tree-item__action-btn"
          @click.stop="startRename"
          title="Rename"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button
          class="tree-item__action-btn tree-item__action-btn--danger"
          @click.stop="$emit('delete', node)"
          title="Delete"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3,6 5,6 21,6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Drop indicator line (after, for files only) -->
    <div
      v-if="dragOverId === node.id && dragPosition === 'after' && node.type === 'file'"
      class="tree-item__drop-line"
      :style="{ marginLeft: `${depth * 20 + 12}px` }"
    ></div>

    <!-- Children (for folders) -->
    <template v-if="node.type === 'folder' && isExpanded">
      <TreeItem
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :expanded-folders="expandedFolders"
        :loading-file="loadingFile"
        :renaming-id="renamingId"
        :drag-over-id="dragOverId"
        :drag-position="dragPosition"
        :loading-disabled="loadingDisabled"
        @toggle="$emit('toggle', $event)"
        @load="$emit('load', $event)"
        @delete="$emit('delete', $event)"
        @rename-start="$emit('rename-start', $event)"
        @rename-end="$emit('rename-end', $event)"
        @drag-start="$emit('drag-start', $event)"
        @drag-over="$emit('drag-over', $event)"
        @drag-leave="$emit('drag-leave')"
        @drop="$emit('drop', $event)"
      />
    </template>

    <!-- Drop indicator line (after folder, when expanded) -->
    <div
      v-if="dragOverId === node.id && dragPosition === 'after' && node.type === 'folder'"
      class="tree-item__drop-line"
      :style="{ marginLeft: `${depth * 20 + 12}px` }"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';

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

const props = defineProps<{
  node: TreeNode;
  depth: number;
  expandedFolders: Set<string>;
  loadingFile: string | null;
  renamingId: string | null;
  dragOverId: string | null;
  dragPosition: 'before' | 'inside' | 'after' | null;
  loadingDisabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle', folderId: string): void;
  (e: 'load', node: FileNode): void;
  (e: 'delete', node: TreeNode): void;
  (e: 'rename-start', node: TreeNode): void;
  (e: 'rename-end', payload: { node: TreeNode; newName: string }): void;
  (e: 'drag-start', node: TreeNode): void;
  (e: 'drag-over', payload: { node: TreeNode; position: 'before' | 'inside' | 'after'; clientY: number }): void;
  (e: 'drag-leave'): void;
  (e: 'drop', payload: { source: TreeNode; target: TreeNode; position: 'before' | 'inside' | 'after' }): void;
}>();

const renameInput = ref<HTMLInputElement | null>(null);
const editName = ref('');
const draggedData = ref<TreeNode | null>(null);

const isExpanded = computed(() => props.expandedFolders.has(props.node.id));
const isLoading = computed(() => props.loadingFile === props.node.path);
const isRenaming = computed(() => props.renamingId === props.node.id);
const isDropTarget = computed(() => props.dragOverId === props.node.id && props.dragPosition === 'inside');

const itemClasses = computed(() => ({
  'tree-item--folder': props.node.type === 'folder',
  'tree-item--file': props.node.type === 'file',
  'tree-item--expanded': isExpanded.value,
  'tree-item--loading': isLoading.value,
  'tree-item--renaming': isRenaming.value,
  'tree-item--drop-target': isDropTarget.value,
}));

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatDate = (isoString: string): string => {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (isYesterday) {
    return 'Yesterday';
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }
};

const handleClick = () => {
  if (props.node.type === 'folder') {
    emit('toggle', props.node.id);
  }
};

const handleDoubleClick = () => {
  if (props.node.type === 'file' && !props.loadingDisabled) {
    emit('load', props.node as FileNode);
  }
};

const startRename = () => {
  editName.value = props.node.name;
  emit('rename-start', props.node);
  nextTick(() => {
    renameInput.value?.focus();
    renameInput.value?.select();
  });
};

const finishRename = () => {
  emit('rename-end', { node: props.node, newName: editName.value });
};

const cancelRename = () => {
  emit('rename-end', { node: props.node, newName: props.node.name });
};

// Drag and drop
const onDragStart = (e: DragEvent) => {
  if (!e.dataTransfer) return;

  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('application/json', JSON.stringify({
    id: props.node.id,
    path: props.node.path,
    name: props.node.name,
    type: props.node.type
  }));

  emit('drag-start', props.node);
};

const onDragOver = (e: DragEvent) => {
  if (!e.dataTransfer) return;

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const y = e.clientY - rect.top;
  const height = rect.height;

  let position: 'before' | 'inside' | 'after';

  if (props.node.type === 'folder') {
    // Folders: top 25% = before, middle 50% = inside, bottom 25% = after
    if (y < height * 0.25) {
      position = 'before';
    } else if (y > height * 0.75) {
      position = 'after';
    } else {
      position = 'inside';
    }
  } else {
    // Files: top 50% = before, bottom 50% = after
    position = y < height / 2 ? 'before' : 'after';
  }

  e.dataTransfer.dropEffect = 'move';
  emit('drag-over', { node: props.node, position, clientY: e.clientY });
};

const onDragLeave = () => {
  emit('drag-leave');
};

const onDrop = (e: DragEvent) => {
  if (!e.dataTransfer) return;

  try {
    const data = JSON.parse(e.dataTransfer.getData('application/json'));
    if (data && data.id && props.dragPosition) {
      emit('drop', {
        source: data as TreeNode,
        target: props.node,
        position: props.dragPosition
      });
    }
  } catch {
    // Invalid drag data
  }
};

const onDragEnd = () => {
  emit('drag-leave');
};

// Focus rename input when entering rename mode
watch(isRenaming, (renaming) => {
  if (renaming) {
    editName.value = props.node.name;
    nextTick(() => {
      renameInput.value?.focus();
      renameInput.value?.select();
    });
  }
});
</script>

<style scoped>
.tree-item-wrapper {
  display: flex;
  flex-direction: column;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  padding-right: 16px;
  cursor: pointer;
  border-radius: var(--radius-medium);
  transition: background-color 0.15s ease;
  user-select: none;
  min-height: 56px;
}

.tree-item:hover {
  background: var(--color-surface-muted);
}

.tree-item--loading {
  opacity: 0.7;
}

.tree-item--drop-target {
  background: rgba(26, 188, 156, 0.15);
  outline: 2px dashed var(--color-accent);
  outline-offset: -2px;
}

.tree-item__toggle {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-secondary);
  padding: 0;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.tree-item__toggle svg {
  width: 16px;
  height: 16px;
}

.tree-item__toggle--expanded {
  transform: rotate(90deg);
}

.tree-item__toggle-spacer {
  width: 24px;
  flex-shrink: 0;
}

.tree-item__icon {
  position: relative;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tree-item__icon svg {
  width: 36px;
  height: 36px;
}

.tree-item--folder .tree-item__icon svg {
  color: #f39c12;
  fill: rgba(243, 156, 18, 0.2);
}

.tree-item--file .tree-item__icon svg {
  color: var(--color-accent);
}

.tree-item__badge {
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

.tree-item__name {
  flex: 1;
  min-width: 0;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-item__name-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  font-size: 0.95rem;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  color: var(--color-text-primary);
  outline: none;
}

.tree-item__size {
  width: 80px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  flex-shrink: 0;
  text-align: right;
  padding-right: 12px;
}

.tree-item__date {
  width: 140px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  flex-shrink: 0;
  text-align: right;
  padding-right: 12px;
}

.tree-item__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.tree-item:hover .tree-item__actions {
  opacity: 1;
}

.tree-item__load-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: var(--gradient-accent);
  color: white;
  border: none;
  border-radius: var(--radius-small);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tree-item__load-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(26, 188, 156, 0.3);
}

.tree-item__load-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.tree-item__load-btn svg {
  width: 18px;
  height: 18px;
}

.tree-item__action-btn {
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

.tree-item__action-btn:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-color: var(--color-border);
}

.tree-item__action-btn--danger:hover {
  background: rgba(231, 76, 60, 0.1);
  color: #e74c3c;
  border-color: rgba(231, 76, 60, 0.3);
}

.tree-item__action-btn svg {
  width: 18px;
  height: 18px;
}

.tree-item__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.tree-item__drop-line {
  height: 2px;
  background: var(--color-accent);
  border-radius: 1px;
  margin: 2px 0;
}
</style>
