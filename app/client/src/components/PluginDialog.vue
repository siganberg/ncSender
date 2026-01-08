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
  <div v-if="show" class="plugin-dialog-backdrop" @click.self="handleBackdropClick">
    <div class="plugin-dialog-container">
      <div class="plugin-dialog">
        <div class="plugin-dialog-header">
          <h3>{{ dialogData.title }}</h3>
          <button v-if="isClosable" class="close-button" type="button" @click="closeDialog" aria-label="Close dialog">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/>
            </svg>
          </button>
        </div>
        <div
          class="plugin-dialog-content"
          ref="dialogContent"
          v-html="dialogData.content"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { api } from '@/lib/api';

interface PluginDialogData {
  pluginId: string;
  dialogId?: string;
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
const dialogContent = ref<HTMLDivElement | null>(null);

let unsubscribe: (() => void) | null = null;

const isClosable = computed(() => {
  return dialogData.value.options.closable !== false;
});

const handlePluginDialog = async (data: PluginDialogData) => {
  dialogData.value = data;
  show.value = true;

  // Send initial server state to plugin
  try {
    const currentState = await api.getServerState();
    window.postMessage({
      type: 'server-state-update',
      state: currentState
    }, '*');
  } catch (error) {
    console.warn('Failed to get initial server state for plugin:', error);
  }

  // Execute scripts after DOM is updated
  nextTick(() => {
    executeScripts();
  });
};

const executeScripts = () => {
  const contentEl = dialogContent.value;
  if (!contentEl) return;

  // Find all script tags in the content
  const scripts = contentEl.querySelectorAll('script');
  scripts.forEach((oldScript) => {
    const newScript = document.createElement('script');

    // Copy attributes
    Array.from(oldScript.attributes).forEach((attr) => {
      newScript.setAttribute(attr.name, attr.value);
    });

    // Copy script content
    newScript.textContent = oldScript.textContent;

    // Replace old script with new one to trigger execution
    oldScript.parentNode?.replaceChild(newScript, oldScript);
  });
};

const closeDialog = (response: any = null) => {
  // Send response back to server if dialogId exists
  if (dialogData.value.dialogId) {
    api.sendWebSocketMessage('plugin-dialog-response', {
      dialogId: dialogData.value.dialogId,
      response
    });
  }
  show.value = false;
};

const handleBackdropClick = () => {
  if (isClosable.value) {
    closeDialog();
  }
};

const handlePostMessage = (event: MessageEvent) => {
  if (!event.data || !event.data.type) return;

  // Handle close dialog message
  if (event.data.type === 'close-plugin-dialog') {
    closeDialog(event.data.data);
    return;
  }

  // Forward plugin-specific messages to the backend
  if (dialogData.value.pluginId && event.data.type === 'plugin-message') {
    // Extract the inner data object and forward that to the plugin via WebSocket
    api.sendWebSocketMessage(`plugin:${dialogData.value.pluginId}:message`, event.data.data);
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && show.value && isClosable.value) {
    closeDialog();
  }
};

let serverStateUnsubscribe: (() => void) | null = null;
let cncDataUnsubscribe: (() => void) | null = null;

const forwardServerState = (state: any) => {
  if (!show.value) return;

  // Forward server state updates to plugin dialog via postMessage
  window.postMessage({
    type: 'server-state-update',
    state: state
  }, '*');
};

const forwardCNCData = (data: any) => {
  if (!show.value) return;

  // Forward cnc-data to plugin dialog via postMessage
  window.postMessage({
    type: 'cnc-data',
    data: data
  }, '*');
};

onMounted(() => {
  // Listen for plugin:show-dialog events from WebSocket
  unsubscribe = api.on('plugin:show-dialog', handlePluginDialog);

  // Subscribe to server state updates and forward to plugin
  serverStateUnsubscribe = api.onServerStateUpdated(forwardServerState);

  // Subscribe to cnc-data events and forward to plugin
  cncDataUnsubscribe = api.on('cnc-data', forwardCNCData);

  // Listen for postMessage events from dialog iframe
  window.addEventListener('message', handlePostMessage);
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  if (unsubscribe) {
    unsubscribe();
  }
  if (serverStateUnsubscribe) {
    serverStateUnsubscribe();
  }
  if (cncDataUnsubscribe) {
    cncDataUnsubscribe();
  }
  window.removeEventListener('message', handlePostMessage);
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.plugin-dialog-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.plugin-dialog-container {
  background: var(--color-surface);
  border-radius: 16px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1);
  width: auto;
  min-width: 320px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.plugin-dialog {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.plugin-dialog-header {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
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
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
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
