/**
 * Seizoen 3, onderdeel 7: twee topduiven op zondag.
 *
 *  - duif A: score [60, 70), 10:00–20:00; duif B: score [70, 80), 11:00–21:00
 *    (Brusselse tijd, ook over de wissel naar wintertijd);
 *  - stabiele sleutels: twee keer openen = nog steeds twee veilingen, één melding
 *    per speler per duif; de overgangszondag met een oude sleutel krijgt geen derde;
 *  - geen opvangcentrum zolang een van beide loopt;
 *  - hoogste bod op de ene → op de andere bieden enkel met 2 vrije plaatsen.
 *
 * Run: npx tsx tests/sunday-auction.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Database, Loft, User } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { ensureAuctions, placeBid, auctionKind } from '../core/game/auction.js';
import { talent } from '../core/game/pigeon.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

function world(): { db: Database; store: MemoryStore; mk: (n: string) => Loft } {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const mk = (name: string) => {
    const u: User = { id: newId('usr'), username: name, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
    store.mutate((d) => d.users.push(u));
    return createLoftForUser(store, u, name);
  };
  return { db: store.data, store, mk };
}
const sundays = (db: Database) => db.auctions.filter((a) => a.status === 'open' && auctionKind(a) === 'sunday');
const brussels = (iso: string) => new Date(iso).toLocaleTimeString('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });

console.log('\n1. Vensters (zomertijd, zondag 4 oktober 2026)');
{
  const { db, mk } = world();
  mk('speler');
  ensureAuctions(db, Date.parse('2026-10-04T07:30:00Z')); // 09:30 Brussel
  ok(sundays(db).length === 0, 'om 09:30 nog niets');
  ensureAuctions(db, Date.parse('2026-10-04T08:30:00Z')); // 10:30
  ok(sundays(db).length === 1 && sundays(db)[0].templateKey.endsWith(':a'), 'om 10:30 enkel duif A');
  ensureAuctions(db, Date.parse('2026-10-04T09:30:00Z')); // 11:30
  const [a, b] = ['a', 'b'].map((k) => sundays(db).find((x) => x.templateKey.endsWith(':' + k))!);
  ok(!!a && !!b, 'om 11:30 allebei');
  ok(brussels(a.endAt) === '20:00' && brussels(b.endAt) === '21:00', `A sluit ${brussels(a.endAt)}, B sluit ${brussels(b.endAt)}`);
  ensureAuctions(db, Date.parse('2026-10-04T09:31:00Z'));
  ok(sundays(db).length === 2, 'nog eens openen: nog steeds twee');
  const player = db.lofts.find((l) => !l.isBot)!;
  const opens = db.notifications.filter((n) => n.userId === player.userId && n.title.includes('Zondagveiling'));
  ok(opens.length === 2, `twee meldingen (één per duif), niet meer: ${opens.length}`);
  const beforeShelter = db.auctions.filter((x) => auctionKind(x) === 'shelter').length;
  db.world.lastShelterSpawn = '2026-09-01T00:00:00.000Z'; // overdue: would spawn at once
  ensureAuctions(db, Date.parse('2026-10-04T18:30:00Z')); // 20:30: only B still open
  ok(sundays(db).length === 1 && sundays(db)[0].templateKey.endsWith(':b'), 'om 20:30 is A gesloten, B loopt nog');
  ok(db.auctions.filter((x) => auctionKind(x) === 'shelter').length === beforeShelter, 'geen opvangcentrum zolang een zondagveiling loopt');
}

console.log('\n2. Wintertijd (zondag 1 november 2026)');
{
  const { db } = world();
  ensureAuctions(db, Date.parse('2026-11-01T10:30:00Z')); // 11:30 CET
  const a = sundays(db).find((x) => x.templateKey.endsWith(':a'))!;
  const b = sundays(db).find((x) => x.templateKey.endsWith(':b'))!;
  ok(brussels(a.startAt) === '10:00' && brussels(a.endAt) === '20:00', `A: ${brussels(a.startAt)}–${brussels(a.endAt)}`);
  ok(brussels(b.startAt) === '11:00' && brussels(b.endAt) === '21:00', `B: ${brussels(b.startAt)}–${brussels(b.endAt)}`);
}

console.log('\n3. De scoreband klopt (40 zondagen)');
{
  const { db } = world();
  let good = 0, total = 0;
  const first = Date.parse('2026-10-04T10:30:00Z'); // 12:30 CEST, 11:30 CET: both windows open all year
  for (let w = 0; w < 40; w++) {
    ensureAuctions(db, first + w * 7 * 86400000);
    for (const x of sundays(db)) {
      const p = db.pigeons.find((q) => q.id === x.pigeonId)!;
      const t = talent(p);
      total++;
      if (x.templateKey.endsWith(':a') ? t >= 60 && t < 70 : t >= 70 && t < 80) good++;
    }
    for (const x of sundays(db)) x.status = 'closed';
  }
  ok(total === 80 && good === total, `${good}/${total} duiven in hun band`);
}

console.log('\n4. De overgangszondag: geen derde veiling');
{
  const { db } = world();
  db.auctions.push({
    id: 'auc_legacy', templateKey: 'auction:2026-10-4', pigeonId: 'pig_x', startAt: '2026-10-04T09:00:00.000Z',
    endAt: '2026-10-04T18:00:00.000Z', minBid: 300, minIncrement: 25, currentBid: 0, currentBidderId: null,
    currentBidderName: null, bids: [], status: 'open',
  });
  ensureAuctions(db, Date.parse('2026-10-04T09:30:00Z'));
  ok(sundays(db).length === 1, 'de oude veiling van die dag blijft de enige');
}

console.log('\n5. Twee vrije plaatsen om op beide te bieden');
{
  const { db, mk } = world();
  const alice = mk('alice');
  const bob = mk('bob');
  for (const l of [alice, bob]) l.money = 100000;
  const now = Date.parse('2026-10-04T09:30:00Z');
  ensureAuctions(db, now);
  const a = sundays(db).find((x) => x.templateKey.endsWith(':a'))!;
  const b = sundays(db).find((x) => x.templateKey.endsWith(':b'))!;
  const owned = (l: Loft) => db.pigeons.filter((p) => p.ownerId === l.userId).length;
  alice.capacity = owned(alice) + 1; // exactly one free place

  ok(placeBid(db, alice.userId, a.id, a.minBid) === null, 'alice (1 vrije plaats) biedt op A');
  const blocked = placeBid(db, alice.userId, b.id, b.minBid);
  ok(!!blocked && blocked.includes('2 vrije plaatsen'), 'op B bieden wordt geweigerd zolang ze A leidt');
  ok(placeBid(db, bob.userId, a.id, a.currentBid + a.minIncrement) === null, 'bob overbiedt alice op A');
  ok(placeBid(db, alice.userId, b.id, b.minBid) === null, 'nu mag alice op B bieden');
  const again = placeBid(db, alice.userId, a.id, a.currentBid + a.minIncrement);
  ok(!!again && again.includes('2 vrije plaatsen'), 'en terug op A kan niet meer, zolang ze B leidt');
  alice.capacity = owned(alice) + 2;
  ok(placeBid(db, alice.userId, a.id, a.currentBid + a.minIncrement) === null, 'met 2 vrije plaatsen mag ze op beide bieden');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
