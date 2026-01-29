/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

import { ref, computed } from 'vue';
import { m98Api } from './api';
import type { M98Macro, M98MacroFormData, M98IdInfo } from './types';
import { commandRegistry } from '@/lib/command-registry';
import { useAppStore } from '@/composables/use-app-store';
import { keyBindingStore } from '@/features/controls/key-binding-store';

const MACRO_ACTION_PREFIX = 'Macro:';
const registeredMacroActions = new Set<string>();
const appStore = useAppStore();

const macros = ref<M98Macro[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const idInfo = ref<M98IdInfo | null>(null);

export function useM98MacroStore() {
  const syncMacroActions = (list: M98Macro[]) => {
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
        label: `${macro.name} (P${macro.id})`,
        group: 'Macros',
        description: macro.description || `M98 P${macro.id}`,
        handler: async () => {
          await m98Api.executeMacro(macro.id);
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
      macros.value = await m98Api.getMacros();
      syncMacroActions(macros.value);
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load macros';
      console.error('Failed to load macros:', err);
    } finally {
      loading.value = false;
    }
  };

  const loadNextId = async () => {
    try {
      idInfo.value = await m98Api.getNextId();
    } catch (err) {
      console.error('Failed to get next ID:', err);
    }
  };

  const createMacro = async (data: M98MacroFormData) => {
    try {
      const newMacro = await m98Api.createMacro(data);
      macros.value.push(newMacro);
      macros.value.sort((a, b) => a.id - b.id);
      syncMacroActions(macros.value);
      await loadNextId();
      return newMacro;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create macro';
      throw err;
    }
  };

  const updateMacro = async (id: number, data: Partial<M98MacroFormData>) => {
    try {
      const updatedMacro = await m98Api.updateMacro(id, data);
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

  const deleteMacro = async (id: number) => {
    try {
      await m98Api.deleteMacro(id);
      macros.value = macros.value.filter(m => m.id !== id);
      syncMacroActions(macros.value);

      const actionId = `${MACRO_ACTION_PREFIX}${id}`;
      await keyBindingStore.deleteBindingForAction(actionId);
      await loadNextId();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete macro';
      throw err;
    }
  };

  const executeMacro = async (id: number) => {
    try {
      return await m98Api.executeMacro(id);
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to execute macro';
      throw err;
    }
  };

  const getMacroById = (id: number) => computed(() => macros.value.find(m => m.id === id));

  const setMacros = (data: M98Macro[]) => {
    macros.value = data;
    syncMacroActions(data);
  };

  return {
    macros: computed(() => macros.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    idInfo: computed(() => idInfo.value),
    loadMacros,
    loadNextId,
    createMacro,
    updateMacro,
    deleteMacro,
    executeMacro,
    getMacroById,
    setMacros
  };
}

// Legacy store for backward compatibility
export function useMacroStore() {
  const store = useM98MacroStore();

  return {
    macros: computed(() => store.macros.value.map(m => ({
      id: String(m.id),
      name: m.name,
      description: m.description || undefined,
      commands: m.body,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt
    }))),
    loading: store.loading,
    error: store.error,
    loadMacros: store.loadMacros,
    createMacro: async (data: { name: string; description?: string; commands: string }) => {
      const macro = await store.createMacro({
        name: data.name,
        description: data.description,
        body: data.commands
      });
      return {
        id: String(macro.id),
        name: macro.name,
        description: macro.description || undefined,
        commands: macro.body,
        createdAt: macro.createdAt,
        updatedAt: macro.updatedAt
      };
    },
    updateMacro: async (id: string, data: Partial<{ name: string; description?: string; commands: string }>) => {
      const macro = await store.updateMacro(parseInt(id, 10), {
        name: data.name,
        description: data.description,
        body: data.commands
      });
      return {
        id: String(macro.id),
        name: macro.name,
        description: macro.description || undefined,
        commands: macro.body,
        createdAt: macro.createdAt,
        updatedAt: macro.updatedAt
      };
    },
    deleteMacro: async (id: string) => {
      await store.deleteMacro(parseInt(id, 10));
    },
    getMacroById: (id: string) => computed(() => {
      const macro = store.macros.value.find(m => m.id === parseInt(id, 10));
      if (!macro) return undefined;
      return {
        id: String(macro.id),
        name: macro.name,
        description: macro.description || undefined,
        commands: macro.body,
        createdAt: macro.createdAt,
        updatedAt: macro.updatedAt
      };
    }),
    setMacros: (data: Array<{ id: string; name: string; description?: string; commands: string; createdAt: string; updatedAt: string }>) => {
      store.setMacros(data.map(m => ({
        id: parseInt(m.id, 10),
        name: m.name,
        description: m.description || null,
        body: m.commands,
        content: '',
        createdAt: m.createdAt,
        updatedAt: m.updatedAt
      })));
    }
  };
}
