<template>
  <div class="toolbar" :class="statusClass">
    <div class="toolbar__left">
      <img src="/assets/ncsender.svg" alt="ncSender Logo" class="logo-image" />
      <div class="logo-container">
        <span class="logo">ncSender</span>
        <span class="version">v{{ appVersion }}</span>
      </div>
      <div class="workspace-selector">
        <label class="workspace-label" for="workspace-select">Workspace:</label>
        <select
          id="workspace-select"
          class="workspace-select"
          :value="workspace"
          @change="onWorkspaceChange($event)"
          :disabled="isWorkspaceDisabled"
        >
          <option v-for="ws in workspaces" :key="ws" :value="ws">{{ ws }}</option>
        </select>
      </div>
    </div>
    <div class="toolbar__center">
      <div class="machine-state">
        <span>{{ machineStateText }}</span>
      </div>
      <button v-if="isAlarmState" class="unlock-icon-button" @click="$emit('unlock')" title="Unlock">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M17 11H7C5.89543 11 5 11.8954 5 13V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V13C19 11.8954 18.1046 11 17 11Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 17C12.5523 17 13 16.5523 13 16C13 15.4477 12.5523 15 12 15C11.4477 15 11 15.4477 11 16C11 16.5523 11.4477 17 12 17Z" fill="currentColor"/>
          <path d="M7 11V7C7 5.67392 7.52678 4.40215 8.46447 3.46447C9.40215 2.52678 10.6739 2 12 2C13.3261 2 14.5979 2.52678 15.5355 3.46447C16.4732 4.40215 17 5.67392 17 7V11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Press to unlock</span>
      </button>
    </div>
    <div class="toolbar__actions">
      <div class="unit-display">
        <label class="unit-label">Unit:</label>
        <span class="unit-value">{{ unitDisplayText }}</span>
      </div>
      <button class="theme-toggle" @click="$emit('toggle-theme')" title="Toggle theme">
        <svg class="theme-icon" width="32" height="32"><use href="#emoji-sun"></use></svg>
      </button>
      <button class="theme-toggle" @click="props.onShowSettings" title="Settings" :disabled="isJobRunning">
        <svg class="theme-icon" width="32" height="32"><use href="#emoji-gear"></use></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAppStore } from '../composables/use-app-store';
import { getFeedRateUnitLabel } from '../lib/units';
import packageJson from '../../../package.json';

const store = useAppStore();
const { isJobRunning, isConnected, senderStatus: storeSenderStatus, unitsPreference } = store;

const appVersion = packageJson.version;

const props = defineProps<{
  workspace: string;
  senderStatus?: string;
  onShowSettings: () => void;
  lastAlarmCode?: number | string;
}>();

const emit = defineEmits<{
  (e: 'toggle-theme'): void;
  (e: 'unlock'): void;
  (e: 'change-workspace', value: string): void;
}>();

const resolvedSenderStatus = computed(() => (props.senderStatus || storeSenderStatus.value || 'unknown').toLowerCase());

const statusClass = computed(() => {
  const map = {
    running: 'run',
    jogging: 'jog',
    homing: 'home',
    'tool-changing': 'tool'
  } as Record<string, string>;
  const status = resolvedSenderStatus.value;
  return `state--${map[status] ?? status ?? 'unknown'}`;
});

const isAlarmState = computed(() => {
  return (props.lastAlarmCode !== undefined && props.lastAlarmCode !== null) ||
         resolvedSenderStatus.value === 'alarm';
});

const machineStateText = computed(() => {
  switch (resolvedSenderStatus.value) {
    case 'setup-required': return 'Setup Required';
    case 'connecting': return 'Connecting...';
    case 'idle': return 'Idle';
    case 'homing-required': return 'Homing Required';
    case 'running': return 'Running';
    case 'jogging': return 'Jogging';
    case 'probing': return 'Probing';
    case 'tool-changing': return 'Tool Changing';
    case 'alarm': return 'Alarm';
    case 'hold': return 'Hold';
    case 'homing': return 'Homing';
    case 'door': return 'Door Open';
    case 'check': return 'Check';
    case 'sleep': return 'Sleep';
    default: return 'Connected';
  }
});

const isWorkspaceDisabled = computed(() => !isConnected.value || isJobRunning.value);

const unitDisplayText = computed(() => {
  return getFeedRateUnitLabel(unitsPreference.value);
});

const workspaces = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59'];
const onWorkspaceChange = (e: Event) => {
  const target = e.target as HTMLSelectElement | null;
  const value = (target?.value || '').toUpperCase();
  if (workspaces.includes(value)) {
    emit('change-workspace', value);
  }
};
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
  gap: 12px;
}

.toolbar__left {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
  flex: 1;
}

.logo-image {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  object-fit: contain;
  background: rgba(255, 255, 255, 0.9);
  border-radius: var(--radius-small);
  padding: 4px;
}

.logo-container {
  display: flex;
  flex-direction: column;
  gap: 0;
  line-height: 1.1;
}

.logo {
  font-weight: 700;
  font-size: 1.25rem;
}

.version {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  font-weight: 500;
  opacity: 0.6;
  text-align: left;
}

.workspace-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
  padding: 4px 8px;
  height: 40px;
}

.workspace-label {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.workspace-select {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 4px 8px;
  font-size: 0.95rem;
}

.unit-display {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
  padding: 4px 8px;
  height: 40px;
}

.unit-label {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.unit-value {
  color: var(--color-text-primary);
  font-size: 0.95rem;
  font-weight: 500;
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

/* Unlock icon button */
.unlock-icon-button {
  background: #dc3545;
  color: white;
  border: 2px solid #b84444;
  border-radius: var(--radius-small);
  padding: 8px 16px;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-weight: 600;
}

.unlock-icon-button:hover {
  transform: translateY(-2px);
  border-color: #d85555;
  background: #ff4444;
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

.toolbar.state--probing .machine-state {
  color: #1abc9c;
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
  color: #c912a8;
  text-shadow: none;
}

.toolbar.state--setup-required .machine-state {
  color: #6c757d;
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

.toolbar.state--connecting {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-elevated), 0 0 14px rgba(26, 188, 156, 0.85);
  animation: pulse-glow-teal 1.6s ease-in-out infinite;
}

.toolbar.state--idle {
  border-color: rgba(255, 255, 255, 0.3);
  box-shadow: var(--shadow-elevated), 0 0 15px rgba(255, 255, 255, 0.4);
}

.toolbar.state--run {
  border-color: #28a745;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(40, 167, 69, 0.6);
  animation: pulse-glow-green 2.5s infinite;
}

.toolbar.state--hold {
  border-color: #ffc107;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(255, 193, 7, 0.6);
  animation: pulse-glow-yellow 2.5s infinite;
}

.toolbar.state--jog {
  border-color: #28a745;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(40, 167, 69, 0.6);
  animation: pulse-glow-green 2.5s infinite;
}

.toolbar.state--probing {
  border-color: #1abc9c;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(26, 188, 156, 0.6);
  animation: pulse-glow-teal 2.5s infinite;
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

.toolbar.state--homing-required {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(26, 188, 156, 0.6);
  animation: pulse-glow-teal 2s ease-in-out infinite;
}

.toolbar.state--homing-required .machine-state {
  color: var(--color-accent);
  text-shadow: none;
}

.toolbar.state--sleep {
  border-color: #6c757d;
  box-shadow: var(--shadow-elevated), 0 0 15px rgba(108, 117, 125, 0.5);
}

.toolbar.state--tool {
  border-color: #c912a8;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(201, 18, 168, 0.6);
  animation: pulse-glow-magenta 2.5s infinite;
}

.toolbar.state--setup-required {
  border-color: #6c757d;
  box-shadow: var(--shadow-elevated), 0 0 20px rgba(108, 117, 125, 0.5);
}

.toolbar.state--unknown {
  border-color: #6c757d;
  box-shadow: var(--shadow-elevated), 0 0 15px rgba(108, 117, 125, 0.5);
}

/* Subtle pulsing for the Connecting... text */
.toolbar.state--connecting .machine-state {
  color: var(--color-accent);
  text-shadow: none;
  animation: pulse-text-teal 1.2s ease-in-out infinite;
}

@keyframes pulse-text-teal {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
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

@keyframes pulse-glow-magenta {
  0%, 50%, 100% { box-shadow: var(--shadow-elevated), 0 0 20px rgba(201, 18, 168, 0.6); }
  25%, 75% { box-shadow: var(--shadow-elevated), 0 0 30px rgba(201, 18, 168, 0.9); }
}

@keyframes pulse-glow-yellow {
  0%, 50%, 100% { box-shadow: var(--shadow-elevated), 0 0 20px rgba(255, 193, 7, 0.6); }
  25%, 75% { box-shadow: var(--shadow-elevated), 0 0 30px rgba(255, 193, 7, 0.9); }
}

@keyframes pulse-glow-teal {
  0%, 100% { box-shadow: var(--shadow-elevated), 0 0 20px rgba(26, 188, 156, 0.6); }
  50% { box-shadow: var(--shadow-elevated), 0 0 30px rgba(26, 188, 156, 0.9); }
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
