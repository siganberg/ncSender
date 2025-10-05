import { computed } from 'vue';
import { useAppStore } from '../../composables/use-app-store';

// Feature-scoped jog store exposing only what JogPanel needs.
export function useJogStore() {
  const app = useAppStore();

  const machineState = computed(() => app.status.machineState);

  return {
    isConnected: app.isConnected,
    isHomed: app.isHomed,
    machineState
  };
}
