import { ref, computed } from 'vue';
import { api } from './api';
import type { Macro } from './types';

const macros = ref<Macro[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

export function useMacroStore() {
  const loadMacros = async () => {
    loading.value = true;
    error.value = null;
    try {
      macros.value = await api.getMacros();
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
