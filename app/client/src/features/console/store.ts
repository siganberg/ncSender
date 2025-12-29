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
    selectedGCodeLines: app.selectedGCodeLines,
    setSelectedGCodeLines: app.setSelectedGCodeLines,
    clearSelectedGCodeLines: app.clearSelectedGCodeLines,
    requestStartFromLine: app.requestStartFromLine,
    jobLoaded,
    // History helpers (delegate to API): return unsubscribe for convenience
    onHistoryAppended: (callback: (event: any) => void) => api.onCommandHistoryAppended(callback),
    addToHistory: (command: string) => api.addCommandToHistory(command),
    // Console auto-scroll helpers: delegate event subscription to API
    onCncCommand: (handler: (evt: any) => void) => api.on('cnc-command', handler),
    onCncCommandResult: (handler: (evt: any) => void) => api.on('cnc-command-result', handler),
    onCncData: (handler: (evt: any) => void) => api.on('cnc-data', handler),
    // Bundle useful auto-scroll wiring
    startAutoScrollBindings: (onActivity: (evt?: any) => void | Promise<void>) => {
      const off1 = api.on('cnc-command', onActivity);
      const off2 = api.on('cnc-command-result', onActivity);
      const off3 = api.on('cnc-data', onActivity);
      return () => {
        try { off1 && off1(); } catch {}
        try { off2 && off2(); } catch {}
        try { off3 && off3(); } catch {}
      };
    }
  };
}
