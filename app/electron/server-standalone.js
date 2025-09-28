import { createServer } from './server.js';

console.log('Starting ncSender Server in standalone mode...');

async function start() {
  try {
    const server = await createServer();
    console.log(`🚀 Server ready for hot reload development!`);
    console.log(`📡 API: http://localhost:${server.port}/api`);
    console.log(`🔌 WebSocket: ws://localhost:${server.port}`);
    console.log(`🌐 Frontend will be served by Vite on port 5174`);

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('Shutting down server...');
      server.close();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('Shutting down server...');
      server.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();