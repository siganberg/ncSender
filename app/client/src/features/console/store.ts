import { useAppStore } from '../../composables/use-app-store';

// Thin feature facade over the centralized store. Enables gradual migration.
export function useConsoleStore() {
  return useAppStore();
}

