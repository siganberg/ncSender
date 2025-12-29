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
