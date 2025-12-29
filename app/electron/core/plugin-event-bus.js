import { EventEmitter } from 'node:events';
import { createLogger } from './logger.js';

const { log, error: logError } = createLogger('PluginEventBus');

class PluginEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.pluginHandlers = new Map();
  }

  registerPluginHandler(pluginId, eventName, handler) {
    if (!pluginId || typeof pluginId !== 'string') {
      throw new Error('Plugin ID is required and must be a string');
    }

    if (!eventName || typeof eventName !== 'string') {
      throw new Error('Event name is required and must be a string');
    }

    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    const handlerKey = `${pluginId}:${eventName}`;

    if (!this.pluginHandlers.has(pluginId)) {
      this.pluginHandlers.set(pluginId, new Map());
    }

    const pluginEventHandlers = this.pluginHandlers.get(pluginId);

    if (!pluginEventHandlers.has(eventName)) {
      pluginEventHandlers.set(eventName, []);
    }

    const handlers = pluginEventHandlers.get(eventName);
    handlers.push(handler);

    this.on(eventName, handler);

    log(`Registered handler for plugin "${pluginId}" on event "${eventName}"`);
  }

  unregisterPluginHandlers(pluginId) {
    if (!this.pluginHandlers.has(pluginId)) {
      return;
    }

    const pluginEventHandlers = this.pluginHandlers.get(pluginId);

    for (const [eventName, handlers] of pluginEventHandlers.entries()) {
      for (const handler of handlers) {
        this.removeListener(eventName, handler);
      }
    }

    this.pluginHandlers.delete(pluginId);
    log(`Unregistered all handlers for plugin "${pluginId}"`);
  }

  async emitAsync(eventName, ...args) {
    const listeners = this.listeners(eventName);

    if (listeners.length === 0) {
      return [];
    }

    const results = [];

    for (const listener of listeners) {
      try {
        const result = await listener(...args);
        results.push({ success: true, result });
      } catch (error) {
        log(`Error in plugin handler for event "${eventName}":`, error);
        results.push({ success: false, error });
      }
    }

    return results;
  }

  async emitChain(eventName, initialValue, ...extraArgs) {
    const listeners = this.listeners(eventName);

    if (listeners.length === 0) {
      return initialValue;
    }

    let value = initialValue;

    for (const listener of listeners) {
      try {
        const result = await listener(value, ...extraArgs);
        if (result !== undefined) {
          value = result;
        }
      } catch (error) {
        log(`Error in plugin chain handler for event "${eventName}":`, error);
      }
    }

    return value;
  }

  getPluginHandlers(pluginId) {
    return this.pluginHandlers.get(pluginId) || new Map();
  }

  getAllRegisteredPlugins() {
    return Array.from(this.pluginHandlers.keys());
  }
}

export const pluginEventBus = new PluginEventBus();
