// vite.config.ts
import { defineConfig } from "file:///Users/francis/projects/ncSender/app/client/node_modules/vite/dist/node/index.js";
import vue from "file:///Users/francis/projects/ncSender/app/client/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import path from "node:path";
var __vite_injected_original_dirname = "/Users/francis/projects/ncSender/app/client";
var vite_config_default = defineConfig({
  root: path.resolve(__vite_injected_original_dirname, "src"),
  plugins: [vue()],
  base: "./",
  build: {
    outDir: path.resolve(__vite_injected_original_dirname, "dist"),
    emptyOutDir: true
  },
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "src")
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvZnJhbmNpcy9wcm9qZWN0cy9uY1NlbmRlci9hcHAvY2xpZW50XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvZnJhbmNpcy9wcm9qZWN0cy9uY1NlbmRlci9hcHAvY2xpZW50L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy9mcmFuY2lzL3Byb2plY3RzL25jU2VuZGVyL2FwcC9jbGllbnQvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCB2dWUgZnJvbSAnQHZpdGVqcy9wbHVnaW4tdnVlJztcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHJvb3Q6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMnKSxcbiAgcGx1Z2luczogW3Z1ZSgpXSxcbiAgYmFzZTogJy4vJyxcbiAgYnVpbGQ6IHtcbiAgICBvdXREaXI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICdkaXN0JyksXG4gICAgZW1wdHlPdXREaXI6IHRydWVcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3NCxcbiAgICBzdHJpY3RQb3J0OiB0cnVlLFxuICAgIGhvc3Q6IHRydWUsXG4gICAgcHJveHk6IHtcbiAgICAgICcvYXBpJzoge1xuICAgICAgICB0YXJnZXQ6ICdodHRwOi8vbG9jYWxob3N0OjMwMDEnLFxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWVcbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgJ0AnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnc3JjJylcbiAgICB9XG4gIH1cbn0pOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBbVQsU0FBUyxvQkFBb0I7QUFDaFYsT0FBTyxTQUFTO0FBQ2hCLE9BQU8sVUFBVTtBQUZqQixJQUFNLG1DQUFtQztBQUl6QyxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixNQUFNLEtBQUssUUFBUSxrQ0FBVyxLQUFLO0FBQUEsRUFDbkMsU0FBUyxDQUFDLElBQUksQ0FBQztBQUFBLEVBQ2YsTUFBTTtBQUFBLEVBQ04sT0FBTztBQUFBLElBQ0wsUUFBUSxLQUFLLFFBQVEsa0NBQVcsTUFBTTtBQUFBLElBQ3RDLGFBQWE7QUFBQSxFQUNmO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixNQUFNO0FBQUEsSUFDTixPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsUUFDTixRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUEsTUFDaEI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsa0NBQVcsS0FBSztBQUFBLElBQ3BDO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
