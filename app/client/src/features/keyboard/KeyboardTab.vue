<template>
  <div class="keyboard-tab">
    <div v-if="!featureEnabled" class="feature-disabled">
      <h3>Keyboard shortcuts are disabled.</h3>
      <p>Enable the <code>keyboardShortcuts</code> feature flag to configure bindings.</p>
    </div>
    <div v-else class="keyboard-content">
      <section class="settings-section">
        <header>
          <h3>Keyboard Control</h3>
          <ToggleSwitch
            :model-value="shortcutsEnabled"
            @update:modelValue="handleToggleShortcuts"
          />
        </header>
      </section>

      <p v-if="captureError" class="error">{{ captureError }}</p>

      <div class="bindings-content" :class="{ disabled: !shortcutsEnabled }">
          <div class="bindings-table-container">
          <table class="bindings-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Shortcut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="action in actionList" :key="action.id" class="binding-row" :class="{ 'binding-row--capturing': captureActionId === action.id }">
                <td>
                  <div class="action-label">
                    <strong>{{ action.label }}</strong>
                    <span v-if="action.description" class="action-description">{{ action.description }}</span>
                    <span v-if="action.group" class="action-group">{{ action.group }}</span>
                  </div>
                </td>
                <td>
                  <template v-if="captureActionId === action.id">
                    <div class="capture-container">
                      <span class="capture-message">Press a key combination...</span>
                      <span v-if="bindingMap[action.id]" class="capture-current">Current: {{ bindingMap[action.id] }}</span>
                    </div>
                  </template>
                  <template v-else>
                    <span v-if="bindingMap[action.id]" class="binding-chip">{{ bindingMap[action.id] }}</span>
                    <span v-else class="binding-empty">Not set</span>
                  </template>
                </td>
                <td class="binding-actions">
                  <template v-if="captureActionId === action.id">
                    <button class="btn-secondary" @click="cancelCapture">
                      Cancel
                    </button>
                  </template>
                  <template v-else>
                    <button class="btn" :disabled="!shortcutsEnabled" @click="startCapture(action.id)">
                      Change
                    </button>
                    <button
                      class="btn-secondary"
                      :disabled="!shortcutsEnabled || !bindingMap[action.id]"
                      @click="clearBinding(action.id)"
                    >
                      Remove
                    </button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="bindings-footer">
          <span v-if="shortcutsEnabled" class="footer-description">Click "Change" and press any key combination. Existing assignments will be replaced automatically.</span>
          <span v-else class="footer-description">Enable keyboard control to edit bindings.</span>
          <button class="btn" :disabled="isResetting" @click="resetToDefaults">
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import { commandRegistry } from '@/lib/command-registry';
import { keyBindingStore } from './key-binding-store';
import { comboFromEvent } from './keyboard-utils';

const shortcutsEnabled = computed(() => keyBindingStore.areShortcutsEnabled.value);
const featureEnabled = computed(() => keyBindingStore.isFeatureEnabled.value);

const registryState = commandRegistry.getState();
const actionList = computed(() => {
  return Object.values(registryState.actions)
    .slice()
    .sort((a, b) => {
      const groupDiff = (a.group || '').localeCompare(b.group || '');
      if (groupDiff !== 0) {
        return groupDiff;
      }
      return a.label.localeCompare(b.label);
    });
});

const bindingMap = reactive<Record<string, string>>({});

const syncBindingMap = () => {
  const current = keyBindingStore.getAllBindings();
  Object.keys(bindingMap).forEach((key) => delete bindingMap[key]);
  Object.entries(current).forEach(([combo, action]) => {
    bindingMap[action] = combo;
  });
};

syncBindingMap();

const captureActionId = ref<string | null>(null);
const captureError = ref<string | null>(null);
const isResetting = ref(false);

watch(
  () => keyBindingStore.state.bindings,
  () => {
    syncBindingMap();
  },
  { deep: true }
);

const captureActionLabel = computed(() => {
  const id = captureActionId.value;
  if (!id) return '';
  const action = actionList.value.find(item => item.id === id);
  return action?.label || id;
});

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

const resetToDefaults = async () => {
  if (!window.confirm('Reset keyboard shortcuts to defaults?')) {
    return;
  }
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

onMounted(() => {
  window.addEventListener('keydown', handleKeyCapture, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyCapture, true);
  keyBindingStore.setCaptureMode(false);
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
  padding: 0 0 0 0;
}

.settings-section {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  padding: 0;
  box-shadow: var(--shadow-flat);
  border: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  flex-shrink: 0;
  margin: 0 var(--gap-md);
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

.settings-section header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-sm);
  padding: 10px;
}

.bindings-header {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  padding: var(--gap-md);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.bindings-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
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

.btn-secondary {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 6px 12px;
  color: inherit;
  cursor: pointer;
}

.error {
  color: var(--color-danger, #f87171);
  margin: 0 var(--gap-md);
  padding: var(--gap-sm);
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: var(--radius-small);
  flex-shrink: 0;
}

.bindings-table-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  background: var(--color-surface);
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
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
  table-layout: fixed;
}

.bindings-table thead {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--color-surface-muted);
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
}

.binding-row--capturing td:first-child {
  padding-left: calc(var(--gap-md) - 3px);
}

.binding-chip {
  display: inline-flex;
  align-items: center;
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
  padding: 4px 8px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.binding-empty {
  color: var(--color-text-secondary);
  font-style: italic;
}

.capture-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
  gap: 2px;
}

.action-description {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.action-group {
  font-size: 0.75rem;
  color: var(--color-text-muted, var(--color-text-secondary));
  text-transform: uppercase;
  letter-spacing: 0.05em;
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
}

.footer-description {
  flex: 1;
}
</style>
