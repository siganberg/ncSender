<template>
  <section class="card">
    <header class="card__header">
      <h2>Console</h2>
      <div class="auto-scroll-toggle" @click="autoScroll = !autoScroll" :class="{ active: autoScroll }">
        <span class="toggle-label">Auto-Scroll</span>
        <div class="toggle-switch">
          <div class="toggle-handle"></div>
        </div>
      </div>
    </header>
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
  </section>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { api } from '../../lib/api.js';

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

const sendCommand = async () => {
  if (!commandToSend.value) return;

  // Add to history and save to server
  await api.addCommandToHistory(commandToSend.value);

  api.sendCommand(commandToSend.value, {
    meta: {
      recordHistory: true
    }
  }).catch(() => {});
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
    return '✅';
  } else if (line.status === 'error') {
    return '❌';
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
.card {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  padding: var(--gap-sm);
  box-shadow: var(--shadow-elevated);
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  min-height: 240px;
  height: 100%;
}

.card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
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
  font-family: 'Monaco', monospace;
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
</style>
