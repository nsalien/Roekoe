/**
 * Bot behaviour. Bots are ordinary lofts with `isBot` set; the engine lets them
 * make simple, sensible decisions so human players always have competition in
 * the flights. Deliberately lightweight and easy to make smarter later.
 *
 * Two entry points:
 * - `botDailyActions` — the real-time housekeeping, run once per day boundary
 *   from `schedule.tickDailyCare`. This is where a bot SPENDS its money: food,
 *   infirmary staff and beds, rest cures, a coach, loft space and breeding.
 * - `botTakeWeeklyActions` — the legacy weekly pass, still wired to the admin
 *   "Volgende week" button.
 *
 * Why the daily pass exists: bots used to eat and train and nothing else, so a
 * bot flock could only shrink (age, illness and flights take birds; nothing put
 * any back) while its bank grew into the tens of thousands. Within a couple of
 * months there were barely enough bots left to fill a flight — and never enough
 * to field a three-bird estafette team.
 *
 * Every spend is gated on a cash floor (`BOT.reserve` and the per-action
 * reserves): a bot that lets its till go negative would be locked out of
 * entering flights, which is the opposite of the point.
 */

import {
  BOT,
  BREEDING,
  FEED_RATIONS,
  INFIRMARY,
  INFIRMARY_CAPACITY_TIERS,
  LOFT_CAPACITY_TIERS,
  REST_CURE,
  TRAINING,
  ageCategoryFor,
} from '../config/gameConfig.js';
import type { FeedRationKey } from '../config/gameConfig.js';
import type { Database, Flight, Loft, Pigeon } from '../schema.js';
import { newId } from '../store.js';
import { expectedFlightEnergyCost, pigeonCommittedToFlight } from './flight.js';
// The sale itself and the "bird leaves the world" cleanup live in engine.ts, so a
// bot's purchase is literally the same transaction as a player's. engine.ts also
// imports from here (botTakeWeeklyActions), which makes this a module cycle —
// safe because both sides only ever call each other from inside a function, never
// while the module is evaluating. `advance-throttle`/`age-cup` exercise the path.
import { purgePigeon, settlePigeonSale } from './engine.js';
import { valuePigeon } from './market.js';
import { makeOffer } from './offers.js';
import { ageInWeeks, canRace, experienceGain, isAway, noteAttrChange, onRestCure, talent, trainCeil, trainingCost } from './pigeon.js';
import { clamp, round1 } from './util.js';

/** What a bot may spend right now without dipping under its cash floor. */
function spendable(loft: Loft, reserve: number = BOT.reserve): number {
  return loft.money - reserve;
}

/** Bots isolate and (if they can afford it) treat their ailing birds. */
function manageInfirmary(loft: Loft, pigeons: Pigeon[]): void {
  const active = pigeons;
  // Free up healthy birds resting in the infirmary.
  for (const p of active) if (p.inInfirmary && !p.ailment) p.inInfirmary = false;
  // Move ailing birds into the infirmary up to capacity.
  let free = loft.infirmaryCapacity - active.filter((p) => p.inInfirmary).length;
  for (const p of active) {
    if (free <= 0) break;
    if (p.ailment && !p.inInfirmary) {
      p.inInfirmary = true;
      free--;
    }
  }
  const sickIn = active.filter((p) => p.inInfirmary && p.ailment?.kind === 'ziekte').length;
  const injIn = active.filter((p) => p.inInfirmary && p.ailment?.kind === 'kwetsuur').length;
  if (loft.money > 1500 && sickIn + injIn > 0) {
    loft.medicatedFood = true;
    loft.doctors = loft.money > 2600 ? Math.ceil(sickIn / INFIRMARY.birdsPerDoctor) : 0;
    loft.physios = loft.money > 2600 ? Math.ceil(injIn / INFIRMARY.birdsPerPhysio) : 0;
  } else {
    loft.medicatedFood = false;
    loft.doctors = 0;
    loft.physios = 0;
  }
}

/**
 * What a bot feeds. Herstelvoer costs the same €3/kg as Normaal but returns
 * +42 energie / +12 gezondheid a week instead of +21/+5, so any bot with a bank
 * worth the name should be on it: a bird racing two or three times a week loses
 * more gezondheid than Normaal replaces, and that slow bleed — not money, not
 * bad luck — is what wore bot flocks down to nothing.
 */
function chooseRation(loft: Loft): FeedRationKey {
  return loft.money > BOT.goodFeedFrom ? 'herstel' : 'normal';
}

/** Keep a few weeks of the loft's ration in stock. */
function restockFood(loft: Loft, pigeons: Pigeon[], ration: FeedRationKey): void {
  const weeklyNeed = pigeons.length * FEED_RATIONS[ration].foodPerPigeon;
  if ((loft.food[ration] ?? 0) >= weeklyNeed) return;
  const want = weeklyNeed * BOT.foodWeeksBuffer - (loft.food[ration] ?? 0);
  // Food comes before every other spend — a starving flock dies within days, so
  // this one deliberately digs below BOT.reserve.
  const price = FEED_RATIONS[ration].pricePerKg;
  const affordable = Math.floor(Math.max(0, loft.money - 300) / price);
  const buy = Math.min(want, affordable);
  if (buy <= 0) return;
  loft.food[ration] = round1((loft.food[ration] ?? 0) + buy);
  loft.money -= Math.round(buy * price);
}

/** Buy an extra infirmary bed when the ward is full and there is cash to spare. */
function maybeUpgradeInfirmary(loft: Loft, pigeons: Pigeon[]): void {
  const patients = pigeons.filter((p) => p.ailment).length;
  if (patients <= loft.infirmaryCapacity) return;
  const tier = INFIRMARY_CAPACITY_TIERS.find((t) => t.capacity > loft.infirmaryCapacity);
  if (!tier || spendable(loft) < tier.price) return;
  loft.money -= tier.price;
  loft.infirmaryCapacity = tier.capacity;
}

/**
 * Put a spent bird on a paid rest cure. Same rules as a player: one cure per
 * bird per week (counted from the start of its previous cure), not while it is
 * entered for a flight, and never on a bird that is already topped up.
 */
function maybeRestCure(db: Database, loft: Loft, pigeons: Pigeon[], nowMs: number): void {
  if (spendable(loft, BOT.restCureReserve) < REST_CURE.cost) return;
  const candidate = pigeons
    .filter(
      (p) =>
        p.form < BOT.restCureBelowForm &&
        !onRestCure(p, nowMs) &&
        !isAway(p) &&
        !(p.form >= 100 && p.health >= 100) &&
        !pigeonCommittedToFlight(db, p.id, nowMs) &&
        (!p.lastRestCureAt ||
          nowMs - Date.parse(p.lastRestCureAt) >= REST_CURE.cooldownDays * 86400000),
    )
    .sort((a, b) => talent(b) - talent(a))[0];
  if (!candidate) return;
  loft.money -= REST_CURE.cost;
  loft.lastRestCure = new Date(nowMs).toISOString();
  candidate.lastRestCureAt = new Date(nowMs).toISOString();
  candidate.cureUntil = new Date(nowMs + REST_CURE.durationHours * 3600000).toISOString();
}

/**
 * Keep a coach on the best birds while the bank allows it, and let the coach go
 * as soon as it does not — a coach is a pure daily salary (COACH.dailySalary),
 * so an unaffordable one just bleeds the loft dry.
 */
function manageCoaches(loft: Loft, pigeons: Pigeon[]): void {
  const coached = pigeons.filter((p) => p.coached);
  if (spendable(loft, BOT.coachReserve) <= 0) {
    for (const p of coached) p.coached = false;
    return;
  }
  const want = pigeons
    .filter((p) => !isAway(p) && !p.ailment)
    .sort((a, b) => talent(b) - talent(a))
    .slice(0, BOT.maxCoached);
  const wantIds = new Set(want.map((p) => p.id));
  for (const p of coached) if (!wantIds.has(p.id)) p.coached = false;
  for (const p of want) if (!p.coached) p.coached = true;
}

/**
 * Grow the loft when it is actually full. Deliberately conservative: the ladder
 * is steep (€1.500 → €50.000) and every extra perch also raises the daily
 * upkeep band, so a bot only buys a tier it can pay for several times over.
 */
function maybeUpgradeCapacity(loft: Loft, pigeons: Pigeon[]): void {
  if (pigeons.length < loft.capacity) return;
  if (loft.capacity >= BOT.maxCapacity) return;
  const tier = LOFT_CAPACITY_TIERS.find((t) => t.capacity > loft.capacity);
  if (!tier || tier.capacity > BOT.maxCapacity) return;
  if (spendable(loft) < tier.price * BOT.capacityReserveFactor) return;
  loft.money -= tier.price;
  loft.capacity = tier.capacity;
}

/** Whether this bird is free to be paired up right now. */
function canBreed(db: Database, p: Pigeon, nowMs: number): boolean {
  return (
    !p.ailment &&
    !p.inInfirmary &&
    !onRestCure(p, nowMs) &&
    !isAway(p) &&
    p.form >= BREEDING.minParentForm &&
    p.libido >= BOT.breedMinLibido &&
    !db.breedingPairs.some((bp) => bp.sireId === p.id || bp.damId === p.id) &&
    !pigeonCommittedToFlight(db, p.id, nowMs)
  );
}

/**
 * Breed young when there is a free perch. This is the piece that actually keeps
 * a bot flock alive: without it deaths are one-way and the field empties out.
 * The hatch itself runs in real time (`tickBreedingHatch`), which also refuses
 * young that no longer fit.
 */
function maybeBreed(db: Database, loft: Loft, pigeons: Pigeon[], nowMs: number): void {
  if (pigeons.length >= loft.capacity) return;
  const pairs = db.breedingPairs.filter((bp) => bp.ownerId === loft.userId).length;
  if (pairs >= BOT.maxPairs) return;
  // Never pair up more birds than the free perches can hold once they hatch.
  if (pairs >= loft.capacity - pigeons.length) return;
  if (spendable(loft, BOT.breedReserve) < BREEDING.cost) return;
  const free = pigeons.filter((p) => canBreed(db, p, nowMs));
  // Pair the best genes available — that is how a bot lifts its own level.
  const sire = free.filter((p) => p.sex === 'doffer').sort((a, b) => talent(b) - talent(a))[0];
  const dam = free.filter((p) => p.sex === 'duivin').sort((a, b) => talent(b) - talent(a))[0];
  if (!sire || !dam) return;
  loft.money -= BREEDING.cost;
  sire.form = round1(clamp(sire.form - 15, 0, 100));
  dam.form = round1(clamp(dam.form - 15, 0, 100));
  db.breedingPairs.push({
    id: newId('brd'),
    ownerId: loft.userId,
    sireId: sire.id,
    damId: dam.id,
    hatchAt: new Date(nowMs).toISOString(),
    createdAtWeek: db.world.currentWeek,
  });
  loft.stats.broods += 1;
}

const ATTRS = ['speed', 'endurance', 'orientation'] as const;

/** May this bird still be trained on this attribute this week? Same rule as a player. */
function trainReady(p: Pigeon, attr: (typeof ATTRS)[number], nowMs: number): boolean {
  const last = p.trainedAt?.[attr];
  if (!last) return true;
  const t = Date.parse(last);
  return Number.isNaN(t) || nowMs - t >= TRAINING.cooldownDays * 86400000;
}

/**
 * Invest in training, by exactly the rules a player plays by.
 *
 * This used to be ONE bird, ONE random attribute, on a 15% daily roll — about a
 * single training a week for the whole loft, while a player may train every bird
 * on every attribute once a week. Measured over eight weeks, that gap (not the
 * coach, which bots max out) is what let bot flocks drift behind while their
 * banks climbed past €30.000.
 *
 * Now up to `BOT.trainPerDay` birds a day, spending on the best bird whose
 * cheapest attribute it can afford — and, new, honouring `TRAINING.cooldownDays`
 * per attribute, which the old version quietly ignored.
 */
function maybeTrain(loft: Loft, pigeons: Pigeon[], nowMs: number, limit: number): void {
  const fit = pigeons
    .filter((p) => p.form > TRAINING.formCost + 20 && !isAway(p) && !p.ailment && !onRestCure(p, nowMs))
    .sort((a, b) => talent(b) - talent(a));
  let done = 0;
  for (const p of fit) {
    if (done >= limit) break;
    if (spendable(loft, BOT.trainReserve) <= 0) break;
    // Cheapest attribute first: it is the one furthest from its ceiling, which is
    // also where a point is worth most.
    const options = ATTRS
      .filter((a) => p[a] < trainCeil(p, a) && trainReady(p, a, nowMs))
      .sort((a, b) => trainingCost(p[a]) - trainingCost(p[b]));
    const attr = options[0];
    if (!attr) continue;
    const cost = trainingCost(p[attr]);
    if (spendable(loft, BOT.trainReserve) < cost) continue;
    const before = p[attr];
    p[attr] = round1(clamp(p[attr] + TRAINING.attributeGain, 0, trainCeil(p, attr)));
    noteAttrChange(p, attr, before, 'training');
    p.form = round1(clamp(p.form - TRAINING.formCost, 0, 100));
    p.experience = round1(clamp(p.experience + experienceGain(p.experience, TRAINING.experienceGain), 0, 100));
    (p.trainedAt ??= {})[attr] = new Date(nowMs).toISOString();
    loft.money -= cost;
    done += 1;
  }
}

/**
 * Shop on the player market.
 *
 * A bot buys when the bird is a genuine upgrade: it has room to spare, or the
 * bird beats the worst bird it owns by `BOT.marketMinGain` — in which case it
 * lets that worst one go to make the place. Same transaction as a player's
 * purchase (`settlePigeonSale`), so the seller gets paid, gets the badge and the
 * sale still counts as a price observation for the market.
 *
 * ⚠️ Two guards that are load-bearing, not decoration:
 *  - **The price ceiling.** A player names their own asking price. Without
 *    `BOT.marketMaxOverpay` anyone could list their worst bird at €40.000 and
 *    drain every bot in the club — a money printer, not a market.
 *  - **Bot lofts are skipped as sellers.** Bots trading with each other would
 *    just shuffle money between them and pollute the valuation with prices no
 *    human ever agreed to.
 * At most one purchase a day, so a bot cannot hoover the whole market in one tick.
 */
function maybeBuyFromMarket(db: Database, loft: Loft, pigeons: Pigeon[], nowMs: number): void {
  const budget = Math.min(spendable(loft, BOT.marketReserve), loft.money * BOT.marketMaxShare);
  if (budget <= 0) return;

  // What could leave, if it comes to that: never a bird that is racing, on a nest,
  // on a cure or still finding its way home.
  const onNest = new Set(db.breedingPairs.flatMap((bp) => [bp.sireId, bp.damId]));
  const expendable = pigeons
    .filter((p) => !isAway(p) && !onNest.has(p.id) && !onRestCure(p, nowMs) && !pigeonCommittedToFlight(db, p.id, nowMs))
    .sort((a, b) => talent(a) - talent(b));
  const roomToSpare = pigeons.length < loft.capacity;
  const worst = expendable[0];
  if (!roomToSpare && !worst) return; // full, and nothing may be let go
  // With room to spare a bird only has to be no worse than what the loft already
  // has; when full it has to BEAT the bird it would push out, by enough to be
  // worth the swap. (An empty perch is not a reason to buy junk — a bot filling
  // up on talent-40 birds just waters down every flight it enters.)
  const floor = worst ? talent(worst) + (roomToSpare ? 0 : BOT.marketMinGain) : 0;

  const botIds = new Set(db.lofts.filter((l) => l.isBot).map((l) => l.userId));
  // Players get first look. A bird is only fair game once it has been on the
  // market for BOT.marketMinListedHours — bots shop at the 00:00 tick, so a bird
  // listed at 23:55 would otherwise be gone before anyone saw it appear.
  const ripeBefore = nowMs - BOT.marketMinListedHours * 3600000;
  let best: Pigeon | null = null;
  for (const p of db.pigeons) {
    if (!p.forSale || p.price == null) continue;
    if (p.ownerId === loft.userId || botIds.has(p.ownerId)) continue;
    // No stamp = listed before this rule existed, so it has been up for ages.
    if (p.listedAt && Date.parse(p.listedAt) > ripeBefore) continue;
    if (p.price > budget) continue;
    if (talent(p) <= floor) continue;
    if (p.price > valuePigeon(db, p, db.world.currentWeek).value * BOT.marketMaxOverpay) continue;
    if (!best || talent(p) > talent(best)) best = p;
  }
  if (!best) {
    // Nothing worth buying outright — but a player may have opened a listing for
    // bidding, and haggling is exactly what you do when the asking price is too
    // steep. See maybeBidOnMarket.
    maybeBidOnMarket(db, loft, budget, floor, ripeBefore, botIds);
    return;
  }

  if (!roomToSpare && worst) {
    // Make the place. Same as a player clicking "vrijlaten": no money back.
    purgePigeon(db, worst);
  }
  settlePigeonSale(db, loft, best);
  loft.stats.buys += 1;
}

/**
 * Haggle on a player's listing that carries a "bieden vanaf".
 *
 * Only reached when the bird could not simply be bought — the price was over
 * `BOT.marketMaxOverpay`, or over budget. The bot then offers what the bird is
 * WORTH rather than what is asked, inside `BOT.bidMinFactor..bidMaxFactor` of the
 * market valuation, and the seller decides. It never bids on a bot's bird (that
 * is refused anyway), never below the seller's floor, and never at or above the
 * asking price — at that point buying outright is the honest move.
 *
 * One bid per round, and at most `BOT.maxOpenBids` open at a time, so a bot can
 * never flood a seller's inbox.
 */
function maybeBidOnMarket(
  db: Database,
  loft: Loft,
  budget: number,
  floor: number,
  ripeBefore: number,
  botIds: Set<string>,
): void {
  if (budget <= 0) return;
  const open = db.offers.filter((o) => o.fromUserId === loft.userId).length;
  if (open >= BOT.maxOpenBids) return;

  let best: { pigeon: Pigeon; bid: number } | null = null;
  for (const p of db.pigeons) {
    if (!p.forSale || p.price == null || p.minBid == null) continue;
    if (p.ownerId === loft.userId || botIds.has(p.ownerId)) continue;
    if (p.listedAt && Date.parse(p.listedAt) > ripeBefore) continue;
    if (talent(p) <= floor) continue;
    if (db.offers.some((o) => o.pigeonId === p.id && o.fromUserId === loft.userId)) continue;

    // What the bot is willing to pay: a band around the bird's real value.
    const value = valuePigeon(db, p, db.world.currentWeek).value;
    const ceiling = Math.min(value * BOT.bidMaxFactor, budget, p.price - 1);
    const wanted = Math.max(p.minBid, Math.round(value * BOT.bidMinFactor));
    if (wanted > ceiling) continue; // the seller's floor is above what it is worth
    const bid = Math.round(Math.min(wanted, ceiling));
    if (bid <= 0) continue;
    if (!best || talent(p) > talent(best.pigeon)) best = { pigeon: p, bid };
  }
  if (!best) return;
  makeOffer(db, loft.userId, best.pigeon.id, best.bid);
}

/**
 * One day of bot housekeeping, run from `tickDailyCare` on each day boundary —
 * so it costs writes once a day, never per request. Order matters: food first
 * (a hungry flock dies), then care, then the investments.
 */
export function botDailyActions(db: Database, loft: Loft, pigeons: Pigeon[], nowMs: number): void {
  const ration = chooseRation(loft);
  loft.feedRation = ration;
  for (const p of pigeons) p.ration = ration;
  restockFood(loft, pigeons, ration);
  manageInfirmary(loft, pigeons);
  maybeUpgradeInfirmary(loft, pigeons);
  maybeRestCure(db, loft, pigeons, nowMs);
  manageCoaches(loft, pigeons);
  maybeUpgradeCapacity(loft, pigeons);
  maybeBreed(db, loft, pigeons, nowMs);
  maybeTrain(loft, pigeons, nowMs, BOT.trainPerDay);
  // Shopping last: whatever is left after food, care and training is what a bot
  // is genuinely free to spend. Reads `pigeons` before the purchase, which is
  // fine — the new bird needs no care until tomorrow's tick.
  maybeBuyFromMarket(db, loft, pigeons, nowMs);
}

/**
 * A bot's weekly housekeeping, kept for the admin "Volgende week" button. The
 * real cadence is `botDailyActions`; this only adds the odd training beat.
 * (Entering flights happens in real time — see schedule.ts — so not done here.)
 */
export function botTakeWeeklyActions(
  loft: Loft,
  pigeons: Pigeon[],
  _foodPricePerKg: number,
): void {
  const ration = chooseRation(loft);
  loft.feedRation = ration;
  for (const p of pigeons) p.ration = ration;
  manageInfirmary(loft, pigeons);
  maybeTrain(loft, pigeons, Date.now(), 1);
}

/**
 * The birds a bot is willing to put on the board for a flight, best first.
 *
 * How much energie a bird needs is the owner's judgement, not a rule of the
 * game — the only real rule is 1 energie (`enterFlight`). A bot judges it by the
 * route: enough to cover what the distance is expected to cost, plus headroom.
 * The **estafette skips that judgement entirely** (`BOT.minFormRelay` = 0):
 * fielding three birds is what counts there, exactly as a player may enter a
 * bird with 5 energie if they think it is worth it.
 *
 * `committed` holds the birds already tied up on that flight's calendar day —
 * the caller owns that set because it also grows as birds are entered.
 */
/**
 * Everything the entry pass needs that is the same for every bot and every
 * flight, worked out ONCE. Rebuilding this per bot per flight meant scanning the
 * whole pigeon table thousands of times on a request that has ~10 ms of CPU to
 * spend in total — see `tickBotEntries`.
 */
export interface BotEntryContext {
  week: number;
  byOwner: Map<string, Pigeon[]>;
  onNest: Set<string>;
}

export function botEntryContext(db: Database): BotEntryContext {
  const byOwner = new Map<string, Pigeon[]>();
  for (const p of db.pigeons) {
    const list = byOwner.get(p.ownerId);
    if (list) list.push(p);
    else byOwner.set(p.ownerId, [p]);
  }
  const onNest = new Set<string>();
  for (const bp of db.breedingPairs) {
    onNest.add(bp.sireId);
    onNest.add(bp.damId);
  }
  return { week: db.world.currentWeek, byOwner, onNest };
}

export function botRaceCandidates(
  ctx: BotEntryContext,
  loft: Loft,
  flight: Flight,
  committed: Set<string>,
): Pigeon[] {
  const owned = ctx.byOwner.get(loft.userId) ?? [];
  const free = owned.filter(
    (p) =>
      canRace(p, ctx.week) &&
      !committed.has(p.id) &&
      // Bots breed now, and a bird on a nest is no more available than a
      // player's would be (`enterFlight` refuses one).
      !ctx.onNest.has(p.id),
  );

  // A thinning loft keeps a breeding pair at home. Racing every fit bird leaves
  // only exhausted ones to pair up, which is how a bot flock quietly dies out.
  const held = new Set<string>();
  if (owned.length < BOT.breedReserveFlock) {
    const fit = free.filter((p) => p.form >= BREEDING.minParentForm && p.libido >= BOT.breedMinLibido);
    for (const sex of ['doffer', 'duivin'] as const) {
      const best = fit.filter((p) => p.sex === sex).sort((a, b) => talent(b) - talent(a))[0];
      if (best) held.add(best.id);
    }
    // Only actually hold them back if BOTH are there — one lone bird breeds nothing.
    if (held.size < 2) held.clear();
  }

  return free
    .filter((p) => {
      if (held.has(p.id)) return false;
      if (p.form < 1) return false; // the game's own floor
      // A leeftijdscriterium only accepts one age bracket — the same hard rule the
      // player's `enterFlight` applies. Everything else about the race is normal,
      // so the energy/health judgement below still decides whether to enter.
      if (flight.ageCat && ageCategoryFor(ageInWeeks(p, ctx.week)) !== flight.ageCat) return false;
      // The estafette skips the owner's judgement entirely; canRace still applies.
      if (flight.relay) return p.form >= BOT.minFormRelay;
      // A worn-down bird gets rested, not raced: low gezondheid is what turns a
      // race into an ailment, and an ailment into a dead bird.
      if (p.health < BOT.minHealthRace) return false;
      const needed = expectedFlightEnergyCost(p, flight.distanceKm) * BOT.raceHeadroom;
      return p.form >= Math.max(BOT.minFormRegular, needed);
    })
    .sort((a, b) => talent(b) + b.form - (talent(a) + a.form));
}
