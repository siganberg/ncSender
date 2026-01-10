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

import { reactive, readonly } from 'vue';
import packageJson from '../../../package.json';

const state = reactive({
  supported: typeof window !== 'undefined' ? Boolean(window.ncSender?.updates) : false,
  currentVersion: packageJson.version,
  channel: 'stable' as string,
  isChecking: false,
  isAvailable: false,
  isDownloading: false,
  isInstalling: false,
  downloaded: false,
  latestVersion: null as string | null,
  releaseName: null as string | null,
  releaseDate: null as string | null,
  releaseNotes: '' as string,
  releaseUrl: null as string | null,
  lastCheckedAt: null as string | null,
  downloadPercent: 0,
  downloadPath: null as string | null,
  statusMessage: '' as string,
  error: null as string | null,
  canInstall: false,
  autoInstallRequested: false
});

let initialized = false;
let disposers: Array<() => void> = [];
let retryTimer: ReturnType<typeof setInterval> | null = null;

const resetDownloadState = () => {
  state.isDownloading = false;
  state.isInstalling = false;
  state.downloadPercent = 0;
  state.downloadPath = null;
  state.downloaded = false;
  state.autoInstallRequested = false;
};

const initListeners = () => {
  const updates = window.ncSender?.updates;
  if (!updates) {
    state.supported = false;
    return;
  }

  state.supported = true;

  const register = <T>(registerFn: ((callback: (payload: T) => void) => () => void) | undefined, handler: (payload: T) => void) => {
    if (!registerFn) {
      return;
    }
    const dispose = registerFn((payload: T) => handler(payload));
    if (typeof dispose === 'function') {
      disposers.push(dispose);
    }
  };

  register(updates.onChecking, () => {
    state.isChecking = true;
    state.error = null;
    state.statusMessage = 'Checking for updates…';
  });

  register(updates.onAvailable, (payload) => {
    state.isChecking = false;
    state.isAvailable = true;
    state.latestVersion = payload?.version ?? null;
    state.releaseName = payload?.releaseName ?? null;
    state.releaseDate = payload?.releaseDate ?? null;
    state.releaseNotes = payload?.releaseNotes ?? '';
    state.releaseUrl = payload?.sourceUrl ?? null;
    state.canInstall = Boolean(payload?.canInstall);
    state.channel = payload?.channel ?? state.channel;
    state.statusMessage = 'Update available';
    state.error = null;
    state.lastCheckedAt = new Date().toISOString();
    resetDownloadState();
  });

  register(updates.onNotAvailable, (payload: any) => {
    state.isChecking = false;
    state.isAvailable = false;
    state.statusMessage = 'Application is up to date';
    state.lastCheckedAt = payload?.checkedAt ?? new Date().toISOString();
    state.channel = payload?.channel ?? state.channel;
    state.releaseUrl = null;
    state.releaseName = null;
    state.releaseDate = null;
    state.releaseNotes = '';
    resetDownloadState();
  });

  register(updates.onError, (payload) => {
    state.isChecking = false;
    state.isDownloading = false;
    state.isInstalling = false;
    state.statusMessage = 'Update error';
    state.error = payload?.message ?? 'Unknown update error';
  });

  register(updates.onDownloadStarted, (payload: any) => {
    state.isDownloading = true;
    state.downloadPercent = 0;
    state.downloadPath = payload?.targetPath ?? null;
    state.statusMessage = 'Starting download…';
    state.autoInstallRequested = Boolean(payload?.autoInstallRequested);
  });

  register(updates.onDownloadProgress, (payload) => {
    state.isDownloading = true;
    state.downloadPercent = Math.max(0, Math.min(100, payload?.percent ?? 0));
    state.statusMessage = `Downloading update… ${state.downloadPercent.toFixed(1)}%`;
  });

  register(updates.onDownloaded, (payload) => {
    state.isDownloading = false;
    state.downloaded = true;
    state.downloadPercent = 100;
    state.downloadPath = payload?.downloadPath ?? state.downloadPath;
    state.statusMessage = payload?.canInstall ? 'Update ready to install' : 'Update downloaded';
    state.canInstall = Boolean(payload?.canInstall);
    state.latestVersion = payload?.version ?? state.latestVersion;
    state.releaseName = payload?.releaseName ?? state.releaseName;
    state.releaseDate = payload?.releaseDate ?? state.releaseDate;
    state.releaseNotes = payload?.releaseNotes ?? state.releaseNotes;
    state.autoInstallRequested = Boolean(payload?.autoInstallRequested);
    state.releaseUrl = payload?.sourceUrl ?? state.releaseUrl;
  });

  register(updates.onInstalling, () => {
    state.isInstalling = true;
    state.isDownloading = false;
    state.statusMessage = 'Installing update… The application will restart shortly.';
    state.error = null;
  });
};

export const useUpdateCenter = () => {
  const ensureListeners = () => {
    if (initialized) {
      return;
    }
    initialized = true;
    initListeners();
    if (!state.supported && typeof window !== 'undefined') {
      retryTimer = setInterval(() => {
        if (window.ncSender?.updates) {
          if (retryTimer) {
            clearInterval(retryTimer);
            retryTimer = null;
          }
          initListeners();
        }
      }, 500);
      disposers.push(() => {
        if (retryTimer) {
          clearInterval(retryTimer);
          retryTimer = null;
        }
      });
    }
  };

  const checkForUpdates = () => window.ncSender?.updates?.checkForUpdates();
  const downloadAndInstall = () => window.ncSender?.updates?.downloadUpdate({ install: true });
  const downloadOnly = () => window.ncSender?.updates?.downloadUpdate({ install: false });

  const clearError = () => {
    state.error = null;
  };

  const resetState = () => {
    state.isAvailable = false;
    resetDownloadState();
    state.statusMessage = '';
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      disposers.forEach((dispose) => dispose());
      disposers = [];
      initialized = false;
      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
      }
    }, { once: true });
  }

  return {
    state: readonly(state),
    ensureListeners,
    checkForUpdates,
    downloadAndInstall,
    downloadOnly,
    clearError,
    resetState
  };
};
