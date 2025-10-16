<template>
  <div class="plugins-tab">
    <div v-if="loadError" class="error">
      {{ loadError }}
    </div>

    <div class="plugins-content">
      <div class="plugins-header">
        <div class="header-info">
          <h3>Installed Plugins</h3>
          <span class="plugin-count">{{ plugins.length }} plugin{{ plugins.length !== 1 ? 's' : '' }}</span>
        </div>
        <button class="btn btn-primary" @click="showInstallDialog = true">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/>
          </svg>
          Install Plugin
        </button>
      </div>

      <div v-if="plugins.length === 0 && !loading" class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
          <path d="M6 10.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5m-2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5"/>
        </svg>
        <p>No plugins installed</p>
        <p class="empty-hint">Install a plugin to extend ncSender functionality</p>
      </div>

      <div v-else class="plugins-list">
        <div v-for="plugin in plugins" :key="plugin.id" class="plugin-card">
          <div class="plugin-header">
            <div class="plugin-info">
              <h4 class="plugin-name">{{ plugin.name }}</h4>
              <span class="plugin-version">v{{ plugin.version }}</span>
              <span v-if="plugin.loaded" class="plugin-status plugin-status--loaded">Loaded</span>
              <span v-else class="plugin-status plugin-status--unloaded">Not Loaded</span>
            </div>
            <div class="plugin-actions">
              <button
                v-if="plugin.loaded"
                class="btn-icon"
                @click="reloadPlugin(plugin.id)"
                title="Reload"
                :disabled="reloading === plugin.id"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
                  <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
                </svg>
              </button>
              <button
                class="btn-icon"
                @click="togglePlugin(plugin)"
                :title="plugin.enabled ? 'Disable' : 'Enable'"
                :disabled="toggling === plugin.id"
              >
                <svg v-if="plugin.enabled" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M8 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4m.256 7a4.5 4.5 0 0 1-.229-1.004H3c.001-.246.154-.986.832-1.664C4.484 10.68 5.711 10 8 10q.39 0 .74.025c.226-.341.496-.65.804-.918Q8.844 9.002 8 9c-5 0-6 3-6 4s1 1 1 1z"/>
                  <path d="M16 12.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0m-1.993-1.679a.5.5 0 0 0-.686.172l-1.17 1.95-.547-.547a.5.5 0 0 0-.708.708l.774.773a.75.75 0 0 0 1.174-.144l1.335-2.226a.5.5 0 0 0-.172-.686"/>
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path d="m13.498.795.149-.149a1.207 1.207 0 1 1 1.707 1.708l-.149.148a1.5 1.5 0 0 1-.059 2.059L4.854 14.854a.5.5 0 0 1-.233.131l-4 1a.5.5 0 0 1-.606-.606l1-4a.5.5 0 0 1 .131-.232l9.642-9.642a.5.5 0 0 0-.642.056L6.854 4.854a.5.5 0 1 1-.708-.708L9.44.854A1.5 1.5 0 0 1 11.5.796a1.5 1.5 0 0 1 1.998-.001m-.644.766a.5.5 0 0 0-.707 0L1.95 11.756l-.764 3.057 3.057-.764L14.44 3.854a.5.5 0 0 0 0-.708z"/>
                </svg>
              </button>
              <button
                class="btn-icon btn-icon-danger"
                @click="confirmUninstall(plugin)"
                title="Uninstall"
                :disabled="uninstalling === plugin.id"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                  <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
                </svg>
              </button>
            </div>
          </div>

          <p v-if="plugin.author" class="plugin-author">by {{ plugin.author }}</p>

          <div class="plugin-meta">
            <span v-if="plugin.loadedAt" class="meta-item">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/>
                <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/>
              </svg>
              Loaded {{ formatTime(plugin.loadedAt) }}
            </span>
            <span v-if="plugin.installedAt" class="meta-item">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                <path d="M12.643 15C13.979 15 15 13.845 15 12.5V5H1v7.5C1 13.845 2.021 15 3.357 15zM5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1M.8 1a.8.8 0 0 0-.8.8V3a.8.8 0 0 0 .8.8h14.4A.8.8 0 0 0 16 3V1.8a.8.8 0 0 0-.8-.8z"/>
              </svg>
              Installed {{ formatTime(plugin.installedAt) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Uninstall Confirmation Dialog -->
  <Dialog v-if="showUninstallConfirm && selectedPlugin" @close="showUninstallConfirm = false" :show-header="false" size="small">
    <ConfirmPanel
      :title="`Uninstall ${selectedPlugin.name}?`"
      message="This will remove the plugin and all its data. This action cannot be undone."
      cancel-text="Cancel"
      confirm-text="Uninstall"
      variant="danger"
      @confirm="uninstallPlugin"
      @cancel="showUninstallConfirm = false"
    />
  </Dialog>

  <!-- Install Plugin Dialog -->
  <Dialog v-if="showInstallDialog" @close="closeInstallDialog" :show-header="false" size="small">
    <div class="install-dialog">
      <h3>Install Plugin</h3>

      <div v-if="installError" class="error">
        {{ installError }}
      </div>

      <div v-if="installing" class="installing-state">
        <div class="loading-spinner"></div>
        <p>Installing plugin...</p>
      </div>

      <div v-else-if="installSuccess" class="success-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
          <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
        </svg>
        <p class="success-message">Plugin installed successfully!</p>
        <button class="btn btn-primary" @click="closeInstallDialog">Done</button>
      </div>

      <div v-else class="upload-form">
        <p>Select a plugin ZIP file to install:</p>

        <div class="file-input-wrapper">
          <input
            ref="fileInput"
            type="file"
            accept=".zip"
            @change="handleFileSelect"
            class="file-input"
          />
          <button class="btn btn-secondary" @click="triggerFileSelect">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/>
              <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708z"/>
            </svg>
            Choose File
          </button>
          <span class="file-name">{{ selectedFileName || 'No file selected' }}</span>
        </div>

        <div class="install-actions">
          <button class="btn btn-secondary" @click="closeInstallDialog">Cancel</button>
          <button
            class="btn btn-primary"
            @click="uploadPlugin"
            :disabled="!selectedFile || installing"
          >
            Install
          </button>
        </div>

        <p class="install-hint">
          Plugin must be a ZIP archive containing manifest.json and plugin code.
        </p>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import Dialog from '@/components/Dialog.vue';
import ConfirmPanel from '@/components/ConfirmPanel.vue';
import { api } from '@/lib/api';

interface Plugin {
  id: string;
  name: string;
  version: string;
  author?: string;
  enabled: boolean;
  loaded: boolean;
  loadedAt?: string;
  installedAt?: string;
}

const plugins = ref<Plugin[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const reloading = ref<string | null>(null);
const toggling = ref<string | null>(null);
const uninstalling = ref<string | null>(null);
const selectedPlugin = ref<Plugin | null>(null);
const showUninstallConfirm = ref(false);
const showInstallDialog = ref(false);
const selectedFile = ref<File | null>(null);
const selectedFileName = ref<string>('');
const installing = ref(false);
const installSuccess = ref(false);
const installError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const loadPlugins = async () => {
  loading.value = true;
  loadError.value = null;

  try {
    const response = await fetch(`${api.baseUrl}/api/plugins`);
    if (!response.ok) throw new Error('Failed to load plugins');

    plugins.value = await response.json();
  } catch (error: any) {
    loadError.value = error.message || 'Failed to load plugins';
    console.error('Error loading plugins:', error);
  } finally {
    loading.value = false;
  }
};

const reloadPlugin = async (pluginId: string) => {
  reloading.value = pluginId;

  try {
    const response = await fetch(`${api.baseUrl}/api/plugins/${pluginId}/reload`, {
      method: 'POST'
    });

    if (!response.ok) throw new Error('Failed to reload plugin');

    await loadPlugins();
  } catch (error: any) {
    loadError.value = error.message || 'Failed to reload plugin';
    console.error('Error reloading plugin:', error);
  } finally {
    reloading.value = null;
  }
};

const togglePlugin = async (plugin: Plugin) => {
  toggling.value = plugin.id;

  try {
    const endpoint = plugin.enabled ? 'disable' : 'enable';
    const response = await fetch(`${api.baseUrl}/api/plugins/${plugin.id}/${endpoint}`, {
      method: 'POST'
    });

    if (!response.ok) throw new Error(`Failed to ${endpoint} plugin`);

    await loadPlugins();
  } catch (error: any) {
    loadError.value = error.message || 'Failed to toggle plugin';
    console.error('Error toggling plugin:', error);
  } finally {
    toggling.value = null;
  }
};

const confirmUninstall = (plugin: Plugin) => {
  selectedPlugin.value = plugin;
  showUninstallConfirm.value = true;
};

const uninstallPlugin = async () => {
  if (!selectedPlugin.value) return;

  const pluginId = selectedPlugin.value.id;
  uninstalling.value = pluginId;
  showUninstallConfirm.value = false;

  try {
    const response = await fetch(`${api.baseUrl}/api/plugins/${pluginId}`, {
      method: 'DELETE'
    });

    if (!response.ok) throw new Error('Failed to uninstall plugin');

    await loadPlugins();
  } catch (error: any) {
    loadError.value = error.message || 'Failed to uninstall plugin';
    console.error('Error uninstalling plugin:', error);
  } finally {
    uninstalling.value = null;
    selectedPlugin.value = null;
  }
};

const triggerFileSelect = () => {
  fileInput.value?.click();
};

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (file) {
    selectedFile.value = file;
    selectedFileName.value = file.name;
  }
};

const uploadPlugin = async () => {
  if (!selectedFile.value) return;

  installing.value = true;
  installError.value = null;

  try {
    const formData = new FormData();
    formData.append('plugin', selectedFile.value);

    const response = await fetch(`${api.baseUrl}/api/plugins/install`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to install plugin');
    }

    installSuccess.value = true;
    await loadPlugins();
  } catch (error: any) {
    installError.value = error.message || 'Failed to install plugin';
    console.error('Error installing plugin:', error);
  } finally {
    installing.value = false;
  }
};

const closeInstallDialog = () => {
  showInstallDialog.value = false;
  selectedFile.value = null;
  selectedFileName.value = '';
  installing.value = false;
  installSuccess.value = false;
  installError.value = null;

  if (fileInput.value) {
    fileInput.value.value = '';
  }
};

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

onMounted(() => {
  loadPlugins();
});
</script>

<style scoped>
.plugins-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--color-text-primary);
}

.error {
  color: var(--color-danger, #f87171);
  padding: var(--gap-sm) var(--gap-md);
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: var(--radius-small);
  margin-bottom: var(--gap-md);
}

.plugins-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.plugins-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.header-info {
  display: flex;
  align-items: baseline;
  gap: var(--gap-sm);
}

.header-info h3 {
  margin: 0;
  font-size: 1.1rem;
}

.plugin-count {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.btn {
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-small);
  padding: 8px 16px;
  cursor: pointer;
  font-weight: 600;
  transition: opacity 0.2s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.btn:hover {
  opacity: 0.9;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-primary {
  background: var(--color-accent);
}

.btn-icon {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 6px;
  color: var(--color-text-primary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.btn-icon:hover:not(:disabled) {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-icon:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.btn-icon-danger:hover:not(:disabled) {
  border-color: var(--color-danger, #f87171);
  color: var(--color-danger, #f87171);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--color-text-secondary);
  gap: var(--gap-sm);
}

.empty-state svg {
  opacity: 0.3;
  margin-bottom: var(--gap-md);
}

.empty-state p {
  margin: 0;
}

.empty-hint {
  font-size: 0.9rem;
  opacity: 0.7;
}

.plugins-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--gap-md);
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}

.plugin-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  padding: var(--gap-md);
  transition: border-color 0.2s ease;
}

.plugin-card:hover {
  border-color: var(--color-accent);
}

.plugin-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--gap-sm);
}

.plugin-info {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  flex-wrap: wrap;
}

.plugin-name {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.plugin-version {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  background: var(--color-surface-muted);
  padding: 2px 8px;
  border-radius: 12px;
}

.plugin-status {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 600;
}

.plugin-status--loaded {
  background: rgba(52, 211, 153, 0.2);
  color: #34d399;
}

.plugin-status--unloaded {
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
}

.plugin-actions {
  display: flex;
  gap: 6px;
}

.plugin-author {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  margin: var(--gap-xs) 0;
}

.plugin-meta {
  display: flex;
  gap: var(--gap-md);
  margin-top: var(--gap-sm);
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.meta-item svg {
  opacity: 0.6;
}

.install-dialog {
  padding: var(--gap-lg);
}

.install-dialog h3 {
  margin-top: 0;
}

.install-dialog code {
  background: var(--color-surface-muted);
  padding: 2px 6px;
  border-radius: var(--radius-small);
  font-size: 0.85rem;
}

.install-hint {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  margin-bottom: var(--gap-md);
}

.install-dialog .btn {
  margin-top: var(--gap-md);
}

.file-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  margin: var(--gap-md) 0;
}

.file-input {
  display: none;
}

.btn-secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover {
  background: var(--color-surface);
}

.file-name {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  flex: 1;
}

.install-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-sm);
  margin-top: var(--gap-md);
}

.installing-state,
.success-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--gap-xl) var(--gap-md);
  text-align: center;
}

.installing-state p,
.success-state p {
  margin: var(--gap-md) 0;
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid var(--color-surface-muted);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.success-state svg {
  color: #34d399;
}

.success-message {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.upload-form p {
  margin-bottom: var(--gap-sm);
}
</style>
