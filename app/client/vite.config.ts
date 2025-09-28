import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  plugins: [vue()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true
  },
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});