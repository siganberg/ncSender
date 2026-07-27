<template>
  <div class="backup-tab">
    <!-- Backup -->
    <section class="panel">
      <header class="panel-header">
        <div class="panel-title-row">
          <svg class="panel-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <h3>Backup</h3>
        </div>
        <p class="panel-desc">
          Download a single <code>.ncsbackup</code> file with your settings, macros,
          tool library, and plugin configuration. Useful for moving to a new machine
          or before a major upgrade.
        </p>
      </header>

      <div class="option-list">
        <div class="option-row">
          <div class="option-info">
            <div class="option-label">Include installed plugin code</div>
            <div class="option-hint">Plugins can be reinstalled from the catalog on the new machine.</div>
          </div>
          <ToggleSwitch v-model="opts.includePluginsCode" />
        </div>

        <div class="option-row">
          <div class="option-info">
            <div class="option-label">Include command history</div>
            <div class="option-hint">History usually stays with the machine.</div>
          </div>
          <ToggleSwitch v-model="opts.includeCommandHistory" />
        </div>

        <div class="option-row">
          <div class="option-info">
            <div class="option-label">Include G-code files</div>
            <div class="option-hint">The file library can be many GBs.</div>
          </div>
          <ToggleSwitch v-model="opts.includeGcodeFiles" />
        </div>
      </div>

      <div class="panel-actions">
        <button class="btn btn--primary" @click="doExport" :disabled="exporting">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {{ exporting ? 'Preparing…' : (isKiosk ? 'Save Backup' : 'Download Backup') }}
        </button>
      </div>

      <div v-if="exportError" class="error-message">{{ exportError }}</div>
    </section>

    <!-- Restore -->
    <section class="panel">
      <header class="panel-header">
        <div class="panel-title-row">
          <svg class="panel-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4"/>
            <polyline points="7 14 12 9 17 14"/>
            <line x1="12" y1="9" x2="12" y2="21"/>
          </svg>
          <h3>Restore</h3>
        </div>
        <p class="panel-desc">
          Pick a <code>.ncsbackup</code> file to restore from. Matching settings on
          this machine will be replaced.
        </p>
      </header>

      <!-- Desktop: browser file input (unchanged). -->
      <div v-if="!isKiosk" class="restore-row">
        <input
          ref="fileInputRef"
          type="file"
          accept=".ncsbackup,.zip,application/zip"
          style="display:none"
          @change="onFileChosen"
        />
        <button class="file-picker" @click="triggerFilePicker" :disabled="importing">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span class="file-picker__name">{{ selectedFile ? truncatedName : 'Choose Backup File…' }}</span>
        </button>
        <button class="btn btn--danger" @click="askConfirmRestore" :disabled="!selectedFile || importing">
          {{ importing ? 'Restoring…' : 'Restore' }}
        </button>
      </div>

      <!-- Kiosk: open our own file browser instead of native OS picker. -->
      <div v-else class="restore-row">
        <button
          class="btn btn--danger"
          @click="showRestorePicker = true"
          :disabled="importing"
        >
          {{ importing ? 'Restoring…' : 'Choose Backup from USB…' }}
        </button>
      </div>

      <div v-if="importError" class="error-message">{{ importError }}</div>
    </section>

    <!-- Save-to-drive file browser (kiosk mode) -->
    <FileBrowserDialog
      v-if="showSavePicker"
      title="Save backup to external drive"
      mode="save"
      :extensions="['.ncsbackup']"
      :default-filename="suggestedBackupFilename"
      :on-submit="saveBackupToDrive"
      @close="showSavePicker = false"
      @done="onSavedToDrive"
    />

    <!-- Restore-from-drive file browser (kiosk mode) -->
    <FileBrowserDialog
      v-if="showRestorePicker"
      title="Restore backup from external drive"
      mode="open"
      :extensions="['.ncsbackup']"
      :on-submit="restoreFromDrive"
      @close="showRestorePicker = false"
      @done="onRestorePickerDone"
    />

    <!-- Saved-to-drive confirmation -->
    <Dialog v-if="savedInfo" @close="savedInfo = null" :show-header="false" size="small">
      <div class="restore-success">
        <div class="restore-success__icon">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
        <h3>Backup saved</h3>
        <p class="restore-success__lead saved-path">{{ savedInfo.writtenPath }}</p>
        <div class="restore-success__actions">
          <button class="btn btn--primary" @click="savedInfo = null">Got it</button>
        </div>
      </div>
    </Dialog>

    <!-- Confirmation dialog -->
    <Dialog v-if="showConfirm" @close="showConfirm = false" :show-header="false" size="small">
      <ConfirmPanel
        title="Restore backup?"
        :message="confirmMessage"
        confirm-text="Restore"
        cancel-text="Cancel"
        variant="danger"
        @confirm="doImport"
        @cancel="showConfirm = false"
      />
    </Dialog>

    <!-- Restore complete modal -->
    <Dialog v-if="restoreResult" @close="closeRestoreResult" :show-header="false" size="small-plus">
      <div class="restore-success">
        <div class="restore-success__icon">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>
        <h3>Restore complete</h3>
        <p class="restore-success__lead">Restored on this machine:</p>
        <ul class="restore-success__list">
          <li v-for="b in restoreResult.restoredBuckets" :key="b">{{ prettyBucket(b) }}</li>
        </ul>
        <div class="restore-success__actions">
          <button class="btn btn--primary" @click="closeRestoreResult">Got it</button>
        </div>
        <p class="restore-success__note">
          Some restored settings only take effect after you restart the app.
        </p>
      </div>
    </Dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { api } from '@/lib/api';
import Dialog from '@/components/Dialog.vue';
import ConfirmPanel from '@/components/ConfirmPanel.vue';
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import FileBrowserDialog from '@/components/FileBrowserDialog.vue';
import { useKioskDetection } from '@/composables/useKioskDetection';

const { isKiosk } = useKioskDetection();
const showSavePicker = ref(false);
const showRestorePicker = ref(false);
const savedInfo = ref(null);
// Suggested filename shown / editable in the save dialog. Includes a timestamp
// so multiple saves to the same drive don't collide.
const suggestedBackupFilename = computed(() => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `ncsender-backup-${ts}.ncsbackup`;
});

const opts = reactive({
  includePluginsCode: false,
  includeCommandHistory: false,
  includeGcodeFiles: false,
});

const exporting = ref(false);
const exportError = ref('');

const importing = ref(false);
const importError = ref('');
const fileInputRef = ref(null);
const selectedFile = ref(null);

const showConfirm = ref(false);
const restoreResult = ref(null);

const confirmMessage = computed(() =>
  `Restore from ${selectedFile.value?.name || 'backup'}? Matching settings on this ` +
  `machine will be replaced. This can't be undone from inside ncSender.`
);

const truncatedName = computed(() => {
  const n = selectedFile.value?.name || '';
  return n.length > 40 ? n.slice(0, 20) + '…' + n.slice(-17) : n;
});

const triggerFilePicker = () => { fileInputRef.value?.click(); };

const onFileChosen = (e) => {
  const files = e.target?.files;
  selectedFile.value = files && files[0] ? files[0] : null;
  importError.value = '';
};

const doExport = async () => {
  // Kiosk: no browser download — pop the file browser so the user can pick a
  // folder on a USB drive / SD card and save there directly.
  if (isKiosk.value) {
    exportError.value = '';
    showSavePicker.value = true;
    return;
  }

  exporting.value = true;
  exportError.value = '';
  try {
    const res = await api.exportBackup(opts);
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
    const filename = match ? match[1] : `ncsender-backup.ncsbackup`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    exportError.value = err?.message || 'Backup failed';
  } finally {
    exporting.value = false;
  }
};

// Kiosk-only save handler — FileBrowserDialog gives us the picked folder path
// and the (possibly-edited) filename. Server generates the zip, writes it, and
// returns the absolute path we then show in the "saved" confirmation modal.
const saveBackupToDrive = async ({ targetPath, filename }) => {
  const res = await fetch(`${api.baseUrl}/api/backup/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      options: {
        includePluginsCode: !!opts.includePluginsCode,
        includeCommandHistory: !!opts.includeCommandHistory,
        includeGcodeFiles: !!opts.includeGcodeFiles,
      },
      targetPath,
      filename,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    return { success: false, error: (data && data.error) || `Save failed (HTTP ${res.status})` };
  }
  return data;
};

const onSavedToDrive = ({ writtenPath }) => {
  showSavePicker.value = false;
  savedInfo.value = { writtenPath };
};

// Kiosk-only restore handler — user picks a .ncsbackup off the USB via the
// file browser; server reads it directly from disk (no upload roundtrip).
const restoreFromDrive = async ({ fullPath }) => {
  const res = await fetch(`${api.baseUrl}/api/backup/import-from-path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePath: fullPath }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.success === false) {
    return { success: false, error: (data && data.error) || `Restore failed (HTTP ${res.status})` };
  }
  restoreResult.value = data;
  return { success: true };
};

const onRestorePickerDone = () => {
  showRestorePicker.value = false;
};

const askConfirmRestore = () => {
  if (!selectedFile.value) return;
  importError.value = '';
  showConfirm.value = true;
};

const doImport = async () => {
  showConfirm.value = false;
  if (!selectedFile.value) return;
  importing.value = true;
  importError.value = '';
  try {
    const result = await api.importBackup(selectedFile.value);
    restoreResult.value = result;
  } catch (err) {
    importError.value = err?.message || 'Restore failed';
  } finally {
    importing.value = false;
  }
};

const closeRestoreResult = () => {
  restoreResult.value = null;
  selectedFile.value = null;
  if (fileInputRef.value) fileInputRef.value.value = '';
};

const BUCKET_LABELS = {
  'settings':         'App settings',
  'tools':            'Tool library',
  'macros':           'Macros',
  'plugin-registry':  'Installed plugin list',
  'plugin-config':    'Plugin configuration',
  'plugins-code':     'Plugin code',
  'command-history':  'Command history',
  'gcode-files':      'G-code files',
};
const prettyBucket = (key) => BUCKET_LABELS[key] || key;
</script>

<style scoped>
.backup-tab {
  display: flex;
  flex-direction: column;
  gap: var(--gap-lg, 20px);
}

/* Card-style panels matching .settings-section from App.vue */
.panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium, 8px);
  padding: 20px 22px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.panel-header {
  margin-bottom: 4px;
}

.panel-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.panel-icon {
  color: var(--color-accent, #1abc9c);
  flex-shrink: 0;
}

.panel-header h3 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.panel-desc {
  margin: 0 0 16px 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
.panel-desc code {
  background: var(--color-surface-muted, rgba(255, 255, 255, 0.06));
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.78rem;
}

/* Option rows with toggle on the right */
.option-list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--color-border);
}

.option-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}

.option-info {
  flex: 1;
  min-width: 0;
}

.option-label {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.option-hint {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
  font-style: italic;
}

.panel-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

/* Restore file-picker row */
.restore-row {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

.file-picker {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  height: 38px;
  background: var(--color-surface-muted, rgba(255, 255, 255, 0.03));
  border: 1px dashed var(--color-border);
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
  text-align: left;
}
.file-picker:hover:not(:disabled) {
  border-color: var(--color-accent, #1abc9c);
  color: var(--color-accent, #1abc9c);
  background: color-mix(in srgb, var(--color-accent, #1abc9c) 6%, transparent);
}
.file-picker:disabled { opacity: 0.5; cursor: not-allowed; }
.file-picker__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 38px;
  padding: 0 20px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: filter 0.15s ease, background 0.15s ease, border-color 0.15s ease;
  white-space: nowrap;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.btn--primary {
  background: var(--color-accent, #1abc9c);
  color: white;
}
.btn--primary:hover:not(:disabled) { filter: brightness(1.08); }

.btn--danger {
  background: #ef4444;
  color: white;
}
.btn--danger:hover:not(:disabled) { background: #dc2626; }

/* Errors */
.error-message {
  margin-top: 12px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: 6px;
  color: #ef4444;
  font-size: 0.85rem;
}

/* Restart-required modal */
.restore-success {
  padding: 24px;
  text-align: center;
  color: var(--color-text-primary);
}
.restore-success__icon {
  color: #22c55e;
  margin-bottom: 12px;
  display: flex;
  justify-content: center;
}
.restore-success h3 {
  margin: 0 0 12px;
  font-size: 1.1rem;
  font-weight: 600;
}
.restore-success__lead {
  margin: 0 0 8px;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}
.restore-success__list {
  margin: 0 auto 16px;
  padding: 0;
  list-style: none;
  font-size: 0.9rem;
  color: var(--color-text-primary);
}
.restore-success__list li {
  padding: 2px 0;
}
.restore-success__actions {
  display: flex;
  justify-content: center;
}
.restore-success__note {
  margin: 18px 0 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  opacity: 0.75;
  font-style: italic;
}
.saved-path {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.82rem;
  word-break: break-all;
  background: var(--color-surface-muted, rgba(255, 255, 255, 0.04));
  padding: 8px 10px;
  border-radius: 6px;
}
</style>
