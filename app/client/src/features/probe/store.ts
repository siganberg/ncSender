import { computed } from 'vue';
import { useAppStore } from '../../composables/use-app-store';

// Feature-scoped probe store exposing only what ProbeVisualizer and parent components need
export function useProbeStore() {
  const app = useAppStore();

  return {
    isConnected: app.isConnected,
    isProbing: app.isProbing,
    machineState: computed(() => app.status.machineState),
    senderStatus: app.senderStatus
  };
}
