import fs from 'node:fs';
import path from 'node:path';
import { pluginEventBus } from './plugin-event-bus.js';
import { readSettings } from './settings-manager.js';
import { getUserDataDir } from '../utils/paths.js';

const log = (...args) => {
  console.log(`[${new Date().toISOString()}] [PLUGIN MANAGER]`, ...args);
};

// Support development mode - load plugins from project directory
const DEV_PLUGINS_DIR = process.env.DEV_PLUGINS_DIR;
const PLUGINS_DIR = DEV_PLUGINS_DIR || path.join(getUserDataDir(), 'plugins');
const REGISTRY_PATH = path.join(getUserDataDir(), 'plugins.json');

if (DEV_PLUGINS_DIR) {
  log('Development mode enabled - loading plugins from:', DEV_PLUGINS_DIR);
}

class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.pluginContexts = new Map();
    this.initialized = false;
    this.eventBus = pluginEventBus;
    this.cncController = null;
    this.broadcast = null;
    this.toolMenuItems = [];
    this.configUIs = new Map();
    this.executionContextStack = new Map();
  }

  async initialize({ cncController, broadcast, sendWsMessage } = {}) {
    if (this.initialized) {
      log('Plugin manager already initialized');
      return;
    }

    this.cncController = cncController;
    this.broadcast = broadcast;
    this.sendWsMessage = sendWsMessage;

    this.ensurePluginsDirectory();

    const registry = this.loadRegistry();

    for (const pluginEntry of registry) {
      if (pluginEntry.enabled) {
        try {
          await this.loadPlugin(pluginEntry.id);
        } catch (error) {
          log(`Failed to load plugin "${pluginEntry.id}":`, error);
        }
      }
    }

    this.initialized = true;
    log('Plugin manager initialized');
  }

  ensurePluginsDirectory() {
    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true });
      log('Created plugins directory:', PLUGINS_DIR);
    }
  }

  loadRegistry() {
    if (!fs.existsSync(REGISTRY_PATH)) {
      this.saveRegistry([]);
      return [];
    }

    try {
      const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      log('Failed to load plugin registry:', error);
      return [];
    }
  }

  saveRegistry(registry) {
    try {
      fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
    } catch (error) {
      log('Failed to save plugin registry:', error);
      throw error;
    }
  }

  getPluginManifestPath(pluginId) {
    return path.join(PLUGINS_DIR, pluginId, 'manifest.json');
  }

  getPluginEntryPath(pluginId, entryFile) {
    return path.join(PLUGINS_DIR, pluginId, entryFile);
  }

  loadManifest(pluginId) {
    const manifestPath = this.getPluginManifestPath(pluginId);

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Manifest not found for plugin "${pluginId}"`);
    }

    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);

      if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry) {
        throw new Error('Invalid manifest: missing required fields (id, name, version, entry)');
      }

      return manifest;
    } catch (error) {
      log(`Failed to load manifest for plugin "${pluginId}":`, error);
      throw error;
    }
  }

  async loadPlugin(pluginId) {
    if (this.plugins.has(pluginId)) {
      log(`Plugin "${pluginId}" is already loaded`);
      return;
    }

    const manifest = this.loadManifest(pluginId);
    const entryPath = this.getPluginEntryPath(pluginId, manifest.entry);

    if (!fs.existsSync(entryPath)) {
      throw new Error(`Entry file not found: ${entryPath}`);
    }

    try {
      const pluginModule = await import(`file://${entryPath}`);

      const context = this.createPluginContext(pluginId, manifest);
      this.pluginContexts.set(pluginId, context);

      if (typeof pluginModule.onLoad === 'function') {
        await pluginModule.onLoad(context);
      }

      this.plugins.set(pluginId, {
        id: pluginId,
        manifest,
        module: pluginModule,
        context,
        loadedAt: new Date().toISOString()
      });

      log(`Loaded plugin "${manifest.name}" (${pluginId}) v${manifest.version}`);
    } catch (error) {
      log(`Failed to load plugin module "${pluginId}":`, error);
      throw error;
    }
  }

  async unloadPlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" is not loaded`);
    }

    try {
      if (typeof plugin.module.onUnload === 'function') {
        const ctx = this.pluginContexts.get(pluginId);
        await plugin.module.onUnload(ctx);
      }
    } catch (error) {
      log(`Error during plugin "${pluginId}" unload:`, error);
    }

    this.eventBus.unregisterPluginHandlers(pluginId);
    this.pluginContexts.delete(pluginId);
    this.plugins.delete(pluginId);
    this.executionContextStack.delete(pluginId);

    // Remove tool menu items registered by this plugin
    this.toolMenuItems = this.toolMenuItems.filter(item => item.pluginId !== pluginId);
    log(`Removed tool menu items for plugin "${pluginId}"`);

    // Remove config UI registered by this plugin
    this.configUIs.delete(pluginId);
    log(`Removed config UI for plugin "${pluginId}"`);

    log(`Unloaded plugin "${pluginId}"`);
  }

  createPluginContext(pluginId, manifest) {
    const context = {
      pluginId,
      manifest,

      log: (...args) => {
        console.log(`[${new Date().toISOString()}] [PLUGIN:${pluginId}]`, ...args);
      },

      registerEventHandler: (eventName, handler) => {
        this.eventBus.registerPluginHandler(pluginId, eventName, handler);
      },

      broadcast: (eventName, data) => {
        if (!this.broadcast) {
          throw new Error('Broadcast function not available');
        }
        this.broadcast(eventName, data);
      },

      getSettings: () => {
        return this.getPluginSettings(pluginId);
      },

      setSettings: (settings) => {
        this.savePluginSettings(pluginId, settings);
      },

      getAppSettings: () => {
        return readSettings() || {};
      },

      getMachineState: () => {
        if (!this.cncController) {
          return null;
        }
        return this.cncController.getLastStatus() || null;
      },

      showDialog: (title, content, options = {}) => {
        const payload = {
          pluginId,
          title,
          content,
          options
        };

        const stack = this.executionContextStack.get(pluginId);
        const activeContext = stack && stack.length > 0 ? stack[stack.length - 1] : null;
        const isClientOnly = activeContext?.clientOnly || false;
        const executionWs = activeContext?.ws || null;

        // If tool is marked as clientOnly and we have a WebSocket client from execution context
        if (isClientOnly && executionWs && this.sendWsMessage) {
          this.sendWsMessage(executionWs, 'plugin:show-dialog', payload);
        } else {
          // Otherwise broadcast to all clients (default behavior)
          if (!this.broadcast) {
            throw new Error('Broadcast function not available');
          }
          this.broadcast('plugin:show-dialog', payload);
        }
      },

      registerToolMenu: (label, callback, options = {}) => {
        if (!this.toolMenuItems) {
          this.toolMenuItems = [];
        }
        this.toolMenuItems.push({
          pluginId,
          label,
          callback,
          clientOnly: options.clientOnly || false, // Support per-tool configuration
          icon: options.icon || null // SVG string for custom icon
        });
        log(`Registered tool menu item: "${label}" for plugin ${pluginId}${options.clientOnly ? ' (client-only)' : ''}${options.icon ? ' (with custom icon)' : ''}`);
      },

      registerConfigUI: (htmlContent) => {
        this.configUIs.set(pluginId, htmlContent);
        log(`Registered config UI for plugin ${pluginId}`);
      },

      emitToClient: (eventName, data) => {
        if (!this.broadcast) {
          throw new Error('Broadcast function not available');
        }
        this.broadcast(`plugin:${pluginId}:${eventName}`, data);
      },

      onWebSocketEvent: (eventName, handler) => {
        // Register to receive WebSocket events that are broadcast
        // This allows plugins to react to CNC events in real-time
        this.eventBus.registerPluginHandler(pluginId, `ws:${eventName}`, handler);
      }
    };

    return context;
  }

  getPluginSettings(pluginId) {
    const settingsPath = path.join(PLUGINS_DIR, pluginId, 'config.json');

    if (!fs.existsSync(settingsPath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      log(`Failed to load settings for plugin "${pluginId}":`, error);
      return {};
    }
  }

  savePluginSettings(pluginId, settings) {
    const settingsPath = path.join(PLUGINS_DIR, pluginId, 'config.json');
    const pluginDir = path.dirname(settingsPath);

    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
    }

    try {
      // Load existing settings and merge with new settings
      const existingSettings = this.getPluginSettings(pluginId);
      const mergedSettings = { ...existingSettings, ...settings };

      fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf8');
    } catch (error) {
      log(`Failed to save settings for plugin "${pluginId}":`, error);
      throw error;
    }
  }

  getLoadedPlugins() {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      name: p.manifest.name,
      version: p.manifest.version,
      author: p.manifest.author,
      loadedAt: p.loadedAt
    }));
  }

  getInstalledPlugins() {
    const registry = this.loadRegistry();
    return registry.map(entry => {
      const plugin = this.plugins.get(entry.id);
      const manifest = plugin?.manifest ?? this.safeLoadManifest(entry.id);
      const hasIcon = manifest ? this.pluginHasIcon(entry.id, manifest) : false;
      return {
        ...entry,
        loaded: !!plugin,
        loadedAt: plugin?.loadedAt,
        hasConfig: !!plugin && this.configUIs.has(entry.id),
        hasIcon
      };
    });
  }

  async installPlugin(pluginId, manifest) {
    const registry = this.loadRegistry();

    const existingIndex = registry.findIndex(p => p.id === pluginId);

    if (existingIndex >= 0) {
      registry[existingIndex] = {
        id: pluginId,
        name: manifest.name,
        version: manifest.version,
        enabled: true,
        installedAt: new Date().toISOString()
      };
    } else {
      registry.push({
        id: pluginId,
        name: manifest.name,
        version: manifest.version,
        enabled: true,
        installedAt: new Date().toISOString()
      });
    }

    this.saveRegistry(registry);
    log(`Registered plugin "${pluginId}" in registry`);
  }

  async uninstallPlugin(pluginId) {
    if (this.plugins.has(pluginId)) {
      await this.unloadPlugin(pluginId);
    }

    const registry = this.loadRegistry();
    const filteredRegistry = registry.filter(p => p.id !== pluginId);
    this.saveRegistry(filteredRegistry);

    const pluginDir = path.join(PLUGINS_DIR, pluginId);
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true });
      log(`Removed plugin directory: ${pluginDir}`);
    }

    log(`Uninstalled plugin "${pluginId}"`);
  }

  async enablePlugin(pluginId) {
    const registry = this.loadRegistry();
    const plugin = registry.find(p => p.id === pluginId);

    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" not found in registry`);
    }

    plugin.enabled = true;
    this.saveRegistry(registry);

    await this.loadPlugin(pluginId);
    log(`Enabled plugin "${pluginId}"`);
  }

  async disablePlugin(pluginId) {
    const registry = this.loadRegistry();
    const plugin = registry.find(p => p.id === pluginId);

    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" not found in registry`);
    }

    plugin.enabled = false;
    this.saveRegistry(registry);

    if (this.plugins.has(pluginId)) {
      await this.unloadPlugin(pluginId);
    }

    log(`Disabled plugin "${pluginId}"`);
  }

  async reloadPlugin(pluginId) {
    log(`Reloading plugin "${pluginId}"`);

    if (!this.plugins.has(pluginId)) {
      throw new Error(`Plugin "${pluginId}" is not loaded`);
    }

    await this.unloadPlugin(pluginId);

    const manifest = this.loadManifest(pluginId);
    const entryPath = this.getPluginEntryPath(pluginId, manifest.entry);

    if (!fs.existsSync(entryPath)) {
      throw new Error(`Entry file not found: ${entryPath}`);
    }

    try {
      const timestamp = Date.now();
      const pluginModule = await import(`file://${entryPath}?t=${timestamp}`);

      const context = this.createPluginContext(pluginId, manifest);
      this.pluginContexts.set(pluginId, context);

      if (typeof pluginModule.onLoad === 'function') {
        await pluginModule.onLoad(context);
      }

      this.plugins.set(pluginId, {
        id: pluginId,
        manifest,
        module: pluginModule,
        context,
        loadedAt: new Date().toISOString()
      });

      log(`Plugin "${manifest.name}" (${pluginId}) v${manifest.version} reloaded successfully`);
    } catch (error) {
      log(`Failed to reload plugin module "${pluginId}":`, error);
      throw error;
    }
  }

  getPluginsDirectory() {
    return PLUGINS_DIR;
  }

  getEventBus() {
    return this.eventBus;
  }

  async processCommand(command, context = {}) {
    log(`[Plugin Manager] processCommand called with: "${command}", sourceId: ${context.sourceId}`);
    log(`[Plugin Manager] Number of registered plugins: ${this.plugins.size}`);

    // Initialize command array with original command
    let commands = [{
      command: command,
      isOriginal: true,
      displayCommand: null,
      meta: context.meta || {},
      commandId: context.commandId || null
    }];

    // Iterate through all registered plugins in order
    for (const [pluginId] of this.plugins.entries()) {
      log(`[Plugin Manager] Checking plugin: ${pluginId}`);
      const pluginContext = this.pluginContexts.get(pluginId);

      // Get handlers registered via ctx.registerEventHandler('onBeforeCommand', ...)
      const pluginEventHandlers = this.eventBus.pluginHandlers.get(pluginId);
      const handlers = pluginEventHandlers?.get('onBeforeCommand') || [];

      if (handlers.length > 0) {
        log(`[Plugin Manager] Found ${handlers.length} onBeforeCommand handler(s) for plugin: ${pluginId}`);

        for (const handler of handlers) {
          try {
            const result = await handler(commands, context, pluginContext);
            // Plugin returns modified array or undefined (no changes)
            if (Array.isArray(result)) {
              log(`[Plugin Manager] Plugin ${pluginId} returned ${result.length} commands`);
              commands = result;
            } else {
              log(`[Plugin Manager] Plugin ${pluginId} returned undefined (no changes)`);
            }
          } catch (error) {
            log(`Error in plugin "${pluginId}" onBeforeCommand:`, error);
            // Continue with other plugins even if one fails
          }
        }
      } else {
        log(`[Plugin Manager] Plugin ${pluginId} does not have onBeforeCommand handler`);
      }
    }

    log(`[Plugin Manager] Returning ${commands.length} command(s)`);
    return commands;
  }

  getPluginConfigUI(pluginId) {
    return this.configUIs.get(pluginId) || null;
  }

  hasConfigUI(pluginId) {
    return this.configUIs.has(pluginId);
  }

  getToolMenuItems() {
    return this.toolMenuItems.map(item => ({
      pluginId: item.pluginId,
      label: item.label,
      clientOnly: !!item.clientOnly,
      icon: item.icon || null
    }));
  }

  async executeToolMenuItem(pluginId, label, executionContext = {}) {
    const item = this.toolMenuItems.find(
      i => i.pluginId === pluginId && i.label === label
    );

    if (!item) {
      throw new Error(`Tool menu item not found: ${pluginId} - ${label}`);
    }

    if (typeof item.callback === 'function') {
      try {
        const stack = this.executionContextStack.get(pluginId) || [];
        stack.push({ ...executionContext, clientOnly: item.clientOnly || false });
        this.executionContextStack.set(pluginId, stack);

        await item.callback();

        log(`Executed tool menu item: ${pluginId} - ${label}`);
      } catch (error) {
        log(`Error executing tool menu item: ${pluginId} - ${label}`, error);
        throw error;
      } finally {
        const stack = this.executionContextStack.get(pluginId);
        if (stack) {
          stack.pop();
          if (stack.length === 0) {
            this.executionContextStack.delete(pluginId);
          }
        }
      }
    }
  }

  safeLoadManifest(pluginId) {
    try {
      return this.loadManifest(pluginId);
    } catch (error) {
      log(`Could not load manifest for plugin "${pluginId}" while building registry:`, error?.message || error);
      return null;
    }
  }

  pluginHasIcon(pluginId, manifest) {
    if (!manifest?.icon) {
      return false;
    }
    const iconPath = path.join(PLUGINS_DIR, pluginId, manifest.icon);
    try {
      return fs.existsSync(iconPath);
    } catch {
      return false;
    }
  }
}

export const pluginManager = new PluginManager();
