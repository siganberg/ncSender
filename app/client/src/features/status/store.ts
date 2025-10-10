import { computed } from 'vue';
import { useAppStore } from '../../composables/use-app-store';

// Feature-scoped status store exposing only what StatusPanel needs.
export function useStatusStore() {
  const app = useAppStore();

  // Narrow interface: expose only the bits StatusPanel consumes.
  return {
    isConnected: app.isConnected,
    isHomed: app.isHomed,
    isProbing: app.isProbing,
    machineState: computed(() => app.status.machineState),
    senderStatus: app.senderStatus
  };
}
