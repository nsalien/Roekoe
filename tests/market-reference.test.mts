/**
 * De markt volgt het spel (27 okt, op vraag van de eigenaar: "Zorg dat de duiven
 * die te koop staan dynamisch meegaan het spel en de spelers" — een club rond ★65
 * heeft niets aan een opvangduif van ★40).
 *
 * Gedekt:
 *  1. de referentie = het gemiddelde van alle duiven in een hok (spelers én bots),
 *     zonder de duiven van het veilinghuis en het opvangcentrum; afgerond,
 *     begrensd, en 65 voor een wereld zonder duiven;
 *  2. de zondagveiling: duif A = gemiddelde −5 tot +5, duif B = +5 tot +15; bij
 *     ★65 precies de oude banden (60–70, 70–80); bij ★75 70–80 en 80–90; de band
 *     staat in de sleutel, het label en de bel zeggen hetzelfde;
 *  3. beide zondagduiven van één dag delen dezelfde referentie, ook als het
 *     gemiddelde tussen 10:00 en 11:00 verschuift (de bel van A beloofde B's band);
 *  4. een zondagveiling van vóór deze wijziging (sleutel zonder band) houdt haar
 *     oude label;
 *  5. het opvangcentrum: gemiddelde −10 tot −3, af en toe (~22 %) −3 tot +3; ook
 *     bij een hoger gemiddelde, en de duiven zijn oud genoeg om te vliegen;
 *  6. de duiven blijven natuurlijk: niet allemaal allrounders (geen kunstmatig
 *     gelijke vaardigheden), genen nooit onder een vaardigheid.
 *
 * Run: npx tsx tests/market-reference.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Auction, Database, User } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import {
  AUCTION_HOUSE_ID, SHELTER_ID, auctionKind, ensureAuctions, marketReference, sundayBandLabel,
} from '../core/game/auction.js';
import { ageInWeeks, generatePigeon, shapeToScore, talent } from '../core/game/pigeon.js';
import { AUCTION, GENE, RACE_AGE_WEEKS } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

function world(): { db: Database; store: MemoryStore } {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const u: User = { id: newId('usr'), username: 'speler', passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, 'Het Hok');
  return { db: store.data, store };
}
/** Put every bird in a loft on (about) `score`, so the reference is `score`. */
function setAverage(db: Database, score: number): void {
  const lofts = new Set(db.lofts.map((l) => l.userId));
  for (const p of db.pigeons) if (lofts.has(p.ownerId)) shapeToScore(p, score);
}
const lotKey = (a: Auction) => a.templateKey.split(':')[2];
const sundays = (db: Database) => db.auctions.filter((a) => a.status === 'open' && auctionKind(a) === 'sunday');
const SUNDAY_A = Date.parse('2026-10-04T08:30:00Z'); // 10:30 Brussel: enkel A
const SUNDAY_B = Date.parse('2026-10-04T09:30:00Z'); // 11:30: ook B

// ---------------------------------------------------------------------------
console.log('\n1. De referentie: het gemiddelde van alle duiven in een hok');
{
  const { db } = world();
  const lofts = new Set(db.lofts.map((l) => l.userId));
  const mine = db.pigeons.filter((p) => lofts.has(p.ownerId));
  const avg = mine.reduce((s, p) => s + talent(p), 0) / mine.length;
  ok(marketReference(db) === Math.round(avg), `spelers + bots: ★${marketReference(db)} (gemiddelde ${avg.toFixed(2)} over ${mine.length} duiven)`);
  ok(db.lofts.some((l) => l.isBot && mine.some((p) => p.ownerId === l.userId)), 'de duiven van de bots tellen mee');
  for (const owner of [AUCTION_HOUSE_ID, SHELTER_ID]) {
    const p = generatePigeon({ ownerId: owner, currentWeek: db.world.currentWeek });
    shapeToScore(p, 10);
    db.pigeons.push(p);
  }
  ok(marketReference(db) === Math.round(avg), 'een duif van het veilinghuis of het opvangcentrum telt niet mee');
  setAverage(db, 90);
  ok(marketReference(db) === AUCTION.reference.max, `begrensd naar boven: ★${AUCTION.reference.max}`);
  setAverage(db, 20);
  ok(marketReference(db) === AUCTION.reference.min, `begrensd naar onder: ★${AUCTION.reference.min}`);
  const empty = new MemoryStore(emptyDatabase()).data;
  ok(marketReference(empty) === 65 && AUCTION.reference.fallback === 65, 'een wereld zonder duiven: ★65');
}

// ---------------------------------------------------------------------------
console.log('\n2. De zondagveiling volgt het gemiddelde');
for (const [avg, aBand, bBand] of [[65, [60, 70], [70, 80]], [75, [70, 80], [80, 90]], [55, [50, 60], [60, 70]]] as const) {
  const { db } = world();
  setAverage(db, avg);
  ensureAuctions(db, SUNDAY_B);
  const a = sundays(db).find((x) => lotKey(x) === 'a')!;
  const b = sundays(db).find((x) => lotKey(x) === 'b')!;
  const ta = talent(db.pigeons.find((p) => p.id === a.pigeonId)!);
  const tb = talent(db.pigeons.find((p) => p.id === b.pigeonId)!);
  ok(sundayBandLabel(a) === `${aBand[0]}–${aBand[1]}` && sundayBandLabel(b) === `${bBand[0]}–${bBand[1]}`,
    `gemiddelde ★${avg}: A ${sundayBandLabel(a)}, B ${sundayBandLabel(b)}`);
  ok(ta >= aBand[0] && ta < aBand[1] && tb >= bBand[0] && tb < bBand[1], `en de duiven zitten erin: A ★${ta}, B ★${tb}`);
  const bell = db.notifications.find((n) => n.title.includes('Zondagveiling') && n.body.includes(`score ${ta})`))!;
  ok(!!bell && bell.body.includes(`tweede topduif (score ${bBand[0]}–${bBand[1]})`), 'de bel van A kondigt B aan met haar band');
  ok(a.id === 'auc_auction_2026-10-4_a' && a.pigeonId === 'pig_auction_2026-10-4_a', 'de ids blijven die van de dag + de duif, zonder band');
}

// ---------------------------------------------------------------------------
console.log('\n3. Beide zondagduiven van één dag delen dezelfde referentie');
{
  const { db } = world();
  setAverage(db, 65);
  ensureAuctions(db, SUNDAY_A);
  ok(sundays(db).length === 1 && sundayBandLabel(sundays(db)[0]) === '60–70', 'om 10:30: A in 60–70');
  setAverage(db, 72); // het gemiddelde verschuift voor B opent
  ensureAuctions(db, SUNDAY_B);
  const b = sundays(db).find((x) => lotKey(x) === 'b')!;
  ok(sundayBandLabel(b) === '70–80', `om 11:30: B in 70–80 zoals A beloofde, niet 77–87 (${sundayBandLabel(b)})`);
  ensureAuctions(db, SUNDAY_B + 60000);
  ok(sundays(db).length === 2, 'nog eens openen: nog steeds twee');
  const next = Date.parse('2026-10-11T09:30:00Z');
  for (const x of sundays(db)) x.status = 'closed';
  ensureAuctions(db, next);
  ok(sundays(db).every((x) => sundayBandLabel(x) === (lotKey(x) === 'a' ? '67–77' : '77–87')), 'de zondag erna volgt het nieuwe gemiddelde (★72)');
}

// ---------------------------------------------------------------------------
console.log('\n4. Een zondagveiling van vóór deze wijziging houdt haar label');
{
  const legacy = (key: string): Auction => ({
    id: 'auc_x', templateKey: key, pigeonId: 'pig_x', startAt: '', endAt: '', minBid: 300, minIncrement: 25,
    currentBid: 0, currentBidderId: null, currentBidderName: null, bids: [], status: 'open',
  });
  ok(sundayBandLabel(legacy('auction:2026-10-4:a')) === '60–70' && sundayBandLabel(legacy('auction:2026-10-4:b')) === '70–80', 'oude sleutels: 60–70 en 70–80');
  ok(sundayBandLabel(legacy('auction:2026-10-4')) === null, 'de oude enkele zondagveiling: geen band');
  ok(sundayBandLabel(legacy('shelter:123')) === null, 'een opvangduif: geen band');

  // The deploy Sunday: A opened under the old code (bell promised B at 70–80),
  // B opens under the new one while the average is ★75.
  const { db } = world();
  setAverage(db, 75);
  db.auctions.push({ ...legacy('auction:2026-10-4:a'), id: 'auc_auction_2026-10-4_a', endAt: '2026-10-04T18:00:00.000Z' });
  ensureAuctions(db, SUNDAY_B);
  const b = sundays(db).find((x) => lotKey(x) === 'b');
  ok(!!b && sundayBandLabel(b) === '70–80', `de deploy-zondag: B volgt de oude belofte van A, 70–80 (${b && sundayBandLabel(b)})`);
}

// ---------------------------------------------------------------------------
console.log('\n5. Het opvangcentrum volgt het gemiddelde');
const MONDAY = Date.parse('2026-10-05T10:00:00Z');
for (const avg of [65, 75, 45]) {
  const { db } = world();
  setAverage(db, avg);
  const week = db.world.currentWeek;
  const scores: number[] = [];
  let raceReady = true, genesOk = true, allRounders = 0;
  for (let i = 0; i < 600; i++) {
    db.world.lastShelterSpawn = '2026-01-01T00:00:00.000Z'; // overdue: spawns at once
    ensureAuctions(db, MONDAY + i * 60000);
    const a = db.auctions.find((x) => x.status === 'open' && auctionKind(x) === 'shelter');
    if (!a) continue;
    const p = db.pigeons.find((x) => x.id === a.pigeonId)!;
    scores.push(talent(p));
    if (ageInWeeks(p, week) < RACE_AGE_WEEKS) raceReady = false;
    for (const k of ['speed', 'endurance', 'orientation'] as const) if (!p.genes || p.genes[k] < p[k] || p.genes[k] > GENE.ceil) genesOk = false;
    if (Math.max(p.speed, p.endurance, p.orientation) - Math.min(p.speed, p.endurance, p.orientation) <= 8) allRounders++;
    a.status = 'closed';
    db.pigeons = db.pigeons.filter((x) => x.id !== p.id);
  }
  const lo = [avg - 10, avg - 3], hi = [avg - 3, avg + 3];
  const inLo = scores.filter((t) => t >= lo[0] && t < lo[1]).length;
  const inHi = scores.filter((t) => t >= hi[0] && t < hi[1]).length;
  ok(scores.length === 600, `gemiddelde ★${avg}: 600 opvangduiven`);
  ok(inLo + inHi === scores.length, `altijd ★${lo[0]}–${hi[1]} (laagste ★${Math.min(...scores)}, hoogste ★${Math.max(...scores)})`);
  const share = inHi / scores.length;
  ok(share > 0.16 && share < 0.28, `${(share * 100).toFixed(1)} % rond het gemiddelde (★${hi[0]}–${hi[1]}), de rest net eronder (doel 22 %)`);
  ok(raceReady, 'oud genoeg om te vliegen');
  ok(genesOk, `genen nooit onder een vaardigheid of boven ${GENE.ceil}`);
  ok(allRounders < scores.length * 0.8, `natuurlijke duiven: ${allRounders} van de 600 hebben vaardigheden binnen 8 punten`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
