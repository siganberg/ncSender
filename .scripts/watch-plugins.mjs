#!/usr/bin/env node

/**
 * Watch the `plugins/` directory and run the sync script when files change.
 * This keeps the development plugins in the ncSender data directory up-to-date
 * while you're iterating locally.
 */

import { spawn } from 'node:child_process';
import { watch, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const pluginsDir = process.env.DEV_PLUGINS_DIR || path.join(projectRoot, 'plugins');
const syncScript = path.join(projectRoot, '.scripts', 'sync-plugins.sh');

const debounceMs = Number.parseInt(process.env.PLUGIN_SYNC_DEBOUNCE ?? '250', 10);
let debounceTimer = null;
let syncRunning = false;
let syncPending = false;

const watchers = new Map();
let usingRecursiveWatcher = false;
let usingPolling = false;
let pollTimer = null;
let previousSnapshot = new Map();
const pollIntervalMs = Number.parseInt(process.env.PLUGIN_SYNC_POLL ?? '1500', 10);

function scheduleSync() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSync, debounceMs);
}

function runSync() {
  if (syncRunning) {
    syncPending = true;
    return;
  }

  syncRunning = true;
  syncPending = false;

  const startedAt = new Date().toLocaleTimeString();
  console.log(`[plugins:watch] Syncing plugins (${startedAt})`);

  const child = spawn(syncScript, {
    cwd: projectRoot,
    stdio: 'inherit'
  });

  child.on('close', (code, signal) => {
    syncRunning = false;

    if (code !== 0) {
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      console.error(`[plugins:watch] Sync failed (${reason}).`);
    } else {
      console.log('[plugins:watch] Sync complete.');
    }

    if (syncPending) {
      runSync();
    }
  });

  child.on('error', (error) => {
    syncRunning = false;
    console.error('[plugins:watch] Failed to launch sync script:', error);
  });
}

function handleEvent(dirPath, eventType, filename = '') {
  if (!filename) {
    scheduleSync();
    return;
  }

  // Ignore temp/editor swap files
  if (filename.startsWith('.') || filename.endsWith('~') || filename.endsWith('.swp')) {
    return;
  }

  const fullPath = path.join(dirPath, filename);

  if (!usingRecursiveWatcher && eventType === 'rename' && existsSync(fullPath)) {
    try {
      if (statSync(fullPath).isDirectory()) {
        watchDirectory(fullPath);
      }
    } catch (err) {
      console.warn(`[plugins:watch] Unable to inspect ${fullPath}:`, err.message);
    }
  }

  scheduleSync();
}

function startWatcher(dirPath, options) {
  try {
    const watcher = watch(dirPath, options, (eventType, filename) => {
      handleEvent(dirPath, eventType, filename);
    });

    watcher.on('error', (error) => {
      console.error(`[plugins:watch] Watcher error for ${dirPath}:`, error);
      if (error && error.code === 'EMFILE') {
        watcher.close();
        watchers.delete(dirPath);
        if (!usingPolling) {
          startPolling();
        }
      }
    });

    watchers.set(dirPath, watcher);
    usingPolling = false;
    return true;
  } catch (error) {
    console.error(`[plugins:watch] Unable to watch ${dirPath}:`, error);
    return false;
  }
}

function watchDirectory(dirPath) {
  if (watchers.has(dirPath)) {
    return;
  }

  const started = startWatcher(dirPath, { recursive: false });
  if (!started) {
    return;
  }

  // Recurse into sub-directories that already exist.
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        watchDirectory(path.join(dirPath, entry.name));
      }
    }
  } catch (error) {
    console.error(`[plugins:watch] Failed to enumerate ${dirPath}:`, error);
  }
}

function ensurePluginsDir() {
  try {
    const stats = statSync(pluginsDir);
    if (!stats.isDirectory()) {
      console.error(`[plugins:watch] Expected ${pluginsDir} to be a directory.`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`[plugins:watch] Cannot access ${pluginsDir}:`, error.message);
    process.exit(1);
  }
}

function main() {
  ensurePluginsDir();
  console.log(`[plugins:watch] Watching ${pluginsDir}`);

  let recursiveReady = false;
  try {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      recursiveReady = startWatcher(pluginsDir, { recursive: true });
      if (recursiveReady) {
        usingRecursiveWatcher = true;
      }
    }
  } catch {
    recursiveReady = false;
  }

  if (!recursiveReady) {
    watchDirectory(pluginsDir);
  }

  if (watchers.size === 0) {
    startPolling();
  }

  runSync(); // Kick off an initial sync.
}

function buildSnapshot(dirPath) {
  const snapshot = new Map();
  const stack = [dirPath];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      console.error(`[plugins:watch] Failed to read ${currentDir}:`, error.message);
      continue;
    }

    for (const entry of entries) {
      if (entry.name === '.DS_Store') {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        try {
          const stats = statSync(fullPath);
          const relativePath = path.relative(dirPath, fullPath);
          snapshot.set(relativePath, `${stats.size}:${stats.mtimeMs}`);
        } catch (error) {
          console.error(`[plugins:watch] Failed to stat ${fullPath}:`, error.message);
        }
      }
    }
  }

  return snapshot;
}

function snapshotsDiffer(prev, next) {
  if (prev.size !== next.size) {
    return true;
  }

  for (const [key, value] of next.entries()) {
    if (!prev.has(key) || prev.get(key) !== value) {
      return true;
    }
  }

  return false;
}

function startPolling() {
  usingPolling = true;
  console.log(`[plugins:watch] Native file watching unavailable, polling every ${pollIntervalMs}ms.`);

  try {
    previousSnapshot = buildSnapshot(pluginsDir);
  } catch (error) {
    console.error('[plugins:watch] Initial snapshot failed:', error.message);
    previousSnapshot = new Map();
  }

  const poll = () => {
    let nextSnapshot;
    try {
      nextSnapshot = buildSnapshot(pluginsDir);
    } catch (error) {
      console.error('[plugins:watch] Snapshot failed:', error.message);
      pollTimer = setTimeout(poll, pollIntervalMs);
      return;
    }

    if (snapshotsDiffer(previousSnapshot, nextSnapshot)) {
      previousSnapshot = nextSnapshot;
      scheduleSync();
    }

    pollTimer = setTimeout(poll, pollIntervalMs);
  };

  pollTimer = setTimeout(poll, pollIntervalMs);
}

process.on('SIGINT', () => {
  console.log('\n[plugins:watch] Stopping watcher.');
  for (const watcher of watchers.values()) {
    watcher.close();
  }
  if (pollTimer) {
    clearTimeout(pollTimer);
  }
  process.exit(0);
});

main();
