import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 关键：base 用 './'（相对路径）
// 管理端托管在 https://<env>.service.tcloudbase.com/admin-static/ 下，
// 若用绝对路径 /assets/... 会指向域名根目录导致 404。
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
  },
});
