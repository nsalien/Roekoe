/**
 * Hokoverzicht (⚠️ dev, nog niet live): "niet thuis" is wie in de lucht zit, in
 * de ziekenboeg ligt of de weg kwijt is. Een duif die enkel ingeschreven staat
 * voor een vlucht die nog moet beginnen, is gewoon thuis.
 *
 * Daarvoor draagt pigeonDTO naast `racing` (ook voor een geplande vlucht) een
 * smallere `flying`: waar, en enkel waar, zolang ze écht vliegt.
 *
 * Run: npx tsx tests/hokoverzicht.test.mts
 */
import { MemoryStore, newId } from '../core/store.js';
import { emptyDatabase } from '../core/schema.js';
import { seedWorld, createLoftForUser, enterFlight } from '../core/game/engine.js';
import { advanceRealtime, tickFlights } from '../core/game/schedule.js';
import { pigeonDTO } from '../core/presenters.js';
import type { User } from '../core/schema.js';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`)); };

const T0 = Date.parse('2026-08-24T04:00:00Z');
// pigeonDTO reads the clock itself: pin it per step.
let now = T0;
Date.now = () => now;

const store = new MemoryStore(emptyDatabase());
seedWorld(store);
let userId = '';
for (let i = 0; i < 3; i++) {
  const u: User = {
    id: newId('usr'), username: `speler${i}`, passwordHash: 'x',
    isAdmin: false, isBot: false, createdAt: new Date(T0).toISOString(),
  };
  store.mutate((d) => d.users.push(u));
  createLoftForUser(store, u, `Hok ${i}`);
  if (i === 0) userId = u.id;
}
advanceRealtime(store.data, T0);
const db = store.data;

const flight = db.flights
  .filter((f) => f.status === 'scheduled' && !f.ageCat && !f.relay && !f.titan)
  .sort((a, b) => a.startAt.localeCompare(b.startAt))[0]!;
// Every loft enters one bird, or the flight is called off for too few melkers.
let birdId = '';
for (const loft of db.lofts.filter((l) => !l.isBot)) {
  for (const p of db.pigeons.filter((x) => x.ownerId === loft.userId)) {
    if (enterFlight(store, loft.userId, flight.id, p.id) === null) {
      if (loft.userId === userId) birdId = p.id;
      break;
    }
  }
}
const bird = () => db.pigeons.find((p) => p.id === birdId)!;
const dto = () => pigeonDTO(db, bird(), userId);
const startMs = Date.parse(flight.startAt);

console.log('\n=== 1. Ingeschreven, de vlucht moet nog beginnen: thuis ===');
now = startMs - 3600_000;
ok(!!birdId, `duif ingeschreven voor ${flight.name}`);
ok(dto().racing === true, 'racing: ze is gebonden aan de vlucht');
ok(dto().flying === false, 'flying: nee, ze zit nog op het hok');

console.log('\n=== 2. Gelost: ze vliegt ===');
tickFlights(db, startMs + 1000);
ok(flight.status === 'live', `${flight.name} is gelost`);
const sim = flight.sim.find((s) => s.pigeonId === birdId)!;
const endS = Math.min(sim.dnfAtSeconds ?? Infinity, sim.durationSeconds);
now = startMs + 60_000;
ok(dto().flying === true && dto().racing === true, 'een minuut na de lossing: flying én racing');

console.log('\n=== 3. Over de streep, de vlucht loopt nog voor de anderen: weer thuis ===');
now = startMs + (endS + 60) * 1000;
ok(flight.status === 'live', 'de vlucht zelf is nog bezig');
ok(dto().flying === false, 'flying: nee, haar eigen race is voorbij');

console.log('\n=== 4. Andermans duif: hetzelfde publieke signaal als racing ===');
now = startMs + 60_000;
const rival = flight.entries.map((e) => db.pigeons.find((p) => p.id === e.pigeonId)!).find((p) => p.ownerId !== userId)!;
ok(pigeonDTO(db, rival, userId).flying === true, `${rival.name} (van een ander) staat ook als vliegend`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geslaagd, ${fail} gefaald\n`);
process.exit(fail === 0 ? 0 : 1);
