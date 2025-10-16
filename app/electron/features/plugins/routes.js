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

export function createPluginRoutes() {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const plugins = pluginManager.getInstalledPlugins();
      res.json(plugins);
    } catch (error) {
      log('Error getting plugins:', error);
      res.status(500).json({ error: 'Failed to get plugins' });
    }
  });

  router.get('/loaded', async (req, res) => {
    try {
      const plugins = pluginManager.getLoadedPlugins();
      res.json(plugins);
    } catch (error) {
      log('Error getting loaded plugins:', error);
      res.status(500).json({ error: 'Failed to get loaded plugins' });
    }
  });

  router.post('/:pluginId/enable', async (req, res) => {
    try {
      const { pluginId } = req.params;
      await pluginManager.enablePlugin(pluginId);
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
      res.json({ success: true, message: `Plugin "${pluginId}" uninstalled` });
    } catch (error) {
      log('Error uninstalling plugin:', error);
      res.status(500).json({ error: error.message || 'Failed to uninstall plugin' });
    }
  });

  router.get('/:pluginId/settings', async (req, res) => {
    try {
      const { pluginId } = req.params;
      const settings = pluginManager.getPluginSettings(pluginId);
      res.json(settings);
    } catch (error) {
      log('Error getting plugin settings:', error);
      res.status(500).json({ error: error.message || 'Failed to get plugin settings' });
    }
  });

  router.put('/:pluginId/settings', async (req, res) => {
    try {
      const { pluginId } = req.params;
      const settings = req.body;
      pluginManager.savePluginSettings(pluginId, settings);
      res.json({ success: true, message: 'Plugin settings saved' });
    } catch (error) {
      log('Error saving plugin settings:', error);
      res.status(500).json({ error: error.message || 'Failed to save plugin settings' });
    }
  });

  router.post('/:pluginId/reload', async (req, res) => {
    try {
      const { pluginId } = req.params;
      await pluginManager.reloadPlugin(pluginId);
      res.json({ success: true, message: `Plugin "${pluginId}" reloaded successfully` });
    } catch (error) {
      log('Error reloading plugin:', error);
      res.status(500).json({ error: error.message || 'Failed to reload plugin' });
    }
  });

  router.get('/tool-menu-items', async (req, res) => {
    try {
      const items = pluginManager.getToolMenuItems();
      res.json(items);
    } catch (error) {
      log('Error getting tool menu items:', error);
      res.status(500).json({ error: 'Failed to get tool menu items' });
    }
  });

  router.post('/tool-menu-items/execute', async (req, res) => {
    try {
      const { pluginId, label } = req.body;
      await pluginManager.executeToolMenuItem(pluginId, label);
      res.json({ success: true, message: 'Tool menu item executed' });
    } catch (error) {
      log('Error executing tool menu item:', error);
      res.status(500).json({ error: error.message || 'Failed to execute tool menu item' });
    }
  });

  router.post('/install', upload.single('plugin'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const tempFile = req.file.path;
      const pluginsDir = pluginManager.getPluginsDirectory();

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
      let manifest;

      try {
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        manifest = JSON.parse(manifestContent);
      } catch (error) {
        throw new Error('Invalid plugin: manifest.json not found or invalid');
      }

      if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry) {
        throw new Error('Invalid manifest: missing required fields');
      }

      const pluginDir = path.join(pluginsDir, manifest.id);
      await fs.rm(pluginDir, { recursive: true, force: true });
      await fs.cp(path.join(extractDir, files[0]), pluginDir, { recursive: true });

      await pluginManager.installPlugin(manifest.id, manifest);

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
