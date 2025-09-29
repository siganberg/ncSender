<template>
  <div class="toolbar" :class="connected ? `state--${machineState?.toLowerCase() || 'unknown'}` : 'state--offline'">
    <div class="toolbar__left">
      <span class="logo">ncSender</span>
      <div class="workspace">Workspace: {{ workspace }}</div>
    </div>
    <div class="toolbar__center">
      <div class="machine-state">
        <span>{{ machineStateText }}</span>
      </div>
    </div>
    <div class="toolbar__actions">
      <button class="theme-toggle" @click="$emit('toggle-theme')" title="Toggle theme">
        <span class="theme-icon">🌙</span>
      </button>
      <button class="theme-toggle" @click="props.onShowSettings" title="Settings">
        <span class="theme-icon">⚙️</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  workspace: string;
  connected?: boolean;
  machineState?: 'idle' | 'run' | 'hold' | 'alarm' | 'offline' | 'door' | 'check' | 'home' | 'sleep' | 'tool';
  onShowSettings: () => void;
}>();

const emit = defineEmits<{
  (e: 'toggle-theme'): void;
}>();

const machineStateText = computed(() => {
  if (!props.connected) return 'Connecting...';
  if (!props.machineState || props.machineState === 'offline') return 'Connected';

  const state = props.machineState.toLowerCase();
  switch (state) {
    case 'idle': return 'Idle';
    case 'run': return 'Running';
    case 'hold': return 'Hold';
    case 'jog': return 'Jogging';
    case 'alarm': return 'Alarm';
    case 'door': return 'Door Open';
    case 'check': return 'Check';
    case 'home': return 'Homing';
    case 'sleep': return 'Sleep';
    case 'tool': return 'Tool Change';
    case 'offline': return 'Connecting...';
    default: return 'Connected';
  }
});
</script>

<style scoped>
.toolbar {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  box-shadow: var(--shadow-elevated);
  padding: var(--gap-sm) var(--gap-md);
  display: flex;
  align-items: center;
  position: relative;
  gap: var(--gap-sm);
  border: 1px solid transparent;
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}

.toolbar__center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.toolbar__left {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  flex: 1;
}

.logo {
  font-weight: 700;
  font-size: 1.25rem;
}

.workspace {
  padding: 4px 12px;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
}

.toolbar__actions {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
  flex: 1;
  justify-content: flex-end;
}

button {
  border: none;
  border-radius: var(--radius-small);
  padding: 10px 18px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.primary {
  color: #fff;
  background: var(--gradient-accent);
  box-shadow: 0 8px 16px -12px rgba(26, 188, 156, 0.7);
}

button.ghost {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

button.danger {
  background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.3));
  color: #fff;
}

.divider {
  width: 1px;
  height: 24px;
  background: var(--color-border);
  margin: 0 var(--gap-xs);
}

/* Machine state indicator */
.machine-state {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  font-weight: 600;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  text-align: center;
  transition: text-shadow 0.3s ease;
}

.toolbar.state--idle .machine-state {
  color: var(--color-text-primary);
  text-shadow: none;
}

.toolbar.state--offline .machine-state {
  color: #6c757d;
  text-shadow: none;
}

.toolbar.state--run .machine-state {
  color: #28a745;
  text-shadow: none;
}

.toolbar.state--hold .machine-state {
  color: #ffc107;
  text-shadow: none;
}

.toolbar.state--jog .machine-state {
  color: #28a745;
  text-shadow: none;
}

.toolbar.state--alarm .machine-state {
  color: #dc3545;
  text-shadow: none;
}

.toolbar.state--door .machine-state {
  color: #fd7e14;
  text-shadow: none;
}

.toolbar.state--check .machine-state {
  color: #20c997;
  text-shadow: none;
}

.toolbar.state--home .machine-state {
  color: #007bff;
  text-shadow: none;
}

.toolbar.state--sleep .machine-state {
  color: #6c757d;
  text-shadow: none;
}

.toolbar.state--tool .machine-state {
  color: #6f42c1;
  text-shadow: none;
}

.toolbar.state--unknown .machine-state {
  color: #6c757d;
  text-shadow: none;
}

.toolbar.state--offline {
  border-color: #6c757d;
  box-shadow: var(--shadow-elevated), 0 0 15px rgba(108, 117, 125, 0.5);
}

.toolbar.state--idle {
  border-color: transparent;
  box-shadow: var(--shadow-elevated);
}

.toolbar.state--run {
  border-color: #28a745;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(40, 167, 69, 0.6);
  animation: pulse-glow-green 2.5s infinite;
}

.toolbar.state--hold {
  border-color: #ffc107;
  box-shadow: var(--shadow-elevated), 0 0 15px rgba(255, 193, 7, 0.5);
}

.toolbar.state--jog {
  border-color: #28a745;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(40, 167, 69, 0.6);
  animation: pulse-glow-green 2.5s infinite;
}

.toolbar.state--alarm {
  border-color: #dc3545;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(220, 53, 69, 0.6);
  animation: pulse-glow-red 1s infinite;
}

.toolbar.state--door {
  border-color: #fd7e14;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(253, 126, 20, 0.6);
  animation: pulse-glow-orange 2.5s infinite;
}

.toolbar.state--check {
  border-color: #20c997;
  box-shadow: var(--shadow-elevated), 0 0 15px rgba(32, 201, 151, 0.5);
}

.toolbar.state--home {
  border-color: #007bff;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(0, 123, 255, 0.6);
  animation: pulse-glow-blue 2.5s infinite;
}

.toolbar.state--sleep {
  border-color: #6c757d;
  box-shadow: var(--shadow-elevated), 0 0 15px rgba(108, 117, 125, 0.5);
}

.toolbar.state--tool {
  border-color: #6f42c1;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(111, 66, 193, 0.6);
  animation: pulse-glow-purple 2.5s infinite;
}

.toolbar.state--unknown {
  border-color: #6c757d;
  box-shadow: var(--shadow-elevated), 0 0 15px rgba(108, 117, 125, 0.5);
}

@keyframes pulse-glow-green {
  0%, 50%, 100% { box-shadow: var(--shadow-elevated), 0 0 20px rgba(40, 167, 69, 0.6); }
  25%, 75% { box-shadow: var(--shadow-elevated), 0 0 30px rgba(40, 167, 69, 0.9); }
}

@keyframes pulse-glow-red {
  0%, 50%, 100% { box-shadow: var(--shadow-elevated), 0 0 20px rgba(220, 53, 69, 0.6); }
  25%, 75% { box-shadow: var(--shadow-elevated), 0 0 30px rgba(220, 53, 69, 0.9); }
}

@keyframes pulse-glow-blue {
  0%, 50%, 100% { box-shadow: var(--shadow-elevated), 0 0 20px rgba(0, 123, 255, 0.6); }
  25%, 75% { box-shadow: var(--shadow-elevated), 0 0 30px rgba(0, 123, 255, 0.9); }
}

@keyframes pulse-glow-orange {
  0%, 50%, 100% { box-shadow: var(--shadow-elevated), 0 0 20px rgba(253, 126, 20, 0.6); }
  25%, 75% { box-shadow: var(--shadow-elevated), 0 0 30px rgba(253, 126, 20, 0.9); }
}

@keyframes pulse-glow-purple {
  0%, 50%, 100% { box-shadow: var(--shadow-elevated), 0 0 20px rgba(111, 66, 193, 0.6); }
  25%, 75% { box-shadow: var(--shadow-elevated), 0 0 30px rgba(111, 66, 193, 0.9); }
}

/* Theme toggle button */
.theme-toggle {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 4px 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.theme-toggle:hover {
  background: var(--color-surface);
  transform: translateY(-1px);
}

.theme-icon {
  font-size: 1.1rem;
}

@media (max-width: 959px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: var(--gap-md);
  }

  .toolbar__center {
    position: static;
    transform: none;
    left: auto;
    order: 1;
  }

  .toolbar__left {
    order: 2;
    flex-wrap: wrap;
    gap: var(--gap-xs);
    justify-content: center;
    flex: none;
  }

  .toolbar__actions {
    order: 3;
    flex-wrap: wrap;
    justify-content: center;
    flex: none;
  }

  .machine-state {
    font-size: 1.1rem;
    padding: 10px 20px;
    min-width: 100px;
  }
}
</style>
