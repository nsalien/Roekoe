/**
 * Migratie v68 — bots bijvullen tot 10 duiven (24 okt, op vraag van de eigenaar:
 * "Indien er bots zijn die minder dan 10 duiven hebben op dit moment, vul hun
 * aantal duiven bij. Random score tussen 60 en 75 (kleinere kans op hoge score,
 * grotere kans tussen 60 en 70). Dit op productie.").
 *
 * Gedekt:
 *  1. de score: altijd ★60–75, ~80 % tussen 60 en 70;
 *  2. een verse wereld (seizoen 1: tests, demo) blijft ongemoeid;
 *  3. op een wereld zoals productie: elke bot onder 10 staat daarna op exact 10,
 *     een bot met 10 of meer krijgt niets, spelers krijgen niets;
 *  4. de nieuwe duiven: score ★60–75 (gemiddelde van de drie vaardigheden),
 *     genen boven elke vaardigheid, oud genoeg om te vliegen, een unieke naam,
 *     en ze beginnen het seizoen op hun eigen score (geen valse "vooruitgang");
 *  5. een hok met minder dan 10 plaatsen gaat naar 10, een groter blijft;
 *  6. TWEE verzoeken die de migratie tegelijk draaien, geven samen nog altijd
 *     10 duiven per bot (vaste ids) — en ook na een rondje door de database;
 *  7. in stappen: hoogstens 3 duiven per verzoek (elke nieuwe duif kost een
 *     D1-query, 50 per verzoek), niets in een verzoek dat een vlucht afrondt, en
 *     de migratie staat pas op 68 als elke bot op 10 staat.
 *
 * Run: npx tsx tests/bot-fill.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema } from '../core/d1.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { advanceRealtime } from '../core/game/schedule.js';
import { rollBotFillScore } from '../core/game/bots.js';
import { ageInWeeks, generatePigeon, seasonScore, talent } from '../core/game/pigeon.js';
import { GENE, RACE_AGE_WEEKS } from '../core/config/gameConfig.js';
import { newId } from '../core/store.js';
import type { Database, User } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

/** A fake D1 that also counts queries (batch statements included, as D1 does). */
let queries = 0;
function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (q: string) => { const b: unknown[] = []; const api: any = {
    bind(...a: unknown[]) { b.push(...a); return api; },
    async first() { queries++; return sql.prepare(q).get(...(b as any[])) ?? null; },
    async all() { queries++; return { results: sql.prepare(q).all(...(b as any[])) }; },
    run() { queries++; return sql.prepare(q).run(...(b as any[])); } }; return api; };
  return { prepare, async exec(q: string) { sql.exec(q); }, async batch(s: any[]) { for (const x of s) x.run(); }, _raw: sql };
}

const NOW = Date.now();
const FILL = 'pig_botfill_';
const botsOf = (db: Database) => db.lofts.filter((l) => l.isBot);
const countOf = (db: Database, uid: string) => db.pigeons.filter((p) => p.ownerId === uid).length;

/** A seeded world in a fake D1 with one human player, run up to v67. */
async function world() {
  const d1 = fakeD1();
  d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').run();
  while (!(await ensureSchema(d1))) {}
  let store = await D1Store.load(d1, undefined); seedWorld(store); await store.persist();
  store = await D1Store.load(d1, undefined);
  const u: User = { id: newId('usr'), username: 'speler', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(NOW).toISOString() };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, 'Het Hok');
  advanceRealtime(store.data, NOW - 60000, new Map());
  await store.persist();
  return { d1, human: u.id, load: (viewer?: string) => D1Store.load(d1, viewer) };
}

// ---------------------------------------------------------------------------
console.log('\n1. De score: ★60–75, vaker tussen 60 en 70');
{
  const n = 20000;
  const xs = Array.from({ length: n }, () => rollBotFillScore());
  ok(xs.every((x) => x >= 60 && x <= 75 && Math.round(x * 10) === x * 10), 'altijd tussen ★60 en ★75, op één decimaal');
  const low = xs.filter((x) => x <= 70).length / n;
  ok(low > 0.77 && low < 0.83, `${(low * 100).toFixed(1)} % tussen ★60 en ★70 (doel 80 %)`);
  const perPoint = (a: number, b: number) => xs.filter((x) => x >= a && x < b).length / (b - a);
  ok(perPoint(60, 70) > 1.7 * perPoint(70, 75), 'per punt score is ★70–75 half zo waarschijnlijk als ★60–70');
}

// ---------------------------------------------------------------------------
console.log('\n2. Een verse wereld (seizoen 1) blijft ongemoeid');
{
  const W = await world();
  const s = await W.load(W.human);
  const before = new Map(botsOf(s.data).map((l) => [l.userId, countOf(s.data, l.userId)]));
  ok((s.data.world.dataVersion ?? 0) >= 68 && s.data.world.seasonYear === 1, `v68 gelopen op seizoen ${s.data.world.seasonYear}`);
  ok(botsOf(s.data).every((l) => countOf(s.data, l.userId) === before.get(l.userId)) && !s.data.pigeons.some((p) => p.id.startsWith(FILL)),
     `geen enkele duif bijgevuld (bots: ${[...before.values()].join('/')})`);
}

// ---------------------------------------------------------------------------
console.log('\n3–6. Een wereld zoals productie: twee verzoeken tegelijk');
{
  const W = await world();
  // Production on 24 okt: season 4, at v67, and bots with very different flocks.
  let s = await W.load(W.human);
  const bots = botsOf(s.data);
  const wanted = [3, 6, 9, 10, 11]; // the rest keep what the seed gave them
  s.mutate((d) => {
    d.world.seasonYear = 4;
    d.world.dataVersion = 67;
    bots.forEach((bot, i) => {
      const want = wanted[i];
      if (want === undefined) return;
      const mine = d.pigeons.filter((p) => p.ownerId === bot.userId);
      if (mine.length > want) {
        const drop = new Set(mine.slice(want).map((p) => p.id));
        d.pigeons = d.pigeons.filter((p) => !drop.has(p.id));
      }
      for (let k = mine.length; k < want; k++) d.pigeons.push(generatePigeon({ ownerId: bot.userId, currentWeek: d.world.currentWeek }));
      const loft = d.lofts.find((l) => l.userId === bot.userId)!;
      loft.capacity = i === 1 ? 12 : i === 4 ? 12 : 8;
    });
  });
  await s.persist();
  s = await W.load(W.human);
  const have = new Map(botsOf(s.data).map((l) => [l.userId, countOf(s.data, l.userId)]));
  const humanBirds = countOf(s.data, W.human);
  ok(bots.slice(0, 5).every((b, i) => have.get(b.userId) === wanted[i]), `voor: bots met ${[...have.values()].join('/')} duiven`);

  // A flight that is due to finish: that request is already one of the dearest
  // (~45 queries), so the migration must not add a single bird to it.
  {
    const busy = await W.load(W.human);
    const f = busy.data.flights.find((x) => x.status === 'scheduled' && !x.practice)!;
    f.status = 'live';
    f.startAt = new Date(NOW - 3 * 86400000).toISOString();
    advanceRealtime(busy.data, NOW, new Map());
    ok(!busy.data.pigeons.some((p) => p.id.startsWith(FILL)) && busy.data.world.dataVersion === 67,
       'een verzoek dat een vlucht afrondt, vult niets bij (en de migratie blijft open)');
  }

  // Two requests load the same v67 world, both run the migration, both persist.
  const A = await W.load(W.human);
  const B = await W.load(W.human);
  advanceRealtime(A.data, NOW, new Map());
  advanceRealtime(B.data, NOW, new Map());
  const firstRun = A.data.pigeons.filter((p) => p.id.startsWith(FILL)).length;
  ok(firstRun === 3 && A.data.world.dataVersion === 67, `het eerste verzoek vult ${firstRun} duiven bij, de migratie blijft open`);
  await A.persist();
  await B.persist();
  // Then the following requests, one by one, until the migration is done — each
  // counted whole (load + engine + write), as one Worker invocation would be.
  let runs = 1, worstFill = 0;
  for (; runs < 40; runs++) {
    queries = 0;
    const r = await W.load(W.human);
    const before = r.data.pigeons.filter((p) => p.id.startsWith(FILL)).length;
    advanceRealtime(r.data, NOW + runs * 30000, new Map());
    const added = r.data.pigeons.filter((p) => p.id.startsWith(FILL)).length - before;
    await r.persist();
    worstFill = Math.max(worstFill, queries);
    if (added > 3) ok(false, `verzoek ${runs}: ${added} duiven in één keer`);
    if ((r.data.world.dataVersion ?? 0) >= 68) break;
  }
  ok(runs < 40, `klaar na ${runs + 1} verzoeken (hoogstens 3 duiven per verzoek)`);
  queries = 0;
  const after = await W.load(W.human);
  advanceRealtime(after.data, NOW + (runs + 1) * 30000, new Map());
  await after.persist();
  ok(worstFill <= queries + 6 && worstFill < 40,
     `duurste bijvulverzoek ${worstFill} queries, een gewoon verzoek erna ${queries} (grens 50)`);
  const db = (await W.load(W.human)).data;

  ok((db.world.dataVersion ?? 0) >= 68, 'v68 gelopen');
  const fills = db.pigeons.filter((p) => p.id.startsWith(FILL));
  const expected = [...have.values()].reduce((n, h) => n + Math.max(0, 10 - h), 0);
  ok(fills.length === expected, `${fills.length} duiven bijgevuld (verwacht ${expected}) — niet dubbel, ondanks twee verzoeken tegelijk`);
  ok(new Set(fills.map((p) => p.id)).size === fills.length, 'elke id één keer');
  ok(botsOf(db).every((l) => fills.filter((p) => p.ownerId === l.userId).length === Math.max(0, 10 - have.get(l.userId)!)),
     'elke bot kreeg precies wat hem tot 10 ontbrak');
  ok(botsOf(db).every((l) => have.get(l.userId)! >= 10 || countOf(db, l.userId) === 10),
     `na: bots met ${botsOf(db).map((l) => countOf(db, l.userId)).join('/')} duiven — wie onder 10 zat, staat op 10`);
  ok(countOf(db, W.human) === humanBirds, 'de speler kreeg niets');

  const scores = fills.map((p) => talent(p));
  ok(scores.every((x) => x >= 60 && x <= 75), `scores ${Math.min(...scores)}–${Math.max(...scores)}`);
  ok(fills.every((p) => (['speed', 'endurance', 'orientation'] as const).every((k) => p.genes![k] > p[k] && p.genes![k] <= GENE.ceil)),
     'genen boven elke vaardigheid (en niet boven het plafond)');
  ok(fills.every((p) => ageInWeeks(p, db.world.currentWeek) >= RACE_AGE_WEEKS), 'allemaal oud genoeg om te vliegen');
  ok(fills.every((p) => p.seasonStartScore === seasonScore(p)), 'ze beginnen het seizoen op hun eigen score');
  // (Only the new birds: the setup above adds a few birds of its own without
  // checking names, which is not what is under test here.)
  const named = (n: string) => db.pigeons.filter((p) => p.name.toLowerCase() === n.toLowerCase()).length;
  ok(fills.every((p) => named(p.name) === 1), 'elke nieuwe duif heeft een naam die nergens anders voorkomt');

  const cap = (i: number) => db.lofts.find((l) => l.userId === bots[i].userId)!.capacity;
  ok(cap(0) === 10 && cap(2) === 10, 'een hok van 8 plaatsen gaat naar 10');
  ok(cap(1) === 12 && cap(4) === 12, 'een hok van 12 blijft 12');
  ok(cap(3) === 8, 'een bot die al 10 duiven had, blijft zoals hij was');

  const s2 = await W.load(W.human);
  const total = s2.data.pigeons.length;
  advanceRealtime(s2.data, NOW + 60000, new Map());
  ok(s2.data.pigeons.filter((p) => p.id.startsWith(FILL)).length === expected && s2.data.pigeons.length <= total,
     'een volgend verzoek vult niets meer bij');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
