/**
 * Het dagbudget van D1 is gedeeld — en polls zijn wat het opmaakt.
 *
 * Elk verzoek laadt de hele wereld (~300 rijen), en het gratis plan geeft 5M
 * gelezen rijen per DAG voor álle spelers samen. Een vergeten tab die blijft
 * pollen kost dus niet zijn eigen budget maar dat van iedereen: toen het live-
 * bord nog elke 20 s ververste, legde één openstaand bord de site plat.
 *
 * Deze test bewaakt twee dingen:
 *   1. elke poll die het netwerk raakt loopt via `useVisiblePoll` (verborgen tab
 *      = geen verkeer), en niet via een kale `setInterval`;
 *   2. het ergste realistische geval past nog in het dagbudget.
 *
 * Run: npx tsx poll-budget.test.mts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { D1Store, ensureSchema } from './core/d1.js';
import { seedWorld, createLoftForUser, enterFlight } from './core/game/engine.js';
import { advanceRealtime } from './core/game/schedule.js';
import { generatePigeon } from './core/game/pigeon.js';
import { flightDTO, flightEntrantsDTO } from './core/presenters.js';
import { newId } from './core/store.js';
import type { User } from './core/schema.js';

let failures = 0;
const ok = (c: boolean, m: string) => { if (!c) failures++; console.log(`${c ? '  ✓' : '  ✗'} ${m}`); };

/** D1 gratis plan. */
const ROWS_PER_DAY = 5_000_000;

// --- 1. Geen enkele netwerk-poll mag een kale setInterval zijn ---------------
console.log('\nElke netwerk-poll loopt via useVisiblePoll');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const NETWORK = /\b(load|loadBets|loadPairs|refresh|api|fetch)\b/;
const bare: string[] = [];
for (const file of walk('client/src')) {
  const src = readFileSync(file, 'utf8');
  // Pak de body van elke setInterval(...) aanroep, tot aan de sluitende `}`.
  for (const m of src.matchAll(/setInterval\(([\s\S]{0,400}?)\},\s*[^)]*\)/g)) {
    if (NETWORK.test(m[1])) bare.push(`${file}: ${m[1].trim().split('\n')[0].slice(0, 60)}…`);
  }
}
ok(bare.length === 0, bare.length === 0
  ? 'geen kale setInterval die het netwerk raakt'
  : `kale netwerk-poll gevonden:\n      ${bare.join('\n      ')}`);

// --- 2. De intervallen zelf --------------------------------------------------
console.log('\nDe pollintervallen');
const polls: { file: string; ms: number }[] = [];
for (const file of walk('client/src')) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/useVisiblePoll\(([\s\S]{0,400}?),\s*(\d+)\s*(?:,|\))/g)) {
    polls.push({ file: file.replace('client/src/', ''), ms: Number(m[2]) });
  }
}
ok(polls.length > 0, `${polls.length} poll(s) gevonden`);
// 20 s was aantoonbaar te snel (zie de comment in LiveFlightPage): dat was de
// stand toen de site onderuit ging. Alles moet daar ruim boven blijven, behalve
// de veilingpoll die enkel in de slotminuten draait.
for (const p of polls) {
  const closingOnly = p.file.includes('MarketPage');
  ok(p.ms >= (closingOnly ? 15000 : 60000),
    `${p.file} pollt elke ${p.ms / 1000} s${closingOnly ? ' (enkel in de slotfase)' : ''}`);
}

// --- 3. Wat kost een verzoek echt? ------------------------------------------
console.log('\nRijen per verzoek in een wereld op ware grootte');
let rows = 0;
let counting = false;
const sql = new DatabaseSync(':memory:');
const prepare = (q: string) => {
  const bound: unknown[] = [];
  const api = {
    bind(...a: unknown[]) { bound.push(...a); return api; },
    async first() { return sql.prepare(q).get(...(bound as any[])) ?? null; },
    async all() {
      const r = sql.prepare(q).all(...(bound as any[]));
      if (counting) rows += r.length;
      return { results: r };
    },
    run() { return sql.prepare(q).run(...(bound as any[])); },
  };
  return api;
};
const d1: any = { prepare, async exec(q: string) { sql.exec(q); }, async batch(s: any[]) { for (const x of s) x.run(); } };
d1.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
d1.prepare('INSERT INTO world (id,current_week,season_year,seeded) VALUES (1,1,1,0)').bind().run();
while (!(await ensureSchema(d1)));

let store = await D1Store.load(d1, undefined);
seedWorld(store);
await store.persist();
store = await D1Store.load(d1, undefined);
const humans: string[] = [];
for (let i = 0; i < 10; i++) {
  const u: User = { id: newId('usr'), username: `s${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, `Hok ${i}`);
  humans.push(u.id);
}
// Het ontwerpplafond uit context.md: 10 spelers × capaciteit 20 + 8 bots × 8.
store.mutate((d) => {
  const owners = d.lofts.map((l) => l.userId);
  let i = 0;
  while (d.pigeons.length < 264) {
    const p = generatePigeon({ currentWeek: 1, quality: 0.5 });
    p.ownerId = owners[i++ % owners.length];
    d.pigeons.push(p);
  }
});
await store.persist();

// Een échte wedstrijdkalender, met iedereen ingeschreven. Dit ontbrak hier, en
// dat verborg een dure bug: de smalle load haalde óók elke deelnemer van elke
// lopende vlucht op, en dat is zowat de hele populatie. Zonder inschrijvingen
// was die helft altijd leeg, dus de test zag er niets van. Nu wel.
store = await D1Store.load(d1, undefined);
store.mutate((d) => advanceRealtime(d, Date.now(), new Map()));
const scheduledFlights = store.data.flights.filter((f) => f.status === 'scheduled');
for (const f of scheduledFlights) {
  for (const loft of store.data.lofts) {
    const owned = store.data.pigeons.filter((p) => p.ownerId === loft.userId);
    // Roteer per vlucht, zoals een melker zijn hok laat afwisselen.
    const start = (scheduledFlights.indexOf(f) * 3) % Math.max(1, owned.length);
    for (let k = 0; k < 3; k++) {
      const p = owned[(start + k) % owned.length];
      if (p) enterFlight(store, loft.userId, f.id, p.id);
    }
  }
}
store.mutate((d) => { d.world.lastAdvance = new Date().toISOString(); });
await store.persist();
store = await D1Store.load(d1, undefined);

const runningEntrants = new Set<string>();
for (const f of store.data.flights) {
  if (f.status === 'completed') continue;
  for (const e of f.entries ?? []) runningEntrants.add(e.pigeonId);
}
console.log(`\n  Kalender: ${scheduledFlights.length} geplande vluchten, ${runningEntrants.size} unieke duiven ingeschreven`);
ok(runningEntrants.size > 100, `genoeg inschrijvingen om de val te spannen (${runningEntrants.size})`);

const pigeonCount = store.data.pigeons.length;

// Een volle load: elke schrijfactie en elke route die de hele wereld nodig heeft.
counting = true;
await D1Store.load(d1, humans[0]);
const fullRows = rows;
rows = 0;
// En de smalle load die /state gebruikt zodra de engine vers is.
store.mutate((d) => { d.world.lastAdvance = new Date().toISOString(); });
await store.persist();
rows = 0;
const narrow = await D1Store.load(d1, humans[0], { narrowWhenIdle: true });
const narrowRows = rows;
counting = false;

ok(narrow.narrowed, 'een lees-verzoek met verse engine krijgt een smalle load');
ok(narrowRows < fullRows / 2, `smal ${narrowRows} rijen vs. vol ${fullRows} bij ${pigeonCount} duiven`);
console.log(`  → vol:  ${fullRows} rijen  (${Math.floor(ROWS_PER_DAY / fullRows).toLocaleString('nl-NL')} verzoeken/dag)`);
console.log(`  → smal: ${narrowRows} rijen  (${Math.floor(ROWS_PER_DAY / narrowRows).toLocaleString('nl-NL')} verzoeken/dag)`);
const rowsPerRequest = narrowRows;

// --- 4. Past het ergste realistische geval? ---------------------------------
console.log('\nHet ergste realistische geval');
// 10 spelers, elk met een zichtbare tab op de traagste poll (90 s) plus een
// live bord (60 s) tijdens een vlucht, een hele dag lang.
const PLAYERS = 10;
const perTabPerDay = (ms: number) => 86400_000 / ms;
// Elke speler een hele dag met een zichtbare Vluchten-tab (90 s). Het live-bord
// telt niet mee: dat draait al op de goedkope bypass van 2 rijen.
const pollingRequests = PLAYERS * perTabPerDay(90000);
// En daarbovenop stevig doorklikken: 300 handelingen per speler per dag, elk
// met een /state erachteraan.
const clicking = PLAYERS * 300;
const total = pollingRequests + clicking;
// Zowel /flights als /state draaien nu op een smalle load.
const totalRows = (pollingRequests + clicking) * rowsPerRequest;
console.log(`  ${Math.round(pollingRequests).toLocaleString('nl-NL')} verzoeken uit polls + ${clicking.toLocaleString('nl-NL')} uit klikken = ${Math.round(total).toLocaleString('nl-NL')}`);
console.log(`  = ${Math.round(totalRows / 1000).toLocaleString('nl-NL')}k rijen (${(totalRows / ROWS_PER_DAY * 100).toFixed(0)}% van het dagbudget)`);
ok(totalRows < ROWS_PER_DAY, 'blijft binnen het dagbudget van D1');

// Waar we vandaan komen: dezelfde dag met de oude situatie — alles een volle
// load, en verborgen tabs die gewoon doorpollen.
const before = (pollingRequests + clicking) * fullRows + PLAYERS * perTabPerDay(60000) * fullRows;
console.log(`\n  Ter vergelijking, dezelfde dag vóór deze wijziging:`);
console.log(`  ${Math.round(before / 1000).toLocaleString('nl-NL')}k rijen (${(before / ROWS_PER_DAY * 100).toFixed(0)}% van het budget) — alles een volle load, verborgen tabs polden door.`);

// --- 5. Een smalle load mag nooit duiven wissen -----------------------------
// Dit is het echte risico van deeltjes laden: `persist` verwijdert rijen die in
// de snapshot zaten maar niet meer in de array. Zaten andermans duiven nooit in
// die snapshot, dan mogen ze ook niet verdwijnen.
console.log('\nEen smalle load raakt andermans duiven niet');
const totalBefore = (sql.prepare('SELECT COUNT(*) AS n FROM pigeons').get() as any).n;
const otherBefore = (sql.prepare('SELECT COUNT(*) AS n FROM pigeons WHERE owner_id != ?').get(humans[0]) as any).n;

const s2 = await D1Store.load(d1, humans[0], { narrowWhenIdle: true });
ok(s2.narrowed, 'de load is smal');
ok(s2.data.pigeons.length < totalBefore, `${s2.data.pigeons.length} van ${totalBefore} duiven in geheugen`);
// Schrijf iets aan de eigen kant en bewaar.
s2.mutate((d) => {
  const mine = d.pigeons.find((p) => p.ownerId === humans[0]);
  if (mine) mine.form = 42;
  d.lofts.find((l) => l.userId === humans[0])!.money += 1;
});
await s2.persist();

const totalAfter = (sql.prepare('SELECT COUNT(*) AS n FROM pigeons').get() as any).n;
const otherAfter = (sql.prepare('SELECT COUNT(*) AS n FROM pigeons WHERE owner_id != ?').get(humans[0]) as any).n;
ok(totalAfter === totalBefore, `nog steeds ${totalAfter} duiven (was ${totalBefore})`);
ok(otherAfter === otherBefore, `andermans ${otherAfter} duiven zijn ongemoeid`);

// En een SCHRIJF-verzoek krijgt nooit een smalle wereld.
const s3 = await D1Store.load(d1, humans[0], { narrowWhenIdle: false });
ok(!s3.narrowed, 'een verzoek zonder narrow-hint krijgt de volle wereld');
ok(s3.data.pigeons.length === totalBefore, 'met alle duiven erin');

// Is de engine NIET vers, dan mag er ook niet versmald worden — anders zou de
// dagtick op een halve wereld draaien.
s3.mutate((d) => { d.world.lastAdvance = new Date(Date.now() - 3600_000).toISOString(); });
await s3.persist();
const s4 = await D1Store.load(d1, humans[0], { narrowWhenIdle: true });
ok(!s4.narrowed, 'een verlopen engine dwingt een volle load af');
ok(s4.data.pigeons.length === totalBefore, 'zodat de engine de hele wereld ziet');

// --- 6. De deelnemerslijst hoort NIET op het hete pad -----------------------
// Namen geven aan andermans duif kost een volle pigeon-load. Rijdt die lijst mee
// op /flights — door élke open tab gepolld — dan trekt ze zowat de hele
// populatie terug in het leesbudget en is de smalle load nog maar ~7% goedkoper
// dan een volle. Ze hoort dus op een eigen route die pas afgaat als iemand het
// weddenschapspaneel opent.
console.log('\nDe deelnemerslijst blijft van het hete pad');

// Sectie 5 heeft de engine bewust laten verlopen; zet de klok terug op vers,
// anders krijgt dit blok sowieso een volle load en bewijst het niets.
s4.mutate((d) => { d.world.lastAdvance = new Date().toISOString(); });
await s4.persist();

const s5 = await D1Store.load(d1, humans[0], { narrowWhenIdle: true });
ok(s5.narrowed, 'de load is smal');
const raceFlight = s5.data.flights.find((f) => f.status === 'scheduled' && (f.entries?.length ?? 0) > 0);
ok(!!raceFlight, 'er is een geplande vlucht met inschrijvingen');
if (raceFlight) {
  const dto = flightDTO(s5.data, raceFlight) as Record<string, unknown>;
  ok(!('entrants' in dto), 'flightDTO draagt geen entrants meer');
  // Dit is de eigenlijke bewaking: de smalle load mag niet meeschalen met het
  // aantal inschrijvingen. Zonder dit blijft de winst van de smalle load enkel
  // op papier bestaan.
  const mineCount = s5.data.pigeons.filter((p) => p.ownerId === humans[0]).length;
  ok(
    s5.data.pigeons.length <= mineCount + 60,
    `smalle load blijft smal ondanks ${runningEntrants.size} inschrijvingen: ${s5.data.pigeons.length} duiven (eigen ${mineCount})`,
  );
  ok(s5.data.pigeons.length < totalBefore / 2, `en ruim onder de volle ${totalBefore}`);

  // Op haar eigen route (volle load) moet ze wél compleet zijn — dat was de
  // klacht: elke deelnemer heette "duif" met ★0.
  const full = await D1Store.load(d1, humans[0]);
  const f2 = full.data.flights.find((f) => f.id === raceFlight.id)!;
  const named = flightEntrantsDTO(full.data, f2);
  ok(named.length === f2.entries.length, `${named.length} deelnemers in de lijst`);
  const nameless = named.filter((e) => e.name === 'duif' || e.talent === 0);
  ok(nameless.length === 0, `elke deelnemer heeft een naam en ★talent (${nameless.length} naamloos)`);
  ok(new Set(named.map((e) => e.ownerId)).size > 1, 'en de lijst reikt over meerdere hokken');

  // Een afgelopen vlucht heeft geen lijst nodig: wedden is dicht en de uitslag
  // draagt haar eigen namen.
  const done = full.data.flights.find((f) => f.status === 'completed');
  if (done) ok(flightEntrantsDTO(full.data, done).length === 0, 'een afgelopen vlucht levert een lege lijst');

  // --- De uitzondering: estafetteploegen MOETEN wél mee in de smalle load ----
  // `flightDTO.teams` noemt de ploegmaten bij naam, ook die van andere hokken.
  // Dat is de enige plek die dat nog doet, en ze is begrensd (3 duiven per hok,
  // om de week). Zou die set níet meekomen, dan heette elke ploegmaat "duif".
  full.mutate((d) => { d.flights.find((f) => f.id === raceFlight.id)!.relay = true; });
  await full.persist();

  const s6 = await D1Store.load(d1, humans[0], { narrowWhenIdle: true });
  ok(s6.narrowed, 'de load is nog steeds smal met een estafette op de kalender');
  const relay = s6.data.flights.find((f) => f.id === raceFlight.id)!;
  const teamNames = (flightDTO(s6.data, relay) as any).teams?.flatMap((t: any) => t.legs.map((l: any) => l.name)) ?? [];
  ok(teamNames.length > 0, `${teamNames.length} ploegplaatsen in de DTO`);
  ok(teamNames.every((n: string) => n !== 'duif'), 'elke ploegmaat heeft een naam, ook bij een ander hok');
  ok(s6.data.pigeons.length < totalBefore / 2, `en de load blijft smal: ${s6.data.pigeons.length} van ${totalBefore}`);
}

console.log(failures === 0 ? '\n✅ Alles in orde\n' : `\n❌ ${failures} test(s) gefaald\n`);
process.exit(failures === 0 ? 0 : 1);
