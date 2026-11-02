import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Dev only: forward the API and Sanctum's CSRF endpoint so the session cookie stays same-origin (ADR-0006).
  // Sanctum treats a request as "stateful" by its Origin/Referer host, so the dev server's host:port
  // (e.g. localhost:5173) must be listed in the backend's SANCTUM_STATEFUL_DOMAINS.
  const target = env.VITE_PROXY_TARGET || 'http://localhost:8000';
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      proxy: {
        '/api': { target, changeOrigin: false },
        '/sanctum': { target, changeOrigin: false },
      },
    },
  };
});
