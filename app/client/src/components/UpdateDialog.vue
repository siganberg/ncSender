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
        <div class="status-text">
          <span>{{ statusText }}</span>
          <span v-if="props.state.error" class="status-text__error">{{ props.state.error }}</span>
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
          <h3>Release Notes</h3>
          <p v-if="props.state.releaseName" class="notes-subtitle">{{ props.state.releaseName }}</p>
        </header>
        <div class="notes-body" v-html="releaseNotesHtml"></div>
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
          <template v-if="props.state.canInstall">
            <button
              class="btn btn-primary"
              @click="emit('download-install')"
              :disabled="!props.state.isAvailable || props.state.isChecking || props.state.isDownloading"
            >
              <span v-if="props.state.isDownloading" class="spinner"></span>
              <span>{{ props.state.isDownloading ? 'Downloading…' : 'Download & Install' }}</span>
            </button>
            <button
              class="btn btn-ghost"
              v-if="props.state.releaseUrl"
              @click="openGitHubRelease"
              :disabled="props.state.isChecking"
            >
              Release Page
            </button>
          </template>
          <button
            v-else
            class="btn btn-primary"
            @click="openGitHubRelease"
            :disabled="!props.state.isAvailable || !props.state.releaseUrl || props.state.isChecking"
          >
            <span>Download Update</span>
          </button>
        </div>
      </footer>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
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

const releaseNotesText = computed(() => {
  const notes = props.state.releaseNotes?.trim();
  if (!notes) {
    return 'No release notes were provided for this update.';
  }
  return notes;
});

const releaseNotesHtml = computed(() => {
  const notes = releaseNotesText.value;
  if (!notes || notes === 'No release notes were provided for this update.') {
    return `<p style="color: var(--color-text-secondary);">${notes}</p>`;
  }

  // Simple markdown to HTML conversion
  return notes
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // Bullet points
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Wrap lists
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // Line breaks - single break for paragraphs
    .replace(/\n\n/g, '<br>')
    .replace(/\n/g, ' ');
});

const openGitHubRelease = () => {
  if (props.state.releaseUrl) {
    // Open in full browser window (maximized)
    const width = window.screen.availWidth;
    const height = window.screen.availHeight;
    window.open(props.state.releaseUrl, '_blank', `width=${width},height=${height},left=0,top=0,noopener,noreferrer`);
  }
};
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

.notes-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.notes-subtitle {
  margin: 4px 0 0 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.notes-body {
  background: var(--color-surface-muted);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid var(--color-border);
  max-height: 260px;
  overflow-y: auto;
  line-height: 1.6;
}

.notes-body :deep(h1),
.notes-body :deep(h2),
.notes-body :deep(h3) {
  margin: 12px 0 6px 0;
  font-weight: 600;
  color: var(--color-text-primary);
}

.notes-body :deep(h1) {
  font-size: 1.5rem;
}

.notes-body :deep(h2) {
  font-size: 1.3rem;
}

.notes-body :deep(h3) {
  font-size: 1.1rem;
}

.notes-body :deep(h1:first-child),
.notes-body :deep(h2:first-child),
.notes-body :deep(h3:first-child) {
  margin-top: 0;
}

.notes-body :deep(ul) {
  margin: 4px 0;
  padding-left: 24px;
}

.notes-body :deep(li) {
  margin: 2px 0;
  color: var(--color-text-primary);
}

.notes-body :deep(a) {
  color: var(--color-accent);
  text-decoration: none;
}

.notes-body :deep(a:hover) {
  text-decoration: underline;
}

.notes-body :deep(strong) {
  font-weight: 600;
}

.notes-body :deep(em) {
  font-style: italic;
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
