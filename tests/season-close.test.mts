/**
 * Migratie v66 — seizoen 3 afsluiten en seizoen 4 starten (24 okt, op vraag van
 * de eigenaar), mét het leeftijdscriterium, dat normaal nog een seizoen liep.
 *
 * Productie draaide v66 nog met de code van vóór de leagues (5169df1). Sinds de
 * leagues (v67, die het criterium weghaalt) reikt v66 het criterium uit via
 * `closeCriterium`; deze test bewaakt dat een wereld die nog vóór v66 staat
 * daarmee nog altijd juist uitkomt — en dat de wereld zoals productie ze nu heeft
 * (v66 al gelopen) niets dubbel krijgt. Gedekt:
 *  1. een verse wereld (seizoen 1) blijft ongemoeid;
 *  2. nog seizoen 3 → de volledige uitreiking NU: melkers (Roekoe + premie),
 *     duiven (Vleugel) én criterium (geld + titel op de duif), alles gereset, en
 *     seizoen 4 start op dit moment voor vier volle weken; daarna is het
 *     criterium weg (v67);
 *  3. al seizoen 4 (de gewone wissel was er al, zonder criterium) → enkel het
 *     criterium, op het moment dat seizoen 3 eindigde; de seizoensklok en de
 *     melkersprijzen blijven zoals ze waren;
 *  4. productie zoals ze is (v66 al gelopen) → v67 betaalt geen criterium meer;
 *  5. twee keer draaien betaalt niets twee keer.
 *
 * Run: npx tsx tests/season-close.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Database, Loft, Pigeon, User } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { advanceRealtime } from '../core/game/schedule.js';
import { tickSeason } from '../core/game/season.js';
import { SEASON, SEASON_AWARDS } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const DAY = 86400000;
const SEASON_MS = SEASON.weeks * SEASON.weekDays * DAY;
const NOW = Date.parse('2026-10-24T10:00:00Z');
const CRITERIUM_AWARDS = [2000, 1600, 1200];
const iso = (ms: number) => new Date(ms).toISOString();

interface W { db: Database; humans: Loft[]; birdA: Pigeon; birdB: Pigeon }

/**
 * A world as production had it on 24 okt, before v66: season 3 with `left` ms to
 * go, the criterium in the second of its three seasons (anchored on the start of
 * season 2), three players with points, and two criterium leaders.
 */
function prodLike(left: number): W {
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const humans: Loft[] = [];
  for (let i = 0; i < 3; i++) {
    const u: User = { id: newId('usr'), username: `s${i}`, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: iso(NOW - 90 * DAY) };
    store.mutate((d) => d.users.push(u));
    humans.push(createLoftForUser(store, u, `Hok ${i}`));
  }
  const db = store.data;
  advanceRealtime(db, NOW - 3 * DAY); // every migration up to today (v66 on season 1 = no-op)

  const start = NOW + left - SEASON_MS;
  Object.assign(db.world, {
    dataVersion: 65, seasonYear: 3, seasonWeek: 4,
    seasonStartedAt: iso(start), seasonEndsAt: iso(start + SEASON_MS),
    ageCupStartedAt: iso(start - SEASON_MS), ageCupSeasonsDone: 1,
  });
  for (const l of db.lofts) { l.seasonPoints = 0; l.seasonWins = 0; l.awards = []; }
  [900, 600, 300].forEach((pts, i) => { humans[i].seasonPoints = pts; });
  for (const p of db.pigeons) { p.cup = undefined; p.seasonPeakSpeed = 0; p.seasonPodiums = 0; p.titles = undefined; }
  const birdA = db.pigeons.find((p) => p.ownerId === humans[0].userId)!;
  const birdB = db.pigeons.find((p) => p.ownerId === humans[1].userId)!;
  birdA.cup = { u1: { points: 120, wins: 2, best: 1400, races: 6 } };
  birdB.cup = { y12: { points: 80, wins: 1, best: 1300, races: 5 } };
  birdA.seasonPeakSpeed = 1500;
  return { db, humans, birdA, birdB };
}
const of = (l: Loft, season: number) => (l.awards ?? []).filter((a) => a.season === season);
const sum = (l: Loft, season: number) => of(l, season).reduce((s, a) => s + a.reward, 0);
const criteriumGone = (db: Database) =>
  !db.world.ageCupStartedAt && db.pigeons.every((p) => !p.cup) && !db.flights.some((f) => f.ageCat && f.status === 'scheduled');

// ---------------------------------------------------------------------------
console.log('\n1. Een verse wereld (seizoen 1) blijft ongemoeid');
{
  const store = new MemoryStore(emptyDatabase());
  seedWorld(store);
  const db = store.data;
  advanceRealtime(db, NOW);
  const started = db.world.seasonStartedAt;
  ok(db.world.dataVersion === 68 && db.world.seasonYear === 1, `v66–v68 gelopen, nog altijd seizoen ${db.world.seasonYear}`);
  advanceRealtime(db, NOW + 60000);
  ok(db.world.seasonStartedAt === started && db.lofts.every((l) => (l.awards ?? []).length === 0), 'geen uitreiking, de klok staat waar ze stond');
}

// ---------------------------------------------------------------------------
console.log('\n2. Nog seizoen 3 → alles uitreiken en seizoen 4 start nu');
{
  const { db, humans, birdA, birdB } = prodLike(6 * 3600000); // six hours before the natural end
  const money = humans.map((l) => l.money);
  advanceRealtime(db, NOW);
  const w = db.world;
  ok((w.dataVersion ?? 0) >= 67, 'v66 en v67 gelopen (v68 vult de bots in stappen bij)');
  ok(w.seasonYear === 4 && w.seasonWeek === 1, `seizoen ${w.seasonYear}, week ${w.seasonWeek}`);
  ok(w.seasonStartedAt === iso(NOW) && w.seasonEndsAt === iso(NOW + SEASON_MS),
     `seizoen 4 loopt van nu (${w.seasonStartedAt}) tot ${w.seasonEndsAt} — vier volle weken`);

  const roekoe = humans.map((l) => of(l, 3).find((a) => a.kind === 'roekoe'));
  ok(roekoe.every((a, i) => a?.rank === i + 1 && a.reward === SEASON_AWARDS.roekoe[i]),
     `melkers: Gouden/Zilveren/Bronzen Roekoe (€${SEASON_AWARDS.roekoe.join('/€')})`);
  ok(of(humans[0], 3).some((a) => a.kind === 'vleugel' && a.category === 'speed' && a.rank === 1),
     'duiven: de snelste duif krijgt de Gouden Vleugel');

  const cupA = of(humans[0], 3).find((a) => a.kind === 'criterium');
  const cupB = of(humans[1], 3).find((a) => a.kind === 'criterium');
  ok(cupA?.ageCat === 'u1' && cupA.rank === 1 && cupA.reward === CRITERIUM_AWARDS[0], `criterium < 1 j: 1e plaats, €${cupA?.reward}`);
  ok(cupB?.ageCat === 'y12' && cupB.rank === 1 && cupB.reward === CRITERIUM_AWARDS[0], `criterium 1–2 j: 1e plaats, €${cupB?.reward}`);
  ok((birdA.titles ?? []).some((t) => t.kind === 'criterium' && t.season === 3 && t.label === 'Gouden Criteriumduif < 1 j'),
     'de titel staat op de duif ("Gouden Criteriumduif < 1 j", seizoen 3)');
  ok((birdB.titles ?? []).some((t) => t.kind === 'criterium' && t.ageCat === 'y12'), 'ook op de duif van 1–2 j');

  ok(humans.every((l, i) => l.money === money[i] + sum(l, 3)), 'elk hok kreeg precies het bedrag van zijn prijzen');
  // (Bots can already hold season-4 points: the flights the same request settles
  // AFTER the rollover count for the new season, as they should.)
  ok(humans.every((l) => l.seasonPoints === 0) && [birdA, birdB].every((p) => !p.cup && p.seasonPeakSpeed === 0),
     'seizoenspunten, duivenranglijsten en criteriumstand staan op nul');
  ok(criteriumGone(db), 'en daarna is het criterium weg (v67): geen anker, geen stand, geen geplande vlucht');

  const bell = db.notifications.find((n) => n.id === `ntf:season:3:${humans[0].userId}`);
  ok(!!bell && /Prijsuitreiking seizoen 3/.test(bell.title), `de bel van de uitreiking: "${bell?.title}"`);
  const cupBell = db.notifications.find((n) => n.id === `ntf:criterium:close:${humans[0].userId}`);
  ok(!!cupBell && /Criteriumduif < 1 j/.test(cupBell.body), `en een bel voor het criterium: "${cupBell?.title}"`);

  // 5. Nog een keer draaien: niets dubbel.
  const again = humans.map((l) => [l.money, (l.awards ?? []).length]);
  advanceRealtime(db, NOW + 60000);
  ok(humans.every((l, i) => l.money === again[i][0] && (l.awards ?? []).length === again[i][1]) && w.seasonYear === 4,
     'een tweede verzoek betaalt niets twee keer (en blijft in seizoen 4)');
}

// ---------------------------------------------------------------------------
console.log('\n3. Al seizoen 4 (de gewone wissel was er al) → enkel het criterium');
{
  const { db, humans, birdA } = prodLike(-2 * 3600000); // season 3 ended two hours ago
  const naturalEnd = Date.parse(db.world.seasonEndsAt!);
  tickSeason(db, NOW); // the natural rollover: melkers and duiven, no criterium
  db.world.ageCupSeasonsDone = 2; // what the old code counted there (cycle not up)
  ok(db.world.seasonYear === 4 && db.world.seasonStartedAt === iso(naturalEnd), 'de gewone wissel: seizoen 4 sinds het natuurlijke einde');
  ok(of(humans[0], 3).some((a) => a.kind === 'roekoe') && !of(humans[0], 3).some((a) => a.kind === 'criterium'),
     'melkersprijzen uitgereikt, criterium nog niet');

  const money = humans.map((l) => l.money);
  const roekoes = humans.map((l) => of(l, 3).filter((a) => a.kind !== 'criterium').length);
  advanceRealtime(db, NOW + 5 * 60000);
  const cupA = of(humans[0], 3).find((a) => a.kind === 'criterium');
  ok(cupA?.rank === 1 && cupA.reward === CRITERIUM_AWARDS[0] && cupA.at === iso(naturalEnd),
     `criterium < 1 j uitgereikt (€${cupA?.reward}), gedateerd op het einde van seizoen 3`);
  ok(humans[0].money === money[0] + CRITERIUM_AWARDS[0] && humans[2].money === money[2], 'enkel het criteriumgeld erbij');
  ok(humans.every((l, i) => of(l, 3).filter((a) => a.kind !== 'criterium').length === roekoes[i]), 'de melkers- en duivenprijzen niet opnieuw');
  ok(db.world.seasonYear === 4 && db.world.seasonStartedAt === iso(naturalEnd), 'de seizoensklok blijft staan');
  ok((birdA.titles ?? []).some((t) => t.kind === 'criterium' && t.season === 3), 'de titel staat op de duif');
  ok(criteriumGone(db), 'daarna is het criterium weg (v67)');
  const bell = db.notifications.find((n) => n.id === `ntf:criterium:close:${humans[0].userId}`);
  ok(!!bell && /Criteriumduif < 1 j/.test(bell.body), `een eigen bel: "${bell?.title}"`);
  ok(!db.notifications.some((n) => n.id === `ntf:criterium:close:${humans[2].userId}`), 'wie niets won, krijgt er geen');

  const after = humans[0].money;
  advanceRealtime(db, NOW + 6 * 60000);
  ok(humans[0].money === after && of(humans[0], 3).filter((a) => a.kind === 'criterium').length === 1, 'een tweede verzoek betaalt niets twee keer');
}

// ---------------------------------------------------------------------------
console.log('\n4. Productie zoals ze nu is: v66 al gelopen → v67 betaalt geen criterium meer');
{
  const { db, humans, birdA } = prodLike(6 * 3600000);
  // What the old v66 left behind: season 4 from NOW, the criterium handed out with
  // season 3 and re-anchored on NOW with a clean slate.
  Object.assign(db.world, {
    dataVersion: 66, seasonYear: 4, seasonWeek: 1,
    seasonStartedAt: iso(NOW), seasonEndsAt: iso(NOW + SEASON_MS),
    ageCupStartedAt: iso(NOW), ageCupSeasonsDone: 0,
  });
  for (const p of db.pigeons) p.cup = undefined;
  birdA.titles = [{ kind: 'criterium', rank: 1, label: 'Gouden Criteriumduif < 1 j', icon: '🥇', season: 3, at: iso(NOW), ageCat: 'u1', value: 120 }];
  const money = humans.map((l) => l.money);
  advanceRealtime(db, NOW + 2 * 3600000);
  ok((db.world.dataVersion ?? 0) >= 67 && db.world.seasonYear === 4 && db.world.seasonStartedAt === iso(NOW), 'v67 gelopen, seizoen 4 onaangeroerd');
  ok(humans.every((l, i) => l.money === money[i]) && humans.every((l) => !(l.awards ?? []).some((a) => a.kind === 'criterium')),
     'geen criteriumgeld meer (de cyclus was net herbegonnen)');
  ok((birdA.titles ?? []).length === 1, 'de titel van seizoen 3 blijft op de duif');
  ok(criteriumGone(db), 'het criterium is weg');
  ok(humans.every((l) => db.notifications.some((n) => n.id === `ntf:news:leagues:${l.userId}`)), 'elke speler krijgt de aankondiging van de leagues');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
