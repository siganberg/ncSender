import { createServer } from './server.js';
import { createLogger, closeLogger } from './core/logger.js';

const { log, error: logError } = createLogger('Server');

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