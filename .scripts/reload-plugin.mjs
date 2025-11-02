#!/usr/bin/env node

import { watch } from 'fs';
import { resolve, basename } from 'path';

const DEV_PLUGINS_DIR = process.env.DEV_PLUGINS_DIR;

if (!DEV_PLUGINS_DIR) {
  console.error('DEV_PLUGINS_DIR environment variable not set');
  process.exit(1);
}

const pluginDirs = process.argv.slice(2);

if (pluginDirs.length === 0) {
  console.error('Usage: node reload-plugin.mjs <plugin-dir> [<plugin-dir> ...]');
  console.error('Example: node reload-plugin.mjs com.ncsender.toolbench');
  process.exit(1);
}

const serverUrl = process.env.SERVER_URL || 'http://localhost:8090';

// Track last reload time per plugin to debounce
const lastReload = new Map();
const DEBOUNCE_MS = 500;

async function reloadPlugin(pluginId) {
  const now = Date.now();
  const last = lastReload.get(pluginId) || 0;

  if (now - last < DEBOUNCE_MS) {
    return;
  }

  lastReload.set(pluginId, now);

  try {
    const response = await fetch(`${serverUrl}/api/plugins/${pluginId}/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✓ ${result.message}`);
    } else {
      const error = await response.json();
      console.error(`✗ Failed to reload ${pluginId}:`, error.error);
    }
  } catch (error) {
    console.error(`✗ Error reloading ${pluginId}:`, error.message);
  }
}

console.log('Watching for plugin changes...');
console.log('Server:', serverUrl);
console.log('Plugins:', pluginDirs.join(', '));
console.log('');

for (const pluginDir of pluginDirs) {
  const pluginPath = resolve(DEV_PLUGINS_DIR, pluginDir);
  const pluginId = pluginDir;

  console.log(`👁  Watching: ${pluginPath}`);

  watch(pluginPath, { recursive: true }, (eventType, filename) => {
    if (!filename) return;

    // Only watch .js, .json, .css files
    if (!/\.(js|json|css)$/.test(filename)) return;

    console.log(`📝 Changed: ${filename}`);
    reloadPlugin(pluginId);
  });
}

console.log('\nPress Ctrl+C to stop watching\n');
