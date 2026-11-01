/**
 * Demomodus: preview builds are a self-contained demo, the production build
 * carries not a line of it (see client/vite.config.ts).
 *
 * Builds the client twice into temp folders:
 *   - CF_PAGES_BRANCH = the production branch → index.html starts src/main.tsx,
 *     no sql.js wasm, no demo text anywhere in the bundle;
 *   - CF_PAGES_BRANCH = any other branch → the demo entry + the wasm are there.
 * Run from the repo root: npx tsx tests/demo-build.test.mts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
  else console.log(`  ✓ ${msg}`);
}

const PRODUCTION_BRANCH = 'claude/roekoe-game-website-jwa0vo';
const client = resolve('client');

function build(branch: string): { dir: string; html: string; files: string[]; js: string } {
  const dir = mkdtempSync(join(tmpdir(), 'roekoe-build-'));
  execFileSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: client,
    env: { ...process.env, CF_PAGES_BRANCH: branch, ROEKOE_DEMO: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const files = readdirSync(join(dir, 'assets'));
  const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n');
  return { dir, html: readFileSync(join(dir, 'index.html'), 'utf8'), files, js };
}

console.log('\nProductiebuild (CF_PAGES_BRANCH = productiebranch)');
const prod = build(PRODUCTION_BRANCH);
assert(!prod.files.some((f) => f.endsWith('.wasm')), 'geen sql.js-wasm in de assets');
for (const needle of ['Demomodus', 'roekoe.demo.', 'roekoe-demo-niet-echt', 'initSqlJs', 'sql-wasm']) {
  assert(!prod.js.includes(needle), `de bundel bevat "${needle}" niet`);
}
assert(prod.js.includes('/api'), 'de bundel praat gewoon met /api');

console.log('\nPreviewbuild (CF_PAGES_BRANCH = een andere branch)');
const demo = build('claude/een-andere-branch');
assert(demo.files.some((f) => f.endsWith('.wasm')), 'sql.js-wasm zit in de assets');
assert(demo.js.includes('Demomodus'), 'de banner zit in de bundel');
assert(demo.js.includes('roekoe-demo-niet-echt'), 'de demo tekent haar eigen token');
assert(demo.html !== prod.html, 'index.html start een ander instappunt');

console.log('\nLokale build zonder CF_PAGES_BRANCH');
const local = build('');
assert(!local.files.some((f) => f.endsWith('.wasm')), 'gewone build, geen demo');
assert(local.html === prod.html, 'zelfde index.html als productie');

for (const b of [prod, demo, local]) rmSync(b.dir, { recursive: true, force: true });
