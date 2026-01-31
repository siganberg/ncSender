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

import { createServer } from './server.js';
import { createLogger, closeLogger } from './core/logger.js';

const { log, error: logError } = createLogger('Server');

// Handle uncaught exceptions (e.g., from native BLE bindings)
process.on('uncaughtException', (err) => {
  logError('Uncaught exception:', err.message);
  // Don't exit - allow server to continue running
});

process.on('unhandledRejection', (reason, promise) => {
  logError('Unhandled rejection:', reason);
  // Don't exit - allow server to continue running
});

log('Starting ncSender Server in standalone mode...');

async function start() {
  try {
    const server = await createServer();
    log('Server ready for hot reload development!');
    log(`API: http://localhost:${server.port}/api`);
    log(`WebSocket: ws://localhost:${server.port}`);
    log('Frontend will be served by Vite on port 5174');

    // Graceful shutdown
    process.on('SIGTERM', () => {
      log('Shutting down server...');
      closeLogger();
      server.close();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      log('Shutting down server...');
      closeLogger();
      server.close();
      process.exit(0);
    });
  } catch (error) {
    logError('Failed to start server:', error);
    process.exit(1);
  }
}

start();