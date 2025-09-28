import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { CNCController } from './electron/cnc-controller.js';

const cncController = new CNCController();

function apiPlugin() {
  return {
    name: 'api-plugin',
    configureServer(server) {
      server.middlewares.use('/api/serial-ports', async (req, res) => {
        try {
          const ports = await cncController.listAvailablePorts();
          res.end(JSON.stringify(ports));
        } catch (error) {

          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Failed to list serial ports' }));
        }
      });

      server.middlewares.use('/api/status', async (req, res) => {
        try {
          const status = cncController.getConnectionStatus();
          res.end(JSON.stringify(status));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Failed to get status' }));
        }
      });

      server.middlewares.use('/api/disconnect', async (req, res) => {
        try {
          cncController.disconnect();
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ success: false, error: error.message }));
        }
      });

      server.middlewares.use('/api/connect', async (req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', async () => {
          const { port, baudRate } = JSON.parse(body);
          try {
            await cncController.connect(port, baudRate);
            res.end(JSON.stringify({ success: true }));
          } catch (error) {

            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: error.message }));
          }
        });
      });
    }
  };
}

export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  plugins: [vue(), apiPlugin()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});