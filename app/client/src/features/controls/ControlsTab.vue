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
  <div class="keyboard-tab">
    <div v-if="!featureEnabled" class="feature-disabled">
      <h3>Keyboard shortcuts are disabled.</h3>
      <p>Enable the <code>keyboardShortcuts</code> feature flag to configure bindings.</p>
    </div>
    <div v-else class="keyboard-content">
      <p v-if="captureError" class="error">{{ captureError }}</p>

      <div class="bindings-content" :class="{ disabled: !shortcutsEnabled }">
        <div class="bindings-header">
          <input
            type="text"
            v-model="searchQuery"
            placeholder="Search Actions..."
            class="search-input"
          />
          <div class="toggle-container">
            <button
              class="btn-debug"
              @click="showGamepadDebug = !showGamepadDebug"
              :class="{ active: showGamepadDebug }"
              title="Toggle Gamepad Debug Overlay"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                <path d="M0 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2.5-1a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1m2 0a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1m5 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2m3 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2M3 10.5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5z"/>
              </svg>
              Debug
            </button>
            <label class="toggle-label">Enable Keyboard</label>
            <ToggleSwitch
              :model-value="shortcutsEnabled"
              @update:modelValue="handleToggleShortcuts"
            />
          </div>
        </div>

        <div class="bindings-table-container">
          <table class="bindings-table">
            <thead>
              <tr>
                <th class="col-group"></th>
                <th>Action</th>
                <th>Keyboard</th>
                <th>Gamepad</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="action in filteredActionList" :key="action.id" class="binding-row" :class="{ 'binding-row--capturing': captureActionId === action.id || captureGamepadActionId === action.id }">
                <td class="col-group">
                  <span v-if="action.group" class="action-group">{{ action.group }}</span>
                </td>
                <td>
                  <div class="action-label">
                    <div class="action-label-header">
                      <strong>{{ action.label }}</strong>
                      <span v-if="action.requiresLongPress" class="badge badge-long-press">REQUIRE LONG PRESS</span>
                    </div>
                    <span v-if="action.description" class="action-description">{{ action.description }}</span>
                  </div>
                </td>
                <td>
                  <template v-if="captureActionId === action.id">
                    <div class="binding-cell">
                      <div class="binding-combined binding-combined--capturing">
                        <span class="binding-combined__value binding-combined__value--capturing">
                          <span>Press a key combination...</span>
                        </span>
                        <button
                          class="binding-combined__delete"
                          @click.stop="cancelCapture"
                          title="Cancel"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="binding-cell">
                      <div v-if="bindingMap[action.id]" class="binding-combined">
                        <span
                          class="binding-combined__value"
                          :class="{ disabled: !shortcutsEnabled }"
                          @click="shortcutsEnabled && startCapture(action.id)"
                          title="Click to change"
                        >
                          {{ bindingMap[action.id] }}
                        </span>
                        <button
                          class="binding-combined__delete"
                          :disabled="!shortcutsEnabled"
                          @click.stop="clearBinding(action.id)"
                          title="Remove keyboard binding"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
                          </svg>
                        </button>
                      </div>
                      <span
                        v-else
                        class="binding-empty binding-empty-clickable"
                        :class="{ disabled: !shortcutsEnabled }"
                        @click="shortcutsEnabled && startCapture(action.id)"
                        title="Click to set"
                      >
                        Not set
                      </span>
                    </div>
                  </template>
                </td>
                <td>
                  <template v-if="captureGamepadActionId === action.id">
                    <div class="binding-cell">
                      <div class="binding-combined binding-combined--capturing">
                        <span class="binding-combined__value binding-combined__value--capturing">
                          <span>Press a button or move axis...</span>
                        </span>
                        <button
                          class="binding-combined__delete"
                          @click.stop="cancelCapture"
                          title="Cancel"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="binding-cell">
                      <div v-if="gamepadBindingMap[action.id]" class="binding-combined">
                        <span
                          class="binding-combined__value"
                          :class="{ disabled: !shortcutsEnabled }"
                          @click="shortcutsEnabled && startGamepadCapture(action.id)"
                          title="Click to change"
                        >
                          {{ gamepadBindingMap[action.id] }}
                        </span>
                        <button
                          class="binding-combined__delete"
                          :disabled="!shortcutsEnabled"
                          @click.stop="clearGamepadBinding(action.id)"
                          title="Remove gamepad binding"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
                          </svg>
                        </button>
                      </div>
                      <span
                        v-else
                        class="binding-empty binding-empty-clickable"
                        :class="{ disabled: !shortcutsEnabled }"
                        @click="shortcutsEnabled && startGamepadCapture(action.id)"
                        title="Click to set"
                      >
                        Not set
                      </span>
                    </div>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="bindings-footer">
          <span v-if="shortcutsEnabled" class="footer-description">
            Click
            <svg class="footer-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
              <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325"/>
            </svg>
            and press any key combination. Existing assignments will be replaced automatically.
          </span>
          <span v-else class="footer-description">Enable keyboard control to edit bindings.</span>
          <button class="btn btn-reset" :disabled="isResetting" @click="resetToDefaults">
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Reset Confirmation Dialog -->
  <Dialog v-if="showResetConfirm" @close="showResetConfirm = false" :show-header="false" size="small">
    <ConfirmPanel
      title="Reset to Defaults"
      message="Are you sure you want to reset all keyboard shortcuts to their default values? This action cannot be undone."
      cancel-text="Cancel"
      confirm-text="Reset"
      variant="danger"
      @confirm="confirmReset"
      @cancel="showResetConfirm = false"
    />
  </Dialog>

  <!-- Gamepad Debug Overlay -->
  <GamepadDebugOverlay :enabled="showGamepadDebug" @close="showGamepadDebug = false" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import Dialog from '@/components/Dialog.vue';
import ConfirmPanel from '@/components/ConfirmPanel.vue';
import GamepadDebugOverlay from './GamepadDebugOverlay.vue';
import { commandRegistry } from '@/lib/command-registry';
import { keyBindingStore } from './key-binding-store';
import { comboFromEvent } from './keyboard-utils';
import { gamepadBindingStore } from './gamepad-binding-store';
import { detectGamepadInput, formatGamepadBinding } from './gamepad-utils';

const shortcutsEnabled = computed(() => keyBindingStore.areShortcutsEnabled.value);
const featureEnabled = computed(() => keyBindingStore.isFeatureEnabled.value);

const searchQuery = ref('');

const registryState = commandRegistry.getState();
const actionList = computed(() => {
  const diagonalActions = ['JogXPlusYPlus', 'JogXPlusYMinus', 'JogXMinusYPlus', 'JogXMinusYMinus'];
  return Object.values(registryState.actions)
    .filter(action => !diagonalActions.includes(action.id))
    .slice()
    .sort((a, b) => {
      const groupDiff = (a.group || '').localeCompare(b.group || '');
      if (groupDiff !== 0) {
        return groupDiff;
      }
      return a.label.localeCompare(b.label);
    });
});

const filteredActionList = computed(() => {
  const query = searchQuery.value.toLowerCase().trim();
  if (!query) {
    return actionList.value;
  }

  return actionList.value.filter(action => {
    const labelMatch = action.label.toLowerCase().includes(query);
    const descriptionMatch = action.description?.toLowerCase().includes(query);
    const groupMatch = action.group?.toLowerCase().includes(query);
    const shortcutMatch = bindingMap[action.id]?.toLowerCase().includes(query);

    return labelMatch || descriptionMatch || groupMatch || shortcutMatch;
  });
});

const bindingMap = reactive<Record<string, string>>({});
const gamepadBindingMap = reactive<Record<string, string>>({});

const syncBindingMap = () => {
  const current = keyBindingStore.getAllBindings();
  Object.keys(bindingMap).forEach((key) => delete bindingMap[key]);
  Object.entries(current).forEach(([actionId, combo]) => {
    if (combo !== null) {
      bindingMap[actionId] = combo;
    }
  });
};

const syncGamepadBindingMap = () => {
  const current = gamepadBindingStore.getAllBindings();
  Object.keys(gamepadBindingMap).forEach((key) => delete gamepadBindingMap[key]);
  Object.entries(current).forEach(([actionId, bindingStr]) => {
    if (bindingStr !== null) {
      gamepadBindingMap[actionId] = bindingStr;
    }
  });
};

syncBindingMap();
syncGamepadBindingMap();

const captureActionId = ref<string | null>(null);
const captureGamepadActionId = ref<string | null>(null);
const captureError = ref<string | null>(null);
const isResetting = ref(false);
const showResetConfirm = ref(false);
const showGamepadDebug = ref(false);

watch(
  () => keyBindingStore.state.bindings,
  () => {
    syncBindingMap();
  },
  { deep: true }
);

watch(
  () => gamepadBindingStore.state.bindings,
  () => {
    syncGamepadBindingMap();
  },
  { deep: true }
);

const handleToggleShortcuts = async (value: boolean) => {
  try {
    await keyBindingStore.setShortcutsEnabled(value);
  } catch (error: any) {
    console.error('Failed to update keyboard toggle:', error);
    captureError.value = error?.message || 'Failed to update keyboard toggle';
  }
};

const handleKeyCapture = async (event: KeyboardEvent) => {
  if (!captureActionId.value || !shortcutsEnabled.value) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const combo = comboFromEvent(event);
  if (!combo) {
    return;
  }

  try {
    await keyBindingStore.assignBinding(captureActionId.value, combo);
    captureError.value = null;
    cancelCapture();
  } catch (error: any) {
    console.error('Failed to assign key binding:', error);
    captureError.value = error?.message || 'Failed to assign key binding';
  }
};

const startCapture = (actionId: string) => {
  if (!shortcutsEnabled.value) {
    return;
  }
  captureActionId.value = actionId;
  captureError.value = null;
  keyBindingStore.setCaptureMode(true);
};

function cancelCapture() {
  captureActionId.value = null;
  captureGamepadActionId.value = null;
  keyBindingStore.setCaptureMode(false);
}

const clearBinding = async (actionId: string) => {
  try {
    await keyBindingStore.clearBindingForAction(actionId);
  } catch (error: any) {
    console.error('Failed to clear key binding:', error);
    captureError.value = error?.message || 'Failed to clear key binding';
  }
};

const clearGamepadBinding = async (actionId: string) => {
  try {
    await gamepadBindingStore.clearBindingForAction(actionId);
  } catch (error: any) {
    console.error('Failed to clear gamepad binding:', JSON.stringify(error));
    captureError.value = error?.message || 'Failed to clear gamepad binding';
  }
};

const startGamepadCapture = (actionId: string) => {
  if (!shortcutsEnabled.value) {
    return;
  }
  captureGamepadActionId.value = actionId;
  captureError.value = null;
  keyBindingStore.setCaptureMode(true);
};


const resetToDefaults = () => {
  showResetConfirm.value = true;
};

const confirmReset = async () => {
  showResetConfirm.value = false;
  isResetting.value = true;
  captureError.value = null;
  try {
    await keyBindingStore.resetToDefaults();
  } catch (error: any) {
    console.error('Failed to reset keyboard shortcuts:', error);
    captureError.value = error?.message || 'Failed to reset keyboard shortcuts';
  } finally {
    isResetting.value = false;
  }
};

let gamepadPollInterval: number | null = null;

const pollGamepads = () => {
  if (!captureGamepadActionId.value || !shortcutsEnabled.value) {
    return;
  }

  const gamepads = navigator.getGamepads();
  for (const gamepad of gamepads) {
    if (!gamepad) {
      continue;
    }

    const input = detectGamepadInput(gamepad);
    if (input) {
      handleGamepadCapture(input);
      break;
    }
  }
};

const handleGamepadCapture = async (input: any) => {
  if (!captureGamepadActionId.value || !shortcutsEnabled.value) {
    return;
  }

  try {
    await gamepadBindingStore.assignBinding(captureGamepadActionId.value, input);
    captureError.value = null;
    cancelCapture();
  } catch (error: any) {
    console.error('Failed to assign gamepad binding:', JSON.stringify(error));
    captureError.value = error?.message || 'Failed to assign gamepad binding';
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyCapture, true);
  gamepadPollInterval = window.setInterval(pollGamepads, 100);
  keyBindingStore.setControlsTabActive(true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyCapture, true);
  if (gamepadPollInterval !== null) {
    clearInterval(gamepadPollInterval);
    gamepadPollInterval = null;
  }
  captureActionId.value = null;
  captureGamepadActionId.value = null;
  keyBindingStore.setCaptureMode(false);
  keyBindingStore.setControlsTabActive(false);
});
</script>

<style scoped>
.keyboard-tab {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  color: var(--color-text-primary);
  height: 100%;
}

.feature-disabled {
  background: var(--color-surface-muted);
  border-radius: var(--radius-medium);
  padding: var(--gap-lg);
  text-align: center;
  border: 1px dashed var(--color-border);
}

.feature-disabled code {
  background: var(--color-surface);
  padding: 2px 6px;
  border-radius: var(--radius-small);
}

.keyboard-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: 0;
}

.bindings-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

.bindings-content.disabled {
  opacity: 0.5;
}

.bindings-header {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  padding: var(--gap-sm);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  padding: var(--gap-sm) var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
}

.search-input::placeholder {
  color: var(--color-text-secondary);
}

.toggle-container {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  flex-shrink: 0;
}

.toggle-label {
  font-size: 0.9rem;
  color: var(--color-text-primary);
  font-weight: 500;
  white-space: nowrap;
}

.btn-debug {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 6px 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.btn-debug:hover {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-debug.active {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: white;
}

.btn {
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-small);
  padding: 6px 12px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.2s ease;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-reset {
  padding: 10px 20px;
  font-size: 1rem;
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 6px 12px;
  color: inherit;
  cursor: pointer;
}

.btn-icon {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px 16px;
  color: var(--color-text-primary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.btn-icon:hover:not(:disabled) {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-icon:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.btn-icon-danger:hover:not(:disabled) {
  border-color: var(--color-danger, #f87171);
  color: var(--color-danger, #f87171);
}

.btn-icon-mini {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 4px;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  opacity: 0.6;
}

.btn-icon-mini:hover:not(:disabled) {
  opacity: 1;
  background: var(--color-surface-muted);
  border-color: var(--color-danger, #f87171);
  color: var(--color-danger, #f87171);
}

.btn-icon-mini:disabled {
  cursor: not-allowed;
  opacity: 0.3;
}

.error {
  color: var(--color-danger, #f87171);
  margin: 0 var(--gap-md) var(--gap-md) var(--gap-md);
  padding: var(--gap-sm) var(--gap-md);
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: var(--radius-small);
  flex-shrink: 0;
}

.bindings-table-container {
  flex: 1;
  overflow-y: scroll;
  overflow-x: hidden;
  min-height: 0;
  background: var(--color-surface);
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
  padding-bottom: 30px;
}

.bindings-table-container::-webkit-scrollbar {
  width: 8px;
  height: 0;
}

.bindings-table-container::-webkit-scrollbar-track {
  background: transparent;
}

.bindings-table-container::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 4px;
}

.bindings-table-container::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-secondary);
}

.bindings-table-container::-webkit-scrollbar-corner {
  background: transparent;
}

.bindings-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.bindings-table .col-group {
  width: 120px;
  vertical-align: middle;
  text-align: center;
}

.bindings-table td:nth-child(3),
.bindings-table td:nth-child(4) {
  width: 220px;
  vertical-align: middle;
}

.bindings-table thead {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--color-surface-muted);
}

.bindings-table thead::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -2px;
  height: 2px;
  background: var(--color-surface-muted);
  z-index: 6;
}

.bindings-table thead::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--color-border);
}

.bindings-table th {
  padding: var(--gap-sm) var(--gap-md);
  text-align: left;
  font-weight: 600;
  color: var(--color-text-primary);
  border-bottom: 2px solid var(--color-border);
  background: var(--color-surface-muted);
}

.bindings-table th:nth-child(3),
.bindings-table th:nth-child(4) {
  text-align: center;
}

.bindings-table tbody tr:first-child td {
  padding-top: var(--gap-lg);
}

.bindings-table tbody tr:last-child td {
  padding-bottom: var(--gap-lg);
}

.bindings-table td {
  padding: var(--gap-md);
  vertical-align: top;
}


.bindings-table td:first-child {
  padding-left: var(--gap-md);
}

.bindings-table tbody tr {
  border-bottom: 1px solid var(--color-border);
}

.binding-row:nth-child(even) {
  background: var(--color-surface-muted);
}

.binding-row:hover {
  background: var(--color-border);
}

.binding-row--capturing {
  background: rgba(var(--color-accent-rgb, 64, 169, 151), 0.15) !important;
  border-left: 3px solid var(--color-accent);
  animation: glow-pulse 2s ease-in-out infinite;
  position: relative;
  z-index: 10;
}

.binding-row--capturing td:first-child {
  padding-left: calc(var(--gap-md) - 3px);
}

@keyframes glow-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(var(--color-accent-rgb, 64, 169, 151), 0.4),
                inset 0 0 0 0 rgba(var(--color-accent-rgb, 64, 169, 151), 0.4);
  }
  50% {
    box-shadow: 0 0 20px 4px rgba(var(--color-accent-rgb, 64, 169, 151), 0.6),
                inset 0 0 20px 0 rgba(var(--color-accent-rgb, 64, 169, 151), 0.2);
  }
}

.binding-cell {
  display: inline-flex;
  align-items: center;
}

.binding-combined {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-small);
  overflow: hidden;
  width: 190px;
  transition: all 0.2s ease;
}

.binding-combined__value {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  border-right: 1px solid rgba(255, 255, 255, 0.3);
  background: var(--color-accent);
  flex: 1;
  min-width: 0;
}

.binding-combined__value:hover:not(.disabled) {
  filter: brightness(1.1);
}

.binding-combined__value.disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.binding-combined__delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  background: var(--color-danger, #f87171);
  border: none;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  width: 44px;
  flex-shrink: 0;
}

.binding-combined__delete:hover:not(:disabled) {
  filter: brightness(1.1);
}

.binding-combined__delete:disabled {
  cursor: not-allowed;
  opacity: 0.3;
}

.binding-combined--capturing {
  animation: glow-pulse 2s ease-in-out infinite;
}

.binding-combined__value--capturing {
  overflow: hidden;
  white-space: nowrap;
  font-style: italic;
  font-size: 0.85rem;
  display: block;
}

.binding-combined__value--capturing span {
  display: inline-block;
  padding-left: 100%;
  animation: scroll-text 10s linear infinite;
}

@keyframes scroll-text {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(-100%);
  }
}

.binding-chip {
  display: inline-flex;
  align-items: center;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.binding-chip-clickable {
  cursor: pointer;
  transition: all 0.2s ease;
}

.binding-chip-clickable:hover:not(.disabled) {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: white;
}

.binding-chip-clickable.disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.binding-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px 16px;
  color: var(--color-text-secondary);
  font-style: italic;
  width: 190px;
}

.binding-empty-clickable {
  cursor: pointer;
  transition: all 0.2s ease;
}

.binding-empty-clickable:hover:not(.disabled) {
  background: var(--color-border);
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}

.binding-empty-clickable.disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.capture-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 190px;
}

.capture-message {
  color: var(--color-accent);
  font-weight: 600;
  font-style: italic;
  font-size: 1.05rem;
}

.capture-current {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.binding-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.action-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.action-label-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-description {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.badge-long-press {
  background: #ff9500;
  color: white;
}

.action-group {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  background: var(--color-surface-muted);
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid var(--color-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.bindings-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-sm) var(--gap-md);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  flex-shrink: 0;
  position: relative;
  z-index: 5;
}

.footer-description {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 4px;
}

.footer-icon {
  vertical-align: middle;
  opacity: 0.8;
}

</style>
