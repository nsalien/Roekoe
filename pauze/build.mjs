// Cloudflare Pages builds this branch with `npm run build` and serves client/dist.
// While Dev is paused that is one static page, and there is no functions/ folder,
// so this deployment runs no Worker and touches no database.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('client/dist', { recursive: true });
copyFileSync('pauze/index.html', 'client/dist/index.html');
