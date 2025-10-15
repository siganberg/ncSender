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
        <p class="description">When enabled, keyboard shortcuts can jog the machine and trigger registered commands. Jog shortcuts follow the Step and Feed Rate from the main Jog panel.</p>

        <div class="jog-settings" :class="{ disabled: !shortcutsEnabled }">
          <div class="setting">
            <label for="keyboard-step">Step Distance (mm)</label>
            <div class="readonly-field" id="keyboard-step">{{ currentStepDisplay }}</div>
          </div>
          <div class="setting">
            <label for="keyboard-xy-feed">XY Feed Rate (mm/min)</label>
            <div class="readonly-field" id="keyboard-xy-feed">{{ currentXYFeedDisplay }}</div>
          </div>
          <div class="setting">
            <label for="keyboard-z-feed">Z Feed Rate (mm/min)</label>
            <div class="readonly-field" id="keyboard-z-feed">{{ currentZFeedDisplay }}</div>
          </div>
        </div>
      </section>

      <section class="bindings-section" :class="{ disabled: !shortcutsEnabled }">
        <header>
          <h3>Key Bindings</h3>
          <div class="actions">
            <button class="btn" :disabled="isResetting" @click="resetToDefaults">
              Reset to defaults
            </button>
          </div>
        </header>

        <p v-if="shortcutsEnabled" class="description">Click “Change” and press any key combination. Existing assignments will be replaced automatically.</p>
        <p v-else class="description">Enable keyboard control to edit bindings.</p>

        <div v-if="captureActionId" class="capture-banner">
          <span>Press a key combination for <strong>{{ captureActionLabel }}</strong>.</span>
          <button class="btn-secondary" @click="cancelCapture">Cancel</button>
        </div>
        <p v-if="captureError" class="error">{{ captureError }}</p>

        <table class="bindings-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Shortcut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="action in actionList" :key="action.id">
              <td>
                <div class="action-label">
                  <strong>{{ action.label }}</strong>
                  <span v-if="action.description" class="action-description">{{ action.description }}</span>
                  <span v-if="action.group" class="action-group">{{ action.group }}</span>
                </div>
              </td>
              <td>
                <span v-if="bindingMap[action.id]" class="binding-chip">{{ bindingMap[action.id] }}</span>
                <span v-else class="binding-empty">Not set</span>
              </td>
              <td class="binding-actions">
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
              </td>
            </tr>
          </tbody>
        </table>
      </section>
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

const formatNumber = (value: number, fractionDigits = 2) => {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(fractionDigits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

const currentStepDisplay = computed(() => formatNumber(keyBindingStore.getStep(), 3));
const currentXYFeedDisplay = computed(() => formatNumber(keyBindingStore.getFeedRates().xyFeedRate, 2));
const currentZFeedDisplay = computed(() => formatNumber(keyBindingStore.getFeedRates().zFeedRate, 2));

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
  gap: var(--gap-md);
}

.settings-section,
.bindings-section {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  padding: var(--gap-md);
  box-shadow: var(--shadow-flat);
  border: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}

.settings-section header,
.bindings-section header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-sm);
}

.description {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.jog-settings {
  display: grid;
  gap: var(--gap-md);
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.jog-settings.disabled {
  opacity: 0.6;
}

.setting {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.setting label {
  font-weight: 600;
  font-size: 0.9rem;
}

.setting input {
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px;
  color: inherit;
}

.readonly-field {
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px;
  font-weight: 600;
}

.bindings-section.disabled {
  opacity: 0.5;
}

.actions {
  display: flex;
  gap: var(--gap-sm);
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

.capture-banner {
  background: rgba(255, 215, 0, 0.1);
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: var(--radius-small);
  padding: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-sm);
}

.error {
  color: var(--color-danger, #f87171);
  margin: 0;
}

.bindings-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95rem;
}

.bindings-table th,
.bindings-table td {
  text-align: left;
  padding: 10px;
  border-bottom: 1px solid var(--color-border-subtle);
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
</style>
