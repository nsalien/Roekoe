/**
 * Vluchtreacties: de ontgrendelroutes en de chatbox.
 *
 * De kern van het ontwerp is dat **geen enkele categorie ooit volledig dicht
 * staat**. Een speler die alleen een slotje ziet weet niet wat erachter zit en
 * heeft dus geen reden om ernaar toe te werken, dus elke zware categorie heeft
 * vanaf level 1 iets bruikbaars. Dat is precies het soort eigenschap dat bij een
 * volgende balansronde ongemerkt sneuvelt — vandaar deze test.
 *
 * Vier dingen moeten hard blijven staan:
 *
 *  1. **Een verse speler (level 1, 0 munten) heeft al iets zwarts én iets
 *     scherps.** Het startgeschenk, en het zijn de absurde regels — niet de
 *     venijnigste, die horen achter level 9 + 500 munten te blijven.
 *  2. **De gemiddelde speler (level 5-6) heeft 4 à 6 zware reacties gratis**,
 *     via startgeschenk + mijlpalen + badges, zonder één munt uit te geven.
 *  3. **Munten alléén volstaan niet.** Onder `minLevel` weigert de winkel, hoe
 *     rijk het hok ook is.
 *  4. **De chatbox blijft leesbaar**: cooldown, herhalingen samengevouwen tot
 *     ×N, begrensd op FLIGHT_CHAT.keep, en een gerichte regel levert de
 *     ontvanger een melding op terwijl iedereen hem gewoon ziet staan.
 *
 * Run: npx tsx reactions.test.mts
 */
import { FLIGHT_CHAT, REACTIONS, REACTION_MAP } from './core/config/reactions.js';
import { buyReaction, hasReaction, postReaction, reactionsFor } from './core/game/reactions.js';
import { MemoryStore } from './core/store.js';
import type { Database, Flight, Loft } from './core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

function loft(over: Partial<Loft> = {}): Loft {
  return {
    userId: 'u1', name: 'Hok Testman', money: 10000, food: {} as any, feedRation: 'basis' as any,
    capacity: 20, compartments: 0, seasonPoints: 0, totalWins: 0, isBot: false,
    infirmaryCapacity: 4, medicatedFood: false, doctors: 0, physios: 0,
    xp: 0, level: 1, stats: {} as any, badges: [], missions: [], missionsDay: '',
    streak: 0, pendingEvent: null, pendingBroods: [], sponsorship: { active: [], offers: [], declined: [] } as any,
    ...over,
  } as Loft;
}

function world(lofts: Loft[], f: Flight): Database {
  return {
    users: [], lofts, pigeons: [], breedingPairs: [], flights: [f],
    notifications: [], trades: [], auctions: [], bets: [],
    world: { currentWeek: 1, seasonYear: 1, seeded: true, dataVersion: 99, lastDailyTick: '', lastShelterSpawn: '', seasonStartedAt: '', seasonEndsAt: '', seasonWeek: 1, lastAdvance: '', dailyCareCursor: '', leaderboard: '' },
  } as unknown as Database;
}

function flight(): Flight {
  return {
    id: 'f1', week: 1, templateKey: 't', name: 'Testvlucht', type: 'regional',
    distanceKm: 100, entryFee: 0, fromCity: 'A', toCity: 'B',
    startAt: new Date().toISOString(), status: 'live',
    entries: [], weather: '', weatherFactor: 1, results: [], recap: '',
    createdAt: new Date().toISOString(),
    sim: [
      { pigeonId: 'p1', pigeonName: 'Duif A', ownerId: 'u1', ownerName: 'Hok Testman' },
      { pigeonId: 'p2', pigeonName: 'Duif B', ownerId: 'u2', ownerName: 'Hok Rivaal' },
    ] as any,
  } as Flight;
}

// --- 1. Geen enkele categorie staat dicht --------------------------------
console.log('\nElke categorie heeft vanaf level 1 iets bruikbaars');
{
  const nieuw = loft({ level: 1, money: 0 });
  const mine = REACTIONS.filter((t) => hasReaction(nieuw, t));
  for (const cat of ['juich', 'baal', 'sportief', 'excuus', 'scherp', 'zwart']) {
    ok(mine.some((t) => t.cat === cat), `${cat}: een verse speler kan er minstens één sturen`);
  }
  // West-Vlaams (2) en Complot (3) mogen wél nog dicht staan op level 1 — die
  // liggen zo dicht bij de start dat een slotje er een doel is, geen muur.
  ok(!mine.some((t) => t.cat === 'sneer'), 'sneer staat wél nog dicht op level 1');
}

// --- 2. Het startgeschenk is absurd, niet venijnig -----------------------
console.log('\nDe tasters zijn weggegeven, de kroonjuwelen niet');
{
  const nieuw = loft({ level: 1, money: 0 });
  ok(hasReaction(nieuw, REACTION_MAP.get('z_aardappel')!), 'zwart: de aardappel zit in het startpakket');
  ok(hasReaction(nieuw, REACTION_MAP.get('p_liften')!), 'scherp: het liften zit in het startpakket');
  ok(!hasReaction(nieuw, REACTION_MAP.get('z_bistro')!), 'de bistro-regel blijft achter level 9 + munten');
  ok(!hasReaction(nieuw, REACTION_MAP.get('z_hospice')!), 'de hospice-regel blijft achter level 9 + munten');
}

// --- 3. De gemiddelde speler: 4 à 6 zware reacties zonder te betalen ------
console.log('\nEen level 5-6 hok dat nooit een munt uitgeeft');
{
  const zwaar = (l: Loft) =>
    REACTIONS.filter((t) => (t.cat === 'scherp' || t.cat === 'zwart') && hasReaction(l, t)).length;
  const kaal = loft({ level: 5, money: 0 });
  const nBadgeloos = zwaar(kaal);
  ok(nBadgeloos >= 4, `level 5 zonder badges: ${nBadgeloos} zware reacties gratis (≥4)`);

  const metBadges = loft({
    level: 6, money: 0,
    badges: [{ key: 'galgenhumor', at: '' }, { key: 'vredig', at: '' }] as any,
  });
  const nMet = zwaar(metBadges);
  ok(nMet >= 5 && nMet <= 8, `level 6 met twee fun-badges: ${nMet} zware reacties gratis (5-8)`);
  ok(nMet > nBadgeloos, 'badges leveren écht extra reacties op');
  ok(
    hasReaction(metBadges, REACTION_MAP.get('z_diepvries')!),
    'de diepvriesregel komt vrij omdat er een duif van ouderdom stierf',
  );
}

// --- 4. Munten kopen geen level ------------------------------------------
console.log('\nLevel is de rem, niet de portemonnee');
{
  const rijk = loft({ level: 4, money: 999999 });
  const store = new MemoryStore(world([rijk], flight()));
  const err = buyReaction(store, 'u1', 'n_hokruikt');
  ok(!!err && err.includes('level 5'), `een rijk level-4 hok mag geen sneer kopen (${err})`);
  ok(rijk.money === 999999, 'en er is niets afgeschreven');

  const klaar = loft({ level: 5, money: 300 });
  const store2 = new MemoryStore(world([klaar], flight()));
  ok(buyReaction(store2, 'u1', 'n_hokruikt') === null, 'op level 5 lukt de aankoop wel');
  ok(klaar.money === 200, 'en de 100 munten zijn afgeschreven');
  ok(hasReaction(klaar, REACTION_MAP.get('n_hokruikt')!), 'de reactie zit nu in het hok');
  ok(buyReaction(store2, 'u1', 'n_hokruikt') !== null, 'twee keer kopen kan niet');
}

// --- 5. De chatbox blijft leesbaar ---------------------------------------
console.log('\nDe chatbox');
{
  const me = loft({ userId: 'u1', name: 'Hok Testman', level: 9, money: 0 });
  const rival = loft({ userId: 'u2', name: 'Hok Rivaal', level: 1 });
  const f = flight();
  const db = world([me, rival], f);
  const store = new MemoryStore(db);
  const t0 = Date.parse('2026-01-01T12:00:00Z');

  ok(postReaction(store, 'u1', 'f1', 'j_allez', null, t0) === null, 'een vluchtbrede kreet komt door');
  ok(f.chat?.length === 1, 'en staat in de box');

  ok(
    postReaction(store, 'u1', 'f1', 'j_allez', null, t0 + 5000) !== null,
    'binnen de cooldown wordt de tweede geweigerd',
  );

  // Herhaling na de cooldown, binnen het samenvouwvenster → ×2, geen tweede regel.
  ok(postReaction(store, 'u1', 'f1', 'j_allez', null, t0 + 25000) === null, 'na de cooldown mag het wel');
  ok(f.chat?.length === 1 && f.chat[0].repeat === 2, 'en dezelfde kreet vouwt samen tot ×2');

  // Gericht: openbaar in de box én een bel voor wie hij noemt.
  const errNoTarget = postReaction(store, 'u1', 'f1', 'z_aardappel', null, t0 + 60000);
  ok(!!errNoTarget, 'een gerichte reactie zonder doelwit wordt geweigerd');
  ok(
    postReaction(store, 'u1', 'f1', 'z_aardappel', 'u2', t0 + 60000) === null,
    'met een doelwit lukt het',
  );
  const line = f.chat![f.chat!.length - 1];
  ok(line.targetName === 'Hok Rivaal', 'de naam van het doelwit staat bevroren op de regel');
  ok(
    db.notifications.some((n) => n.userId === 'u2' && n.kind === 'taunt'),
    'en het doelwit krijgt een melding',
  );
  ok(
    db.notifications.filter((n) => n.kind === 'taunt').length === 1,
    'maar niemand anders — de rest ziet hem gewoon in de box',
  );

  ok(
    postReaction(store, 'u1', 'f1', 'z_aardappel', 'u1', t0 + 120000) !== null,
    'naar jezelf roepen kan niet',
  );

  // Eén melker mag de tribune niet bezetten.
  let t = t0 + 200000;
  let geweigerd = 0;
  for (let i = 0; i < 40; i++) {
    // Wissel af, anders vouwt alles samen tot één regel.
    if (postReaction(store, 'u1', 'f1', i % 2 ? 'j_allez' : 'b_amai', null, t)) geweigerd++;
    t += 30000;
  }
  ok(geweigerd > 0, 'na een tijd wordt dezelfde roeper afgeremd');
  const aandeel = (f.chat ?? []).filter((c) => c.userId === 'u1').length;
  ok(
    aandeel <= Math.ceil(FLIGHT_CHAT.keep * FLIGHT_CHAT.maxShareOfBox),
    `hij houdt hoogstens ${Math.ceil(FLIGHT_CHAT.keep * FLIGHT_CHAT.maxShareOfBox)} van de ${FLIGHT_CHAT.keep} regels (${aandeel})`,
  );
}

// --- 5b. De box is begrensd, ook met een volle tribune -------------------
console.log('\nDe box groeit niet ongelimiteerd');
{
  // Met veel roepers loopt niemand tegen zijn aandeel aan, dus dit is de enige
  // opstelling waarin de harde `keep`-grens echt geraakt wordt. Belangrijk: de
  // box rijdt mee op de flight-rij, die op ÉLKE live-poll wordt uitgelezen.
  const f = flight();
  const roepers = Array.from({ length: 12 }, (_, i) => loft({ userId: `u${i}`, name: `Hok ${i}`, level: 3 }));
  f.sim = roepers.map((l, i) => ({ pigeonId: `p${i}`, pigeonName: `Duif ${i}`, ownerId: l.userId, ownerName: l.name })) as any;
  const store = new MemoryStore(world(roepers, f));
  let t = Date.parse('2026-02-01T09:00:00Z');
  for (let ronde = 0; ronde < 10; ronde++) {
    for (const l of roepers) {
      postReaction(store, l.userId, 'f1', ronde % 2 ? 'j_allez' : 'b_amai', null, t);
      t += 21000;
    }
  }
  ok((f.chat?.length ?? 0) > 40, `de tribune is echt vol gelopen (${f.chat?.length} regels)`);
  ok((f.chat?.length ?? 0) <= FLIGHT_CHAT.keep, `en blijft op ${FLIGHT_CHAT.keep} regels of minder`);
  ok(
    (f.chat ?? []).every((c, i, arr) => i === 0 || Date.parse(c.at) >= Date.parse(arr[i - 1].at)),
    'de oudste regels vallen eraf, de volgorde blijft oplopend',
  );
}

// --- 6. Een scheduled vlucht heeft geen tribune --------------------------
console.log('\nRandgevallen');
{
  const me = loft({ level: 9 });
  const f = flight();
  f.status = 'scheduled';
  const store = new MemoryStore(world([me], f));
  ok(postReaction(store, 'u1', 'f1', 'j_allez', null) !== null, 'voor de lossing is er niets om op te reageren');
}
{
  // Elke id is uniek — hij staat in Loft.unlockedReactions en in bewaarde regels.
  const ids = new Set(REACTIONS.map((r) => r.id));
  ok(ids.size === REACTIONS.length, `alle ${REACTIONS.length} template-ids zijn uniek`);
  ok(
    REACTIONS.every((r) => r.channel === 'vlucht' || r.channel === 'speler'),
    'elke template heeft een geldig kanaal',
  );
  ok(
    REACTIONS.filter((r) => r.cat === 'zwart' || r.cat === 'scherp').every((r) => r.channel === 'speler'),
    'zwart en scherp zijn altijd gericht — die hebben geen zin zonder doelwit',
  );
}

console.log(`\n${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
