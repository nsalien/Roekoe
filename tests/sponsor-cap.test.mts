/**
 * Seizoen 3, onderdeel 2: de sponsorlimiet.
 *
 *  - tier 4+ betaalt per dag een kwart (nieuw aanbod, heraanbod, bestaand contract
 *    en openstaand aanbod via migratie v54); tekengeld en podiumpremie niet;
 *  - hoogstens 6 sponsors; een zevende tekenen kan enkel door er een op te zeggen,
 *    tegen de gewone verbrekingsvergoeding; overstappen binnen een categorie blijft;
 *  - meer dan 6 bij de migratie → verplichte, gratis afbouw; tot dan betaalt geen
 *    sponsor (dagbedrag én podiumpremie), en er wordt niets nabetaald;
 *  - weigeren van een sponsor uit een HOGERE tier is nooit definitief.
 *
 * Run: npx tsx tests/sponsor-cap.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase, emptySponsorState } from '../core/schema.js';
import type { User, Loft } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { runDataMigrations } from '../core/game/schedule.js';
import {
  activeContracts, applyAcceptSponsor, applyReduceSponsors, applyRefuseSponsor,
  catalogDaily, sponsorsPaused, sponsorView,
} from '../core/game/sponsors.js';
import { dailyRunningCostBreakdown } from '../core/game/economy.js';
import { SPONSORS, SPONSOR_MAX_ACTIVE } from '../core/config/gameConfig.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const store = new MemoryStore(emptyDatabase());
seedWorld(store);
const db = store.data;
const mk = (name: string): Loft => {
  const u: User = { id: newId('usr'), username: name, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((d) => d.users.push(u));
  const l = createLoftForUser(store, u, name);
  l.sponsorship = emptySponsorState();
  l.money = 100000;
  return l;
};
const byCat = new Map<string, typeof SPONSORS[number]>();
for (const s of SPONSORS) if (!byCat.has(s.category)) byCat.set(s.category, s); // one per category
const oneEach = [...byCat.values()];
const tier4 = SPONSORS.filter((s) => s.tier >= 4);
const contract = (def: typeof SPONSORS[number]) =>
  ({ id: def.id, since: new Date().toISOString(), dailyStipend: def.dailyStipend, podiumBase: def.podiumBase });
const offer = (def: typeof SPONSORS[number]) =>
  ({ id: def.id, at: new Date().toISOString(), signingBonus: def.signingBonus, dailyStipend: catalogDaily(def), podiumBase: def.podiumBase });

console.log('\n1. Tier 4: een kwart per dag');
for (const d of tier4) ok(catalogDaily(d) === Math.round((d.dailyStipend * 0.25) / 5) * 5, `${d.name}: €${d.dailyStipend} → €${catalogDaily(d)}`);
ok(SPONSORS.filter((s) => s.tier < 4).every((d) => catalogDaily(d) === d.dailyStipend), 'tier 1–3 ongewijzigd');

console.log('\n2. Migratie v54 op bestaande contracten');
const big = mk('groot'); // 8 sponsors: one tier-4 among them
const eight = [tier4[0], ...oneEach.filter((d) => d.category !== tier4[0].category)].slice(0, 8);
big.sponsorship!.active = eight.map(contract);
big.sponsorship!.signed = eight.map((d) => d.id);
const t4offerDef = tier4.find((d) => d.category !== tier4[0].category)!;
big.sponsorship!.offers = [{ ...offer(t4offerDef), dailyStipend: t4offerDef.dailyStipend }]; // pending, old terms
const small = mk('klein');
small.sponsorship!.active = oneEach.slice(0, 3).map(contract);
db.world.dataVersion = 53;
runDataMigrations(db);
const t4 = big.sponsorship!.active.find((c) => c.id === tier4[0].id)!;
ok(t4.dailyStipend === catalogDaily(tier4[0]), `bestaand tier-4-contract → €${t4.dailyStipend}/dag`);
ok(t4.podiumBase === tier4[0].podiumBase, 'de podiumpremie blijft');
ok(big.sponsorship!.offers[0].dailyStipend === catalogDaily(t4offerDef), 'openstaand tier-4-aanbod ook verlaagd');
ok(sponsorsPaused(big) && !sponsorsPaused(small), 'hok met 8 sponsors moet afbouwen, hok met 3 niet');
ok(db.notifications.some((n) => n.id === `ntf:season3:sponsorcap:${big.userId}`), 'het grote hok krijgt de actiemelding');
ok(!db.notifications.some((n) => n.id === `ntf:season3:sponsorcap:${small.userId}`), 'het kleine niet');
runDataMigrations(db);
ok(big.sponsorship!.active.find((c) => c.id === tier4[0].id)!.dailyStipend === catalogDaily(tier4[0]), 'een tweede run verlaagt niet nog eens');

console.log('\n3. Zolang je moet afbouwen, betaalt niemand');
const bal = dailyRunningCostBreakdown(big, 8, 0, 0);
ok(bal.sponsorTotal === 0 && bal.sponsorsPaused === true, 'dagbalans: sponsors €0, met de reden erbij');
const moneyBefore = big.money;
ok(applyReduceSponsors(db, big, [eight[0].id]).startsWith('!'), 'één opzeggen volstaat niet (8 → 7)');
const res = applyReduceSponsors(db, big, [eight[6].id, eight[7].id]);
ok(!res.startsWith('!'), 'twee opzeggen lukt');
ok(big.money === moneyBefore, 'gratis: geen verbrekingsvergoeding');
ok(!sponsorsPaused(big) && activeContracts(big).length === SPONSOR_MAX_ACTIVE, `terug op ${SPONSOR_MAX_ACTIVE}, en ze betalen weer`);
ok(big.money === moneyBefore, 'niets nabetaald voor de gepauzeerde tijd');

console.log('\n4. Een zevende tekenen');
const newcomerDef = oneEach.find((d) => !activeContracts(big).some((c) => c.def.category === d.category))!;
big.sponsorship!.offers = [offer(newcomerDef)];
ok(applyAcceptSponsor(db, big, newcomerDef.id, false).startsWith('!'), 'zonder op te zeggen: geweigerd');
const dropDef = activeContracts(big)[0].def;
const m0 = big.money;
const bonus = big.sponsorship!.signed.includes(newcomerDef.id) ? 0 : newcomerDef.signingBonus; // only the first time
const r2 = applyAcceptSponsor(db, big, newcomerDef.id, false, dropDef.id);
ok(!r2.startsWith('!'), `met opzeggen van ${dropDef.name}: getekend`);
ok(activeContracts(big).length === SPONSOR_MAX_ACTIVE, 'nog steeds 6');
ok(big.money === m0 - dropDef.breakPenalty + bonus,
  `de gewone verbrekingsvergoeding (€${dropDef.breakPenalty}) is betaald, het tekengeld ontvangen`);
// Switching within a category at 6/6 needs nothing extra.
const inCat = activeContracts(big).find((c) => SPONSORS.some((s) => s.category === c.def.category && s.id !== c.def.id));
if (inCat) {
  const rival = SPONSORS.find((s) => s.category === inCat.def.category && s.id !== inCat.def.id)!;
  big.sponsorship!.offers = [offer(rival)];
  ok(!applyAcceptSponsor(db, big, rival.id, true).startsWith('!'), `overstappen binnen ${rival.categoryLabel} kan zonder extra opzegging`);
  ok(activeContracts(big).length === SPONSOR_MAX_ACTIVE, '...en het blijven er 6');
}

console.log('\n5. Weigeren van een hogere tier is nooit definitief');
const racing = SPONSORS.filter((s) => s.category === 'racing').sort((a, b) => a.tier - b.tier);
const r = mk('racer');
r.sponsorship!.active = [contract(racing[0])]; // tier 3, pays more per day now
r.sponsorship!.offers = [offer(racing[1])]; // tier 4, pays less per day
const view = sponsorView(db, r);
ok(view.offers[0].refusalIsFinal === false, `${racing[1].name} (tier ${racing[1].tier}) weigeren is niet definitief`);
applyRefuseSponsor(db, r, racing[1].id);
ok(!r.sponsorship!.declined.find((d) => d.id === racing[1].id)?.permanent, '...en wordt ook niet zo opgeslagen');
ok(view.maxActive === SPONSOR_MAX_ACTIVE, 'de sponsorpagina kent het maximum');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald`);
process.exit(fail === 0 ? 0 : 1);
