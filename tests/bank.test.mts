/**
 * De bank (⚠️ enkel dev) — lenen tot een limiet op je gemiddelde inkomsten, dagelijks
 * afbetalen met rente (core/game/bank.ts, BANK in gameConfig).
 *
 * Gedekt:
 *  1. de formules: terug te betalen (hele procenten, geen €1 te veel door afronding),
 *     per dag, dezelfde rente per dag voor elke looptijd;
 *  2. de inkomsten: per dag bijgehouden, vandaag telt niet mee, ouder dan 14 dagen
 *     valt weg, lege dagen tellen als 0, bots tellen niet;
 *  3. de limiet: 10 × het gemiddelde, op €100 naar beneden, nooit boven €50.000; geen
 *     inkomsten = geen lening; de grootste lening past precies;
 *  4. lenen: elke weigering (rood, bot, bedrag, stap, looptijd, boven de limiet, te veel
 *     leningen), het geld komt erbij en telt NIET als inkomsten;
 *  5. de middernacht: één afbetaling per dag (ook bij meerdere verzoeken), ook zonder
 *     duiven, niet voor een lening van ná die middernacht; de Dagbalans telt ze één keer
 *     (geen dubbele afrekening); afbetaald = weg + één bel; een lege kassa gaat in het rood
 *     en dan leent de bank niets;
 *  6. aflossen: wat nog openstaat, rente inbegrepen;
 *  7. de bronnen: prijzengeld van een echte vlucht, het sponsordagbedrag en de
 *     seizoensprijzen tellen; een verkoop niet;
 *  8. D1 + de echte API: /bank, /bank/borrow, /bank/settle, de kolom overleeft de databank,
 *     een bothok schrijft niets in `bank`;
 *  9. wiki en spelregels == BANK.
 *
 * Run: npx tsx tests/bank.test.mts
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/[[path]].ts';
import { D1Store, ensureSchema } from '../core/d1.js';
import { signToken } from '../core/auth.js';
import { BANK, loanDaily, loanTotal } from '../core/config/gameConfig.js';
import {
  averageIncome, bankLimit, bankOwed, borrow, instalment, maxPrincipal, noteIncome, settleLoan, tickLoans,
} from '../core/game/bank.js';
import { buyPigeon, createLoftForUser, enterFlight, listForSale, seedWorld } from '../core/game/engine.js';
import { advanceRealtime } from '../core/game/schedule.js';
import { runSeasonEnd } from '../core/game/season.js';
import { dailyRunningCost, dailyRunningCostBreakdown } from '../core/game/economy.js';
import { MemoryStore } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Database, Loft, User } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const DAY = 86400000;
// A fixed evening in Brussels, so "tonight's midnight" is always 2 h away.
const T = Date.parse('2026-11-03T22:00:00+01:00');

function world() {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  advanceRealtime(store.data, T - 60000, new Map());
  return store;
}
function addPlayer(store: MemoryStore | D1Store, id: string, money = 5000): Loft {
  const u: User = { id, username: id, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date(T).toISOString() };
  store.mutate((d) => d.users.push(u));
  const loft = createLoftForUser(store, u, `Hok ${id}`);
  loft.money = money;
  loft.newcomer = undefined; // no doubled prize money: income == the prize table
  return loft;
}
/** Give `loft` the same income on each of the last `days` full days. */
function history(loft: Loft, perDay: number, days = BANK.incomeWindowDays) {
  for (let i = 1; i <= days; i++) noteIncome(loft, perDay, T - i * DAY);
}
/** Run requests until the pending midnight is fully processed (the care tick goes in slices). */
function crossMidnight(db: Database, at: number) {
  for (let i = 0; i < 12; i++) advanceRealtime(db, at + i * 1000, new Map());
}
const noop = () => {};

// ---------------------------------------------------------------------------
console.log('\n1. De formules');
{
  ok(loanTotal(5000, 14) === 5500 && loanTotal(5000, 7) === 5250 && loanTotal(5000, 28) === 6000, 'terug te betalen: €5.000 → €5.250 / €5.500 / €6.000 (geen €1 te veel door afronding)');
  ok(loanDaily(5500, 14) === 393 && loanDaily(5250, 7) === 750 && loanDaily(6000, 28) === 215, 'per dag: €750 / €393 / €215, naar boven afgerond');
  ok(loanTotal(1234, 7) === 1296, 'een oneven bedrag rondt naar boven af op €1 (1234 × 1,05 = 1295,7 → 1296)');
  const perDay = BANK.terms.map((t) => t.interest / t.days);
  ok(perDay.every((r) => Math.abs(r - perDay[0]) < 1e-9), `dezelfde rente per dag voor elke looptijd (${(perDay[0] * 100).toFixed(3)} %)`);
  let exact = true;
  for (const t of BANK.terms) {
    for (const p of [100, 700, 5000, 12345]) {
      const total = loanTotal(p, t.days), daily = loanDaily(total, t.days);
      const loan = { id: 'x', principal: p, total, owed: total, daily, days: t.days, left: t.days, at: '' };
      const pays: number[] = [];
      while (loan.owed > 0 && pays.length < 100) { const pay = instalment(loan); pays.push(pay); loan.owed -= pay; loan.left--; }
      if (pays.length !== t.days || pays.reduce((s, x) => s + x, 0) !== total || pays.some((x) => x > daily || x < daily - 1)) {
        exact = false; ok(false, `€${p} over ${t.days} dagen: ${pays.length} afbetalingen (${pays.join(',')})`);
      }
    }
  }
  ok(exact, 'elke lening is na precies haar looptijd afbetaald, elke dag het bedrag per dag of €1 minder (ook €100 over 28 dagen)');
}

// ---------------------------------------------------------------------------
console.log('\n2. De inkomsten');
{
  const store = world();
  const loft = addPlayer(store, 'usr_a');
  ok(averageIncome(loft, T) === 0 && bankLimit(loft, T) === 0, 'een nieuw hok: geen inkomsten, geen limiet');
  noteIncome(loft, 1000, T);
  ok(averageIncome(loft, T) === 0, 'wat je vandaag verdient, telt vandaag nog niet mee');
  ok(averageIncome(loft, T + DAY) === Math.round(1000 / 14), 'morgen wel: €1.000 over 14 dagen');
  ok(averageIncome(loft, T + 14 * DAY) === Math.round(1000 / 14) && averageIncome(loft, T + 15 * DAY) === 0, 'na 14 volle dagen valt het weg');
  const b = addPlayer(store, 'usr_b');
  history(b, 700);
  ok(averageIncome(b, T) === 700, 'twee weken €700 per dag → gemiddeld €700');
  noteIncome(b, 1400, T - 3 * DAY);
  ok(averageIncome(b, T) === 800, 'een late betaling landt op haar eigen dag (€1.400 extra → €800)');
  noteIncome(b, 99999, T - 30 * DAY);
  ok(averageIncome(b, T) === 800, 'iets van 30 dagen terug telt niet');
  ok((b.bank?.income.length ?? 0) <= BANK.incomeWindowDays + 1, `hoogstens ${BANK.incomeWindowDays + 1} dagen bewaard`);
  const c = addPlayer(store, 'usr_c');
  noteIncome(c, 500, T - 10 * DAY);
  noteIncome(c, 500, T - DAY);
  ok(averageIncome(c, T) === Math.round(1000 / 14) && c.bank!.income.length === 10, 'lege dagen ertussen tellen als 0');
  const bot = store.data.lofts.find((l) => l.isBot)!;
  noteIncome(bot, 5000, T - DAY);
  ok(bot.bank === undefined && bankLimit(bot, T) === 0, 'een bot houdt niets bij en leent niets');
  noteIncome(c, -50, T - DAY); noteIncome(c, 0, T - DAY);
  ok(averageIncome(c, T) === Math.round(1000 / 14), 'niets of een negatief bedrag telt niet');
}

// ---------------------------------------------------------------------------
console.log('\n3. De limiet');
{
  const store = world();
  const a = addPlayer(store, 'usr_a'); history(a, 655);
  ok(bankLimit(a, T) === 6500, '€655/dag × 10 = €6.550 → €6.500 (op €100 naar beneden)');
  const rich = addPlayer(store, 'usr_r'); history(rich, 9000);
  ok(bankLimit(rich, T) === BANK.maxLimit, `nooit boven €${BANK.maxLimit.toLocaleString('nl-BE')}`);
  for (const t of BANK.terms) {
    const m = maxPrincipal(a, t.days, T);
    ok(loanTotal(m, t.days) <= 6500 && loanTotal(m + BANK.step, t.days) > 6500, `${t.days} dagen: max €${m} — samen €${loanTotal(m, t.days)}, €100 meer past niet`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n4. Lenen');
{
  const store = world();
  const db = store.data;
  const a = addPlayer(store, 'usr_a'); history(a, 700);
  const none = addPlayer(store, 'usr_n');
  ok(borrow(db, none.userId, 500, 14, T).includes('geen inkomsten'), 'zonder inkomsten: "geen inkomsten"');
  ok(borrow(db, a.userId, 50, 14, T).startsWith('!'), 'onder €100: geweigerd');
  ok(borrow(db, a.userId, 550, 14, T).startsWith('!'), 'geen veelvoud van €100: geweigerd');
  ok(borrow(db, a.userId, 500, 10, T).startsWith('!'), 'een looptijd die niet bestaat: geweigerd');
  ok(borrow(db, a.userId, maxPrincipal(a, 14, T) + 100, 14, T).startsWith('!'), 'boven de limiet: geweigerd');
  const bot = db.lofts.find((l) => l.isBot)!;
  ok(borrow(db, bot.userId, 500, 14, T).startsWith('!'), 'een bot: geweigerd');
  const money = a.money;
  const msg = borrow(db, a.userId, 5000, 14, T);
  const loan = a.bank!.loans[0];
  ok(!msg.startsWith('!') && a.money === money + 5000, `€5.000 geleend: de kassa +€5.000 ("${msg}")`);
  ok(loan.total === 5500 && loan.owed === 5500 && loan.daily === 393 && bankOwed(a) === 5500, 'nog af te betalen €5.500, €393 per dag');
  ok(averageIncome(a, T + DAY) === Math.round((700 * 13) / 14), 'een lening telt niet als inkomsten');
  ok(maxPrincipal(a, 7, T) === 1400, 'nog €1.500 ruimte → over 7 dagen nog €1.400 (samen €1.470)');
  const red = addPlayer(store, 'usr_red', -10); history(red, 700);
  ok(borrow(db, red.userId, 500, 14, T).includes('rood'), 'in het rood: de bank leent niets');
  const many = addPlayer(store, 'usr_m'); history(many, 5000);
  for (let i = 0; i < BANK.maxLoans; i++) borrow(db, many.userId, 100, 7, T);
  ok(many.bank!.loans.length === BANK.maxLoans && borrow(db, many.userId, 100, 7, T).includes(`${BANK.maxLoans} leningen`), `hoogstens ${BANK.maxLoans} leningen tegelijk`);
}

// ---------------------------------------------------------------------------
console.log('\n5. De middernacht');
{
  // No birds: only the loan is charged, so the money moves by exactly one instalment.
  const store = world();
  const db = store.data;
  const a = addPlayer(store, 'usr_a', 2000); history(a, 700);
  db.pigeons = db.pigeons.filter((p) => p.ownerId !== a.userId);
  borrow(db, a.userId, 5000, 14, T);
  const before = a.money;
  crossMidnight(db, T + 3 * 3600000);
  ok(a.money === before - 393 && a.bank!.loans[0].owed === 5500 - 393, 'één afbetaling van €393 om middernacht (ook zonder duiven)');
  crossMidnight(db, T + 5 * 3600000);
  ok(a.bank!.loans[0].owed === 5500 - 393, 'meer verzoeken dezelfde dag: geen tweede afbetaling');
  // Paid off over the full term (some days €1 less); then gone, with one bell.
  for (let d = 1; d <= 14; d++) crossMidnight(db, T + d * DAY + 3 * 3600000);
  const bells = db.notifications.filter((n) => n.userId === a.userId && n.id.startsWith('ntf:bank:done:'));
  ok(a.bank!.loans.length === 0 && a.money === before - 5500, 'na 14 middernachten volledig afbetaald: samen precies €5.500');
  ok(bells.length === 1 && bells[0].title.includes('afbetaald'), 'één bel "Lening afbetaald"');
}
{
  // With birds: the Dagbalans lists the loan once and the biller leaves it out.
  const store = world();
  const db = store.data;
  const a = addPlayer(store, 'usr_a', 50_000); history(a, 700);
  borrow(db, a.userId, 2800, 28, T);
  const alive = db.pigeons.filter((p) => p.ownerId === a.userId);
  const b = dailyRunningCostBreakdown(a, alive.length, 0, 0);
  ok(b.loans === loanDaily(loanTotal(2800, 28), 28) && b.total - b.loans === dailyRunningCost(a, alive.length, 0, 0),
    `de Dagbalans toont €${b.loans} afbetaling in het totaal; de afrekening zelf laat ze weg`);
  const before = a.money;
  crossMidnight(db, T + 3 * 3600000);
  ok(Math.abs(before - a.money - b.total) < 0.01, `om middernacht gaat er precies het Dagbalans-totaal af (€${b.total}), de lening één keer`);
}
{
  // A loan taken AFTER the midnight being processed (a tick that comes late).
  const store = world();
  const db = store.data;
  const a = addPlayer(store, 'usr_a', 5000); history(a, 700);
  borrow(db, a.userId, 1000, 7, T + 2.5 * 3600000); // 00:30, before any request closed midnight
  const loan = a.bank!.loans[0];
  const paid = tickLoans(db, a, T + 2 * 3600000, noop);
  ok(paid === 0 && loan.owed === loan.total, 'een lening van ná die middernacht betaalt er niets voor');
}
{
  // An empty kassa: the instalment still goes, into the red — and then no new loan.
  const store = world();
  const db = store.data;
  const a = addPlayer(store, 'usr_a', 0); history(a, 700);
  borrow(db, a.userId, 2000, 7, T);
  a.money = 50; // spent it
  tickLoans(db, a, T + 2 * 3600000, noop);
  ok(a.money === 50 - 300 && a.money < 0, 'een lege kassa: de afbetaling gaat door, in het rood (−€250)');
  ok(borrow(db, a.userId, 100, 7, T + 3 * 3600000).includes('rood'), 'en dan leent de bank niets meer');
}

// ---------------------------------------------------------------------------
console.log('\n6. Aflossen');
{
  const store = world();
  const db = store.data;
  const a = addPlayer(store, 'usr_a', 0); history(a, 700);
  borrow(db, a.userId, 2000, 14, T);
  const id = a.bank!.loans[0].id;
  tickLoans(db, a, T + 2 * 3600000, noop); // one instalment of €157
  a.money = 100;
  ok(settleLoan(db, a.userId, id).startsWith('!'), 'te weinig in kas: aflossen geweigerd');
  a.money = 5000;
  const owed = a.bank!.loans[0].owed;
  const msg = settleLoan(db, a.userId, id);
  ok(!msg.startsWith('!') && a.money === 5000 - owed && owed === 2200 - 158 && a.bank!.loans.length === 0,
    `aflossen = wat nog openstaat, rente inbegrepen (€${owed})`);
  ok(settleLoan(db, a.userId, id).startsWith('!'), 'een tweede keer: niet gevonden');
}

// ---------------------------------------------------------------------------
console.log('\n7. Wat als inkomsten telt');
{
  // Prize money from a real flight: what the bank counted == the prize table for that loft.
  const store = world();
  const db = store.data;
  const a = addPlayer(store, 'usr_a', 50_000);
  const flight = db.flights.filter((f) => f.status === 'scheduled' && !f.practice && !f.titan && !f.relay && !f.league)
    .sort((x, y) => Date.parse(x.startAt) - Date.parse(y.startAt))[0];
  const mine = db.pigeons.filter((p) => p.ownerId === a.userId);
  for (const p of mine) { p.form = 95; p.health = 95; }
  let entered = 0;
  for (const p of mine.slice(0, 3)) if (enterFlight(store, a.userId, flight.id, p.id) === null) entered++;
  const start = Date.parse(flight.startAt);
  for (let t = Math.max(T, start - 60000); t < start + 3 * DAY; t += 10 * 60000) {
    advanceRealtime(db, t, new Map());
    if (db.flights.find((f) => f.id === flight.id)?.status === 'completed') break;
  }
  const done = db.flights.find((f) => f.id === flight.id)!;
  const prize = (done.results ?? []).filter((r) => r.ownerId === a.userId).reduce((s, r) => s + (r.prize ?? 0), 0);
  const counted = (a.bank?.income ?? []).reduce((s, x) => s + x, 0);
  ok(entered > 0 && done.status === 'completed', `de vlucht vloog (${entered} eigen duiven)`);
  ok(prize > 0 && Math.abs(counted - prize) < 0.01, `het prijzengeld (€${prize}) telt als inkomsten (€${counted})`);
}
{
  // The sponsor's daily stipend, on the day that just ended.
  const store = world();
  const db = store.data;
  const a = addPlayer(store, 'usr_a', 5000);
  a.sponsorship = { ...(a.sponsorship as any), active: [{ id: 'zatte_duif', since: new Date(T - 5 * DAY).toISOString(), dailyStipend: 40, podiumBase: 0 }] };
  crossMidnight(db, T + 3 * 3600000);
  ok(averageIncome(a, T + 3 * 3600000) === Math.round(40 / 14), 'het sponsordagbedrag telt (op de dag die net eindigde)');
}
{
  // Season prizes (the Roekoe, the premie) — and a sale does not count.
  const store = world();
  const db = store.data;
  const a = addPlayer(store, 'usr_a', 5000);
  const b = addPlayer(store, 'usr_b', 50_000);
  a.seasonPoints = 99_999;
  runSeasonEnd(db, db.world.seasonYear ?? 1, T - DAY);
  const award = (a.awards ?? []).reduce((s, x) => s + x.reward, 0);
  ok(award > 0 && averageIncome(a, T) === Math.round(award / 14), `de seizoensprijs (€${award}) telt`);
  const before = (a.bank?.income ?? []).reduce((s, x) => s + x, 0);
  const sold = db.pigeons.find((p) => p.ownerId === a.userId)!;
  const ask = 2000;
  const listed = listForSale(store, a.userId, sold.id, ask) === null && buyPigeon(store, b.userId, sold.id) === null;
  ok(listed && (a.bank?.income ?? []).reduce((s, x) => s + x, 0) === before, 'een duif verkopen telt niet');
}

// ---------------------------------------------------------------------------
console.log('\n8. D1 + de echte API');
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
  return { prepare, async exec(query: string) { sql.exec(query); }, async batch(stmts: any[]) { for (const st of stmts) await st.run(); }, _raw: sql };
}
{
  const ME = 'usr_lener';
  const d1 = fakeD1();
  d1._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
  d1._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1, 1, 1, 0)').run();
  for (let i = 0; i < 40 && !(await ensureSchema(d1)); i++);
  {
    let s = await D1Store.load(d1);
    seedWorld(s);
    await s.persist();
    s = await D1Store.load(d1);
    const nowMs = Date.now();
    advanceRealtime(s.data, nowMs, new Map());
    s.data.world.lastAdvance = new Date(nowMs).toISOString();
    await s.persist();
    s = await D1Store.load(d1, ME);
    const loft = addPlayer(s, ME, 1000);
    for (let i = 1; i <= 14; i++) noteIncome(loft, 500, nowMs - i * DAY);
    await s.persist();
  }
  const SECRET = 'test-geheim';
  const token = await signToken({ sub: ME, username: ME }, SECRET, 3600);
  async function call(path: string, method = 'GET', body?: unknown) {
    const request = new Request(`http://demo.local/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res: Response = await (onRequest as any)({
      request, env: { DB: d1, JWT_SECRET: SECRET }, params: {}, data: {},
      waitUntil() {}, passThroughOnException() {}, next: () => Promise.reject(new Error('no next')),
    });
    return { status: res.status, json: await res.json() as any };
  }
  const v = await call('/bank');
  ok(v.status === 200 && v.json.averageIncome === 500 && v.json.limit === 5000 && v.json.room === 5000 && v.json.blocked === null,
    'GET /bank: €500/dag → limiet €5.000, alles nog vrij');
  ok(v.json.terms.map((t: any) => t.max).join() === '4700,4500,4100', `per looptijd het maximum (${v.json.terms.map((t: any) => t.max).join(' / ')})`);
  const bad = await call('/bank/borrow', 'POST', { amount: 4800, days: 7 });
  ok(bad.status === 400 && /hoogstens/.test(bad.json.error), 'boven het maximum: 400 met uitleg');
  // The first request of the day already paid the daily streak bonus (money + income).
  const money0 = (d1._raw.prepare('SELECT money FROM lofts WHERE user_id = ?').get(ME) as any).money;
  const lent = await call('/bank/borrow', 'POST', { amount: 3000, days: 14 });
  ok(lent.status === 200 && /€3\.000 geleend/.test(lent.json.result), 'POST /bank/borrow');
  const after = await call('/bank');
  ok(after.json.owed === 3300 && after.json.loans.length === 1 && after.json.loans[0].daysLeft === 14 && after.json.dueTonight === 236,
    'de lening staat er: nog €3.300, 14 dagen, vannacht €236');
  const row = d1._raw.prepare('SELECT money, bank FROM lofts WHERE user_id = ?').get(ME) as any;
  const saved = JSON.parse(row.bank);
  ok(row.money === money0 + 3000 && saved.loans[0].owed === 3300 && saved.loans[0].left === 14 && saved.income.length > 0, 'in D1: de kassa (+€3.000), de lening en de inkomsten');
  const st = await call('/state');
  ok(st.json.loft.dailyCosts.loans === 236, 'de Dagbalans in /state toont de afbetaling');
  const moneyBefore = (d1._raw.prepare('SELECT money FROM lofts WHERE user_id = ?').get(ME) as any).money;
  const botRows = d1._raw.prepare("SELECT bank FROM lofts WHERE is_bot = 1").all() as any[];
  ok(botRows.length > 0 && botRows.every((r) => r.bank === ''), 'een bothok schrijft niets in de kolom');
  const settled = await call('/bank/settle', 'POST', { loanId: after.json.loans[0].id });
  ok(settled.status === 200 && (await call('/bank')).json.loans.length === 0, 'POST /bank/settle');
  ok((d1._raw.prepare('SELECT money FROM lofts WHERE user_id = ?').get(ME) as any).money === moneyBefore - 3300, 'aflossen kost €3.300');
}

// ---------------------------------------------------------------------------
console.log('\n9. Wiki en spelregels zeggen wat de bank doet');
{
  const wiki = readFileSync('./client/src/pages/WikiPage.tsx', 'utf8');
  const rules = readFileSync('./spelregels.md', 'utf8');
  const bankWiki = wiki.slice(wiki.indexOf('<Section id="bank"'), wiki.indexOf('</Section>', wiki.indexOf('<Section id="bank"')));
  const bankRules = rules.slice(rules.indexOf('### 13.1 De bank'), rules.indexOf('## 14.'));
  const eur = (n: number) => `€${n.toLocaleString('nl-BE')}`;
  for (const [name, text] of [['wiki', bankWiki], ['spelregels', bankRules]] as const) {
    ok(text.length > 200, `${name}: de sectie bestaat`);
    ok(text.includes(`${BANK.limitDays} dagen`) && text.includes(`${BANK.incomeWindowDays} volle dagen`) && text.includes(eur(BANK.maxLimit)),
      `${name}: ${BANK.limitDays} dagen inkomsten, ${BANK.incomeWindowDays} volle dagen, max ${eur(BANK.maxLimit)}`);
    for (const t of BANK.terms) {
      const total = loanTotal(5000, t.days), daily = loanDaily(total, t.days);
      ok(text.includes(`${t.days} dagen`) && text.includes(`${Math.round(t.interest * 100)} %`) && text.includes(`${eur(daily)} per dag`) && text.includes(eur(total)),
        `${name}: ${t.days} dagen, ${Math.round(t.interest * 100)} %, ${eur(daily)} per dag, samen ${eur(total)}`);
    }
    ok(text.includes(`${BANK.maxLoans} leningen`) && text.includes(eur(BANK.minLoan)), `${name}: ${BANK.maxLoans} leningen, vanaf ${eur(BANK.minLoan)}`);
  }
}

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
process.exit(fail > 0 ? 1 : 0);
