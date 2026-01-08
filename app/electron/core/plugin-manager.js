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

import fs from 'node:fs';
import path from 'node:path';
import { pluginEventBus } from './plugin-event-bus.js';
import { readSettings, saveSettings } from './settings-manager.js';
import { getUserDataDir } from '../utils/paths.js';
import { parseM6Command } from '../utils/gcode-patterns.js';
import { createLogger } from './logger.js';

const { log, error: logError, warn: logWarn } = createLogger('PluginManager');

// Categories that only allow one plugin to be enabled at a time
const EXCLUSIVE_CATEGORIES = new Set(['tool-changer']);

// Plugin Categories:
// - tool-changer: Manages automatic tool changes (exclusive, priority 50-100)
// - post-processor: Transforms G-code files before execution (non-exclusive, priority 120-150)
// - utility: General-purpose helper plugins (non-exclusive, priority 0-50)
// - gcode-generator: Generates G-code programmatically (non-exclusive, priority 0-50)
// - custom: User-defined category (non-exclusive, priority varies)

// Support development mode - load plugins from project directory
const DEV_PLUGINS_DIR = process.env.DEV_PLUGINS_DIR;
const PLUGINS_DIR = DEV_PLUGINS_DIR || path.join(getUserDataDir(), 'plugins');
// Always save settings to separate plugin-config directory that is never touched during install/uninstall
const PLUGIN_SETTINGS_DIR = path.join(getUserDataDir(), 'plugin-config');
const REGISTRY_PATH = path.join(getUserDataDir(), 'plugins.json');

if (DEV_PLUGINS_DIR) {
  log('Development mode enabled - loading plugins from:', DEV_PLUGINS_DIR);
  log('Plugin settings will be saved to:', PLUGIN_SETTINGS_DIR);
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
    this.dialogResolvers = new Map();
  }

  async initialize({ cncController, broadcast, sendWsMessage, serverState } = {}) {
    if (this.initialized) {
      log('Plugin manager already initialized');
      return;
    }

    this.cncController = cncController;
    this.broadcast = broadcast;
    this.sendWsMessage = sendWsMessage;
    this.serverState = serverState;

    // Register handler to intercept cnc-data and detect plugin messages
    // This must be registered BEFORE plugins are loaded so it runs first
    this.eventBus.on('ws:cnc-data', async (data) => {
      if (typeof data === 'string') {
        // Check for pattern: [MSG:PLUGIN_PluginCode:MESSAGE_ID] or [MSG, PLUGIN_PluginCode:MESSAGE_ID]
        // Examples: [MSG:PLUGIN_RCS:LOAD_MESSAGE] or [MSG, PLUGIN_RCS:LOAD_MESSAGE]
        const msgPattern = /\[MSG[,\s]*:?\s*PLUGIN_([^:]+):([^\]]+)\]/i;
        const match = data.match(msgPattern);

        if (match) {
          const pluginCode = match[1].trim();
          const messageId = match[2].trim();

          const pluginMessage = {
            pluginCode,
            messageId,
            rawData: data,
            timestamp: Date.now()
          };

          // Save to settings.pluginMessage
          try {
            const settings = readSettings() || {};
            settings.pluginMessage = pluginMessage;
            saveSettings(settings);
            log('Saved plugin message to settings');
          } catch (error) {
            log('Failed to save plugin message to settings:', error);
          }
        }
      }
    });

    // Register handler for dialog responses from clients
    this.eventBus.on('client:dialog-response', (data) => {
      const { dialogId, response } = data;
      const resolver = this.dialogResolvers.get(dialogId);
      if (resolver) {
        // Clear timeout
        const timeoutId = this.dialogResolvers.get(`${dialogId}_timeout`);
        if (timeoutId) {
          clearTimeout(timeoutId);
          this.dialogResolvers.delete(`${dialogId}_timeout`);
        }
        
        // Resolve the promise
        resolver(response);
        this.dialogResolvers.delete(dialogId);
        log(`Resolved dialog ${dialogId} with response:`, response);
      } else {
        log(`Warning: No resolver found for dialog ${dialogId}`);
      }
    });

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

      if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry || !manifest.category) {
        throw new Error('Invalid manifest: missing required fields (id, name, version, entry, category)');
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
      const pluginModule = await import(`file://${entryPath}?t=${Date.now()}`);

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
        const pluginLogger = createLogger(`PLUGIN:${pluginId}`);
        pluginLogger.log(...args);
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

      getServerState: () => {
        return this.serverState || null;
      },

      showDialog: (title, content, options = {}) => {
        return new Promise((resolve) => {
          const dialogId = `${pluginId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          const payload = {
            pluginId,
            dialogId,
            title,
            content,
            options
          };

          // Store promise resolver
          this.dialogResolvers.set(dialogId, resolve);
          
          // Auto-cleanup after 5 minutes
          const timeoutId = setTimeout(() => {
            const resolver = this.dialogResolvers.get(dialogId);
            if (resolver) {
              resolver(null);
              this.dialogResolvers.delete(dialogId);
            }
          }, 300000);
          
          this.dialogResolvers.set(`${dialogId}_timeout`, timeoutId);

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
        });
      },

      showModal: (content, options = {}) => {
        const payload = {
          pluginId,
          content,
          closable: options.closable !== false
        };

        const stack = this.executionContextStack.get(pluginId);
        const activeContext = stack && stack.length > 0 ? stack[stack.length - 1] : null;
        const isClientOnly = activeContext?.clientOnly || false;
        const executionWs = activeContext?.ws || null;

        if (isClientOnly && executionWs && this.sendWsMessage) {
          this.sendWsMessage(executionWs, 'plugin:show-modal', payload);
        } else {
          if (!this.broadcast) {
            throw new Error('Broadcast function not available');
          }
          this.broadcast('plugin:show-modal', payload);

          // Update pluginMessage with the actual modal payload
          try {
            const settings = readSettings() || {};
            // Keep the original trigger info but add the modal payload
            settings.pluginMessage = {
              ...settings.pluginMessage,
              modalPayload: payload
            };
            saveSettings(settings);
            log('Updated pluginMessage with modal payload');
          } catch (error) {
            log('Failed to update pluginMessage with modal payload:', error);
          }
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
      },

      // Utility functions for plugins
      utils: {
        parseM6Command: parseM6Command
      }
    };

    return context;
  }

  getPluginSettings(pluginId) {
    const settingsPath = path.join(PLUGIN_SETTINGS_DIR, pluginId, 'config.json');

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
    const settingsPath = path.join(PLUGIN_SETTINGS_DIR, pluginId, 'config.json');
    const pluginDir = path.dirname(settingsPath);

    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
    }

    try {
      // Load existing settings and merge with new settings
      const existingSettings = this.getPluginSettings(pluginId);
      const mergedSettings = { ...existingSettings, ...settings };

      fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf8');
      log(`Saved settings for plugin "${pluginId}" to:`, settingsPath);
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
    const existingPlugin = existingIndex >= 0 ? registry[existingIndex] : null;

    // Determine enabled state
    let shouldEnable;
    if (existingPlugin !== null) {
      // Preserve existing enabled state for updates
      shouldEnable = existingPlugin.enabled;
    } else {
      // For new installs, check for exclusive category conflicts
      shouldEnable = true;
      if (manifest.category && EXCLUSIVE_CATEGORIES.has(manifest.category)) {
        const conflictingPlugin = registry.find(p =>
          p.id !== pluginId &&
          p.category === manifest.category &&
          p.enabled === true
        );
        if (conflictingPlugin) {
          shouldEnable = false;
          log(`Plugin "${pluginId}" has exclusive category "${manifest.category}" - ` +
              `disabling by default because "${conflictingPlugin.id}" is already enabled`);
        }
      }
    }

    const pluginEntry = {
      id: pluginId,
      name: manifest.name,
      version: manifest.version,
      category: manifest.category,
      enabled: shouldEnable,
      installedAt: existingPlugin?.installedAt || new Date().toISOString()
    };

    // Only add priority if it exists in manifest
    if (manifest.priority !== undefined) {
      pluginEntry.priority = manifest.priority;
    }

    // Only add repository if it exists in manifest
    if (manifest.repository !== undefined) {
      pluginEntry.repository = manifest.repository;
    }

    if (existingIndex >= 0) {
      registry[existingIndex] = pluginEntry;
    } else {
      registry.push(pluginEntry);
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

    // Handle exclusive category
    if (plugin.category && EXCLUSIVE_CATEGORIES.has(plugin.category)) {
      const conflictingPlugins = registry.filter(p =>
        p.id !== pluginId &&
        p.category === plugin.category &&
        p.enabled === true
      );

      if (conflictingPlugins.length > 0) {
        const error = new Error('CATEGORY_CONFLICT');
        error.conflictingPlugins = conflictingPlugins.map(p => ({ id: p.id, name: p.name }));
        error.category = plugin.category;
        throw error;
      }
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

  async updatePluginPriority(pluginId, newPriority) {
    const registry = this.loadRegistry();
    const plugin = registry.find(p => p.id === pluginId);

    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" not found in registry`);
    }

    plugin.priority = newPriority;
    this.saveRegistry(registry);

    log(`Updated priority for plugin "${pluginId}" to ${newPriority}`);
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
    // Initialize command array with original command
    let commands = [{
      command: command,
      isOriginal: true,
      displayCommand: null,
      meta: context.meta || {},
      commandId: context.commandId || null
    }];

    // Sort plugins by priority (descending - higher number executes first)
    const sortedPlugins = Array.from(this.plugins.entries()).sort((a, b) => {
      const priorityA = a[1].manifest.priority ?? 0; // No priority = 0 (executes last)
      const priorityB = b[1].manifest.priority ?? 0;
      return priorityB - priorityA; // Descending order
    });

    // Iterate through sorted plugins
    for (const [pluginId, plugin] of sortedPlugins) {
      const pluginContext = this.pluginContexts.get(pluginId);

      // Get handlers registered via ctx.registerEventHandler('onBeforeCommand', ...)
      const pluginEventHandlers = this.eventBus.pluginHandlers.get(pluginId);
      const handlers = pluginEventHandlers?.get('onBeforeCommand') || [];

      if (handlers.length > 0) {
        for (const handler of handlers) {
          try {
            const result = await handler(commands, context, pluginContext);
            // Plugin returns modified array or undefined (no changes)
            if (Array.isArray(result)) {
              commands = result;
            }
          } catch (error) {
            log(`Error in plugin "${pluginId}" onBeforeCommand:`, error);
            // Continue with other plugins even if one fails
          }
        }
      }
    }

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

  clearPluginMessage() {
    try {
      const settings = readSettings() || {};
      settings.pluginMessage = null;
      saveSettings(settings);
      log('Cleared pluginMessage from settings');
    } catch (error) {
      log('Failed to clear pluginMessage from settings:', error);
    }
  }
}

export const pluginManager = new PluginManager();
