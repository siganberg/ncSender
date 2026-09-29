<template>
  <span class="magazine-size">
    <select class="magazine-size__select" :value="toolCount" :disabled="disabled" @change="onChange">
      <option v-for="n in 99" :key="n - 1" :value="n - 1">{{ n - 1 }}</option>
    </select>

    <!-- Shrinking the magazine unassigns the tools above the new size -->
    <Dialog v-if="pendingSize !== null" @close="cancel" :show-header="false" size="small">
      <ConfirmPanel
        title="Reduce Magazine Size"
        :message="`Changing magazine size to ${pendingSize} will unassign ${affected.length} tool${affected.length !== 1 ? 's' : ''} that ${affected.length !== 1 ? 'are' : 'is'} currently assigned to slots T${pendingSize + 1} and above. Do you want to continue?`"
        :show-cancel="true"
        confirm-text="Confirm"
        cancel-text="Cancel"
        variant="primary"
        @confirm="confirm"
        @cancel="cancel"
      />
    </Dialog>
  </span>
</template>

<script setup lang="ts">
// Magazine size for the Tool Changer settings tab. Moved out of the Tool
// Library footer together with its confirmation: shrinking the magazine
// unassigns every tool numbered above the new size (the probe's slot sits
// above the magazine and is left alone).
import { ref } from 'vue';
import { api } from '../../lib/api.js';
import Dialog from '../../components/Dialog.vue';
import ConfirmPanel from '../../components/ConfirmPanel.vue';

interface LibraryTool { id: number; toolNumber: number | null; [key: string]: unknown }

const props = defineProps<{
  toolCount: number;
  disabled?: boolean;
  // Tool number of the probe's slot when the Probe button is on, else null.
  probeSlot?: number | null;
}>();

const emit = defineEmits<{ 'update:toolCount': [value: number] }>();

const pendingSize = ref<number | null>(null);
const affected = ref<LibraryTool[]>([]);

const loadTools = async (): Promise<LibraryTool[]> => {
  const response = await fetch(`${api.baseUrl}/api/tools`);
  return response.ok ? await response.json() : [];
};

const onChange = async (event: Event) => {
  const select = event.target as HTMLSelectElement;
  const newSize = parseInt(select.value, 10);
  if (newSize < (props.toolCount || 0)) {
    const tools = await loadTools();
    const above = tools.filter(t => t.toolNumber !== null && t.toolNumber > newSize && t.toolNumber !== props.probeSlot);
    if (above.length > 0) {
      affected.value = above;
      pendingSize.value = newSize;
      select.value = String(props.toolCount);   // stays until confirmed
      return;
    }
  }
  emit('update:toolCount', newSize);
};

const confirm = async () => {
  if (pendingSize.value === null) return;
  const newSize = pendingSize.value;
  try {
    for (const tool of affected.value) {
      const response = await fetch(`${api.baseUrl}/api/tools/${tool.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...tool, toolNumber: null }),
      });
      if (!response.ok) throw new Error(`Failed to unassign tool ${tool.id}`);
    }
    emit('update:toolCount', newSize);
  } catch (error) {
    console.error('Error unassigning tools:', error);
  } finally {
    cancel();
  }
};

const cancel = () => {
  pendingSize.value = null;
  affected.value = [];
};
</script>

<style scoped>
.magazine-size__select {
  min-width: 72px;
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.95rem;
}

.magazine-size__select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
