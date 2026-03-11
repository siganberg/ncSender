import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [vue()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    assetsInlineLimit: 0 // Don't inline assets, keep them as files
  },
  assetsInclude: ['**/*.obj', '**/*.mtl'], // Explicitly include OBJ and MTL files
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        secure: false,
        ws: true,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Skip logging for noisy polling endpoints
            if (req.url?.includes('/pendant/status')) return;
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            // Skip logging for noisy polling endpoints
            if (req.url?.includes('/pendant/status')) return;
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        },
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // V1 client imports ../../../package.json from src/composables/ and src/shell/.
      // In V1 that resolves to app/package.json. In V2 it resolves to src/package.json
      // which doesn't exist. Alias it to the client package.json so V1 paths work as-is.
      '../../../package.json': path.resolve(__dirname, 'package.json')
    }
  }
});