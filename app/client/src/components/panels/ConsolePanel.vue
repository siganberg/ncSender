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
    </header>

    <!-- Terminal Tab -->
    <div v-if="activeTab === 'terminal'" class="tab-content">
      <div class="console-output" role="log" aria-live="polite" ref="consoleOutput">
        <div v-if="lines.length === 0" class="empty-state">
          All clear – give me a command!
        </div>
        <article
          v-for="line in lines"
          :key="line.id"
          :class="['console-line', `console-line--${line.level}`, `console-line--${line.type}`]"
        >
          <span class="timestamp">{{ line.timestamp }}{{ line.type === 'command' ? ' - ' : ' ' }}<span v-html="getStatusIcon(line)"></span></span>
          <span class="message">{{ line.message }}</span>
        </article>
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

    <!-- G-Code File Viewer Tab -->
    <div v-if="activeTab === 'gcode-viewer'" class="tab-content">
      <div v-if="!gcodeLines.length" class="placeholder-content">
        <p>No G-code file loaded</p>
      </div>
      <div v-else class="gcode-viewer">
        <div class="gcode-header">
          <span class="gcode-filename">{{ store.gcodeFilename.value || 'Untitled' }}</span>
          <span class="gcode-line-count">{{ gcodeLines.length }} lines</span>
        </div>
        <div class="gcode-content" ref="gcodeOutput">
          <div
            v-for="(line, index) in gcodeLines"
            :key="index"
            class="gcode-line"
          >
            <span class="line-number">Line {{ index + 1 }}:</span>
            <span class="line-content">{{ line }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed } from 'vue';
import { api } from '../../lib/api.js';
import { useAppStore } from '../../composables/use-app-store';

const store = useAppStore();

const props = defineProps<{
  lines: Array<{ id: string | number; level: string; message: string; timestamp: string; status?: 'pending' | 'success' | 'error'; type?: 'command' | 'response' }>;
  connected?: boolean;
}>();

const emit = defineEmits<{
  (e: 'clear'): void;
}>();

const commandToSend = ref('');
const autoScroll = ref(true);
const consoleOutput = ref<HTMLElement | null>(null);
const commandHistory = ref<string[]>([]);
const historyIndex = ref(-1);
const currentInput = ref('');
const activeTab = ref('terminal');
const tabs = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'macros', label: 'Macros' },
  { id: 'gcode-viewer', label: 'G-Code File Viewer' }
];

const gcodeLines = computed(() => {
  if (!store.gcodeContent.value) return [];
  const lines = store.gcodeContent.value.split('\n');

  // Remove trailing empty lines only
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  return lines;
});

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
        consoleOutput.value.scrollTop = consoleOutput.value.scrollHeight;
      }
    });
  }
});

watch(() => props.lines, async () => {
  if (autoScroll.value) {
    await nextTick();
    if (consoleOutput.value) {
      consoleOutput.value.scrollTop = consoleOutput.value.scrollHeight;
    }
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
  color: #bdc3c7;
  font-family: 'JetBrains Mono', monospace;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}


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

.gcode-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-xs) var(--gap-sm);
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
}

.gcode-filename {
  font-weight: 600;
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.gcode-line-count {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.gcode-content {
  background: #141414;
  border-radius: var(--radius-small);
  padding: var(--gap-xs);
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  overflow-y: auto;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  cursor: text;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
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
  line-height: 1.4;
  padding: 2px 0;
  cursor: text;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
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
