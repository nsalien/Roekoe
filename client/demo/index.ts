/**
 * Demomodus: the whole game in the browser, without a server.
 *
 * Only preview builds include this (see client/vite.config.ts). It runs the real
 * API — the same Hono app Cloudflare runs, from functions/api/[[path]].ts — on a
 * D1 lookalike over sql.js, so every handler and the whole engine in core/ are
 * the production code. The world lives in localStorage.
 *
 * Hard rule: the demo NEVER talks to the server. The live database may be
 * bound to the Pages preview environment, so `window.fetch` is replaced before
 * the app starts: a request to /api is answered by the in-page API and never
 * leaves the page, and a request to any other origin is refused (the weather
 * lookup then falls back to a random sky). Same-origin static files — the
 * sql.js wasm — still load normally.
 */

import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import initSql from '../../migrations/0001_init.sql?raw';
import { onRequest } from '../../functions/api/[[path]].js';
import { signToken } from '../../core/auth.js';
import { D1Store } from '../../core/d1.js';
import { advanceRealtime } from '../../core/game/schedule.js';
import { computeLeaderboard } from '../../core/presenters.js';
import { DemoD1 } from './d1';
import { createDemoWorld, DEMO_USER_ID, DEMO_USERNAME } from './seed';
import { advanceClock, installDemoClock, resetClock } from './clock';
import { mountBanner } from './banner';

/** Bump when the demo world must be rebuilt for everyone (new seed, new schema). */
const DEMO_VERSION = '2';
const DB_KEY = 'roekoe.demo.db';
const VERSION_KEY = 'roekoe.demo.version';
const TOKEN_KEY = 'roekoe.token';
/** Not a secret: it only signs the demo player's token inside this page. */
const DEMO_JWT_SECRET = 'roekoe-demo-niet-echt';

let d1: DemoD1 | null = null;
let queue: Promise<unknown> = Promise.resolve();

// --- storage --------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

async function loadSaved(): Promise<Uint8Array | null> {
  try {
    if (localStorage.getItem(VERSION_KEY) !== DEMO_VERSION) return null;
    const b64 = localStorage.getItem(DB_KEY);
    if (!b64) return null;
    return await pipe(fromBase64(b64), new DecompressionStream('gzip'));
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function saveNow(): Promise<void> {
  if (!d1) return;
  try {
    const packed = await pipe(d1.sql.export(), new CompressionStream('gzip'));
    localStorage.setItem(DB_KEY, toBase64(packed));
    localStorage.setItem(VERSION_KEY, DEMO_VERSION);
  } catch (err) {
    // Full or blocked storage: the demo keeps running, it just won't survive a reload.
    console.warn('Demo kon niet bewaard worden', err);
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    queue = queue.then(saveNow);
  }, 400);
}

// --- network: /api stays in the page, nothing else leaves it ---------------

function isApi(url: URL): boolean {
  return url.origin === location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/'));
}

function installFetchRouter(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    if (isApi(url)) return inPage(new Request(input, init));
    if (url.origin !== location.origin) {
      return Promise.reject(new TypeError(`Demomodus: geen netwerkverkeer naar ${url.origin}`));
    }
    return realFetch(input, init);
  };
}

// --- boot -----------------------------------------------------------------

async function openWorld(): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await loadSaved();
  if (saved) {
    d1 = new DemoD1(new SQL.Database(saved));
    return;
  }
  resetClock();
  d1 = new DemoD1(new SQL.Database());
  d1.sql.exec(initSql);
  await createDemoWorld(d1);
  await saveNow();
}

/**
 * Let the engine catch up with the demo clock before the app asks anything.
 * The daily tick does one day — and only a slice of the lofts — per request,
 * and reads within ADVANCE_THROTTLE_SECONDS skip the engine; live, the next
 * polls finish the job. After "+1 dag" the demo should show the whole day at
 * once, so run the same engine step (what the API middleware does) until the
 * day is closed. Also covers a player coming back after real time passed.
 */
async function catchUp(): Promise<void> {
  if (!d1) return;
  let last = '';
  for (let i = 0; i < 80; i++) {
    const store = await D1Store.load(d1 as any, DEMO_USER_ID);
    const nowMs = Date.now();
    advanceRealtime(store.data, nowMs, new Map());
    store.data.world.leaderboard = JSON.stringify(computeLeaderboard(store.data));
    store.data.world.lastAdvance = new Date(nowMs).toISOString();
    await store.persist();
    const w = store.data.world;
    const mark = `${w.lastDailyTick}|${w.dailyCareCursor ?? ''}`;
    if (!w.dailyCareCursor && mark === last) return;
    last = mark;
  }
}

export async function bootDemo(): Promise<void> {
  installDemoClock();
  installFetchRouter();
  await openWorld();
  await catchUp();
  await saveNow();
  const token = await signToken({ sub: DEMO_USER_ID, username: DEMO_USERNAME }, DEMO_JWT_SECRET, 60 * 60 * 24 * 365);
  localStorage.setItem(TOKEN_KEY, token);
  mountBanner({
    onAdvance: async (hours) => {
      await queue;
      advanceClock(hours * 3600_000);
      location.reload();
    },
    onReset: async () => {
      await queue;
      if (saveTimer) clearTimeout(saveTimer);
      try {
        localStorage.removeItem(DB_KEY);
        localStorage.removeItem(VERSION_KEY);
      } catch {
        /* nothing stored */
      }
      resetClock();
      location.reload();
    },
  });
}

// --- the in-page API ------------------------------------------------------

function callApi(request: Request): Promise<Response> {
  const ctx = {
    request,
    env: { DB: d1, JWT_SECRET: DEMO_JWT_SECRET },
    params: {},
    data: {},
    functionPath: '/api',
    waitUntil: () => {},
    passThroughOnException: () => {},
    next: () => Promise.reject(new Error('next() bestaat niet in de demo')),
  };
  return (onRequest as unknown as (c: typeof ctx) => Promise<Response>)(ctx);
}

/**
 * Answer an /api request with the real API, inside the page. Requests run one
 * at a time, like a single Worker, and the world is saved shortly after.
 */
function inPage(request: Request): Promise<Response> {
  const run = queue.then(() => callApi(request));
  queue = run.catch(() => undefined).then(scheduleSave);
  return run;
}
