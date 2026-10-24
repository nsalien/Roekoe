/**
 * Het bolletje op Kweek: een duif aangeboden om te kweken, of een aanbod dat
 * aangepast werd (de eigenaar, 14 okt: "zoals gewoonlijk … een bolletje aan
 * 'kweek' zodat ze weten waar ze heen moeten gaan"). Zelfde opzet als de stip op
 * de Markt (market-news.test.mts).
 *
 * Bewaakt:
 *   1. de server stempelt `world.studNewsAt` (+ `studNewsBy`) bij een nieuw aanbod
 *      en bij gewijzigde voorwaarden — en NERGENS anders: niet bij dezelfde
 *      voorwaarden opnieuw, niet bij intrekken, niet op een gewone poll;
 *   2. de stempel overleeft D1 (load + INSERT + UPDATE) en de echte API: /state
 *      geeft hem aan de navigatie, /breeding stuurt hem mee met de aanbiedingen;
 *   3. de regel zelf: wie ziet het bolletje, en wanneer verdwijnt het.
 *
 * Run (vanuit de repo-root): npx tsx tests/stud-news.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]].ts';
import { D1Store, ensureSchema } from '../core/d1.js';
import { signToken } from '../core/auth.js';
import { MemoryStore } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Database, User } from '../core/schema.js';
import { createLoftForUser, seedWorld } from '../core/game/engine.js';
import { advanceRealtime } from '../core/game/schedule.js';
import { noteStudNews, setStudListing } from '../core/game/stud.js';
import { hasStudNews, markStudSeen, studSeenAt } from '../client/src/game/studSeen.js';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
};

const user = (id: string): User => ({ id, username: id, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() });
/** A healthy grown-up bird of this player, free to be put up. */
function birdOf(w: Database, userId: string) {
  const p = w.pigeons.find((x) => x.ownerId === userId)!;
  p.birthWeek = w.world.currentWeek - 60;
  p.ailment = null;
  p.inInfirmary = false;
  return p;
}

// --- 1. Waar de server stempelt -----------------------------------------------
console.log('\nDe server stempelt een nieuw of aangepast aanbod');
{
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const w = store.data;
  for (const id of ['anna', 'bert']) {
    const u = user(id);
    w.users.push(u);
    createLoftForUser(store, u, `Hok ${id}`);
  }
  const t0 = Date.parse('2026-10-14T09:00:00.000Z');
  advanceRealtime(w, t0);
  ok('een nieuwe wereld heeft geen stempel', !w.world.studNewsAt);

  const p = birdOf(w, 'anna');
  const terms = { minScore: 50, minEnergy: 30, minLibido: 30, wants: 'fee' as const };
  ok('Anna biedt een duif aan', setStudListing(w, 'anna', p.id, terms, t0) === null);
  ok('  → gestempeld, door Anna', w.world.studNewsAt === new Date(t0).toISOString() && w.world.studNewsBy === 'anna');

  setStudListing(w, 'anna', p.id, terms, t0 + 60_000);
  ok('dezelfde voorwaarden opnieuw opslaan is geen nieuws', w.world.studNewsAt === new Date(t0).toISOString());

  setStudListing(w, 'anna', p.id, { ...terms, minScore: 55 }, t0 + 120_000);
  ok('een andere minimumscore is nieuws', w.world.studNewsAt === new Date(t0 + 120_000).toISOString());
  setStudListing(w, 'anna', p.id, { ...terms, minScore: 55, wants: 'young' }, t0 + 180_000);
  ok('jongen i.p.v. vergoeding is nieuws', w.world.studNewsAt === new Date(t0 + 180_000).toISOString());
  setStudListing(w, 'anna', p.id, { ...terms, minScore: 55, minEnergy: 40, wants: 'young' }, t0 + 240_000);
  ok('een andere minimumenergie is nieuws', w.world.studNewsAt === new Date(t0 + 240_000).toISOString());

  setStudListing(w, 'anna', p.id, null, t0 + 300_000);
  ok('intrekken is geen nieuws (er valt niets te bekijken)', w.world.studNewsAt === new Date(t0 + 240_000).toISOString());

  const before = JSON.stringify(w.world.studNewsAt);
  advanceRealtime(w, t0 + 600_000);
  ok('een gewone poll stempelt niet', JSON.stringify(w.world.studNewsAt) === before);
}

// --- 2. D1 en de echte API --------------------------------------------------------
console.log('\nDe stempel overleeft D1 en de API');
{
  function fakeD1(): any {
    const sql = new DatabaseSync(':memory:');
    const val = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
    const prepare = (query: string) => {
      const bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) { bound.push(...args.map(val)); return api; },
        async first() { return sql.prepare(query).get(...(bound as any[])) ?? null; },
        async all() { return { results: sql.prepare(query).all(...(bound as any[])) }; },
        async run() { return sql.prepare(query).run(...(bound as any[])); },
      };
      return api;
    };
    return { prepare, async exec(q: string) { sql.exec(q); }, async batch(stmts: any[]) { for (const s of stmts) await s.run(); }, _raw: sql };
  }
  const d1 = fakeD1();
  d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1, 1, 1, 0)').run();
  for (let i = 0; i < 60 && !(await ensureSchema(d1)); i++);
  const cols = d1._raw.prepare('PRAGMA table_info(world)').all().map((r: any) => r.name);
  ok('de world-tabel heeft stud_news_at en stud_news_by', cols.includes('stud_news_at') && cols.includes('stud_news_by'));

  // INSERT path: a fresh world row.
  d1._raw.prepare('DELETE FROM world WHERE id = 1').run();
  let s = await D1Store.load(d1);
  seedWorld(s);
  noteStudNews(s.data, 'iemand', Date.parse('2026-10-14T08:00:00.000Z'));
  await s.persist();
  s = await D1Store.load(d1);
  ok('INSERT: de stempel staat er na een herlading', s.data.world.studNewsAt === '2026-10-14T08:00:00.000Z' && s.data.world.studNewsBy === 'iemand');

  // The players, then the real API (UPDATE path).
  for (const id of ['anna', 'bert']) {
    const u = user(id);
    s.data.users.push(u);
    createLoftForUser(s, u, `Hok ${id}`);
  }
  const annasBird = birdOf(s.data, 'anna');
  advanceRealtime(s.data, Date.now());
  s.data.world.lastAdvance = new Date().toISOString();
  await s.persist();

  const SECRET = 'geheim';
  async function call(who: string, path: string, method = 'GET', body?: unknown) {
    const token = await signToken({ sub: who, username: who }, SECRET, 3600);
    const res: Response = await (onRequest as any)({
      request: new Request(`http://t.local/api${path}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env: { DB: d1, JWT_SECRET: SECRET }, params: {}, data: {},
      waitUntil() {}, passThroughOnException() {}, next: () => Promise.reject(new Error('no next')),
    });
    return { status: res.status, json: await res.json() as any };
  }
  const r = await call('anna', '/breeding/stud/list', 'POST', { pigeonId: annasBird.id, minScore: 40, minEnergy: 20, minLibido: 20, wants: 'fee' });
  ok(`Anna biedt aan via de API (${r.json.error ?? 'ok'})`, r.status === 200);
  const state = (await call('bert', '/state')).json;
  ok('/state geeft de stempel aan de navigatie, met Anna erbij',
    !!state.world?.studNewsAt && state.world.studNewsBy === 'anna' && state.world.studNewsAt !== '2026-10-14T08:00:00.000Z');
  const breeding = (await call('bert', '/breeding')).json;
  ok('/breeding stuurt dezelfde stempel mee met de aanbiedingen', breeding.stud?.newsAt === state.world.studNewsAt);
  ok('  en Bert ziet Annas duif daar', breeding.stud.listings.some((l: any) => l.pigeon.id === annasBird.id));

  const v0 = (d1._raw.prepare('SELECT version FROM world WHERE id = 1').get() as any).version;
  await call('bert', '/breeding');
  await call('bert', '/state');
  const v1 = (d1._raw.prepare('SELECT version FROM world WHERE id = 1').get() as any).version;
  ok('kijken schrijft de wereldrij niet', v0 === v1, `version ${v0} → ${v1}`);
}

// --- 3. De regel van het bolletje (client, React-vrij) -----------------------
console.log('\nWie ziet het bolletje, en wanneer verdwijnt het');
{
  const bucket = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => bucket.get(k) ?? null,
    setItem: (k: string, v: string) => { bucket.set(k, v); },
  };
  (globalThis as any).window = { dispatchEvent() { return true; } };
  (globalThis as any).Event = class { constructor(public type: string) {} };
  const T1 = '2026-10-14T10:00:00.000Z';
  const T2 = '2026-10-14T12:00:00.000Z';

  ok('zonder stempel geen bolletje', !hasStudNews('', '', 'bert', 0));
  ok('een aanbod dat je nog niet zag geeft een bolletje', hasStudNews(T1, 'anna', 'bert', 0));
  ok('je eigen aanbod geeft jou geen bolletje', !hasStudNews(T1, 'anna', 'anna', 0));
  ok('niet aangemeld: geen bolletje', !hasStudNews(T1, 'anna', null, 0));
  ok('een onleesbaar tijdstip geeft geen bolletje', !hasStudNews('geen datum', 'anna', 'bert', 0));

  ok('vóór het kijken: nooit gezien', studSeenAt('bert') === 0);
  markStudSeen('bert', [T1, undefined, '']);
  ok('Samen kweken bekeken → het bolletje is weg', !hasStudNews(T1, 'anna', 'bert', studSeenAt('bert')));
  ok('  een nieuwer aanbod brengt het terug', hasStudNews(T2, 'anna', 'bert', studSeenAt('bert')));
  markStudSeen('bert', [T1, T2]);
  ok('het nieuwste tijdstip telt (/breeding kan vóór de /state-poll lopen)', studSeenAt('bert') === Date.parse(T2));
  markStudSeen('bert', [T1]);
  ok('de stand gaat nooit achteruit', studSeenAt('bert') === Date.parse(T2));
  ok('elke speler zijn eigen stand', studSeenAt('anna') === 0);

  (globalThis as any).localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  let threw = false;
  try { markStudSeen('bert', [T2]); } catch { threw = true; }
  ok('privémodus crasht niet, en lezen valt terug op "nooit gezien"', !threw && studSeenAt('bert') === 0);
}

console.log(`\n${pass} geslaagd, ${fail} gefaald`);
if (fail > 0) process.exitCode = 1;
