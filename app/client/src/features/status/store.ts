import { computed } from 'vue';
import { useAppStore } from '../../composables/use-app-store';

// Feature-scoped status store exposing only what StatusPanel needs.
export function useStatusStore() {
  const app = useAppStore();

  // Narrow interface: expose only the bits StatusPanel consumes.
  const machineState = computed(() => app.status.machineState);

  return {
    isConnected: app.isConnected,
    isHomed: app.isHomed,
    machineState
  };
}
