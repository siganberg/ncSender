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
      <div class="auto-scroll-toggle" @click="autoScrollGcode = !autoScrollGcode" :class="{ active: autoScrollGcode }" v-if="activeTab === 'gcode-preview'">
        <span class="toggle-label">Auto-Scroll</span>
        <div class="toggle-switch">
          <div class="toggle-handle"></div>
        </div>
      </div>
    </header>

    <!-- Terminal Tab -->
    <div v-if="activeTab === 'terminal'" class="tab-content">
      <div class="console-output" role="log" aria-live="polite" ref="consoleOutput">
        <div v-if="terminalLines.length === 0" class="empty-state">
          All clear – give me a command!
        </div>
        <RecycleScroller
          v-else
          class="terminal-scroller"
          :items="terminalLines"
          :item-size="terminalRowHeight"
          key-field="id"
          :buffer="200"
          ref="scrollerRef"
        >
          <template #default="{ item }">
            <article
              :class="['console-line', `console-line--${item.level}`, `console-line--${item.type}`]"
              :style="{ height: terminalRowHeight + 'px', lineHeight: terminalRowHeight + 'px' }"
            >
              <span class="timestamp">{{ item.timestamp }}{{ item.type === 'command' || item.type === 'response' ? ' - ' : ' ' }}<span v-html="getStatusIcon(item)"></span></span>
              <span class="message">{{ item.message }}</span>
            </article>
          </template>
        </RecycleScroller>
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
      <MacroPanel :connected="connected" />
    </div>

    <!-- G-Code Preview Tab -->
    <div v-if="activeTab === 'gcode-preview'" class="tab-content">
      <div v-if="!totalLines" class="placeholder-content">
        <p>No G-Code file loaded. Please upload or load it from visualizer.</p>
      </div>
      <div v-else class="gcode-preview">
        <div class="gcode-content" ref="gcodeOutput">
          <RecycleScroller
            class="gcode-scroller"
            :items="gcodeItems"
            :item-size="rowHeight"
            key-field="index"
            :buffer="overscan"
            ref="gcodeScrollerRef"
            @scroll="onGcodeScroll"
          >
            <template #default="{ item }">
              <div
                class="gcode-line"
                :class="getGcodeLineClasses(item.index)"
                :style="{ height: rowHeight + 'px', lineHeight: rowHeight + 'px' }"
              >
                <span class="line-number">Line {{ item.index + 1 }}:</span>
                <span class="line-content">{{ getGcodeText(item.index) }}</span>
              </div>
            </template>
          </RecycleScroller>
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
import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed, reactive } from 'vue';
import { api } from './api';
import { getLinesRangeFromIDB, isIDBEnabled } from '../../lib/gcode-store.js';
import { isTerminalIDBEnabled } from '../../lib/terminal-store.js';
import { useConsoleStore } from './store';
import { RecycleScroller } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import MacroPanel from '../macro/MacroPanel.vue';

const store = useConsoleStore();

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
const scrollerRef = ref<any>(null);
const gcodeOutput = ref<HTMLElement | null>(null);
const gcodeScrollerRef = ref<any>(null);
const commandHistory = ref<string[]>([]);
const historyIndex = ref(-1);
const currentInput = ref('');
// Make Terminal the default tab and list it first
const activeTab = ref('terminal');
const tabs = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'gcode-preview', label: 'G-Code Preview' },
  { id: 'macros', label: 'Macros' }
];

// Filter console lines to hide job-runner chatter but show probing commands
const terminalLines = computed(() => (props.lines || []).filter(l => l?.sourceId !== 'gcode-runner'));

// G-code viewer state (virtualized via RecycleScroller)
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
const completedUpTo = computed(() => {
  const val = store.gcodeCompletedUpTo?.value ?? 0;
  return val;
});
const isProgramRunning = computed(() => (store.jobLoaded.value?.status === 'running'));

// Minimal line cache for IDB mode
const gcodeCache = reactive<{ [key: number]: string }>({});
const memLines = computed(() => {
  const content = store.gcodeContent.value;
  if (!content) return null;
  const arr = content.split('\n');
  while (arr.length > 0 && arr[arr.length - 1].trim() === '') arr.pop();
  return arr;
});

const gcodeItems = computed(() => Array.from({ length: totalLines.value }, (_, i) => ({ index: i })));

function getGcodeText(index: number) {
  const mem = memLines.value;
  if (mem) return mem[index] ?? '';
  const cached = gcodeCache[index];
  return cached ?? '';
}

// Classify a G-code line for coloring (rapid vs cutting)
function classifyGcode(line: string): 'rapid' | 'cutting' | null {
  if (!line) return null;
  const upper = line.toUpperCase();
  // Strip comments: ( ... ) and ; ...
  const noParen = upper.replace(/\([^)]*\)/g, '');
  const code = noParen.split(';')[0] || '';
  if (!code.trim()) return null;
  // Detect motion words
  const isG0 = /\bG0+(?:\.0+)?\b/.test(code);
  const isG1 = /\bG1+(?:\.0+)?\b/.test(code);
  const isG2 = /\bG2+(?:\.0+)?\b/.test(code);
  const isG3 = /\bG3+(?:\.0+)?\b/.test(code);
  if (isG0) return 'rapid';
  if (isG1 || isG2 || isG3) return 'cutting';
  // Default to 'cutting' when no explicit motion matches
  return 'cutting';
}

function getGcodeLineClasses(index: number) {
  const completed = (index + 1 <= completedUpTo.value);
  const base: Record<string, boolean> = { 'gcode-line--completed': completed };
  const kind = classifyGcode(getGcodeText(index));
  if (kind === 'rapid') base['gcode-line--rapid'] = true;
  if (kind === 'cutting') base['gcode-line--cutting'] = true;
  return base;
}

async function fillGcodeCache(startIndex: number, endIndex: number) {
  if (!isIDBEnabled() || memLines.value) return;
  try {
    const endLine = Math.min(totalLines.value, endIndex); // convert to 1-based inclusive
    if (endLine <= startIndex) return;
    const rows = await getLinesRangeFromIDB(startIndex + 1, endLine);
    rows.forEach((text, i) => { gcodeCache[startIndex + i] = text; });
  } catch {}
}

function scrollToLineCentered(lineNumber: number) {
  const el = gcodeOutput.value;
  if (!el || !lineNumber || totalLines.value === 0) return;
  const targetIndex = Math.max(0, Math.min(totalLines.value - 1, lineNumber - 1));
  const vh = el.clientHeight || 0;
  const centerOffset = Math.max(0, (vh - rowHeight.value) / 2);
  const desired = targetIndex * rowHeight.value - centerOffset;
  const maxScroll = Math.max(0, totalLines.value * rowHeight.value - vh);
  const clamped = Math.max(0, Math.min(maxScroll, desired));
  if (gcodeScrollerRef.value?.scrollToPosition) {
    gcodeScrollerRef.value.scrollToPosition(clamped);
  } else if (gcodeScrollerRef.value?.scrollToItem) {
    gcodeScrollerRef.value.scrollToItem(targetIndex);
    // Adjust closer to center via direct scrollTop tweak
    const root = gcodeScrollerRef.value?.$el || gcodeOutput.value?.querySelector('.vue-recycle-scroller');
    if (root) root.scrollTop = clamped;
  } else {
    const root = gcodeOutput.value?.querySelector('.vue-recycle-scroller');
    if (root) root.scrollTop = clamped;
  }
}

watch(completedUpTo, (val) => {
  if (activeTab.value === 'gcode-preview' && autoScrollGcode.value && isProgramRunning.value) {
    scrollToLineCentered(val);
  }
});

watch(isProgramRunning, async (running) => {
  if (running) {
    const sourceId = store.jobLoaded.value?.sourceId;

    // Auto-switch tabs based on job source
    // - probing jobs switch to Terminal tab
    // - gcode-runner jobs switch to G-Code Preview tab
    if (sourceId === 'probing') {
      if (activeTab.value !== 'terminal') {
        activeTab.value = 'terminal';
      }
    } else if (sourceId === 'gcode-runner' || !sourceId) {
      if (activeTab.value !== 'gcode-preview') {
        activeTab.value = 'gcode-preview';
        await nextTick();
        measureLineHeight();
      }
    }

    if (autoScrollGcode.value && activeTab.value === 'gcode-preview') {
      scrollToLineCentered(completedUpTo.value);
    }
  }
});

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
    // Warm up cache for initial visible window
    const root = (gcodeScrollerRef.value && gcodeScrollerRef.value.$el) || gcodeOutput.value?.querySelector('.vue-recycle-scroller');
    if (!memLines.value) {
      if (root && (root as HTMLElement).clientHeight) {
        onGcodeScroll();
      } else {
        // Prefetch first chunk to avoid empty lines before any scroll
        fillGcodeCache(0, Math.max(overscan, 200));
      }
    }
    if (isProgramRunning.value && autoScrollGcode.value) {
      scrollToLineCentered(completedUpTo.value);
    }
  });
});

watch(totalLines, async () => {
  await nextTick();
  const el = gcodeOutput.value;
  if (el) el.scrollTop = 0;
  if (!memLines.value) {
    const root = (gcodeScrollerRef.value && gcodeScrollerRef.value.$el) || gcodeOutput.value?.querySelector('.vue-recycle-scroller');
    if (root && (root as HTMLElement).clientHeight) {
      onGcodeScroll();
    } else {
      fillGcodeCache(0, Math.max(overscan, 200));
    }
  }
});

watch(activeTab, async (tab) => {
  if (tab === 'gcode-preview') {
    await nextTick();
    measureLineHeight();
    // Warm up cache for initial window
    onGcodeScroll();
  } else if (tab === 'terminal') {
    await nextTick();
    measureTerminalRowHeight();
    await refreshTerminalCount();
    if (autoScroll.value && consoleOutput.value) {
      const el = consoleOutput.value;
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    }
    updateTerminalVisibleRange();
  }
});

// rAF scroll handler to reduce jank
let scrolling = false;
function onGcodeScroll() {
  if (scrolling) return;
  scrolling = true;
  requestAnimationFrame(() => {
    scrolling = false;
    // Prefetch IDB window to keep text cache warm
    if (!memLines.value) {
      const root = (gcodeScrollerRef.value && gcodeScrollerRef.value.$el) || gcodeOutput.value?.querySelector('.vue-recycle-scroller');
      if (!root) return;
      const vh = (root as HTMLElement).clientHeight || 0;
      const scrollTop = (root as HTMLElement).scrollTop || 0;
      const visibleCount = Math.ceil(vh / rowHeight.value) + overscan;
      const start = Math.max(0, Math.floor(scrollTop / rowHeight.value) - Math.floor(overscan / 2));
      const end = Math.min(totalLines.value, start + visibleCount);
      fillGcodeCache(start, end);
    }
  });
}

// Reset cross-out and scroll to top when user closes Job Progress panel (status changes to null)
watch(() => store.jobLoaded.value?.status, async (val, oldVal) => {
  if (oldVal && (oldVal === 'running' || oldVal === 'paused' || oldVal === 'stopped' || oldVal === 'completed') && val === null) {
    await nextTick();
    if (gcodeScrollerRef.value?.scrollToPosition) {
      gcodeScrollerRef.value.scrollToPosition(0);
    } else {
      const root = (gcodeScrollerRef.value && gcodeScrollerRef.value.$el) || gcodeOutput.value?.querySelector('.vue-recycle-scroller');
      if (root) (root as HTMLElement).scrollTop = 0;
    }
  }
});

const sendCommand = async () => {
  if (!commandToSend.value) return;

  // Add to history and save to server
  await store.addToHistory(commandToSend.value);

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
  unsubscribeHistory = store.onHistoryAppended((event) => {
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
  } else if (line.type === 'response') {
    return '<svg class="emoji-icon"><use href="#emoji-info"></use></svg>';
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

const terminalRowHeight = ref(24);
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

let stopAutoScrollBindings: (() => void) | undefined;

onMounted(async () => {
  await nextTick();
  measureTerminalRowHeight();
  // Auto-scroll to bottom on mount
  if (autoScroll.value && scrollerRef.value) {
    scrollerRef.value.scrollToItem(terminalLines.value.length - 1);
  }
  stopAutoScrollBindings = store.startAutoScrollBindings(async (evt) => {
    // Skip auto-scroll for gcode-runner events (they're not shown in terminal)
    if (evt?.sourceId === 'gcode-runner') return;

    if (activeTab.value === 'terminal' && autoScroll.value && scrollerRef.value) {
      await nextTick();
      scrollerRef.value.scrollToItem(terminalLines.value.length - 1);
    }
  });
});

onBeforeUnmount(() => {
  if (typeof stopAutoScrollBindings === 'function') {
    try { stopAutoScrollBindings(); } catch {}
    stopAutoScrollBindings = undefined;
  }
});

watch(() => props.lines, async () => {
  if (activeTab.value === 'terminal' && autoScroll.value && scrollerRef.value) {
    await nextTick();
    scrollerRef.value.scrollToItem(terminalLines.value.length - 1);
  }
}, { deep: true });
</script>

<style scoped>
/* Disable console when not connected. */
.card-disabled .console-output,
.card-disabled .console-input {
  opacity: 0.5;
  pointer-events: none;
}

/* Keep G-Code preview selectable even when disconnected */
.card-disabled .gcode-preview {
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
  padding-top: 0;
  padding-bottom: 0;
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
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  min-width: 115px;
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
  transform: translateY(-2px);
}

.message {
  flex: 1;
  font-size: 0.85rem;
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
  padding: 8px 14px;
  cursor: pointer;
  background: var(--gradient-accent);
  color: #fff;
  font-size: 1rem;
  font-weight: 500;
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

/* G-Code Preview */
.gcode-preview {
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
  overflow: hidden; /* RecycleScroller handles scroll */
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  cursor: text;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
  contain: content;
}

.gcode-scroller {
  height: 100%;
  overflow: auto;
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

/* Color lines to match visualizer colors */
.gcode-line--rapid .line-content {
  color: #00ff66 !important; /* match visualizer rapid */
}

.gcode-line--cutting .line-content {
  color: #3e85c7 !important; /* same as visualizer cutting */
}

/* Completed lines: gray them like visualizer */
.gcode-line--completed.gcode-line--rapid .line-content {
  color: #333333 !important;
}
.gcode-line--completed.gcode-line--cutting .line-content {
  color: #444444 !important;
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

/* Preserve motion coloring in light theme */
body.theme-light .gcode-line--rapid .line-content { color: #E67E22 !important; }
body.theme-light .gcode-line--cutting .line-content { color: #3e85c7 !important; }
body.theme-light .gcode-line--completed.gcode-line--rapid .line-content { color: #333333 !important; }
body.theme-light .gcode-line--completed.gcode-line--cutting .line-content { color: #444444 !important; }
</style>
