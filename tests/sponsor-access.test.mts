/**
 * Sponsors voor wie gewoon meevliegt (owner: "lagere spelers geraken moeizaam
 * aan sponsors — laat ze niet per se goed moeten eindigen").
 *
 * Wat de test bewaakt:
 *  - de niveau-route: elke sponsor komt ook binnen bereik op het niveau van
 *    zijn tier (SPONSOR_LEVEL_ROUTE), zonder zege, medaille of topduif;
 *  - de eigen eis blijft ook werken (een zege opent het café nog altijd);
 *  - een aanbod via de niveau-route krijgt de "trouwe deelnemer"-tekst, niet de
 *    tagline die een prestatie prijst;
 *  - deelnemen zonder podium geeft een kans (> 0), kleiner dan een podium.
 *
 * Run: npx tsx tests/sponsor-access.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase, emptySponsorState } from '../core/schema.js';
import type { Loft, User } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { evaluateSponsorOffers, isSponsorUnlocked } from '../core/game/sponsors.js';
import { SPONSORS, SPONSOR_LEVEL_ROUTE, SPONSOR_OFFER_ON_PERFORMANCE } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const store = new MemoryStore(emptyDatabase());
seedWorld(store);
const db = store.data;
const mk = (name: string, level: number): Loft => {
  const u: User = { id: newId('usr'), username: name, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((d) => d.users.push(u));
  const l = createLoftForUser(store, u, name);
  l.sponsorship = emptySponsorState();
  l.level = level;
  l.totalWins = 0;
  l.seasonPoints = 0;
  l.stats = { ...(l.stats ?? {}), entries: 0, gold: 0 } as never;
  return l;
};
const weakBird = 40; // no sponsor asks for a talent this low

console.log('\n1. De niveau-route');
for (const tier of [1, 2, 3, 4]) {
  const lvl = SPONSOR_LEVEL_ROUTE[tier];
  const below = mk(`onder${tier}`, Math.max(0, lvl - 1));
  const at = mk(`op${tier}`, lvl);
  const defs = SPONSORS.filter((d) => d.tier === tier);
  ok(defs.every((d) => isSponsorUnlocked(at, d, weakBird)), `tier ${tier}: alle sponsors open op niveau ${lvl}, zonder prestaties`);
  if (lvl > 1) {
    ok(defs.some((d) => !isSponsorUnlocked(below, d, weakBird)), `tier ${tier}: op niveau ${lvl - 1} nog niet allemaal`);
  }
}

console.log('\n2. De eigen eis blijft werken');
const cafe = SPONSORS.find((d) => d.req.totalWins === 1)!;
const winner = mk('winnaar', 0);
winner.totalWins = 1;
ok(isSponsorUnlocked(winner, cafe, weakBird), `${cafe.name}: één zege volstaat nog altijd`);
const talentSponsor = SPONSORS.filter((d) => d.req.bestTalent != null).sort((a, b) => b.tier - a.tier)[0];
ok(isSponsorUnlocked(mk('topduif', 1), talentSponsor, talentSponsor.req.bestTalent!), `${talentSponsor.name}: een topduif volstaat nog altijd`);

console.log('\n3. Het aanbod');
const loyal = mk('trouw', 1);
const made = evaluateSponsorOffers(db, loyal, Date.now());
const offer = loyal.sponsorship!.offers[0];
const def = SPONSORS.find((d) => d.id === offer?.id);
ok(made && def?.tier === 1, `niveau 1 zonder zege krijgt een tier-1-aanbod (${def?.name})`);
const note = db.notifications.filter((n) => n.userId === loyal.userId).at(-1);
const viaOwnReq = def ? def.req.totalWins == null && def.req.entries == null && def.req.bestTalent == null : false;
ok(viaOwnReq || !!note?.body.includes('trouwe deelnemer'), 'via de niveau-route: de "trouwe deelnemer"-tekst');

console.log('\n4. Deelnemen zonder podium');
const c = SPONSOR_OFFER_ON_PERFORMANCE;
ok(c.participationChance > 0 && c.participationChance < c.podiumChance, `kans ${c.participationChance} (> 0, < podium ${c.podiumChance})`);

console.log(`\n${fail ? '❌' : '✅'} ${pass} geslaagd, ${fail} gefaald`);
if (fail) process.exit(1);
