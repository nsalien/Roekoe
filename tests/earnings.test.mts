/**
 * "Opgebracht" — het prijzengeld dat een duif voor haar eigenaar won, onder haar
 * waarde op Mijn hok.
 *
 * Wat de test bewaakt:
 *  - de herberekening (EARNINGS_BACKFILL_SQL) telt het prijzengeld uit de
 *    vluchthistoriek — de logtabel én de oude JSON-kolom — één keer per vlucht,
 *    enkel de vluchten voor de HUIDIGE eigenaar, en ×2 voor een vlucht binnen
 *    het starterspakket van die eigenaar; draait tegen echte SQLite, VIA
 *    ensureSchema, met een nep-D1 waarvan exec() — net als echte D1 — elke regel
 *    als een apart statement uitvoert. ⚠️ Precies dat liet de eerste versie
 *    stil mislukken in productie (alle duiven op €0);
 *  - een vlucht telt het uitbetaalde bedrag erbij (met de dubbele starterwinst);
 *  - een prijs voor een nieuwe eigenaar begint de telling opnieuw;
 *  - de DTO toont het enkel aan de eigenaar, en €0 zolang de nieuwe eigenaar
 *    nog niets won.
 *
 * Run: npx tsx tests/earnings.test.mts (vanuit de repo-root)
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ensureSchema, EARNINGS_BACKFILL_SQL, SCHEMA_STEPS } from '../core/d1.js';
import { creditEarnings } from '../core/game/schedule.js';
import { pigeonDTO } from '../core/presenters.js';
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Flight, Loft, User } from '../core/schema.js';
import { createLoftForUser, seedWorld } from '../core/game/engine.js';
import { NEWCOMER } from '../core/config/gameConfig.js';

let fails = 0;
const ok = (c: boolean, m: string) => { c ? console.log(`  ✓ ${m}`) : (fails++, console.log(`  ✗ ${m}`)); };

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...args: unknown[]) { bound.push(...args); return api; },
      async first() { return sql.prepare(query).get(...(bound as any[])) ?? null; },
      async all() { return { results: sql.prepare(query).all(...(bound as any[])) }; },
      run() { const r = sql.prepare(query).run(...(bound as any[])); return { meta: { changes: Number(r.changes) } }; },
    };
    return api;
  };
  // Like real D1: exec() runs every LINE as its own statement.
  const exec = async (q: string) => { for (const line of q.split('\n')) if (line.trim()) sql.exec(line); };
  return { prepare, exec, async batch(stmts: any[]) { for (const s of stmts) s.run(); }, _raw: sql };
}

console.log('\n1. De aanvulling uit de historiek (echte SQLite)');
{
  const db = fakeD1();
  db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  db._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,1)').run();
  for (let i = 0; i < 40 && !(await ensureSchema(db)); i++) { /* volgend blok */ }
  const cols = new Set(db._raw.prepare('PRAGMA table_info(pigeons)').all().map((r: any) => r.name));
  ok(cols.has('earnings') && cols.has('earnings_owner'), 'pigeons heeft earnings + earnings_owner');

  const bird = (id: string, owner: string, raceLog: unknown[] | null) =>
    db._raw.prepare(`INSERT INTO pigeons (id, owner_id, name, sex, birth_week, speed, endurance, orientation, form, health, experience, created_at_week, race_log)
      VALUES (?, ?, ?, 'doffer', 1, 50, 50, 50, 50, 50, 50, 1, ?)`).run(id, owner, id, raceLog ? JSON.stringify(raceLog) : null);
  const log = (pigeonId: string, flightId: string, ownerId: string, prize: number, startAt = '2026-09-20T08:00:00.000Z') =>
    db._raw.prepare('INSERT INTO pigeon_log_entries (id, pigeon_id, kind, at, data) VALUES (?, ?, ?, ?, ?)')
      .run(`${pigeonId}:race:${flightId}`, pigeonId, 'race', startAt, JSON.stringify({ flightId, ownerId, prize, startAt }));

  // A: three races for her owner in the table, one of them also in the legacy blob.
  const late = '2026-09-20T08:00:00.000Z';
  bird('A', 'u1', [{ flightId: 'f1', ownerId: 'u1', prize: 100, startAt: late }, { flightId: 'f0', ownerId: 'u1', prize: 40, startAt: late }]);
  log('A', 'f1', 'u1', 100);
  log('A', 'f2', 'u1', 250, '2026-09-05T08:00:00.000Z'); // inside u1's starter package → paid 500
  log('A', 'f3', 'u1', 0);
  // B: bought from u9 — what she won for u9 does not count for u2.
  bird('B', 'u2', null);
  log('B', 'g1', 'u9', 500);
  log('B', 'g2', 'u2', 75);
  // C: never placed.
  bird('C', 'u3', null);

  // u1 is still in its starter package for races before 2026-09-10 (×2).
  const loft = (userId: string, newcomer: string) =>
    db._raw.prepare(`INSERT INTO lofts (user_id, name, money, food, feed_ration, capacity, newcomer) VALUES (?, ?, 0, 0, 'normal', 10, ?)`)
      .run(userId, userId, newcomer);
  loft('u1', JSON.stringify({ endsAt: '2026-09-10T00:00:00.000Z' }));
  loft('u2', '');
  loft('u3', '');

  // The way production got there: back to just before the recount, and
  // ensureSchema runs it (plus whatever steps were appended after it since).
  db._raw.exec(`UPDATE world SET schema_version = ${SCHEMA_STEPS.lastIndexOf(EARNINGS_BACKFILL_SQL)} WHERE id = 1`);
  ok(await ensureSchema(db), 'ensureSchema loopt de herberekening en is klaar');
  ok(!EARNINGS_BACKFILL_SQL.includes('\n'), 'de herberekening staat op één regel');
  const row = (id: string) => db._raw.prepare('SELECT earnings, earnings_owner FROM pigeons WHERE id = ?').get(id) as any;
  ok(row('A').earnings === 640, `A: 100 + 250×2 (starterspakket) + 40 (oude kolom), f1 maar één keer → €${row('A').earnings}`);
  ok(row('B').earnings === 75, `B: enkel wat ze voor de huidige eigenaar won → €${row('B').earnings}`);
  ok(row('C').earnings === 0, 'C: nooit in de prijzen → €0');
  ok(row('A').earnings_owner === 'u1' && row('B').earnings_owner === 'u2', 'earnings_owner = huidige eigenaar');
}

console.log('\n2. Een vlucht telt erbij');
{
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const db = store.data;
  const mk = (name: string): Loft => {
    const u: User = { id: newId('usr'), username: name, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
    store.mutate((d) => d.users.push(u));
    return createLoftForUser(store, u, name);
  };
  const vet = mk('veteraan');
  vet.newcomer = null as never; // no double winnings
  const rookie = mk('nieuweling'); // starter package running: double winnings
  const p = db.pigeons.find((x) => x.ownerId === vet.userId)!;
  const q = db.pigeons.find((x) => x.ownerId === rookie.userId)!;
  const flight = (id: string, rows: { pigeonId: string; ownerId: string; prize: number }[]) => ({
    id, startAt: new Date().toISOString(),
    results: rows.map((r, i) => ({ ...r, pigeonName: 'x', ownerName: 'x', velocity: 1000, timeSeconds: 1, rank: i + 1, points: 0, finished: true })),
  }) as unknown as Flight;

  creditEarnings(db, flight('fa', [{ pigeonId: p.id, ownerId: vet.userId, prize: 300 }, { pigeonId: q.id, ownerId: rookie.userId, prize: 100 }]));
  creditEarnings(db, flight('fb', [{ pigeonId: p.id, ownerId: vet.userId, prize: 50 }]));
  ok(p.earnings === 350, `veteraan: 300 + 50 → €${p.earnings}`);
  ok(q.earnings === 100 * NEWCOMER.winningsMultiplier, `nieuweling: zoals uitbetaald (×${NEWCOMER.winningsMultiplier}) → €${q.earnings}`);
  ok(pigeonDTO(db, p, vet.userId).earnings === 350, 'de eigenaar ziet het');
  ok(pigeonDTO(db, p, rookie.userId).earnings === null, 'een andere speler niet');

  // Sold: the old total does not follow her to the new owner.
  p.ownerId = rookie.userId;
  ok(pigeonDTO(db, p, rookie.userId).earnings === 0, 'na verkoop: €0 voor de nieuwe eigenaar');
  creditEarnings(db, flight('fc', [{ pigeonId: p.id, ownerId: rookie.userId, prize: 80 }]));
  ok(p.earnings === 80 * NEWCOMER.winningsMultiplier && p.earningsOwner === rookie.userId,
    `de eerste prijs voor de nieuwe eigenaar begint de telling opnieuw → €${p.earnings}`);
}

console.log(fails === 0 ? '\n✅ alles groen' : `\n❌ ${fails} controle(s) gefaald`);
process.exit(fails === 0 ? 0 : 1);
