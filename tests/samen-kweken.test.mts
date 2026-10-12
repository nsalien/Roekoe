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
import { createLoftForUser, seedWorld, stopBreeding } from '../core/game/engine.js';
import { advanceRealtime, tickBreedingHatch } from '../core/game/schedule.js';
import { acceptStud, activeListing, botOfferStud, breedBlock, closeStud, counterStud, proposeStud, setStudListing, studYoungScore } from '../core/game/stud.js';
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
    // The bots put a bird up (production: on the daily tick) and keep her home.
    for (const l of w.lofts.filter((x) => x.isBot)) botOfferStud(w, l, w.pigeons.filter((p) => p.ownerId === l.userId), Date.now());
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
  hatchOnly(s.data, PAIR_HATCHES, nowMs);
  const young = s.data.pigeons.filter((p) => p.id.startsWith(`pig_brood_${PAIR_HATCHES}`));
  const held = s.data.lofts.find((l) => l.userId === ME)!.pendingBroods ?? [];
  const born = young.length + held.reduce((n, b) => n + b.young.length, 0);
  assert(born >= 1, `er zijn jongen (${born})`);
  assert(young.every((y) => y.ownerId === ME), 'alle jongen gaan naar wie ze kreeg');
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
    for (const sex of ['doffer', 'doffer', 'duivin'] as const) {
      const p = generatePigeon({ ownerId: P2, currentWeek: x.world.currentWeek, quality: 0.6, sex });
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
  const other = s.data.pigeons.find((p: Pigeon) => p.ownerId === ME && p.sex === 'duivin' && p.id !== myDuivin.id)!;
  assert(proposeStud(s.data, ME, p2doffer.id, other.id, 50) === null, 'een open voorstel');
  await s.persist();
  assert(rows('SELECT COUNT(*) FROM stud_deals') === count + 1, 'staat als rij in stud_deals');
  const plain = await D1Store.load(d1, P2);
  assert(plain.data.studDeals === undefined, 'een gewoon verzoek laadt de onderhandelingen niet');
  plain.data.lofts.find((l) => l.userId === P2)!.money += 1;
  await plain.persist();
  assert(rows('SELECT COUNT(*) FROM stud_deals') === count + 1, '…en wist ze dus ook niet bij het wegschrijven');
  const listed = rows(`SELECT COUNT(*) FROM pigeons WHERE stud != ''`);
  assert(listed >= 2, `het aanbod staat op de duif zelf (${listed} duiven)`);
  const st = (await call('/state')).json;
  assert(st.pigeons.every((p: any) => 'stud' in p), '/state kent het aanbod per duif');
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
