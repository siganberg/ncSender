import { Router } from 'express';
import { pluginManager } from '../../core/plugin-manager.js';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { exec as execCallback } from 'node:child_process';

const exec = promisify(execCallback);

const log = (...args) => {
  console.log(`[${new Date().toISOString()}] [PLUGIN ROUTES]`, ...args);
};

const upload = multer({ dest: '/tmp/ncsender-plugins' });

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
    res.json(plugins);
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
      await fs.mkdir('/tmp/ncsender-plugin-extract', { recursive: true });
      const extractDir = `/tmp/ncsender-plugin-extract/${Date.now()}`;

      try {
        await exec(`unzip -q "${tempFile}" -d "${extractDir}"`);
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

  return router;
}
