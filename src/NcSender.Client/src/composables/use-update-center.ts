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
import { api } from '@/lib/api.js';

const state = reactive({
  supported: typeof window !== 'undefined' ? Boolean(window.ncSender?.updates) : false,
  currentVersion: api.serverVersion || packageJson.version,
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
let transport: 'ipc' | 'rest' | null = null;

const resetDownloadState = () => {
  state.isDownloading = false;
  state.isInstalling = false;
  state.downloadPercent = 0;
  state.downloadPath = null;
  state.downloaded = false;
  state.autoInstallRequested = false;
};

const handleChecking = () => {
  state.isChecking = true;
  state.error = null;
  state.statusMessage = 'Checking for updates…';
};

const handleAvailable = (payload: any) => {
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
};

const handleNotAvailable = (payload: any) => {
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
};

const handleError = (payload: any) => {
  state.isChecking = false;
  state.isDownloading = false;
  state.isInstalling = false;
  state.statusMessage = 'Update error';
  state.error = payload?.message ?? 'Unknown update error';
};

const handleDownloadStarted = (payload: any) => {
  state.isDownloading = true;
  state.downloadPercent = 0;
  state.downloadPath = payload?.targetPath ?? null;
  state.statusMessage = 'Starting download…';
  state.autoInstallRequested = Boolean(payload?.autoInstallRequested);
};

const handleDownloadProgress = (payload: any) => {
  state.isDownloading = true;
  state.downloadPercent = Math.max(0, Math.min(100, payload?.percent ?? 0));
  state.statusMessage = `Downloading update… ${state.downloadPercent.toFixed(1)}%`;
};

const handleDownloaded = (payload: any) => {
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
};

let reloadPoll: ReturnType<typeof setInterval> | null = null;
let reloadTriggered = false;
let serverWentDown = false;

const startReloadPoll = () => {
  if (reloadPoll || reloadTriggered) return;
  serverWentDown = false;
  reloadPoll = setInterval(async () => {
    if (reloadTriggered) return;
    try {
      const res = await fetch('/api/health', { signal: AbortSignal.timeout(2000) });
      if (res.ok && serverWentDown) {
        reloadTriggered = true;
        if (reloadPoll) { clearInterval(reloadPoll); reloadPoll = null; }
        window.location.href = window.location.pathname + '?v=' + Date.now();
      }
    } catch {
      serverWentDown = true;
    }
  }, 1500);
  setTimeout(() => { if (reloadPoll) { clearInterval(reloadPoll); reloadPoll = null; } }, 30000);
};

const handleInstalling = () => {
  state.isInstalling = true;
  state.isDownloading = false;
  state.statusMessage = 'Installing update… The application will restart shortly.';
  state.error = null;
  // Start polling — server will restart and we need to reload when it's back
  startReloadPoll();
};

const handleInstalled = () => {
  state.isInstalling = false;
  state.statusMessage = 'Update installed. Restarting application…';
  startReloadPoll();
};

const initIpcListeners = () => {
  const updates = window.ncSender?.updates;
  if (!updates) {
    return false;
  }

  transport = 'ipc';
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

  register(updates.onChecking, handleChecking);
  register(updates.onAvailable, handleAvailable);
  register(updates.onNotAvailable, handleNotAvailable);
  register(updates.onError, handleError);
  register(updates.onDownloadStarted, handleDownloadStarted);
  register(updates.onDownloadProgress, handleDownloadProgress);
  register(updates.onDownloaded, handleDownloaded);
  register(updates.onInstalling, handleInstalling);
  register(updates.onInstalled, handleInstalled);

  return true;
};

const initRestListeners = () => {
  transport = 'rest';
  state.supported = true;

  const subscribe = (event: string, handler: (payload: any) => void) => {
    const dispose = api.on(event, handler);
    if (typeof dispose === 'function') {
      disposers.push(dispose);
    }
  };

  subscribe('server-version', (version: string) => { state.currentVersion = version; });
  subscribe('updates:checking', handleChecking);
  subscribe('updates:available', handleAvailable);
  subscribe('updates:not-available', handleNotAvailable);
  subscribe('updates:error', handleError);
  subscribe('updates:download-started', handleDownloadStarted);
  subscribe('updates:download-progress', handleDownloadProgress);
  subscribe('updates:downloaded', handleDownloaded);
  subscribe('updates:installing', handleInstalling);
  subscribe('updates:installed', handleInstalled);
};

const initListeners = () => {
  if (initIpcListeners()) {
    return;
  }
  initRestListeners();
};

export const useUpdateCenter = () => {
  const ensureListeners = () => {
    if (initialized) {
      return;
    }
    initialized = true;
    initListeners();
    if (api.serverVersion) {
      state.currentVersion = api.serverVersion;
    }
    fetch('/api/updates/channel').then((r) => r.json()).then((data) => {
      if (data?.channel) state.channel = data.channel;
    }).catch(() => {});
    if (!state.supported && typeof window !== 'undefined') {
      retryTimer = setInterval(() => {
        if (window.ncSender?.updates) {
          if (retryTimer) {
            clearInterval(retryTimer);
            retryTimer = null;
          }
          initIpcListeners();
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

  const checkForUpdates = async () => {
    if (transport === 'ipc') {
      return window.ncSender?.updates?.checkForUpdates();
    }
    handleChecking();
    try {
      const res = await fetch('/api/updates/check');
      const data = await res.json();
      if (data.currentVersion) state.currentVersion = data.currentVersion;
      if (data.updateAvailable) {
        handleAvailable({
          version: data.latestVersion,
          releaseNotes: data.releaseNotes,
          releaseDate: data.publishedAt,
          canInstall: data.canInstall,
          channel: data.channel,
          sourceUrl: data.releaseUrl
        });
      } else {
        handleNotAvailable({
          channel: data.channel,
          checkedAt: new Date().toISOString()
        });
      }
      return data;
    } catch (err: any) {
      handleError({ message: err?.message || 'Update check failed' });
    }
  };

  const pollStatus = (onDone: () => void) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/updates/status');
        const data = await res.json();
        if (data.phase === 'downloading' && data.downloadPercent > 0) {
          handleDownloadProgress({ percent: data.downloadPercent });
        } else if (data.phase === 'installing') {
          handleInstalling();
        } else if (data.phase === 'installed') {
          clearInterval(interval);
          handleInstalled();
          onDone();
        } else if (data.phase === 'error') {
          clearInterval(interval);
          handleError({ message: data.error || 'Update failed' });
          onDone();
        }
      } catch { /* server may be restarting */ }
    }, 500);
    return interval;
  };

  const downloadAndInstall = async () => {
    if (transport === 'ipc') {
      return window.ncSender?.updates?.downloadUpdate({ install: true });
    }
    handleDownloadStarted({ autoInstallRequested: true });

    let statusPoll: ReturnType<typeof setInterval> | null = null;
    const pollDone = new Promise<void>((resolve) => {
      statusPoll = pollStatus(resolve);
    });

    try {
      const res = await fetch('/api/updates/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ install: true })
      });
      const data = await res.json();
      if (!res.ok) {
        if (statusPoll) clearInterval(statusPoll);
        handleError({ message: data?.error || 'Download failed' });
        return data;
      }
      // Wait for status poll to confirm installed
      await pollDone;
      return data;
    } catch (err: any) {
      if (statusPoll) clearInterval(statusPoll);
      handleError({ message: err?.message || 'Download failed' });
    }
  };

  const downloadOnly = async () => {
    if (transport === 'ipc') {
      return window.ncSender?.updates?.downloadUpdate({ install: false });
    }
    handleDownloadStarted({});
    try {
      const res = await fetch('/api/updates/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ install: false })
      });
      const data = await res.json();
      if (res.ok) {
        handleDownloaded({ canInstall: state.canInstall });
      } else {
        handleError({ message: data?.error || 'Download failed' });
      }
      return data;
    } catch (err: any) {
      handleError({ message: err?.message || 'Download failed' });
    }
  };

  const setChannel = async (channel: string) => {
    state.channel = channel;
    try {
      await fetch('/api/updates/channel', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel })
      });
    } catch {
      // Best-effort persist — still check with the new channel
    }
    return checkForUpdates();
  };

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
      transport = null;
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
    setChannel,
    clearError,
    resetState
  };
};
