/**
 * Samen kweken (core/game/stud.ts): breeding with another player's bird.
 *
 * Runs on a fresh world on node:sqlite (the bots, the flight calendar, one
 * player) and the real API, so the whole road is covered: a bot puts a bird up,
 * the player negotiates with it, the nest hatches and the fee changes hands. Then
 * a second human for the player-to-player rules, the empty clutch, stopping, the
 * infrarood that must not count, and the storage (the deals table is loaded only
 * on the Kweek routes, and an absent array must never delete its rows).
 *
 * Run from the repo root: npx tsx tests/samen-kweken.test.mts
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/[[path]].ts';
import { D1Store, ensureSchema } from '../core/d1.js';
import { signToken } from '../core/auth.js';
import { STUD, studFailedRefund } from '../core/config/gameConfig.js';
import { createLoftForUser, releasePigeon, resolveBrood, seedWorld, stopBreeding } from '../core/game/engine.js';
import { advanceRealtime, tickBreedingHatch } from '../core/game/schedule.js';
import { acceptStud, activeListing, botOfferStud, botYoungBid, breedBlock, closeStud, counterStud, offerBlock, proposeStud, setStudListing, studYoung, studYoungScore } from '../core/game/stud.js';
import { breed, expectedYoungScore } from '../core/game/breeding.js';
import { clearOwnerCare } from '../core/game/inrichting.js';
import { generatePigeon, talent } from '../core/game/pigeon.js';
import { hashString, seededRng } from '../core/game/util.js';
import { loftDTO } from '../core/presenters.js';
import type { Database, Pigeon, User } from '../core/schema.js';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
  else console.log(`  ✓ ${msg}`);
}

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

// --- a fresh world: what production does first, then one player ---------------
const ME = 'usr_demo';
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
  const user: User = { id: ME, username: 'demo', passwordHash: '!', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  s.mutate((w) => w.users.push(user));
  const loft = createLoftForUser(s, user, 'Hok De Demo');
  s.mutate((w) => {
    loft.money = 100_000;
    loft.capacity = 12;
    for (const p of w.pigeons.filter((x) => x.ownerId === ME)) {
      p.birthWeek = w.world.currentWeek - 60; // old enough to breed
      p.speed = p.endurance = p.orientation = 70;
      p.form = 80;
      p.libido = 80;
    }
    // The bots put a bird up (production: on the daily tick, after which they
    // enter the rest again) and keep her home. Their entries from the first run
    // come off first, or every good bird would be entered and none could be offered.
    const botIds = new Set(w.lofts.filter((x) => x.isBot).map((x) => x.userId));
    for (const f of w.flights) if (f.status === 'scheduled') f.entries = f.entries.filter((e) => !botIds.has(e.ownerId));
    for (const l of w.lofts.filter((x) => x.isBot)) botOfferStud(w, l, w.pigeons.filter((p) => p.ownerId === l.userId), Date.now());
    // The first rounds below are about a bot that wants the fee; the bots that
    // want the young (and that answer players' birds) get their own round.
    for (const p of w.pigeons) if (activeListing(p)) p.stud = { ...p.stud!, wants: 'fee' };
    const listed = new Set(w.pigeons.filter((p) => activeListing(p)).map((p) => p.id));
    for (const f of w.flights) if (f.status === 'scheduled') f.entries = f.entries.filter((e) => !listed.has(e.pigeonId));
  });
  await s.persist();
}

const SECRET = 'test-geheim';
const token = await signToken({ sub: ME, username: 'demo' }, SECRET, 3600);
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
const rows = (sql: string) => Number(Object.values(d1._raw.prepare(sql).get() ?? { n: 0 })[0]);
const money = (w: Database, id: string) => w.lofts.find((l) => l.userId === id)!.money;

/** A pair id whose clutch-count roll is fixed (breed() seeds it on the pair, see breeding-cooldown). */
function pairIdWhere(want: (firstRoll: number) => boolean): string {
  for (let i = 0; i < 20000; i++) {
    const id = `brd_stud_${i}`;
    if (want(seededRng(hashString(`clutch:${id}`))())) return id;
  }
  throw new Error('geen koppel-id gevonden');
}
const PAIR_HATCHES = pairIdWhere((r) => r < 0.05);
const PAIR_EMPTY = pairIdWhere((r) => r > 0.99);

/** Hatch exactly this pair now: the others are told they were just checked. */
function hatchOnly(w: Database, pairId: string, nowMs: number) {
  for (const bp of w.breedingPairs) bp.hatchAt = new Date(bp.id === pairId ? nowMs - 30 * 86400000 : nowMs).toISOString();
  const real = Math.random;
  let calls = 0;
  Math.random = () => (calls++ === 0 ? 0 : real()); // the hatch-now roll
  try { tickBreedingHatch(w, nowMs); } finally { Math.random = real; }
}

// ---------------------------------------------------------------------------
console.log('\nDe bots bieden een duif aan');
let view = (await call('/breeding')).json;
const botListings = (view.stud?.listings ?? []).filter((l: any) => l.ownerIsBot);
assert(botListings.length >= 1, `de bots bieden duiven aan (${botListings.length})`);
assert(botListings.every((l: any) => l.askFee >= STUD.botMinFee && l.askFee % 50 === 0), 'elke bot zegt wat hij vraagt (veelvoud van €50, minstens het minimum)');
const L = botListings.find((l: any) => !l.busy && l.candidates.length > 0);
assert(!!L, 'minstens één botduif is vrij én binnen bereik van de speler');
assert(L?.pigeon.revealed === true, 'een aangeboden duif is volledig te bekijken');
let w0 = (await D1Store.load(d1, ME)).data;
const mate = w0.pigeons.find((p) => L.candidates.some((c: any) => c.id === p.id) && !breedBlock(w0, p))!;
assert(!!mate, 'de speler heeft een vrije partner die aan de eisen voldoet');
assert(L.wants === 'fee', 'een bot wil de vergoeding: de jongen zijn voor de speler');
const cand = L.candidates.find((c: any) => c.id === mate.id);
assert(Math.abs(cand.youngScore - studYoungScore(w0, w0.pigeons.find((p) => p.id === L.pigeon.id)!, mate)) < 0.01 && cand.youngScore > 0,
  `wie een duif voorstelt, ziet vooraf de geschatte score van het jong (★${cand.youngScore})`);
const botId = L.pigeon.ownerId as string;
const studId = L.pigeon.id as string;

// ---------------------------------------------------------------------------
console.log('\nOnderhandelen met een bot');
let r = await call('/breeding/stud/propose', 'POST', { studId, mateId: mate.id, youngToMe: false, fee: 0 });
assert(r.status === 200, 'voorstel zonder vergoeding (wie de jongen krijgt, kan je niet meer kiezen)');
view = (await call('/breeding')).json;
let deal = view.stud.deals[0];
assert(view.stud.deals.length === 1 && deal.myTurn && deal.youngToMe && deal.fee === L.askFee,
  `de bot antwoordt meteen met zijn prijs: de jongen voor jou, voor €${L.askFee}`);
assert(deal.youngScore === cand.youngScore, 'de onderhandeling toont dezelfde geschatte score');
assert(cand.youngValue >= 50 && deal.youngValue === cand.youngValue,
  `…en de geschatte marktwaarde van zo'n jong bij de geboorte (€${cand.youngValue}), voor beide spelers`);
r = await call(`/breeding/stud/${deal.id}/counter`, 'POST', { fee: deal.fee });
assert(r.status === 400, 'een tegenvoorstel met hetzelfde bedrag wordt geweigerd');
r = await call(`/breeding/stud/${deal.id}/counter`, 'POST', { fee: Math.max(0, deal.fee - 50) });
view = (await call('/breeding')).json;
deal = view.stud.deals[0];
assert(r.status === 200 && deal.myTurn && deal.fee === L.askFee, 'afdingen: de bot blijft bij zijn prijs');
const before = (await D1Store.load(d1, ME)).data;
const myMoney0 = money(before, ME);
const botMoney0 = money(before, botId);
const studForm0 = before.pigeons.find((p) => p.id === studId)!.form;
r = await call(`/breeding/stud/${deal.id}/accept`, 'POST');
assert(r.status === 200, `akkoord (${r.json.error ?? 'ok'})`);
view = (await call('/breeding')).json;
let w = (await D1Store.load(d1, ME)).data;
const pair = w.breedingPairs.find((bp) => bp.deal);
assert(view.stud.deals.length === 0, 'de onderhandeling is afgesloten');
assert(!!pair && pair.ownerId === ME && pair.deal!.partnerId === botId && pair.deal!.fee === L.askFee,
  'het nest staat op naam van wie de jongen krijgt, met de bot als partner en de vergoeding');
assert(money(w, ME) === myMoney0 - STUD.cost && money(w, botId) === botMoney0 - STUD.cost,
  `elk betaalt €${STUD.cost} bij het akkoord; de vergoeding nog niet`);
assert(Math.abs(w.pigeons.find((p) => p.id === studId)!.form - (studForm0 - 15)) < 0.11, 'de botduif verliest 15 energie');
const shown = view.pairs.find((p: any) => p.id === pair?.id);
assert(shown?.deal?.youngToMe === true && shown?.deal?.partner === L.ownerName, 'het nest staat bij Kweek met de partner erbij');
{
  // Like an own nest: it does not hatch on the spot, and a check within the
  // quarter hour does not even roll (BREEDING.hatchCheckMinutes).
  const s = await D1Store.load(d1, ME);
  tickBreedingHatch(s.data, Date.now() + 5 * 60000);
  assert(s.data.breedingPairs.some((bp) => bp.id === pair!.id) && !s.data.pigeons.some((p) => p.id.startsWith(`pig_brood_${pair!.id}`)),
    'direct na het akkoord is er nog geen jong — het nest loopt als een gewoon nest');
}
const loftView = (await call('/state')).json.loft;
assert(loftView.nests.some((n: any) => n.id === pair?.id && n.partner === L.ownerName), 'het hokoverzicht noemt de andere speler');
const stillListed = view.stud.listings.find((l: any) => l.pigeon.id === studId);
assert(!!stillListed && /nest/.test(stillListed.busy ?? ''), 'de botduif blijft aangeboden, maar is nu bezet');

// ---------------------------------------------------------------------------
console.log('\nHet nest komt uit: de vergoeding gaat over');
{
  const s = await D1Store.load(d1, ME);
  const bp = s.data.breedingPairs.find((x) => x.id === pair!.id)!;
  bp.id = PAIR_HATCHES;
  const nowMs = Date.now();
  const mine0 = money(s.data, ME);
  const bot0 = money(s.data, botId);
  // A full loft: the young must wait for the player's choice, like any nest.
  const myLoft = s.data.lofts.find((l) => l.userId === ME)!;
  const capacity0 = myLoft.capacity;
  myLoft.capacity = s.data.pigeons.filter((p) => p.ownerId === ME).length;
  hatchOnly(s.data, PAIR_HATCHES, nowMs);
  const held = myLoft.pendingBroods ?? [];
  const nest = held.find((b) => b.sireId === bp.sireId && b.damId === bp.damId);
  const born = nest?.young.length ?? 0;
  assert(born >= 1 && !s.data.pigeons.some((p) => p.id.startsWith(`pig_brood_${PAIR_HATCHES}`)),
    `vol hok: de ${born} jong(en) wachten op de keuze van de speler in plaats van verloren te gaan`);
  assert(s.data.notifications.some((n) => n.userId === ME && /hok zit vol/.test(n.title)), '…met een bel die zegt dat het hok vol zit');
  // Make room first, then keep them.
  const spare = s.data.pigeons.filter((p) => p.ownerId === ME && !breedBlock(s.data, p) && p.id !== mate.id).slice(0, born);
  for (const p of spare) assert(releasePigeon(s, ME, p.id) === null, `plaats gemaakt: ${p.name} vrijgelaten`);
  assert(resolveBrood(s, ME, nest!.id, nest!.young.map((y) => y.id)) === null, 'daarna houdt de speler de jongen');
  myLoft.capacity = capacity0;
  const young = s.data.pigeons.filter((p) => p.id.startsWith(`pig_brood_${PAIR_HATCHES}`));
  assert(young.length === born && young.every((y) => y.ownerId === ME), 'alle jongen gaan naar wie ze kreeg');
  assert(money(s.data, ME) === mine0 - L.askFee && money(s.data, botId) === bot0 + L.askFee,
    `de €${L.askFee} gaat bij de geboorte van de ene naar de andere`);
  assert(!s.data.breedingPairs.some((x) => x.id === PAIR_HATCHES), 'het nest is voorbij');
  assert(!!s.data.pigeons.find((p) => p.id === studId)?.lastBredAt && !!s.data.pigeons.find((p) => p.id === mate.id)?.lastBredAt,
    'beide ouders rusten daarna, ook de duif van de andere speler');
  await s.persist();
}

// ---------------------------------------------------------------------------
console.log('\nTussen twee spelers');
const P2 = 'usr_tweede';
{
  const s = await D1Store.load(d1, ME, { studDeals: true });
  s.mutate((x) => x.users.push({ id: P2, username: 'tweede', passwordHash: '!', isAdmin: false, isBot: false, createdAt: new Date().toISOString() }));
  const loft = createLoftForUser(s, s.data.users.find((u) => u.id === P2)!, 'Hok Twee');
  s.mutate((x) => {
    loft.money = 50_000;
    loft.capacity = 12;
    // Player against player here: the bots take their birds off offer, so they do
    // not answer P2's bird (that is the round "Bots stellen zelf voor" below).
    for (const p of x.pigeons) if (x.lofts.find((l) => l.userId === p.ownerId)?.isBot) p.stud = null;
    for (const [owner, sex] of [[P2, 'doffer'], [P2, 'doffer'], [P2, 'duivin'], [ME, 'duivin'], [ME, 'duivin'], [ME, 'doffer']] as const) {
      const p = generatePigeon({ ownerId: owner, currentWeek: x.world.currentWeek, quality: 0.6, sex });
      p.birthWeek = x.world.currentWeek - 60;
      p.form = 80; p.libido = 80;
      x.pigeons.push(p);
    }
  });
  await s.persist();
}
w = (await D1Store.load(d1, ME, { studDeals: true })).data;
const p2doffer = w.pigeons.find((p) => p.ownerId === P2 && p.sex === 'doffer' && !breedBlock(w, p))!;
const myDuivin = w.pigeons
  .filter((p) => p.ownerId === ME && p.sex === 'duivin' && !breedBlock(w, p))
  .sort((a, b) => talent(b) - talent(a))[0];
const myDoffer = w.pigeons.find((p) => p.ownerId === ME && p.sex === 'doffer')!;
assert(!!p2doffer && !!myDuivin, 'twee spelers met een vrije doffer en duivin');
{
  const s = await D1Store.load(d1, P2, { studDeals: true });
  const x = s.data;
  assert(/jongen wil of de vergoeding/.test(setStudListing(x, P2, p2doffer.id, { minScore: 0, minEnergy: 0, minLibido: 0 } as any) ?? ''),
    'aanbieden zonder te kiezen tussen de jongen en de vergoeding kan niet');
  assert(setStudListing(x, P2, p2doffer.id, { minScore: 101, minEnergy: 0, minLibido: 0, wants: 'young' }) !== null, 'een eis boven 100 kan niet');
  assert(setStudListing(x, P2, p2doffer.id, { minScore: Math.floor(talent(myDuivin)) + 1, minEnergy: 0, minLibido: 0, wants: 'young' }) === null,
    'de tweede speler biedt zijn doffer aan en wil zelf de jongen');
  const mineDuivin = x.pigeons.find((p) => p.id === myDuivin.id)!;
  assert(/score/.test(proposeStud(x, ME, p2doffer.id, myDuivin.id, 300) ?? ''), 'een duif die de score niet haalt, mag niet voorgesteld worden');
  // Sick or injured: not to be put up, not to be offered.
  const sickDoffer = x.pigeons.find((p) => p.ownerId === P2 && p.sex === 'doffer' && p.id !== p2doffer.id)!;
  sickDoffer.ailment = { kind: 'ziekte', name: 'Ornithose', severity: 'licht', weeksLeft: 1 } as any;
  assert(/ziek/.test(setStudListing(x, P2, sickDoffer.id, { minScore: 0, minEnergy: 0, minLibido: 0, wants: 'fee' }) ?? ''),
    'een zieke duif kan niet aangeboden worden');
  sickDoffer.ailment = null;
  mineDuivin.ailment = { kind: 'kwetsuur', name: 'Spierscheur', severity: 'licht', weeksLeft: 1 } as any;
  setStudListing(x, P2, p2doffer.id, { minScore: 0, minEnergy: 0, minLibido: 0, wants: 'young' });
  assert(/gekwetst/.test(proposeStud(x, ME, p2doffer.id, myDuivin.id, 300) ?? ''), 'een gekwetste duif kan niet voorgesteld worden');
  mineDuivin.ailment = null;
  // Entered for a flight: not to be put up, not to be offered.
  const flight = x.flights.find((f) => f.status === 'scheduled')!;
  flight.entries.push({ pigeonId: sickDoffer.id, ownerId: P2 } as any);
  assert(/ingeschreven/.test(setStudListing(x, P2, sickDoffer.id, { minScore: 0, minEnergy: 0, minLibido: 0, wants: 'fee' }) ?? ''),
    'een ingeschreven duif kan niet aangeboden worden');
  flight.entries.push({ pigeonId: mineDuivin.id, ownerId: ME } as any);
  assert(/ingeschreven/.test(proposeStud(x, ME, p2doffer.id, myDuivin.id, 300) ?? ''), 'een ingeschreven duif kan niet voorgesteld worden');
  flight.entries = flight.entries.filter((e) => e.pigeonId !== sickDoffer.id && e.pigeonId !== mineDuivin.id);
  setStudListing(x, P2, p2doffer.id, { minScore: Math.floor(talent(mineDuivin)), minEnergy: 20, minLibido: 0, wants: 'young' });
  assert(/eigen/.test(proposeStud(x, P2, p2doffer.id, p2doffer.id, 0) ?? ''), 'je eigen duif kan je niet beantwoorden');
  assert(/kies een duivin/.test(proposeStud(x, ME, p2doffer.id, myDoffer.id, 0) ?? ''), 'twee doffers kan niet');
  assert(proposeStud(x, ME, p2doffer.id, myDuivin.id, 500) === null, 'voorstel: hij betaalt mij €500');
  const d = x.studDeals!.find((dd) => dd.studId === p2doffer.id)!;
  assert(d.youngTo === P2, 'de jongen gaan naar wie ze bij het aanbieden koos');
  assert(d.turn === P2, 'de eigenaar van de aangeboden duif is aan de beurt');
  const est = Math.round(studYoungScore(x, x.pigeons.find((p) => p.id === p2doffer.id)!, mineDuivin));
  assert(x.notifications.some((n) => n.userId === P2 && /Kweekvoorstel/.test(n.title) && n.body.includes(`naar schatting ★${est}`)),
    `hij krijgt er een bel van, met de geschatte score van het jong (★${est})`);
  assert(/wacht/.test(acceptStud(x, ME, d.id) ?? ''), 'je eigen voorstel aanvaarden kan niet: je wacht op de ander');
  assert(counterStud(x, P2, d.id, 300) === null, 'tegenvoorstel: €300');
  assert(d.turn === ME && d.youngTo === P2 && d.fee === 300, 'nu is de demospeler aan de beurt; enkel het bedrag veranderde');
  assert(/wacht/.test(counterStud(x, P2, d.id, 250) ?? ''), 'twee keer na elkaar bieden kan niet');
  await s.persist();
}
{
  // The next request loads the deal back from the table.
  const s = await D1Store.load(d1, ME, { studDeals: true });
  const x = s.data;
  assert(x.studDeals?.length === 1 && x.studDeals[0].fee === 300, 'de onderhandeling staat in de databank');
  const p2Money = money(x, P2);
  const myMoney = money(x, ME);
  assert(acceptStud(x, ME, x.studDeals[0].id) === null, 'de demospeler gaat akkoord');
  const bp = x.breedingPairs.find((b) => b.deal && b.ownerId === P2)!;
  assert(!!bp && bp.sireId === p2doffer.id && bp.damId === myDuivin.id, 'doffer en duivin staan juist op het nest');
  assert(money(x, P2) === p2Money - STUD.cost && money(x, ME) === myMoney - STUD.cost, 'elk betaalde €1.000');
  assert(x.notifications.some((n) => n.userId === P2 && /Akkoord/.test(n.title)), 'de andere speler hoort het');

  console.log('\nLege worp: niemand betaalt de vergoeding, elk krijgt de helft terug');
  bp.id = PAIR_EMPTY;
  hatchOnly(x, PAIR_EMPTY, Date.now());
  assert(!x.pigeons.some((p) => p.id.startsWith(`pig_brood_${PAIR_EMPTY}`)), 'geen jongen');
  assert(money(x, P2) === p2Money - STUD.cost + studFailedRefund() && money(x, ME) === myMoney - STUD.cost + studFailedRefund(),
    `elk krijgt €${studFailedRefund()} terug, en de €300 vergoeding blijft liggen`);
  assert(x.notifications.some((n) => n.userId === ME && n.id === `ntf:brood:${PAIR_EMPTY}:partner`), 'de partner krijgt een eigen bel, met een vast id');
  assert(!x.pigeons.find((p) => p.id === myDuivin.id)?.lastBredAt, 'een lege worp legt geen rust op');
  await s.persist();
}

// ---------------------------------------------------------------------------
console.log('\nStoppen, intrekken en vervallen');
{
  const s = await D1Store.load(d1, ME, { studDeals: true });
  const x = s.data;
  // A fresh deal, accepted by the owner of the doffer this time.
  assert(proposeStud(x, ME, p2doffer.id, myDuivin.id, 0) === null, 'nieuw voorstel');
  const d = x.studDeals![0];
  assert(acceptStud(x, P2, d.id) === null, 'akkoord');
  const bp = x.breedingPairs.find((b) => b.deal && b.ownerId === P2)!;
  const m0 = money(x, ME);
  const p0 = money(x, P2);
  assert(stopBreeding(s, ME, bp.id) === null, 'de partner mag het nest ook stoppen');
  assert(!x.breedingPairs.some((b) => b.id === bp.id) && money(x, ME) === m0 && money(x, P2) === p0, 'gestopt: niemand krijgt iets terug');
  assert(x.notifications.some((n) => n.userId === P2 && /gestopt/.test(n.title)), 'de andere speler hoort het');

  // Withdrawing / declining.
  assert(proposeStud(x, ME, p2doffer.id, myDuivin.id, 100) === null, 'weer een voorstel');
  assert(closeStud(x, P2, x.studDeals![0].id) === null && x.studDeals!.length === 0, 'geweigerd: weg');
  // Changing your mind about the young ends what was being negotiated about them.
  assert(proposeStud(x, ME, p2doffer.id, myDuivin.id, 100) === null, 'nog een voorstel');
  const notes0 = x.notifications.filter((n) => n.userId === ME && /vervallen/.test(n.title)).length;
  assert(setStudListing(x, P2, p2doffer.id, { minScore: 0, minEnergy: 0, minLibido: 0, wants: 'young' }) === null && x.studDeals!.length === 1,
    'enkel de eisen aanpassen laat het voorstel staan');
  assert(setStudListing(x, P2, p2doffer.id, { minScore: 0, minEnergy: 0, minLibido: 0, wants: 'fee' }) === null && x.studDeals!.length === 0,
    'nu toch de vergoeding willen: het voorstel vervalt');
  assert(x.notifications.filter((n) => n.userId === ME && /vervallen/.test(n.title)).length === notes0 + 1, '…en de voorsteller hoort het');
  assert(proposeStud(x, ME, p2doffer.id, myDuivin.id, 100) === null && x.studDeals![0].youngTo === ME, 'een nieuw voorstel: nu gaan de jongen naar mij');
  // Unlisting ends what is still open, and tells the proposer.
  assert(setStudListing(x, P2, p2doffer.id, null) === null && x.studDeals!.length === 0, 'niet meer aangeboden: de voorstellen vervallen');
  assert(x.notifications.some((n) => n.userId === ME && /vervallen/.test(n.title)), 'de voorsteller krijgt een bel');
  // A sale voids the listing: the new owner did not put her up.
  setStudListing(x, P2, p2doffer.id, { minScore: 0, minEnergy: 0, minLibido: 0, wants: 'fee' });
  assert(proposeStud(x, ME, p2doffer.id, myDuivin.id, 100) === null, 'voorstel op de weer aangeboden doffer');
  const doffer = x.pigeons.find((p) => p.id === p2doffer.id)!;
  clearOwnerCare(doffer);
  doffer.ownerId = 'usr_iemand_anders';
  assert(!activeListing(doffer), 'verkocht: niet meer aangeboden');
  assert(/niet \(meer\)/.test(proposeStud(x, ME, p2doffer.id, myDuivin.id, 0) ?? '') && x.studDeals!.length === 0,
    'en het lopende voorstel valt weg');
  doffer.ownerId = P2;
  await s.persist();
}

// ---------------------------------------------------------------------------
console.log('\nInfrarood telt niet');
{
  const s = await D1Store.load(d1, ME, { studDeals: true });
  const x = s.data;
  setStudListing(x, P2, p2doffer.id, { minScore: 0, minEnergy: 0, minLibido: 0, wants: 'fee' });
  proposeStud(x, ME, p2doffer.id, myDuivin.id, 0);
  acceptStud(x, P2, x.studDeals![0].id);
  const loft = x.lofts.find((l) => l.userId === ME)!;
  loft.equipment = { ...(loft.equipment ?? { hygiene: 50, lastStrawAt: null, cleaner: false }), irBoxes: 2 };
  const own = x.breedingPairs.filter((b) => b.ownerId === ME && !b.deal).length;
  assert(x.breedingPairs.some((b) => b.ownerId === ME && b.deal), 'een samen-kweken-nest op naam van de demospeler');
  assert(loftDTO(x, loft).equipment.irInUse === Math.min(2, own), `de nestbakken gaan enkel naar eigen nesten (${own})`);
  await s.persist();
}

// ---------------------------------------------------------------------------
console.log('\nOpslag');
{
  const count = rows('SELECT COUNT(*) FROM stud_deals');
  const s = await D1Store.load(d1, P2, { studDeals: true });
  setStudListing(s.data, P2, p2doffer.id, { minScore: 0, minEnergy: 0, minLibido: 0, wants: 'fee' });
  // A grown, healthy duivin that is free — not the youngster that hatched above.
  const other = s.data.pigeons.find((p: Pigeon) =>
    p.ownerId === ME && p.sex === 'duivin' && p.id !== myDuivin.id && !p.id.startsWith('pig_brood_') &&
    !breedBlock(s.data, p) && !offerBlock(s.data, p))!;
  assert(proposeStud(s.data, ME, p2doffer.id, other.id, 50) === null, 'een open voorstel');
  await s.persist();
  assert(rows('SELECT COUNT(*) FROM stud_deals') === count + 1, 'staat als rij in stud_deals');
  const plain = await D1Store.load(d1, P2);
  assert(plain.data.studDeals === undefined, 'een gewoon verzoek laadt de onderhandelingen niet');
  plain.data.lofts.find((l) => l.userId === P2)!.money += 1;
  await plain.persist();
  assert(rows('SELECT COUNT(*) FROM stud_deals') === count + 1, '…en wist ze dus ook niet bij het wegschrijven');
  const listed = rows(`SELECT COUNT(*) FROM pigeons WHERE stud != ''`);
  assert(listed >= 1, `het aanbod staat op de duif zelf (${listed} duiven)`);
  const st = (await call('/state')).json;
  assert(st.pigeons.every((p: any) => 'stud' in p), '/state kent het aanbod per duif');

  console.log('\nAangeboden of voorgesteld = thuis: niet inschrijven');
  const w2 = (await D1Store.load(d1, ME)).data;
  const flight = w2.flights.find((f) => f.status === 'scheduled' && !f.relay && !f.titan)!;
  let r2 = await call(`/flights/${flight.id}/enter`, 'POST', { pigeonId: other.id });
  assert(r2.status === 400 && /voorgesteld/.test(r2.json.error ?? ''), `een voorgestelde duif kan niet ingeschreven worden ("${r2.json.error}")`);
  const free = w2.pigeons.find((p: Pigeon) => p.ownerId === ME && !activeListing(p) && !breedBlock(w2, p) && p.id !== other.id)!;
  r2 = await call('/breeding/stud/list', 'POST', { pigeonId: free.id, minScore: 0, minEnergy: 0, minLibido: 0, wants: 'fee' });
  assert(r2.status === 200, 'de speler biedt zelf een duif aan');
  r2 = await call(`/flights/${flight.id}/enter`, 'POST', { pigeonId: free.id });
  assert(r2.status === 400 && /aangeboden/.test(r2.json.error ?? ''), `een aangeboden duif kan niet ingeschreven worden ("${r2.json.error}")`);
  r2 = await call('/breeding/stud/unlist', 'POST', { pigeonId: free.id });
  r2 = await call(`/flights/${flight.id}/enter`, 'POST', { pigeonId: free.id });
  assert(!/aangeboden|voorgesteld/.test(r2.json.error ?? ''), `uit het aanbod gehaald: het kweken houdt haar niet meer tegen (${r2.status})`);
}

// ---------------------------------------------------------------------------
console.log('\nBots stellen zelf voor, en willen soms de jongen');
{
  // Give the bots room and money, and make sure there is a free bot bird of each sex on offer.
  let st = await D1Store.load(d1, ME, { studDeals: true });
  const x = st.data;
  for (const l of x.lofts.filter((l) => l.isBot)) { l.capacity = 12; l.money = 60_000; }
  for (const sex of ['doffer', 'duivin'] as const) {
    if (x.pigeons.some((p) => p.sex === sex && activeListing(p) && x.lofts.find((l) => l.userId === p.ownerId)?.isBot && !breedBlock(x, p))) continue;
    const bird = x.pigeons.find((p) => p.sex === sex && x.lofts.find((l) => l.userId === p.ownerId)?.isBot &&
      !x.pigeons.some((q) => q.ownerId === p.ownerId && activeListing(q)) && !breedBlock(x, p) && !offerBlock(x, p));
    if (bird) bird.stud = { by: bird.ownerId, minScore: 0, minEnergy: 0, minLibido: 0, wants: 'fee', at: new Date().toISOString() };
  }
  // The player's birds are in good shape (one hatched and was released above).
  for (const p of x.pigeons.filter((p) => p.ownerId === ME)) { p.form = 80; p.libido = 80; }
  await st.persist();

  // 1. The player puts a bird up and wants the FEE: bots that fit answer at once, keeping the young.
  const w3 = (await D1Store.load(d1, ME)).data;
  const mine = w3.pigeons.find((p) => p.ownerId === ME && !activeListing(p) && !breedBlock(w3, p) && !offerBlock(w3, p) &&
    w3.pigeons.some((b) => b.sex !== p.sex && activeListing(b) && w3.lofts.find((l) => l.userId === b.ownerId)?.isBot && !breedBlock(w3, b)))!;
  assert(!!mine, 'de speler heeft een vrije duif waar een botduif bij past');
  let r = await call('/breeding/stud/list', 'POST', { pigeonId: mine.id, minScore: 0, minEnergy: 0, minLibido: 0, wants: 'fee' });
  let v = (await call('/breeding')).json.stud;
  let botDeals = v.deals.filter((d: any) => d.role === 'stud' && d.stud.id === mine.id && d.otherIsBot);
  assert(r.status === 200 && botDeals.length >= 1 && botDeals.length <= STUD.botMaxProposals,
    `meteen ${botDeals.length} voorstel(len) van bots (hoogstens ${STUD.botMaxProposals})`);
  const bd = botDeals[0];
  assert(bd.myTurn && !bd.youngToMe && bd.fee === botYoungBid(bd.youngValue).offer,
    `de bot wil de jongen en biedt ${STUD.botBidShare * 100} % van hun geschatte waarde (€${bd.fee} van €${bd.youngValue})`);
  const max = botYoungBid(bd.youngValue).max;
  r = await call(`/breeding/stud/${bd.id}/counter`, 'POST', { fee: max + 500 });
  v = (await call('/breeding')).json.stud;
  let again = v.deals.find((d: any) => d.id === bd.id);
  assert(again?.myTurn && again.fee === max, `te veel gevraagd: de bot antwoordt met zijn maximum (€${max})`);
  const botLoftId = w3.pigeons.find((p) => p.id === bd.mate.id)!.ownerId;
  const before3 = (await D1Store.load(d1, ME)).data;
  r = await call(`/breeding/stud/${bd.id}/counter`, 'POST', { fee: max - 50 >= 0 ? max - 50 : 0 });
  const after3 = (await D1Store.load(d1, ME)).data;
  const pair3 = after3.breedingPairs.find((b) => b.deal && (b.sireId === mine.id || b.damId === mine.id));
  assert(!!pair3 && pair3.ownerId === botLoftId && pair3.deal!.partnerId === ME,
    'binnen zijn maximum: de bot gaat meteen akkoord, het nest staat op naam van de bot');
  assert(money(after3, botLoftId) === money(before3, botLoftId) - STUD.cost && money(after3, ME) === money(before3, ME) - STUD.cost,
    'elk betaalt €1.000');
  // Each bot answers an offer once, also after it was turned down.
  const others = (await call('/breeding')).json.stud.deals.filter((d: any) => d.stud.id === mine.id);
  assert(others.length === 0, 'de andere botvoorstellen vervallen nu de duif op een nest zit');
  st = await D1Store.load(d1, ME, { studDeals: true });
  const askedNow = activeListing(st.data.pigeons.find((p) => p.id === mine.id))?.asked ?? [];
  assert(askedNow.includes(botLoftId), 'het aanbod onthoudt welke bots al antwoordden');

  // 2. A bird the player puts up and wants the YOUNG for: the bot asks its fee.
  const w4 = st.data;
  const mine2 = w4.pigeons.find((p) => p.ownerId === ME && !activeListing(p) && !breedBlock(w4, p) && !offerBlock(w4, p) &&
    w4.pigeons.some((b) => b.sex !== p.sex && activeListing(b) && w4.lofts.find((l) => l.userId === b.ownerId)?.isBot && !breedBlock(w4, b)));
  if (mine2) {
    assert(setStudListing(w4, ME, mine2.id, { minScore: 0, minEnergy: 0, minLibido: 0, wants: 'young' }) === null, 'een tweede duif, nu voor de jongen');
    const d2 = w4.studDeals!.find((d) => d.studId === mine2.id && w4.lofts.find((l) => l.userId === d.mateOwnerId)?.isBot);
    assert(!!d2 && d2.youngTo === ME && d2.fee >= STUD.botMinFee, `de bot stelt zijn duif voor en vraagt €${d2?.fee}`);
    const n = w4.studDeals!.length;
    setStudListing(w4, ME, mine2.id, { minScore: 0, minEnergy: 0, minLibido: 0, wants: 'young' });
    assert(w4.studDeals!.length === n, 'opnieuw opslaan: dezelfde bots stellen niet nog eens voor');
    await st.persist();
  } else {
    console.log('  (geen tweede passende duif in deze wereld — dat stuk overgeslagen)');
  }

  // 3. A bot that WANTS the young of its own bird: the player asks a fee, the bot pays at most its maximum.
  st = await D1Store.load(d1, ME, { studDeals: true });
  const y = st.data;
  const botStud = y.pigeons.find((p) => activeListing(p) && y.lofts.find((l) => l.userId === p.ownerId)?.isBot && !breedBlock(y, p) &&
    y.pigeons.some((m) => m.ownerId === ME && m.sex !== p.sex && !breedBlock(y, m) && !offerBlock(y, m) && !activeListing(m)));
  if (botStud) {
    botStud.stud = { ...botStud.stud!, wants: 'young', minScore: 0, minEnergy: 0, minLibido: 0 };
    const myBird = y.pigeons.find((m) => m.ownerId === ME && m.sex !== botStud.sex && !breedBlock(y, m) && !offerBlock(y, m) && !activeListing(m))!;
    const bid = botYoungBid(studYoung(y, botStud, myBird).value);
    assert(proposeStud(y, ME, botStud.id, myBird.id, bid.max + 1000) === null, 'de speler vraagt te veel voor de jongen');
    const d3 = y.studDeals!.find((d) => d.studId === botStud.id && d.mateId === myBird.id)!;
    assert(d3.youngTo === botStud.ownerId && d3.turn === ME && d3.fee === bid.max, `de bot wil de jongen en antwoordt met zijn maximum (€${bid.max})`);
    assert(acceptStud(y, ME, d3.id) === null && y.breedingPairs.some((b) => b.ownerId === botStud.ownerId && b.deal?.partnerId === ME),
      'de speler gaat akkoord: de jongen zijn voor de bot, de vergoeding voor de speler');
    await st.persist();
  } else {
    console.log('  (geen vrije botduif meer in deze wereld — dat stuk overgeslagen)');
  }
}

// ---------------------------------------------------------------------------
console.log('\nDe geschatte score klopt met wat er echt uitkomt');
{
  /** The mean ★ of many real clutches (breed, unseeded) against the estimate. */
  function measured(sire: Pigeon, dam: Pigeon, kin: any = null, n = 4000): number {
    let sum = 0, count = 0;
    while (count < n) {
      for (const y of breed(sire, dam, 'x', 100, undefined, undefined, kin)) { sum += talent(y); count++; }
    }
    return sum / count;
  }
  const make = (sex: 'doffer' | 'duivin', skill: number, gene: number): Pigeon => {
    const p = generatePigeon({ ownerId: 'x', currentWeek: 100, quality: 0.5, sex });
    p.speed = skill; p.endurance = skill - 4; p.orientation = skill + 3;
    p.genes = { speed: gene, endurance: gene + 2, orientation: gene - 2 };
    p.libido = 90; p.form = 90;
    return p;
  };
  const cases: [string, Pigeon, Pigeon, any][] = [
    ['gewoon koppel (★60 × ★66)', make('doffer', 60, 88), make('duivin', 66, 84), null],
    ['vlak onder de plafonds (★83 × ★86)', make('doffer', 83, 85), make('duivin', 86, 87), null],
    ['volle broer en zus (plafonds −18)', make('doffer', 80, 84), make('duivin', 78, 82), 'volle'],
  ];
  for (const [label, sire, dam, kin] of cases) {
    const est = expectedYoungScore(sire, dam, kin);
    const got = measured(sire, dam, kin);
    assert(Math.abs(est - got) < 0.6, `${label}: geschat ★${est.toFixed(1)}, gemeten ★${got.toFixed(1)}`);
  }
}
