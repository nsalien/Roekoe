import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client talks to the game server. During development we proxy /api to the
// backend so you can run `npm run dev` in both folders without CORS worries.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
