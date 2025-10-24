<template>
  <Dialog @close="emit('close')" :show-header="false" size="small-plus">
    <div class="update-dialog">
      <header class="update-dialog__header">
        <div class="update-dialog__headline">
          <h2>Software Update</h2>
          <p class="update-dialog__channel">
            Channel: <span class="channel">{{ channelLabel }}</span>
          </p>
        </div>
        <button class="update-dialog__close" @click="emit('close')" aria-label="Close update dialog">&times;</button>
      </header>

      <section class="update-dialog__summary">
        <div class="summary-card">
          <span class="summary-label">Current Version</span>
          <span class="summary-value">v{{ props.state.currentVersion }}</span>
        </div>
        <div class="summary-card" v-if="props.state.latestVersion">
          <span class="summary-label">Latest Release</span>
          <span class="summary-value">v{{ props.state.latestVersion }}</span>
        </div>
        <div class="summary-card" v-if="formattedReleaseDate">
          <span class="summary-label">Released</span>
          <span class="summary-value">{{ formattedReleaseDate }}</span>
        </div>
      </section>

      <section class="update-dialog__status" :class="{ 'update-dialog__status--error': Boolean(props.state.error) }">
        <div class="status-header">
          <div class="status-text">
            <span>{{ statusText }}</span>
            <span v-if="props.state.error" class="status-text__error">{{ props.state.error }}</span>
          </div>
          <button class="status-copy-btn" :class="copyStatusButtonClass" @click="copyStatus">
            <span v-if="copyStatusFeedback === 'copied'">Copied!</span>
            <span v-else-if="copyStatusFeedback === 'failed'">Copy Failed</span>
            <span v-else>Copy Status</span>
          </button>
        </div>
        <div v-if="props.state.isDownloading" class="status-progress">
          <div class="progress-bar">
            <div class="progress-bar__fill" :style="{ width: downloadPercentText }"></div>
          </div>
          <div class="progress-label">{{ downloadPercentText }}</div>
        </div>
        <div v-if="props.state.downloadPath" class="download-path">
          Downloaded to <code>{{ props.state.downloadPath }}</code>
        </div>
      </section>

      <section class="update-dialog__notes">
        <header class="notes-header">
          <div>
            <h3>Release Notes</h3>
            <p v-if="props.state.releaseName" class="notes-subtitle">{{ props.state.releaseName }}</p>
          </div>
          <a
            v-if="props.state.releaseUrl"
            :href="props.state.releaseUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="notes-link"
          >
            View on GitHub
          </a>
        </header>
        <div class="notes-body">
          <pre>{{ releaseNotesText }}</pre>
        </div>
      </section>

      <footer class="update-dialog__actions">
        <div class="actions-left">
          <button
            class="btn btn-ghost"
            @click="emit('check')"
            :disabled="props.state.isChecking || props.state.isDownloading"
          >
            <span v-if="props.state.isChecking" class="spinner"></span>
            <span>Check Again</span>
          </button>
        </div>
        <div class="actions-right">
          <button class="btn btn-secondary" @click="emit('close')">Close</button>
          <button
            v-if="showDownloadOnlyButton"
            class="btn btn-primary"
            @click="emit('download-only')"
            :disabled="!props.state.isAvailable || props.state.isDownloading || props.state.isChecking"
          >
            <span v-if="props.state.isDownloading" class="spinner"></span>
            <span>Download Update</span>
          </button>
          <button
            v-else
            class="btn btn-primary"
            @click="emit('download-install')"
            :disabled="!props.state.isAvailable || props.state.isDownloading || props.state.isChecking"
          >
            <span v-if="props.state.isDownloading" class="spinner"></span>
            <span>Download & Install</span>
          </button>
        </div>
      </footer>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Dialog from './Dialog.vue';

interface UpdateDialogState {
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseDate: string | null;
  releaseNotes: string;
  releaseUrl?: string | null;
  statusMessage: string;
  isAvailable: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  downloadPercent: number;
  downloadPath: string | null;
  canInstall: boolean;
  error: string | null;
  channel: string;
}

const props = defineProps<{
  state: UpdateDialogState;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'check'): void;
  (e: 'download-install'): void;
  (e: 'download-only'): void;
}>();

const channelLabel = computed(() => {
  const channel = props.state.channel || 'stable';
  if (channel === 'dev') return 'development (test)';
  if (channel === 'beta') return 'beta';
  return 'stable';
});

const formattedReleaseDate = computed(() => {
  if (!props.state.releaseDate) return null;
  const date = new Date(props.state.releaseDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
});

const statusText = computed(() => {
  if (props.state.statusMessage) {
    return props.state.statusMessage;
  }

  return props.state.isAvailable
    ? 'A new update is available.'
    : 'You are running the latest version.';
});

const downloadPercentText = computed(() => {
  const percent = Math.max(0, Math.min(100, props.state.downloadPercent || 0));
  return `${percent.toFixed(0)}%`;
});

const statusDetails = computed(() => {
  const parts: string[] = [
    `Channel: ${channelLabel.value}`,
    `Current version: v${props.state.currentVersion}`
  ];
  if (props.state.latestVersion) {
    parts.push(`Latest version: v${props.state.latestVersion}`);
  }
  parts.push(`Status: ${statusText.value}`);
  if (props.state.error) {
    parts.push(`Error: ${props.state.error}`);
  }
  if (props.state.isDownloading) {
    parts.push(`Progress: ${downloadPercentText.value}`);
  }
  if (props.state.downloadPath) {
    parts.push(`Download path: ${props.state.downloadPath}`);
  }
  if (props.state.releaseName) {
    parts.push(`Release name: ${props.state.releaseName}`);
  }
  if (props.state.releaseUrl) {
    parts.push(`Release URL: ${props.state.releaseUrl}`);
  }
  return parts.join('\n');
});

const copyStatusFeedback = ref<'idle' | 'copied' | 'failed'>('idle');
let copyStatusTimer: ReturnType<typeof setTimeout> | null = null;

const copyStatusButtonClass = computed(() => ({
  'status-copy-btn--copied': copyStatusFeedback.value === 'copied',
  'status-copy-btn--failed': copyStatusFeedback.value === 'failed'
}));

const copyStatus = async () => {
  const text = statusDetails.value;
  if (!text) {
    return;
  }
  const reset = () => {
    copyStatusFeedback.value = 'idle';
    if (copyStatusTimer) {
      clearTimeout(copyStatusTimer);
      copyStatusTimer = null;
    }
  };
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copyStatusFeedback.value = 'copied';
      if (copyStatusTimer) clearTimeout(copyStatusTimer);
      copyStatusTimer = setTimeout(reset, 1800);
    } else {
      window.prompt('Copy update status', text);
    }
  } catch (error) {
    console.error('Failed to copy update status:', error);
    copyStatusFeedback.value = 'failed';
    if (copyStatusTimer) clearTimeout(copyStatusTimer);
    copyStatusTimer = setTimeout(reset, 2000);
    window.prompt('Copy update status', text);
  }
};

const releaseNotesText = computed(() => {
  const notes = props.state.releaseNotes?.trim();
  if (!notes) {
    return 'No release notes were provided for this update.';
  }
  return notes;
});

const showDownloadOnlyButton = computed(() => !props.state.canInstall);
</script>

<style scoped>
.update-dialog {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
  min-width: 480px;
  max-width: 640px;
}

.update-dialog__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.update-dialog__headline h2 {
  margin: 0 0 4px 0;
  font-size: 1.5rem;
  font-weight: 700;
}

.update-dialog__channel {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.update-dialog__channel .channel {
  font-weight: 600;
  color: var(--color-accent);
  text-transform: capitalize;
}

.update-dialog__close {
  background: none;
  border: none;
  font-size: 2rem;
  line-height: 1;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.update-dialog__summary {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
}

.summary-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.summary-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.update-dialog__status {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
  background: rgba(79, 209, 197, 0.08);
  border: 1px solid rgba(79, 209, 197, 0.35);
  user-select: text;
}

.update-dialog__status--error {
  background: rgba(255, 107, 107, 0.1);
  border-color: rgba(255, 107, 107, 0.35);
}

.status-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.status-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.status-text__error {
  font-size: 0.9rem;
  color: #ff7a7a;
}

.status-copy-btn {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 6px 10px;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, color 0.2s ease, border-color 0.2s ease;
  user-select: none;
}

.status-copy-btn:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-elevated);
  color: var(--color-text-primary);
}

.status-copy-btn--copied {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.status-copy-btn--failed {
  border-color: #ff7a7a;
  color: #ff7a7a;
}

.status-progress {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  overflow: hidden;
}

.progress-bar__fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 999px;
  transition: width 0.2s ease;
}

.progress-label {
  min-width: 48px;
  font-size: 0.85rem;
  font-weight: 600;
  text-align: right;
}

.download-path {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.download-path code {
  background: rgba(0, 0, 0, 0.18);
  padding: 2px 6px;
  border-radius: 6px;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

.update-dialog__notes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.notes-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.notes-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.notes-subtitle {
  margin: 4px 0 0 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.notes-link {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-accent);
  text-decoration: none;
}

.notes-link:hover {
  text-decoration: underline;
}

.notes-body {
  background: var(--color-surface-muted);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid var(--color-border);
  max-height: 260px;
  overflow-y: auto;
}

.notes-body pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.9rem;
}

.update-dialog__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.actions-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 10px;
  border: none;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  padding: 10px 18px;
  transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--color-accent);
  color: #0d1117;
}

.btn-secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}

.btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-elevated);
}

.btn-ghost:hover:not(:disabled) {
  color: var(--color-text-primary);
}

@media (max-width: 768px) {
  .update-dialog {
    min-width: auto;
    width: 100%;
  }
}
</style>
