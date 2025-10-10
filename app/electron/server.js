import { getSetting, DEFAULT_SETTINGS } from './core/settings-manager.js';
import { createApp } from './app.js';

// Bootstrap: load config/env, initialize the app, and start the server
export async function createServer() {
  const connectionSettings = getSetting('connection');
  const configuredPort = connectionSettings?.serverPort ?? DEFAULT_SETTINGS.connection.serverPort;
  const port = process.env.PORT || configuredPort;
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
