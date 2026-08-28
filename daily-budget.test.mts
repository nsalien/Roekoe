/**
 * Regressietest op de DAGLIMIETEN van D1 (gratis plan, vanaf 1 sep 2026 hard
 * afgedwongen): **5.000.000 rijen gelezen** en **100.000 rijen geschreven** per
 * dag, reset om 00:00 UTC. Loopt een van beide vol, dan faalt élke query en is
 * het spel onbereikbaar tot middernacht.
 *
 * De twee bestaande wachters dekken dit NIET: `query-budget` telt queries per
 * invocatie (een andere limiet) en `idle-writes` bewijst alleen dat een *stille*
 * poll niets schrijft. Deze test draait een volledige, drukke SPEELDAG door de
 * echte engine — kalender, live vluchten, energie-aftrek, afronding, dagovergang,
 * bots — en telt wat een dag werkelijk kost.
 *
 * Run: npx tsx daily-budget.test.mts
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema, loadLiveFlight } from './core/d1.js';
import { liveBoardDTO, liveFlightDTO } from './core/presenters.js';
import { seedWorld, createLoftForUser, enterFlight } from './core/game/engine.js';
import { advanceRealtime } from './core/game/schedule.js';
import { newId } from './core/store.js';
import { generatePigeon } from './core/game/pigeon.js';
import { ADVANCE_THROTTLE_SECONDS } from './core/config/gameConfig.js';
import type { User } from './core/schema.js';

const READ_LIMIT = 5_000_000;
const WRITE_LIMIT = 100_000;
/** Blijf ruim onder de limiet: een dag mag hoogstens dit deel opsouperen. */
const MAX_SHARE = 0.5;

/** D1 rekent per geschreven rij ook elke index-entry die het moet bijwerken. */
const INDEXES: Record<string, number> = {
  users: 1, lofts: 0, pigeons: 1, breeding_pairs: 0, flights: 2,
  notifications: 2, trades: 1, auctions: 0, auction_bids: 1, bets: 2, offers: 0, world: 0,
};

let rowsRead = 0;
let rowsWritten = 0;
let requests = 0;

const tableOf = (sql: string): string => (sql.match(/(?:INTO|FROM|UPDATE)\s+([a-z_]+)/i) ?? [])[1] ?? '';

function fakeD1(): any {
  const sql = new DatabaseSync(':memory:');
  const prepare = (query: string) => {
    const bound: unknown[] = [];
    const api = {
      bind(...a: unknown[]) { bound.push(...a); return api; },
      async first() { const r = sql.prepare(query).get(...(bound as any[])); if (r) rowsRead += 1; return r ?? null; },
      async all() { const results = sql.prepare(query).all(...(bound as any[])); rowsRead += results.length; return { results }; },
      run() {
        const r = sql.prepare(query).run(...(bound as any[]));
        const table = /^\s*(WITH|UPDATE|INSERT|DELETE)/i.test(query)
          ? tableOf(query.replace(/^\s*WITH[\s\S]*?\)\s*/i, ''))
          : '';
        rowsWritten += Number(r.changes ?? 0) * (1 + (INDEXES[table] ?? 1));
        return r;
      },
    };
    return api;
  };
  return { prepare, async exec(q: string) { sql.exec(q); }, async batch(s: any[]) { for (const x of s) x.run(); }, _raw: sql };
}

const db = fakeD1();
db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
db._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,0)').run();
while (!(await ensureSchema(db))) { /* resume */ }

const T0 = Date.parse('2026-09-06T00:00:00Z'); // een zondag: twee wedstrijden
let store = await D1Store.load(db, undefined);
seedWorld(store);
await store.persist();

store = await D1Store.load(db, undefined);
const humans: string[] = [];
for (let i = 0; i < 10; i++) {
  const u: User = { id: newId('usr'), username: `speler${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString() };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, `Hok ${i}`);
  humans.push(u.id);
}
// Volle hokken: het duurste geval dat het spel toelaat (capaciteit 20).
store.mutate((d) => {
  const owners = d.lofts.map((l) => l.userId);
  let i = 0;
  while (d.pigeons.length < Number(process.env.PIGEONS ?? 300)) {
    const p = generatePigeon({ currentWeek: d.world.currentWeek, quality: 0.5 });
    p.ownerId = owners[i % owners.length];
    d.pigeons.push(p);
    i += 1;
  }
});
await store.persist();
// Een gevulde handelshistoriek en volle inboxen — die worden meegelezen.
for (let t = 0; t < 300; t++) {
  db._raw.prepare('INSERT INTO trades (id, pigeon_id, pigeon_name, seller_id, seller_name, buyer_id, buyer_name, price, at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(`trd_${t}`, 'p', 'Duif', humans[0], 'a', humans[1], 'b', 100, new Date(T0 - t * 60000).toISOString());
}
for (const h of humans) {
  for (let n = 0; n < 40; n++) {
    db._raw.prepare('INSERT INTO notifications (id, user_id, kind, title, body, flight_id, created_at, read) VALUES (?,?,?,?,?,NULL,?,0)')
      .run(`ntf_${h}_${n}`, h, 'i', 't', 'b', new Date(T0 - n * 60000).toISOString());
  }
}

// --- Meten begint hier ------------------------------------------------------
rowsRead = 0; rowsWritten = 0; requests = 0;

/** Eén verzoek: laden, engine (tenzij gethrotteld zoals in de middleware), persist. */
async function request(nowMs: number, viewer: string | undefined, readOnly: boolean) {
  requests++;
  const s = await D1Store.load(db, viewer);
  const last = Date.parse(s.data.world.lastAdvance ?? '');
  const fresh = !Number.isNaN(last) && nowMs - last >= 0 && nowMs - last < ADVANCE_THROTTLE_SECONDS * 1000;
  if (!(fresh && readOnly)) {
    advanceRealtime(s.data, nowMs, new Map());
    s.data.world.lastAdvance = new Date(nowMs).toISOString();
    await s.persist();
  }
}

/**
 * Een poll van het live-bord, exact zoals de middleware hem afhandelt: eerst de
 * smalle weg (wereldrij + de vlucht = 2 rijen), en enkel wanneer de engine
 * toe is aan een ronde de volle weg. Dit is verreweg het meeste verkeer.
 */
async function liveRequest(nowMs: number, viewer: string, flightId: string) {
  requests++;
  const lite = await loadLiveFlight(db, flightId);
  if (lite) {
    const last = Date.parse(lite.lastAdvance);
    const fresh = !Number.isNaN(last) && nowMs - last >= 0 && nowMs - last < ADVANCE_THROTTLE_SECONDS * 1000;
    if (fresh) {
      liveBoardDTO(lite.flight, nowMs); // zelfde werk als de echte route
      return;
    }
  }
  requests--; // de volle weg telt zichzelf
  await request(nowMs, viewer, true);
}

// Warm de kalender op en schrijf iedereen in voor de zondagsvluchten.
await request(T0, undefined, false);
{
  const s = await D1Store.load(db, undefined);
  const races = s.data.flights.filter((f) => f.status === 'scheduled' && !f.practice && !f.ageCat);
  for (const f of races) {
    for (const h of humans) {
      const s2 = await D1Store.load(db, h);
      for (const p of s2.data.pigeons.filter((x) => x.ownerId === h).slice(0, 6)) enterFlight(s2, h, f.id, p.id);
      await s2.persist();
    }
  }
}

/**
 * Een DRUKKE speeldag, bewust pessimistisch:
 *  - 10 spelers die samen 8 uur lang een live-bord openhouden (poll per 60 s),
 *  - de hele dag door achtergrondverkeer (kalender/overzicht, poll per 90 s),
 *  - plus alle engine-momenten die vanzelf komen: vluchten die starten, de
 *    energie-aftrek per 30 min, afrondingen, en de dagovergang om 00:00.
 */
const LIVE_WATCHERS = Number(process.env.WATCHERS ?? 10);
const LIVE_HOURS = Number(process.env.HOURS ?? 8);
const BACKGROUND_PER_MIN = Number(process.env.BACKGROUND ?? 2); // ~2.900/dag

const DAY_MINUTES = 24 * 60;
for (let m = 0; m < DAY_MINUTES; m++) {
  const nowMs = T0 + m * 60_000;
  // Achtergrondverkeer: iemand kijkt naar de kalender of het overzicht.
  for (let k = 0; k < BACKGROUND_PER_MIN; k++) {
    await request(nowMs + k * 1000, humans[(m + k) % humans.length], true);
  }
  // Live-borden: tussen 08:00 en 16:00 kijkt iedereen mee. (De vlucht opzoeken
  // gaat rechtstreeks langs sqlite, buiten de telling om — een echte speler
  // heeft die id gewoon in zijn URL staan.)
  const hour = Math.floor(m / 60);
  const watched = db._raw
    .prepare("SELECT id FROM flights WHERE status IN ('live','scheduled') ORDER BY status DESC, start_at LIMIT 1")
    .get() as { id?: string } | undefined;
  const watchedFlightId = watched?.id ?? '';
  if (hour >= 8 && hour < 8 + LIVE_HOURS) {
    for (let w = 0; w < LIVE_WATCHERS; w++) {
      await liveRequest(nowMs + 30_000 + w * 500, humans[w % humans.length], watchedFlightId);
    }
  }
}

const readShare = rowsRead / READ_LIMIT;
const writeShare = rowsWritten / WRITE_LIMIT;
const pad = (s: string, n: number) => s.padEnd(n);

/**
 * De smalle weg mag GOEDKOPER zijn, niet ANDERS. Hier vergelijken we voor elke
 * vluchtstatus het antwoord van `liveBoardDTO` (uit de vlucht alleen) met dat van
 * de volle `liveFlightDTO` (uit de hele wereld), veld per veld zoals de
 * live-pagina ze leest. Wijkt er iets af, dan liegt de goedkope weg.
 */
const equivalence: { label: string; same: boolean; detail: string }[] = [];
{
  const s = await D1Store.load(db, undefined);
  const now = Date.parse(s.data.world.lastAdvance || new Date(T0).toISOString());
  const byStatus = new Map<string, typeof s.data.flights[number]>();
  for (const f of s.data.flights) if (!byStatus.has(f.status)) byStatus.set(f.status, f);
  // Een afgeronde race halverwege terugzetten geeft ons het belangrijkste geval —
  // een écht lopende vlucht met een bevroren sim — ook al is de dag voorbij.
  const done = s.data.flights.find((f) => f.status === 'completed' && f.sim.length > 0);
  if (done) {
    const slowest = Math.max(...done.sim.map((x) => x.durationSeconds));
    byStatus.set('live (halverwege)', {
      ...done, status: 'live',
      startAt: new Date(now - slowest * 0.5 * 1000).toISOString(),
    } as typeof done);
  }
  for (const [status, f] of byStatus) {
    const full = liveFlightDTO(s.data, f, now);
    const lite = liveBoardDTO(f, now);
    // `entries` is the ONE deliberate difference: the live page reads it only to
    // label relay legs, so a normal flight gets an empty list instead of ~90
    // objects it would never look at. Checked separately, below.
    const fields = ['id', 'name', 'fromCity', 'toCity', 'distanceKm', 'startAt', 'status', 'weather', 'relay', 'results', 'recap'] as const;
    const diffs: string[] = [];
    for (const k of fields) {
      const a = JSON.stringify((full.flight as any)[k] ?? null);
      const b = JSON.stringify((lite.flight as any)[k] ?? null);
      if (a !== b) diffs.push(k);
    }
    if (JSON.stringify(full.live) !== JSON.stringify(lite.live)) diffs.push('live');
    if (JSON.stringify(full.commentary) !== JSON.stringify(lite.commentary)) diffs.push('commentary');
    const entriesOk = f.relay
      ? JSON.stringify(lite.flight.entries) === JSON.stringify(f.entries)
      : lite.flight.entries.length === 0;
    if (!entriesOk) diffs.push('entries');
    equivalence.push({ label: `${status}-vlucht: smal == volledig`, same: diffs.length === 0, detail: diffs.join(', ') });
  }
}

console.log('Gesimuleerde drukke speeldag (24 u, echte engine)\n');
console.log(`  ${pad('spelers', 26)} 10 (+ bots), 300 duiven, volle inboxen en handelshistoriek`);
console.log(`  ${pad('live-bord', 26)} ${LIVE_WATCHERS} kijkers × ${LIVE_HOURS} u, poll per 60 s`);
console.log(`  ${pad('achtergrondverkeer', 26)} ${BACKGROUND_PER_MIN}/min de klok rond`);
console.log(`  ${pad('totaal verzoeken', 26)} ${requests.toLocaleString('nl-BE')}\n`);
console.log(`  ${pad('rijen GELEZEN', 26)} ${rowsRead.toLocaleString('nl-BE').padStart(11)} van 5.000.000  (${(readShare * 100).toFixed(1)}%)`);
console.log(`  ${pad('rijen GESCHREVEN', 26)} ${rowsWritten.toLocaleString('nl-BE').padStart(11)} van   100.000  (${(writeShare * 100).toFixed(1)}%)`);
console.log(`  ${pad('per verzoek', 26)} ${(rowsRead / requests).toFixed(0)} gelezen · ${(rowsWritten / requests).toFixed(1)} geschreven\n`);

const headroomRead = READ_LIMIT / (rowsRead || 1);
const headroomWrite = WRITE_LIMIT / (rowsWritten || 1);
console.log(`  Marge: ${headroomRead.toFixed(1)}× op lezen, ${headroomWrite.toFixed(1)}× op schrijven`);
console.log(`  Anders gezegd: ${Math.floor(READ_LIMIT / (rowsRead / requests)).toLocaleString('nl-BE')} verzoeken/dag voor het leesbudget op is.\n`);

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fails++;
};
ok(`lezen blijft onder ${MAX_SHARE * 100}% van de daglimiet`, readShare < MAX_SHARE, `${(readShare * 100).toFixed(1)}%`);
ok(`schrijven blijft onder ${MAX_SHARE * 100}% van de daglimiet`, writeShare < MAX_SHARE, `${(writeShare * 100).toFixed(1)}%`);
ok('een verzoek leest minder dan 500 rijen', rowsRead / requests < 500, `${(rowsRead / requests).toFixed(0)} rijen`);
console.log('');
for (const e of equivalence) ok(e.label, e.same, e.detail || 'identiek');
ok('er is minstens één vluchtstatus getoetst', equivalence.length > 0, `${equivalence.length} statussen`);

console.log(fails === 0 ? '\nAlles OK — een drukke dag past ruim binnen beide daglimieten' : `\n${fails} FOUT(EN) — de daglimiet komt in zicht`);
process.exitCode = fails === 0 ? 0 : 1;
