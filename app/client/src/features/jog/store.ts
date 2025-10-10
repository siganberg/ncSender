import { computed } from 'vue';
import { useAppStore } from '../../composables/use-app-store';

// Feature-scoped jog store exposing only what JogPanel needs.
export function useJogStore() {
  const app = useAppStore();

  return {
    isConnected: app.isConnected,
    isHomed: app.isHomed,
    isProbing: app.isProbing,
    machineState: computed(() => app.status.machineState),
    senderStatus: app.senderStatus
  };
}
