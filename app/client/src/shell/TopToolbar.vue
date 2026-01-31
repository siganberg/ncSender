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
  <div class="toolbar" :class="statusClass">
    <div class="toolbar__left">
      <img
        src="/assets/ncsender.svg"
        alt="ncSender Logo"
        class="logo-image logo-image--clickable"
        @click="showGamepadDebug = !showGamepadDebug"
        title="Toggle Gamepad Debug"
      />
      <div class="logo-container">
        <span class="logo">ncSender</span>
        <span
          class="version"
          :class="{ 'version--action': updateSupported }"
          @click="onVersionClick"
          :title="updateSupported ? 'Open update center' : 'Version information'"
        >
          v{{ appVersion }}
        </span>
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
      <button
        class="machine-info-button"
        :class="{ 'pin-triggered': hasAnyPinTriggered }"
        @click="showMachineInfo = !showMachineInfo"
        @blur="handleMachineInfoBlur"
        title="Machine Information"
      >
        <span :class="['pin-led', 'pin-led--large', { 'pin-led--active': hasAnyPinTriggered }]"></span>
      </button>
      <div v-if="showMachineInfo" class="machine-info-tooltip">
        <div class="machine-info-header">
          <h3>Pins</h3>
        </div>
        <div class="machine-info-content">
          <div class="machine-info-section">
            <div class="pins-grid">
              <div class="pin-item">
                <span class="pin-name">X Limit</span>
                <span :class="['pin-led', { 'pin-led--active': getPinState('X') }]"></span>
              </div>
              <div class="pin-item">
                <span class="pin-name">Y Limit</span>
                <span :class="['pin-led', { 'pin-led--active': getPinState('Y') }]"></span>
              </div>
              <div class="pin-item">
                <span class="pin-name">Z Limit</span>
                <span :class="['pin-led', { 'pin-led--active': getPinState('Z') }]"></span>
              </div>
              <div class="pin-item">
                <span class="pin-name">A Limit</span>
                <span :class="['pin-led', { 'pin-led--active': getPinState('A') }]"></span>
              </div>
              <div class="pin-item">
                <span class="pin-name">Probe</span>
                <span :class="['pin-led', { 'pin-led--active': isProbeTriggered }]"></span>
              </div>
              <div class="pin-item">
                <span class="pin-name">TLS</span>
                <span :class="['pin-led', { 'pin-led--active': isTLSTriggered }]"></span>
              </div>
              <div class="pin-item">
                <span class="pin-name">Door</span>
                <span :class="['pin-led', { 'pin-led--active': getPinState('D') }]"></span>
              </div>
            </div>
          </div>
        </div>
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
      <button
        v-if="shouldShowUpdateIndicator"
        class="update-indicator"
        :class="{
          'update-indicator--available': hasUpdateAvailable,
          'update-indicator--busy': isCheckingUpdates || isDownloadingUpdate,
          'update-indicator--error': hasUpdateError
        }"
        @click="emit('show-update-dialog')"
        @contextmenu.prevent="copyUpdateStatus"
        :title="updateIndicatorTitle"
      >
        <span v-if="isCheckingUpdates || isDownloadingUpdate" class="spinner"></span>
        <span v-else class="update-indicator__dot"></span>
        <span class="update-indicator__label">{{ updateIndicatorLabel }}</span>
        <span v-if="updateStatusCopied" class="update-indicator__copy-feedback">Copied!</span>
      </button>
      <div class="unit-display">
        <label class="unit-label">Unit:</label>
        <span class="unit-value">{{ unitDisplayText }}</span>
      </div>
      <!-- Pendant Connection Indicator -->
      <div v-if="pendantConnectionType" class="pendant-indicator" :class="`pendant-indicator--${pendantConnectionType}`">
        <svg v-if="pendantConnectionType === 'bluetooth'" class="pendant-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6.5 6.5L17.5 17.5M17.5 17.5L12 23V1L17.5 6.5L6.5 17.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else class="pendant-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="pendant-label">Pendant</span>
      </div>
      <button
        class="theme-toggle bluetooth-button"
        :class="{ 'bluetooth-button--connected': bluetoothConnected }"
        @click="$emit('show-bluetooth')"
        title="Bluetooth Pendant"
      >
        <svg class="theme-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6.5 6.5L17.5 17.5M17.5 17.5L12 23V1L17.5 6.5L6.5 17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class="theme-toggle" @click="$emit('toggle-theme')" title="Toggle theme">
        <svg class="theme-icon" width="32" height="32"><use href="#emoji-sun"></use></svg>
      </button>
      <button class="theme-toggle" @click="props.onShowSettings" title="Settings" :disabled="isJobRunning">
        <svg class="theme-icon" width="32" height="32"><use href="#emoji-gear"></use></svg>
      </button>
    </div>
  </div>

  <!-- Gamepad Debug Overlay -->
  <GamepadDebugOverlay :enabled="showGamepadDebug" @close="showGamepadDebug = false" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAppStore } from '../composables/use-app-store';
import { getFeedRateUnitLabel } from '../lib/units';
import GamepadDebugOverlay from '../features/controls/GamepadDebugOverlay.vue';
import packageJson from '../../../package.json';

type TopToolbarUpdateState = {
  supported?: boolean;
  isAvailable?: boolean;
  isChecking?: boolean;
  isDownloading?: boolean;
  latestVersion?: string | null;
  downloadPercent?: number;
  statusMessage?: string | null;
  error?: string | null;
};

const store = useAppStore();
const { isJobRunning, isConnected, senderStatus: storeSenderStatus, unitsPreference } = store;

const appVersion = packageJson.version;

const props = defineProps<{
  workspace: string;
  senderStatus?: string;
  onShowSettings: () => void;
  lastAlarmCode?: number | string;
  updateState?: TopToolbarUpdateState;
  bluetoothConnected?: boolean;
  pendantConnectionType?: 'wifi' | 'bluetooth' | null;
}>();

const emit = defineEmits<{
  (e: 'toggle-theme'): void;
  (e: 'unlock'): void;
  (e: 'change-workspace', value: string): void;
  (e: 'show-update-dialog'): void;
  (e: 'show-bluetooth'): void;
}>();

const bluetoothConnected = computed(() => props.bluetoothConnected ?? false);
const pendantConnectionType = computed(() => props.pendantConnectionType ?? null);

const resolvedSenderStatus = computed(() => (props.senderStatus || storeSenderStatus.value || 'unknown').toLowerCase());

// Check if door is open via Pn pin state (even if status is idle)
const isDoorOpenViaPn = computed(() => {
  const pnString = store.status.Pn || '';
  return pnString.includes('D');
});

// Effective status that accounts for door detected via Pn
const effectiveSenderStatus = computed(() => {
  if (isDoorOpenViaPn.value && resolvedSenderStatus.value !== 'door') {
    return 'door';
  }
  return resolvedSenderStatus.value;
});

const statusClass = computed(() => {
  const map = {
    running: 'run',
    jogging: 'jog',
    homing: 'home',
    'tool-changing': 'tool'
  } as Record<string, string>;
  const status = effectiveSenderStatus.value;
  return `state--${map[status] ?? status ?? 'unknown'}`;
});

const isAlarmState = computed(() => {
  return (props.lastAlarmCode !== undefined && props.lastAlarmCode !== null) ||
         resolvedSenderStatus.value === 'alarm';
});

const machineStateText = computed(() => {
  switch (effectiveSenderStatus.value) {
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

// Machine info tooltip state
const showMachineInfo = ref(false);

const getPinState = (pinKey: string): boolean => {
  // Parse from Pn string (e.g., "XYZP" means X, Y, Z, and P are active)
  const pnString = store.status.Pn || '';
  return pnString.includes(pinKey);
};

const hasAnyPinTriggered = computed(() => {
  const pnString = store.status.Pn || '';
  return pnString.length > 0;
});

// Probe pin state: Red when Pn:P AND (probeCount = 0 OR activeProbe = 0)
const isProbeTriggered = computed(() => {
  const pnString = store.status.Pn || '';
  const hasP = pnString.includes('P');
  if (!hasP) return false;
  const probeCount = store.status.probeCount ?? 0;
  const activeProbe = store.status.activeProbe;
  // If probeCount = 0, shared pin - both show same state
  // If probeCount > 0, only red when activeProbe = 0
  return probeCount === 0 || activeProbe === 0;
});

// TLS pin state: Red when Pn:P AND (probeCount = 0 OR activeProbe = 1)
const isTLSTriggered = computed(() => {
  const pnString = store.status.Pn || '';
  const hasP = pnString.includes('P');
  if (!hasP) return false;
  const probeCount = store.status.probeCount ?? 0;
  const activeProbe = store.status.activeProbe;
  // If probeCount = 0, shared pin - both show same state
  // If probeCount > 0, only red when activeProbe = 1
  return probeCount === 0 || activeProbe === 1;
});

const handleMachineInfoBlur = (event: FocusEvent) => {
  // Close tooltip when clicking outside
  const relatedTarget = event.relatedTarget as HTMLElement;
  if (!relatedTarget || !relatedTarget.closest('.machine-info-tooltip')) {
    setTimeout(() => {
      showMachineInfo.value = false;
    }, 150);
  }
};

const updateState = computed(() => props.updateState);
const updateSupported = computed(() => Boolean(updateState.value?.supported));
const hasUpdateAvailable = computed(() => Boolean(updateState.value?.supported && updateState.value?.isAvailable));
const isCheckingUpdates = computed(() => Boolean(updateState.value?.supported && updateState.value?.isChecking));
const isDownloadingUpdate = computed(() => Boolean(updateState.value?.supported && updateState.value?.isDownloading));
const hasUpdateError = computed(() => Boolean(updateState.value?.supported && updateState.value?.error));
const shouldShowUpdateIndicator = computed(() => hasUpdateAvailable.value || isCheckingUpdates.value || isDownloadingUpdate.value || hasUpdateError.value);
const updateVersionLabel = computed(() => updateState.value?.latestVersion || '');
const downloadPercentText = computed(() => {
  const percentRaw = updateState.value?.downloadPercent ?? 0;
  const percent = Math.max(0, Math.min(100, percentRaw));
  return `${Math.round(percent)}%`;
});
const updateIndicatorLabel = computed(() => {
  if (isDownloadingUpdate.value) {
    return `Downloading ${downloadPercentText.value}`;
  }
  if (hasUpdateAvailable.value) {
    return updateVersionLabel.value ? `Update v${updateVersionLabel.value}` : 'Update available';
  }
  if (isCheckingUpdates.value) {
    return 'Checking…';
  }
  if (hasUpdateError.value) {
    return 'Update issue';
  }
  return updateState.value?.statusMessage || 'Updates';
});
const updateIndicatorTitle = computed(() => {
  if (updateState.value?.error) {
    return updateState.value.error;
  }
  if (updateState.value?.statusMessage) {
    return updateState.value.statusMessage;
  }
  if (hasUpdateAvailable.value && updateVersionLabel.value) {
    return `New version ${updateVersionLabel.value} available`;
  }
  if (isDownloadingUpdate.value) {
    return `Downloading update (${downloadPercentText.value})`;
  }
  return 'Update status';
});

const updateStatusCopied = ref(false);
let updateStatusCopyTimer: ReturnType<typeof setTimeout> | null = null;

const showGamepadDebug = ref(false);

const copyUpdateStatus = async (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  const text = updateIndicatorTitle.value || updateIndicatorLabel.value;
  if (!text) {
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      updateStatusCopied.value = true;
      if (updateStatusCopyTimer) {
        clearTimeout(updateStatusCopyTimer);
      }
      updateStatusCopyTimer = setTimeout(() => {
        updateStatusCopied.value = false;
        updateStatusCopyTimer = null;
      }, 1600);
    } else {
      window.prompt('Copy update status', text);
    }
  } catch (error) {
    console.error('Failed to copy update status:', error);
    window.prompt('Copy update status', text);
  }
};

const onVersionClick = () => {
  if (updateSupported.value) {
    emit('show-update-dialog');
  }
};

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

.logo-image--clickable {
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.logo-image--clickable:hover {
  transform: scale(1.05);
  opacity: 0.9;
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

.version--action {
  cursor: pointer;
  text-decoration: underline dotted transparent;
  transition: opacity 0.2s ease, text-decoration-color 0.2s ease;
}

.version--action:hover {
  opacity: 1;
  text-decoration-color: currentColor;
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

.machine-info-button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  min-width: 40px;
  flex-shrink: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-small);
  cursor: pointer;
  transition: all 0.2s ease;
  margin-left: 0;
  padding: 0;
}

.machine-info-button:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-color: var(--color-primary);
}

.machine-info-tooltip {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  min-width: 280px;
  max-width: 400px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  box-shadow: var(--shadow-elevated);
  z-index: 1000;
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.machine-info-header {
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
}

.machine-info-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.machine-info-content {
  padding: 15px;
}

.machine-info-section h4 {
  margin: 0 0 var(--gap-sm) 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.pins-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pin-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-sm);
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
}

.pin-name {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-text-primary);
  font-family: monospace;
}

.pin-led-icon {
  flex-shrink: 0;
}

/* Glowing LED indicator */
.pin-led {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #28a745;
  box-shadow: 0 0 8px rgba(40, 167, 69, 0.8), 0 0 16px rgba(40, 167, 69, 0.4);
}

.pin-led--large {
  width: 18px;
  height: 18px;
}

.pin-led--active {
  background: #dc3545;
  box-shadow: 0 0 10px rgba(220, 53, 69, 0.9), 0 0 20px rgba(220, 53, 69, 0.5);
  animation: led-pulse-red 1.5s ease-in-out infinite;
}

@keyframes led-pulse-red {
  0%, 100% {
    box-shadow: 0 0 10px rgba(220, 53, 69, 0.9), 0 0 20px rgba(220, 53, 69, 0.5);
  }
  50% {
    box-shadow: 0 0 14px rgba(220, 53, 69, 1), 0 0 28px rgba(220, 53, 69, 0.7);
  }
}

.empty-state {
  padding: var(--gap-md);
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
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

.update-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 6px 12px;
  border: 1px solid transparent;
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.update-indicator:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-elevated);
}

.update-indicator--available {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.update-indicator--busy {
  opacity: 0.85;
}

.update-indicator--error {
  border-color: #ff7a7a;
  color: #ff7a7a;
}

.update-indicator .spinner {
  width: 12px;
  height: 12px;
}

.update-indicator__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-accent);
  animation: updateDotPulse 1.6s ease-in-out infinite;
}

.update-indicator--error .update-indicator__dot {
  background: #ff7a7a;
}

.update-indicator__label {
  white-space: nowrap;
  user-select: text;
}

.update-indicator__copy-feedback {
  font-weight: 700;
  font-size: 0.7rem;
  color: var(--color-accent);
}

@keyframes updateDotPulse {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(0.6);
    opacity: 0.55;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
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

/* Pendant connection indicator */
.pendant-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
}

.pendant-indicator--bluetooth {
  color: #0099ff;
  border-color: rgba(0, 153, 255, 0.4);
  background: rgba(0, 153, 255, 0.1);
}

.pendant-indicator--wifi {
  color: #28a745;
  border-color: rgba(40, 167, 69, 0.4);
  background: rgba(40, 167, 69, 0.1);
}

.pendant-icon {
  flex-shrink: 0;
}

.pendant-label {
  white-space: nowrap;
}

/* Bluetooth button */
.bluetooth-button {
  position: relative;
}

.bluetooth-button--connected {
  color: #0099ff;
  border-color: rgba(0, 153, 255, 0.5);
}

.bluetooth-button--connected::after {
  content: '';
  position: absolute;
  top: 6px;
  right: 6px;
  width: 8px;
  height: 8px;
  background: #28a745;
  border-radius: 50%;
  box-shadow: 0 0 6px rgba(40, 167, 69, 0.8);
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
