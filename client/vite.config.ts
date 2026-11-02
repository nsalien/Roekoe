import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Every build gets an id (the commit Cloudflare builds, or a timestamp locally),
 * baked into the bundle as `__APP_BUILD__` AND written to a static
 * `/version.json`. A tab compares the two to notice it is running old code
 * (client/src/game/appVersion.ts) — one static file, no Worker, no D1.
 */
function buildVersion(): Plugin {
  const build = process.env.CF_PAGES_COMMIT_SHA || `local-${Date.now().toString(36)}`;
  return {
    name: 'roekoe-build-version',
    config: () => ({ define: { __APP_BUILD__: JSON.stringify(build) } }),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build }) });
    },
  };
}

// The client talks to the game server. During development we proxy /api to the
// backend so you can run `npm run dev` in both folders without CORS worries.
export default defineConfig({
  plugins: [react(), buildVersion()],
  server: {
    port: 5173,
    proxy: {
      // `wrangler pages dev` serves the API (Functions + local D1) on :8788.
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
