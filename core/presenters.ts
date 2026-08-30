/**
 * Presenters turn internal entities into the DTO shapes the client consumes,
 * adding computed fields (age, talent, value, eligibility) so the frontend
 * stays dumb and consistent. Keep these in sync with client/src/types.ts.
 */

import type { Database, Flight, Loft, Notification, Pigeon, RaceLogEntry, Trade } from './schema.js';
import type { PigeonLogs } from './d1.js';
import { AGE_CUP, AUCTION, BREED_RARITY, COACH, ageCategoryDef, ageCategoryFor, compartmentCost, RELAY, REST_CURE, TRAINING } from './config/gameConfig.js';
import {
  ageInWeeks,
  breedInfo,
  canRace,
  estimateValue,
  experienceGain,
  flightForm,
  geneCap,
  isAway,
  restPenalty,
  talent,
  trainCeil,
  trainingCost,
} from './game/pigeon.js';

/** Vluchtvorm bands for the risk badge: 🟢 fris / 🟡 matig / 🔴 risico. */
const FORM_GOOD = 70;
const FORM_FAIR = 45;
import { auctionKind } from './game/auction.js';
import { ageCupRankings, pigeonSeasonRankings } from './game/season.js';
import { bettingOpen } from './game/betting.js';
import { nextCapacityTier, nextInfirmaryTier, ownerName } from './game/engine.js';
import { coachDailyGain, dailyRunningCostBreakdown, projectDailyCare } from './game/economy.js';
import {
  billableCoachedCount,
  freeCoachCount,
  newcomerActive,
  newcomerDaysLeft,
  winningsMultiplier,
} from './game/newcomer.js';
import { coveredInInfirmary } from './game/health.js';
import { valuePigeon } from './game/market.js';
import { flightCancelled, flightCommentary, liveSnapshot, pigeonCommittedToFlight } from './game/flight.js';
import { relayEntryTeams, relayLegKm } from './game/relay.js';
import { BADGES, levelForXp } from './game/badges.js';
import { round1 } from './game/util.js';

/**
 * DTO for a pigeon. If `viewerId` is given and is NOT the owner, the bird's
 * individual attributes are WITHHELD (sent as null) — a player only sees what is
 * publicly known about someone else's pigeon: its general score (talent) and
 * estimated value, plus what races/rankings reveal. Own birds (or no viewer)
 * are fully revealed.
 *
 * `viewerIsAdmin` lifts the veil for the game master only: the admin console must
 * be able to audit ANY bird (the Duif-inspector links straight to a pigeon page),
 * so an admin sees every attribute. Regular players never do.
 */
export function pigeonDTO(db: Database, p: Pigeon, viewerId?: string, viewerIsAdmin = false) {
  const week = db.world.currentWeek;
  const owner = db.lofts.find((l) => l.userId === p.ownerId);
  // Attributes are public when: there is no specific viewer (server-internal),
  // the viewer owns the bird, the bird is openly listed for sale on the market, OR
  // it is under the hammer in a running auction — in all of those cases a buyer
  // must be able to see what they are bidding on. Only a bird that is NOT on offer
  // anywhere, viewed by someone else (to make a private/direct offer), hides its
  // attributes.
  const onAuction = db.auctions.some((a) => a.status === 'open' && a.pigeonId === p.id);
  const publiclyRevealed = viewerId === undefined || p.ownerId === viewerId || p.forSale || onAuction;
  const revealed = publiclyRevealed || viewerIsAdmin;
  const live = db.flights.some((f) => f.status === 'live' && f.entries.some((e) => e.pigeonId === p.id));
  // Only an infirmary bird's energie recovery depends on staff coverage, so we
  // only run the (rare) coverage scan for those — the common path stays cheap.
  const infirmaryCovered =
    p.inInfirmary && owner
      ? coveredInInfirmary(owner, db.pigeons.filter((x) => x.ownerId === owner.userId)).has(p.id)
      : false;
  // Deliberately on the PUBLIC reveal, not the admin one: this is the owner's own
  // care projection (useless to a viewer), and running it for every bird would add
  // real CPU to /market — which an admin loads like anyone else.
  const dailyCare = publiclyRevealed && owner && !owner.isBot ? projectDailyCare(owner, p, live, infirmaryCovered) : null;
  const hide = <T,>(v: T): T | null => (revealed ? v : null);
  return {
    id: p.id,
    ownerId: p.ownerId,
    ownerName: ownerName(db, p.ownerId),
    ownerIsBot: owner?.isBot ?? false,
    name: p.name,
    sex: p.sex,
    ageWeeks: ageInWeeks(p, week),
    revealed,
    // Withheld for other players' pigeons (only the general score is public).
    speed: hide(p.speed),
    endurance: hide(p.endurance),
    orientation: hide(p.orientation),
    libido: hide(p.libido),
    form: hide(p.form),
    health: hide(p.health),
    experience: hide(p.experience),
    talent: talent(p), // the "algemene score" — publicly known (via weddenschappen/ranglijst)
    // Breed (ras) is PUBLIC — its photo is shown for everyone's birds. Cosmetic
    // only; rarity gives a small price premium (already folded into `value`).
    breed: (() => {
      const b = breedInfo(p.breed);
      return { id: b.id, name: b.name, rarity: b.rarity, rarityLabel: BREED_RARITY[b.rarity].label, image: b.image };
    })(),
    ...(() => {
      // What a bird is worth is set by the MARKET (recent comparable sales),
      // falling back to the model curve when there is no data — see game/market.ts.
      const v = valuePigeon(db, p, week);
      return {
        value: v.value,
        valueModel: v.modelValue,
        valueMarket: v.marketValue,
        valueTrust: Math.round(v.trust * 100),
        valueSamples: v.sampleSize,
      };
    })(),
    canRace: canRace(p, week),
    forSale: p.forSale,
    price: p.price,
    // Public: when it went on the market, so the market can show what is fresh —
    // which is the point of the head start players get over the bots.
    listedAt: p.listedAt ?? null,
    sireId: p.sireId,
    damId: p.damId,
    ailment: revealed ? p.ailment : null,
    inInfirmary: revealed ? p.inInfirmary : false,
    // Who the doctor/physio is actually treating, and whether the owner pinned
    // this bird to that slot themselves (see Pigeon.careAssigned).
    treated: revealed ? infirmaryCovered : false,
    careAssigned: revealed ? !!p.careAssigned : false,
    coached: revealed ? (p.coached ?? false) : false,
    ration: revealed ? (p.ration ?? 'normal') : 'normal',
    // A bird in the infirmary keeps its compartment flag internally (to reclaim the
    // slot on the way out) but is shown as not-in-a-compartment while isolated.
    compartment: revealed ? (!!p.compartment && !p.inInfirmary) : false,
    cureUntil: revealed ? (p.cureUntil ?? null) : null,
    onCure: revealed ? (!!p.cureUntil && Date.parse(p.cureUntil) > Date.now()) : false,
    // VERLOREN: lost her way on a flight and not home yet (see Pigeon.awayUntil).
    away: isAway(p),
    awayUntil: p.awayUntil ?? null,
    // One cure per BIRD per week: when this pigeon may have its next one (null =
    // right now). The loft-wide lock is gone.
    restCureAvailableAt: (() => {
      if (!revealed) return null;
      const last = p.lastRestCureAt ? Date.parse(p.lastRestCureAt) : NaN;
      if (Number.isNaN(last)) return null;
      const next = last + REST_CURE.cooldownDays * 86400000;
      return next > Date.now() ? new Date(next).toISOString() : null;
    })(),
    // Per-attribute training cooldown (own birds only).
    trainAvailableAt: (() => {
      if (!revealed) return { speed: null, endurance: null, orientation: null };
      const now = Date.now();
      const cd = TRAINING.cooldownDays * 86400000;
      const next = (a: 'speed' | 'endurance' | 'orientation') => {
        const last = p.trainedAt?.[a];
        if (!last) return null;
        const n = Date.parse(last) + cd;
        return n > now ? new Date(n).toISOString() : null;
      };
      return { speed: next('speed'), endurance: next('endurance'), orientation: next('orientation') };
    })(),
    // VLUCHTVORM: energie + gezondheid (lower of the two counting double) minus the
    // deduction for having raced in the last couple of days. It drives the injury
    // odds and how bad an injury turns out, so the player has to be able to SEE it —
    // an invisible penalty just reads as bad luck.
    ...(() => {
      if (!revealed) return { flightForm: null, formLabel: null, restPenalty: 0 };
      const form = Math.round(flightForm(p));
      return {
        flightForm: form,
        formLabel: form >= FORM_GOOD ? 'fris' : form >= FORM_FAIR ? 'matig' : 'risico',
        restPenalty: Math.round(restPenalty(p)),
      };
    })(),
    // Only true while the bird is genuinely tied up: one that already crossed the
    // line is free again, even though its flight runs on for the stragglers.
    racing: pigeonCommittedToFlight(db, p.id),
    breeding: revealed && db.breedingPairs.some((bp) => bp.sireId === p.id || bp.damId === p.id),
    dailyCare,
    // GENETICS (own birds only): the per-skill ceilings for the red cap markers,
    // the level-scaled cost of the next manual training step + its 80/geneCap
    // ceiling, and the coach's current daily polish per skill (0 below 90).
    genes: revealed ? (p.genes ?? null) : null,
    training: revealed
      ? {
          speed: { cost: trainingCost(p.speed), cap: trainCeil(p, 'speed') },
          endurance: { cost: trainingCost(p.endurance), cap: trainCeil(p, 'endurance') },
          orientation: { cost: trainingCost(p.orientation), cap: trainCeil(p, 'orientation') },
        }
      : null,
    coachGain: revealed
      ? {
          speed: round1(coachDailyGain(p.speed, geneCap(p, 'speed'))),
          endurance: round1(coachDailyGain(p.endurance, geneCap(p, 'endurance'))),
          orientation: round1(coachDailyGain(p.orientation, geneCap(p, 'orientation'))),
          // Ervaring has diminishing returns, so the coach's daily bit is
          // per-bird now. Two decimals: a veteran's share is well under 0.1.
          experience: Math.round(experienceGain(p.experience, COACH.experienceDailyGain) * 100) / 100,
        }
      : null,
    // LEEFTIJDSCRITERIUM — both PUBLIC on purpose. The standings are a public
    // scoreboard (they show up under Ranglijst → Duiven with every bird's name),
    // and a title is an honour the bird carries around, so hiding either from a
    // rival looking at her page would be pointless.
    ageCat: ageCategoryFor(ageInWeeks(p, week)),
    cup: p.cup ?? null,
    titles: p.titles ?? [],
  };
}

/**
 * A youngster in a HELD clutch (`PendingBrood`): hatched, but not in the loft yet
 * and so not in `db.pigeons`. It gets its own DTO rather than `pigeonDTO`, which
 * assumes an owned bird (market listings, flight entries, daily-care projection —
 * none of which a bird still in the nest has).
 *
 * The genes are shown in full: which youngster to keep is a bet on its ceilings,
 * so the owner has to be able to see them before deciding.
 */
export function broodYoungDTO(p: Pigeon) {
  const b = breedInfo(p.breed);
  return {
    id: p.id,
    name: p.name,
    sex: p.sex,
    speed: p.speed,
    endurance: p.endurance,
    orientation: p.orientation,
    libido: p.libido,
    form: p.form,
    health: p.health,
    talent: talent(p),
    breed: { id: b.id, name: b.name, rarity: b.rarity, rarityLabel: BREED_RARITY[b.rarity].label, image: b.image },
    genes: p.genes ?? null,
    declineRate: p.declineRate ?? 1,
  };
}

export function loftDTO(db: Database, loft: Loft) {
  const pigeons = db.pigeons.filter((p) => p.ownerId === loft.userId);
  const infirmary = pigeons.filter((p) => p.inInfirmary);
  const coachedCount = pigeons.filter((p) => p.coached).length;
  return {
    userId: loft.userId,
    name: loft.name,
    sponsorCount: loft.sponsorship?.active.length ?? 0,
    sponsorOfferCount: loft.sponsorship?.offers.length ?? 0,
    money: Math.round(loft.money),
    food: loft.food,
    feedRation: loft.feedRation,
    capacity: loft.capacity,
    compartments: loft.compartments ?? 0,
    compartmentsUsed: pigeons.filter((p) => p.compartment && !p.inInfirmary).length,
    compartmentCost: (loft.compartments ?? 0) >= loft.capacity ? null : compartmentCost(loft.compartments ?? 0),
    nextCapacity: nextCapacityTier(loft.capacity),
    nextInfirmary: nextInfirmaryTier(loft.infirmaryCapacity),
    pigeonCount: pigeons.length,
    seasonPoints: loft.seasonPoints,
    totalWins: loft.totalWins,
    isBot: loft.isBot,
    infirmaryCapacity: loft.infirmaryCapacity,
    infirmaryCount: infirmary.length,
    medicatedFood: loft.medicatedFood,
    doctors: loft.doctors,
    physios: loft.physios,
    sickCount: infirmary.filter((p) => p.ailment?.kind === 'ziekte').length,
    injuredCount: infirmary.filter((p) => p.ailment?.kind === 'kwetsuur').length,
    coachedCount,
    // Cumulative recurring cost charged to this loft each day, split per category
    // (upkeep, coaches, infirmary staff, medicated feed) — same source as what
    // schedule.tickDailyCare actually deducts.
    // The bill shows what the loft ACTUALLY pays, so a newcomer's free coach is
    // already discounted here — otherwise the Dagbalans would contradict the
    // money that leaves the account.
    dailyCosts: dailyRunningCostBreakdown(
      loft,
      pigeons.length,
      billableCoachedCount(loft, coachedCount, Date.now()),
      infirmary.length,
    ),
    // The weekly rest-cure lock is gone (any bird may go on a cure), but the field
    // stays so an older, still-open tab keeps rendering. Always null now.
    restCureAvailableAt: null as string | null,
    // Starter package (null for everyone who registered before it shipped).
    newcomer: newcomerDTO(loft),
    // The prizes of the MOST RECENT prijsuitreiking, so the client can hold a
    // little ceremony for them once (see PrizeCeremony). Only the last season's
    // awards, so this stays a handful of rows on the hottest route in the game —
    // the full erelijst lives on /profile.
    ceremony: (() => {
      const list = loft.awards ?? [];
      if (list.length === 0) return null;
      const season = Math.max(...list.map((a) => a.season));
      return { season, awards: list.filter((a) => a.season === season) };
    })(),
  };
}

/**
 * The starter package as the player sees it: what is left to spend, how long the
 * time-boxed perks still run, and whether they are still running at all. Kept
 * even after it expires (as `active: false`) so the panel can say so instead of
 * silently vanishing.
 */
function newcomerDTO(loft: Loft) {
  const n = loft.newcomer;
  if (!n) return null;
  const now = Date.now();
  return {
    active: newcomerActive(loft, now),
    endsAt: n.endsAt,
    daysLeft: newcomerDaysLeft(loft, now),
    expPoints: n.expPoints,
    attrPoints: n.attrPoints,
    expPigeonId: n.expPigeonId ?? null,
    freeCoaches: freeCoachCount(loft, now),
    winningsMultiplier: winningsMultiplier(loft, now),
  };
}

export function flightDTO(db: Database, f: Flight) {
  return {
    id: f.id,
    week: f.week,
    name: f.name,
    type: f.type,
    distanceKm: f.distanceKm,
    entryFee: f.entryFee,
    fromCity: f.fromCity,
    toCity: f.toCity,
    startAt: f.startAt,
    status: f.status,
    // Called off (too few breeders): a completed flight nobody actually flew.
    // The picker needs it, because such a day is NOT spent for its entrants.
    cancelled: flightCancelled(f),
    practice: !!f.practice,
    titan: !!f.titan,
    relay: !!f.relay,
    // Leeftijdscriterium: which age bracket may enter, and whether this edition is
    // the sprint or the grote fond. Both are plain scalars already on the flight
    // row, so this costs the narrowed poll nothing.
    ageCat: f.ageCat,
    ageCatLabel: f.ageCat ? ageCategoryDef(f.ageCat).label : undefined,
    ageCatShort: f.ageCat ? ageCategoryDef(f.ageCat).short : undefined,
    ageCatIcon: f.ageCat ? ageCategoryDef(f.ageCat).icon : undefined,
    cupSprint: f.ageCat ? !!f.cupSprint : undefined,
    cupPrizes: f.ageCat ? [...(f.cupSprint ? AGE_CUP.sprint.prizes : AGE_CUP.fond.prizes)] : undefined,
    // Estafettevlucht: the three equal legs, their handover points and the
    // forecast per leg (which is what makes the running order a real choice).
    legs: f.relay ? f.legs ?? [] : undefined,
    teamSize: f.relay ? RELAY.teamSize : undefined,
    legKm: f.relay ? relayLegKm(f) : undefined,
    // The entered teams, in running order, so the page can show who flies what.
    // This is the ONLY place this DTO names a bird outside the viewer's own
    // loft, and it is why the narrowed load still has to fetch relay entrants
    // (see core/d1.ts). A finished flight needs it neither (the running order is
    // fixed and the results carry their own names), so it is dropped there.
    teams: f.relay && f.status !== 'completed'
      ? [...relayEntryTeams(f)].map(([ownerId, entries]) => ({
          ownerId,
          ownerName: ownerName(db, ownerId),
          complete: entries.length === RELAY.teamSize,
          legs: entries.map((e, i) => ({
            leg: e.leg ?? i + 1,
            pigeonId: e.pigeonId,
            name: db.pigeons.find((p) => p.id === e.pigeonId)?.name ?? 'duif',
          })),
        }))
      : undefined,
    weather: f.weather,
    entryCount: f.entries.length,
    entries: f.entries,
    bettingOpen: bettingOpen(f, Date.now()),
    results: f.results,
    recap: f.recap,
    createdAt: f.createdAt,
  };
}

/**
 * Every entrant of a flight, named — the list the betting panel picks from.
 *
 * This is deliberately NOT part of `flightDTO`. Naming a bird means looking it
 * up in `db.pigeons`, so a route that carries this needs every entrant of every
 * running flight loaded. On `/api/flights` — polled every 90 s by every open tab
 * — that pulls practically the whole population back into the read budget and
 * undoes the narrowed load (measured: a narrow poll goes from 73 to 242 rows at
 * the design ceiling, leaving it only 7 % cheaper than a full load). Betting is
 * opened a handful of times a day, so it pays for its own full load instead.
 */
export function flightEntrantsDTO(db: Database, f: Flight) {
  if (f.status === 'completed') return [];
  return f.entries.map((e) => {
    const p = db.pigeons.find((x) => x.id === e.pigeonId);
    return {
      pigeonId: e.pigeonId,
      name: p?.name ?? 'duif',
      ownerId: e.ownerId,
      ownerName: ownerName(db, e.ownerId),
      talent: p ? talent(p) : 0,
    };
  });
}

export function notificationDTO(n: Notification) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    flightId: n.flightId,
    createdAt: n.createdAt,
    read: n.read,
  };
}

/** A user's notifications, newest first, plus the unread count. */
export function notificationsFor(db: Database, userId: string) {
  const list = db.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return {
    notifications: list.map(notificationDTO),
    unread: list.filter((n) => !n.read).length,
  };
}

/** Full live view for a flight: meta + per-bird positions + commentary feed. */
export function liveFlightDTO(db: Database, f: Flight, nowMs: number) {
  const isRunning = f.status === 'live' || f.status === 'completed';
  return {
    flight: flightDTO(db, f),
    live: isRunning ? liveSnapshot(f, nowMs) : null,
    commentary: isRunning ? flightCommentary(f, nowMs) : [],
  };
}

/**
 * The live board, derived from the flight row ALONE — no `db`.
 *
 * Everything the live page renders already rides in the flight itself: the
 * frozen `sim` carries each bird's name, owner and position, and `results`
 * carries the finish. It never reads `entrants`/`teams` (those exist for the
 * betting UI on a *scheduled* flight), so this leaves them out rather than
 * inventing them from a database we deliberately did not load.
 *
 * That is what lets `/flights/:id/live` answer from two rows instead of ~350
 * (see `loadLiveFlight`). Keep this in step with what `LiveFlightPage` uses: if
 * the page starts needing a field, add it here, not by falling back to the full
 * `flightDTO`.
 */
export function liveBoardDTO(f: Flight, nowMs: number) {
  const isRunning = f.status === 'live' || f.status === 'completed';
  return {
    flight: {
      id: f.id,
      name: f.name,
      fromCity: f.fromCity,
      toCity: f.toCity,
      distanceKm: f.distanceKm,
      startAt: f.startAt,
      status: f.status,
      weather: f.weather,
      relay: !!f.relay,
      // Only a relay needs this: the page reads it purely to label which leg a
      // bird flew. For a normal flight every entrant is already in `live.birds`
      // with its position, so shipping the entry list again is ~90 objects of
      // dead weight in a response that is re-sent on every poll.
      entries: f.relay ? f.entries : [],
      results: f.results,
      recap: f.recap ?? null,
    },
    live: isRunning ? liveSnapshot(f, nowMs) : null,
    commentary: isRunning ? flightCommentary(f, nowMs) : [],
  };
}

export function tradeDTO(t: Trade) {
  return {
    id: t.id,
    pigeonName: t.pigeonName,
    sellerName: t.sellerName,
    buyerName: t.buyerName,
    price: t.price,
    at: t.at,
  };
}

/** All currently-open auctions for the market page (Sunday first, then shelter). */
export function auctionsDTO(db: Database, viewerId?: string) {
  return db.auctions
    .filter((a) => a.status === 'open')
    .map((a) => {
      const p = db.pigeons.find((x) => x.id === a.pigeonId);
      const kind = auctionKind(a);
      // Endgame state for THIS viewer: free bidding until the final phase, then
      // a hard cap of AUCTION.finalPhaseMaxBids on this bird (see placeBid).
      const endMs = Date.parse(a.endAt);
      const finalPhaseAt = new Date(endMs - AUCTION.finalPhaseMinutes * 60000).toISOString();
      const bidsUsed = viewerId
        ? (a.bids ?? []).find((b) => b.userId === viewerId)?.lateBids ?? 0
        : 0;
      return {
        id: a.id,
        kind,
        sellerName: kind === 'shelter' ? 'Opvangcentrum' : 'Veilinghuis',
        // Auction birds are always fully revealed — you must see what you bid on.
        pigeon: p ? pigeonDTO(db, p) : null,
        startAt: a.startAt,
        endAt: a.endAt,
        currentBid: a.currentBid,
        currentBidderName: a.currentBidderName,
        minNextBid: a.currentBid > 0 ? a.currentBid + a.minIncrement : a.minBid,
        finalPhaseAt,
        finalPhase: endMs - Date.now() <= AUCTION.finalPhaseMinutes * 60000,
        finalPhaseMinutes: AUCTION.finalPhaseMinutes,
        antiSnipeMinutes: AUCTION.antiSnipeMinutes,
        maxBids: AUCTION.finalPhaseMaxBids,
        bidsUsed,
        bidsLeft: Math.max(0, AUCTION.finalPhaseMaxBids - bidsUsed),
      };
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'sunday' ? -1 : 1;
      return a.endAt.localeCompare(b.endAt);
    });
}

/** Recent market sales, newest first. */
export function recentTrades(db: Database, limit = 30) {
  return [...db.trades]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit)
    .map(tradeDTO);
}

/**
 * A pigeon's race placings, newest first. Sourced from her durable log (not the
 * flights table), so history survives the pruning of old flights.
 *
 * The log is NOT part of the loaded world any more — it is why `SELECT *` on
 * `pigeons` dominated the CPU of every request (see core/d1.ts::PIGEON_SELECT).
 * The route fetches it with `loadPigeonLogs` and hands it in here.
 */
export function pigeonRaceHistory(log: RaceLogEntry[]) {
  return log
    .map((e) => ({
      flightId: e.flightId,
      name: e.name,
      fromCity: e.fromCity,
      toCity: e.toCity,
      distanceKm: e.distanceKm,
      startAt: e.startAt,
      rank: e.rank,
      total: e.total,
      points: e.points,
      prize: e.prize,
    }))
    .sort((a, b) => (a.startAt < b.startAt ? 1 : -1));
}

/** Season ranking rows sorted by points, humans and bots together. */
/**
 * The two world-wide leaderboards, computed from every pigeon in the game.
 *
 * Only call this when the FULL world is in memory (see `World.leaderboard`):
 * on a narrowed load `db.pigeons` holds the viewer's birds and little else, so
 * the result would silently be wrong rather than merely stale.
 */
export function computeLeaderboard(db: Database) {
  // The criterium standings scan every pigeon exactly like the season rankings do,
  // so they ride the SAME cache. Computing them on /state instead would pull the
  // whole pigeons table back onto the hottest route in the game — the very thing
  // World.leaderboard exists to prevent.
  return {
    rankings: rankingRows(db),
    pigeonRankings: pigeonSeasonRankings(db),
    cupRankings: ageCupRankings(db),
  };
}

export type Leaderboard = ReturnType<typeof computeLeaderboard>;

/**
 * The cached leaderboard, or a freshly computed one when there is no cache yet.
 * A brand-new world has never completed a flight, so an empty cache is normal
 * and the fallback is cheap.
 */
export function cachedLeaderboard(db: Database): Leaderboard {
  const raw = db.world.leaderboard;
  if (raw) {
    try {
      return JSON.parse(raw) as Leaderboard;
    } catch {
      // Corrupt cache: fall through and recompute from whatever is loaded.
    }
  }
  return computeLeaderboard(db);
}

export function rankingRows(db: Database) {
  return db.lofts
    .map((l) => ({
      userId: l.userId,
      name: l.name,
      isBot: l.isBot,
      seasonPoints: l.seasonPoints,
      // The "Winst" column is the SEASON count, so it resets with the standings.
      // `totalWins` stays lifetime for the sponsor tiers gated on it.
      totalWins: l.seasonWins ?? 0,
      level: l.level ?? 1,
      pigeonCount: db.pigeons.filter((p) => p.ownerId === l.userId).length,
    }))
    .sort((a, b) => b.seasonPoints - a.seasonPoints || b.totalWins - a.totalWins)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

/** A player's prestige: level, badges (earned + locked) and trophy cabinet. */
export function playerProfile(db: Database, userId: string, logs?: Map<string, PigeonLogs>) {
  const loft = db.lofts.find((l) => l.userId === userId);
  if (!loft) return null;
  const lvl = levelForXp(loft.xp);
  const earned = new Map((loft.badges ?? []).map((b) => [b.key, b.at]));
  const badges = BADGES.map((def) => ({
    key: def.key,
    group: def.group,
    label: def.label,
    description: def.description,
    xp: def.xp,
    icon: def.icon,
    earned: earned.has(def.key),
    earnedAt: earned.get(def.key) ?? null,
  }));

  // Medal COUNTS come from the durable lifetime counters on the loft (kept up to
  // date at finalize by awardFlightBadges), so they survive flight pruning and
  // stay correct even for birds later sold or lost. Competition only (practice/
  // titan never touch these counters).
  const medals = {
    gold: loft.stats.gold ?? 0,
    silver: loft.stats.silver ?? 0,
    bronze: loft.stats.bronze ?? 0,
  };
  // The trophy SHOWCASE is rebuilt from the durable per-bird race log of the
  // pigeons this player currently owns (attributed by owner-at-flight-time, so a
  // bought bird's earlier placings stay with its previous owner). Competition
  // podiums only. Recent flights beyond retention live here, not in the flights
  // table. The logs come from `loadPigeonLogs` — they are deliberately not part
  // of the world load (see core/d1.ts::PIGEON_SELECT); without them the cabinet
  // is simply empty rather than wrong.
  const trophies: {
    flightId: string; name: string; fromCity: string; toCity: string;
    startAt: string; pigeonName: string; rank: number;
  }[] = [];
  for (const p of db.pigeons) {
    if (p.ownerId !== userId) continue;
    for (const e of logs?.get(p.id)?.race ?? []) {
      if (e.ownerId !== userId) continue;
      if (e.practice || e.titan) continue;
      if (e.rank > 3 || e.finished === false) continue;
      trophies.push({
        flightId: e.flightId, name: e.name, fromCity: e.fromCity, toCity: e.toCity,
        startAt: e.startAt, pigeonName: p.name, rank: e.rank,
      });
    }
  }
  trophies.sort((a, b) => (a.startAt < b.startAt ? 1 : -1));

  // Season prizes (Roekoes + Vleugels), newest first, with per-rank tallies.
  const awards = [...(loft.awards ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1));
  const tally = (kind: 'roekoe' | 'vleugel') => {
    const t = { gold: 0, silver: 0, bronze: 0 };
    for (const a of awards) {
      if (a.kind !== kind) continue;
      if (a.rank === 1) t.gold += 1;
      else if (a.rank === 2) t.silver += 1;
      else if (a.rank === 3) t.bronze += 1;
    }
    return t;
  };

  return {
    level: lvl.level,
    xp: loft.xp,
    intoLevel: lvl.intoLevel,
    needForNext: lvl.needForNext,
    earnedCount: (loft.badges ?? []).length,
    totalBadges: BADGES.length,
    badges,
    medals,
    trophies: trophies.slice(0, 60),
    roekoes: tally('roekoe'),
    vleugels: tally('vleugel'),
    awards: awards.slice(0, 60),
  };
}
