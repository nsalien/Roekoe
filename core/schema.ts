/**
 * Entity types persisted by the data layer. These describe the shape of the
 * JSON database. Keeping them in one place makes it easy to see the whole data
 * model and to evolve it (add fields, add entities) as the game grows.
 */

import type { AgeCategoryId, FeedRationKey, Severity } from './config/gameConfig.js';

export type Sex = 'doffer' | 'duivin'; // male / female

/** Per-bird genetic CEILINGS for the three trainable racing skills (≤ GENE.ceil,
 *  never 100). Rolled at birth, inherited by offspring. See game/pigeon.ts. */
export interface PigeonGenes {
  speed: number;
  endurance: number;
  orientation: number;
}

/** One recorded change to a racing skill (snelheid/conditie/oriëntatie), so a
 *  bird's rise/fall is auditable: what changed, from→to, why, and when. Capped
 *  per bird, stored in `pigeon_log_entries`. See game/pigeon.noteAttrChange. */
export interface AttrChange {
  attr: 'speed' | 'endurance' | 'orientation';
  from: number;
  to: number;
  reason: string; // 'training' | 'coach' | 'vlucht' | 'veroudering' | 'gebeurtenis'
  at: string; // ISO timestamp
}

/** A current disease or injury a pigeon is suffering from. */
export interface Ailment {
  kind: 'ziekte' | 'kwetsuur';
  name: string;
  severity: Severity;
  description: string;
  sinceWeek: number;
  // Real-time recovery bookkeeping (see tickHealing). All optional so older
  // saved ailments keep working; they ride in the ailment's JSON column.
  healed?: number; // recovery progress, 0..1
  lastTickMs?: number; // last time healing progressed
  lastUpdateMs?: number; // last doctor/physio status update
  updates?: number; // status-update counter (for stable notification ids)
}

/** Core, mostly-genetic attributes plus the dynamic condition of a pigeon. */
export interface Pigeon {
  id: string;
  ownerId: string; // user id of the owner
  name: string;
  sex: Sex;
  birthWeek: number; // world week the pigeon was born
  // Skill attributes (0-100). Improve slowly through training / racing.
  speed: number;
  // `endurance` is the pigeon's CONDITIE (fitness/stamina). Racing builds it;
  // higher conditie lets a bird hold its speed on longer flights and lifts its
  // health + libido over time. (Kept as `endurance` for storage compatibility.)
  endurance: number;
  orientation: number;
  libido: number; // drive to breed; rises with good conditie + energie
  // Dynamic resources (0-100). Fluctuate week to week with care and racing.
  // `form` is the pigeon's ENERGIE ("fut"): drained by racing, restored by rest
  // + food. Low energie means poor performance and more illness/injury; it also
  // gates breeding. (Kept as `form` for storage compatibility.)
  form: number;
  health: number;
  experience: number; // ervaring: confidence → better racing + faster energy recovery
  // Pedigree, for breeding UI and inheritance display.
  sireId: string | null;
  damId: string | null;
  // Market: if listed for sale, price is set. ownerId may be the NPC market.
  forSale: boolean;
  price: number | null;
  /**
   * ISO time this bird was put on the market. Bots ignore a listing until it has
   * been up for `BOT.marketMinListedHours`, so a player always gets first look at
   * a new bird instead of finding it sold overnight. Empty on a listing from
   * before this shipped — those have been on the market for ages, so they count
   * as old and are fair game.
   */
  listedAt?: string | null;
  createdAtWeek: number;
  // Health status.
  ailment: Ailment | null; // current disease/injury, or null if healthy
  inInfirmary: boolean; // resting in the ziekenboeg (isolated, recovering)
  /**
   * The player pinned this bird to a doctor/physio slot. One doctor treats only
   * `INFIRMARY.birdsPerDoctor` sick birds (a physio likewise), so with more
   * patients than slots the owner gets to choose who is treated. Unset means
   * "let the game decide", and coverage falls back to severity-first.
   */
  careAssigned?: boolean;
  // Career counters (for badges).
  races: number; // flights this bird has finished
  everAiled: boolean; // has ever been ill or injured (for "Comeback" badge)
  // Breed (ras): cosmetic only. Sets the photo shown for the bird and, via its
  // rarity, a small price premium — no effect on attributes or performance. See
  // PIGEON_BREEDS. Optional so legacy birds keep working (they default to the
  // Stadsduif); a migration backfills a rolled breed onto existing pigeons.
  breed?: string; // breed id (see config PIGEON_BREEDS)
  // Development.
  coached: boolean; // has a hired private coach improving its racing attributes
  // Last time each attribute was trained (ISO). Each may be trained once/week.
  trainedAt?: Partial<Record<'speed' | 'endurance' | 'orientation', string>>;
  // Housing & feeding (per pigeon, since needs differ: racing vs breeding).
  ration: FeedRationKey; // this bird's own feed schedule
  compartment: boolean; // housed in its own private compartment (better rest, less disease)
  hungerDays: number; // consecutive days with no food in stock (0 = fed); drives starvation
  restDays: number; // consecutive fed days at home without racing; every 3rd gives an energie bonus
  cureUntil?: string | null; // ISO time a paid rest cure completes (bird rests, can't race)
  /** ISO time this bird's last rest cure STARTED. Every bird may take a cure, but
   *  only one a week — the cooldown is per pigeon, not per loft. */
  lastRestCureAt?: string | null;
  /**
   * VERLOREN: she lost her way completely on a flight and is not home yet. Set at
   * finalize, cleared by tickStrayReturn when she finally turns up (a few days
   * later, on an empty tank). While this is in the future she is not in the loft:
   * she cannot race, train, breed, take a cure, go to the infirmary or be sold,
   * she eats none of your stock (and builds no hunger), and she is skipped by the
   * daily health roll. She does still hold her loft place and cost upkeep.
   */
  awayUntil?: string | null;
  /** ISO time of the last race this bird flew, and whether that was an oefenvlucht.
   *  Drives the RECOVERY penalty on the vluchtvorm for racing on consecutive days.
   *  Stored on the bird (not derived from db.flights) because finished flights are
   *  pruned after two days, which would silently switch the penalty off. */
  lastRaceAt?: string | null;
  lastRaceWasPractice?: boolean;
  // Genetics (optional so legacy birds keep working; a migration backfills them).
  genes?: PigeonGenes; // per-skill ceilings (≤95, never 100) — ride in the `genes` JSON column
  declineRate?: number; // ageing decline multiplier (~0.6–1.6); higher = fades faster past its prime
  /**
   * Log entries this REQUEST produced, waiting to be appended to
   * `pigeon_log_entries` by `persist`. Purely transient: never loaded, never
   * written as a pigeon column, gone on the next load.
   *
   * The two history logs (race placings + skill changes) used to ride along in
   * the pigeon row as capped JSON blobs. At their cap that is ~13 KB a bird, and
   * `SELECT * FROM pigeons` therefore parsed ~3.3 MB and re-serialised it for the
   * diff on EVERY request — measured at 88% of the CPU of a full load, on data no
   * engine tick ever reads. They now live in their own append-only table, loaded
   * only by the three screens that show them (see core/d1.ts::loadPigeonLogs).
   */
  pendingLog?: LogAppend[];
  // Per-season pigeon stats (reset at each season rollover — see season.ts).
  seasonPeakSpeed?: number; // highest race velocity (m/min) reached this season
  seasonPodiums?: number; // number of top-3 finishes this season
  seasonStartScore?: number; // development score at the season's start (progress baseline)
  seasonPracticeGain?: number; // score gained from practice flights this season (excluded from the ranking)
  /**
   * Leeftijdscriterium standings, PER age bracket (see AGE_CUP). A bird ages out
   * of its bracket during a cycle, so the points it earned stay where they were
   * earned and it simply starts a second entry in the next bracket. Reset only at
   * the end of a full cycle (3 seasons), never at a normal season rollover.
   */
  cup?: Partial<Record<AgeCategoryId, CupStanding>>;
  /**
   * Trophies won by the BIRD itself (as opposed to `Loft.awards`, which belong to
   * the player). They travel with her when she is sold — that is the point.
   */
  titles?: PigeonTitle[];
}

/**
 * One line of a pigeon's durable race history: its placing in a flight, kept on
 * the bird so it outlives the (pruned) flight row. `ownerId` is who owned the
 * bird at flight time, so trophies stay attributed to the right player even
 * after the bird is sold.
 */
/**
 * One history line the engine produced this request, ready to be appended to
 * `pigeon_log_entries`. The engine is synchronous and cannot read the database
 * mid-tick, so an append must never need the previous value — hence one row per
 * entry instead of a read-modify-write on a capped array.
 */
export interface LogAppend {
  /** Stable where it matters: a race line is `<pigeonId>:<flightId>`, so a second
   *  finalize of the same flight replaces its line instead of duplicating it. */
  id: string;
  pigeonId: string;
  kind: 'race' | 'attr';
  at: string; // ISO — the sort key for "newest N"
  data: string; // the entry, already serialised
}

export interface RaceLogEntry {
  flightId: string;
  name: string;
  fromCity: string;
  toCity: string;
  distanceKm: number;
  startAt: string;
  ownerId: string;
  rank: number;
  total: number;
  points: number;
  prize: number;
  velocity: number;
  finished: boolean;
  practice?: boolean;
  titan?: boolean;
  relay?: boolean;
  /** Estafettevlucht: the leg this bird flew, and how long that leg was. */
  leg?: number;
  legKm?: number;
}

/** Everything about a player's operation that is not an individual pigeon. */
/** Food stock, kept separately per feed type (kg). */
export type FoodStock = Record<FeedRationKey, number>;

export interface Loft {
  userId: string;
  name: string;
  money: number;
  food: FoodStock; // kg in stock, per feed type
  feedRation: FeedRationKey; // default ration for new pigeons (not a global setter)
  capacity: number;
  compartments: number; // private compartments bought (better rest, less disease)
  seasonPoints: number; // ranking points accumulated this season
  /**
   * Lifetime race wins. Deliberately NOT reset at a season rollover: sponsor
   * requirements are gated on it (`req.totalWins` — 1/5/8/12 in SPONSORS) and it
   * feeds their performance score, so zeroing it would slam those tiers shut
   * again every four weeks. The ranking column shows `seasonWins` instead.
   */
  totalWins: number;
  /** Race wins THIS season — what the Ranglijst shows, reset with the standings. */
  seasonWins?: number;
  isBot: boolean;
  // Infirmary (ziekenboeg).
  infirmaryCapacity: number; // max birds that can rest in the infirmary at once
  medicatedFood: boolean; // feed medicated food to infirmary birds (weekly cost)
  doctors: number; // hired pigeon doctors (help disease recovery)
  physios: number; // hired pigeon physiotherapists (help injury recovery)
  lastRestCure?: string | null; // ISO time the last paid rest cure was started (max one per 7 days)
  // Prestige (badges / level).
  xp: number; // total player experience from badges
  level: number; // derived from xp (cached for the ranking)
  stats: PlayerStats; // lifetime counters that drive badges
  badges: EarnedBadge[]; // badges earned, with timestamps
  // Engagement.
  missions: DailyMission[]; // today's daily tasks
  missionsDay: string; // date key (yyyy-mm-dd, Brussels) the missions belong to
  streak: number; // consecutive active days
  pendingEvent: EventCard | null; // an unresolved dilemma awaiting the player
  pendingBroods: PendingBrood[]; // hatched young awaiting a keep/let-go choice
  // Sponsoring: companies that offer to back the loft once it performs well.
  sponsorship: SponsorState;
  // Season prizes won at each rollover (Roekoes + Vleugels) — see season.ts.
  awards?: SeasonAward[];
  // Starter package for an account created after this shipped — see NEWCOMER.
  newcomer?: NewcomerPerks;
}

/**
 * The leg-up a newly registered loft gets for its first season (NEWCOMER).
 *
 * `expPoints` and `attrPoints` are a WALLET the player spends where they want;
 * everything else is time-boxed to `endsAt` and then simply stops. `endNotified`
 * makes the "your starter package has ended" message fire exactly once — the
 * player should never quietly discover their coach started costing money.
 */
export interface NewcomerPerks {
  startedAt: string; // ISO — when the account was created
  endsAt: string; // ISO — startedAt + NEWCOMER.days
  expPoints: number; // ervaring left to hand out (all of it must go to ONE bird)
  attrPoints: number; // snelheid/conditie/orientatie points left to hand out
  expPigeonId?: string | null; // the bird the ervaring went to (locks further spending)
  endNotified?: boolean; // the end-of-package notification has been sent
}

/** Which of the three pigeon rankings a Gouden Vleugel was won in. */
export type WingCategory = 'speed' | 'podium' | 'progress';

/** One bird's running total in ONE age bracket of the leeftijdscriterium. */
export interface CupStanding {
  points: number; // criterium points (RANKING_POINTS by placing, sprint and fond alike)
  wins: number; // criterium victories — first tie-break
  best: number; // best route average (m/min) in this bracket — second tie-break
  races: number; // criterium races flown in this bracket
}

/** A trophy engraved on the bird herself; survives a sale. */
export interface PigeonTitle {
  kind: 'criterium';
  rank: number; // 1, 2 or 3
  label: string; // e.g. "Gouden Criteriumduif 1–2 j"
  icon: string;
  season: number; // the season the cycle ended in
  at: string; // ISO timestamp
  ageCat?: AgeCategoryId;
  value?: number; // criterium points at award time
}

/**
 * A prize won at a season's prijsuitreiking, kept in the owner's prestige.
 *  - `roekoe`: finished 1st/2nd/3rd in the melker standings (season points).
 *  - `vleugel`: owned a pigeon that finished top-3 in a pigeon ranking.
 */
export interface SeasonAward {
  kind: 'roekoe' | 'vleugel' | 'criterium';
  rank: number; // 1, 2 or 3
  season: number; // season number this was won in
  at: string; // ISO timestamp
  reward: number; // coins paid out
  category?: WingCategory; // only for 'vleugel'
  ageCat?: AgeCategoryId; // only for 'criterium'
  pigeonName?: string; // only for 'vleugel' and 'criterium'
  value?: number; // the metric at award time (points / km-h / podiums / progress)
}

/** The money terms of a sponsor deal (they scale with performance over time). */
export interface OfferTerms {
  signingBonus: number; // one-time on signing
  dailyStipend: number; // paid every day the contract is active
  /** Reference podium bonus (a win on a national flight); the real payout scales
   *  by flight tier + placing — see config sponsorPodiumBonus(). */
  podiumBase: number;
}

/** A pending sponsor offer with its concrete (performance-scaled) terms. */
export interface SponsorOffer extends OfferTerms {
  id: string; // sponsor id (see config SPONSORS)
  at: string; // ISO timestamp the offer was made
}

/** A signed sponsorship contract (keeps the terms agreed at signing). */
export interface ActiveSponsorship {
  id: string;
  since: string; // ISO timestamp the contract was signed
  dailyStipend: number;
  podiumBase: number;
  // Season-review baseline: the loft's season points at the previous season
  // rollover while this contract was active. The sponsor compares each new
  // season to it and may walk away if performance drops (see season review).
  refPoints?: number;
}

/** A refused or cancelled sponsor, eligible to re-offer later. */
export interface DeclinedSponsor {
  id: string;
  at: string; // ISO timestamp it was refused/cancelled
  perf: number; // loft performance score at that moment (for re-offer scaling)
  /** Refused while it was a WORSE competitor of a sponsor you already had — so
   *  taking it would have cost a break fee for less money. That is a definitive
   *  no: this sponsor never offers again. (Rides in the sponsorship JSON.) */
  permanent?: boolean;
}

/** Everything about a loft's sponsors: active contracts + offer bookkeeping. */
export interface SponsorState {
  active: ActiveSponsorship[]; // current contracts (max one per category)
  offers: SponsorOffer[]; // pending offers awaiting accept/refuse
  declined: DeclinedSponsor[]; // refused/cancelled; may re-offer after a cooldown
  signed: string[]; // sponsor ids ever accepted (one-time signing-bonus guard)
  lastOfferAt?: string; // ISO of the last time a new offer was made (offer spacing)
}

/** A small daily task that rewards money + XP when completed. */
export interface DailyMission {
  key: string;
  label: string;
  target: number;
  progress: number;
  rewardMoney: number;
  rewardXp: number;
  done: boolean;
}

/** A dilemma the player must resolve by picking one of the options. */
export interface EventCard {
  key: string;
  title: string;
  text: string;
  icon: string;
  options: { label: string }[];
  data?: Record<string, number | string>;
}

/** Lifetime counters per loft that unlock badges. */
export interface PlayerStats {
  regionalWins: number;
  nationalWins: number;
  intlWins: number;
  gold: number;
  silver: number;
  bronze: number;
  entries: number;
  babies: number;
  buys: number;
  sells: number;
  cures: number;
  curesSevere: number;
  staffHired: number;
  bets: number; // weddenschappen geplaatst
  betsWon: number; // weddenschappen gewonnen
  broods: number; // kweekkoppels gestart
}

export interface EarnedBadge {
  key: string;
  at: string; // ISO timestamp
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  isBot: boolean;
  createdAt: string;
}

/** A pending breeding pair that will hatch young after some weeks. */
export interface BreedingPair {
  id: string;
  ownerId: string;
  sireId: string;
  damId: string;
  hatchAt: string; // ISO timestamp the young arrive (real time)
  createdAtWeek: number;
}

/**
 * A hatched clutch that did not fit in the loft and is waiting on the owner's
 * decision: which youngsters to keep (freeing perches first if needed) and which
 * to let go. The young are NOT in `db.pigeons` yet — they live on `Loft.pendingBroods`
 * until the owner resolves the nest, so nothing is ever silently lost to a full loft.
 *
 * It hangs off the loft (like `pendingEvent`) rather than living in its own table
 * because the lofts row is loaded on every request anyway, and the heaviest request
 * already spends ~42 of the 50 queries a Worker invocation gets.
 *
 * Only human lofts get one; a bot's overflowing clutch is still truncated
 * (see `tickBreedingHatch`), because a bot has no UI to decide with.
 */
export interface PendingBrood {
  id: string;
  /** Parents, by id and by name: either may be gone by the time the owner picks. */
  sireId: string;
  damId: string;
  sireName: string;
  damName: string;
  /** The full clutch, ready to be inserted into `db.pigeons` on the keep choice. */
  young: Pigeon[];
  /** Whether a grandparent was still in the loft at hatch — the `dynastie` badge
   *  is awarded on resolve, when the parents may no longer be around to ask. */
  dynasty: boolean;
  createdAt: string;
  createdAtWeek: number;
}

/** One pigeon's result within a flight. */
export interface FlightResult {
  pigeonId: string;
  pigeonName: string;
  ownerId: string;
  ownerName: string;
  velocity: number; // metres per minute
  timeSeconds: number;
  rank: number;
  points: number;
  prize: number;
  finished: boolean; // false = did not make it home (exhausted)
}

export interface FlightEntry {
  pigeonId: string;
  ownerId: string;
  /** Estafettevlucht only: which leg (1..RELAY.teamSize) this bird flies. One
   *  team per loft, so the owner + leg identify the slot. */
  leg?: number;
}

/**
 * One leg of an estafettevlucht: exactly a third of the route, flown by one bird
 * of the team. The handover points are not race cities but exact thirds of the
 * great circle, so every bird flies the same distance; `fromName`/`toName` carry
 * a human description ("ten noorden van Limoges"). Each leg has its OWN weather,
 * forecast days ahead so a player can pick which bird flies which leg.
 */
export interface RelayLeg {
  index: number; // 1-based
  fromName: string;
  toName: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  distanceKm: number; // identical for every leg of the flight
  weather: string;
  weatherFactor: number;
  forecastAt?: string; // ISO time the forecast was last refreshed
}

/** A single pigeon's frozen performance, computed when a flight goes live. */
export interface SimEntry {
  pigeonId: string;
  pigeonName: string;
  ownerId: string;
  ownerName: string;
  velocity: number; // metres per minute (realistic homing speed)
  durationSeconds: number; // compressed live race duration for this bird
  gaveUp?: boolean; // owner pulled the bird mid-race to save its energy
  // Energie (`form`) is drained gradually WHILE the bird flies (see
  // tickFlightEnergy), not in one lump at the finish — so pulling a bird out
  // near the end still costs the energy it already spent getting there.
  startForm?: number; // the bird's energie at release (for DNF/injury risk)
  /** The bird's VLUCHTVORM at release — energie + gezondheid with the lower of the
   *  two counting double, minus the rest deduction for racing on consecutive days.
   *  Frozen here so the strain-injury roll is deterministic (a second, concurrent
   *  finalize sees the same number even if the first already applied its effects). */
  startVorm?: number;
  formCost?: number; // total energie spent flying the whole route (frozen)
  formDrained?: number; // energie already deducted so far during the live race
  // Dynamic pacing (see FLIGHT_DYNAMICS). The bird flies the route in segments,
  // each at `velocity * segMult[i]`, so its position vs time is a piecewise curve
  // — birds speed up, slow down and overtake. Frozen at release; live positions
  // and the final result are both derived from it (so they always agree).
  segMult?: number[]; // per-segment speed multipliers (mean ~1)
  dnfAtSeconds?: number | null; // it gave out mid-flight at this elapsed time (never finishes)
  dnfKind?: 'exhausted' | 'injury' | 'lost' | null; // why it gave out, for finalize effects
  /** Only for dnfKind 'lost': how many days before she finds her way home. */
  strayDays?: number;
  gaveUpAtSeconds?: number; // elapsed seconds when the owner pulled it (freezes its position)
  // Prize money for this bird was already paid out the moment it crossed the line
  // (see schedule.payFinishedFlightPrizes), so finalize won't pay it again. Rides
  // in the `sim` JSON — no migration.
  prizePaid?: boolean;
  // A wandering-off-course stretch (low orientation). Recorded at release so the
  // live report can explain a bird sliding down the standings. `atSeconds` = when
  // it strays; `detourKm` = roughly the extra ground the detour costs it.
  lost?: { atSeconds: number; detourKm: number } | null;
  // --- Estafettevlucht only -------------------------------------------------
  /** Which leg this bird flies (1..3). */
  leg?: number;
  /** Elapsed seconds into the RACE at which this bird is released (the sum of
   *  its team-mates' earlier legs). Leg 1 starts at 0. Frozen at release so the
   *  live board, the energie drain and the result all read the same clock. */
  legStartSeconds?: number;
}

/**
 * A flight, tied to a real start time and a route (release point -> home).
 *  - `scheduled`: open for entries, waiting for its start time.
 *  - `live`: started; positions derive from the frozen `sim` + elapsed time.
 *  - `completed`: everyone home; `results` is final.
 */
export interface Flight {
  id: string;
  week: number;
  templateKey: string;
  name: string;
  type: 'regional' | 'national' | 'international';
  distanceKm: number;
  entryFee: number;
  fromCity: string; // release point
  toCity: string; // home base
  startAt: string; // ISO timestamp the flight is released
  status: 'scheduled' | 'live' | 'completed';
  practice?: boolean; // oefenvlucht: no fee, no prizes/points, gentle training
  titan?: boolean; // titanenwedstrijd: money-only, one bird per loft, no ranking points
  /** Estafettevlucht: money-only, one TEAM of three birds per loft that fly the
   *  route leg by leg. `legs` holds the three equal stretches + their weather. */
  relay?: boolean;
  legs?: RelayLeg[];
  /**
   * Leeftijdscriterium: the age bracket this race is restricted to. Only birds
   * whose age falls in the bracket AT THE MOMENT OF ENTRY may be entered, and the
   * result feeds only the criterium standings (`Pigeon.cup`) — no seizoenspunten,
   * medals, wins, sponsor bonuses or bets. See AGE_CUP in gameConfig.
   */
  ageCat?: AgeCategoryId;
  /** Criterium format for this edition: true = sprint (100-300 km), false = grote
   *  fond (400-1000 km). Stored rather than derived, because `pickRoute` may land
   *  slightly outside its window when the city pool cannot reach it. */
  cupSprint?: boolean;
  entries: FlightEntry[];
  sim: SimEntry[]; // frozen when the flight goes live
  weather: string;
  weatherFactor: number;
  results: FlightResult[]; // empty until completed
  recap: string; // sports-reporter summary, written at finish
  createdAt: string;
}

/** A completed market sale, kept as buy/sell history. */
export interface Trade {
  id: string;
  pigeonId: string;
  pigeonName: string;
  sellerId: string;
  sellerName: string;
  buyerId: string;
  buyerName: string;
  price: number;
  at: string; // ISO timestamp
  /**
   * The bird's talent at the moment of sale. This is what makes the sale usable as
   * a price observation later (see game/market.ts) — the bird itself may since have
   * trained on, been sold again, or died.
   */
  talent?: number;
}

/**
 * A private offer from one player to buy another player's pigeon — even one that
 * is not listed for sale. Money is NOT escrowed; it is checked when the owner
 * accepts. The offer stays valid until the owner accepts/rejects or the bidder
 * withdraws it.
 */
export interface PigeonOffer {
  id: string;
  pigeonId: string;
  pigeonName: string;
  fromUserId: string; // the bidder
  fromUserName: string;
  toUserId: string; // the owner at offer time
  toUserName: string;
  amount: number;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  createdAt: string;
  resolvedAt: string | null;
}

/** A weekly auction of a special top pigeon. */
/** One player's standing bid in an auction (money is NOT escrowed). */
export interface AuctionBid {
  userId: string;
  name: string;
  amount: number;
  /**
   * Bids this player has spent inside the auction's final phase (see
   * AUCTION.finalPhaseMinutes). Capped at AUCTION.finalPhaseMaxBids, and it
   * survives a raise: a player keeps one standing bid row, not a history.
   */
  lateBids?: number;
}

export interface Auction {
  id: string;
  templateKey: string; // one per Sunday
  pigeonId: string;
  startAt: string;
  endAt: string;
  minBid: number;
  minIncrement: number;
  currentBid: number;
  currentBidderId: string | null;
  currentBidderName: string | null;
  bids: AuctionBid[]; // every player's highest bid, for cascade at close
  status: 'open' | 'closed';
}

/** The kinds of wager a player can place on a flight. */
export type BetKind = 'win' | 'last' | 'own_top3' | 'top3' | 'mine_wins' | 'head2head';

/** A wager on a flight outcome. Money is deducted when placed; paid on a win. */
export interface Bet {
  id: string;
  userId: string;
  userName: string;
  flightId: string;
  kind: BetKind;
  pigeonId: string | null; // the bird bet on (or "my bird" for own_top3/head2head)
  pigeonName: string;
  rivalId: string | null; // head2head opponent
  rivalName: string | null;
  stake: number;
  ratio: number; // payout multiplier, locked at placement
  potentialWin: number; // total returned on a win (stake × ratio)
  status: 'open' | 'won' | 'lost' | 'void';
  placedAt: string;
  settledAt: string | null;
}

/** An in-app notification shown in the bell inbox. */
export interface Notification {
  id: string;
  userId: string;
  kind: 'result' | 'improve' | 'info' | 'health' | 'badge';
  title: string;
  body: string;
  flightId: string | null;
  createdAt: string;
  read: boolean;
}

/** Global world state. */
export interface World {
  currentWeek: number; // monotonic game-week counter (drives ages/flights/ailments)
  seasonYear: number; // the current SEASON number (real-time, see season.ts)
  seeded: boolean;
  /** One-time data migrations applied (funny names, purge old flights, ...). */
  dataVersion: number;
  /** ISO timestamp of the last daily food/care tick (real time). */
  lastDailyTick: string;
  /** ISO timestamp a shelter (opvangcentrum) auction was last spawned. */
  lastShelterSpawn: string;
  /** ISO timestamp the current season started (real time). */
  seasonStartedAt: string;
  /** ISO timestamp the current season ends (real time). */
  seasonEndsAt: string;
  /** Week within the current season (1..SEASON.weeks), derived from real time. */
  seasonWeek: number;
  /**
   * ISO timestamp of the last time `advanceRealtime` actually ran. Read-only
   * requests inside ADVANCE_THROTTLE_SECONDS of this skip the engine and the
   * persist entirely — see the middleware in functions/api. The world clock is
   * derived from timestamps, so running it a few seconds late changes nothing;
   * running it on every poll cost ~9 ms of CPU that we do not have.
   */
  lastAdvance?: string;
  /**
   * Resume point for the daily care tick, WITHIN one pending midnight: the
   * `userId` of the last loft already handled for that day (empty = the day has
   * not been started). A day of care touches every bird in the world, which on
   * its own doubles the cost of a request and blows the 10 ms CPU budget — and
   * because the anchor only moved after the whole day finished, a request that
   * died took the whole game down with it (nothing advanced, so the next request
   * retried exactly the same work). Lofts are handled in a bounded slice per
   * request, in a stable order, so no single request can exceed the budget.
   */
  dailyCareCursor?: string;
  /**
   * Cached public leaderboard (loft rankings + pigeon rankings) as JSON.
   *
   * These are the only things `/state` needs that look at EVERY pigeon in the
   * world, and `/state` is the hottest route in the game. Recomputing them meant
   * every navigation had to read the whole `pigeons` table — ~264 of the ~300
   * rows a request costs, against a daily budget shared by all players.
   *
   * The numbers only move when a flight completes or a day rolls over, and both
   * of those happen on a request that loads the full world anyway, so the cache
   * is refreshed exactly then and served in between.
   */
  leaderboard?: string;
  /**
   * ISO timestamp the current leeftijdscriterium cycle started. Empty = the
   * criterium has not started yet, and `ensureFlightsScheduled` plans no age
   * races. It is anchored to a SEASON boundary, so the week index derived from
   * it also gives the season week: index 0,2,4.. are sprints and 1,3,5.. fond.
   */
  ageCupStartedAt?: string;
  /** Seasons completed in the current criterium cycle (0..AGE_CUP.seasons - 1). */
  ageCupSeasonsDone?: number;
}

/** The full database document persisted to disk. */
export interface Database {
  world: World;
  users: User[];
  lofts: Loft[];
  pigeons: Pigeon[];
  breedingPairs: BreedingPair[];
  flights: Flight[];
  notifications: Notification[];
  trades: Trade[];
  auctions: Auction[];
  bets: Bet[];
  offers: PigeonOffer[];
}

export function emptyFoodStock(): FoodStock {
  return { normal: 0, premium: 0, libido: 0, herstel: 0 };
}

export function emptySponsorState(): SponsorState {
  return { active: [], offers: [], declined: [], signed: [] };
}

export function emptyStats(): PlayerStats {
  return {
    regionalWins: 0, nationalWins: 0, intlWins: 0,
    gold: 0, silver: 0, bronze: 0,
    entries: 0, babies: 0, buys: 0, sells: 0,
    cures: 0, curesSevere: 0, staffHired: 0,
    bets: 0, betsWon: 0, broods: 0,
  };
}

export function emptyDatabase(): Database {
  return {
    world: { currentWeek: 1, seasonYear: 1, seeded: false, dataVersion: 0, lastDailyTick: '', lastShelterSpawn: '', seasonStartedAt: '', seasonEndsAt: '', seasonWeek: 1, lastAdvance: '', dailyCareCursor: '', leaderboard: '' },
    users: [],
    lofts: [],
    pigeons: [],
    breedingPairs: [],
    flights: [],
    notifications: [],
    trades: [],
    auctions: [],
    bets: [],
    offers: [],
  };
}
