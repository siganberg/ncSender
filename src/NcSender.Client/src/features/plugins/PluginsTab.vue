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
  <div class="plugins-tab">
    <div v-if="loadError" class="error">
      {{ loadError }}
    </div>

    <!-- Config Panel View -->
    <div v-if="showConfigPanel && selectedPluginForConfig" class="config-panel-view">
      <div class="config-panel-header">
        <div class="config-header-top">
          <button class="btn-back" @click="closeConfigPanel">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path fill-rule="evenodd" d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8"/>
            </svg>
            Back to Plugins
          </button>
        </div>
        <h3>{{ selectedPluginForConfig.name }} Configuration</h3>
      </div>
      <div class="config-panel-content">
        <iframe
          ref="configIframe"
          :srcdoc="configUIContent"
          frameborder="0"
          class="config-iframe"
          @load="onConfigIframeLoad"
        ></iframe>
      </div>
    </div>

    <div v-else class="plugins-content pm">
      <div class="pm-head">
        <div class="pm-tabs">
          <button
            v-for="tb in tabs"
            :key="tb.id"
            class="pm-tab"
            :class="{ active: activeTab === tb.id }"
            @click="setTab(tb.id)"
          >
            {{ tb.label }}
            <span class="pm-tab-count" :class="{ 'pm-tab-count--alert': tb.id === 'updates' && tb.count > 0 && activeTab !== 'updates' }">{{ tb.count }}</span>
          </button>
        </div>
        <div class="pm-head-actions">
          <button
            v-if="activeTab === 'updates' && updatableEntries.length > 0"
            class="btn btn-primary"
            :disabled="!!updatingAll"
            @click="updateAll"
          >
            {{ updatingAll ? `Updating ${updatingAll.done} of ${updatingAll.total}…` : 'Update all' }}
          </button>
          <button class="btn btn-secondary pm-zip" @click="openInstallDialog">Install from a ZIP file</button>
        </div>
      </div>

      <div class="pm-filters">
        <input
          v-model="search"
          type="text"
          class="url-input pm-search"
          placeholder="Search plugins..."
        />
        <div class="pm-chips">
          <button
            v-for="chip in categoryChips"
            :key="chip.id"
            class="pm-chip"
            :class="{ active: activeCategory === chip.id }"
            @click="activeCategory = chip.id"
          >
            {{ chip.label }} · {{ chip.count }}
          </button>
        </div>
      </div>

      <div class="pm-split">
        <div class="pm-list">
          <div v-if="activeTab === 'browse' && loadingRegistry" class="loading-registry">
            <div class="loading-spinner"></div>
            <p>Loading plugin registry...</p>
          </div>
          <div v-else-if="activeTab === 'browse' && registryError" class="error">
            {{ registryError }}
          </div>
          <div v-else-if="visibleEntries.length === 0 && !loading" class="empty-state">
            <p>{{ emptyMessage }}</p>
            <p v-if="activeTab === 'installed' && plugins.length === 0" class="empty-hint">Install a plugin to extend ncSender functionality</p>
          </div>

          <template v-else>
            <div
              v-for="(entry, index) in visibleEntries"
              :key="entry.id"
              class="pm-row"
              :class="{ selected: selectedEntry?.id === entry.id, 'pm-row--off': entry.installed && !entry.installed.enabled }"
              :draggable="canReorder && entry.sortable"
              @click="selectedId = entry.id"
              v-on="canReorder && entry.sortable ? {
                dragstart: (e) => handleDragStart(entry.id, e),
                dragenter: handleDragEnter,
                dragover: handleDragOver,
                drop: (e) => handleDrop(index, e),
                dragend: handleDragEnd
              } : {}"
            >
              <div v-if="canReorder && entry.sortable" class="drag-handle" title="Drag to change the run order">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/>
                </svg>
              </div>

              <img
                v-if="entryIcon(entry)"
                :src="entryIcon(entry) || undefined"
                alt=""
                class="pm-icon"
                @error="onEntryIconError(entry)"
              />
              <div v-else class="pm-icon pm-icon--letters">{{ entryInitials(entry) }}</div>

              <div class="pm-info">
                <div class="pm-name">
                  <span class="pm-name-text">{{ entry.name }}</span>
                  <span class="pm-tag" :class="{ 'pm-tag--official': entry.official }">{{ entry.official ? 'Official' : 'Community' }}</span>
                  <span v-if="entry.beta" class="pm-tag">Beta</span>
                  <span v-if="entryNotRunning(entry)" class="status-badge status-not-running">Not running</span>
                </div>
                <div class="pm-meta">
                  <span v-if="entry.author">{{ entry.official ? 'ncSender' : entry.author }}</span>
                  <span>v{{ entry.installed ? entry.installed.version : entry.latest }}</span>
                  <button
                    v-if="entry.installed && entry.hasUpdate && activeTab !== 'updates'"
                    class="pm-update-pill"
                    @click.stop="showUpdateInfo(entry.installed)"
                  >
                    {{ updateToLabel(entry.latest) }}
                  </button>
                  <span v-if="entry.installed && activeTab === 'browse'">Installed</span>
                </div>
                <div v-if="entry.description" class="pm-desc">{{ entry.description }}</div>
              </div>

              <div class="pm-actions" @click.stop>
                <!-- Updates tab: the update is the one action. Elsewhere it is a
                     pill by the version, and the switch has this side to itself. -->
                <button
                  v-if="entry.installed && activeTab === 'updates'"
                  class="btn btn-primary pm-btn"
                  @click="showUpdateInfo(entry.installed)"
                >
                  {{ updateToLabel(entry.latest) }}
                </button>
                <ToggleSwitch
                  v-else-if="entry.installed"
                  :model-value="entry.installed.enabled"
                  :disabled="toggling === entry.id"
                  @update:model-value="togglePlugin(entry.installed)"
                />
                <button v-else-if="entry.blocked" class="btn btn-secondary pm-btn" disabled>
                  {{ needsLabel(entry.minApp) }}
                </button>
                <button
                  v-else
                  class="btn btn-primary pm-btn"
                  :disabled="installing"
                  @click="installFromRegistry(entry.registry)"
                >
                  Install
                </button>
              </div>
            </div>
          </template>
        </div>

        <aside class="pm-detail">
          <p v-if="!selectedEntry" class="pm-detail-empty">Pick a plugin to see its details.</p>
          <template v-else>
            <div class="pm-detail-head">
              <img
                v-if="entryIcon(selectedEntry)"
                :src="entryIcon(selectedEntry) || undefined"
                alt=""
                class="pm-icon pm-icon--large"
                @error="onEntryIconError(selectedEntry)"
              />
              <div v-else class="pm-icon pm-icon--large pm-icon--letters">{{ entryInitials(selectedEntry) }}</div>
              <div class="pm-info">
                <h3>{{ selectedEntry.name }}</h3>
                <div class="pm-meta"><span v-if="selectedEntry.author">{{ selectedEntry.official ? 'ncSender' : selectedEntry.author }}</span></div>
              </div>
            </div>
            <div class="pm-name">
              <span class="pm-tag" :class="{ 'pm-tag--official': selectedEntry.official }">{{ selectedEntry.official ? 'Official' : 'Community' }}</span>
              <span v-if="selectedEntry.beta" class="pm-tag">Beta</span>
            </div>
            <p v-if="selectedEntry.description" class="pm-detail-desc">{{ selectedEntry.description }}</p>

            <div v-if="entryNotRunning(selectedEntry) && selectedEntry.installed" class="plugin-run-problem">
              <span>{{ selectedEntry.installed.runState === 'quarantined' ? 'Not running: ncSender stopped twice while loading it. Jobs and tool changes are blocked until it runs or is disabled.' : `Not running: it failed to load (${selectedEntry.installed.runError}). Jobs and tool changes are blocked until it runs or is disabled.` }}</span>
              <button class="plugin-retry-btn" :disabled="retrying === selectedEntry.id" @click="retryPlugin(selectedEntry.id)">Retry</button>
            </div>

            <template v-if="selectedEntry.installed">
              <button
                v-if="selectedEntry.hasUpdate"
                class="btn btn-primary pm-wide"
                @click="showUpdateInfo(selectedEntry.installed)"
              >
                {{ updateToLabel(selectedEntry.latest) }}
              </button>
              <div class="pm-detail-buttons">
                <button
                  v-if="selectedEntry.installed.hasConfig"
                  class="btn btn-primary"
                  :disabled="!selectedEntry.installed.enabled || !selectedEntry.installed.loaded"
                  @click="openConfigPanel(selectedEntry.installed)"
                >
                  Settings
                </button>
                <button
                  v-if="selectedEntry.installed.repository && !selectedEntry.hasUpdate"
                  class="btn btn-secondary"
                  @click="showUpdateInfo(selectedEntry.installed)"
                >
                  Release Notes
                </button>
                <button
                  class="btn btn-secondary"
                  :disabled="uninstalling === selectedEntry.id"
                  @click="confirmUninstall(selectedEntry.installed)"
                >
                  Remove
                </button>
              </div>
            </template>
            <button v-else-if="selectedEntry.blocked" class="btn btn-secondary pm-wide" disabled>
              {{ needsLabel(selectedEntry.minApp) }}
            </button>
            <button
              v-else
              class="btn btn-primary pm-wide"
              :disabled="installing"
              @click="installFromRegistry(selectedEntry.registry)"
            >
              Install
            </button>

            <div class="pm-facts">
              <div v-if="selectedEntry.installed" class="pm-fact">
                <span>Enabled</span>
                <ToggleSwitch
                  :model-value="selectedEntry.installed.enabled"
                  :disabled="toggling === selectedEntry.id"
                  @update:model-value="togglePlugin(selectedEntry.installed)"
                />
              </div>
              <div v-if="selectedEntry.installed" class="pm-fact">
                <span>Installed</span>
                <b>v{{ selectedEntry.installed.version }}<template v-if="selectedEntry.installed.installedAt"> · {{ formatDate(selectedEntry.installed.installedAt) }}</template></b>
              </div>
              <div v-if="selectedEntry.latest" class="pm-fact">
                <span>Newest</span>
                <b>v{{ selectedEntry.latest }}</b>
              </div>
              <div class="pm-fact">
                <span>Category</span>
                <b>{{ categoryLabel(selectedEntry.category) }}</b>
              </div>
              <div v-if="selectedEntry.minApp" class="pm-fact">
                <span>Needs ncSender</span>
                <b>{{ selectedEntry.minApp }}</b>
              </div>
              <div v-if="selectedEntry.repository" class="pm-fact">
                <span>Project page</span>
                <a :href="selectedEntry.repository" target="_blank" rel="noopener">{{ selectedEntry.repository.replace(/^https?:\/\//, '') }}</a>
              </div>
            </div>
          </template>
        </aside>
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

  <!-- Category Conflict Dialog -->
  <Dialog v-if="showCategoryConflict && selectedPlugin" @close="showCategoryConflict = false" :show-header="false" size="small">
    <ConfirmPanel
      title="Only One Tool Changer Plugin Allowed"
      :message="`You already have ${conflictingPlugins.map(p => p.name).join(', ')} enabled. Please disable it first before enabling ${selectedPlugin.name}.`"
      cancel-text="OK"
      :show-confirm="false"
      variant="warning"
      @cancel="showCategoryConflict = false"
    />
  </Dialog>

  <!-- Install Plugin Dialog: the ZIP form, and the progress/result of any install -->
  <Dialog
    v-if="showInstallDialog"
    @close="closeInstallDialog"
    :show-header="false"
    :size="installCompact ? 'small' : undefined"
    :width="!installCompact ? '700px' : undefined"
    :max-width="!installCompact ? '90vw' : undefined"
  >
    <div class="install-dialog" :class="{ 'install-dialog--compact': installCompact }">
      <h3>{{ installMethod === 'zip' ? 'Install from a ZIP file' : 'Install Plugin' }}</h3>

      <div v-if="installError && !installCategoryConflict" class="error">
        {{ installError }}
      </div>

      <div v-if="installing" class="installing-state">
        <div class="loading-spinner"></div>
        <p>Installing plugin...</p>
      </div>

      <div v-else-if="installSuccess || installCategoryConflict" class="success-state">
        <p class="success-message">
          {{ installCategoryConflict ? 'Plugin installed successfully but not activated. Another plugin in the same category is already active.' : 'Plugin installed successfully!' }}
        </p>
        <button class="btn btn-primary" @click="closeInstallDialog">Done</button>
      </div>

      <div v-else-if="installMethod === 'registry'" class="success-state">
        <button class="btn btn-primary" @click="closeInstallDialog">Close</button>
      </div>

      <div v-else class="upload-form">
        <div class="install-method-content">
          <div class="zip-content-centered">
            <p class="zip-instruction">Install from ZIP file or URL:</p>

            <div class="zip-input-section">
              <div class="url-input-wrapper">
                <input
                  v-model="zipUrl"
                  type="text"
                  placeholder="https://github.com/owner/repo/releases/download/v1.0.0/plugin.zip"
                  class="url-input"
                  @keyup.enter="installFromUrl"
                  @contextmenu.stop
                />
              </div>

              <div class="zip-divider">
                <span>OR</span>
              </div>

              <div class="file-input-wrapper">
                <input
                  ref="fileInput"
                  type="file"
                  accept=".zip"
                  @change="handleFileSelect"
                  class="file-input"
                />
                <button class="btn btn-secondary" @click="triggerFileSelect">
                  Choose File
                </button>
                <span class="file-name">{{ selectedFileName || 'No file selected' }}</span>
              </div>
            </div>

            <p class="install-hint">
              Plugin must be a ZIP archive containing manifest.json and plugin code.
            </p>
          </div>
        </div>

        <div class="install-actions">
          <button class="btn btn-primary install-close-btn" @click="closeInstallDialog">Close</button>
          <button
            v-if="zipUrl"
            class="btn btn-primary"
            @click="installFromUrl"
            :disabled="installing"
          >
            Install from URL
          </button>
          <button
            v-else-if="selectedFile"
            class="btn btn-primary"
            @click="uploadPlugin"
            :disabled="installing"
          >
            Install from File
          </button>
        </div>
      </div>
    </div>
  </Dialog>

  <!-- Update Plugin Dialog -->
  <Dialog v-if="showUpdateDialog && selectedPluginForUpdate" @close="showUpdateDialog = false" :show-header="false" size="small">
    <div class="update-dialog">
      <h3>Update {{ selectedPluginForUpdate.name }}</h3>

      <div v-if="updateError" class="error">
        {{ updateError }}
      </div>

      <div v-if="updating" class="updating-state">
        <div class="loading-spinner"></div>
        <p>Updating plugin...</p>
      </div>

      <div v-else-if="!updateInfo && !updateError" class="updating-state">
        <div class="loading-spinner"></div>
        <p>Checking for updates...</p>
      </div>

      <div v-else-if="updateInfo" class="update-info">
        <div class="version-info">
          <div class="version-row">
            <span class="label">Current version:</span>
            <span class="version">v{{ updateInfo.currentVersion }}</span>
          </div>
          <div class="version-row">
            <span class="label">Latest version:</span>
            <span class="version new-version">v{{ updateInfo.latestVersion }}</span>
          </div>
          <div class="version-row" v-if="updateInfo.publishedAt">
            <span class="label">Published:</span>
            <span class="date">{{ new Date(updateInfo.publishedAt).toLocaleDateString() }}</span>
          </div>
        </div>

        <div v-if="updateInfo.releaseNotes" class="release-notes">
          <h4>Release Notes</h4>
          <div class="notes-content" v-html="renderReleaseNotesMarkdown(updateInfo.releaseNotes)"></div>
        </div>

        <div class="update-actions">
          <button class="btn btn-secondary" @click="showUpdateDialog = false" :disabled="updating">Cancel</button>
          <a
            v-if="updateInfo.releaseUrl"
            :href="updateInfo.releaseUrl"
            target="_blank"
            class="btn btn-secondary"
          >
            View on GitHub
          </a>
          <button
            class="btn btn-primary"
            @click="performUpdate"
            :disabled="updating || !updateInfo.hasUpdate"
          >
            Update
          </button>
        </div>
      </div>
    </div>
  </Dialog>

  <!-- Open-from-drive picker (kiosk mode) -->
  <FileBrowserDialog
    v-if="showPluginPicker"
    title="Select plugin ZIP from external drive"
    mode="open"
    :extensions="['.zip']"
    :on-submit="pickPluginFromPath"
    @close="showPluginPicker = false"
    @done="showPluginPicker = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import Dialog from '@/components/Dialog.vue';
import ConfirmPanel from '@/components/ConfirmPanel.vue';
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import FileBrowserDialog from '@/components/FileBrowserDialog.vue';
import { useKioskDetection } from '@/composables/useKioskDetection';
import { api } from '@/lib/api';
import { renderReleaseNotesMarkdown } from '@/lib/release-notes';
import { settingsStore } from '@/lib/settings-store';
import {
  fetchPlugins,
  fetchPluginConfigUI,
  installPlugin as installPluginRequest,
  setPluginEnabled,
  reloadPlugin as reloadPluginRequest,
  retryPlugin as retryPluginRequest,
  uninstallPlugin as uninstallPluginRequest,
  reorderPlugins,
  checkPluginUpdate,
  updatePlugin,
  PluginListItem,
  PluginUpdateInfo
} from './api';

const plugins = ref<PluginListItem[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const reloading = ref<string | null>(null);
const retrying = ref<string | null>(null);
const toggling = ref<string | null>(null);
const uninstalling = ref<string | null>(null);
const selectedPlugin = ref<PluginListItem | null>(null);
const showUninstallConfirm = ref(false);
const showCategoryConflict = ref(false);
const conflictingPlugins = ref<Array<{ id: string; name: string }>>([]);
const conflictCategory = ref<string>('');
const showInstallDialog = ref(false);
const selectedFile = ref<File | null>(null);
const selectedFileName = ref<string>('');
const installing = ref(false);
const installSuccess = ref(false);
const installCategoryConflict = ref(false);
const installError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const { isKiosk } = useKioskDetection();
const showPluginPicker = ref(false);
const showConfigPanel = ref(false);
const selectedPluginForConfig = ref<PluginListItem | null>(null);
const configUIContent = ref('');
const configIframe = ref<HTMLIFrameElement | null>(null);
const installMethod = ref<'zip' | 'registry'>('registry');
const zipUrl = ref<string>('');
const registryPlugins = ref<any[]>([]);
const registrySearch = ref<string>('');
const loadingRegistry = ref(false);
const registryError = ref<string | null>(null);
const registryCacheExpiry = ref<number>(0);
const brokenRegistryIcons = ref<Record<string, boolean>>({});
let unsubscribePluginsChanged: (() => void) | null = null;
let refreshPending = false;
const brokenIcons = ref<Record<string, boolean>>({});

// Update checking state
const showUpdateDialog = ref(false);
const selectedPluginForUpdate = ref<PluginListItem | null>(null);
const updateInfo = ref<PluginUpdateInfo | null>(null);
const updating = ref(false);
const updateError = ref<string | null>(null);

// Check if plugin reordering is allowed from settings
const allowPriorityReordering = computed(() =>
  settingsStore.data?.plugins?.allowPriorityReordering ?? false
);

// Separate plugins by priority for drag-n-drop
const sortablePlugins = computed(() =>
  plugins.value.filter(p => p.priority !== undefined && p.priority !== null)
);

const otherPlugins = computed(() =>
  plugins.value.filter(p => p.priority === undefined || p.priority === null)
);

// Drag-n-drop state
let draggedPluginId: string | null = null;

const handleDragStart = (pluginId: string, event: DragEvent) => {
  draggedPluginId = pluginId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/html', (event.target as HTMLElement).innerHTML);
  }
};

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
};

const handleDragEnter = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

const handleDrop = async (targetIndex: number, event: DragEvent) => {
  event.preventDefault();

  if (!draggedPluginId) {
    return;
  }

  const fromIndex = sortablePlugins.value.findIndex(p => p.id === draggedPluginId);
  if (fromIndex === -1 || fromIndex === targetIndex) {
    draggedPluginId = null;
    return;
  }

  // Reorder the sortable plugins array
  const items = [...sortablePlugins.value];
  const [removed] = items.splice(fromIndex, 1);
  items.splice(targetIndex, 0, removed);

  // Update the main plugins array
  const newPlugins = [
    ...items,
    ...otherPlugins.value
  ];
  plugins.value = newPlugins;

  // Send new order to backend
  const pluginIds = items.map(p => p.id);
  try {
    await reorderPlugins(pluginIds);
  } catch (error) {
    console.error('Failed to reorder plugins:', error);
    // Revert the local change
    await loadPlugins();
  } finally {
    draggedPluginId = null;
  }
};

const handleDragEnd = () => {
  draggedPluginId = null;
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
};

const savePluginConfig = () => {
  if (configIframe.value && configIframe.value.contentWindow) {
    configIframe.value.contentWindow.postMessage({ type: 'save-config' }, '*');
  }
};

const onConfigIframeLoad = () => {
  // Inject theme CSS variables into iframe
  if (configIframe.value && configIframe.value.contentWindow && configIframe.value.contentDocument) {
    // Get computed styles from body element since theme classes are applied there
    const computedStyle = getComputedStyle(document.body);
    const iframeRoot = configIframe.value.contentDocument.documentElement;

    // Get all CSS variables from the parent and inject into iframe
    const cssVars = [
      '--color-bg',
      '--color-surface',
      '--color-surface-muted',
      '--color-border',
      '--color-text-primary',
      '--color-text-secondary',
      '--color-accent',
      '--color-danger',
      '--gap-xs',
      '--gap-sm',
      '--gap-md',
      '--gap-lg',
      '--gap-xl',
      '--radius-small',
      '--radius-medium'
    ];

    cssVars.forEach(varName => {
      const value = computedStyle.getPropertyValue(varName);
      if (value) {
        iframeRoot.style.setProperty(varName, value);
      }
    });

    // Set body background color directly with the actual color value
    const iframeBody = configIframe.value.contentDocument.body;
    if (iframeBody) {
      const bgColor = computedStyle.getPropertyValue('--color-bg').trim();
      const textColor = computedStyle.getPropertyValue('--color-text-primary').trim();

      console.log('Setting iframe colors:', { bgColor, textColor });

      iframeBody.style.backgroundColor = bgColor;
      iframeBody.style.color = textColor;
      iframeBody.style.margin = '0';
      iframeBody.style.padding = '20px';
    }
  }
};

const openConfigPanel = async (plugin: PluginListItem) => {
  if (!plugin.hasConfig) {
    loadError.value = 'Plugin does not expose a configuration panel.';
    return;
  }

  try {
    const pluginConfigHTML = await fetchPluginConfigUI(plugin.id);

    // Wrap the plugin config HTML with proper HTML structure and styling
    configUIContent.value = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            * {
              box-sizing: border-box;
            }
            body {
              margin: 0;
              padding: 20px;
              background-color: var(--color-bg);
              color: var(--color-text-primary);
              font-family: system-ui, -apple-system, sans-serif;
            }
            /* Add card styles to match main app */
            textarea, input[type="text"], input[type="number"] {
              background: var(--color-surface) !important;
              border: 1px solid var(--color-border) !important;
              border-radius: var(--radius-small) !important;
              color: var(--color-text-primary) !important;
              padding: 8px 12px !important;
              width: 100% !important;
              font-family: inherit !important;
              font-size: 14px !important;
            }
            textarea:focus, input:focus {
              outline: none !important;
              border-color: var(--color-accent) !important;
            }
            label {
              display: block;
              margin-bottom: 8px;
              font-weight: 500;
              color: var(--color-text-primary);
            }
            h1, h2, h3, h4 {
              color: var(--color-text-primary);
              margin-top: 0;
            }
          </style>
        </head>
        <body>
          ${pluginConfigHTML}
        </body>
      </html>
    `;

    selectedPluginForConfig.value = plugin;
    showConfigPanel.value = true;
  } catch (error: any) {
    loadError.value = error.message || 'Failed to load plugin configuration';
    console.error('Error loading plugin config:', error);
  }
};

const closeConfigPanel = () => {
  showConfigPanel.value = false;
  selectedPluginForConfig.value = null;
  configUIContent.value = '';
};

// Session-level cache for per-plugin update-check results, keyed by
// `<pluginId>@<currentVersion>`. Cleared automatically when a plugin
// version changes (successful update, manual install of newer zip).
// Prevents hammering GitHub's rate-limited API on every list refresh —
// each plugin+version is checked at most once per session.
const updateInfoCache = new Map<string, PluginUpdateInfo>();

const applyCachedUpdateInfo = () => {
  plugins.value.forEach(plugin => {
    if (plugin.updateInfo) return;
    const cached = updateInfoCache.get(`${plugin.id}@${plugin.version}`);
    if (cached) plugin.updateInfo = cached;
  });
};

// Auto-check for updates across all installed plugins that declare a
// repository. Runs after fetchPlugins() so cards render immediately;
// badges appear later as each check resolves. Uses a small concurrency
// cap since each check hits the GitHub REST API. Errors are swallowed
// per-plugin — the user can still open the update dialog to see them.
let autoUpdateCheckInFlight = false;
const runAutoUpdateChecks = async () => {
  if (autoUpdateCheckInFlight) return;
  autoUpdateCheckInFlight = true;
  try {
    const targets = plugins.value.filter(p => p.repository && !p.updateInfo);
    if (targets.length === 0) return;

    const CONCURRENCY = 3;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      while (cursor < targets.length) {
        const plugin = targets[cursor++];
        try {
          const info = await checkPluginUpdate(plugin.id);
          plugin.updateInfo = info;
          updateInfoCache.set(`${plugin.id}@${plugin.version}`, info);
        } catch {
          // Silent — the update dialog surfaces the real error on demand.
        }
      }
    });
    await Promise.all(workers);
  } finally {
    autoUpdateCheckInFlight = false;
  }
};

const loadPlugins = async () => {
  if (loading.value) {
    refreshPending = true;
    return;
  }

  loading.value = true;
  loadError.value = null;

  try {
    plugins.value = await fetchPlugins();
    const filteredEntries = Object.entries(brokenIcons.value).filter(([id]) =>
      plugins.value.some(plugin => plugin.id === id)
    );
    const filteredMap = Object.fromEntries(filteredEntries) as Record<string, boolean>;
    plugins.value.forEach(plugin => {
      if (plugin.hasIcon && filteredMap[plugin.id]) {
        delete filteredMap[plugin.id];
      }
    });
    brokenIcons.value = filteredMap;
    applyCachedUpdateInfo();
    // Fire-and-forget: don't block the initial render on GitHub API calls.
    void runAutoUpdateChecks();
  } catch (error: any) {
    loadError.value = error.message || 'Failed to load plugins';
    console.error('Error loading plugins:', error);
  } finally {
    loading.value = false;
    if (refreshPending) {
      refreshPending = false;
      loadPlugins();
    }
  }
};

const reloadPlugin = async (pluginId: string) => {
  reloading.value = pluginId;

  try {
    await reloadPluginRequest(pluginId);
    // loadPlugins() will be triggered by the 'plugins:tools-changed' WebSocket event
  } catch (error: any) {
    loadError.value = error.message || 'Failed to reload plugin';
    console.error('Error reloading plugin:', error);
  } finally {
    reloading.value = null;
  }
};

// The list refreshes on the 'plugins:tools-changed' event the retry sends.
const retryPlugin = async (pluginId: string) => {
  retrying.value = pluginId;
  try {
    await retryPluginRequest(pluginId);
  } catch (error: any) {
    loadError.value = error.message || 'Failed to retry plugin';
    console.error('Error retrying plugin:', error);
  } finally {
    retrying.value = null;
  }
};

const togglePlugin = async (plugin: PluginListItem) => {
  toggling.value = plugin.id;

  try {
    await setPluginEnabled(plugin.id, !plugin.enabled);
    await loadPlugins();
  } catch (error: any) {
    console.log('Toggle error:', JSON.stringify({
      hasResponse: !!error.response,
      status: error.response?.status,
      data: error.response?.data
    }));

    if (error.response?.status === 409 && error.response?.data?.error === 'CATEGORY_CONFLICT') {
      selectedPlugin.value = plugin;
      conflictingPlugins.value = error.response.data.conflictingPlugins;
      conflictCategory.value = error.response.data.category;
      showCategoryConflict.value = true;
    } else {
      loadError.value = error.message || 'Failed to toggle plugin';
      console.error('Error toggling plugin:', error);
    }
  } finally {
    toggling.value = null;
  }
};

const confirmUninstall = (plugin: PluginListItem) => {
  selectedPlugin.value = plugin;
  showUninstallConfirm.value = true;
};
// Show update dialog
const showUpdateInfo = async (plugin: PluginListItem) => {
  selectedPluginForUpdate.value = plugin;
  updateError.value = null;
  showUpdateDialog.value = true;

  // Check for updates when dialog is opened
  if (plugin.repository) {
    try {
      updateInfo.value = null; // Clear previous info
      const info = await checkPluginUpdate(plugin.id);
      plugin.updateInfo = info;
      updateInfo.value = info;
    } catch (error: any) {
      console.error(`Failed to check update for ${plugin.id}:`, JSON.stringify(error));
      updateError.value = error.message || 'Failed to check for updates';
      updateInfo.value = null;
    }
  }
};

// Perform plugin update
const performUpdate = async () => {
  if (!selectedPluginForUpdate.value) return;

  updating.value = true;
  updateError.value = null;

  try {
    await updatePlugin(selectedPluginForUpdate.value.id);
    showUpdateDialog.value = false;
    await loadPlugins();
  } catch (error: any) {
    updateError.value = error.message || 'Failed to update plugin';
    console.error('Error updating plugin:', error);
  } finally {
    updating.value = false;
  }
};

const uninstallPlugin = async () => {
  if (!selectedPlugin.value) return;

  const pluginId = selectedPlugin.value.id;
  uninstalling.value = pluginId;
  showUninstallConfirm.value = false;

  try {
    await uninstallPluginRequest(pluginId);
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
  if (isKiosk.value) {
    showPluginPicker.value = true;
    return;
  }
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

const pickPluginFromPath = async (payload: { fullPath?: string }) => {
  if (!payload.fullPath) return { success: false, error: 'No file selected' };
  try {
    const res = await fetch(`${api.baseUrl}/api/external-drives/read?path=${encodeURIComponent(payload.fullPath)}`);
    if (!res.ok) return { success: false, error: `Read failed (${res.status})` };
    const blob = await res.blob();
    const name = payload.fullPath.split(/[\\/]/).pop() || 'plugin.zip';
    selectedFile.value = new File([blob], name, { type: 'application/zip' });
    selectedFileName.value = name;
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to read file' };
  }
};

const uploadPlugin = async () => {
  if (!selectedFile.value) return;

  installing.value = true;
  installError.value = null;

  try {
    await installPluginRequest(selectedFile.value);
    installSuccess.value = true;
    await loadPlugins();
  } catch (error: any) {
    if (error.response?.status === 409 && (error.response?.data?.error === 'CATEGORY_CONFLICT' || error.response?.data?.error?.includes('CATEGORY_CONFLICT'))) {
      installCategoryConflict.value = true;
      installing.value = false;
      await loadPlugins();
      return;
    }
    if (error.message?.includes('CATEGORY_CONFLICT')) {
      installCategoryConflict.value = true;
      installing.value = false;
      await loadPlugins();
      return;
    }
    installError.value = error.message || 'Failed to install plugin';
    console.error('Error installing plugin:', error);
  } finally {
    installing.value = false;
  }
};

const installFromUrl = async () => {
  if (!zipUrl.value) return;

  installing.value = true;
  installError.value = null;

  try {
    const response = await fetch(`${api.baseUrl}/api/plugins/install-from-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: zipUrl.value }),
    });

    let data;
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError);
        throw new Error('Invalid JSON response from server');
      }
    } else {
      // Not JSON - try to get text for debugging
      const text = await response.text();
      console.error('Non-JSON response:', text.substring(0, 200));
      throw new Error(`Server returned non-JSON response: ${response.status} ${response.statusText}`);
    }

    if (!response.ok) {
      if (response.status === 409 && (data.error === 'CATEGORY_CONFLICT' || data.error?.includes('CATEGORY_CONFLICT'))) {
        installCategoryConflict.value = true;
        installing.value = false;
        await loadPlugins();
        return;
      }
      throw new Error(data.error || 'Failed to install plugin from URL');
    }

    installSuccess.value = true;
    await loadPlugins();
  } catch (error: any) {
    if (error.message?.includes('CATEGORY_CONFLICT')) {
      installCategoryConflict.value = true;
      installing.value = false;
      await loadPlugins();
      return;
    }
    installError.value = error.message || 'Failed to install plugin from URL';
    console.error('Error installing plugin from URL:', error);
  } finally {
    installing.value = false;
  }
};


const openInstallDialog = () => {
  installMethod.value = 'zip';
  showInstallDialog.value = true;
};

const closeInstallDialog = () => {
  showInstallDialog.value = false;
  selectedFile.value = null;
  selectedFileName.value = '';
  zipUrl.value = '';
  installMethod.value = 'registry';
  installing.value = false;
  installSuccess.value = false;
  installCategoryConflict.value = false;
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

const REGISTRY_API_URL = '/api/plugins/registry';
const REGISTRY_FALLBACK_URL = 'https://raw.githubusercontent.com/siganberg/ncSender.plugins-registry/main/plugins.json';
const CACHE_DURATION = 3600000;

const filteredRegistryPlugins = computed(() => {
  if (!registrySearch.value) return registryPlugins.value;

  const search = registrySearch.value.toLowerCase();
  return registryPlugins.value.filter(plugin =>
    plugin.name.toLowerCase().includes(search) ||
    plugin.description.toLowerCase().includes(search) ||
    plugin.author.toLowerCase().includes(search)
  );
});

const loadRegistryPlugins = async () => {
  const now = Date.now();
  if (registryPlugins.value.length > 0 && now < registryCacheExpiry.value) {
    return;
  }

  loadingRegistry.value = true;
  registryError.value = null;

  try {
    // Try server-side filtered registry first (V2), fall back to GitHub (V1)
    let response = await fetch(REGISTRY_API_URL);
    if (!response.ok) {
      response = await fetch(REGISTRY_FALLBACK_URL, { cache: 'no-cache' });
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch registry: ${response.statusText}`);
    }

    const data = await response.json();
    registryPlugins.value = data;
    registryCacheExpiry.value = now + CACHE_DURATION;
  } catch (error: any) {
    registryError.value = error.message || 'Failed to load plugin registry';
    console.error('Error loading registry:', error);
  } finally {
    loadingRegistry.value = false;
  }
};

const isPluginInstalled = (pluginId: string) => {
  return plugins.value.some(p => p.id === pluginId);
};

const installFromRegistry = async (plugin: any) => {
  installMethod.value = 'registry';
  showInstallDialog.value = true;
  selectedId.value = plugin.id;
  installing.value = true;
  installError.value = null;

  try {
    // The server looks up the latest release (cached, rate-limit safe) and
    // installs its .zip.
    const response = await fetch(`${api.baseUrl}/api/plugins/install-from-repo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ repository: plugin.repository }),
    });

    let data;
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (parseError) {
        throw new Error('Invalid JSON response from server');
      }
    } else {
      const text = await response.text();
      throw new Error(`Server returned non-JSON response: ${response.status} ${response.statusText}`);
    }

    if (!response.ok) {
      if (response.status === 409 && (data.error === 'CATEGORY_CONFLICT' || data.error?.includes('CATEGORY_CONFLICT'))) {
        installCategoryConflict.value = true;
        installing.value = false;
        await loadPlugins();
        return;
      }
      throw new Error(data.error || 'Failed to install plugin from registry');
    }

    installSuccess.value = true;
    await loadPlugins();
  } catch (error: any) {
    if (error.message?.includes('CATEGORY_CONFLICT')) {
      installCategoryConflict.value = true;
      installing.value = false;
      await loadPlugins();
      return;
    }
    installError.value = error.message || 'Failed to install plugin from registry';
    console.error('Error installing plugin from registry:', error);
  } finally {
    installing.value = false;
  }
};

const handleRegistryIconError = (pluginId: string) => {
  brokenRegistryIcons.value[pluginId] = true;
};

// ---------- one list for installed and available plugins ----------

type PluginTab = 'installed' | 'browse' | 'updates';

interface PluginEntry {
  id: string;
  name: string;
  beta: boolean;
  author: string;
  description: string;
  category: string;
  repository: string;
  installed: PluginListItem | null;
  registry: any | null;
  official: boolean;
  /** Oldest ncSender the registry says it runs on. */
  minApp: string | null;
  blocked: boolean;
  latest: string | null;
  hasUpdate: boolean;
  /** Takes part in the drag-to-sort run order. */
  sortable: boolean;
}

const activeTab = ref<PluginTab>('installed');
const activeCategory = ref('all');
const search = ref('');
const selectedId = ref<string | null>(null);

// The registry lists the oldest app version per platform key.
const REGISTRY_PLATFORM = 'v2';
const BETA_SUFFIX = /\s*\(beta\)\s*$/i;

const versionParts = (v: string) => v.split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
const isNewerVersion = (a: string, b: string) => {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
};
// The registry can lag behind a release, so take the highest version anyone reports.
const newestOf = (...versions: Array<string | null | undefined>) =>
  versions.filter((v): v is string => !!v).reduce<string | null>((best, v) => (!best || isNewerVersion(v, best) ? v : best), null);
// Unknown or dev version (0.0.x): never block an install on it.
const appVersion = computed(() => {
  const v: string = api.serverVersion || '';
  return /^\d+\.\d+\.\d+/.test(v) && !v.startsWith('0.0.') ? v : null;
});

const toEntry = (installed: PluginListItem | null, registry: any | null): PluginEntry => {
  const rawName = installed?.name || registry?.name || '';
  const repository = installed?.repository || registry?.repository || '';
  const minApp = registry?.platforms?.[REGISTRY_PLATFORM] || null;
  return {
    id: installed?.id || registry?.id,
    name: rawName.replace(BETA_SUFFIX, ''),
    beta: BETA_SUFFIX.test(rawName) || BETA_SUFFIX.test(registry?.name || ''),
    author: installed?.author || registry?.author || '',
    description: registry?.description || installed?.description || '',
    category: (installed?.category || registry?.category || '').toLowerCase(),
    repository,
    installed,
    registry,
    official: /github\.com\/siganberg\//i.test(repository),
    minApp,
    blocked: !installed && !!minApp && !!appVersion.value && isNewerVersion(minApp, appVersion.value),
    latest: newestOf(installed?.updateInfo?.latestVersion, registry?.version, installed?.version),
    hasUpdate: !!installed?.updateInfo?.hasUpdate,
    sortable: !!installed && installed.priority !== undefined && installed.priority !== null
  };
};

const installedEntries = computed(() => {
  const byId = new Map(registryPlugins.value.map(r => [r.id, r]));
  return [...sortablePlugins.value, ...otherPlugins.value].map(p => toEntry(p, byId.get(p.id) || null));
});

const browseEntries = computed(() => {
  const byId = new Map(plugins.value.map(p => [p.id, p]));
  return registryPlugins.value.map(r => toEntry(byId.get(r.id) || null, r));
});

const tabEntries = computed(() => {
  if (activeTab.value === 'browse') return browseEntries.value;
  if (activeTab.value === 'updates') return installedEntries.value.filter(e => e.hasUpdate);
  return installedEntries.value;
});

const tabs = computed(() => [
  { id: 'installed' as PluginTab, label: 'Installed', count: installedEntries.value.length },
  { id: 'browse' as PluginTab, label: 'Browse', count: browseEntries.value.length },
  { id: 'updates' as PluginTab, label: 'Updates', count: updatableEntries.value.length }
]);

const categoryLabel = (category: string) => {
  if (category === 'gcode-generator') return 'G-code generators';
  if (category === 'utility') return 'Utilities';
  if (category === 'tool-changer') return 'Tool changers';
  return category;
};

const categoryChips = computed(() => {
  const counts = new Map<string, number>();
  tabEntries.value.forEach(e => counts.set(e.category, (counts.get(e.category) || 0) + 1));
  return [
    { id: 'all', label: 'All', count: tabEntries.value.length },
    ...[...counts.entries()]
      .sort((a, b) => categoryLabel(a[0]).localeCompare(categoryLabel(b[0])))
      .map(([id, count]) => ({ id, label: categoryLabel(id), count }))
  ];
});

const visibleEntries = computed(() => {
  const term = search.value.trim().toLowerCase();
  return tabEntries.value.filter(e =>
    (activeCategory.value === 'all' || e.category === activeCategory.value) &&
    (!term || `${e.name} ${e.description} ${e.author}`.toLowerCase().includes(term))
  );
});

// The selected plugin, or the first one shown.
const selectedEntry = computed(() =>
  visibleEntries.value.find(e => e.id === selectedId.value) || visibleEntries.value[0] || null
);

// Dragging changes the run order, so it only makes sense on the whole installed list.
const canReorder = computed(() =>
  allowPriorityReordering.value && activeTab.value === 'installed' && activeCategory.value === 'all' && !search.value.trim()
);

const emptyMessage = computed(() => {
  if (activeTab.value === 'updates') return 'Everything is up to date.';
  if (activeTab.value === 'installed' && plugins.value.length === 0) return 'No plugins installed';
  return 'No plugins found';
});

const setTab = (tab: PluginTab) => {
  activeTab.value = tab;
  activeCategory.value = 'all';
  if (tab === 'browse') loadRegistryPlugins();
};

const entryIcon = (entry: PluginEntry): string | null => {
  if (entry.installed?.hasIcon && !brokenIcons.value[entry.id]) return `${api.baseUrl}/api/plugins/${entry.id}/icon`;
  if (entry.registry?.iconUrl && !brokenRegistryIcons.value[entry.id]) return entry.registry.iconUrl;
  return null;
};
const onEntryIconError = (entry: PluginEntry) => {
  if (entry.installed?.hasIcon && !brokenIcons.value[entry.id]) brokenIcons.value[entry.id] = true;
  else brokenRegistryIcons.value[entry.id] = true;
};
const entryInitials = (entry: PluginEntry) => entry.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2);
const entryNotRunning = (entry: PluginEntry) =>
  !!entry.installed && entry.installed.enabled && !!entry.installed.runState && entry.installed.runState !== 'running';

const updatableEntries = computed(() => installedEntries.value.filter(e => e.hasUpdate));

// Update every plugin that has one, one after the other.
const updatingAll = ref<{ done: number; total: number } | null>(null);
const updateAll = async () => {
  if (updatingAll.value) return;
  const targets = updatableEntries.value.map(e => ({ id: e.id, name: e.name }));
  const failed: string[] = [];
  updatingAll.value = { done: 0, total: targets.length };
  loadError.value = null;
  try {
    for (const target of targets) {
      updatingAll.value = { done: updatingAll.value.done + 1, total: targets.length };
      try {
        await updatePlugin(target.id);
      } catch (error) {
        console.error(`Error updating ${target.id}:`, error);
        failed.push(target.name);
      }
    }
  } finally {
    updatingAll.value = null;
    await loadPlugins();
  }
  if (failed.length > 0) loadError.value = `Could not update: ${failed.join(', ')}`;
};

const updateToLabel = (version: string | null) => `Update to ${version || ''}`;
const needsLabel = (version: string | null) => `Needs ncSender ${version || ''}`;

// The install dialog is small while it shows progress or a result.
const installCompact = computed(() =>
  installing.value || installSuccess.value || installCategoryConflict.value || installMethod.value === 'registry'
);

onMounted(() => {
  loadPlugins();
  loadRegistryPlugins();

  unsubscribePluginsChanged = api.on('plugins:tools-changed', () => {
    loadPlugins();
  });
});

onBeforeUnmount(() => {
  if (unsubscribePluginsChanged) {
    unsubscribePluginsChanged();
    unsubscribePluginsChanged = null;
  }
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
  flex: 1;
  min-height: 0;
}

.plugins-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.plugins-scrollable {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
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
  justify-content: center;
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

/* Touch-friendly Install Plugin button in the header — scoped so it doesn't
   affect the smaller .btn instances in dialogs, per-row actions, or registry
   lists elsewhere in this file. */
.plugins-header .btn {
  min-height: 44px;
  padding: 12px 22px;
  font-size: 0.95rem;
  gap: 8px;
}
.plugins-header .btn svg {
  width: 18px;
  height: 18px;
}

.btn-icon {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px;
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
  gap: var(--gap-sm);
}

.plugin-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  padding: var(--gap-md);
  transition: border-color 0.2s ease;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--gap-md);
  align-items: center;
}

.plugin-card:hover {
  border-color: var(--color-accent);
}

.plugin-thumbnail {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.plugin-thumbnail:has(.plugin-icon-placeholder) {
  background: transparent;
  border-radius: 0;
}

.plugin-thumbnail svg {
  opacity: 0.5;
}

.plugin-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.plugin-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.plugin-title-row {
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
  font-size: 0.85rem;
  margin: 0;
}

.plugin-meta {
  display: flex;
  gap: var(--gap-md);
  flex-wrap: wrap;
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
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.install-dialog--compact {
  height: auto;
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

.install-hint code {
  word-break: break-all;
  white-space: normal;
  display: inline-block;
}

.example-url-wrapper {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  margin-top: 4px;
}

.example-url {
  flex: 1;
  user-select: all;
  cursor: text;
}

.btn-copy {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 4px 6px;
  cursor: pointer;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.btn-copy:hover {
  background: var(--color-surface-muted);
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.btn-copy svg {
  display: block;
}

.install-dialog .btn {

}

.install-tabs {
  display: flex;
  gap: var(--gap-sm);
  margin-bottom: var(--gap-lg);
  border-bottom: 2px solid var(--color-border);
}

.tab-button {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: var(--gap-sm) var(--gap-md);
  margin-bottom: -2px;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
}

.tab-button:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-muted);
}

.tab-button.active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}

.tab-button svg {
  width: 18px;
  height: 18px;
}

.install-method-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.zip-content-centered {
  width: 100%;
  max-width: 600px;
  display: flex;
  flex-direction: column;
  gap: var(--gap-lg);
  margin: auto;
}

.zip-instruction {
  margin: 0;
  color: var(--color-text-primary);
  text-align: center;
  font-size: 1rem;
}

.install-method-content p {
  margin: 0;
  color: var(--color-text-primary);
}

.url-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.url-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace;
  transition: border-color 0.2s ease;
}

.url-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.url-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.install-note {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: var(--radius-small);
  padding: var(--gap-sm) var(--gap-md);
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.install-note code {
  background: rgba(59, 130, 246, 0.15);
  padding: 2px 6px;
  border-radius: 3px;
}

.install-note svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: #3b82f6;
}

.file-input-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-sm);
}

.file-input {
  display: none;
}

.btn-secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  white-space: nowrap;
}

.btn-secondary:hover {
  background: var(--color-surface);
}

.file-name {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  text-align: center;
  word-break: break-all;
}

.install-actions {
  display: flex;
  justify-content: center;
  gap: var(--gap-sm);
  margin-top: var(--gap-md);
}

.install-actions .btn {
  display: flex;
  align-items: center;
  justify-content: center;
}

.install-close-btn {
  padding: 12px 24px !important;
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

.install-dialog:not(.install-dialog--compact) .installing-state,
.install-dialog:not(.install-dialog--compact) .success-state {
  flex: 1;
  height: 100%;
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
  font-size: 1rem;
  font-weight: 400;
  color: var(--color-text-primary);
}

.upload-form {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.upload-form p {
  margin-bottom: var(--gap-sm);
}

.zip-input-section {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}

.zip-divider {
  text-align: center;
  position: relative;
  margin: var(--gap-sm) 0;
}

.zip-divider span {
  background: var(--color-surface);
  padding: 0 var(--gap-md);
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  font-weight: 500;
  position: relative;
  z-index: 1;
}

.zip-divider::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--color-border);
}

.registry-search {
  margin-bottom: var(--gap-md);
}

.loading-registry {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--gap-xl);
  text-align: center;
  color: var(--color-text-secondary);
}

.loading-registry .loading-spinner {
  width: 32px;
  height: 32px;
  margin-bottom: var(--gap-md);
}

.no-plugins {
  text-align: center;
  padding: var(--gap-xl);
  color: var(--color-text-secondary);
}

.registry-list {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.registry-plugin {
  display: flex;
  align-items: center;
  gap: var(--gap-md);
  padding: var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  transition: all 0.2s ease;
}

.registry-plugin:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.registry-plugin-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.registry-plugin-icon:has(img) {
  background: var(--color-surface);
  border-radius: var(--radius-small);
}

.registry-plugin-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.registry-plugin-icon svg {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.registry-plugin-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.registry-plugin-info h4 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.registry-plugin-description {
  margin: 0 0 0 0 !important;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.registry-plugin-meta {
  display: flex;
  align-items: center;
  gap: var(--gap-md);
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.registry-plugin-author {
  display: flex;
  align-items: center;
  gap: 4px;
}

.registry-plugin-version {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace;
}

.registry-plugin-actions {
  flex-shrink: 0;
}

.registry-plugin-actions .btn {
  min-width: 100px;
}

.config-panel-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.config-panel-header {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.config-header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-md);
}

.config-panel-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.btn-back {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px 12px;
  cursor: pointer;
  color: var(--color-text-primary);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
}

.btn-back:hover {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.config-panel-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.config-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  overflow: hidden;
}

.config-panel-content :deep(h1),
.config-panel-content :deep(h2),
.config-panel-content :deep(h3),
.config-panel-content :deep(h4) {
  margin-top: 0;
  color: var(--color-text-primary);
}

.config-panel-content :deep(label) {
  display: block;
  margin-bottom: var(--gap-xs);
  font-weight: 500;
  color: var(--color-text-primary);
}

.config-panel-content :deep(input[type="text"]),
.config-panel-content :deep(input[type="number"]),
.config-panel-content :deep(textarea) {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-family: inherit;
}

.config-panel-content :deep(input[type="text"]:focus),
.config-panel-content :deep(input[type="number"]:focus),
.config-panel-content :deep(textarea:focus) {
  outline: none;
  border-color: var(--color-accent);
}

.config-panel-content :deep(button) {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: var(--radius-small);
  cursor: pointer;
  font-weight: 500;
  transition: opacity 0.2s ease;
}

.config-panel-content :deep(button:hover) {
  opacity: 0.9;
}

.plugins-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 0 var(--gap-md) var(--gap-md) var(--gap-md);
}

.plugins-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 20px;
}

.section-header {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}

.plugins-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plugin-row {
  display: grid;
  grid-template-columns: 24px 64px 1fr auto;
  gap: 16px;
  align-items: center;
  padding: 16px;
  padding-left: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  transition: all 0.15s ease;
  min-height: 80px;
}

.plugin-row:hover {
  background: var(--color-surface-muted);
}

.plugin-row[draggable="true"] {
  cursor: move;
}

.plugin-row[draggable="true"]:active {
  cursor: grabbing;
}

.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  cursor: grab;
  opacity: 0.6;
  transition: opacity 0.2s ease;
  height: 100%;
  min-height: 48px;
}

.drag-handle svg {
  width: 20px;
  height: 20px;
}

.plugin-row:hover .drag-handle {
  opacity: 1;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle-placeholder {
  width: 24px;
}

.plugin-icon-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.plugin-icon-small {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-small);
  object-fit: contain;
}

.plugin-icon-placeholder {
  width: 64px;
  height: 64px;
  opacity: 0.6;
}

.plugin-info-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.plugin-name-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.plugin-name-text {
  font-weight: 600;
  color: var(--color-text-primary);
  font-size: 0.95rem;
}

.plugin-meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.plugin-category-text {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  text-transform: capitalize;
  background: var(--color-surface-muted);
  padding: 2px 8px;
  border-radius: 12px;
}

.plugin-version-text {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  background: var(--color-surface-muted);
  padding: 2px 8px;
  border-radius: 12px;
}

.plugin-installed-text {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
}

.status-enabled {
  background: rgba(46, 160, 67, 0.15);
  color: #2ea043;
}

.status-disabled {
  background: rgba(128, 128, 128, 0.15);
  color: var(--color-text-secondary);
}

.status-not-running {
  background: rgba(248, 113, 113, 0.15);
  color: var(--color-danger, #f87171);
}

.plugin-run-problem {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  font-size: 0.85rem;
  color: var(--color-danger, #f87171);
}

.plugin-retry-btn {
  flex-shrink: 0;
  min-height: 32px;
  padding: 4px 14px;
  border: 1px solid var(--color-danger, #f87171);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.plugin-retry-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.plugin-actions-cell {
  display: flex;
  gap: 8px;
  align-items: center;
}

.plugin-version-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.plugin-version-text.clickable {
  cursor: pointer;
  color: var(--color-accent);
  text-decoration: underline;
}

.plugin-version-text.clickable:hover {
  opacity: 0.8;
}

.plugin-version-text.has-update {
  font-weight: 600;
}

/* "Update" superscript badge — sits slightly above baseline next to
   the version link, styled as a solid amber pill so it reads as an
   attention affordance without competing with the row's primary
   status chip. Rendered as a sibling of .plugin-version-text (not a
   child) so the version link's underline doesn't bleed into it. */
.update-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  background: #10b981;
  color: #fff;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  line-height: 1;
  vertical-align: super;
  margin-left: -2px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
.update-badge:hover {
  filter: brightness(1.05);
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.update-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  padding: var(--gap-lg);
}

.update-dialog h3 {
  margin: 0;
  font-size: 1.2rem;
  color: var(--color-text-primary);
}

.updating-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-md);
  padding: var(--gap-xl) 0;
}

.loading-spinner {
  border: 3px solid var(--color-border);
  border-top: 3px solid var(--color-accent);
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.update-info {
  display: flex;
  flex-direction: column;
  gap: var(--gap-lg);
}

.version-info {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  padding: var(--gap-md);
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
}

.version-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.version-row .label {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.version-row .version {
  font-weight: 600;
  color: var(--color-text-primary);
}

.version-row .new-version {
  color: var(--color-accent);
}

.version-row .date {
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.release-notes {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.release-notes h4 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text-primary);
}

.notes-content {
  padding: var(--gap-md);
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
  border: 1px solid var(--color-border);
  max-height: 300px;
  overflow-y: auto;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-primary);
}

.notes-content :deep(h1),
.notes-content :deep(h2),
.notes-content :deep(h3) {
  margin: 8px 0 4px 0;
  font-weight: 600;
}

.notes-content :deep(h1) { font-size: 1.2rem; }
.notes-content :deep(h2) { font-size: 1.1rem; }
.notes-content :deep(h3) { font-size: 1rem; }

.notes-content :deep(h1:first-child),
.notes-content :deep(h2:first-child),
.notes-content :deep(h3:first-child) {
  margin-top: 0;
}

.notes-content :deep(ul) {
  margin: 4px 0;
  padding-left: 20px;
}

.notes-content :deep(a) {
  color: var(--color-accent);
  text-decoration: none;
}

.notes-content :deep(a:hover) {
  text-decoration: underline;
}

.notes-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  margin: 8px 0;
  display: block;
}

.update-actions {
  display: flex;
  gap: var(--gap-sm);
  justify-content: flex-end;
  padding-top: var(--gap-md);
  border-top: 1px solid var(--color-border);
}

.update-actions .btn-secondary {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.update-actions .btn-secondary:hover {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
/* ---------- plugin manager: tabs, filters, list and details ---------- */
.pm { background: var(--color-surface); }
.pm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-sm);
  padding: var(--gap-md) var(--gap-md) 0;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.pm-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.pm-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border: none;
  border-radius: 10px;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.pm-tab.active { background: var(--color-accent); color: #fff; }
.pm-tab-count { font-size: 0.8rem; opacity: 0.8; }
.pm-tab-count--alert { opacity: 1; padding: 0 7px; border-radius: 9px; background: #3b82f6; color: #fff; }
.pm-filters {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  padding: var(--gap-sm) var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.pm-search { width: 100%; }
.pm-chips { display: flex; gap: 6px; overflow-x: auto; }
.pm-chip {
  padding: 6px 12px;
  border: none;
  border-radius: 999px;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.pm-chip.active { color: var(--color-text-primary); box-shadow: inset 0 0 0 1.5px var(--color-accent); }
.pm-split { flex: 1; min-height: 0; display: flex; }
.pm-list {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: var(--gap-sm) var(--gap-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pm-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 13px;
  border: 1.5px solid transparent;
  border-radius: 14px;
  background: var(--color-surface-muted);
  cursor: pointer;
  min-width: 0;
}
.pm-row.selected { border-color: var(--color-accent); }
.pm-row--off .pm-icon, .pm-row--off .pm-info { opacity: 0.55; }
.pm-icon { width: 42px; height: 42px; border-radius: 10px; object-fit: contain; flex-shrink: 0; }
.pm-icon--large { width: 52px; height: 52px; }
.pm-icon--letters {
  display: grid;
  place-items: center;
  background: var(--color-accent);
  color: #fff;
  font-weight: 800;
}
.pm-info { flex: 1; min-width: 0; }
.pm-info h3 { margin: 0; font-size: 1.15rem; }
.pm-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pm-name-text { font-weight: 700; }
.pm-tag {
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: color-mix(in srgb, #3b82f6 18%, transparent);
  color: #3b82f6;
}
.pm-tag--official { background: color-mix(in srgb, var(--color-accent) 16%, transparent); color: var(--color-accent); }
.pm-meta { display: flex; gap: 6px; flex-wrap: wrap; color: var(--color-text-secondary); font-size: 0.82rem; }
.pm-meta span + span::before { content: "· "; }
.pm-update-pill {
  padding: 1px 9px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  color: var(--color-accent);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.pm-desc {
  margin-top: 2px;
  color: var(--color-text-secondary);
  font-size: 0.86rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pm-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.pm-btn { padding: 8px 13px; white-space: nowrap; min-width: 136px; justify-content: center; text-align: center; }
.pm-head-actions { display: flex; gap: var(--gap-sm); flex-wrap: wrap; }
/* The off switch has the row's own colour: give it an edge. */
.pm :deep(.toggle-switch__slider) { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-text-secondary) 55%, transparent); }
.pm-detail {
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid var(--color-border);
  padding: var(--gap-md);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pm-detail-empty, .pm-detail-desc { margin: 0; color: var(--color-text-secondary); }
.pm-detail-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.pm-detail-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
.pm-wide { width: 100%; justify-content: center; }
.pm-fact {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
}
.pm-fact > span { color: var(--color-text-secondary); flex-shrink: 0; }
.pm-fact b, .pm-fact a { text-align: right; overflow-wrap: anywhere; min-width: 0; }
.pm-fact a { color: var(--color-accent); font-weight: 600; }

@media (orientation: portrait) {
  .pm-split { flex-direction: column; }
  .pm-detail { width: auto; border-left: none; border-top: 1px solid var(--color-border); max-height: 42%; flex-shrink: 0; }
  .pm-row { flex-wrap: wrap; }
  .pm-actions { width: 100%; justify-content: flex-end; }
}
</style>
