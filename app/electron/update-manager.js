import { app, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater');

const OWNER = 'siganberg';
const REPO = 'ncSender';
const USER_AGENT = 'ncSender/auto-updater';

const UPDATE_CHANNELS = {
  STABLE: 'stable',
  DEV: 'dev'
};

const isDevEnv = process.env.NODE_ENV === 'development';

const formatReleaseNotes = (releaseNotes) => {
  if (!releaseNotes) {
    return '';
  }

  if (typeof releaseNotes === 'string') {
    return releaseNotes;
  }

  if (Array.isArray(releaseNotes)) {
    const matched = releaseNotes.find((item) => item?.language === 'en');
    return matched?.note || releaseNotes.map((item) => item?.note).filter(Boolean).join('\n\n');
  }

  // Best effort fallback
  return String(releaseNotes);
};

const normalizeVersion = (version) => version?.replace(/^v/i, '') ?? '';

const compareVersions = (a, b) => {
  const toParts = (value) => normalizeVersion(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const aParts = toParts(a);
  const bParts = toParts(b);
  const length = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < length; i += 1) {
    const aValue = aParts[i] ?? 0;
    const bValue = bParts[i] ?? 0;
    if (aValue > bValue) return 1;
    if (aValue < bValue) return -1;
  }

  return 0;
};

const resolvePreferredAsset = (assets = []) => {
  if (!assets?.length) {
    return null;
  }

  const platform = process.platform;
  const arch = process.arch;
  const priorities = [];

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      priorities.push('arm64', 'mac', '.zip', '.dmg');
    } else {
      priorities.push('x64', 'mac', '.zip', '.dmg');
    }
  } else if (platform === 'win32') {
    priorities.push('Setup.exe', '.exe', '.msi');
  } else if (platform === 'linux') {
    priorities.push('.AppImage', '.tar.gz', '.deb');
  }

  const ranked = [...priorities, '.zip', '.exe', '.AppImage', '.tar.gz', '.dmg'];

  for (const marker of ranked) {
    const matched = assets.find((asset) => asset.name?.toLowerCase().includes(marker.toLowerCase()));
    if (matched) return matched;
  }

  return assets[0];
};

const toRendererPayload = (info, overrides = {}) => ({
  version: normalizeVersion(info?.version ?? info?.tagName ?? info?.tag_name),
  releaseName: info?.releaseName ?? info?.name ?? null,
  releaseDate: info?.releaseDate ?? info?.publishedAt ?? info?.published_at ?? null,
  releaseNotes: formatReleaseNotes(info?.releaseNotes ?? info?.body),
  sourceUrl: info?.html_url ?? info?.sourceUrl ?? null,
  assets: info?.assets ?? null,
  ...overrides
});

class UpdateManager {
  constructor({ mainWindow }) {
    this.mainWindow = mainWindow;
    this.mode = process.env.NCSENDER_UPDATE_MODE
      ? String(process.env.NCSENDER_UPDATE_MODE).toLowerCase()
      : (app.isPackaged ? UPDATE_CHANNELS.STABLE : UPDATE_CHANNELS.DEV);

    this.allowPrerelease = process.env.NCSENDER_UPDATE_ALLOW_PRERELEASE === 'true';
    this.feedUrl = process.env.NCSENDER_UPDATE_FEED_URL || null;
    this.installOnComplete = false;
    this.latestInfo = null;
    this.activeDownload = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    if (this.mode === UPDATE_CHANNELS.STABLE) {
      this.configureAutoUpdater();
    } else {
      this.setupDevHandlers();
    }

    this.registerCommonHandlers();
  }

  setWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  configureAutoUpdater() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.fullChangelog = true;
    autoUpdater.logger = console;
    autoUpdater.allowPrerelease = this.allowPrerelease;

    if (this.feedUrl) {
      try {
        autoUpdater.setFeedURL({ url: this.feedUrl });
      } catch (error) {
        console.error('Failed to set custom feed URL:', error);
      }
    }

    autoUpdater.on('checking-for-update', () => {
      this.sendToRenderer('updates:checking', { timestamp: new Date().toISOString() });
    });

    autoUpdater.on('update-available', (info) => {
      this.latestInfo = info;
      this.sendToRenderer('updates:available', toRendererPayload(info, {
        channel: UPDATE_CHANNELS.STABLE,
        canInstall: true
      }));
    });

    autoUpdater.on('update-not-available', (info) => {
      this.latestInfo = null;
      this.sendToRenderer('updates:not-available', {
        channel: UPDATE_CHANNELS.STABLE,
        currentVersion: app.getVersion(),
        checkedAt: new Date().toISOString(),
        info: info ? toRendererPayload(info) : null
      });
    });

    autoUpdater.on('error', (error) => {
      const message = error?.message || 'Unknown updater error';
      console.error('Auto updater error:', error);
      this.sendToRenderer('updates:error', {
        message,
        stack: error?.stack ?? null,
        channel: UPDATE_CHANNELS.STABLE
      });
    });

    autoUpdater.on('download-progress', (progress) => {
      this.sendToRenderer('updates:download-progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
        channel: UPDATE_CHANNELS.STABLE
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.latestInfo = info;
      this.sendToRenderer('updates:downloaded', toRendererPayload(info, {
        channel: UPDATE_CHANNELS.STABLE,
        downloadedAt: new Date().toISOString(),
        canInstall: true
      }));

      if (this.installOnComplete) {
        setTimeout(() => {
          autoUpdater.quitAndInstall(false, true);
        }, 500);
      }
    });
  }

  registerCommonHandlers() {
    ipcMain.handle('updates/check', async () => {
      if (this.mode === UPDATE_CHANNELS.STABLE) {
        return this.handleStableCheck();
      }
      return this.handleDevCheck();
    });

    ipcMain.handle('updates/download', async (_event, options = {}) => {
      const installOnComplete = Boolean(options?.install);
      this.installOnComplete = installOnComplete;

      if (this.mode === UPDATE_CHANNELS.STABLE) {
        return this.handleStableDownload();
      }
      return this.handleDevDownload({ installOnComplete });
    });

    ipcMain.handle('updates/install', async () => {
      if (this.mode !== UPDATE_CHANNELS.STABLE) {
        this.sendToRenderer('updates:error', {
          message: 'Install is not available in development mode',
          channel: UPDATE_CHANNELS.DEV
        });
        return { error: 'install-not-available' };
      }

      try {
        autoUpdater.quitAndInstall(false, true);
        return { ok: true };
      } catch (error) {
        console.error('Failed to install update:', error);
        this.sendToRenderer('updates:error', {
          message: error?.message ?? 'Failed to install update',
          channel: UPDATE_CHANNELS.STABLE
        });
        return { error: error?.message ?? 'install-failed' };
      }
    });
  }

  async handleStableCheck() {
    try {
      this.sendToRenderer('updates:checking', { timestamp: new Date().toISOString() });
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error) {
      console.error('Failed to check for updates:', error);
      this.sendToRenderer('updates:error', {
        message: error?.message ?? 'Failed to check for updates',
        channel: UPDATE_CHANNELS.STABLE
      });
      return { error: error?.message ?? 'check-failed' };
    }
  }

  async handleStableDownload() {
    try {
      if (!this.latestInfo) {
        await autoUpdater.checkForUpdates();
      }
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      console.error('Failed to download update:', error);
      this.sendToRenderer('updates:error', {
        message: error?.message ?? 'Failed to download update',
        channel: UPDATE_CHANNELS.STABLE
      });
      return { error: error?.message ?? 'download-failed' };
    }
  }

  setupDevHandlers() {
    console.log('[UpdateManager] Running in development update mode');
  }

  async fetchLatestRelease() {
    const endpoint = this.allowPrerelease
      ? `https://api.github.com/repos/${OWNER}/${REPO}/releases`
      : `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/vnd.github+json'
    };

    const response = await fetch(endpoint, { headers });

    if (!response.ok) {
      throw new Error(`GitHub release query failed with status ${response.status}`);
    }

    const data = await response.json();
    if (Array.isArray(data)) {
      return data.find((item) => !item.draft && !item.prerelease) ?? data[0];
    }

    return data;
  }

  async handleDevCheck() {
    try {
      this.sendToRenderer('updates:checking', { timestamp: new Date().toISOString() });
      const latestRelease = await this.fetchLatestRelease();

      if (!latestRelease) {
        this.sendToRenderer('updates:not-available', {
          channel: UPDATE_CHANNELS.DEV,
          currentVersion: app.getVersion(),
          checkedAt: new Date().toISOString(),
          info: null
        });
        return { ok: true, latest: null };
      }

      const latestVersion = normalizeVersion(latestRelease.tag_name ?? latestRelease.name);
      const currentVersion = app.getVersion();
      const compareResult = compareVersions(latestVersion, currentVersion);

      if (compareResult > 0) {
        this.latestInfo = latestRelease;
        const payload = toRendererPayload(latestRelease, {
          channel: UPDATE_CHANNELS.DEV,
          canInstall: false,
          currentVersion
        });
        this.sendToRenderer('updates:available', payload);
        return { ok: true, latest: payload };
      }

      this.latestInfo = null;
      this.sendToRenderer('updates:not-available', {
        channel: UPDATE_CHANNELS.DEV,
        currentVersion,
        checkedAt: new Date().toISOString(),
        info: toRendererPayload(latestRelease)
      });
      return { ok: true, latest: null };
    } catch (error) {
      console.error('Dev update check failed:', error);
      this.sendToRenderer('updates:error', {
        message: error?.message ?? 'Failed to query GitHub releases',
        channel: UPDATE_CHANNELS.DEV
      });
      return { error: error?.message ?? 'check-failed' };
    }
  }

  async handleDevDownload({ installOnComplete }) {
    if (!this.latestInfo) {
      const result = await this.handleDevCheck();
      if (!this.latestInfo || result?.error) {
        return result;
      }
    }

    if (!this.latestInfo?.assets?.length) {
      const message = 'No downloadable assets found for latest release';
      this.sendToRenderer('updates:error', {
        message,
        channel: UPDATE_CHANNELS.DEV
      });
      return { error: 'no-assets' };
    }

    const asset = resolvePreferredAsset(this.latestInfo.assets);
    if (!asset) {
      const message = 'Could not find a matching asset for this platform';
      this.sendToRenderer('updates:error', {
        message,
        channel: UPDATE_CHANNELS.DEV
      });
      return { error: 'no-asset-match' };
    }

    try {
      const downloadDir = process.env.NCSENDER_UPDATE_DOWNLOAD_DIR || app.getPath('downloads');
      await fs.mkdir(downloadDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${asset.name.replace(/\.[^.]+$/, '')}-${timestamp}${path.extname(asset.name)}`;
      const downloadPath = path.join(downloadDir, filename);

      const headers = {
        'User-Agent': USER_AGENT,
        'Accept': 'application/octet-stream'
      };

      this.sendToRenderer('updates:download-started', {
        channel: UPDATE_CHANNELS.DEV,
        asset: {
          name: asset.name,
          size: asset.size,
          url: asset.browser_download_url
        },
        targetPath: downloadPath
      });

      const response = await fetch(asset.browser_download_url, { headers });
      if (!response.ok || !response.body) {
        throw new Error(`Asset download failed with status ${response.status}`);
      }

      const totalBytes = Number.parseInt(response.headers.get('content-length') || asset.size || '0', 10);
      let downloadedBytes = 0;

      const nodeReadable = Readable.fromWeb(response.body);
      const writable = createWriteStream(downloadPath);
      nodeReadable.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
        this.sendToRenderer('updates:download-progress', {
          percent,
          transferred: downloadedBytes,
          total: totalBytes,
          channel: UPDATE_CHANNELS.DEV
        });
      });

      await pipeline(nodeReadable, writable);

      this.sendToRenderer('updates:downloaded', toRendererPayload(this.latestInfo, {
        channel: UPDATE_CHANNELS.DEV,
        downloadedAt: new Date().toISOString(),
        downloadPath,
        canInstall: false,
        autoInstallRequested: installOnComplete
      }));

      if (installOnComplete) {
        const message = 'Install requested but not supported in development mode. Update package downloaded instead.';
        this.sendToRenderer('updates:error', {
          message,
          channel: UPDATE_CHANNELS.DEV
        });
      }

      return { ok: true, downloadPath };
    } catch (error) {
      console.error('Dev download failed:', error);
      this.sendToRenderer('updates:error', {
        message: error?.message ?? 'Failed to download update',
        channel: UPDATE_CHANNELS.DEV
      });
      return { error: error?.message ?? 'download-failed' };
    }
  }

  sendToRenderer(channel, payload) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    try {
      this.mainWindow.webContents.send(channel, payload);
    } catch (error) {
      console.error(`Failed to send ${channel} to renderer:`, error);
    }
  }
}

let singleton = null;

export const getUpdateManager = () => singleton;

export const initializeUpdateManager = (mainWindow) => {
  if (!singleton) {
    singleton = new UpdateManager({ mainWindow });
    singleton.init();
  } else if (mainWindow) {
    singleton.setWindow(mainWindow);
  }

  return singleton;
};

export const scheduleInitialUpdateCheck = (delayMs = 10000) => {
  const manager = getUpdateManager();
  if (!manager) {
    return;
  }

  const scheduleDelay = Number.parseInt(process.env.NCSENDER_UPDATE_INITIAL_DELAY_MS || `${delayMs}`, 10);
  const effectiveDelay = Number.isNaN(scheduleDelay) ? delayMs : scheduleDelay;

  setTimeout(() => {
    if (manager.mode === UPDATE_CHANNELS.STABLE) {
      manager.handleStableCheck();
    } else {
      manager.handleDevCheck();
    }
  }, Math.max(0, effectiveDelay));
};
