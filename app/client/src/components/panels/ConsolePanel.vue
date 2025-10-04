<template>
  <section class="card" :class="{ 'card-disabled': !store.isConnected.value }">
    <header class="card__header">
      <div class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-button"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="auto-scroll-toggle" @click="autoScroll = !autoScroll" :class="{ active: autoScroll }" v-if="activeTab === 'terminal'">
        <span class="toggle-label">Auto-Scroll</span>
        <div class="toggle-switch">
          <div class="toggle-handle"></div>
        </div>
      </div>
      <div class="auto-scroll-toggle" @click="autoScrollGcode = !autoScrollGcode" :class="{ active: autoScrollGcode }" v-if="activeTab === 'gcode-viewer'">
        <span class="toggle-label">Auto-Scroll</span>
        <div class="toggle-switch">
          <div class="toggle-handle"></div>
        </div>
      </div>
    </header>

    <!-- Terminal Tab -->
    <div v-if="activeTab === 'terminal'" class="tab-content">
      <div class="console-output" :class="{ 'console-output--virtual': useTerminalIDB }" role="log" aria-live="polite" ref="consoleOutput" @scroll="onTerminalScroll">
        <template v-if="useTerminalIDB">
          <div v-if="terminalTotalLines === 0" class="empty-state">
            All clear – give me a command!
          </div>
          <template v-else>
            <div class="terminal-spacer" :style="{ height: terminalTotalHeight + 'px' }"></div>
            <div class="terminal-items" :style="{ transform: 'translateY(' + terminalOffsetY + 'px)' }">
              <article
                v-for="line in terminalVisibleLines"
                :key="line.seq ?? line.id ?? line.index"
                :class="['console-line', `console-line--${line.level}`, `console-line--${line.type}`]"
                :style="{ height: terminalRowHeight + 'px', lineHeight: terminalRowHeight + 'px' }"
              >
                <span class="timestamp">{{ line.timestamp }}{{ line.type === 'command' ? ' - ' : ' ' }}<span v-html="getStatusIcon(line)"></span></span>
                <span class="message">{{ line.message }}</span>
              </article>
            </div>
          </template>
        </template>
        <template v-else>
          <div v-if="terminalLines.length === 0" class="empty-state">
            All clear – give me a command!
          </div>
          <article
            v-for="line in terminalLines"
            :key="line.id"
            :class="['console-line', `console-line--${line.level}`, `console-line--${line.type}`]"
          >
            <span class="timestamp">{{ line.timestamp }}{{ line.type === 'command' ? ' - ' : ' ' }}<span v-html="getStatusIcon(line)"></span></span>
            <span class="message">{{ line.message }}</span>
          </article>
        </template>
      </div>
      <form class="console-input" @submit.prevent="sendCommand">
        <input
          type="text"
          :placeholder="connected ? 'Send command' : 'Connect to CNC to send commands'"
          v-model="commandToSend"
          @keydown="handleKeyDown"
          :disabled="!connected"
        />
        <button type="submit" class="primary" :disabled="!connected">Send</button>
        <button type="button" class="primary" @click="$emit('clear')">Clear</button>
      </form>
    </div>

    <!-- Macros Tab -->
    <div v-if="activeTab === 'macros'" class="tab-content">
      <div class="placeholder-content">
        <p>Macros functionality coming soon</p>
      </div>
    </div>

    <!-- G-Code Viewer Tab -->
    <div v-if="activeTab === 'gcode-viewer'" class="tab-content">
      <div v-if="!totalLines" class="placeholder-content">
        <p>No G-Code file loaded. Please upload or load it from visualizer.</p>
      </div>
      <div v-else class="gcode-viewer">
        <div class="gcode-content" ref="gcodeOutput" @scroll="onGcodeScroll">
          <div class="gcode-spacer" :style="{ height: totalHeight + 'px' }"></div>
          <div class="gcode-items" :style="{ transform: 'translateY(' + offsetY + 'px)' }">
            <div
              v-for="item in visibleLines"
              :key="item.index"
              class="gcode-line"
              :class="{ 'gcode-line--completed': isProgramRunning && (item.index + 1 <= completedUpTo) }"
              :style="{ height: rowHeight + 'px', lineHeight: rowHeight + 'px' }"
            >
              <span class="line-number">Line {{ item.index + 1 }}:</span>
              <span class="line-content">{{ item.text }}</span>
            </div>
          </div>
        </div>
        <div class="gcode-footer">
          {{ store.gcodeFilename.value || 'Untitled' }} — {{ totalLines }} lines
          <span class="gcode-storage">{{ storageMode }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed } from 'vue';
import { api } from '../../lib/api.js';
import { getLinesRangeFromIDB, isIDBEnabled } from '../../lib/gcode-store.js';
import { isTerminalIDBEnabled, getTerminalLinesWindowFromIDB, getTerminalCountFromIDB } from '../../lib/terminal-store.js';
import { useAppStore } from '../../composables/use-app-store';

const store = useAppStore();

const props = withDefaults(defineProps<{
  lines?: Array<{ id: string | number; level: string; message: string; timestamp: string; status?: 'pending' | 'success' | 'error'; type?: 'command' | 'response'; sourceId?: string }>;
  connected?: boolean;
}>(), {
  lines: () => []
});

const emit = defineEmits<{
  (e: 'clear'): void;
}>();

const commandToSend = ref('');
const autoScroll = ref(true);
const autoScrollGcode = ref(true);
const consoleOutput = ref<HTMLElement | null>(null);
const gcodeOutput = ref<HTMLElement | null>(null);
const commandHistory = ref<string[]>([]);
const historyIndex = ref(-1);
const currentInput = ref('');
const activeTab = ref('terminal');
const tabs = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'gcode-viewer', label: 'G-Code Viewer' },
  { id: 'macros', label: 'Macros' }
];

// Filter console lines to hide job-runner chatter
const terminalLines = computed(() => (props.lines || []).filter(l => l?.sourceId !== 'gcode-runner'));

// Virtualized G-code viewer state
const lineHeight = ref(18); // height of a .gcode-line (no gap)
const rowHeight = computed(() => lineHeight.value); // fixed per-row height
const overscan = 20;
const totalLines = computed(() => {
  const count = store.gcodeLineCount?.value ?? 0;
  if (count > 0) return count;
  // Fallback to in-memory content if IDB failed
  if (store.gcodeContent.value) {
    const arr = store.gcodeContent.value.split('\n');
    while (arr.length > 0 && arr[arr.length - 1].trim() === '') arr.pop();
    return arr.length;
  }
  return 0;
});

const storageMode = computed(() => (isIDBEnabled() ? 'IndexedDB' : 'Memory'));
const completedUpTo = computed(() => store.gcodeCompletedUpTo?.value ?? 0);
const isProgramRunning = computed(() => store.serverState.jobLoaded?.status === 'running');

function scrollToLineCentered(lineNumber: number) {
  const el = gcodeOutput.value;
  if (!el || !lineNumber || totalLines.value === 0) return;
  const targetIndex = Math.max(0, Math.min(totalLines.value - 1, lineNumber - 1));
  const vh = el.clientHeight || 0;
  const centerOffset = Math.max(0, (vh - rowHeight.value) / 2);
  const desired = targetIndex * rowHeight.value - centerOffset;
  const maxScroll = Math.max(0, totalLines.value * rowHeight.value - vh);
  const clamped = Math.max(0, Math.min(maxScroll, desired));
  el.scrollTop = clamped;
  // Ensure visible range updates
  requestAnimationFrame(() => updateVisibleRange());
}

watch(completedUpTo, (val) => {
  if (activeTab.value === 'gcode-viewer' && autoScrollGcode.value && isProgramRunning.value) {
    scrollToLineCentered(val);
  }
});

watch(isProgramRunning, (running) => {
  if (running && activeTab.value === 'gcode-viewer' && autoScrollGcode.value) {
    scrollToLineCentered(completedUpTo.value);
  }
});

const renderStart = ref(0); // 0-based index
const renderEnd = ref(0);   // exclusive
const visibleLines = ref<Array<{ index: number; text: string }>>([]);
const offsetY = computed(() => renderStart.value * rowHeight.value);
const totalHeight = computed(() => totalLines.value * rowHeight.value);

async function fetchLines(startIdx: number, endIdx: number) {
  // Convert to 1-based inclusive for IDB
  if (endIdx <= startIdx || startIdx >= totalLines.value) {
    visibleLines.value = [];
    return;
  }
  const startLine = startIdx + 1;
  const endLine = Math.min(totalLines.value, endIdx);

  try {
    const lines = await getLinesRangeFromIDB(startLine, endLine);
    visibleLines.value = lines.map((text, i) => ({ index: startIdx + i, text }));
  } catch (e) {
    // Fallback to in-memory content if available
    if (store.gcodeContent.value) {
      const arr = store.gcodeContent.value.split('\n');
      while (arr.length > 0 && arr[arr.length - 1].trim() === '') arr.pop();
      const slice = arr.slice(startIdx, endLine);
      visibleLines.value = slice.map((text, i) => ({ index: startIdx + i, text }));
    } else {
      visibleLines.value = [];
    }
  }
}

let fetchVersion = 0;

async function updateVisibleRange() {
  const el = gcodeOutput.value;
  if (!el) return;
  const vh = el.clientHeight || 0;
  const scrollTop = el.scrollTop || 0;
  const firstVisible = Math.floor(scrollTop / rowHeight.value);
  const visibleCount = Math.ceil(vh / rowHeight.value) + overscan;
  const start = Math.max(0, firstVisible - Math.floor(overscan / 2));
  const end = Math.min(totalLines.value, start + visibleCount);
  renderStart.value = start;
  renderEnd.value = end;
  const currentVersion = ++fetchVersion;
  const useIDB = isIDBEnabled();
  const lines = await (async () => {
    if (end <= start || start >= totalLines.value) return [];
    const startLine = start + 1;
    const endLine = Math.min(totalLines.value, end);
    if (useIDB) {
      try {
        const lines = await getLinesRangeFromIDB(startLine, endLine);
        return lines.map((text, i) => ({ index: start + i, text }));
      } catch (e) {
        // fallthrough to memory
      }
    }
    {
      if (store.gcodeContent.value) {
        const arr = store.gcodeContent.value.split('\n');
        while (arr.length > 0 && arr[arr.length - 1].trim() === '') arr.pop();
        const slice = arr.slice(start, endLine);
        return slice.map((text, i) => ({ index: start + i, text }));
      }
      return [];
    }
  })();
  if (currentVersion === fetchVersion) {
    visibleLines.value = lines;
  }
}

function measureLineHeight() {
  const el = gcodeOutput.value;
  if (!el) return;
  const temp = document.createElement('div');
  temp.className = 'gcode-line';
  temp.style.visibility = 'hidden';
  temp.innerHTML = '<span class="line-number">Line 1:</span><span class="line-content">X0 Y0</span>';
  el.appendChild(temp);
  const h = temp.getBoundingClientRect().height;
  el.removeChild(temp);
  if (h && h > 0) lineHeight.value = Math.round(h); // snap to whole px to avoid drift
}

onMounted(() => {
  nextTick(() => {
    measureLineHeight();
    updateVisibleRange();
  });
});

watch(totalLines, async () => {
  await nextTick();
  const el = gcodeOutput.value;
  if (el) el.scrollTop = 0;
  renderStart.value = 0;
  renderEnd.value = 0;
  await updateVisibleRange();
});

watch(activeTab, async (tab) => {
  if (tab === 'gcode-viewer') {
    await nextTick();
    measureLineHeight();
    updateVisibleRange();
  }
});

// rAF scroll handler to reduce jank
let scrolling = false;
function onGcodeScroll() {
  if (scrolling) return;
  scrolling = true;
  requestAnimationFrame(() => {
    scrolling = false;
    updateVisibleRange();
  });
}

const sendCommand = async () => {
  if (!commandToSend.value) return;

  // Add to history and save to server
  await api.addCommandToHistory(commandToSend.value);

  api.sendCommandViaWebSocket({
    command: commandToSend.value,
    displayCommand: commandToSend.value,
    meta: {
      recordHistory: true
    }
  }).catch((error) => {
    console.error('Failed to send console command via WebSocket:', error);
  });
  commandToSend.value = '';
  historyIndex.value = -1;
  currentInput.value = '';
};

const loadCommandHistory = async () => {
  try {
    commandHistory.value = await api.getCommandHistory();
  } catch (error) {
    console.error('Failed to load command history:', error);
  }
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (commandHistory.value.length === 0) return;

    if (historyIndex.value === -1) {
      currentInput.value = commandToSend.value;
      historyIndex.value = commandHistory.value.length - 1;
    } else if (historyIndex.value > 0) {
      historyIndex.value--;
    }

    commandToSend.value = commandHistory.value[historyIndex.value];
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (historyIndex.value === -1) return;

    if (historyIndex.value < commandHistory.value.length - 1) {
      historyIndex.value++;
      commandToSend.value = commandHistory.value[historyIndex.value];
    } else {
      historyIndex.value = -1;
      commandToSend.value = currentInput.value;
    }
  }
};

let unsubscribeHistory;

const appendCommandToHistory = (command) => {
  if (!command) return;
  const last = commandHistory.value[commandHistory.value.length - 1];
  if (last !== command) {
    commandHistory.value.push(command);
    // Mirror server-side cap of 200 entries
    if (commandHistory.value.length > 200) {
      commandHistory.value.splice(0, commandHistory.value.length - 200);
    }
  }
};

// Load command history on component mount and sync when other clients submit commands
onMounted(() => {
  loadCommandHistory();
  unsubscribeHistory = api.onCommandHistoryAppended((event) => {
    if (event?.command) {
      appendCommandToHistory(event.command);
    }
  });
});

onBeforeUnmount(() => {
  if (typeof unsubscribeHistory === 'function') {
    unsubscribeHistory();
    unsubscribeHistory = undefined;
  }
});

const getStatusIcon = (line) => {
  if (line.status === 'success') {
    return '<svg class="emoji-icon"><use href="#emoji-success"></use></svg>';
  } else if (line.status === 'error') {
    return '<svg class="emoji-icon"><use href="#emoji-error"></use></svg>';
  } else if (line.status === 'pending') {
    return '<span class="spinner"></span>';
  }
  return '';
};

watch(autoScroll, (newValue) => {
  if (newValue) {
    nextTick(() => {
      if (consoleOutput.value) {
        const el = consoleOutput.value;
        el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        requestAnimationFrame(() => updateTerminalVisibleRange());
      }
    });
  }
});

watch(() => props.lines, async () => {
  if (autoScroll.value) {
    await nextTick();
    if (consoleOutput.value) {
      const el = consoleOutput.value;
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    }
  }
}, { deep: true });

// Terminal virtualization using IndexedDB (optional)
const useTerminalIDB = computed(() => isTerminalIDBEnabled());
const terminalRowHeight = ref(24);
const terminalRenderStart = ref(0);
const terminalRenderEnd = ref(0);
const terminalVisibleLines = ref<Array<any>>([]);
const terminalOffsetY = computed(() => terminalRenderStart.value * terminalRowHeight.value);
const terminalTotalLines = ref(0);
const terminalTotalHeight = computed(() => terminalTotalLines.value * terminalRowHeight.value);

function measureTerminalRowHeight() {
  const el = consoleOutput.value;
  if (!el) return;
  const temp = document.createElement('article');
  temp.className = 'console-line';
  temp.style.visibility = 'hidden';
  temp.innerHTML = '<span class="timestamp">00:00 </span><span class="message">Sample</span>';
  el.appendChild(temp);
  const h = temp.getBoundingClientRect().height;
  el.removeChild(temp);
  if (h && h > 0) terminalRowHeight.value = Math.ceil(h);
}

async function refreshTerminalCount() {
  if (useTerminalIDB.value) {
    try {
      terminalTotalLines.value = await getTerminalCountFromIDB();
    } catch {
      terminalTotalLines.value = (terminalLines.value || []).length;
    }
  } else {
    terminalTotalLines.value = (terminalLines.value || []).length;
  }
}

let terminalFetchVersion = 0;
async function updateTerminalVisibleRange() {
  if (!useTerminalIDB.value) return; // not needed when rendering from memory
  const el = consoleOutput.value;
  if (!el) return;
  const vh = el.clientHeight || 0;
  const scrollTop = el.scrollTop || 0;
  const visibleCount = Math.ceil(vh / terminalRowHeight.value) + overscan;
  const atBottom = Math.abs((el.scrollHeight - el.clientHeight) - scrollTop) <= 2;
  let start: number;
  if (atBottom) {
    start = Math.max(0, (terminalTotalLines.value - visibleCount));
  } else {
    const firstVisible = Math.floor(scrollTop / terminalRowHeight.value);
    start = Math.max(0, firstVisible - Math.floor(overscan / 2));
  }
  const end = Math.min(terminalTotalLines.value, start + visibleCount);
  terminalRenderStart.value = start;
  terminalRenderEnd.value = end;
  const current = ++terminalFetchVersion;
  if (end <= start || start >= terminalTotalLines.value) {
    terminalVisibleLines.value = [];
    return;
  }
  try {
    const rows = await getTerminalLinesWindowFromIDB(start, end);
    if (current === terminalFetchVersion) {
      terminalVisibleLines.value = rows.map((r, i) => ({ ...r, index: start + i }));
    }
  } catch {
    // fall back to memory
    const all = (terminalLines.value || []);
    terminalVisibleLines.value = all.slice(start, end).map((r, i) => ({ ...r, index: start + i }));
  }
}

function onTerminalScroll() {
  if (!useTerminalIDB.value) return;
  // Do not force bottom here; allow manual scroll.
  updateTerminalVisibleRange();
}

onMounted(async () => {
  await nextTick();
  measureTerminalRowHeight();
  await refreshTerminalCount();
  if (autoScroll.value && consoleOutput.value) {
    const el = consoleOutput.value;
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  }
  updateTerminalVisibleRange();
});

watch(() => props.lines, async () => {
  // When new lines are pushed, keep count in sync and autoscroll if enabled
  await refreshTerminalCount();
  if (useTerminalIDB.value) {
    await nextTick();
    if (autoScroll.value && consoleOutput.value) {
      const el = consoleOutput.value;
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    }
    updateTerminalVisibleRange();
  }
}, { deep: true });
</script>

<style scoped>
/* Disable console when not connected */
.card-disabled .console-output,
.card-disabled .console-input {
  opacity: 0.5;
  pointer-events: none;
}

/* Keep G-Code viewer selectable even when disconnected */
.card-disabled .gcode-viewer {
  opacity: 0.5;
  pointer-events: auto;
}

.card {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  padding: var(--gap-sm);
  box-shadow: var(--shadow-elevated);
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  min-height: 300px !important;
  height: 100%;
}

.card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-sm);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

/* Compact Tabs */
.tabs {
  display: flex;
  gap: 2px;
  flex: 1;
}

.tab-button {
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius-small) var(--radius-small) 0 0;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.85rem;
  font-weight: 500;
  position: relative;
  margin-bottom: -1px;
}

.tab-button:hover {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

.tab-button.active {
  background: transparent;
  color: var(--color-text-primary);
  font-weight: 600;
  border-bottom: 2px solid var(--color-accent);
}

.tab-button.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--gradient-accent);
}

.filters {
  display: flex;
  gap: var(--gap-xs);
}

.auto-scroll-toggle {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
  cursor: pointer;
}

.toggle-label {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.toggle-switch {
  width: 40px;
  height: 22px;
  background: var(--color-surface-muted);
  border-radius: 999px;
  position: relative;
  transition: background 0.2s ease;
}

.toggle-handle {
  width: 18px;
  height: 18px;
  background: white;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s ease;
}

.auto-scroll-toggle.active .toggle-switch {
  background: var(--color-accent);
}

.auto-scroll-toggle.active .toggle-handle {
  transform: translateX(18px);
}

.console-output {
  background: #141414;
  border-radius: var(--radius-small);
  padding: var(--gap-xs);
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
  flex: 1;
  min-height: 160px;
  overflow-y: auto;
  overflow-x: auto;
  position: relative;
  color: #bdc3c7;
  font-family: 'JetBrains Mono', monospace;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.console-output--virtual {
  display: block; /* prevent flex gap from affecting spacer/items */
  gap: 0;
}

.terminal-spacer { width: 1px; height: 0; opacity: 0; }
.terminal-items { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }


.console-output * {
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.console-line {
  display: flex;
  gap: 8px;
  align-items: center;
  line-height: 1.2;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.console-line--error {
  color: #ff6b6b;
}

.console-line--response {

}

.timestamp {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  min-width: 112px;
  display: flex;
  align-items: center;
  gap: 4px;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  user-select: none !important;
}

.timestamp * {
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  user-select: none !important;
}

.timestamp :deep(.emoji-icon) {
  width: 16px;
  height: 16px;
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}

.message {
  flex: 1;
  font-size: 0.75rem;
  white-space: pre;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  font-style: italic;
  font-size: 0.8rem;
}

.console-input {
  display: flex;
  gap: var(--gap-xs);
}

.console-input input {
  flex: 1;
  border-radius: var(--radius-small);
  border: 1px solid var(--color-border);
  padding: 12px;
  font-size: 0.9rem;
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.console-input .primary {
  border: none;
  border-radius: var(--radius-small);
  padding: 12px 18px;
  cursor: pointer;
  background: var(--gradient-accent);
  color: #fff;
}

/* Tab Content */
.tab-content {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  flex: 1;
  min-height: 0;
}

.placeholder-content {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--color-text-secondary);
  font-style: italic;
  font-size: 0.9rem;
}

/* G-Code Viewer */
.gcode-viewer {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: var(--gap-xs);
}

.gcode-footer {
  padding-top: 6px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.gcode-storage {
  margin-left: 8px;
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.7rem;
  color: var(--color-text-secondary);
}

.gcode-content {
  background: #141414;
  border-radius: var(--radius-small);
  padding: var(--gap-xs);
  position: relative;
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  cursor: text;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
  contain: content;
  will-change: scroll-position;
}

.gcode-spacer {
  width: 1px;
  height: 0;
  opacity: 0;
}

.gcode-items {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}

/* Ensure all descendants remain selectable, except line numbers */
.gcode-content * {
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.gcode-line {
  display: flex;
  gap: var(--gap-sm);
  padding: 0;
  cursor: text;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.gcode-line--completed .line-content {
  text-decoration: line-through;
  opacity: 0.7;
}

.line-number {
  color: var(--color-text-secondary);
  min-width: 80px;
  flex-shrink: 0;
  pointer-events: none;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  user-select: none !important;
}

.line-content {
  color: #bdc3c7;
  flex: 1;
  cursor: text;
  white-space: pre;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}
</style>

<style>
body.theme-light .console-output,
body.theme-light .gcode-content {
  background: var(--color-surface-muted) !important;
  color: var(--color-text-primary) !important;
}

body.theme-light .line-content {
  color: var(--color-text-primary) !important;
}
</style>
