/**
 * Een speler verwijderen (datamigratie 52).
 *
 * Dit is de gevaarlijkste soort code in het project: ze WIST rijen in productie,
 * en een vergeten tabel merk je pas als er een spookstem blijft meetellen of een
 * veiling een hoogste bieder heeft die niet meer bestaat. Daarom draait deze
 * test tegen een echte SQLite-engine en controleert ze beide kanten:
 *
 *  - alles van de twee verwijderde spelers is weg (ook in de tabellen die de
 *    wereldload NIET draagt: inbox, weddenschappen, stembord, duivenlogboeken);
 *  - de speler die mag blijven is ONGEMOEID, inclusief zijn duiven, zijn inbox,
 *    zijn stem en zijn inzet — die wordt terugbetaald, niet stil geannuleerd.
 *
 * Run: npx tsx tests/player-removal.test.mts (vanuit de repo-root)
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1Store, ensureSchema, loadStemBoard, insertStemComment, toggleStemVote } from '../core/d1.js';
import { advanceRealtime } from '../core/game/schedule.js';
import { emptyFoodStock, emptySponsorState, emptyStats } from '../core/schema.js';

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
  return {
    prepare,
    async exec(query: string) { sql.exec(query); },
    async batch(stmts: any[]) { for (const s of stmts) s.run(); },
    _raw: sql,
  };
}

const db = fakeD1();
db._raw.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));
db._raw.prepare('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1,1,1,1)').run();
for (let i = 0; i < 20 && !(await ensureSchema(db)); i++) { /* volgend blok */ }

const rows = (sql: string) => db._raw.prepare(sql).all() as any[];
const count = (sql: string) => Number((db._raw.prepare(sql).get() as any).n);

// --- De wereld opzetten -----------------------------------------------------
// Drie spelers: één die matcht op HOKNAAM, één die matcht op GEBRUIKERSNAAM
// (met een hoknaam die niets zegt), en één die moet blijven. De eerste twee
// dragen bewust een dubbele spatie / hoofdletters, want daar ging het bij
// eerdere migraties bijna mis.
const PLAYERS = [
  { id: 'u_dik', username: 'nico', loft: 'De  Dikke   Duif', weg: true },
  { id: 'u_pluk', username: 'DuivePlukker', loft: 'Hok Van Alles', weg: true },
  { id: 'u_blijf', username: 'blijver', loft: 'Hok Blijft', weg: false },
];

{
  const store = await D1Store.load(db, undefined);
  const now = new Date().toISOString();
  store.data.world.seeded = true;
  // Meteen op 51, zodat enkel de migratie die we testen nog moet draaien.
  store.data.world.dataVersion = 51;

  for (const p of PLAYERS) {
    store.data.users.push({
      id: p.id, username: p.username, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: now,
    } as any);
    store.data.lofts.push({
      userId: p.id, name: p.loft, money: 1000, food: emptyFoodStock(), feedRation: 'normal',
      capacity: 20, compartments: 0, seasonPoints: 0, totalWins: 0, isBot: false,
      infirmaryCapacity: 4, medicatedFood: false, doctors: 0, physios: 0,
      xp: 0, level: 3, stats: emptyStats(), badges: [], missions: [], missionsDay: '',
      streak: 0, pendingEvent: null, pendingBroods: [], sponsorship: emptySponsorState(),
    } as any);
    for (let i = 0; i < 2; i++) {
      store.data.pigeons.push({
        id: `${p.id}_p${i}`, ownerId: p.id, name: `Duif ${p.id}${i}`, sex: 'doffer',
        birthWeek: 1, speed: 50, endurance: 50, orientation: 50, libido: 50, form: 80, health: 80,
        experience: 10, sireId: null, damId: null, forSale: false, price: null, createdAtWeek: 1,
        ailment: null, inInfirmary: false, races: 0, everAiled: false, coached: false,
        ration: 'normal', compartment: false, hungerDays: 0, restDays: 0,
      } as any);
    }
  }

  // Een geplande vlucht waarin alle drie de hokken ingeschreven staan.
  store.data.flights.push({
    id: 'f1', week: 1, templateKey: 't1', name: 'Testvlucht', type: 'regional',
    distanceKm: 150, entryFee: 10, fromCity: 'A', toCity: 'B',
    startAt: new Date(Date.now() + 6 * 3600000).toISOString(), status: 'scheduled',
    entries: PLAYERS.map((p) => ({ pigeonId: `${p.id}_p0`, ownerId: p.id })),
    sim: [], weather: '', weatherFactor: 1, results: [], recap: '', createdAt: now,
    chat: [
      { id: 'c1', at: now, userId: 'u_dik', userName: 'De Dikke Duif', templateId: 't', text: 'Allez!', cat: 'aanmoediging' },
      { id: 'c2', at: now, userId: 'u_blijf', userName: 'Hok Blijft', templateId: 't', text: 'Hop!', cat: 'aanmoediging' },
    ],
  } as any);

  // De blijver zet in op een duif van een vertrekker: die inzet moet TERUG.
  store.data.bets.push({
    id: 'b_blijf', userId: 'u_blijf', userName: 'Hok Blijft', flightId: 'f1', kind: 'win',
    pigeonId: 'u_dik_p0', pigeonName: 'Duif u_dik0', rivalId: null, rivalName: null,
    stake: 100, ratio: 2, potentialWin: 200, status: 'open', placedAt: now, settledAt: null,
  } as any);
  // En een weddenschap van een vertrekker zelf: die verdwijnt gewoon.
  store.data.bets.push({
    id: 'b_dik', userId: 'u_dik', userName: 'De Dikke Duif', flightId: 'f1', kind: 'win',
    pigeonId: 'u_blijf_p0', pigeonName: 'Duif u_blijf0', rivalId: null, rivalName: null,
    stake: 50, ratio: 2, potentialWin: 100, status: 'open', placedAt: now, settledAt: null,
  } as any);

  // Een bod van de vertrekker op een duif van de blijver, en omgekeerd.
  store.data.offers.push(
    { id: 'o1', pigeonId: 'u_blijf_p1', pigeonName: 'Duif u_blijf1', fromUserId: 'u_dik', fromUserName: 'De Dikke Duif', toUserId: 'u_blijf', toUserName: 'Hok Blijft', amount: 500, status: 'open', createdAt: now, resolvedAt: null } as any,
    { id: 'o2', pigeonId: 'u_pluk_p1', pigeonName: 'Duif u_pluk1', fromUserId: 'u_blijf', fromUserName: 'Hok Blijft', toUserId: 'u_pluk', toUserName: 'Hok Van Alles', amount: 400, status: 'open', createdAt: now, resolvedAt: null } as any,
  );

  // Een lopende veiling waar de vertrekker de hoogste bieder is.
  store.data.auctions.push({
    id: 'a1', templateKey: 'k', pigeonId: 'u_blijf_p1', startAt: now,
    endAt: new Date(Date.now() + 3600000).toISOString(), minBid: 100, minIncrement: 50,
    currentBid: 300, currentBidderId: 'u_dik', currentBidderName: 'De Dikke Duif', status: 'open',
    bids: [
      { userId: 'u_dik', name: 'De Dikke Duif', amount: 300, at: now },
      { userId: 'u_blijf', name: 'Hok Blijft', amount: 200, at: now },
    ],
  } as any);

  // Een inbox voor alle drie.
  for (const p of PLAYERS) {
    store.data.notifications.push({
      id: `ntf_${p.id}`, userId: p.id, kind: 'info', title: 'Hallo', body: 'Test',
      flightId: null, createdAt: now, read: false,
    } as any);
  }

  // Een logboekregel per duif.
  for (const p of PLAYERS) {
    const bird = store.data.pigeons.find((x) => x.id === `${p.id}_p0`)!;
    (bird as any).pendingLog = [{
      id: `${bird.id}:race:1`, pigeonId: bird.id, kind: 'race', at: now,
      data: JSON.stringify({ flightId: 'f0', place: 1 }),
    }];
  }

  await store.persist();
}

// Stembord: alle drie stemmen, alle drie reageren.
await loadStemBoard(db, 'u_blijf'); // zaait de startideeën
for (const p of PLAYERS) {
  await toggleStemVote(db, 'stem_doping', p.id);
  await insertStemComment(db, {
    id: `cmt_${p.id}`, ideaId: 'stem_doping', authorId: p.id, authorName: p.loft,
    body: 'Mijn mening hierover.', createdAt: new Date().toISOString(),
  });
}

console.log('\nVoor de migratie');
{
  ok(count('SELECT COUNT(*) n FROM users') === 3, 'drie spelers staan in de databank');
  ok(count('SELECT COUNT(*) n FROM pigeons') === 6, 'zes duiven');
  ok(count("SELECT COUNT(*) n FROM stem_votes WHERE idea_id = 'stem_doping'") === 3, 'drie stemmen op doping');
  ok(count('SELECT COUNT(*) n FROM pigeon_log_entries') === 3, 'drie logboekregels');
}

// --- De migratie draaien ----------------------------------------------------
{
  const store = await D1Store.load(db, 'u_blijf');
  advanceRealtime(store.data, Date.now(), new Map());
  await store.persist();
}

console.log('\nDe twee spelers zijn weg');
{
  const users = rows('SELECT id FROM users').map((r) => r.id);
  ok(!users.includes('u_dik') && !users.includes('u_pluk'), 'hun gebruikers zijn verwijderd');
  ok(users.includes('u_blijf'), 'de blijver staat er nog');
  ok(count("SELECT COUNT(*) n FROM lofts WHERE user_id IN ('u_dik','u_pluk')") === 0, 'hun hokken zijn weg');
  ok(count("SELECT COUNT(*) n FROM pigeons WHERE owner_id IN ('u_dik','u_pluk')") === 0, 'hun duiven zijn weg');
  ok(count("SELECT COUNT(*) n FROM pigeons WHERE owner_id = 'u_blijf'") === 2, 'de duiven van de blijver niet');
  ok(count("SELECT COUNT(*) n FROM notifications WHERE user_id IN ('u_dik','u_pluk')") === 0,
    'hun inbox is weg — ook al zat die niet in de wereldload');
  ok(count("SELECT COUNT(*) n FROM notifications WHERE user_id = 'u_blijf'") > 0, 'de inbox van de blijver niet');
  ok(count("SELECT COUNT(*) n FROM bets WHERE user_id IN ('u_dik','u_pluk')") === 0, 'hun weddenschappen zijn weg');
  ok(count("SELECT COUNT(*) n FROM pigeon_log_entries WHERE pigeon_id LIKE 'u_dik%' OR pigeon_id LIKE 'u_pluk%'") === 0,
    'de logboeken van hun duiven zijn weg');
  ok(count("SELECT COUNT(*) n FROM pigeon_log_entries WHERE pigeon_id LIKE 'u_blijf%'") === 1,
    'het logboek van de blijver niet');
  ok(count("SELECT COUNT(*) n FROM offers WHERE id IN ('o1','o2')") === 0, 'biedingen van én op hen zijn weg');
}

console.log('\nHet stembord');
{
  ok(count("SELECT COUNT(*) n FROM stem_votes WHERE user_id IN ('u_dik','u_pluk')") === 0,
    'hun stemmen tellen niet meer mee');
  const doping = (await loadStemBoard(db, 'u_blijf')).find((i) => i.id === 'stem_doping')!;
  ok(doping.votes === 1, 'de stand op het bord staat op 1');
  const namen = rows("SELECT author_id, author_name FROM stem_comments WHERE id IN ('cmt_u_dik','cmt_u_pluk')");
  ok(namen.length === 2, 'hun reacties blijven staan (de draad van anderen blijft leesbaar)');
  ok(namen.every((r) => r.author_id === '' && r.author_name === 'Oud-speler'), 'maar zonder hun naam');
  const blijft = rows("SELECT author_name FROM stem_comments WHERE id = 'cmt_u_blijf'")[0];
  ok(blijft.author_name === 'Hok Blijft', 'de reactie van de blijver houdt zijn naam');
}

console.log('\nDe blijver draait geen schade op');
{
  const store = await D1Store.load(db, 'u_blijf');
  const loft = store.data.lofts.find((l) => l.userId === 'u_blijf')!;
  const bet = store.data.bets.find((b) => b.id === 'b_blijf');
  ok(bet?.status === 'void', 'zijn inzet op een verdwenen duif is geannuleerd');
  ok(loft.money === 1100, `en terugbetaald: €${loft.money} (1000 + 100 inzet)`);
  ok(
    store.data.notifications.some((n) => n.userId === 'u_blijf' && n.title.includes('geannuleerd')),
    'met een melding erover, zodat het geen stille correctie is',
  );

  const flight = store.data.flights.find((f) => f.id === 'f1')!;
  ok(flight.entries.length === 1 && flight.entries[0].ownerId === 'u_blijf',
    'enkel zijn duif staat nog ingeschreven');
  ok(flight.chat!.length === 1 && flight.chat![0].userId === 'u_blijf', 'hun tribunekreten zijn weg');

  const auction = store.data.auctions.find((a) => a.id === 'a1')!;
  ok(auction.currentBidderId === 'u_blijf' && auction.currentBid === 200,
    'de veiling valt terug op de volgende bieder i.p.v. een spookleider');
  ok((auction.bids ?? []).every((b) => b.userId !== 'u_dik'), 'hun bod staat niet meer in de veiling');
  ok(count("SELECT COUNT(*) n FROM auction_bids WHERE user_id = 'u_dik'") === 0, 'ook niet in de databank');
}

console.log('\nDe migratie draait maar één keer');
{
  const store = await D1Store.load(db, 'u_blijf');
  const before = store.data.lofts.find((l) => l.userId === 'u_blijf')!.money;
  ok(store.data.world.dataVersion >= 52, 'dataVersion staat op 52');
  advanceRealtime(store.data, Date.now(), new Map());
  await store.persist();
  const after = (await D1Store.load(db, 'u_blijf')).data.lofts.find((l) => l.userId === 'u_blijf')!.money;
  ok(after === before, 'een tweede ronde betaalt niets nog eens terug');
  ok(count('SELECT COUNT(*) n FROM users') === 1, 'en verwijdert niemand anders');
}

console.log(fails === 0 ? '\n✅ alles groen' : `\n❌ ${fails} controle(s) gefaald`);
process.exit(fails === 0 ? 0 : 1);
