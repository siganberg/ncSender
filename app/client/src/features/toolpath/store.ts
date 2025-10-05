import { useAppStore } from '../../composables/use-app-store';

// Thin feature facade over the centralized store. Enables gradual migration.
export function useToolpathStore() {
  return useAppStore();
}

