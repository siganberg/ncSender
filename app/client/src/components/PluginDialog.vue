<template>
  <Dialog v-if="show" @close="closeDialog" :show-header="false" size="medium">
    <div class="plugin-dialog">
      <div class="plugin-dialog-header">
        <h3>{{ dialogData.title }}</h3>
        <button class="close-button" @click="closeDialog">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
          </svg>
        </button>
      </div>
      <div class="plugin-dialog-content" v-html="dialogData.content"></div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import Dialog from './Dialog.vue';
import { api } from '@/lib/api';

interface PluginDialogData {
  pluginId: string;
  title: string;
  content: string;
  options: Record<string, any>;
}

const show = ref(false);
const dialogData = ref<PluginDialogData>({
  pluginId: '',
  title: '',
  content: '',
  options: {}
});

let unsubscribe: (() => void) | null = null;

const handlePluginDialog = (data: PluginDialogData) => {
  dialogData.value = data;
  show.value = true;
};

const closeDialog = () => {
  show.value = false;
};

const handlePostMessage = (event: MessageEvent) => {
  if (!event.data || !event.data.type) return;

  // Handle close dialog message
  if (event.data.type === 'close-plugin-dialog') {
    closeDialog();
    return;
  }

  // Forward plugin-specific messages to the backend
  if (dialogData.value.pluginId && event.data.type) {
    api.emit(`plugin:${dialogData.value.pluginId}:message`, event.data);
  }
};

onMounted(() => {
  // Listen for plugin:show-dialog events from WebSocket
  unsubscribe = api.on('plugin:show-dialog', handlePluginDialog);

  // Listen for postMessage events from dialog iframe
  window.addEventListener('message', handlePostMessage);
});

onBeforeUnmount(() => {
  if (unsubscribe) {
    unsubscribe();
  }
  window.removeEventListener('message', handlePostMessage);
});
</script>

<style scoped>
.plugin-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}

.plugin-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
}

.plugin-dialog-header h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.close-button {
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-small);
  transition: all 0.2s ease;
}

.close-button:hover {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

.plugin-dialog-content {
  padding: var(--gap-md);
  color: var(--color-text-primary);
}

.plugin-dialog-content :deep(h1),
.plugin-dialog-content :deep(h2),
.plugin-dialog-content :deep(h3),
.plugin-dialog-content :deep(h4),
.plugin-dialog-content :deep(h5),
.plugin-dialog-content :deep(h6) {
  margin-top: 0;
  color: var(--color-text-primary);
}

.plugin-dialog-content :deep(p) {
  margin: var(--gap-sm) 0;
  line-height: 1.5;
}

.plugin-dialog-content :deep(pre) {
  background: var(--color-surface-muted);
  padding: var(--gap-sm);
  border-radius: var(--radius-small);
  overflow-x: auto;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
}

.plugin-dialog-content :deep(button) {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: var(--gap-sm) var(--gap-md);
  border-radius: var(--radius-small);
  cursor: pointer;
  font-weight: 500;
  transition: opacity 0.2s ease;
}

.plugin-dialog-content :deep(button:hover) {
  opacity: 0.9;
}
</style>
