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

/**
 * Demomodus (see client/demo/index.ts). Cloudflare Pages sets CF_PAGES_BRANCH
 * during its build: every branch except production gets a preview deploy, and
 * that preview is built as a self-contained demo that never calls /api. A demo
 * build only swaps the entry point in index.html for client/demo/entry.ts; the
 * production build is untouched, so not a line of demo code ends up in it.
 * ROEKOE_DEMO=1 forces the demo for a local build.
 */
const PRODUCTION_BRANCH = 'claude/roekoe-game-website-jwa0vo';
const branch = process.env.CF_PAGES_BRANCH;
const demo = process.env.ROEKOE_DEMO === '1' || (!!branch && branch !== PRODUCTION_BRANCH);

function demoEntry(): Plugin {
  return {
    name: 'roekoe-demo-entry',
    // 'pre': before Vite reads the entry script out of index.html.
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace('/src/main.tsx', '/demo/entry.ts') },
  };
}

// The client talks to the game server. During development we proxy /api to the
// backend so you can run `npm run dev` in both folders without CORS worries.
export default defineConfig({
  plugins: demo ? [react(), buildVersion(), demoEntry()] : [react(), buildVersion()],
  server: {
    port: 5173,
    // The demo imports the API and the engine from outside client/.
    fs: demo ? { allow: ['..'] } : undefined,
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
