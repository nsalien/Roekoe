/**
 * Seizoen 3 — de aankondiging (migratie v56, seizoen3.md §5). Wat de test bewaakt:
 *  - precies één welkomstmelding en één coachmelding per echte speler, geen voor
 *    bots, stabiele id (een tweede run schrijft geen extra rij);
 *  - de regels met • verschijnen enkel als ze van toepassing zijn: geen
 *    kenmerken, geen coach, geen sponsors, meer dan 6 sponsors;
 *  - de coachmelding rekent met dezelfde functie als de dagafrekening
 *    (`coachBill`), het "was"-bedrag = gecoachte duiven × €80 min de gratis coach,
 *    de gratis starterscoach zit op de duurste duif, en zonder coach noemt ze de
 *    beste duif;
 *  - `world.newsAt` staat (start van de nieuwskaart op het Overzicht).
 *
 * Run: npx tsx tests/season3-news.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import type { Loft, User } from '../core/schema.js';
import { seedWorld, createLoftForUser } from '../core/game/engine.js';
import { runDataMigrations } from '../core/game/schedule.js';
import { coachBill } from '../core/game/newcomer.js';
import { talent } from '../core/game/pigeon.js';
import { COACH, SPONSORS } from '../core/config/gameConfig.js';
import { euro, season3Welcome } from '../core/game/season3.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const store = new MemoryStore(emptyDatabase());
seedWorld(store);
const db = store.data;
const mk = (name: string): Loft => {
  const u: User = { id: newId('usr'), username: name, passwordHash: 'x', isAdmin: false, isBot: false, createdAt: new Date().toISOString() };
  store.mutate((d) => d.users.push(u));
  return createLoftForUser(store, u, name);
};
const birdsOf = (l: Loft) => db.pigeons.filter((p) => p.ownerId === l.userId);
const contract = (id: string) => ({ id, since: '2026-09-01T00:00:00.000Z', dailyStipend: 10, podiumBase: 10 });

// Coach: two coached birds, still in the starter package (free coach).
const coach = mk('coach');
// Veteran: starter package over, three coached birds, some traits, 3 sponsors.
const vet = mk('vet');
vet.newcomer = null as never;
// Empty: no coach, no traits, no sponsors.
const empty = mk('empty');
// Crowded: 8 sponsors (the v54 action note takes over the sponsor line).
const crowded = mk('crowded');

for (const p of db.pigeons) p.trait = p.trait ?? null;
const cb = birdsOf(coach);
cb.forEach((p, i) => { p.coached = i < 2; });
cb[0].speed = 95; cb[0].endurance = 95; cb[0].orientation = 95; // make one clearly the dearest
const vb = birdsOf(vet);
vb.forEach((p, i) => { p.coached = i < 3; p.trait = i === 0 ? 'fond' : i === 1 ? 'night' : 'sturdy'; });
vb[0].speed = 90; vb[0].endurance = 90; vb[0].orientation = 90; // a dear bird: new total ≠ old
birdsOf(empty).forEach((p) => { p.coached = false; p.trait = null; });
birdsOf(coach).forEach((p) => { p.trait = null; });
vet.sponsorship.active = SPONSORS.slice(0, 3).map((s) => contract(s.id)) as never;
const cats = new Set<string>();
const eight = SPONSORS.filter((s) => (cats.has(s.category) ? false : (cats.add(s.category), true))).slice(0, 8);
crowded.sponsorship.active = eight.map((s) => contract(s.id)) as never;

// Snapshot what the daily bill will say, BEFORE the migration (v54 may touch sponsors, not coaches).
const nowMs = Date.now();
const billCoach = coachBill(coach, birdsOf(coach).filter((p) => p.coached), nowMs);
const billVet = coachBill(vet, birdsOf(vet).filter((p) => p.coached), nowMs);

db.world.dataVersion = 53; // v54 (sponsors), v55 (traits), v56 (this)
runDataMigrations(db);

const welcome = (l: Loft) => db.notifications.find((n) => n.id === `ntf:season3:welcome:${l.userId}`);
const coachNote = (l: Loft) => db.notifications.find((n) => n.id === `ntf:season3:coach:${l.userId}`);

console.log('\n1. Eén welkomst- en coachmelding per echte speler');
const players = db.lofts.filter((l) => !l.isBot);
const bots = db.lofts.filter((l) => l.isBot);
ok(players.every((l) => !!welcome(l) && !!coachNote(l)), `elke speler (${players.length}) heeft beide meldingen`);
ok(bots.length > 0 && bots.every((l) => !welcome(l) && !coachNote(l)), `geen enkele bot (${bots.length}) krijgt ze`);
ok(db.world.dataVersion! >= 56, 'dataVersion staat op 56');
ok(!!db.world.newsAt && Math.abs(Date.parse(db.world.newsAt) - nowMs) < 60000, 'world.newsAt staat op nu');
const count = db.notifications.length;
db.world.dataVersion = 55;
runDataMigrations(db);
ok(db.notifications.length === count, 'een tweede run schrijft geen extra rijen (stabiele id)');

console.log('\n2. De regels van de welkomstmelding');
const traitsOf = (l: Loft) => birdsOf(l).filter((p) => p.trait).length;
const wv = welcome(vet)!.body, we = welcome(empty)!.body, wc = welcome(crowded)!.body;
ok(wv.includes(`${traitsOf(vet)} van je duiven kregen een kenmerk`),
  `vet: het aantal kenmerken klopt (${traitsOf(vet)})`);
// v55 rolls birds without a trait, so strip them afterwards and rebuild the text.
birdsOf(empty).forEach((p) => { p.trait = null; });
ok(season3Welcome(db, empty, nowMs).body.includes('Geen van je duiven kreeg een kenmerk'), 'zonder kenmerk: de variant "Geen van je duiven…"');
ok(wv.includes('🎓') && wv.includes(`${euro(billVet.total)} per dag`), `vet: coachregel met ${euro(billVet.total)}`);
ok(!we.includes('🎓'), 'empty: geen coachregel');
ok(wv.includes('Je hebt 3 sponsors'), 'vet: sponsorregel');
ok(!we.includes('🤝'), 'empty: geen sponsorregel');
ok(!wc.includes('🤝'), 'crowded (8 sponsors): geen sponsorregel...');
ok(!!db.notifications.find((n) => n.id === `ntf:season3:sponsorcap:${crowded.userId}`), '...maar wel de actiemelding uit v54');
ok([wv, we, wc].every((b) => b.includes('⚡')), 'de ⚡-regel staat er altijd');

console.log('\n3. De coachmelding');
const cv = coachNote(vet)!.body;
const wasVet = 3 * COACH.dailySalary;
ok(billVet.total > wasVet, `vet: de nieuwe prijs ligt hoger dan de oude (${euro(billVet.total)} > ${euro(wasVet)})`);
ok(cv.includes(`Samen: ${euro(billVet.total)} per dag (was ${euro(wasVet)})`), `vet: totaal ${euro(billVet.total)}, was ${euro(wasVet)}`);
ok(billVet.perPigeon.every((r) => cv.includes(`— ${euro(r.salary)} per dag`)), 'vet: elk dagtarief staat erin');
ok(!cv.includes('🎁'), 'vet: geen starterscoach meer → geen 🎁-regel');
const cc = coachNote(coach)!.body;
const dearest = birdsOf(coach).find((p) => p.id === billCoach.perPigeon[0].pigeonId)!;
ok(cc.includes(`🎁 Je gratis starterscoach dekt je duurste duif: ${dearest.name}`), `coach: de gratis coach dekt ${dearest.name} (★${talent(dearest)})`);
ok(cc.includes(`Samen: ${euro(billCoach.total)} per dag (was ${euro(COACH.dailySalary)})`), `coach: totaal ${euro(billCoach.total)} na de gratis coach, was €80`);
const ce = coachNote(empty)!;
const best = [...birdsOf(empty)].sort((a, b) => talent(b) - talent(a))[0];
ok(ce.title.includes('nieuwe tarieven') && ce.body.includes(best.name), `empty: variant zonder coach noemt ${best.name}`);

console.log(`\n${fail ? '❌' : '✅'} ${pass} geslaagd, ${fail} gefaald`);
if (fail) process.exit(1);
