// Cloudflare Pages builds production with `npm run build` and serves client/dist.
// While the game is paused that is one static page plus its icons, and there is
// no functions/ folder, so the live site runs no Worker and touches no database.
//
// version.json carries a build id the game never had: a tab that is still open on
// the old game sees a new build when it comes back to the foreground and reloads
// into this page (client/src/game/appVersion.ts in the full game).
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

const out = 'client/dist';
mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
  copyFileSync(`pauze/${f}`, `${out}/${f}`);
}
const build = `pauze-${process.env.CF_PAGES_COMMIT_SHA || Date.now().toString(36)}`;
writeFileSync(`${out}/version.json`, JSON.stringify({ build }));
