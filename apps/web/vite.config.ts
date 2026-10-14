import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the browser talks only to Vite (5173); /api is proxied to the Express server (4000).
// The browser never sees an LLM key – chat goes through POST /api/v1/chat on the server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:4000', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
