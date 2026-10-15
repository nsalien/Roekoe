/**
 * De duivenlokker (core/game/lure.ts, LURE in gameConfig): a released bird may
 * fly to another player's lokker, who then decides whether to keep her.
 *
 * Bewaakt:
 *  - de kansen: hoger niveau = meer kans, gelijk niveau = gelijke kans, hoogstens
 *    bij één lokker, altijd een kans op "nergens"; de echte loting volgt ze;
 *  - kopen/opwaarderen: de prijzen van de eigenaar, tot niveau 5, niet in het rood;
 *  - vrijlaten: zonder lokker weg, met lokker in de wachtkamer van de vanger
 *    (origin `lokker`, klaar voor haar nieuwe hok), eigen lokker / bots / een duif
 *    op een veiling doen niet mee, en beide spelers krijgen hun bel;
 *  - beslissen: houden (ook na plaats maken in een vol hok) of laten gaan, en wie
 *    vrijliet hoort de afloop;
 *  - de rondrit door D1 + de echte API (lokker kopen, wachtkamer met `from`, keuze);
 *  - wiki en spelregels noemen dezelfde kansen als de motor; de bel van v64.
 *
 * Run (vanuit de repo-root): npx tsx tests/duivenlokker.test.mts
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/[[path]].ts';
import { D1Store, ensureSchema } from '../core/d1.js';
import { signToken } from '../core/auth.js';
import { LURE, LURE_MAX_LEVEL, lureChances } from '../core/config/gameConfig.js';
import { createLoftForUser, releasePigeon, resolveBrood, seedWorld, sellToRestaurant, startBreeding } from '../core/game/engine.js';
import { advanceRealtime, runDataMigrations } from '../core/game/schedule.js';
import { buyLure, lureLevel, lureRivals, pickLure } from '../core/game/lure.js';
import { LURE_NEWS } from '../core/game/news.js';
import { hashString, seededRng } from '../core/game/util.js';
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Database, Loft, User } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// --- 1. de kansen ----------------------------------------------------------------
console.log('\nDe kansen (lureChances)');
{
  const none = lureChances([]);
  ok(none.each.length === 0 && none.none === 1, 'geen enkele lokker: de duif verdwijnt altijd');
  let rising = true, alwaysNone = true, sums = true;
  for (let l = 1; l <= LURE_MAX_LEVEL; l++) {
    const c = lureChances([l]);
    if (l > 1 && !(c.each[0] > lureChances([l - 1]).each[0])) rising = false;
    if (!(c.none > 0)) alwaysNone = false;
    if (!near(c.each[0] + c.none, 1)) sums = false;
  }
  ok(rising, 'elk hoger niveau geeft meer kans');
  ok(alwaysNone && lureChances(Array(12).fill(LURE_MAX_LEVEL)).none > 0, 'er blijft altijd een kans op "nergens", ook met 12 lokkers op niveau 5');
  ok(sums, 'de kansen tellen op tot 1');
  const eq = lureChances([3, 3]);
  ok(near(eq.each[0], eq.each[1]) && near(eq.each[0] * 2 + eq.none, 1), 'twee lokkers van hetzelfde niveau: evenveel kans, samen met "nergens" = 1');
  const mixed = lureChances([1, 5, 3, 2]);
  ok(mixed.each[1] > mixed.each[2] && mixed.each[2] > mixed.each[3] && mixed.each[3] > mixed.each[0], 'verschillende niveaus: het hoogste niveau heeft altijd de meeste kans');
  ok(near(lureChances([1]).each[0], 0.1), 'alleen op niveau 1: 10 %');
  ok(LURE.prices.join(',') === '500,750,1500,3000,5000', 'prijzen van de eigenaar: €500 · €750 · €1.500 · €3.000 · €5.000');
  ok(LURE_MAX_LEVEL === 5, 'tot niveau 5');
}

// --- 2. een wereld in het geheugen --------------------------------------------------
const store = new MemoryStore(emptyDatabase());
seedWorld(store);
const db = store.data;
function player(name: string): Loft {
  const u: User = { id: `usr_${name}`, username: name, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((d) => d.users.push(u));
  const loft = createLoftForUser(store, u, `Hok ${name[0].toUpperCase()}${name.slice(1)}`);
  loft.money = 50_000;
  loft.capacity = 12;
  return loft;
}
const A = player('anna'); // laat vrij
const B = player('bert'); // heeft een lokker
const C = player('chris'); // soms ook
const mine = (w: Database, l: Loft) => w.pigeons.filter((p) => p.ownerId === l.userId);
// Anna laat veel duiven vrij: geef haar er genoeg (kopieën met een eigen id en naam).
{
  const template = mine(db, A)[0];
  for (let i = 0; i < 10; i++) db.pigeons.push({ ...template, id: newId('pig'), name: `Reserve ${i + 1}` });
}
const bells = (l: Loft) => db.notifications.filter((n) => n.userId === l.userId);
const lastBell = (l: Loft) => bells(l).at(-1);

console.log('\nKopen en opwaarderen');
{
  const before = B.money;
  ok(buyLure(store, B.userId) === null && lureLevel(B) === 1 && B.money === before - 500, 'kopen = niveau 1 voor €500');
  let paid = 500;
  for (let l = 2; l <= LURE_MAX_LEVEL; l++) { ok(buyLure(store, B.userId) === null && lureLevel(B) === l, `niveau ${l}`); paid += LURE.prices[l - 1]; }
  ok(B.money === before - paid && paid === 10_750, `samen €${paid} (€10.750)`);
  ok(buyLure(store, B.userId) !== null && lureLevel(B) === LURE_MAX_LEVEL, 'niet verder dan niveau 5');
  C.money = 400;
  ok(buyLure(store, C.userId) !== null && lureLevel(C) === 0 && C.money === 400, 'niet genoeg geld: geweigerd, niets betaald');
  C.money = -10;
  ok(buyLure(store, C.userId) !== null && lureLevel(C) === 0, 'in het rood: geweigerd');
  C.money = 50_000;
  const bot = db.lofts.find((l) => l.isBot)!;
  ok(buyLure(store, bot.userId) !== null && lureLevel(bot) === 0, 'een computermelker koopt er geen');
  ok(B.equipment?.hygiene === 50, 'de rest van de inrichting blijft zoals ze was (hygiëne 50)');
}

console.log('\nVrijlaten zonder vangst');
{
  const bird = mine(db, A)[0];
  ok(releasePigeon(store, A.userId, bird.id, () => 0.9999) === null, 'vrijgelaten');
  ok(!db.pigeons.some((p) => p.id === bird.id), 'ze is uit het spel');
  ok(!db.lofts.some((l) => (l.pendingBroods ?? []).some((b) => b.young.some((y) => y.id === bird.id))), 'en wacht nergens');
  ok(/voorgoed weg/.test(lastBell(A)?.body ?? ''), 'wie vrijliet hoort dat ze voorgoed weg is');
}

console.log('\nVrijlaten en gevangen');
const caughtBird = mine(db, A)[0];
{
  caughtBird.forSale = true; caughtBird.price = 999; caughtBird.coached = true; caughtBird.compartment = true;
  caughtBird.inInfirmary = true; caughtBird.cureUntil = new Date(Date.now() + 3600e3).toISOString();
  caughtBird.care = { insurance: { payout: 100, premium: 1, since: new Date().toISOString() } as any, vaccines: { pmv: new Date(Date.now() + 86400e3).toISOString() } };
  caughtBird.stud = { by: A.userId, minScore: 0, minEnergy: 0, minLibido: 0, wants: 'fee', at: new Date().toISOString() };
  const bBells = bells(B).length;
  ok(releasePigeon(store, A.userId, caughtBird.id, () => 0) === null, 'vrijgelaten');
  ok(!db.pigeons.some((p) => p.id === caughtBird.id), 'ze zit niet meer in het spel tot iemand beslist');
  const nest = (B.pendingBroods ?? []).find((b) => b.young[0]?.id === caughtBird.id);
  ok(!!nest && nest.origin === 'lokker', 'ze wacht in de wachtkamer van de lokker (origin lokker)');
  ok(nest?.from?.userId === A.userId && nest?.from?.name === A.name, 'met wie haar vrijliet');
  const y = nest!.young[0];
  ok(y.ownerId === B.userId, 'klaar voor haar nieuwe hok');
  ok(!y.forSale && y.price === null && !y.coached && !y.compartment && !y.inInfirmary && !y.cureUntil, 'geen zoekertje, coach, apart hok, ziekenboeg of rustkuur van het oude hok');
  ok(!y.care?.insurance && !y.stud, 'geen verzekering of kweekaanbod van het oude hok');
  ok(!!y.care?.vaccines?.pmv, 'haar vaccin blijft (dat zit in de duif)');
  ok(bells(B).length === bBells + 1 && /duivenlokker/.test(lastBell(B)!.title) && lastBell(B)!.body.includes(A.name), 'de vanger krijgt een bel, met de naam van wie vrijliet');
  ok(lastBell(A)!.body.includes(B.name), 'wie vrijliet hoort meteen bij wie ze landde');
}

console.log('\nWie niet meedoet');
{
  // Enkel A heeft (tijdelijk) een lokker: haar eigen duif vangt ze nooit.
  const saved = B.equipment!.lure;
  B.equipment!.lure = 0;
  A.equipment = { ...(A.equipment ?? { hygiene: 50, lastStrawAt: null, cleaner: false }), lure: 5 };
  ok(lureRivals(db, A.userId).length === 0, 'je eigen lokker telt niet mee als je zelf vrijlaat');
  const own = mine(db, A)[0];
  releasePigeon(store, A.userId, own.id, () => 0);
  ok(!db.lofts.some((l) => (l.pendingBroods ?? []).some((b) => b.young.some((x) => x.id === own.id))), 'een eigen duif belandt nooit in je eigen lokker');
  A.equipment!.lure = 0;
  // Een bot met een lokker (kan niet via de knop, wel in de data) doet niet mee.
  const bot = db.lofts.find((l) => l.isBot)!;
  bot.equipment = { hygiene: 50, lastStrawAt: null, cleaner: false, lure: 5 };
  ok(!lureRivals(db, A.userId).some((r) => r.loft.userId === bot.userId), 'een bot met een lokker doet niet mee');
  bot.equipment.lure = 0;
  B.equipment!.lure = saved;
  // Een duif op een open veiling wordt niet gelokt.
  const lot = mine(db, A)[0];
  db.auctions.push({ id: 'auc_test', templateKey: 'forced', pigeonId: lot.id, startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600e3).toISOString(), minBid: 25, minIncrement: 5, currentBid: 0, currentBidderId: null, currentBidderName: null, status: 'open', bids: [] } as any);
  releasePigeon(store, A.userId, lot.id, () => 0);
  ok(!(B.pendingBroods ?? []).some((b) => b.young[0]?.id === lot.id), 'een duif op een veiling wordt niet gelokt');
  db.auctions = db.auctions.filter((a) => a.id !== 'auc_test');
  // Het restaurant: soep, geen lokker.
  const soup = mine(db, A)[0];
  const n = (B.pendingBroods ?? []).length;
  ok(sellToRestaurant(store, A.userId, soup.id) === null && (B.pendingBroods ?? []).length === n, 'een duif voor het restaurant wordt niet gelokt');
}

console.log('\nDe loting volgt de kansen');
{
  B.equipment!.lure = 5;
  C.equipment = { hygiene: 50, lastStrawAt: null, cleaner: false, lure: 1 };
  const rivals = lureRivals(db, A.userId);
  const want = lureChances(rivals.map((r) => r.level));
  const rng = seededRng(hashString('lokker-loting'));
  const N = 40_000;
  const hits = new Map<string, number>();
  for (let i = 0; i < N; i++) { const to = pickLure(rivals, rng); const k = to?.userId ?? 'nergens'; hits.set(k, (hits.get(k) ?? 0) + 1); }
  rivals.forEach((r, i) => ok(Math.abs((hits.get(r.loft.userId) ?? 0) / N - want.each[i]) < 0.01, `${r.loft.name} (niveau ${r.level}): ${(100 * (hits.get(r.loft.userId) ?? 0) / N).toFixed(1)} % ≈ ${(100 * want.each[i]).toFixed(1)} %`));
  ok(Math.abs((hits.get('nergens') ?? 0) / N - want.none) < 0.01, `nergens: ${(100 * (hits.get('nergens') ?? 0) / N).toFixed(1)} % ≈ ${(100 * want.none).toFixed(1)} %`);
  C.equipment.lure = 0;
}

console.log('\nBeslissen: houden');
{
  const nest = B.pendingBroods.find((b) => b.young[0]?.id === caughtBird.id)!;
  const before = mine(db, B).length;
  ok(resolveBrood(store, B.userId, nest.id, [caughtBird.id]) === null, 'gehouden');
  ok(mine(db, B).length === before + 1 && db.pigeons.find((p) => p.id === caughtBird.id)?.ownerId === B.userId, 'ze zit in het hok van de vanger');
  ok(!B.pendingBroods.some((b) => b.id === nest.id), 'de wachtkamer is leeg');
  ok(/blijft bij/.test(lastBell(A)!.title) && lastBell(A)!.title.includes(B.name), 'wie vrijliet hoort dat ze bleef');
}

console.log('\nBeslissen: laten gaan');
{
  const bird = mine(db, A)[0];
  releasePigeon(store, A.userId, bird.id, () => 0);
  const nest = B.pendingBroods.find((b) => b.young[0]?.id === bird.id)!;
  ok(!!nest, 'gevangen');
  ok(resolveBrood(store, B.userId, nest.id, []) === null, 'laten gaan');
  ok(!db.pigeons.some((p) => p.id === bird.id) && !db.lofts.some((l) => (l.pendingBroods ?? []).some((b) => b.young.some((x) => x.id === bird.id))), 'ze is voorgoed uit het spel');
  ok(/voorgoed weg/.test(lastBell(A)!.title), 'wie vrijliet hoort dat ze voorgoed weg is');
  ok(/voorgoed uit het spel/.test(lastBell(B)!.body), 'de vanger ook');
}

console.log('\nEen vol hok: eerst plaats maken');
{
  // Vul het hok van B tot de nok.
  while (mine(db, B).length < B.capacity) {
    const extra = { ...mine(db, B)[0], id: newId('pig'), name: `Vuller ${mine(db, B).length}` };
    db.pigeons.push(extra);
  }
  const bird = mine(db, A)[0];
  releasePigeon(store, A.userId, bird.id, () => 0);
  const nest = B.pendingBroods.find((b) => b.young[0]?.id === bird.id)!;
  ok(!!nest, 'gevangen, ook met een vol hok');
  ok(resolveBrood(store, B.userId, nest.id, [bird.id]) !== null, 'houden in een vol hok wordt geweigerd');
  const spare = mine(db, B).find((p) => p.name.startsWith('Vuller'))!;
  ok(releasePigeon(store, B.userId, spare.id, () => 0.9999) === null, 'plaats gemaakt (een duif vrijgelaten)');
  ok(resolveBrood(store, B.userId, nest.id, [bird.id]) === null && db.pigeons.find((p) => p.id === bird.id)?.ownerId === B.userId, 'daarna mag ze blijven');
}

console.log('\nEen gevangen duif houdt het koppelformulier niet tegen');
{
  const bird = mine(db, A)[0];
  releasePigeon(store, A.userId, bird.id, () => 0);
  ok(B.pendingBroods.some((b) => b.origin === 'lokker'), 'er wacht een gevangen duif');
  const sire = mine(db, B).find((p) => p.sex === 'doffer');
  const dam = mine(db, B).find((p) => p.sex === 'duivin');
  if (sire && dam) {
    for (const p of [sire, dam]) { p.birthWeek = db.world.currentWeek - 60; p.form = 90; p.libido = 90; p.lastBredAt = null; p.ailment = null; }
    const err = startBreeding(store, B.userId, sire.id, dam.id);
    ok(!/wacht nog een nest/.test(err ?? ''), `geen "er wacht nog een nest" (${err ?? 'gestart'})`);
  } else ok(true, '(geen koppel in het hok — overgeslagen)');
}

// --- 3. de rondrit door D1 en de echte API ------------------------------------------
console.log('\nD1 + API');
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
  const ME = 'usr_lokker';
  const P2 = 'usr_loslater';
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
    for (const [id, name, hok] of [[ME, 'lokker', 'Hok Lokker'], [P2, 'loslater', 'Hok Loslater']] as const) {
      const user: User = { id, username: name, passwordHash: '!', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
      s.mutate((w) => w.users.push(user));
      const loft = createLoftForUser(s, user, hok);
      loft.money = 20_000;
    }
    await s.persist();
  }
  const SECRET = 'test-geheim';
  const token = await signToken({ sub: ME, username: 'lokker' }, SECRET, 3600);
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

  const st0 = await call('/state');
  const cat = st0.json.inrichting?.lure;
  ok(!!cat && cat.prices.join(',') === LURE.prices.join(',') && cat.max === LURE_MAX_LEVEL, '/state draagt de catalogus van de lokker (prijzen, niveau 5)');
  ok(cat?.effects?.[0]?.values?.[0] === '10 %' && cat.effects[0].values.length === LURE_MAX_LEVEL, 'en de kans per niveau voor de ⓘ ("10 %" op niveau 1)');
  ok(st0.json.loft?.equipment?.lure === 0, 'nog geen lokker');
  const buy = await call('/loft/lure', 'POST');
  ok(buy.status === 200, 'POST /loft/lure: gekocht');
  const second = await call('/loft/lure', 'POST');
  const st1 = await call('/state');
  ok(second.status === 200 && st1.json.loft?.equipment?.lure === 2 && st1.json.loft.money === st0.json.loft.money - 500 - 750,
    'na een tweede klik niveau 2, €1.250 betaald (bewaard in D1)');

  // De andere speler laat een duif vrij (via de motor, zoals een tweede browser).
  let birdId = '';
  {
    const s = await D1Store.load(d1, P2);
    birdId = s.data.pigeons.find((p) => p.ownerId === P2)!.id;
    ok(releasePigeon(s, P2, birdId, () => 0) === null, 'de andere speler laat een duif vrij');
    await s.persist();
  }
  const br = await call('/breeding');
  const nest = br.json.nests?.find((n: any) => n.origin === 'lokker');
  ok(!!nest && nest.from === 'Hok Loslater' && nest.young[0]?.id === birdId, 'GET /breeding: de gevangen duif wacht, met het hok dat haar vrijliet');
  ok(typeof nest?.young[0]?.ageWeeks === 'number' && typeof nest?.young[0]?.experience === 'number', 'met haar leeftijd en ervaring');
  const st2 = await call('/state');
  ok(st2.json.pendingNests >= 1, 'de teller op Kweek telt haar mee');
  const keep = await call(`/breeding/nest/${nest.id}`, 'POST', { keep: [birdId] });
  ok(keep.status === 200, 'POST /breeding/nest/:id: gehouden');
  const row = d1._raw.prepare('SELECT owner_id FROM pigeons WHERE id = ?').get(birdId) as any;
  ok(row?.owner_id === ME, 'in D1 is ze nu van de lokker');
  const told = d1._raw.prepare("SELECT title FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(P2) as any;
  ok(/blijft bij Hok Lokker/.test(told?.title ?? ''), 'wie vrijliet kreeg de bel in D1');
}

// --- 4. wiki, spelregels, bel ---------------------------------------------------------
console.log('\nWiki en spelregels noemen dezelfde kansen');
{
  const pct = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString('nl-BE')} %`;
  const wiki = readFileSync('./client/src/pages/WikiPage.tsx', 'utf8');
  const rules = readFileSync('./spelregels.md', 'utf8');
  let total = 0;
  for (let l = 1; l <= LURE_MAX_LEVEL; l++) {
    total += LURE.prices[l - 1];
    const eur = (n: number) => `€${n.toLocaleString('nl-BE')}`;
    const alone = pct(lureChances([l]).each[0]);
    const pair = pct(lureChances([l, l]).each[0]);
    ok(wiki.includes(`['${l}', '${eur(LURE.prices[l - 1])}', '${eur(total)}', '${alone}', '${pair}']`), `wiki niveau ${l}: ${eur(LURE.prices[l - 1])}, samen ${eur(total)}, ${alone} / ${pair}`);
    ok(rules.includes(`| ${l} | ${eur(LURE.prices[l - 1])} | ${eur(total)} | ${LURE.pull[l - 1]} | ${alone} | ${pair} |`), `spelregels niveau ${l}`);
  }
  ok(wiki.includes(`${LURE.pull.join(' / ')}`) && wiki.includes(`<strong>${LURE.freedom}</strong>`), 'wiki: trekkracht en vrije lucht');
  ok(rules.includes(`trekt met\n**${LURE.freedom}**`) || rules.includes(`**${LURE.freedom}**`), 'spelregels: de vrije lucht');
  const ex = lureChances([3, 1]);
  ok(wiki.includes(`jij ${pct(ex.each[0])}, de ander ${pct(ex.each[1])}, verdwenen ${pct(ex.none)}`), `wiki-voorbeeld niveau 3 naast 1 klopt (${pct(ex.each[0])} / ${pct(ex.each[1])} / ${pct(ex.none)})`);
}

console.log('\nDe bel van v64');
{
  db.notifications = db.notifications.filter((n) => n.title !== LURE_NEWS.title);
  db.world.dataVersion = 63;
  runDataMigrations(db);
  const humans = db.lofts.filter((l) => !l.isBot);
  const b = db.notifications.filter((n) => n.title === LURE_NEWS.title);
  ok(b.length === humans.length && humans.every((l) => b.some((n) => n.userId === l.userId && n.id === LURE_NEWS.id(l.userId))), 'één bel per echte speler, met een stabiele id');
  ok(b.every((n) => !db.lofts.find((l) => l.userId === n.userId)?.isBot), 'geen voor bots');
  ok((db.world.dataVersion ?? 0) >= 64, 'dataVersion staat op 64');
  db.world.dataVersion = 63;
  runDataMigrations(db);
  ok(db.notifications.filter((n) => n.title === LURE_NEWS.title).length === humans.length, 'een tweede run schrijft geen extra bel');
  for (const [word, what] of [['Inrichting → Uitrusting', 'waar je hem koopt'], [`€${LURE.prices[0]}`, 'de prijs uit LURE'], [`niveau ${LURE_MAX_LEVEL}`, 'het hoogste niveau'], ['Kweek', 'waar je kiest'], ['voorgoed weg', 'dat laten gaan definitief is'], ['restaurant', 'het alternatief']] as const) {
    ok(LURE_NEWS.body.includes(word), `de bel noemt ${what}`);
  }
}

console.log(`\n${pass} geslaagd, ${fail} mislukt`);
if (fail > 0) process.exit(1);
