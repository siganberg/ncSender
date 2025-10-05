import { getSetting, DEFAULT_SETTINGS } from './core/settings-manager.js';
import { createApp } from './app.js';

// Bootstrap: load config/env, initialize the app, and start the server
export async function createServer() {
  const port = process.env.PORT || getSetting('serverPort') || DEFAULT_SETTINGS.serverPort;
  const instance = await createApp({ port });
  await instance.start();
  return {
    app: instance.app,
    server: instance.server,
    wss: instance.wss,
    port: instance.port,
    close: instance.close
  };
}
