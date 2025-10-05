import { computed } from 'vue';
import { useAppStore } from '../../composables/use-app-store';
import { api } from './api';

// Feature-scoped console store exposing only what ConsolePanel needs.
export function useConsoleStore() {
  const app = useAppStore();

  const jobLoaded = computed(() => app.serverState.jobLoaded);

  return {
    isConnected: app.isConnected,
    gcodeContent: app.gcodeContent,
    gcodeFilename: app.gcodeFilename,
    gcodeLineCount: app.gcodeLineCount,
    gcodeCompletedUpTo: app.gcodeCompletedUpTo,
    jobLoaded,
    // History helpers (delegate to API): return unsubscribe for convenience
    onHistoryAppended: (callback: (event: any) => void) => api.onCommandHistoryAppended(callback),
    addToHistory: (command: string) => api.addCommandToHistory(command),
    // Console auto-scroll helpers: delegate event subscription to API
    onCncCommand: (handler: (evt: any) => void) => api.on('cnc-command', handler),
    onCncCommandResult: (handler: (evt: any) => void) => api.on('cnc-command-result', handler)
  };
}
