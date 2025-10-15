import { ref, computed } from 'vue';
import { api } from './api';
import type { Macro } from './types';
import { commandRegistry } from '@/lib/command-registry';
import { useAppStore } from '@/composables/use-app-store';

const MACRO_ACTION_PREFIX = 'Macro:';
const registeredMacroActions = new Set<string>();
const appStore = useAppStore();

const macros = ref<Macro[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

export function useMacroStore() {
  const syncMacroActions = (list: Macro[]) => {
    const nextIds = new Set(list.map(m => `${MACRO_ACTION_PREFIX}${m.id}`));

    for (const actionId of Array.from(registeredMacroActions)) {
      if (!nextIds.has(actionId)) {
        commandRegistry.unregister(actionId);
        registeredMacroActions.delete(actionId);
      }
    }

    list.forEach((macro) => {
      const actionId = `${MACRO_ACTION_PREFIX}${macro.id}`;
      commandRegistry.register({
        id: actionId,
        label: macro.name,
        group: 'Macros',
        description: macro.description,
        handler: async () => {
          await api.executeMacro(macro.id);
        },
        isEnabled: () => appStore.isConnected.value
      });
      registeredMacroActions.add(actionId);
    });
  };

  const loadMacros = async () => {
    loading.value = true;
    error.value = null;
    try {
      macros.value = await api.getMacros();
      syncMacroActions(macros.value);
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load macros';
      console.error('Failed to load macros:', err);
    } finally {
      loading.value = false;
    }
  };

  const createMacro = async (data: { name: string; description?: string; commands: string }) => {
    try {
      const newMacro = await api.createMacro(data);
      macros.value.push(newMacro);
      syncMacroActions(macros.value);
      return newMacro;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create macro';
      throw err;
    }
  };

  const updateMacro = async (id: string, data: Partial<{ name: string; description?: string; commands: string }>) => {
    try {
      const updatedMacro = await api.updateMacro(id, data);
      const index = macros.value.findIndex(m => m.id === id);
      if (index !== -1) {
        macros.value[index] = updatedMacro;
        syncMacroActions(macros.value);
      }
      return updatedMacro;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update macro';
      throw err;
    }
  };

  const deleteMacro = async (id: string) => {
    try {
      await api.deleteMacro(id);
      macros.value = macros.value.filter(m => m.id !== id);
      syncMacroActions(macros.value);
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete macro';
      throw err;
    }
  };

  const getMacroById = (id: string) => computed(() => macros.value.find(m => m.id === id));

  return {
    macros: computed(() => macros.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    loadMacros,
    createMacro,
    updateMacro,
    deleteMacro,
    getMacroById
  };
}
