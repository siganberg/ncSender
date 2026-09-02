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
            Channel: <button
              class="channel-toggle"
              @click="toggleChannel"
              :disabled="props.state.isChecking || props.state.isDownloading || props.state.isInstalling"
            >{{ channelLabel }}</button>
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
          <span class="summary-value">v{{ props.state.latestVersion }}<sup v-if="showLatestBadge" class="new-badge" title="Different from installed version">NEW</sup></span>
        </div>
        <div class="summary-card" v-if="formattedReleaseDate">
          <span class="summary-label">Released</span>
          <span class="summary-value">{{ formattedReleaseDate }}</span>
        </div>
      </section>

      <!-- Status panel only appears when there's something actionable —
           download progress, install spinner, error, or a downloaded
           asset waiting. The "Update available" case is signaled by
           the NEW badge on the Latest Release card instead, so we
           don't waste vertical space on a static status card. -->
      <section
        v-if="showStatusPanel"
        class="update-dialog__status"
        :class="{
          'update-dialog__status--error': Boolean(props.state.error),
          'update-dialog__status--installing': props.state.isInstalling
        }"
      >
        <div v-if="props.state.error || props.state.isDownloading || props.state.isInstalling" class="status-text">
          <span>{{ statusText }}</span>
          <span v-if="props.state.error" class="status-text__error">{{ props.state.error }}</span>
        </div>
        <div v-if="props.state.isDownloading" class="status-progress">
          <div class="progress-bar">
            <div class="progress-bar__fill" :style="{ width: downloadPercentText }"></div>
          </div>
          <div class="progress-label">{{ downloadPercentText }}</div>
        </div>
        <div v-if="props.state.isInstalling" class="status-installing">
          <div class="installing-spinner"></div>
          <span class="installing-text">Installing update and restarting application…</span>
        </div>
        <div v-if="props.state.downloadPath && !props.state.isInstalling" class="download-path">
          Downloaded to <code>{{ props.state.downloadPath }}</code>
        </div>
      </section>

      <section class="dialog-section" :class="{ 'dialog-section--collapsed': !historyOpen }">
        <header class="section-header section-header--clickable" @click="historyOpen = !historyOpen">
          <div class="section-header__title">
            <h3>Version History</h3>
            <p class="section-subtitle">
              <span v-if="!historyOpen && selectedVersion">Selected: <strong>{{ selectedVersion.tag }}</strong> — tap to change</span>
              <span v-else>Select a version — the main action installs the one you pick.</span>
            </p>
          </div>
          <button class="section-toggle" :class="{ 'is-open': historyOpen }" aria-label="Toggle version history">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </header>
        <div v-if="historyOpen" class="versions-body">
          <div v-if="props.state.versionsLoading" class="versions-empty">
            <span class="spinner"></span>
            <span>Loading versions…</span>
          </div>
          <div v-else-if="props.state.versionsError" class="versions-empty versions-empty--error">
            {{ props.state.versionsError }}
          </div>
          <div v-else-if="!channelVersions.length" class="versions-empty">
            No {{ channelLabel.toLowerCase() }} versions found.
          </div>
          <ul v-else class="versions-list">
            <li
              v-for="v in channelVersions"
              :key="v.tag"
              class="version-row"
              :class="{
                'version-row--current': v.isCurrent,
                'version-row--selected': v.tag === selectedTag
              }"
              @click="selectVersion(v)"
            >
              <div class="version-row__left">
                <span class="version-tag">
                  {{ v.tag }}<sup v-if="v.tag === latestTag" class="new-badge" title="Latest release">NEW</sup>
                </span>
                <span v-if="v.publishedAt" class="version-date">{{ formatVersionDate(v.publishedAt) }}</span>
              </div>
              <div class="version-row__right">
                <span v-if="v.isCurrent" class="version-badge version-badge--current">Current</span>
              </div>
            </li>
          </ul>
        </div>
      </section>

      <section class="dialog-section">
        <header class="section-header">
          <h3>Release Notes</h3>
          <p v-if="selectedVersion" class="section-subtitle">{{ selectedVersion.tag }}</p>
        </header>
        <div class="notes-body" v-html="releaseNotesHtml"></div>
      </section>

      <footer class="update-dialog__actions">
        <div class="actions-left">
          <button
            class="btn btn-ghost"
            @click="emit('check')"
            :disabled="props.state.isChecking || props.state.isDownloading || props.state.isInstalling"
          >
            <span v-if="props.state.isChecking" class="spinner"></span>
            <span>Check Again</span>
          </button>
        </div>
        <div class="actions-right">
          <button class="btn btn-secondary" @click="emit('close')" :disabled="props.state.isInstalling">Close</button>
          <button
            v-if="canInstallHere"
            class="btn btn-primary"
            @click="requestInstallSelected"
            :disabled="!canInstallSelected || props.state.isChecking || props.state.isDownloading || props.state.isInstalling"
          >
            <span v-if="props.state.isDownloading || props.state.isInstalling" class="spinner"></span>
            <span>{{ installButtonLabel }}</span>
          </button>
          <button
            v-else
            class="btn btn-primary"
            @click="openGitHubRelease"
            :disabled="!selectedVersion?.releaseUrl || props.state.isChecking || props.state.isInstalling"
          >
            <span>Download Update</span>
          </button>
        </div>
      </footer>

      <div v-if="showChannelConfirm" class="channel-confirm-overlay">
        <div class="channel-confirm">
          <h3 class="channel-confirm__title">Switch to Development Channel?</h3>
          <p class="channel-confirm__message">
            Development builds may be unstable and contain bugs. New features are being tested and may not work as expected.
          </p>
          <p class="channel-confirm__message">
            You can switch back to the Stable channel at any time.
          </p>
          <div class="channel-confirm__actions">
            <button class="btn btn-secondary" @click="cancelChannelSwitch">Cancel</button>
            <button class="btn btn-primary" @click="confirmChannelSwitch">Continue</button>
          </div>
        </div>
      </div>

      <div v-if="pendingInstall" class="channel-confirm-overlay">
        <div class="channel-confirm">
          <h3 class="channel-confirm__title">
            {{ isDowngrade ? `Roll back to ${pendingInstall.tag}?` : `Install ${pendingInstall.tag}?` }}
          </h3>
          <p class="channel-confirm__message">
            You are currently on <strong>v{{ props.state.currentVersion }}</strong>.
            The application will download {{ pendingInstall.tag }}, install it, and restart automatically.
          </p>
          <p v-if="isDowngrade" class="channel-confirm__message">
            <strong>Note:</strong> rolling back to an older version can leave newer settings unsupported.
            Existing settings will not be automatically migrated.
          </p>
          <div class="channel-confirm__actions">
            <button class="btn btn-secondary" @click="cancelInstall">Cancel</button>
            <button class="btn btn-primary" @click="confirmInstall">
              {{ isDowngrade ? 'Roll back' : 'Install' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import Dialog from './Dialog.vue';
import { renderReleaseNotesMarkdown } from '../lib/release-notes';

interface VersionEntry {
  tag: string;
  version: string;
  publishedAt: string | null;
  notes: string;
  isPrerelease: boolean;
  isCurrent: boolean;
  canInstall: boolean;
  releaseUrl: string | null;
}

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
  isInstalling: boolean;
  downloadPercent: number;
  downloadPath: string | null;
  canInstall: boolean;
  error: string | null;
  channel: string;
  versions: VersionEntry[];
  versionsLoaded: boolean;
  versionsLoading: boolean;
  versionsError: string | null;
  installingVersionTag: string | null;
}

const props = defineProps<{
  state: UpdateDialogState;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'check'): void;
  (e: 'download-install'): void;
  (e: 'download-only'): void;
  (e: 'channel-change', channel: string): void;
  (e: 'load-versions'): void;
  (e: 'install-version', tag: string): void;
}>();

const channelLabel = computed(() => {
  const channel = props.state.channel || 'stable';
  if (channel === 'development') return 'Development';
  if (channel === 'dev') return 'Development (test)';
  return 'Stable';
});

const showChannelConfirm = ref(false);

const toggleChannel = () => {
  const current = props.state.channel || 'stable';
  if (current === 'stable') {
    showChannelConfirm.value = true;
  } else {
    emit('channel-change', 'stable');
  }
};

const confirmChannelSwitch = () => {
  showChannelConfirm.value = false;
  emit('channel-change', 'development');
};

const cancelChannelSwitch = () => {
  showChannelConfirm.value = false;
};

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

// Release notes now derive from whatever version the user has selected
// in the list — not the "check for updates" latest-release payload.
// Selection defaults to the latest entry for the current channel on
// first load (see the watch below).
const releaseNotesText = computed(() => {
  const notes = selectedVersion.value?.notes?.trim();
  if (!notes) {
    return 'No release notes were provided for this version.';
  }
  return notes;
});

const releaseNotesHtml = computed(() => {
  const notes = releaseNotesText.value;
  if (!notes || notes.startsWith('No release notes')) {
    return `<p style="color: var(--color-text-secondary);">${notes}</p>`;
  }
  return renderReleaseNotesMarkdown(notes);
});

const openGitHubRelease = () => {
  const url = selectedVersion.value?.releaseUrl || props.state.releaseUrl;
  if (url) {
    const width = window.screen.availWidth;
    const height = window.screen.availHeight;
    window.open(url, '_blank', `width=${width},height=${height},left=0,top=0,noopener,noreferrer`);
  }
};

// Whether the primary action can install in-place on this platform.
// Falls back to the selected version's flag; if nothing's selected yet
// we look at what the server reported for the check payload.
const canInstallHere = computed(() => {
  if (selectedVersion.value) return Boolean(selectedVersion.value.canInstall);
  return Boolean(props.state.canInstall);
});

const pendingInstall = ref<VersionEntry | null>(null);

// Version history is filtered per channel: stable = non-prereleases,
// development = only prereleases. The selection state stays scoped to
// the visible list — switching channel resets selection to that
// channel's latest.
const channelVersions = computed(() => {
  const channel = props.state.channel || 'stable';
  const wantPrerelease = channel !== 'stable';
  return props.state.versions.filter((v) => Boolean(v.isPrerelease) === wantPrerelease);
});

const latestTag = computed(() => channelVersions.value[0]?.tag ?? null);

// NEW badge on the Latest Release card: shown whenever the installed
// version differs from what the server considers latest — covers both
// "update available" and "user is on a newer/beta build than the
// current channel's latest". Falls back to false if either string is
// missing (dialog opened before the check completed).
const showLatestBadge = computed(() => {
  const cur = props.state.currentVersion;
  const latest = props.state.latestVersion;
  return Boolean(cur && latest && cur !== latest);
});

const selectedTag = ref<string | null>(null);
const selectedVersion = computed<VersionEntry | null>(() => {
  if (!selectedTag.value) return null;
  return channelVersions.value.find((v) => v.tag === selectedTag.value) ?? null;
});

// Version history starts collapsed so the release notes get the full
// vertical space by default. Clicking the header expands the list;
// picking a version auto-collapses it again.
const historyOpen = ref(false);

// Whether the current selection was made by the user (from the history
// list) rather than defaulted by the watcher below. Only a deliberate pick
// should survive the list changing underneath it.
const userPicked = ref(false);

const selectVersion = (v: VersionEntry) => {
  selectedTag.value = v.tag;
  userPicked.value = true;
  historyOpen.value = false;
};

// Default the selection to the newest release in the visible channel
// whenever the list changes or the user switches channel.
//
// This used to keep the existing selection as long as it was still in the
// list. That is wrong for the automatic default: when a newer release
// appears, the previous latest is still listed, so the selection stayed on
// it — the Latest card and the header pill both showed the new version while
// the button read "Already installed" against the old selection, and only a
// restart (which reset the ref) cleared it. Seen on the kiosk and on Windows.
//
// Now the default always tracks the newest release; a version the user chose
// by hand is kept while it remains visible, and switching channel drops it.
watch(
  () => [channelVersions.value.map((v) => v.tag).join(','), props.state.channel],
  ([, channel], [, prevChannel]) => {
    const visible = channelVersions.value;
    if (!visible.length) {
      selectedTag.value = null;
      userPicked.value = false;
      return;
    }
    if (channel !== prevChannel) userPicked.value = false;
    const stillVisible = selectedTag.value && visible.some((v) => v.tag === selectedTag.value);
    if (!(userPicked.value && stillVisible)) {
      selectedTag.value = visible[0].tag;
      userPicked.value = false;
    }
  },
  { immediate: true }
);

// Load versions lazily the first time the dialog mounts. The user's
// choice of channel + selection drives everything else in the dialog,
// so we can't wait for them to click a toggle to fetch the list.
onMounted(() => {
  if (!props.state.versionsLoaded && !props.state.versionsLoading) {
    emit('load-versions');
  }
});

const anyInstallInFlight = computed(() => {
  return props.state.isDownloading || props.state.isInstalling;
});

// The status card only earns its vertical space when it has something
// actionable to say. A steady "Update available" is now conveyed by the
// NEW superscript on the Latest Release card instead.
const showStatusPanel = computed(() => {
  return Boolean(
    props.state.error ||
    props.state.isDownloading ||
    props.state.isInstalling ||
    (props.state.downloadPath && !props.state.isInstalling)
  );
});

const isDowngrade = computed(() => {
  if (!pendingInstall.value) return false;
  return compareVersions(pendingInstall.value.version, props.state.currentVersion) < 0;
});

const canInstallSelected = computed(() => {
  const v = selectedVersion.value;
  return Boolean(v && v.canInstall && !v.isCurrent);
});

const installButtonLabel = computed(() => {
  if (props.state.isInstalling) return 'Installing…';
  if (props.state.isDownloading) return 'Downloading…';
  const v = selectedVersion.value;
  if (v?.isCurrent) return 'Already installed';
  return 'Download Update';
});

const requestInstallSelected = () => {
  const v = selectedVersion.value;
  if (!v || !canInstallSelected.value || anyInstallInFlight.value) return;
  pendingInstall.value = v;
};

// Reasonable semver-ish compare — good enough for x.y.z / x.y.z-beta.N.
// -1 = a < b, 0 = equal, 1 = a > b.
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    v = v.replace(/^v/, '');
    const [base, pre = ''] = v.split('-');
    const parts = base.split('.').map((n) => parseInt(n, 10) || 0);
    return { parts, pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < len; i++) {
    const av = pa.parts[i] ?? 0;
    const bv = pb.parts[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (pa.pre < pb.pre) return -1;
  if (pa.pre > pb.pre) return 1;
  return 0;
}

const confirmInstall = () => {
  const target = pendingInstall.value;
  pendingInstall.value = null;
  if (target) emit('install-version', target.tag);
};

const cancelInstall = () => {
  pendingInstall.value = null;
};

const formatVersionDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
};
</script>

<style scoped>
.update-dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
  /* Fixed geometry — don't let expanding release notes push the dialog
     taller than the viewport. Version list and notes each have their
     own internal scroll so the outer chrome stays stable. */
  width: 760px;
  max-width: 100%;
  height: 860px;
  max-height: 95vh;
  box-sizing: border-box;
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

.channel-toggle {
  display: inline;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--color-accent);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}

.channel-toggle:hover:not(:disabled) {
  text-decoration-style: solid;
}

.channel-toggle:disabled {
  cursor: not-allowed;
  opacity: 0.6;
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
  /* Current Version + Latest Release share equal width (both hold a
     short "vX.Y.Z-ish" value). Released gets just enough extra space
     to fit its full timestamp on one line without stretching wider
     than necessary. */
  grid-template-columns: 1fr 1fr 1.35fr;
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
  white-space: nowrap;
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

.update-dialog__status--installing {
  background: rgba(79, 147, 255, 0.1);
  border-color: rgba(79, 147, 255, 0.4);
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

.status-installing {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.installing-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid rgba(79, 147, 255, 0.2);
  border-top-color: rgba(79, 147, 255, 1);
  border-radius: 50%;
  animation: installing-spin 1s linear infinite;
}

@keyframes installing-spin {
  to {
    transform: rotate(360deg);
  }
}

.installing-text {
  font-weight: 500;
  color: rgba(79, 147, 255, 1);
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: installing-spin 0.8s linear infinite;
}

/* Both content sections use the same simple card look. Version list is
   fixed-height + scrollable; release notes stretches to fill the
   remaining vertical space in the fixed-height dialog and scrolls
   internally when notes are long. */
.dialog-section {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface-muted);
  overflow: hidden;
}

.dialog-section:last-of-type {
  flex: 1;
  min-height: 0;
}

.section-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dialog-section--collapsed .section-header {
  border-bottom: none;
}

.section-header--clickable {
  cursor: pointer;
  user-select: none;
}

.section-header--clickable:hover {
  background: rgba(255, 255, 255, 0.03);
}

.section-header__title {
  min-width: 0;
}

.section-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.section-subtitle {
  margin: 4px 0 0 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.section-toggle {
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  border-radius: 8px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.section-toggle.is-open {
  transform: rotate(180deg);
}

.notes-body {
  padding: 16px;
  flex: 1;
  min-height: 0;
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

.notes-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  margin: 8px 0;
  display: block;
}

.versions-body {
  padding: 6px 8px;
  /* ~4 rows visible before scrolling — leaves the notes card taller. */
  max-height: 180px;
  overflow-y: auto;
}

.versions-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.versions-empty--error {
  color: #ff7a7a;
}

.versions-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  transition: background 0.15s ease;
  cursor: pointer;
  border: 1px solid transparent;
}

.version-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.version-row--selected {
  background: rgba(79, 209, 197, 0.12);
  border-color: rgba(79, 209, 197, 0.45);
}

.version-row--current {
  background: rgba(79, 209, 197, 0.05);
}

.version-tag .new-badge,
.summary-value .new-badge {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  vertical-align: super;
  background: var(--color-accent, #4fd1c5);
  color: #0d1117;
  line-height: 1.4;
}

.version-row__left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.version-tag {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-weight: 600;
  color: var(--color-text-primary);
}

.version-date {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.version-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.version-badge--pre {
  background: rgba(255, 200, 79, 0.15);
  color: #ffc84f;
  border: 1px solid rgba(255, 200, 79, 0.35);
}

.version-badge--current {
  background: rgba(79, 209, 197, 0.15);
  color: rgb(79, 209, 197);
  border: 1px solid rgba(79, 209, 197, 0.35);
}

.btn-sm {
  padding: 6px 12px;
  font-size: 0.85rem;
  border-radius: 8px;
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

.channel-confirm-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 12px;
  z-index: 1;
}

.channel-confirm {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
  margin: 24px;
  border-radius: 12px;
  background: var(--color-surface, #1a1a2e);
  border: 1px solid var(--color-border);
  max-width: 400px;
}

.channel-confirm__title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.channel-confirm__message {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.channel-confirm__actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 4px;
}

@media (max-width: 620px) {
  .update-dialog {
    width: 100%;
  }
}
</style>
