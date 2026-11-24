import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The Kiro server (SYS-12, `npm run server`): the page calls /api/kiro/* on its own origin in dev and in production alike.
    proxy: { '/api/kiro': { target: `http://127.0.0.1:${process.env.KIRO_SERVER_PORT ?? 8787}`, changeOrigin: false } },
  },
});
