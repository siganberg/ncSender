import { Router } from 'express';
import { pluginManager } from '../../core/plugin-manager.js';
import multer from 'multer';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import AdmZip from 'adm-zip';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}] [PLUGIN ROUTES]`, ...args);
};

const uploadTempDir = path.join(os.tmpdir(), 'ncsender-plugins');
if (!fsSync.existsSync(uploadTempDir)) {
  fsSync.mkdirSync(uploadTempDir, { recursive: true });
}

const upload = multer({ dest: uploadTempDir });

async function readAndValidateManifest(manifestPath) {
  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);

  if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry) {
    throw new Error('Invalid manifest: missing required fields (id, name, version, entry)');
  }

  return manifest;
}

function asyncHandler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      log('Route error:', error);
      const statusCode = error.statusCode || 500;
      const message = error.message || 'Internal server error';
      res.status(statusCode).json({ error: message });
    }
  };
}

export function createPluginRoutes({ getClientWebSocket, broadcast } = {}) {
  const router = Router();
  const pluginsDir = pluginManager.getPluginsDirectory();

  router.get('/', asyncHandler(async (req, res) => {
    const plugins = pluginManager.getInstalledPlugins();

    // Sort by priority (descending, nulls last)
    const sorted = plugins.sort((a, b) => {
      const priorityA = a.priority ?? -1;
      const priorityB = b.priority ?? -1;
      return priorityB - priorityA;
    });

    res.json(sorted);
  }));

  router.get('/loaded', asyncHandler(async (req, res) => {
    const plugins = pluginManager.getLoadedPlugins();
    res.json(plugins);
  }));

  router.post('/:pluginId/enable', async (req, res) => {
    try {
      const { pluginId } = req.params;
      await pluginManager.enablePlugin(pluginId);

      // Broadcast to all clients that plugin tools have changed
      if (broadcast) {
        broadcast('plugins:tools-changed', { pluginId, action: 'enabled' });
      }

      res.json({ success: true, message: `Plugin "${pluginId}" enabled` });
    } catch (error) {
      log('Error enabling plugin:', error);
      res.status(500).json({ error: error.message || 'Failed to enable plugin' });
    }
  });

  router.post('/:pluginId/disable', async (req, res) => {
    try {
      const { pluginId } = req.params;
      await pluginManager.disablePlugin(pluginId);

      // Broadcast to all clients that plugin tools have changed
      if (broadcast) {
        broadcast('plugins:tools-changed', { pluginId, action: 'disabled' });
      }

      res.json({ success: true, message: `Plugin "${pluginId}" disabled` });
    } catch (error) {
      log('Error disabling plugin:', error);
      res.status(500).json({ error: error.message || 'Failed to disable plugin' });
    }
  });

  router.post('/reorder', asyncHandler(async (req, res) => {
    const { pluginIds } = req.body;

    if (!Array.isArray(pluginIds)) {
      return res.status(400).json({ error: 'pluginIds must be an array' });
    }

    // Calculate descending priorities: first=100, second=90, third=80, etc.
    for (let i = 0; i < pluginIds.length; i++) {
      const priority = 100 - (i * 10);
      await pluginManager.updatePluginPriority(pluginIds[i], priority);
    }

    res.json({ success: true, message: 'Plugin priorities updated' });
  }));

  router.delete('/:pluginId', async (req, res) => {
    try {
      const { pluginId } = req.params;
      await pluginManager.uninstallPlugin(pluginId);

      // Broadcast to all clients that plugin tools have changed
      if (broadcast) {
        broadcast('plugins:tools-changed', { pluginId, action: 'uninstalled' });
      }

      res.json({ success: true, message: `Plugin "${pluginId}" uninstalled` });
    } catch (error) {
      log('Error uninstalling plugin:', error);
      res.status(500).json({ error: error.message || 'Failed to uninstall plugin' });
    }
  });

  router.get('/:pluginId/settings', asyncHandler(async (req, res) => {
    const { pluginId } = req.params;
    const settings = pluginManager.getPluginSettings(pluginId);
    res.json(settings);
  }));

  router.put('/:pluginId/settings', asyncHandler(async (req, res) => {
    const { pluginId } = req.params;
    const settings = req.body;
    pluginManager.savePluginSettings(pluginId, settings);
    res.json({ success: true, message: 'Plugin settings saved' });
  }));

  router.post('/:pluginId/reload', async (req, res) => {
    try {
      const { pluginId } = req.params;
      await pluginManager.reloadPlugin(pluginId);

      // Broadcast to all clients that plugin tools have changed
      if (broadcast) {
        broadcast('plugins:tools-changed', { pluginId, action: 'reloaded' });
      }

      res.json({ success: true, message: `Plugin "${pluginId}" reloaded successfully` });
    } catch (error) {
      log('Error reloading plugin:', error);
      res.status(500).json({ error: error.message || 'Failed to reload plugin' });
    }
  });

  router.get('/tool-menu-items', asyncHandler(async (req, res) => {
    const items = pluginManager.getToolMenuItems();
    res.json(items);
  }));

  router.post('/tool-menu-items/execute', async (req, res) => {
    try {
      const { pluginId, label } = req.body;
      const clientId = req.headers['x-client-id'];

      // Get the WebSocket client for this client ID
      let ws = null;
      if (clientId && getClientWebSocket) {
        ws = getClientWebSocket(clientId);
        if (!ws) {
          log(`Warning: Client ID ${clientId} not found in WebSocket map`);
        }
      }

      // Pass execution context with WebSocket client
      const executionContext = { ws };
      await pluginManager.executeToolMenuItem(pluginId, label, executionContext);

      res.json({ success: true, message: 'Tool menu item executed' });
    } catch (error) {
      log('Error executing tool menu item:', error);
      res.status(500).json({ error: error.message || 'Failed to execute tool menu item' });
    }
  });

  router.get('/:pluginId/config-ui', async (req, res) => {
    try {
      const { pluginId } = req.params;
      const configUI = pluginManager.getPluginConfigUI(pluginId);

      if (!configUI) {
        return res.status(404).json({ error: 'Plugin has no config UI' });
      }

      res.json({ pluginId, configUI });
    } catch (error) {
      log('Error getting plugin config UI:', error);
      res.status(500).json({ error: 'Failed to get plugin config UI' });
    }
  });

  router.get('/:pluginId/has-config', asyncHandler(async (req, res) => {
    const { pluginId } = req.params;
    const hasConfig = pluginManager.hasConfigUI(pluginId);
    res.json({ pluginId, hasConfig });
  }));

  router.get('/:pluginId/icon', async (req, res) => {
    try {
      const { pluginId } = req.params;
      const manifestPath = path.join(pluginsDir, pluginId, 'manifest.json');

      // Read manifest to get icon path
      let manifest;
      try {
        manifest = await readAndValidateManifest(manifestPath);
      } catch (error) {
        return res.status(404).json({ error: 'Plugin manifest not found' });
      }

      if (!manifest.icon) {
        return res.status(404).json({ error: 'Plugin has no icon' });
      }

      const iconPath = path.join(pluginsDir, pluginId, manifest.icon);

      // Check if icon file exists
      try {
        await fs.access(iconPath);
      } catch (error) {
        return res.status(404).json({ error: 'Icon file not found' });
      }

      // Determine content type based on extension
      const ext = path.extname(manifest.icon).toLowerCase();
      const contentTypes = {
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      };

      const contentType = contentTypes[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);

      const iconData = await fs.readFile(iconPath);
      res.send(iconData);
    } catch (error) {
      log('Error serving plugin icon:', error);
      res.status(500).json({ error: 'Failed to serve plugin icon' });
    }
  });

  router.post('/:pluginId/register', async (req, res) => {
    try {
      const { pluginId } = req.params;
      const pluginDir = path.join(pluginsDir, pluginId);
      const manifestPath = path.join(pluginDir, 'manifest.json');

      // Check if plugin directory exists
      try {
        await fs.access(pluginDir);
      } catch (error) {
        return res.status(404).json({ error: `Plugin directory not found: ${pluginId}` });
      }

      // Read manifest
      let manifest;
      try {
        manifest = await readAndValidateManifest(manifestPath);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid plugin: manifest.json not found or invalid' });
      }

      // Register and enable the plugin
      await pluginManager.installPlugin(manifest.id, manifest);
      await pluginManager.enablePlugin(manifest.id);

      // Broadcast to all clients that plugin tools have changed
      if (broadcast) {
        broadcast('plugins:tools-changed', { pluginId: manifest.id, action: 'registered' });
      }

      res.json({
        success: true,
        message: `Plugin "${manifest.name}" registered and enabled`,
        plugin: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version
        }
      });
    } catch (error) {
      log('Error registering plugin:', error);
      res.status(500).json({ error: error.message || 'Failed to register plugin' });
    }
  });

  router.post('/install', upload.single('plugin'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const tempFile = req.file.path;
      const extractDir = path.join(os.tmpdir(), 'ncsender-plugin-extract', Date.now().toString());
      await fs.mkdir(extractDir, { recursive: true });

      try {
        const zip = new AdmZip(tempFile);
        zip.extractAllTo(extractDir, true);
      } catch (error) {
        await fs.unlink(tempFile);
        throw new Error('Invalid plugin file: must be a valid ZIP archive');
      }

      const files = await fs.readdir(extractDir);
      if (files.length === 0) {
        throw new Error('Plugin archive is empty');
      }

      const manifestPath = path.join(extractDir, files[0], 'manifest.json');
      const manifest = await readAndValidateManifest(manifestPath);

      const pluginDir = path.join(pluginsDir, manifest.id);
      await fs.rm(pluginDir, { recursive: true, force: true });
      await fs.cp(path.join(extractDir, files[0]), pluginDir, { recursive: true });

      await pluginManager.installPlugin(manifest.id, manifest);
      await pluginManager.enablePlugin(manifest.id);

      // Broadcast to all clients that plugin tools have changed
      if (broadcast) {
        broadcast('plugins:tools-changed', { pluginId: manifest.id, action: 'installed' });
      }

      await fs.rm(extractDir, { recursive: true, force: true });
      await fs.unlink(tempFile);

      res.json({
        success: true,
        message: `Plugin "${manifest.name}" installed successfully`,
        plugin: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version
        }
      });
    } catch (error) {
      log('Error installing plugin:', error);
      res.status(500).json({ error: error.message || 'Failed to install plugin' });
    }
  });

  // Install plugin from GitHub URL
  router.post('/install-from-github', asyncHandler(async (req, res) => {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'GitHub URL is required' });
    }

    // Parse GitHub URL
    // Expected format: https://github.com/owner/repo/tree/branch/path/to/plugin
    const githubRegex = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/;
    const match = url.match(githubRegex);

    if (!match) {
      return res.status(400).json({
        error: 'Invalid GitHub URL format. Expected: https://github.com/owner/repo/tree/branch/path/to/plugin'
      });
    }

    const [, owner, repo, branch, pluginPath] = match;

    // Only allow main branch for security
    if (branch !== 'main') {
      return res.status(400).json({
        error: 'Only plugins from the main branch are allowed for security reasons'
      });
    }

    log(`Installing plugin from GitHub: ${owner}/${repo}/${pluginPath} (branch: ${branch})`);

    try {
      const extractDir = path.join(os.tmpdir(), 'ncsender-plugin-extract', Date.now().toString());
      await fs.mkdir(extractDir, { recursive: true });

      // Download archive from GitHub
      const archiveUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
      log(`Downloading: ${archiveUrl}`);

      // Download using fetch (follows redirects)
      let zipBuffer;
      try {
        const fetchFn = globalThis.fetch;
        if (typeof fetchFn !== 'function') {
          throw new Error('Global fetch API is not available');
        }
        const response = await fetchFn(archiveUrl, { redirect: 'follow' });
        if (!response.ok) {
          throw new Error(`Unexpected response status: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        zipBuffer = Buffer.from(arrayBuffer);
      } catch (error) {
        log('Error downloading GitHub archive:', error);
        throw new Error('Failed to download repository from GitHub');
      }

      // Extract ZIP
      const repoExtractDir = path.join(extractDir, 'repo');
      await fs.mkdir(repoExtractDir, { recursive: true });

      try {
        const zip = new AdmZip(zipBuffer);
        zip.extractAllTo(repoExtractDir, true);
      } catch (error) {
        log('Error extracting GitHub archive:', error);
        throw new Error('Failed to extract repository archive');
      }

      // Find the plugin directory
      // After extraction, directory structure is: repo-branch/path/to/plugin
      const extractedDirs = await fs.readdir(repoExtractDir);
      if (extractedDirs.length === 0) {
        throw new Error('Repository archive is empty');
      }

      const repoRootDir = path.join(repoExtractDir, extractedDirs[0]);
      const pluginSourceDir = path.join(repoRootDir, pluginPath);

      // Check if plugin directory exists
      try {
        await fs.access(pluginSourceDir);
      } catch (error) {
        throw new Error(`Plugin path not found in repository: ${pluginPath}`);
      }

      // Validate manifest
      const manifestPath = path.join(pluginSourceDir, 'manifest.json');
      const manifest = await readAndValidateManifest(manifestPath);

      // Copy plugin to plugins directory
      const pluginDir = path.join(pluginsDir, manifest.id);
      await fs.rm(pluginDir, { recursive: true, force: true });
      await fs.cp(pluginSourceDir, pluginDir, { recursive: true });

      // Install and enable plugin
      await pluginManager.installPlugin(manifest.id, manifest);
      await pluginManager.enablePlugin(manifest.id);

      // Broadcast to all clients
      if (broadcast) {
        broadcast('plugins:tools-changed', { pluginId: manifest.id, action: 'installed' });
      }

      // Cleanup
      await fs.rm(extractDir, { recursive: true, force: true });

      res.json({
        success: true,
        message: `Plugin "${manifest.name}" installed successfully from GitHub`,
        plugin: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          source: 'github'
        }
      });
    } catch (error) {
      log('Error installing plugin from GitHub:', error);
      res.status(500).json({ error: error.message || 'Failed to install plugin from GitHub' });
    }
  }));

  return router;
}
