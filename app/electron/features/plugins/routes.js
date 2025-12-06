import { Router } from 'express';
import { pluginManager } from '../../core/plugin-manager.js';
import multer from 'multer';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'node:url';

// Get app version from package.json
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(__dirname, '../../..', 'package.json');
const packageJson = JSON.parse(fsSync.readFileSync(packageJsonPath, 'utf8'));
const APP_VERSION = packageJson.version;

const log = (...args) => {
  console.log(`[${new Date().toISOString()}] [PLUGIN ROUTES]`, ...args);
};

const uploadTempDir = path.join(os.tmpdir(), 'ncsender-plugins');
if (!fsSync.existsSync(uploadTempDir)) {
  fsSync.mkdirSync(uploadTempDir, { recursive: true });
}

const upload = multer({ dest: uploadTempDir });

function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;

    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  return 0;
}

async function readAndValidateManifest(manifestPath, appVersion = null) {
  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);

  if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry) {
    throw new Error('Invalid manifest: missing required fields (id, name, version, entry)');
  }

  // Check if plugin requires a minimum app version
  if (appVersion && manifest.minAppVersion) {
    if (compareVersions(manifest.minAppVersion, appVersion) > 0) {
      throw new Error(
        `Plugin "${manifest.name}" requires ncSender v${manifest.minAppVersion} or higher. ` +
        `Current version is v${appVersion}. Please update ncSender before installing this plugin.`
      );
    }
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
      if (error.message === 'CATEGORY_CONFLICT') {
        log(`Plugin "${req.params.pluginId}" not enabled: Category conflict with ${error.conflictingPlugins.map(p => p.name).join(', ')}`);
        res.status(409).json({
          error: 'CATEGORY_CONFLICT',
          conflictingPlugins: error.conflictingPlugins,
          category: error.category
        });
      } else {
        log('Error enabling plugin:', error);
        res.status(500).json({ error: error.message || 'Failed to enable plugin' });
      }
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

    // Check if plugin is enabled
    const plugins = pluginManager.getInstalledPlugins();
    const plugin = plugins.find(p => p.id === pluginId);

    if (!plugin) {
      return res.status(404).json({ error: 'Plugin not found' });
    }

    if (!plugin.enabled) {
      return res.status(403).json({ error: 'Plugin is disabled' });
    }

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
      const { file } = req.query; // Optional: specific icon file for per-tool icons
      const manifestPath = path.join(pluginsDir, pluginId, 'manifest.json');

      // Read manifest to get icon path
      let manifest;
      try {
        manifest = await readAndValidateManifest(manifestPath, APP_VERSION);
      } catch (error) {
        return res.status(404).json({ error: 'Plugin manifest not found' });
      }

      // Use specific file if provided, otherwise fall back to manifest icon
      const iconFile = file || manifest.icon;

      if (!iconFile) {
        return res.status(404).json({ error: 'Plugin has no icon' });
      }

      const iconPath = path.join(pluginsDir, pluginId, iconFile);

      // Check if icon file exists
      try {
        await fs.access(iconPath);
      } catch (error) {
        return res.status(404).json({ error: 'Icon file not found' });
      }

      // Determine content type based on extension
      const ext = path.extname(iconFile).toLowerCase();
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
        manifest = await readAndValidateManifest(manifestPath, APP_VERSION);
      } catch (error) {
        return res.status(400).json({ error: error.message || 'Invalid plugin: manifest.json not found or invalid' });
      }

      // Check if plugin is already registered
      const installedPlugins = pluginManager.getInstalledPlugins();
      const existingPlugin = installedPlugins.find(p => p.id === manifest.id);
      const shouldEnable = existingPlugin ? existingPlugin.enabled : true;

      // Register the plugin (updates manifest but preserves enabled state)
      await pluginManager.installPlugin(manifest.id, manifest);

      // Only enable if it should be enabled
      if (shouldEnable) {
        await pluginManager.enablePlugin(manifest.id);
      }

      // Broadcast to all clients that plugin tools have changed
      if (broadcast) {
        broadcast('plugins:tools-changed', { pluginId: manifest.id, action: 'registered' });
      }

      res.json({
        success: true,
        message: shouldEnable
          ? `Plugin "${manifest.name}" registered and enabled`
          : `Plugin "${manifest.name}" registered (disabled)`,
        plugin: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          enabled: shouldEnable
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
      const manifest = await readAndValidateManifest(manifestPath, APP_VERSION);

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

  // Install plugin from ZIP URL
  router.post('/install-from-url', asyncHandler(async (req, res) => {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'ZIP URL is required' });
    }

    log(`Installing plugin from URL: ${url}`);

    try {
      const extractDir = path.join(os.tmpdir(), 'ncsender-plugin-extract', Date.now().toString());
      await fs.mkdir(extractDir, { recursive: true });

      // Download ZIP file from URL
      let zipBuffer;
      try {
        const fetchFn = globalThis.fetch;
        if (typeof fetchFn !== 'function') {
          throw new Error('Global fetch API is not available');
        }

        log(`Fetching ZIP from: ${url}`);
        const response = await fetchFn(url, {
          redirect: 'follow',
          headers: {
            'User-Agent': 'ncSender-Plugin-Installer'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to download ZIP file: ${response.status} ${response.statusText}`);
        }

        // Check content type to ensure it's a ZIP file
        const contentType = response.headers.get('content-type');
        log(`Content-Type: ${contentType}`);

        if (contentType && !contentType.includes('application/zip') && !contentType.includes('application/octet-stream')) {
          log(`Warning: Unexpected content type: ${contentType}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        zipBuffer = Buffer.from(arrayBuffer);
        log(`Downloaded ${zipBuffer.length} bytes`);
      } catch (error) {
        log('Error downloading ZIP file:', error);
        throw new Error(`Failed to download ZIP file: ${error.message}`);
      }

      // Extract ZIP
      try {
        const zip = new AdmZip(zipBuffer);
        zip.extractAllTo(extractDir, true);
      } catch (error) {
        log('Error extracting ZIP file:', error);
        throw new Error('Invalid ZIP file');
      }

      // Find the plugin directory (should contain manifest.json)
      const files = await fs.readdir(extractDir);
      if (files.length === 0) {
        throw new Error('ZIP archive is empty');
      }

      // Check if there's a single directory (common case) or multiple files at root
      let pluginSourceDir;
      if (files.length === 1) {
        const singleItem = path.join(extractDir, files[0]);
        const stats = await fs.stat(singleItem);
        if (stats.isDirectory()) {
          pluginSourceDir = singleItem;
        } else {
          pluginSourceDir = extractDir;
        }
      } else {
        pluginSourceDir = extractDir;
      }

      // Validate manifest
      const manifestPath = path.join(pluginSourceDir, 'manifest.json');
      const manifest = await readAndValidateManifest(manifestPath, APP_VERSION);

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
        message: `Plugin "${manifest.name}" installed successfully from URL`,
        plugin: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          source: 'url'
        }
      });
    } catch (error) {
      if (error.message === 'CATEGORY_CONFLICT') {
        log(`Plugin installed from URL but not enabled: Category conflict with ${error.conflictingPlugins?.map(p => p.name).join(', ') || 'existing plugin'}`);
        res.status(409).json({
          error: 'CATEGORY_CONFLICT',
          conflictingPlugins: error.conflictingPlugins,
          category: error.category
        });
      } else {
        log('Error installing plugin from URL:', error);
        res.status(500).json({ error: error.message || 'Failed to install plugin from URL' });
      }
    }
  }));

  // Check for plugin updates from GitHub
  router.get('/:pluginId/check-update', asyncHandler(async (req, res) => {
    const { pluginId } = req.params;

    // Get plugin info
    const plugins = pluginManager.getInstalledPlugins();
    const plugin = plugins.find(p => p.id === pluginId);

    if (!plugin) {
      return res.status(404).json({ error: 'Plugin not found' });
    }

    if (!plugin.repository) {
      return res.status(400).json({ error: 'Plugin does not have a repository configured' });
    }

    // Extract owner and repo from GitHub URL
    // Expected format: https://github.com/owner/repo
    const match = plugin.repository.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid repository URL format' });
    }

    const [, owner, repo] = match;

    try {
      // Fetch latest release from GitHub API
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
      const headers = {
        'User-Agent': 'ncSender-Plugin-Manager',
        'Accept': 'application/vnd.github.v3+json'
      };

      // Use GitHub token in development (increases rate limit from 60 to 5000 req/hour)
      // Normal users use unauthenticated requests with 60 req/hour limit
      if (process.env.NODE_ENV === 'development' && process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }

      const response = await fetch(apiUrl, { headers });

      if (!response.ok) {
        if (response.status === 404) {
          return res.json({
            hasUpdate: false,
            message: 'No releases found for this plugin'
          });
        }
        if (response.status === 403) {
          const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
          const rateLimitReset = response.headers.get('x-ratelimit-reset');
          const resetDate = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000) : null;
          const errorMsg = rateLimitRemaining === '0'
            ? `GitHub API rate limit exceeded. Resets at ${resetDate?.toLocaleTimeString() || 'unknown'}`
            : 'GitHub API access forbidden';
          return res.status(403).json({ error: errorMsg });
        }
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const release = await response.json();
      const latestVersion = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
      const currentVersion = plugin.version;

      // Compare versions
      const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

      // Find the ZIP asset
      const zipAsset = release.assets.find(asset =>
        asset.name.endsWith('.zip') && asset.browser_download_url
      );

      res.json({
        hasUpdate,
        currentVersion,
        latestVersion,
        releaseNotes: release.body || '',
        releaseUrl: release.html_url,
        downloadUrl: zipAsset ? zipAsset.browser_download_url : null,
        publishedAt: release.published_at
      });
    } catch (error) {
      log('Error checking for plugin update:', error);
      res.status(500).json({ error: error.message || 'Failed to check for updates' });
    }
  }));

  // Update plugin to latest version
  router.post('/:pluginId/update', asyncHandler(async (req, res) => {
    const { pluginId } = req.params;

    // Get plugin info
    const plugins = pluginManager.getInstalledPlugins();
    const plugin = plugins.find(p => p.id === pluginId);

    if (!plugin) {
      return res.status(404).json({ error: 'Plugin not found' });
    }

    if (!plugin.repository) {
      return res.status(400).json({ error: 'Plugin does not have a repository configured' });
    }

    // Extract owner and repo from GitHub URL
    const match = plugin.repository.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid repository URL format' });
    }

    const [, owner, repo] = match;

    try {
      // Fetch latest release
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
      const headers = {
        'User-Agent': 'ncSender-Plugin-Manager',
        'Accept': 'application/vnd.github.v3+json'
      };

      // Use GitHub token in development (increases rate limit from 60 to 5000 req/hour)
      // Normal users use unauthenticated requests with 60 req/hour limit
      if (process.env.NODE_ENV === 'development' && process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }

      const response = await fetch(apiUrl, { headers });

      if (!response.ok) {
        if (response.status === 403) {
          const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
          const rateLimitReset = response.headers.get('x-ratelimit-reset');
          const resetDate = rateLimitReset ? new Date(parseInt(rateLimitReset) * 1000) : null;
          const errorMsg = rateLimitRemaining === '0'
            ? `GitHub API rate limit exceeded. Resets at ${resetDate?.toLocaleTimeString() || 'unknown'}`
            : 'GitHub API access forbidden';
          throw new Error(errorMsg);
        }
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const release = await response.json();

      // Find the ZIP asset
      const zipAsset = release.assets.find(asset =>
        asset.name.endsWith('.zip') && asset.browser_download_url
      );

      if (!zipAsset) {
        throw new Error('No ZIP file found in the latest release');
      }

      // Download and install the plugin using the existing install-from-url logic
      const extractDir = path.join(os.tmpdir(), 'ncsender-plugin-extract', Date.now().toString());
      await fs.mkdir(extractDir, { recursive: true });

      // Download ZIP file
      log(`Downloading plugin update from: ${zipAsset.browser_download_url}`);
      const downloadResponse = await fetch(zipAsset.browser_download_url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'ncSender-Plugin-Manager'
        }
      });

      if (!downloadResponse.ok) {
        throw new Error(`Failed to download plugin: ${downloadResponse.status}`);
      }

      const arrayBuffer = await downloadResponse.arrayBuffer();
      const zipBuffer = Buffer.from(arrayBuffer);

      // Extract ZIP
      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(extractDir, true);

      // Find the plugin directory
      const files = await fs.readdir(extractDir);
      if (files.length === 0) {
        throw new Error('ZIP archive is empty');
      }

      let pluginSourceDir;
      if (files.length === 1) {
        const singleItem = path.join(extractDir, files[0]);
        const stats = await fs.stat(singleItem);
        if (stats.isDirectory()) {
          pluginSourceDir = singleItem;
        } else {
          pluginSourceDir = extractDir;
        }
      } else {
        pluginSourceDir = extractDir;
      }

      // Validate manifest
      const manifestPath = path.join(pluginSourceDir, 'manifest.json');
      const manifest = await readAndValidateManifest(manifestPath, APP_VERSION);

      // Verify it's the same plugin
      if (manifest.id !== pluginId) {
        throw new Error(`Plugin ID mismatch: expected ${pluginId}, got ${manifest.id}`);
      }

      // Copy plugin to plugins directory (overwrite existing)
      const pluginDir = path.join(pluginsDir, manifest.id);
      await fs.rm(pluginDir, { recursive: true, force: true });
      await fs.cp(pluginSourceDir, pluginDir, { recursive: true });

      // Update the registry with new version
      await pluginManager.installPlugin(manifest.id, manifest);

      // Reload the plugin
      await pluginManager.reloadPlugin(manifest.id);

      // Broadcast to all clients
      if (broadcast) {
        broadcast('plugins:tools-changed', { pluginId: manifest.id, action: 'updated' });
      }

      // Cleanup
      await fs.rm(extractDir, { recursive: true, force: true });

      res.json({
        success: true,
        message: `Plugin "${manifest.name}" updated to version ${manifest.version}`,
        plugin: {
          id: manifest.id,
          name: manifest.name,
          version: manifest.version
        }
      });
    } catch (error) {
      log('Error updating plugin:', error);
      res.status(500).json({ error: error.message || 'Failed to update plugin' });
    }
  }));

  return router;
}
