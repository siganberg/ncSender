<template>
  <Dialog @close="$emit('close')" :show-header="false" size="medium" :z-index="10050">
    <div class="fb">
      <!-- Header -->
      <header class="fb__header">
        <div class="fb__title">
          <div class="fb__title-icon" :class="{ 'fb__title-icon--open': mode === 'open' }">
            <svg v-if="mode === 'save'" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div>
            <h3>{{ title }}</h3>
            <p class="fb__subtitle">{{ atRoot ? 'Choose a drive to continue' : `In ${currentDrive?.name ?? ''}` }}</p>
          </div>
        </div>
      </header>

      <!-- Breadcrumb -->
      <div class="fb__crumb-bar">
        <button
          class="fb__nav-btn"
          :disabled="!canGoUp || loading"
          @click="goUp"
          :title="canGoUp ? 'Back' : ''"
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="fb__crumb-scroll">
          <div class="fb__crumb">
            <template v-if="atRoot">
              <span class="fb__crumb-root">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                </svg>
                External drives
              </span>
            </template>
            <template v-else>
              <button
                v-for="(seg, idx) in crumbs"
                :key="idx"
                class="fb__crumb-seg"
                :class="{ 'fb__crumb-seg--current': idx === crumbs.length - 1 }"
                :disabled="loading || idx === crumbs.length - 1"
                @click="navigateTo(seg.path)"
              >
                <span>{{ seg.label }}</span>
                <svg v-if="idx < crumbs.length - 1" class="fb__crumb-sep" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
            </template>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="fb__body">
        <!-- Loading -->
        <div v-if="loading" class="fb__state">
          <div class="fb__spinner"></div>
          <p>Loading…</p>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="fb__state">
          <div class="fb__state-icon fb__state-icon--err">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <p class="fb__state-title">{{ error }}</p>
          <button class="fb__btn fb__btn--tonal" @click="refresh">Try again</button>
        </div>

        <!-- Empty: no drives -->
        <div v-else-if="atRoot && drives.length === 0" class="fb__state">
          <div class="fb__state-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 10h.01M10 10h.01" />
            </svg>
          </div>
          <p class="fb__state-title">No drives connected</p>
          <p class="fb__state-hint">Plug in a USB drive or SD card — it will show up automatically.</p>
          <div class="fb__watching">
            <span class="fb__watching-dot"></span>
            <span>Watching for drives…</span>
          </div>
        </div>

        <!-- Empty: dir has no matches -->
        <div v-else-if="!atRoot && entries.length === 0" class="fb__state">
          <div class="fb__state-icon">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <p class="fb__state-title">Empty folder</p>
          <p v-if="extLabel" class="fb__state-hint">No {{ extLabel }} files here.</p>
        </div>

        <!-- Drives (root) -->
        <ul v-else-if="atRoot" class="fb__list">
          <li
            v-for="d in drives"
            :key="d.path"
            class="fb__row fb__row--drive"
            tabindex="0"
            @click="navigateTo(d.path)"
            @keydown.enter="navigateTo(d.path)"
          >
            <div class="fb__row-icon fb__row-icon--drive">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="7" width="20" height="10" rx="2"/>
                <line x1="6" y1="12" x2="6" y2="12"/>
                <line x1="10" y1="12" x2="10" y2="12"/>
              </svg>
            </div>
            <div class="fb__row-body">
              <div class="fb__row-name">{{ d.name }}</div>
              <div class="fb__row-sub">
                <span class="fb__mono">{{ d.path }}</span>
                <span v-if="d.freeBytes != null" class="fb__pill">{{ formatBytes(d.freeBytes) }} free</span>
              </div>
            </div>
            <svg class="fb__row-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </li>
        </ul>

        <!-- Directory entries -->
        <ul v-else class="fb__list">
          <li
            v-for="e in entries"
            :key="e.path"
            class="fb__row"
            :class="{
              'fb__row--dir': e.isDirectory,
              'fb__row--file': !e.isDirectory,
              'fb__row--selected': selectedPath === e.path && !e.isDirectory,
            }"
            tabindex="0"
            @click="onRowClick(e)"
            @dblclick="onRowDblClick(e)"
            @keydown.enter="onRowClick(e)"
          >
            <div class="fb__row-icon" :class="e.isDirectory ? 'fb__row-icon--dir' : 'fb__row-icon--file'">
              <svg v-if="e.isDirectory" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/>
              </svg>
              <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div class="fb__row-body">
              <div class="fb__row-name">{{ e.name }}</div>
              <div class="fb__row-sub">
                <span v-if="e.isDirectory">Folder</span>
                <template v-else>
                  <span>{{ formatBytes(e.size) }}</span>
                  <span v-if="e.modifiedAt" class="fb__sub-sep">·</span>
                  <span v-if="e.modifiedAt">{{ formatDate(e.modifiedAt) }}</span>
                </template>
              </div>
            </div>
            <svg v-if="e.isDirectory" class="fb__row-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            <svg v-else-if="selectedPath === e.path" class="fb__row-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </li>
        </ul>
      </div>

      <!-- Save-mode filename field (Material outlined style) -->
      <div v-if="mode === 'save'" class="fb__field" :class="{ 'fb__field--disabled': atRoot || saving }">
        <label class="fb__field-label">File name</label>
        <input
          v-model="editableFilename"
          class="fb__field-input"
          :disabled="atRoot || saving"
          spellcheck="false"
          @keydown.enter="confirm"
        />
      </div>

      <div v-if="actionError" class="fb__err">{{ actionError }}</div>

      <!-- Footer -->
      <footer class="fb__footer">
        <button class="fb__btn fb__btn--text" @click="$emit('close')" :disabled="saving">
          Cancel
        </button>
        <button
          class="fb__btn fb__btn--filled"
          :disabled="!canConfirm"
          @click="confirm"
        >
          <svg v-if="mode === 'save' && !saving" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          <svg v-else-if="mode === 'open' && !saving" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          {{ confirmLabel }}
        </button>
      </footer>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import Dialog from '@/components/Dialog.vue';
import { api } from '@/lib/api';

interface Drive {
  path: string;
  name: string;
  freeBytes: number | null;
}
interface Entry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

const props = defineProps<{
  title: string;
  mode: 'open' | 'save';
  /** Filter file list to these extensions (open mode) or informational (save mode). Directories always shown. */
  extensions?: string[];
  /** Save mode: default filename shown in the input. */
  defaultFilename?: string;
  /**
   * open mode: async callback with the picked file's absolute path.
   * save mode: async callback with {targetPath, filename}. Return
   * {success, error?, writtenPath?} so this dialog can render any server
   * error inline instead of forcing the parent to catch.
   */
  onSubmit: (
    payload: { fullPath?: string; targetPath?: string; filename?: string }
  ) => Promise<{ success: boolean; error?: string; writtenPath?: string }>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'done', payload: { writtenPath?: string; openedPath?: string }): void;
}>();

const currentPath = ref<string | null>(null); // null = drives root
const drives = ref<Drive[]>([]);
const entries = ref<Entry[]>([]);
const selectedPath = ref('');
const loading = ref(true);
const error = ref('');
const editableFilename = ref(props.defaultFilename || '');
const saving = ref(false);
const actionError = ref('');

const extList = computed(() => (props.extensions || []).map(e => e.startsWith('.') ? e : '.' + e));
const extQuery = computed(() => extList.value.join(','));
const extLabel = computed(() => extList.value.join(' / '));

const atRoot = computed(() => currentPath.value === null);
const canGoUp = computed(() => !atRoot.value);

const currentDrive = computed(() =>
  atRoot.value ? null : drives.value.find(d => currentPath.value!.startsWith(d.path))
);

const crumbs = computed(() => {
  if (atRoot.value || !currentDrive.value) return [];
  const drive = currentDrive.value;
  const rel = currentPath.value!.slice(drive.path.length).replace(/^\/+/, '');
  const segs = rel ? rel.split('/').filter(Boolean) : [];
  const list: { label: string; path: string }[] = [{ label: drive.name, path: drive.path }];
  let acc = drive.path.replace(/\/+$/, '');
  for (const s of segs) {
    acc = acc + '/' + s;
    list.push({ label: s, path: acc });
  }
  return list;
});

const canConfirm = computed(() => {
  if (saving.value || loading.value) return false;
  if (props.mode === 'open') return !!selectedPath.value;
  return !atRoot.value && !!editableFilename.value.trim();
});

const confirmLabel = computed(() => {
  if (saving.value) return 'Working…';
  return props.mode === 'save' ? 'Save Here' : 'Open';
});

const loadDrives = async (silent = false) => {
  if (!silent) {
    loading.value = true;
    error.value = '';
    selectedPath.value = '';
  }
  try {
    const res = await fetch(`${api.baseUrl}/api/external-drives`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const next: Drive[] = await res.json();
    // Only mutate if the set actually changed — avoids re-render / reflow noise
    // while polling every couple of seconds.
    const same = next.length === drives.value.length &&
      next.every((d, i) => d.path === drives.value[i]?.path && d.freeBytes === drives.value[i]?.freeBytes);
    if (!same) drives.value = next;
    if (silent) error.value = '';
  } catch (e: any) {
    if (!silent) error.value = e?.message || 'Could not list drives';
  } finally {
    if (!silent) loading.value = false;
  }
};

const loadDirectory = async (path: string, silent = false) => {
  if (!silent) {
    loading.value = true;
    error.value = '';
    selectedPath.value = '';
  }
  try {
    const q = new URLSearchParams({ path });
    if (extQuery.value) q.set('ext', extQuery.value);
    const res = await fetch(`${api.baseUrl}/api/external-drives/browse?${q}`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const next: Entry[] = data.entries || [];
    const same = next.length === entries.value.length &&
      next.every((e, i) => e.path === entries.value[i]?.path && e.size === entries.value[i]?.size);
    if (!same) entries.value = next;
    if (silent) error.value = '';
  } catch (e: any) {
    if (!silent) {
      error.value = e?.message || 'Could not list directory';
      entries.value = [];
    }
  } finally {
    if (!silent) loading.value = false;
  }
};

const navigateTo = async (path: string | null) => {
  currentPath.value = path;
  if (path === null) await loadDrives();
  else await loadDirectory(path);
};

const goUp = () => {
  if (atRoot.value) return;
  const drive = currentDrive.value;
  if (!drive || currentPath.value === drive.path) {
    navigateTo(null);
    return;
  }
  const parent = currentPath.value!.replace(/\/+$/, '').replace(/\/[^/]+$/, '') || drive.path;
  navigateTo(parent.startsWith(drive.path) ? parent : drive.path);
};

const refresh = () => atRoot.value ? loadDrives() : loadDirectory(currentPath.value!);

const onRowClick = (e: Entry) => {
  if (e.isDirectory) {
    navigateTo(e.path);
  } else if (props.mode === 'open') {
    selectedPath.value = e.path;
  } else {
    editableFilename.value = e.name;
  }
};
const onRowDblClick = (e: Entry) => {
  if (e.isDirectory) return;
  if (props.mode === 'open') {
    selectedPath.value = e.path;
    confirm();
  }
};

const confirm = async () => {
  if (!canConfirm.value) return;
  saving.value = true;
  actionError.value = '';
  try {
    if (props.mode === 'open') {
      const r = await props.onSubmit({ fullPath: selectedPath.value });
      if (!r.success) {
        actionError.value = r.error || 'Open failed';
      } else {
        emit('done', { openedPath: selectedPath.value });
      }
    } else {
      const r = await props.onSubmit({
        targetPath: currentPath.value!,
        filename: editableFilename.value.trim(),
      });
      if (!r.success) {
        actionError.value = r.error || 'Save failed';
      } else {
        emit('done', { writtenPath: r.writtenPath });
      }
    }
  } catch (e: any) {
    actionError.value = e?.message || 'Action failed';
  } finally {
    saving.value = false;
  }
};

const formatBytes = (b: number) => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};
const formatDate = (iso: string) => {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hr ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay} d ago`;
    return d.toLocaleDateString();
  } catch { return iso; }
};

watch(() => props.defaultFilename, (v) => { if (v && !editableFilename.value) editableFilename.value = v; });

// Poll the current view every 2s so USB insert/eject is reflected without
// user intervention. Skip while we're actively confirming a save/open so
// the mutation isn't racing our request. If the current directory disappears
// (drive unplugged), fall back to the drives root.
let pollTimer: number | null = null;
const pollTick = async () => {
  if (saving.value) return;
  if (atRoot.value) {
    await loadDrives(true);
    return;
  }
  const stillMounted = drives.value.some(d => currentPath.value!.startsWith(d.path));
  if (!stillMounted) {
    await navigateTo(null);
    return;
  }
  await loadDirectory(currentPath.value!, true);
};

onMounted(() => {
  navigateTo(null);
  pollTimer = window.setInterval(pollTick, 2000);
});
onBeforeUnmount(() => {
  if (pollTimer !== null) window.clearInterval(pollTimer);
});
</script>

<style scoped>
/* ============ Layout ============ */
.fb {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 22px 22px;
  color: var(--color-text-primary);
  flex: 1 1 auto;
  min-height: 0;
}

/* ============ Header ============ */
.fb__header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.fb__title {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}
.fb__title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent);
  flex-shrink: 0;
}
.fb__title h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
}
.fb__subtitle {
  margin: 2px 0 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============ Breadcrumb bar ============ */
.fb__crumb-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 4px 6px 4px 4px;
  background: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
  border-radius: 12px;
  border: 1px solid var(--color-border);
}
.fb__nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.05s ease;
  flex-shrink: 0;
}
.fb__nav-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
}
.fb__nav-btn:active:not(:disabled) { transform: scale(0.94); }
.fb__nav-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.fb__crumb-scroll {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.fb__crumb-scroll::-webkit-scrollbar { display: none; }

.fb__crumb {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  white-space: nowrap;
}
.fb__crumb-root {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  font-style: italic;
}
.fb__crumb-seg {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
  font: inherit;
  font-size: 0.88rem;
  border-radius: 8px;
  transition: background 0.15s ease, color 0.15s ease;
}
.fb__crumb-seg:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
}
.fb__crumb-seg--current {
  color: var(--color-accent);
  font-weight: 600;
  cursor: default;
}
.fb__crumb-sep {
  color: var(--color-text-secondary);
  opacity: 0.5;
  flex-shrink: 0;
  margin-left: 4px;
}

/* ============ Body ============ */
.fb__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
  border: 1px solid var(--color-border);
  scrollbar-width: thin;
}

/* ============ States (loading / empty / error) ============ */
.fb__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 44px 16px;
  gap: 12px;
  color: var(--color-text-secondary);
  text-align: center;
}
.fb__state-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 62px;
  height: 62px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  color: var(--color-accent);
}
.fb__state-icon--err {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}
.fb__state-title {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
.fb__state-hint {
  margin: 0;
  font-size: 0.82rem;
  opacity: 0.8;
  max-width: 380px;
}
.fb__watching {
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  color: var(--color-accent);
  font-size: 0.78rem;
  font-weight: 500;
}
.fb__watching-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-accent);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-accent) 60%, transparent);
  animation: fb-pulse 1.6s ease-out infinite;
}
@keyframes fb-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-accent) 55%, transparent); }
  70% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--color-accent) 0%, transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-accent) 0%, transparent); }
}

.fb__spinner {
  width: 34px;
  height: 34px;
  border: 3px solid color-mix(in srgb, var(--color-accent) 20%, transparent);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: fbspin 0.9s linear infinite;
}
@keyframes fbspin { to { transform: rotate(360deg); } }

/* ============ List rows ============ */
.fb__list {
  list-style: none;
  margin: 0;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fb__row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  cursor: pointer;
  outline: none;
  transition: background 0.12s ease, transform 0.05s ease;
  position: relative;
}
.fb__row:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
}
.fb__row:focus-visible {
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 40%, transparent);
}
.fb__row:active {
  transform: scale(0.995);
}
.fb__row--selected {
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 45%, transparent);
}
.fb__row--selected:hover {
  background: color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.fb__row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  flex-shrink: 0;
}
.fb__row-icon--drive {
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent);
}
.fb__row-icon--dir {
  background: color-mix(in srgb, #f59e0b 14%, transparent);
  color: #f59e0b;
}
.fb__row-icon--file {
  background: color-mix(in srgb, var(--color-text-primary) 8%, transparent);
  color: var(--color-text-secondary);
}
.fb__row--selected .fb__row-icon--file {
  background: color-mix(in srgb, var(--color-accent) 16%, transparent);
  color: var(--color-accent);
}

.fb__row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.fb__row-name {
  font-size: 0.94rem;
  font-weight: 500;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}
.fb__row-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  overflow: hidden;
}
.fb__sub-sep { opacity: 0.4; }
.fb__mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  opacity: 0.8;
}
.fb__pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent);
  flex-shrink: 0;
}
.fb__row-chev {
  color: var(--color-text-secondary);
  opacity: 0.5;
  flex-shrink: 0;
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.fb__row:hover .fb__row-chev { opacity: 0.9; transform: translateX(2px); }
.fb__row-check {
  color: var(--color-accent);
  flex-shrink: 0;
}

/* ============ Save-mode filename field (Material outlined) ============ */
.fb__field {
  position: relative;
  padding-top: 6px;
}
.fb__field-label {
  display: block;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 0 0 6px 2px;
}
.fb__field-input {
  width: 100%;
  height: 48px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1.5px solid var(--color-border);
  background: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
  color: var(--color-text-primary);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.9rem;
  transition: border-color 0.15s ease, background 0.15s ease;
  box-sizing: border-box;
}
.fb__field-input:focus {
  outline: none;
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
}
.fb__field--disabled .fb__field-input {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ============ Errors ============ */
.fb__err {
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px;
  color: #f87171;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ============ Footer + buttons ============ */
.fb__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 4px;
  flex-shrink: 0;
}
/* Matches ncSender's .btn look: 10px radius, 10px 18px padding, 0.95rem/600 */
.fb__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 10px 20px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.05s ease, box-shadow 0.15s ease, opacity 0.15s ease;
  white-space: nowrap;
}
.fb__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.fb__btn:hover:not(:disabled) { transform: translateY(-1px); }

/* Primary (Open / Save) — accent solid */
.fb__btn--filled {
  background: var(--color-accent);
  color: #0d1117;
}
.fb__btn--filled:hover:not(:disabled) {
  filter: brightness(1.08);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-accent) 35%, transparent);
}

/* Tonal (retry / secondary action inside empty state) */
.fb__btn--tonal {
  background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  color: var(--color-accent);
  border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
}
.fb__btn--tonal:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-accent) 22%, transparent);
}

/* Cancel — subtle red tint, outlined */
.fb__btn--text {
  background: color-mix(in srgb, var(--color-danger, #e74c3c) 10%, transparent);
  color: var(--color-danger, #e74c3c);
  border-color: color-mix(in srgb, var(--color-danger, #e74c3c) 28%, transparent);
}
.fb__btn--text:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-danger, #e74c3c) 18%, transparent);
  border-color: color-mix(in srgb, var(--color-danger, #e74c3c) 45%, transparent);
}
</style>
