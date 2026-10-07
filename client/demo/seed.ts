/**
 * The ready-made demo world: the eight bots and the normal flight calendar
 * (exactly what a fresh production database gets), plus one loft for the demo
 * player, who is beheerder. That loft is set up to show off the loft view:
 * capacity 12 with 2 private compartments, a breeding pair on the nest, a
 * sick bird in the infirmary and six-day-old straw on the floor.
 */

import { D1Store, ensureSchema } from '../../core/d1.js';
import type { User } from '../../core/schema.js';
import { createLoftForUser, seedWorld, startBreeding } from '../../core/game/engine.js';
import { advanceRealtime } from '../../core/game/schedule.js';
import { generatePigeon } from '../../core/game/pigeon.js';
import { applyAilment, randomDisease } from '../../core/game/health.js';
import { nameKey, namesInUse } from '../../core/game/names.js';
import { computeLeaderboard } from '../../core/presenters.js';
import { brusselsDayNumber } from '../../core/game/koppels.js';
import type { DemoD1 } from './d1';

export const DEMO_USER_ID = 'usr_demo';
export const DEMO_USERNAME = 'demo';

const DEMO_CAPACITY = 12;
const DEMO_COMPARTMENTS = 2;
/** Leave two perches free, so a tap on an empty one shows the way to the market. */
const DEMO_BIRDS = 10;

async function schemaUpToDate(d1: DemoD1): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if (await ensureSchema(d1 as any)) return;
  }
}

export async function createDemoWorld(d1: DemoD1): Promise<void> {
  const db = d1 as any;
  // ensureSchema records its progress on the world row, so it needs one to
  // finish (the same row a fresh install gets; seeding fills in the rest).
  d1.sql.run('INSERT INTO world (id, current_week, season_year, seeded) VALUES (1, 1, 1, 0)');
  await schemaUpToDate(d1);

  // 1. What production does on its very first request: seed the bots, then
  //    run the real-time engine (migrations, flight calendar, auctions).
  let store = await D1Store.load(db);
  seedWorld(store);
  await store.persist();
  store = await D1Store.load(db);
  const nowMs = Date.now();
  advanceRealtime(store.data, nowMs, new Map());
  store.data.world.lastAdvance = new Date(nowMs).toISOString();
  await store.persist();

  // 2. The demo player, created like a registration — then given a bigger loft.
  store = await D1Store.load(db, DEMO_USER_ID);
  const user: User = {
    id: DEMO_USER_ID,
    username: DEMO_USERNAME,
    passwordHash: '!', // nobody logs in with a password in the demo
    isAdmin: true,
    isBot: false,
    createdAt: new Date().toISOString(),
  };
  store.mutate((w) => w.users.push(user));
  const loft = createLoftForUser(store, user, 'Hok De Demo');

  store.mutate((w) => {
    loft.capacity = DEMO_CAPACITY;
    loft.compartments = DEMO_COMPARTMENTS;
    loft.money = 30000; // enough to try the whole hokinrichting
    loft.doctors = 1;
    // Straw strewn six days ago: the meter is low, so fresh straw shows its effect.
    loft.equipment = { hygiene: 58, lastStrawAt: new Date(Date.now() - 6 * 86400000).toISOString(), cleaner: false };
    const taken = namesInUse(w.pigeons);
    const mine = () => w.pigeons.filter((p) => p.ownerId === user.id);
    // Make sure there is a doffer and a duivin to pair, then fill up.
    const wanted: ('doffer' | 'duivin' | undefined)[] = ['doffer', 'duivin'];
    while (mine().length < DEMO_BIRDS) {
      const p = generatePigeon({
        ownerId: user.id,
        currentWeek: w.world.currentWeek,
        quality: 0.4 + Math.random() * 0.25,
        sex: wanted.shift(),
        taken,
      });
      taken.add(nameKey(p.name));
      w.pigeons.push(p);
    }
    for (const p of mine()) p.form = Math.max(p.form, 60);
    // Two birds in their own compartment.
    mine().slice(0, DEMO_COMPARTMENTS).forEach((p) => (p.compartment = true));
  });

  // 3. One koppel on the nest (a koppel first, then the nest through the real engine call).
  const birds = store.data.pigeons.filter((p) => p.ownerId === user.id && !p.compartment);
  const sire = birds.find((p) => p.sex === 'doffer');
  const dam = birds.find((p) => p.sex === 'duivin');
  if (sire && dam) {
    const iso = new Date().toISOString();
    loft.equipment = { ...loft.equipment!, couples: [{ dofferId: sire.id, duivinId: dam.id, status: 'koppel', startedAt: iso, since: iso }] };
    startBreeding(store, user.id, sire.id, dam.id);
  }

  // 4. One sick bird, resting in the infirmary.
  store.mutate((w) => {
    const busy = new Set(w.breedingPairs.flatMap((bp) => [bp.sireId, bp.damId]));
    const patient = w.pigeons.find((p) => p.ownerId === user.id && !p.compartment && !busy.has(p.id));
    if (patient) {
      applyAilment(patient, randomDisease(w.world.currentWeek, 60));
      patient.inInfirmary = true;
    }
    // Two free birds in the main loft that drew together on their own: the
    // "koppel bevestigen?" offer on the Kweek page.
    const taken = new Set([...w.breedingPairs.flatMap((bp) => [bp.sireId, bp.damId]), patient?.id]);
    const freeBirds = w.pigeons.filter((p) => p.ownerId === user.id && !p.compartment && !p.inInfirmary && !taken.has(p.id));
    const d = freeBirds.find((p) => p.sex === 'doffer');
    const h = freeBirds.find((p) => p.sex === 'duivin');
    if (d && h) {
      const day = brusselsDayNumber(Date.now());
      loft.equipment = { ...loft.equipment!, attractions: [{ dofferId: d.id, duivinId: h.id, day, expiresDay: day + 3 }] };
    }
    w.world.leaderboard = JSON.stringify(computeLeaderboard(w));
  });
  await store.persist();
}
