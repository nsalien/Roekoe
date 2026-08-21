/**
 * Central, data-driven game configuration.
 *
 * Almost every tunable number in Roekoe lives here. To rebalance the game,
 * add a new food type, add a building, or change the flight calendar, edit
 * this file — the engine reads from it rather than hard-coding values. This is
 * the main "knob board" for extending the game later.
 */

export const WEEKS_PER_YEAR = 52;

/**
 * Seizoenen lopen in ECHTE tijd. Een seizoen duurt `weeks` weken, een week
 * `weekDays` echte dagen. Wanneer de laatste week voorbij is, wordt de
 * prijsuitreiking gehouden en start een nieuw seizoen (ranglijst reset). Zie
 * `core/game/season.ts`.
 */
export const SEASON = {
  weeks: 4, // weken per seizoen
  weekDays: 7, // echte dagen per week
} as const;

/**
 * Seizoensprijzen (uitbetaald aan de eigenaar bij de prijsuitreiking).
 *  - `roekoe`: de top-3 duivenmelkers op seizoenspunten (de Gouden/Zilveren/
 *    Bronzen Roekoe).
 *  - `vleugel`: de top-3 duiven in elk van de drie duivenrangschikkingen
 *    (de Gouden/Zilveren/Bronzen Vleugel).
 */
export const SEASON_AWARDS = {
  roekoe: [2000, 1500, 1000], // 1e / 2e / 3e melker
  vleugel: [1000, 750, 500], // 1e / 2e / 3e per duivenrangschikking
} as const;

/** A pigeon can be entered into flights once it reaches this age (in weeks). */
export const RACE_AGE_WEEKS = 8;

/** How many game-weeks pass per real week — i.e. how fast pigeons age in real
 *  time. At 4×, a newly hatched bird reaches race age (8 wk) in ~2 real weeks,
 *  and the age curve + old-age mortality (both authored per game-week) play out
 *  over real months instead of years. The game-week counter (`world.currentWeek`)
 *  advances by this many weeks per real week. */
export const GAME_WEEKS_PER_REAL_WEEK = 4;

/** Loft capacity a new player starts with (max pigeons owned). Upgradeable. */
export const STARTING_LOFT_CAPACITY = 8;

/** Capacity a bot loft gets. Same base as players (8): bots don't upgrade, so
 *  they play by the same standard limit instead of getting extra headroom. */
export const BOT_LOFT_CAPACITY = 8;

/**
 * Buyable loft-capacity upgrades. Each tier lifts the maximum number of pigeons
 * you can own; you buy them in order (8 → 10 → 12 → 14 → 16 → 18 → 20), and the
 * price climbs steeply: €112.500 to go all the way, against €29.000 before. Room
 * for more birds is the main structural advantage in the game (more birds = more
 * race entries = a bigger share of the prize pot), so it should be a serious,
 * long-term investment rather than something a leading loft buys in a week. The
 * recurring half of that brake is UPKEEP_BANDS.
 */
export const LOFT_CAPACITY_TIERS: { capacity: number; price: number }[] = [
  { capacity: 10, price: 1500 },
  { capacity: 12, price: 3500 },
  { capacity: 14, price: 10000 },
  { capacity: 16, price: 17500 },
  { capacity: 18, price: 30000 },
  { capacity: 20, price: 50000 },
];

/**
 * Private compartments ("aparte hokken"). Instead of cramming every bird
 * together, you buy separate compartments. Coverage = compartments / pigeons:
 * the more birds get their own space, the faster they recover energie and the
 * lower the chance of disease spreading. Each compartment is bought separately
 * and gets a bit pricier.
 */
export const COMPARTMENT = {
  baseCost: 800, // price of the first compartment
  stepCost: 400, // added per compartment already owned
  formRecoveryBonus: 0.6, // up to +60% energie recovery at full coverage
  healthRecoveryBonus: 0.4, // up to +40% health recovery at full coverage
  diseaseReduction: 0.5, // up to −50% disease onset at full coverage
} as const;
/** Price of the next compartment given how many you already own. */
export function compartmentCost(owned: number): number {
  return COMPARTMENT.baseCost + owned * COMPARTMENT.stepCost;
}

/**
 * Private coach. A coach is hired for one specific pigeon and drills it on every
 * racing attribute (snelheid, conditie, oriëntatie) plus ervaring — never
 * libido. It is expensive up front and carries a weekly salary, but pushes a
 * bird past the normal training ceiling.
 */
export const COACH = {
  // A private coach is a PURELY DAILY cost — no upfront hire fee, €80/day per
  // coached pigeon. It drills the three racing attributes every day toward the
  // bird's own GENE cap, at ANY level, with DIMINISHING returns: the daily gain
  // shrinks as an attribute nears its cap and stops once it hits the cap (never
  // above — the cap is the max). It is also the ONLY thing that pushes a skill
  // above 90 (training stops at 80, racing at 90). Each attribute is capped
  // independently: one already at its cap stops while the others keep rising.
  //   gain(attr, cap) = maxDailyGain · (cap − attr) / cap   (0 at/above the cap)
  hireCost: 0, // deprecated: coaching has no one-time cost anymore
  dailySalary: 80, // per coached pigeon, charged automatically each day
  maxDailyGain: 1.1, // peak gain/day (at attr 0), scaled down by the room to the cap
  experienceDailyGain: 0.5, // flat ervaring/day while the coach still has an attribute to raise
} as const;

/**
 * Genetics: every pigeon has an individual, permanent CEILING per trainable racing
 * attribute (snelheid/conditie/oriëntatie), rolled at birth and inherited. NO bird
 * can reach 100 in a racing skill — the hard ceiling is GENE.ceil (95). Growth
 * toward that ceiling runs in three tiers, each with its own single method:
 *   - manual training : up to min(GENE.trainCap 80, geneCap)
 *   - racing (flights): up to min(GENE.raceCap 90, geneCap)
 *   - private coach    : up to geneCap (only the coach passes 90)
 * A rarer/higher gene ceiling also makes a bird worth more (see estimateValue).
 * See pigeon.rollGeneCap / geneCap / trainCeil / raceCeil / trainingCost.
 */
export const GENE = {
  floor: 70, // no gene cap below this
  ceil: 95, // ...nor above — 100 is impossible for a racing skill
  rollMin: 70, // bell-roll lower bound (before quality shift + clamp)
  rollMax: 96, // bell-roll upper bound (clamped down to ceil)
  qualityShift: 12, // (quality−0.5)·this nudges the roll for better/worse sources
  trainCap: 80, // manual training can't push a skill past this
  raceCap: 90, // racing can't push a skill past this (only the coach goes higher)
  mutation: 6, // ± spread when a gene cap is inherited
  declineRateMin: 0.6, // per-bird ageing-decline multiplier range (see AGING)
  declineRateMax: 1.6,
} as const;

/** The three trainable/improvable racing attributes (gene-capped). */
export type RacingAttr = 'speed' | 'endurance' | 'orientation';

/** Cost to rename one of your pigeons. */
export const RENAME_COST = 1000;

/** Cost to rename your loft. */
export const RENAME_LOFT_COST = 2000;

/**
 * The local pigeon-soup restaurant. Selling a bird here pays a small fixed sum,
 * but sending a loft-mate to the pot rattles every remaining pigeon: each loses
 * a random `moraleEnergyMin..moraleEnergyMax` energie (form). Releasing a bird
 * (see engine.releasePigeon) is the money-free alternative with no morale hit.
 */
export const PIGEON_RESTAURANT = {
  name: 'Bistro De Laatste Vlucht',
  payout: 50, // fixed coins paid for the bird
  moraleEnergyMin: 1, // each remaining bird loses at least this much energie…
  moraleEnergyMax: 5, // …and at most this much (random per bird)
} as const;

/** How far premium feed can build a pigeon's conditie (endurance). */
export const FOOD_ENDURANCE_CAP = 92;

/**
 * Racing risk from exhaustion. A bird entered with very low energie (form) may
 * not make it home (DNF) and is far more likely to get hurt. Above the
 * threshold there is no extra risk.
 */
export const FLIGHT_RISK = {
  dnfFormThreshold: 22, // below this energie, a did-not-finish chance kicks in
  dnfMaxChance: 0.9, // at 0 energie, almost certainly does not finish
  lowEnergieInjuryThreshold: 25, // below this energie, extra injury risk ramps up
  lowEnergieInjuryBonus: 0.6, // added injury chance at 0 energie
} as const;

/**
 * What makes a live race unpredictable and worth watching. At release each bird
 * gets a FROZEN but VARYING pace profile (a sequence of per-segment speed
 * multipliers) plus a form-of-the-day, weather sensitivity and possible events
 * (getting lost, giving out mid-flight). Positions are derived from this profile
 * over time, so birds genuinely overtake each other and an off day can sink a
 * favourite — while attributes still set the baseline, so the best usually win.
 * All of it is seeded on the flight id, so it stays deterministic (live == final).
 */
export const FLIGHT_DYNAMICS = {
  // Per-segment pacing is NORMALISED so it does not change a bird's finish time —
  // it only makes birds speed up/slow down and trade places DURING the race
  // (overtaking) while the final order still follows attributes + the (moderated)
  // upset sources below. So segSpread/surge can be lively without making results
  // random.
  segments: 10, // route split into this many speed segments
  segSpread: 0.28, // each segment's pace varies uniformly ±this (visual overtaking)
  surgeChance: 0.16, // chance a segment is an extra surge/lull on top of the spread
  surgeMin: 0.5, surgeMax: 1.6, // strongest lull / surge when it hits
  // Form of the day: the main "any bird can place" lever. A meaningful everyday
  // swing plus great/off days, so a favourite can land mid-pack and an outsider
  // can reach the top — while the CENTRE of each bird's spread still tracks its
  // attributes, so the best is still the most LIKELY to win (just not certain).
  dayNoise: 0.17, // ±17% everyday variation
  bigDayChance: 0.14, bigDayMin: 1.12, bigDayMax: 1.36, // a great day
  offDayChance: 0.16, offDayMin: 0.64, offDayMax: 0.86, // an off day
  // Weather: rough weather (rain/wind) hurts some birds more than others, so bad
  // weather makes a race more of a lottery; good weather rewards the best.
  weatherSpread: 0.8, // per-bird sensitivity spread
  // Getting lost now lives in its own config block — see LOST. (The old
  // lostOrientationRef of 62 meant orientation did nothing at all above that,
  // which is exactly backwards from what the attribute is for.)
  lostSpanMin: 1, lostSpanMax: 2, // how many segments the wandering stretch covers
  // Giving out mid-flight (a DNF you can SEE happen live). Exhaustion scales with
  // low start-energie (FLIGHT_RISK); a small injury chance rises in rough weather.
  injuryDnfBase: 0.015,
  injuryDnfWeatherBonus: 0.05, // extra injury-DNF chance in the worst weather
  dnfEarliestFrac: 0.3, dnfLatestFrac: 0.85, // when in its run a bird gives out
  minSegSpeed: 60, // m/min floor so a very slow segment can't blow up the time
} as const;

/**
 * Energie (form) spent by racing. The distance-dependent part of the cost is
 * `(base + distanceKm/perKmDivisor) · ervaringsfactor`, plus `random(0..jitter)`,
 * frozen when the flight goes live. That cost is drained GRADUALLY while the bird
 * flies, in blocks of `stepMinutes`, so a bird pulled out (opgegeven) mid-race has
 * already paid for the part it flew — you can't dodge the energy cost by quitting
 * near the end. A bird that does not finish (DNF) simply pays the same frozen
 * route cost as a finisher — no extra energy penalty; missing out on points/prize
 * plus the health/injury hit is setback enough.
 *
 * Ervaring lowers the drain: an experienced bird flies more efficiently and burns
 * less energie, an inexperienced one burns more. The factor pivots around
 * ervaring 50 (factor 1.0) and swings by `experienceReliefSpread/2` at the
 * extremes — with 0.5 that is ±25%: ervaring 0 → ×1.25, ervaring 100 → ×0.75.
 *
 * `gaveUp*` are only used as a fallback for flights that were already live
 * before gradual draining existed (no frozen `formCost`).
 */
export const FLIGHT_FATIGUE = {
  base: 10,
  perKmDivisor: 30,
  jitter: 10,
  experienceReliefSpread: 0.5, // total swing across ervaring 0→100 (±25% around ervaring 50)
  stepMinutes: 30, // energie is deducted in blocks of this many minutes
  gaveUpBase: 6,
  gaveUpPerKmDivisor: 60,
  gaveUpJitter: 4,
} as const;

/**
 * Betting. From `windowHours` before a flight starts until the moment it starts,
 * players can bet money on outcomes. The game estimates each bird's chance from
 * its attributes + recent form; a stronger favourite pays a lower ratio. The
 * `houseMargin` is the bookmaker edge baked into every ratio.
 */
export const BETTING = {
  windowHours: 12, // bets open this many hours before the start
  minStake: 10,
  maxStake: 500,
  houseMargin: 0.12,
  minRatio: 1.05,
  maxRatio: 25,
  simIterations: 1500, // Monte-Carlo draws used to estimate fair odds
} as const;

/** Money every new player (and bot) starts with. */
export const STARTING_MONEY = 5000;

/** How many pigeons a new player starts their loft with. */
export const STARTING_PIGEONS = 6;

/**
 * Feed rations. Food stock is now kept PER TYPE. `foodPerPigeon` is the WEEKLY
 * consumption per pigeon on that ration (the daily care eats 1/7 each day from
 * that type's stock). `formRecovery`/`healthRecovery`/`enduranceRecovery`/
 * `libidoRecovery` are WEEKLY targets applied 1/7 per day. `pricePerKg` is the
 * buy price per kg for that type.
 */
export const FEED_RATIONS = {
  normal: { label: 'Normaal', foodPerPigeon: 1.0, pricePerKg: 3, formRecovery: 21, healthRecovery: 5, enduranceRecovery: 0, libidoRecovery: 0 },
  premium: { label: 'Premium', foodPerPigeon: 1.5, pricePerKg: 6, formRecovery: 28, healthRecovery: 9, enduranceRecovery: 4, libidoRecovery: 0 },
  libido: { label: 'Libido-mix', foodPerPigeon: 1.4, pricePerKg: 4.5, formRecovery: 18, healthRecovery: 5, enduranceRecovery: 0, libidoRecovery: 14 },
  herstel: { label: 'Herstel', foodPerPigeon: 1.5, pricePerKg: 3, formRecovery: 42, healthRecovery: 12, enduranceRecovery: 0, libidoRecovery: 0 },
} as const;
export type FeedRationKey = keyof typeof FEED_RATIONS;

/**
 * Starvation. A pigeon with no food in stock of its ration goes hungry, and the
 * decline ACCELERATES the longer it stays unfed: on hunger day N it loses
 * `xPerDay · N` of each attribute. Real pigeons survive only a few days without
 * food, so death becomes a real risk from `deathAfterDays` and is guaranteed by
 * `certainDeathDays`. Feeding it (any stock of its type) resets the hunger.
 */
export const STARVATION = {
  energiePerDay: 8, // energie (form) lost per hunger-day, × the day count
  healthPerDay: 5,
  conditiePerDay: 3, // DEPRECATED/unused: hunger no longer decays conditie (a trainable
  // skill) — trainable skills only decline via real ageing. Kept for reference.
  libidoPerDay: 4,
  deathAfterDays: 3, // a death chance kicks in once a bird is this many days hungry
  deathChancePerDay: 0.25, // added death chance per hunger-day beyond deathAfterDays
  deathMaxChance: 0.95,
  certainDeathDays: 7, // a bird this long without food does not survive
} as const;

/**
 * Rest bonus. A bird that stays home (does no flight) and is fed every day
 * builds up rest: every `everyDays`-th such day it gets a one-time `energy`
 * boost on top of its normal feeding recovery. The counter resets to 0 as soon
 * as the bird races, and an unfed (hungry) day breaks the streak.
 */
export const REST_BONUS = {
  everyDays: 3,
  energy: 4,
} as const;

/** Food (kg per type) a new player starts with. */
export const STARTING_FOOD_STOCK = { normal: 50, premium: 0, libido: 0, herstel: 0 };

/** Price of one kg of pigeon food when buying from the supply store. */
export const FOOD_PRICE_PER_KG = 3;

/** Fixed DAILY overhead per player (loft maintenance, bedding, etc.), charged
 *  automatically each real day in tickDailyCare. */
export const DAILY_UPKEEP_BASE = 22;

/** The FIRST band's per-pigeon rate (see UPKEEP_BANDS). Kept as its own export
 *  because the API still ships it to the client as the headline rate. */
export const DAILY_UPKEEP_PER_PIGEON = 2;

/**
 * Extra daily upkeep per pigeon owned, charged in PROGRESSIVE BANDS — like tax
 * brackets: every bird costs the rate of the band it falls in, never the top rate
 * on the whole loft.
 *
 * Why: a big loft is what buys race entries, and entries are what win the prize
 * pot, yet scale used to be nearly free (a loft of 20 cost only 1.6× a loft of 8
 * while earning ~2.5× as much). These bands make growing past the starting size a
 * real, recurring commitment instead of a one-off purchase.
 *
 * A loft at STARTING_LOFT_CAPACITY (8) pays EXACTLY what it always did — this must
 * stay true, so a smaller melker feels nothing of it. Bots sit at 8 too, so their
 * economy is untouched.
 *
 * `upTo` is inclusive, bands are listed in ascending order, and the last band's
 * rate also covers anything beyond it (defensive: capacity tops out at 20).
 */
export const UPKEEP_BANDS: { upTo: number; perPigeon: number }[] = [
  { upTo: 8, perPigeon: DAILY_UPKEEP_PER_PIGEON },
  { upTo: 12, perPigeon: 6 },
  { upTo: 16, perPigeon: 12 },
  { upTo: 20, perPigeon: 20 },
];

/** One band's share of a loft's per-pigeon upkeep (for the daily-cost breakdown). */
export interface UpkeepBandCost {
  from: number; // first bird number in this band (1-based, inclusive)
  to: number; // last bird number in this band (inclusive)
  perPigeon: number; // daily rate for a bird in this band
  birds: number; // how many of the loft's birds land in this band
  amount: number; // birds × perPigeon
}

/** Split a loft's per-pigeon upkeep over the bands it actually fills. */
export function pigeonUpkeepBands(pigeonCount: number): UpkeepBandCost[] {
  const out: UpkeepBandCost[] = [];
  let filled = 0; // birds already accounted for by lower bands
  for (const band of UPKEEP_BANDS) {
    if (filled >= pigeonCount) break;
    const birds = Math.min(pigeonCount, band.upTo) - filled;
    if (birds > 0) {
      out.push({
        from: filled + 1,
        to: band.upTo,
        perPigeon: band.perPigeon,
        birds,
        amount: birds * band.perPigeon,
      });
    }
    filled = band.upTo;
  }
  // Anything above the last band keeps paying the top rate.
  const top = UPKEEP_BANDS[UPKEEP_BANDS.length - 1];
  if (pigeonCount > filled) {
    const birds = pigeonCount - filled;
    out.push({ from: filled + 1, to: pigeonCount, perPigeon: top.perPigeon, birds, amount: birds * top.perPigeon });
  }
  return out;
}

/** Total per-pigeon upkeep a loft of `pigeonCount` birds pays per day. */
export function dailyPigeonUpkeep(pigeonCount: number): number {
  return pigeonUpkeepBands(pigeonCount).reduce((sum, b) => sum + b.amount, 0);
}

/**
 * Training options. Training costs money and a bit of the pigeon's form now,
 * in exchange for a small permanent improvement to a chosen attribute (capped)
 * plus experience. This is the long-term progression lever.
 */
export const TRAINING = {
  cost: 120, // indicative base (real per-step cost scales with level — see trainingCost)
  formCost: 15,
  attributeGain: 1.2, // average points added to the trained attribute
  experienceGain: 4,
  restWeeks: 0,
  cooldownDays: 7, // each attribute (snelheid/conditie/oriëntatie) once per week
  // Training cost rises EXPONENTIALLY with the current value (≈ ×costGrowth per +10
  // levels): cheap at low levels, a real investment near the manual cap of 80.
  //   cost(v) = max(costMin, round5( costBase · costGrowth^(v/10) ))
  // e.g. ~€90 at 50, ~€355 at 60, ~€1050 at 70, ~€2700 at 79→80. Manual training
  // is capped at GENE.trainCap (80); beyond that only racing/coach can grow a bird.
  costBase: 0.6,
  costGrowth: 2.9,
  costMin: 15,
} as const;

/**
 * Ervaring (experience) grows with DIMINISHING RETURNS. Every raw experience gain
 * — a flight, a training session, a coaching day, an event — is multiplied by
 *
 *   factor(exp) = minFactor + (maxFactor − minFactor) · ((100 − exp)/100)^curve
 *
 * so a green bird picks things up fast and a seasoned veteran barely learns
 * anything new. With the values below a rookie learns ×1.8 and the factor drops
 * below 1 around ervaring 33, to ×0.16 at 90. Climbing the whole 0→100 costs
 * ~2.4× the raw units it used to (0→50 stays about as quick as before; 90→100 is
 * the real grind), which keeps a maxed-out ervaring the mark of a true veteran.
 *
 * `minFactor` has a hard floor to respect: ervaring is stored with ONE decimal, so
 * the smallest recurring raw gain (the coach's 0.5/day, an oefenvlucht's ~0.5)
 * must still land on ≥ 0.05 after scaling or it would silently round away to
 * nothing. 0.5 × 0.12 = 0.06 — do not lower `minFactor` below 0.10.
 */
export const EXPERIENCE = {
  maxFactor: 1.8, // multiplier at ervaring 0 (rookies learn fast)
  minFactor: 0.12, // multiplier at ervaring 100 (see the rounding floor above)
  curve: 1.6, // >1 makes the slowdown bite earlier
} as const;

/**
 * Flight calendar. Every entry describes a race that is generated each week the
 * `week % everyWeeks === offset`. Extend this array to add more competitions.
 */
export interface FlightTemplate {
  key: string;
  name: string;
  type: 'club' | 'national';
  distanceKm: number;
  entryFee: number;
  /** Generated on weeks where (week % everyWeeks) === offset. */
  everyWeeks: number;
  offset: number;
}

export const FLIGHT_TEMPLATES: FlightTemplate[] = [
  { key: 'club-sprint', name: 'Clubvlucht — Sprint', type: 'club', distanceKm: 120, entryFee: 25, everyWeeks: 1, offset: 0 },
  { key: 'club-midfond', name: 'Clubvlucht — Midfond', type: 'club', distanceKm: 320, entryFee: 40, everyWeeks: 2, offset: 1 },
  { key: 'national-fond', name: 'Nationale Fondvlucht', type: 'national', distanceKm: 650, entryFee: 80, everyWeeks: 4, offset: 3 },
];

/**
 * Prize money paid out to the top finishers of a flight, scaled by flight type.
 * Index 0 = winner, 1 = second, etc. Ranks beyond the array get nothing.
 */
export type FlightTier = 'regional' | 'national' | 'international';

export const PRIZE_MONEY: Record<FlightTier, number[]> = {
  regional: [800, 600, 350, 220, 140, 90, 55, 30],
  national: [1200, 800, 500, 320, 210, 140, 95, 60, 40, 25],
  international: [2200, 1800, 1000, 650, 420, 270, 170, 100],
};

/** Ranking points awarded by finishing position (index 0 = winner). */
export const RANKING_POINTS: number[] = [
  100, 80, 65, 55, 47, 40, 34, 29, 25, 21, 18, 15, 13, 11, 9, 7, 5, 3, 2, 1,
];

/**
 * How much the distance shifts which attributes matter. Sprints reward raw
 * speed; long fond flights reward endurance and orientation. Values are the
 * weighting at the short and long ends; the engine interpolates by distance.
 */
export const DISTANCE_WEIGHTING = {
  shortKm: 100,
  longKm: 700,
  /**
   * How much each attribute contributes to a bird's RACING SPEED.
   *
   * ORIËNTATIE IS DELIBERATELY 0. It used to weigh 0.22 (short) to 0.35 (long) —
   * on a fond flight more than snelheid itself — which meant a bird with better
   * orientation simply flew faster. That never made sense: finding your way is not
   * the same as being fast. Orientation now does only what it should, through
   * `LOST`: how likely a bird is to wander off course, how big the detour is, and
   * whether it fails to get home at all that day.
   *
   * The freed weight went proportionally to snelheid and conditie, so the
   * sprinter/stayer split is unchanged in character — just sharper.
   * (Weights per column always sum to 1.)
   */
  short: { speed: 0.83, endurance: 0.17, orientation: 0 },
  long: { speed: 0.31, endurance: 0.69, orientation: 0 },
} as const;

/**
 * Which attribute a flight is likely to IMPROVE. Deliberately its own table:
 * reusing DISTANCE_WEIGHTING (as this did before) would mean orientation — now
 * weighted 0 for speed — could never be trained by racing again. A bird that flies
 * 900 km learns the route, so long flights favour conditie and oriëntatie.
 * (A coach also drills orientation, and manual training still works up to 80.)
 */
export const IMPROVE_WEIGHTING = {
  short: { speed: 0.55, endurance: 0.2, orientation: 0.25 },
  long: { speed: 0.2, endurance: 0.4, orientation: 0.4 },
} as const;

/**
 * ORIËNTATIE = navigation, and nothing else.
 *
 *   verdwaalkans = (base + max · room^curve) · (distBase + km·distPerKm) · (1 + rough·weatherK)
 *                                              room = (100 − oriëntatie)/100
 *
 * Three things scale it, all of them intuitive:
 *  - the bird's orientation (95 ≈ never, 70 modest, 30 very likely);
 *  - the DISTANCE — more kilometres, more chances to drift off course;
 *  - the WEATHER — mist, rain and wind make navigating harder, and a good
 *    navigator suffers far less from that than a poor one (on 700 km the gap
 *    between orientation 95 and 30 widens from ~40 to ~70 percentage points).
 *
 * A bird that strays usually just flies a DETOUR: real extra kilometres, so real
 * lost time, a drop down the field and extra energie spent. Only a genuinely poor
 * navigator — and mostly on a long flight — loses the way completely and fails to
 * come home that day; see `strandedMax`. She is never gone for good: she turns up
 * at the loft a few days later, empty and battered (tickStrayReturn).
 */
export const LOST = {
  base: 0.005, // stray chance that remains even at orientation 100
  max: 0.55, // added at orientation 0
  curve: 2.2, // >1 keeps a good navigator safe and makes a poor one genuinely risky
  distBase: 0.55,
  distPerKm: 0.0015, // ×1.0 at 300 km, ×1.6 at 700 km, ×2.05 at 1000 km
  weatherK: 2.5, // rough weather (0..0.30) multiplies the chance by up to 1.75
  maxChance: 0.85,
  // Size of the detour, in km: a fraction of the route, scaled by how poor the
  // navigator is. ~19 km at orientation 30 on 300 km; ~62 km on 1000 km.
  detourFraction: 0.04,
  detourSeverityBase: 0.5,
  detourSeveritySpread: 1.5,
  // Losing the way ENTIRELY (only rolled once already straying).
  strandedMax: 0.35,
  strandedCurve: 3.5,
  // How long she stays out before finding her way home.
  returnDaysBase: 1,
  returnDaysPerKm: 2 / 1000,
  returnDaysRoom: 3,
  returnDaysJitter: 0.5,
  // What she looks like when she finally turns up. The health hit is deliberately
  // mild-ish: she already comes home on an empty tank, and vluchtvorm drives the
  // illness odds now — a harsher hit would drop her straight into a spiral.
  returnEnergyMin: 2,
  returnEnergyMax: 8,
  returnHealthLossMin: 15,
  returnHealthLossMax: 25,
  returnAilmentChance: 0.45,
} as const;

/**
 * How energie (`form`) scales performance, blended by distance. On a SHORT flight
 * a tired bird still does fine (mild curve); from medium to LONG the impact of low
 * energie grows a lot (harsh curve). Experience lets a bird DOSE its energie: a
 * seasoned bird performs as if it had more energie than it really does, so with
 * equal other attributes an experienced low-energie bird can beat an inexperienced
 * high-energie one.
 */
export const ENERGIE_IMPACT: {
  short: { x: number; y: number }[];
  long: { x: number; y: number }[];
  dosingFactor: number;
} = {
  short: [{ x: 0, y: 0.8 }, { x: 50, y: 0.95 }, { x: 100, y: 1.05 }],
  long: [{ x: 0, y: 0.45 }, { x: 50, y: 0.85 }, { x: 100, y: 1.2 }],
  dosingFactor: 0.35, // at ervaring 100, recovers 35% of the (100 − energie) gap
};

/** Breeding settings. */
export const BREEDING = {
  cost: 200,
  weeksToHatch: 2, // legacy
  // Hatching is unpredictable: each moment there is a random chance, tuned so
  // that on average a maximally fertile pair (high libido + energie) hatches in
  // ~hatchMinMeanDays and a listless pair takes up to ~hatchMaxMeanDays. There
  // is no fixed timer and no countdown — it can come sooner or later.
  hatchMinMeanDays: 0.75,
  hatchMaxMeanDays: 6,
  minYoung: 1,
  maxYoung: 2,
  /** Random mutation range (+/-) applied to inherited attributes. */
  mutation: 8,
  /** Parents must have at least this much energie to breed. Higher energie (and
   *  libido) still make a hatch come faster — this is only the floor. */
  minParentForm: 20,
} as const;

/**
 * Age curve: performance multiplier by age in weeks (interpolated). Only the
 * RAMP-UP (a youngster growing into its prime) lives here now; the old-age
 * DOWNSLOPE is deliberately FLAT at 1.0, because ageing past the prime is modelled
 * as a real, permanent decline of the stored skills instead (see AGING /
 * runAgeDecline) — so an old bird slows down because its snelheid/conditie/
 * oriëntatie actually drop, not via a hidden multiplier (avoids double-penalising).
 */
export const AGE_CURVE: { weeks: number; multiplier: number }[] = [
  { weeks: 0, multiplier: 0.0 },
  { weeks: RACE_AGE_WEEKS, multiplier: 0.6 },
  { weeks: 20, multiplier: 0.85 },
  { weeks: 52, multiplier: 1.0 }, // ~1 year: coming into prime
  { weeks: 520, multiplier: 1.0 }, // prime held flat; ageing is via skill decline
];

/**
 * Ageing: past its prime a pigeon's racing skills (snelheid/conditie/oriëntatie)
 * PERMANENTLY decline, at a pace that differs per bird (its `declineRate` gene).
 * Runs once per rolled game-week (see health.runAgeDecline). Realistic: peak
 * ~1–4 years, a gentle slip from ~4 years, and a clear fade toward 8–10 years.
 *   decline/week = declinePerWeekBase · (ageWeeks − peakEndWeeks)/52 · declineRate
 */
export const AGING = {
  peakEndWeeks: 208, // ~4 game-years: skills start to fade past this age
  declinePerWeekBase: 0.08, // base points/attribute per rolled week, per year past peak
  floor: 5, // skills never decline below this
} as const;

/** The NPC supply market lists this many fresh pigeons for sale each week. */
export const NPC_MARKET_LISTINGS_PER_WEEK = 4;

/** Number of bot lofts the world is seeded with on first boot. */
export const DEFAULT_BOT_COUNT = 8;

/**
 * How a bot loft runs itself. Bots used to do nothing but eat and occasionally
 * train, so their flocks only ever shrank (deaths subtract, nothing adds) and
 * the field thinned out season after season. These knobs let them spend the
 * money they earn on the same things a player would: staff, cures, a coach, a
 * bigger loft and young birds.
 *
 * Every action is gated on a cash floor so a bot can never spend itself into
 * the red — a negative till would lock it out of entering flights entirely.
 */
export const BOT = {
  /** Cash a bot always keeps in hand; it never spends below this. */
  reserve: 1500,
  /**
   * A bot only enters a bird that can actually fly the route: it wants this much
   * energie relative to what the distance is expected to cost it
   * (`expectedFlightEnergyCost`). Replaces the old flat floor of 45, which was
   * both too strict on a 100 km regiovlucht (~18 energie) and far too lax on the
   * grote fond (~48) — bots kept sending near-empty birds to Barcelona, and a
   * bird flown to 0 is the one that gets injured, falls ill and dies. That was
   * the engine of the bot-flock decay.
   */
  raceHeadroom: 1.15,
  /** Absolute floor regardless of distance; the game's own rule is 1 energie. */
  minFormRegular: 12,
  /**
   * The estafettevlucht has NO energie floor. Fielding three birds is the whole
   * point of the format, and how much energie a bird needs for its leg is the
   * owner's own call — a player may enter a bird with 5 energie too. Bots still
   * pick their freshest three; they just are not blocked.
   */
  minFormRelay: 0,
  /**
   * Below this flock size a bot holds its best doffer and duivin OUT of the race
   * pool so a pair is always free to breed. Without it a bot races every fit
   * bird, leaves only the exhausted ones at home, and so never breeds at all —
   * measured: thinning lofts sat at "koppels 0" for months while their bank grew.
   */
  breedReserveFlock: 8,
  /** A bot puts a bird on a rest cure once its energie drops below this. */
  restCureBelowForm: 28,
  /** Cash a bot wants free before paying for a rest cure. */
  restCureReserve: 3000,
  /** How many birds a bot coaches at once, and the cash it wants free for it. */
  maxCoached: 2,
  coachReserve: 8000,
  /** A bot only upgrades its loft when it can pay this multiple of the price. */
  capacityReserveFactor: 2.5,
  /**
   * Ceiling on a bot's loft. Not an economic rule but a platform one: every bird
   * in the world is read on every request and rewritten at the 00:00 tick, and
   * that tick runs out of D1's 50 queries per invocation somewhere around 350
   * birds (see context.md § Performance). Eight bots free to climb to 20 would
   * add ~100 birds on their own. Twelve keeps them real competitors — a full
   * band-2 loft — without eating the headroom.
   */
  maxCapacity: 12,
  /** Breeding: at most this many pairs at once, and only with room to spare. */
  maxPairs: 2,
  breedReserve: 2500,
  /** A parent must have at least this much libido before a bot pairs it up. */
  breedMinLibido: 35,
  /** Weeks of food a bot keeps in stock (it buys when it drops below one week). */
  foodWeeksBuffer: 3,
  /**
   * From this much cash a bot switches its loft to Herstelvoer. It costs the
   * same €3/kg as Normaal and returns +42 energie / +12 gezondheid a week
   * instead of +21/+5. A bot racing two or three times a week loses more health
   * per week than Normaal puts back (spelregels §4.4), so its flock quietly
   * wasted away — measured: healthy-looking lofts drifting to gezondheid 30-50,
   * then dying of ailments, while sitting on €26.000. This is the cheapest
   * possible fix and exactly what a player with that bank would do.
   */
  goodFeedFrom: 2500,
  /** A bot rests a bird rather than racing it when its gezondheid is under this. */
  minHealthRace: 45,
} as const;

/** Pool of names used when generating pigeons and bots. */
export const PIGEON_NAMES = [
  'Bliksem', 'Storm', 'Pijl', 'Wervelwind', 'Comet', 'Vega', 'Orion', 'Nova',
  'Flits', 'Turbo', 'Raket', 'Zephyr', 'Aurora', 'Falcon', 'Sirius', 'Atlas',
  'Duke', 'Rebel', 'Ninja', 'Spirit', 'Blitz', 'Echo', 'Rocky', 'Diesel',
  'Krak', 'Kampioen', 'Fenix', 'Titan', 'Zeus', 'Hermes', 'Bolt', 'Dash',
];

export const BOT_LOFT_NAMES = [
  'De Snelle Wieken', 'Hok Vandenberghe', 'De Blauwe Doffers', 'Team Wingman',
  'De Wolkenridders', 'Duivenkot Marcel', 'De Verre Reizigers', 'Hok De Vliegende Hollander',
  'De Nachtvluchters', 'Roekoe Racers', 'De Windvangers', 'Hok Zonnedael',
];

// ===========================================================================
// Real-time flights
// ===========================================================================

/** Time zone flights are scheduled in (wall-clock hours below are in this zone). */
export const TIMEZONE = 'Europe/Brussels';

/**
 * Flights run in REAL time: a race that would take a pigeon ~3 hours to fly
 * actually takes ~3 hours in the game. (Minimum below just avoids zero-length
 * edge cases.)
 */
export const MIN_FLIGHT_SECONDS = 300;

/** Live commentary is emitted every this many real seconds (10 minutes). */
export const COMMENTARY_INTERVAL_SECONDS = 600;

/** How many days of flights are kept on the calendar ahead of "now". */
export const SCHEDULE_HORIZON_DAYS = 4;

export type Country = 'BE' | 'NL' | 'FR' | 'GB' | 'LU' | 'DE' | 'ES';

/** A racing city, with coordinates used for distance + real weather. */
export interface RaceCity {
  name: string;
  lat: number;
  lon: number;
  country: Country;
  flanders?: boolean; // true for cities in Vlaanderen (regional races)
  intlOnly?: boolean; // grote-fond release points, only used for international routes
}

/**
 * Cities used to build flights. Regional races pick two Flemish cities,
 * national races two "greater region" cities (BE + neighbours, no Channel
 * crossing, no far-south release points), international races any two —
 * including the deep-south grote-fond release points (Barcelona, Perpignan…).
 * Routes (start + finish) are randomised per flight within the tier's window.
 */
export const RACE_CITIES: RaceCity[] = [
  // Vlaanderen (BE, regional pool)
  { name: 'Gent', lat: 51.05, lon: 3.72, country: 'BE', flanders: true },
  { name: 'Antwerpen', lat: 51.22, lon: 4.4, country: 'BE', flanders: true },
  { name: 'Brugge', lat: 51.21, lon: 3.22, country: 'BE', flanders: true },
  { name: 'Kortrijk', lat: 50.83, lon: 3.26, country: 'BE', flanders: true },
  { name: 'Hasselt', lat: 50.93, lon: 5.34, country: 'BE', flanders: true },
  { name: 'Leuven', lat: 50.88, lon: 4.7, country: 'BE', flanders: true },
  { name: 'Oostende', lat: 51.23, lon: 2.92, country: 'BE', flanders: true },
  { name: 'Mechelen', lat: 51.03, lon: 4.48, country: 'BE', flanders: true },
  { name: 'Aalst', lat: 50.94, lon: 4.04, country: 'BE', flanders: true },
  { name: 'Sint-Niklaas', lat: 51.16, lon: 4.14, country: 'BE', flanders: true },
  { name: 'Roeselare', lat: 50.95, lon: 3.13, country: 'BE', flanders: true },
  { name: 'Turnhout', lat: 51.32, lon: 4.95, country: 'BE', flanders: true },
  { name: 'Genk', lat: 50.97, lon: 5.5, country: 'BE', flanders: true },
  { name: 'Ieper', lat: 50.85, lon: 2.89, country: 'BE', flanders: true },
  { name: 'Dendermonde', lat: 51.03, lon: 4.1, country: 'BE', flanders: true },
  { name: 'Geraardsbergen', lat: 50.77, lon: 3.88, country: 'BE', flanders: true },
  // Wallonië + Brussel (BE, national pool)
  { name: 'Brussel', lat: 50.85, lon: 4.35, country: 'BE' },
  { name: 'Charleroi', lat: 50.41, lon: 4.44, country: 'BE' },
  { name: 'Luik', lat: 50.63, lon: 5.57, country: 'BE' },
  { name: 'Namen', lat: 50.47, lon: 4.87, country: 'BE' },
  { name: 'Bergen', lat: 50.45, lon: 3.95, country: 'BE' },
  { name: 'Doornik', lat: 50.61, lon: 3.39, country: 'BE' },
  { name: 'Aarlen', lat: 49.68, lon: 5.81, country: 'BE' },
  { name: 'Bastenaken', lat: 50.0, lon: 5.72, country: 'BE' },
  // Nederland
  { name: 'Amsterdam', lat: 52.37, lon: 4.9, country: 'NL' },
  { name: 'Rotterdam', lat: 51.92, lon: 4.48, country: 'NL' },
  { name: 'Eindhoven', lat: 51.44, lon: 5.48, country: 'NL' },
  { name: 'Breda', lat: 51.59, lon: 4.78, country: 'NL' },
  { name: 'Maastricht', lat: 50.85, lon: 5.69, country: 'NL' },
  { name: 'Utrecht', lat: 52.09, lon: 5.12, country: 'NL' },
  { name: 'Groningen', lat: 53.22, lon: 6.57, country: 'NL' },
  { name: 'Venlo', lat: 51.37, lon: 6.17, country: 'NL' },
  // Frankrijk
  { name: 'Rijsel', lat: 50.63, lon: 3.06, country: 'FR' },
  { name: 'Parijs', lat: 48.85, lon: 2.35, country: 'FR' },
  { name: 'Bourges', lat: 47.08, lon: 2.4, country: 'FR' },
  { name: 'Reims', lat: 49.26, lon: 4.03, country: 'FR' },
  { name: 'Amiens', lat: 49.9, lon: 2.3, country: 'FR' },
  { name: 'Straatsburg', lat: 48.57, lon: 7.75, country: 'FR' },
  { name: 'Orléans', lat: 47.9, lon: 1.9, country: 'FR' },
  { name: 'Limoges', lat: 45.83, lon: 1.26, country: 'FR' },
  // Engeland
  { name: 'Londen', lat: 51.51, lon: -0.13, country: 'GB' },
  { name: 'Dover', lat: 51.13, lon: 1.31, country: 'GB' },
  { name: 'Canterbury', lat: 51.28, lon: 1.08, country: 'GB' },
  { name: 'Brighton', lat: 50.82, lon: -0.14, country: 'GB' },
  // Luxemburg
  { name: 'Luxemburg', lat: 49.61, lon: 6.13, country: 'LU' },
  { name: 'Ettelbruck', lat: 49.85, lon: 6.1, country: 'LU' },
  // Duitsland
  { name: 'Keulen', lat: 50.94, lon: 6.96, country: 'DE' },
  { name: 'Aken', lat: 50.78, lon: 6.08, country: 'DE' },
  { name: 'Düsseldorf', lat: 51.23, lon: 6.78, country: 'DE' },
  { name: 'Trier', lat: 49.75, lon: 6.64, country: 'DE' },
  { name: 'Frankfurt', lat: 50.11, lon: 8.68, country: 'DE' },
  { name: 'Berlijn', lat: 52.52, lon: 13.4, country: 'DE' },
  // Grote-fond release points (deep south) — international routes only. These are
  // the classic long-distance races (Barcelona, Perpignan, …), 900–1200 km away.
  { name: 'Lyon', lat: 45.76, lon: 4.84, country: 'FR', intlOnly: true },
  { name: 'Bordeaux', lat: 44.84, lon: -0.58, country: 'FR', intlOnly: true },
  { name: 'Toulouse', lat: 43.6, lon: 1.44, country: 'FR', intlOnly: true },
  { name: 'Marseille', lat: 43.3, lon: 5.37, country: 'FR', intlOnly: true },
  { name: 'Perpignan', lat: 42.7, lon: 2.9, country: 'FR', intlOnly: true },
  { name: 'Barcelona', lat: 41.39, lon: 2.17, country: 'ES', intlOnly: true },
];

/** Coordinates by city name (derived), for weather lookups. */
export const CITY_COORDS: Record<string, { lat: number; lon: number }> = Object.fromEntries(
  RACE_CITIES.map((c) => [c.name, { lat: c.lat, lon: c.lon }]),
);

/** Per-tier settings: which cities, distance window, entry fee and label. */
export interface TierConfig {
  label: string;
  name: string;
  entryFee: number;
  minKm: number;
  maxKm: number;
}

export const FLIGHT_TIERS: Record<FlightTier, TierConfig> = {
  regional: { label: 'Regionaal', name: 'Regiovlucht', entryFee: 10, minKm: 100, maxKm: 200 },
  national: { label: 'Nationaal', name: 'Nationale vlucht', entryFee: 20, minKm: 200, maxKm: 500 },
  international: { label: 'Internationaal', name: 'Internationale vlucht', entryFee: 40, minKm: 400, maxKm: 1200 },
};

/**
 * Auctions. A single top pigeon is auctioned every Sunday (see auction.ts).
 * On top of that, rescue-centre ("opvangcentrum") birds pop up at random,
 * regular moments: low-quality pigeons that still fetch a starting bid of €25
 * because a new owner can always train them up.
 */
export const AUCTION = {
  /** Rescue-centre auctions: mean hours between appearances (memoryless). ~60h
   *  gives roughly 2–3 per week instead of several a day. */
  shelterMeanIntervalHours: 60,
  /** How long a rescue-centre auction stays open, in hours. Longer window so a
   *  once-a-day player still catches the (now rarer) auction. */
  shelterWindowHours: 24,
  /** Never run more than this many rescue auctions at once. */
  shelterMaxConcurrent: 1,
  /**
   * How often the spawn dice are rolled, in minutes. The draw is memoryless and
   * scaled by elapsed time, so rolling every quarter of an hour keeps the same
   * ~60h mean — but it stops the world row from being rewritten on every single
   * request, which was burning the D1 daily write budget.
   */
  shelterCheckMinutes: 15,
  /** Opening bid for a rescue-centre bird. */
  shelterStartBid: 25,
  /**
   * Endgame rules. Bidding is free for as long as an auction has more than
   * `finalPhaseMinutes` to run; inside that window every player gets only
   * `finalPhaseMaxBids` bids on that bird. The point is to stop the drip of
   * one-increment nibbles: with three shots left you go to your real maximum,
   * which ends the auction sooner AND cuts the polling load it generates.
   * A bid inside the last `antiSnipeMinutes` still pushes the close time back to
   * that many minutes, so nobody wins by bidding at the buzzer — but the cap keeps
   * counting, so an extension cannot be farmed forever.
   */
  /** A Sunday/shelter auction opens at this fraction of the bird's market value. */
  openingBidFraction: 0.3,
  finalPhaseMinutes: 30,
  finalPhaseMaxBids: 3,
  antiSnipeMinutes: 5,
  /** Quality range for rescue birds (they are no racers). */
  shelterQualityMin: 0.05,
  shelterQualityMax: 0.35,
  /** Now and then a rescue bird is a cut above — still no Sunday-topper, just a
   *  decent project. Chance + its (higher) quality range. */
  shelterBetterChance: 0.22,
  shelterBetterQualityMin: 0.45,
  shelterBetterQualityMax: 0.68,
} as const;

/**
 * Sponsors. Companies do NOT appear until a loft has actually earned their
 * interest — nothing is available at the start. As soon as your pigeons and
 * results cross a threshold, that sponsor makes an OFFER (a notification fires
 * and it shows up on the sponsor page) which the player accepts or refuses.
 * Better pigeons / better results attract bigger sponsors with bigger offers.
 *
 * A loft may hold several contracts at once, but only ONE per `category`:
 * competitors in the same category fight over you. Accepting a competitor while
 * you already back one means breaking the old contract and paying its penalty
 * (`breakPenalty`). Sponsors in different categories happily coexist.
 *
 * Once active a sponsor pays a one-time signing bonus, a weekly stipend and a
 * bonus for every flight you win. Amounts scale with tier.
 */
export interface SponsorDef {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  tier: number;
  category: string; // competition group: café, frituur, bakkerij, landbouw, bank, racing, slagerij, brouwerij, dierenwinkel, bouw, verzekering, telecom, loterij …
  categoryLabel: string; // human label for the category
  /** Interest thresholds — the sponsor offers once ALL listed are met. */
  req: {
    level?: number;
    totalWins?: number;
    entries?: number;
    seasonPoints?: number;
    bestTalent?: number;
    gold?: number;
  };
  signingBonus: number; // one-time, first time you accept this sponsor
  /** Paid EVERY DAY while the contract is active (see tickDailyCare). Daily,
   *  not weekly, so it lines up with the daily running costs the player sees. */
  dailyStipend: number;
  /** Reference podium bonus: what a WIN on a NATIONAL flight pays. Other
   *  placings and tiers scale off it — see sponsorPodiumBonus(). */
  podiumBase: number;
  breakPenalty: number; // fee to terminate this contract early
}

/**
 * After a player refuses (or cancels) a sponsor the offer disappears, but the
 * company may come knocking again once this much real time has passed — with
 * terms rescaled to how the loft has performed since (better → more, worse →
 * less). Bounds cap that rescaling.
 */
export const SPONSOR_REOFFER_COOLDOWN_HOURS = 72;
export const SPONSOR_REOFFER_MULT_MIN = 0.7;
export const SPONSOR_REOFFER_MULT_MAX = 1.5;

/**
 * Sponsors are earned on the wing: an offer is only ever made right after one of a
 * loft's birds does WELL in a real competition flight (a podium or a win), and even
 * then only by chance (see below) — never on a timer and never all at once. These
 * are the odds that a good result draws a new suitor:
 *  - a win (1st) has `winChance`;
 *  - a mere podium (2nd/3rd) has the smaller `podiumChance`.
 * At most one offer is created per flight, and the cap below still holds.
 */
export const SPONSOR_OFFER_ON_PERFORMANCE = {
  winChance: 0.5,
  podiumChance: 0.25,
} as const;

/**
 * A short floor between two sponsor offers, so a lucky streak of back-to-back
 * podiums can't hand you several suitors within minutes. The performance trigger
 * above is the real gate; this just spaces things out a little.
 */
export const SPONSOR_OFFER_SPACING_HOURS = 6;

/**
 * Hard cap on how many sponsor offers can be pending at once. Together with the
 * spacing above this keeps the sponsor page calm: a player weighs at most a couple
 * of suitors, never a wall of them. Also self-heals any loft that already banked a
 * burst of offers before this cap existed — the excess is trimmed on read and the
 * dropped sponsors simply trickle back later.
 */
export const SPONSOR_MAX_PENDING_OFFERS = 2;

/**
 * Season review of active sponsor contracts. At each season rollover a sponsor
 * compares the loft's just-ended season points to the previous season's. If they
 * dropped below `keepRatio` of that reference, the sponsor ends the contract
 * (no break penalty for the player — the sponsor is the one walking away). Only
 * judged once the reference season had at least `minReviewPoints` points, so a
 * loft that never really got going isn't punished for noise.
 */
export const SPONSOR_REVIEW = {
  keepRatio: 0.6, // this season must be >= 60% of last season's points
  minReviewPoints: 20,
} as const;

/**
 * How a podium finish converts into sponsor money.
 *
 * A sponsor carries ONE reference amount (`podiumBase` = a win on a NATIONAL
 * flight); the actual payout is `podiumBase × tier factor × placing factor`,
 * rounded to €5. Two shared tables instead of a 3×3 grid per sponsor keeps the
 * catalogue readable and the rules explainable to players.
 *
 * The tier factors mirror the PRIZE MONEY ratio (regional 800 / national 1200 /
 * international 2200 for a win), because that is exactly the prestige a sponsor
 * is buying: it pays in proportion to the race it gets its logo shown at. Over a
 * normal week (3 regional + 2 national + 2 international) the average factor is
 * ~1.06, so tiering REDISTRIBUTES the money towards the big races rather than
 * inflating it.
 *
 * Only the three competition tiers pay: an oefenvlucht, the titanenwedstrijd and
 * the estafettevlucht yield no sponsor money (a titan's `type` is derived from
 * its distance, so callers must check the flight KIND, not its tier).
 */
export const SPONSOR_TIER_FACTOR: Record<FlightTier, number> = {
  regional: 0.6,
  national: 1.0,
  international: 1.8,
};

/** Placing factor: 1e full, 2e ~60%, 3e ~35%. Nothing below the podium. */
export const SPONSOR_PODIUM_FACTOR = [1, 0.6, 0.35] as const;

/** What one sponsor pays for a given placing on a given tier (0 = no bonus). */
export function sponsorPodiumBonus(podiumBase: number, tier: FlightTier, rank: number): number {
  const placing = SPONSOR_PODIUM_FACTOR[rank - 1];
  if (!placing) return 0; // outside the podium
  const raw = podiumBase * (SPONSOR_TIER_FACTOR[tier] ?? 1) * placing;
  return Math.max(5, Math.round(raw / 5) * 5);
}

export const SPONSORS: SponsorDef[] = [
  // Tier 1 — first real milestones (a first win, loyal participation).
  {
    id: 'zatte_duif', name: 'Café De Zatte Duif', icon: '🍺', tier: 1,
    category: 'cafe', categoryLabel: 'Café',
    tagline: 'Ge hebt uw eerste vlucht gewonnen! Ons café hangt vol duivenfoto’s — kom erbij.',
    req: { totalWins: 1 }, signingBonus: 350, dailyStipend: 25, podiumBase: 50, breakPenalty: 300,
  },
  {
    id: 'vetzakske', name: "Frituur 't Vetzakske", icon: '🍟', tier: 1,
    category: 'frituur', categoryLabel: 'Frituur',
    tagline: 'Ge zijt een trouwe deelnemer. Elke overwinning trakteren we op een grote friet.',
    req: { entries: 12 }, signingBonus: 500, dailyStipend: 35, podiumBase: 65, breakPenalty: 400,
  },
  // Tier 2 — a good bird, some season success, a rival café.
  {
    id: 'kruimeltje', name: "Bakkerij 't Kruimeltje", icon: '🥖', tier: 2,
    category: 'bakkerij', categoryLabel: 'Bakkerij',
    tagline: 'Zo’n getalenteerde duif verdient verse pistolets, elke zondagmorgen.',
    req: { bestTalent: 70 }, signingBonus: 700, dailyStipend: 50, podiumBase: 90, breakPenalty: 550,
  },
  {
    id: 'den_dorst', name: 'Café Den Droogen Dorst', icon: '🍻', tier: 2,
    category: 'cafe', categoryLabel: 'Café',
    tagline: 'Dat café verderop mag u dan wel hebben, MAAR wij bieden meer, melker.',
    req: { totalWins: 5 }, signingBonus: 800, dailyStipend: 55, podiumBase: 100, breakPenalty: 650,
  },
  {
    id: 'van_hoof', name: 'Landbouwmachines Van Hoof', icon: '🚜', tier: 2,
    category: 'landbouw', categoryLabel: 'Landbouw',
    tagline: 'Wij houden van sterke beesten met pk’s onder de vleugels.',
    req: { bestTalent: 80 }, signingBonus: 1000, dailyStipend: 70, podiumBase: 120, breakPenalty: 800,
  },
  // Tier 3 — top performers, a rival frituur, big money.
  {
    id: 'gulden_friet', name: 'Frituur De Gulden Friet', icon: '🍟', tier: 3,
    category: 'frituur', categoryLabel: 'Frituur',
    tagline: 'Acht overwinningen?! Laat die andere frituur maar zitten, wij bakken groter.',
    req: { totalWins: 8 }, signingBonus: 1250, dailyStipend: 90, podiumBase: 145, breakPenalty: 1000,
  },
  {
    id: 'fondinvest', name: 'Duivenbank Fondinvest', icon: '🏦', tier: 3,
    category: 'bank', categoryLabel: 'Bank',
    tagline: 'Uw prestaties, onze investering. Beleg in pluimen.',
    req: { level: 6 }, signingBonus: 1450, dailyStipend: 105, podiumBase: 165, breakPenalty: 1200,
  },
  {
    id: 'snelle_vleugel', name: 'Racing Team Snelle Vleugel', icon: '🏎️', tier: 3,
    category: 'racing', categoryLabel: 'Racingteam',
    tagline: 'Alleen echte winnaars dragen ons logo. Jij hoort er nu bij.',
    req: { gold: 12 }, signingBonus: 1900, dailyStipend: 135, podiumBase: 215, breakPenalty: 1550,
  },

  // --- Extra variëteit: nieuwe categorieën, rivalen en een prestige-tier 4 ---
  // Geen enkele sponsor wordt zomaar aangeboden: een aanbod komt enkel (en met kans)
  // ná een goede competitievlucht (podium/overwinning), één tegelijk — zie
  // evaluateSponsorOffers + SPONSOR_OFFER_ON_PERFORMANCE in sponsors.ts/schedule.ts.
  // Tier 1 — laagdrempelige buurtsponsors in nieuwe categorieën.
  {
    id: 'den_beenhouwer', name: 'Slagerij Den Beenhouwer', icon: '🥩', tier: 1,
    category: 'slagerij', categoryLabel: 'Slagerij',
    tagline: 'Sterke duiven, sterke worst. Elke deelnemer is er bij ons eentje.',
    req: { entries: 6 }, signingBonus: 400, dailyStipend: 30, podiumBase: 55, breakPenalty: 350,
  },
  {
    id: 'het_schuim', name: "Brouwerij 't Schuim", icon: '🍺', tier: 1,
    category: 'brouwerij', categoryLabel: 'Brouwerij',
    tagline: 'Een pint op elke thuiskomst — proost, melker!',
    req: { level: 3 }, signingBonus: 550, dailyStipend: 40, podiumBase: 70, breakPenalty: 450,
  },
  // Tier 2 — een goede duif, seizoenspunten, een rivaal-café.
  {
    id: 'de_pluim', name: 'Dierenspeciaalzaak De Pluim', icon: '🐾', tier: 2,
    category: 'dierenwinkel', categoryLabel: 'Dierenwinkel',
    tagline: 'Wij kennen onze beestjes — en die van u zijn iets speciaals.',
    req: { bestTalent: 65 }, signingBonus: 650, dailyStipend: 45, podiumBase: 85, breakPenalty: 500,
  },
  {
    id: 'van_steen', name: 'Bouwbedrijf Van Steen', icon: '🧱', tier: 2,
    category: 'bouw', categoryLabel: 'Bouw',
    tagline: 'Wij bouwen aan uw hok én aan uw palmares.',
    req: { seasonPoints: 120 }, signingBonus: 900, dailyStipend: 65, podiumBase: 110, breakPenalty: 750,
  },
  // Tier 3 — grote spelers, extra rivalen (verzekering, café).
  {
    id: 'zeker_vast', name: 'Verzekeringen Zeker & Vast', icon: '🛡️', tier: 3,
    category: 'verzekering', categoryLabel: 'Verzekering',
    tagline: 'Zoveel vluchten, zoveel vertrouwen. Wij dekken uw duiven graag.',
    req: { entries: 40 }, signingBonus: 1350, dailyStipend: 95, podiumBase: 155, breakPenalty: 1100,
  },
  {
    id: 'duivenkoning', name: 'Café De Duivenkoning', icon: '👑', tier: 3,
    category: 'cafe', categoryLabel: 'Café',
    tagline: 'Twaalf overwinningen! Aan onze toog zit voortaan een koning.',
    req: { totalWins: 12 }, signingBonus: 1600, dailyStipend: 115, podiumBase: 180, breakPenalty: 1300,
  },
  // Tier 4 — prestige. Alleen de absolute top haalt deze binnen.
  {
    id: 'vleugelnet', name: 'Telecom Vleugelnet', icon: '📡', tier: 4,
    category: 'telecom', categoryLabel: 'Telecom',
    tagline: 'Het snelste netwerk zoekt het snelste hok. Dat ben jij.',
    req: { level: 10 }, signingBonus: 2300, dailyStipend: 165, podiumBase: 255, breakPenalty: 1900,
  },
  {
    id: 'gouden_ring', name: 'Nationale Loterij — De Gouden Ring', icon: '🎰', tier: 4,
    category: 'loterij', categoryLabel: 'Loterij',
    tagline: 'Driehonderd punten? Jij weet wat winnen is. Speel met ons mee.',
    req: { seasonPoints: 300 }, signingBonus: 3000, dailyStipend: 150, podiumBase: 235, breakPenalty: 1700,
  },
  {
    id: 'turbo_motors', name: 'Formule Duif Racing', icon: '🏆', tier: 4,
    category: 'racing', categoryLabel: 'Racingteam',
    tagline: 'Twintig gouden medailles. Laat dat andere team maar zitten — dit is de grote liga.',
    req: { gold: 20 }, signingBonus: 2800, dailyStipend: 200, podiumBase: 310, breakPenalty: 2300,
  },
];

/**
 * Racing improves birds. After a flight each participant has a chance to gain a
 * little in the attribute that mattered most for that distance (racing builds
 * condition). Better placings and lower current values improve more easily.
 */
export const IMPROVE = {
  cap: 96, // racing can nudge slightly past the training cap (92)
  baseChance: 0.4,
  gainMin: 0.4,
  gainMax: 1.6,
  // Racing improves a bird MORE when it is weaker overall AND when it performed
  // better in the race — both are multiplicative factors, so a lesser bird that
  // punches above its weight learns the most (it catches up), while a top bird
  // near the cap gains little. See finalizeFlight:
  //   chance ≈ base·(0.4+room)·(0.5+weakness·weaknessWeight)·(0.6+place·0.8)
  weaknessWeight: 1.5, // how strongly being a weaker bird raises the improve chance
  maxChance: 0.92, // ceiling on the per-race improve chance
  weaknessGainSpread: 0.8, // a weaker bird also gains MORE per improvement
} as const;

/** Dutch labels for the three trainable/improvable attributes. */
export const IMPROVE_ATTR_LABEL: Record<'speed' | 'endurance' | 'orientation', string> = {
  speed: 'snelheid',
  endurance: 'conditie',
  orientation: 'oriëntatie',
};

// ===========================================================================
// Breeds (rassen) — purely cosmetic, but rarer breeds fetch a higher price
// ===========================================================================
//
// Every pigeon has a BREED. It only changes the photo shown for the bird and,
// via its rarity, a small price premium — it has NO effect on attributes or
// race performance. Breeds are rolled by WEIGHT when a bird is created (the
// weights + names + photos mirror roekoe.org/wiki/breeds). Breeding two birds
// of the SAME breed keeps that breed; two DIFFERENT breeds yield a `mixed`
// (Gemengd) bird. Photos live in client/public/pigeon-images/ (`image` field).

export type BreedRarity = 'algemeen' | 'ongewoon' | 'zeldzaam' | 'legendarisch' | 'gemengd';

export interface BreedDef {
  id: string; // stable slug stored on the pigeon
  name: string; // display name
  rarity: BreedRarity;
  weight: number; // roll weight (0 = never rolled randomly, e.g. mixed)
  image: string; // filename under /pigeon-images/
}

/** Dutch labels + a small price premium per rarity tier. */
export const BREED_RARITY: Record<BreedRarity, { label: string; priceMult: number }> = {
  algemeen: { label: 'Algemeen', priceMult: 1.0 },
  ongewoon: { label: 'Ongewoon', priceMult: 1.08 },
  zeldzaam: { label: 'Zeldzaam', priceMult: 1.2 },
  legendarisch: { label: 'Legendarisch', priceMult: 1.4 },
  gemengd: { label: 'Gemengd', priceMult: 1.0 },
};

/**
 * The rollable breeds (weights straight from roekoe.org/wiki/breeds) plus the
 * special non-rollable `mixed` breed used for cross-breed young. `De Stadsduif`
 * and `mixed` share the default `pigeon.png` photo (the site has no dedicated
 * image for either).
 */
export const PIGEON_BREEDS: BreedDef[] = [
  { id: 'stadsduif', name: 'De Stadsduif', rarity: 'algemeen', weight: 130, image: 'pigeon.png' },
  { id: 'blauwe-geschelpte', name: 'Blauwe Geschelpte', rarity: 'algemeen', weight: 90, image: '1.png' },
  { id: 'blauwe-band', name: 'Blauwe Band', rarity: 'algemeen', weight: 90, image: '2.png' },
  { id: 'vale', name: 'Vale', rarity: 'ongewoon', weight: 30, image: '3.png' },
  { id: 'rode', name: 'Rode', rarity: 'algemeen', weight: 80, image: '4.png' },
  { id: 'bruine', name: 'Bruine', rarity: 'ongewoon', weight: 50, image: '5.png' },
  { id: 'witte', name: 'Witte', rarity: 'ongewoon', weight: 50, image: '6.png' },
  { id: 'schimmel', name: 'Schimmel', rarity: 'algemeen', weight: 80, image: '7.png' },
  { id: 'bonte', name: 'Bonte', rarity: 'legendarisch', weight: 5, image: '8.png' },
  { id: 'golden-ace', name: 'Golden Ace', rarity: 'legendarisch', weight: 5, image: '9.png' },
  { id: 'meulemans', name: 'Meulemans', rarity: 'zeldzaam', weight: 15, image: '10.png' },
  { id: 'mixed', name: 'Gemengd', rarity: 'gemengd', weight: 0, image: 'pigeon.png' },
];

/** Breed used when two different breeds are crossed. */
export const MIXED_BREED_ID = 'mixed';
/** Default breed id (fallback for legacy birds without one). */
export const DEFAULT_BREED_ID = 'stadsduif';

// ===========================================================================
// Health: disease, injury, the infirmary and mortality
// ===========================================================================

export type Severity = 'licht' | 'matig' | 'ernstig';

export interface AilmentTemplate {
  name: string;
  severity: Severity;
  description: string;
  /**
   * What brings an INJURY on (diseases leave this undefined):
   *  - 'overbelasting' — caused by the effort itself, so its odds and its severity
   *    follow the bird's vluchtvorm (energie + gezondheid). Manage your loft well
   *    and these become rare.
   *  - 'pech' — plain bad luck: a hawk, a collision. A fit bird is no safer from a
   *    sperwer than a tired one, so these run on a small FLAT chance and their
   *    severity is drawn uniformly. They are the reason a perfectly kept bird can
   *    still come home hurt.
   */
  cause?: 'overbelasting' | 'pech';
}

/** Diseases a pigeon can catch (contagious if not isolated in the infirmary). */
export const DISEASES: AilmentTemplate[] = [
  { name: 'Het Geel', severity: 'licht', description: 'Trichomonaden: gele belslag in de keel, de duif eet moeizaam.' },
  { name: 'Duivenpokken', severity: 'matig', description: 'Wratige bultjes op snavel en poten door een virus.' },
  { name: 'Ornithose', severity: 'matig', description: 'Luchtweginfectie: loopneus, piepende adem en tranende ogen.' },
  { name: 'Coccidiose', severity: 'matig', description: 'Darmparasiet: waterige groene mest en sloomheid.' },
  { name: 'Paramyxovirose', severity: 'ernstig', description: 'Virus met draaihals en verlamming. Zeer besmettelijk en gevaarlijk.' },
  { name: 'Salmonellose (paratyfus)', severity: 'ernstig', description: 'Bacterie die gewrichten en organen aantast; kan dodelijk zijn.' },
];

/** Injuries a pigeon can pick up (mostly during flights). Not contagious. */
export const INJURIES: AilmentTemplate[] = [
  // Bad luck: an accident or a predator. Flat odds — being fit is no protection.
  { name: 'Gebroken slagpen', severity: 'licht', cause: 'pech', description: 'Een afgebroken slagpen hindert de vlucht tot ze weer aangroeit.' },
  { name: 'Gekneusde poot', severity: 'licht', cause: 'pech', description: 'Gezwollen pootje na een botsing; de duif hinkt wat rond.' },
  { name: 'Sperwerverwonding', severity: 'ernstig', cause: 'pech', description: 'Klauw- en beetwonden na de aanval van een roofvogel.' },
  // Strain: the effort itself broke the bird down. Odds AND severity follow its
  // vluchtvorm, so a well-rested, healthy pigeon rarely picks these up.
  { name: 'Verrekte borstspier', severity: 'licht', cause: 'overbelasting', description: 'Overbelaste vliegspier die rust nodig heeft.' },
  { name: 'Verstuikte vleugel', severity: 'matig', cause: 'overbelasting', description: 'Gezwollen vleugelgewricht; tijdelijk niet vliegklaar.' },
  { name: 'Borstbeenkneuzing', severity: 'matig', cause: 'overbelasting', description: 'Kneuzing na een harde landing; pijnlijk bij elke vleugelslag.' },
  { name: 'Botbreuk in de vleugel', severity: 'ernstig', cause: 'overbelasting', description: 'Gebroken vleugelbot; langdurig herstel, vliegen uitgesloten.' },
];

/** The infirmary (ziekenboeg): isolate + treat ailing birds. */
export const INFIRMARY = {
  baseCapacity: 2, // starting number of infirmary beds
  medicatedFoodPerBird: 6, // daily € per bird in the infirmary when medicated feed is on
  doctorSalary: 57, // daily € per pigeon doctor hired
  physioSalary: 50, // daily € per pigeon physiotherapist hired
  birdsPerDoctor: 2, // one doctor treats up to this many sick birds well
  birdsPerPhysio: 2, // one physio treats up to this many injured birds well
  // A bird resting in the infirmary still recovers ENERGIE from its feed, but only
  // if it is properly covered by staff (a doctor for illness, a physio for injury)
  // and then only at this fraction of the normal (healthy) rate — a convalescing
  // bird regains its fut more slowly. An uncovered infirmary bird recovers none.
  energyRecoveryFactor: 0.5,
} as const;

/** Buyable infirmary-bed upgrades, bought in order from the base of 2. */
export const INFIRMARY_CAPACITY_TIERS: { capacity: number; price: number }[] = [
  { capacity: 3, price: 800 },
  { capacity: 4, price: 1200 },
  { capacity: 5, price: 1800 },
  { capacity: 6, price: 2400 },
];

/**
 * Market-driven valuation (see core/game/market.ts).
 *
 * A fixed price curve cannot know what a bird is worth to ten specific players,
 * so the estimate is calibrated on real sales: the weighted average price of
 * comparable recent transactions, blended with the model curve according to how
 * much comparable data there is.
 */
export const MARKET_VALUATION = {
  /** How close in talent a sale must be to count as "comparable" (Gaussian sigma,
   *  in talent points). 10 keeps a sale relevant across a broad band, which matters
   *  with only a handful of sales a week — and since sales scale the curve rather
   *  than replace prices outright, a nearby band is a fair guide. */
  talentSigma: 10,
  /** A sale's weight halves every this many days, so prices drift with the market
   *  instead of being anchored to one old record sale. */
  halfLifeDays: 10,
  /** Sales older than this are ignored outright. */
  observationDays: 28,
  /** Comparable weight at which the market fully overrules the model. Roughly two
   *  fresh, on-talent sales — small on purpose: with ten players there will never
   *  be many, and a real price beats a guessed one. */
  trustWeight: 1.5,
  /** Never let the market be the *only* voice; the model keeps a small say so a
   *  single odd sale cannot define a whole talent band. */
  maxTrust: 0.85,
  /** Hard band on the market factor, so one eccentric sale cannot move the whole
   *  scale absurdly far. A cheap-birds-are-worthless market may push prices down to
   *  a tenth of the curve; a hot market up to eightfold. */
  minFactor: 0.1,
  maxFactor: 8,
};

/**
 * Real-time recovery from an illness/injury. Progress runs continuously (see
 * tickHealing): `baseHoursOutside` is how long full recovery takes for a bird
 * just resting in the loft; the infirmary + staff coverage + medicated feed each
 * multiply the healing speed, so a player sees their care pay off. A status
 * update from the doctor/physio is emitted every `updateHours`.
 */
export const HEALING = {
  // Full recovery time for a bird just resting in the loft. An ailment should be
  // a real setback: even with the best care an injured/ill bird is out for days,
  // not hours. Care multiplies the speed below (full stack ×~3), so a matig
  // letsel heals in ~3,5 dagen met alles samen (was ~1 dag) en ~11 dagen rustend.
  baseHoursOutside: { licht: 120, matig: 264, ernstig: 432 } as Record<Severity, number>,
  infirmarySpeed: 1.8, // isolated + rested in the ziekenboeg
  doctorSpeed: 1.4, // a doctor covering a sick bird
  physioSpeed: 1.4, // a physio covering an injured bird
  medicatedSpeed: 1.2, // medicated feed on
  healthOnRecover: 15, // health restored when the ailment clears
  updateHours: 12, // cadence of the doctor/physio status updates
  /**
   * How often the healing clock is actually advanced, in minutes. Recovery is
   * continuous in principle, but writing it on every request rewrote a row per
   * ailing bird per poll — the single biggest source of D1 "rows written" (the
   * free plan allows 100k/day). Healing takes 1,5 to 18 days, so moving in
   * quarter-hour steps is invisible to the player, and no time is lost: a tick
   * that is skipped leaves `lastTickMs` alone, so the next one gets the full
   * elapsed time.
   */
  tickMinutes: 15,
} as const;

/** Health-system tuning. All probabilities are per weekly tick. */
export const HEALTH = {
  /** Health lost when an ailment first strikes, by severity. */
  onsetHealthHit: { licht: 10, matig: 22, ernstig: 38 } as Record<Severity, number>,
  /** Health a bird keeps losing EACH DAY while it is still ailing (a sick/injured
   *  bird gets weaker the longer it goes on). Applied in the real-time daily tick. */
  ailmentHealthDrainPerDay: { licht: 0.6, matig: 1.5, ernstig: 2.5 } as Record<Severity, number>,
  /** An untreated bird (not in the ziekenboeg) degrades faster than a nursed one. */
  ailmentDrainOutsideFactor: 1.5,
  /** Base weekly recovery chance while resting in the infirmary. */
  recoverInInfirmary: { licht: 0.55, matig: 0.38, ernstig: 0.22 } as Record<Severity, number>,
  /** Recovery is much slower for a bird left in the normal loft. */
  recoverOutsideFactor: 0.4,
  /** Medicated feed boosts recovery of any ailment in the infirmary. */
  medicatedFoodBonus: 0.18,
  /** A doctor covering a sick bird boosts its disease recovery. */
  doctorBonus: 0.28,
  /** A physio covering an injured bird boosts its injury recovery. */
  physioBonus: 0.28,
  /** Recovery chance is capped here so nothing is ever guaranteed. */
  recoverCap: 0.92,
  /** Per-source weekly infection chance, scaled by (1.2 - targetHealth/100). */
  contagionPerSource: 0.3,
  /** Weekly chance a bird falls ill on its own, scaled by how frail it is. */
  spontaneousIllness: 0.1,
  /**
   * The floor under that frailty factor. Health is by far the biggest lever —
   * the factor is `1 - health/100`, so a weak bird is many times more likely to
   * fall ill — but no loft is sterile: even a bird in perfect health keeps this
   * much baseline risk. Without a floor a bird at health 100 could NEVER fall
   * ill, which is exactly why illness was effectively unreachable in practice.
   */
  illnessBaselineRisk: 0.18,
  /** Extra weekly death chance from an untreated severe/moderate ailment. */
  ailmentMortalityOutside: { licht: 0, matig: 0.03, ernstig: 0.1 } as Record<Severity, number>,
  ailmentMortalityInfirmary: { licht: 0, matig: 0.005, ernstig: 0.025 } as Record<Severity, number>,
  /**
   * Health a race takes out of a bird:
   *   (flightHealthBase + km · flightHealthPerKm) · (1 + (100 − energie bij aankomst)/100 · emptyTankFactor)
   * Racing is real wear now — a fond race costs ~7 health — and running the tank dry
   * costs extra on top. That makes gezondheid a resource you manage over weeks
   * instead of a number pinned at 100, which is what gives INJURY/ILLNESS their bite.
   */
  flightHealthBase: 0.5,
  flightHealthPerKm: 1 / 250,
  emptyTankFactor: 0.8,
  /**
   * Health recovery gets a REBOUND: the further a bird has dropped, the faster it
   * comes back — `(healthRecovery/7) · (1 + (100 − gezondheid)/100)`. Without this,
   * health would be a one-way ratchet for anyone who races a full calendar.
   */
  reboundFactor: 1,
} as const;

/**
 * How BAD a spontaneous/caught illness turns out to be.
 *
 * Falling ill is partly luck, but how hard it hits is not: a bird in good health
 * shrugs off most of it (mostly a licht case), while a run-down bird is the one
 * that catches something serious. `frailty` runs from 0 (health ≥ `mildAbove`)
 * to 1 (health 0), and shifts weight from licht to ernstig. A severe illness
 * therefore stays possible for a healthy bird — just uncommon.
 */
export const DISEASE_SEVERITY = {
  mildAbove: 80, // at or above this health, the mildest mix applies
  healthy: { licht: 55, matig: 33, ernstig: 12 } as Record<Severity, number>,
  frail: { licht: 30, matig: 35, ernstig: 35 } as Record<Severity, number>,
} as const;

/** The severity weights for a bird at a given health (interpolated). */
export function diseaseSeverityWeights(health: number): Record<Severity, number> {
  const raw = (DISEASE_SEVERITY.mildAbove - health) / DISEASE_SEVERITY.mildAbove;
  const frailty = Math.max(0, Math.min(1, raw));
  const mix = (a: number, b: number) => a + (b - a) * frailty;
  return {
    licht: mix(DISEASE_SEVERITY.healthy.licht, DISEASE_SEVERITY.frail.licht),
    matig: mix(DISEASE_SEVERITY.healthy.matig, DISEASE_SEVERITY.frail.matig),
    ernstig: mix(DISEASE_SEVERITY.healthy.ernstig, DISEASE_SEVERITY.frail.ernstig),
  };
}

/**
 * VLUCHTVORM — the single number that drives injury, illness severity and the risk
 * badge in the UI. It blends the two things a fancier actually manages:
 *
 *   vluchtvorm = (2 × laagste(energie, gezondheid) + hoogste) / 3
 *
 * The LOWER of the two counts double on purpose: a worn-out bird with a full tank
 * is just as much a liability as a rested but sickly one, and one weak link should
 * not be masked by the other value. See flightForm()/conditionScore() in game/pigeon.
 */
export const FORM = {
  lowWeight: 2, // weight of the lower of energie/gezondheid
  highWeight: 1, // weight of the higher one
} as const;

/**
 * Rest between races. Energie recovery can be BOUGHT (Herstelvoer + a private
 * compartment + a seasoned bird runs to ~14/day), which is enough to fly a short
 * race day after day with barely a dent in the tank. Rest itself cannot be bought,
 * so racing on consecutive days docks the vluchtvorm directly.
 *
 * The penalty is deliberately a form deduction rather than a flat multiplier on the
 * injury chance: it is self-scaling (×2.5 for a fresh bird that loses its safety
 * margin, ×1.6 for an already shaky one instead of double-punishing it), it feeds
 * the severity mix and the visible badge through the same funnel, and no amount of
 * feed makes it go away.
 */
export const RECOVERY = {
  penaltyYesterday: 15, // raced 1 day ago
  penaltyTwoDays: 7, // raced 2 days ago
  practiceFactor: 1 / 3, // an oefenvlucht is a light effort — a third of the above
} as const;

/**
 * INJURY — split in two, because not every injury says something about how the bird
 * is kept (see AilmentTemplate.cause):
 *
 *  - OVERBELASTING (strain) runs on the vluchtvorm:
 *      kans = (floor + max · ((100 − vluchtvorm)/100)^curve) · (distBase + km·distPerKm)
 *    A bird in top form sits near the floor whatever the distance; below vluchtvorm
 *    ~30 (roughly gezondheid < 50 AND energie < 20) it climbs past 35% on a middle
 *    distance and past 50% on a fond race. Distance is a modifier now (×0.75 at
 *    150 km to ×1.6 at 1000 km), not the thing that decides it — the old model was
 *    almost purely distance-driven, which is why good husbandry paid off so little.
 *
 *  - PECH (bad luck) is a small FLAT chance on the same distance modifier. It never
 *    goes to zero: a hawk does not care how well fed your bird is. This is what
 *    keeps a perfectly kept loft from being untouchable, and at top form it is
 *    where most of the (few) remaining injuries come from.
 */
export const INJURY = {
  floor: 0.015, // strain risk that never goes away, even at vluchtvorm 100
  max: 0.9, // added at vluchtvorm 0
  curve: 2.4, // >1 keeps a fit bird safe and makes the bottom end genuinely dangerous
  distBase: 0.6,
  distPerKm: 0.001,
  luckBase: 0.01, // flat per-flight chance of a pech injury, before the distance modifier
} as const;

/** Severity mix for a STRAIN injury, by vluchtvorm (a pech injury draws uniformly
 *  from its own pool — luck does not care about form). Mirrors DISEASE_SEVERITY. */
export const INJURY_SEVERITY = {
  fit: { licht: 70, matig: 25, ernstig: 5 } as Record<Severity, number>,
  spent: { licht: 30, matig: 35, ernstig: 35 } as Record<Severity, number>,
} as const;

/** Interpolated severity weights for a strain injury at a given vluchtvorm. */
export function injurySeverityWeights(form: number): Record<Severity, number> {
  const t = Math.max(0, Math.min(1, form / 100));
  const mix = (spent: number, fit: number) => spent + (fit - spent) * t;
  return {
    licht: mix(INJURY_SEVERITY.spent.licht, INJURY_SEVERITY.fit.licht),
    matig: mix(INJURY_SEVERITY.spent.matig, INJURY_SEVERITY.fit.matig),
    ernstig: mix(INJURY_SEVERITY.spent.ernstig, INJURY_SEVERITY.fit.ernstig),
  };
}

/**
 * ILLNESS — the same shape as INJURY, on the same vluchtvorm, so "how well do I keep
 * this bird" answers both questions at once. This is the WEEKLY chance a bird falls
 * ill on its own; runHealthDay converts it to a daily chance.
 *
 * The floor matters: even a bird in perfect shape carries ~1%/week, so a healthy
 * loft still sees the odd case (roughly one bird ill every ~10 weeks in a loft of
 * eight). At vluchtvorm 30 — gezondheid < 50 and energie < 20 — it is ~24%/week, so
 * a neglected loft goes down fast, and contagion then does the rest.
 */
export const ILLNESS = {
  floor: 0.01, // weekly chance at perfect vluchtvorm — luck exists
  max: 0.55, // added at vluchtvorm 0
  curve: 2.4, // same shape as INJURY.curve, so both read the same way
  contagionFloor: 0.15, // a fit bird still catches something from a sick loft mate…
} as const;

/** Weekly death probability by age in weeks (interpolated). Old birds fade. */
export const MORTALITY_CURVE: { weeks: number; p: number }[] = [
  { weeks: 0, p: 0 },
  { weeks: 208, p: 0.001 }, // ~4 years
  { weeks: 312, p: 0.006 }, // ~6 years
  { weeks: 416, p: 0.025 }, // ~8 years
  { weeks: 520, p: 0.07 }, // ~10 years
  { weeks: 624, p: 0.16 }, // ~12 years
  { weeks: 780, p: 0.4 }, // ~15 years
];

/**
 * A recurring slot on the weekly calendar. weekday null = every day. If `tiers`
 * is given, the tier is chosen deterministically per day (so a slot can rotate
 * between, say, national and international long flights). Max two slots a day.
 */
export interface ScheduleSlot {
  key: string;
  tier?: FlightTier;
  tiers?: FlightTier[];
  weekday: number | null; // 0=Sunday .. 6=Saturday
  hour: number;
  minute: number;
  practice?: boolean; // an oefenvlucht: no fee, no prizes/points, gentle training
  titan?: boolean; // a titanenwedstrijd: money-only, one bird per loft (see TITAN)
  everyNDays?: number; // only schedule this slot every N calendar days (default: every day)
}

/**
 * Titanenwedstrijd — a special weekend race. Each loft may enter only ONE bird.
 * Medium-to-long distance. It awards prize money to the top 3 but NO ranking
 * points, and it does not feed the season rankings (it is not one of the three
 * competition tiers). Birds still train/improve from it as normal. On its day it
 * REPLACES every other flight, so there is just this one race.
 */
export const TITAN = {
  name: 'Titanenwedstrijd',
  weekday: 6, // Saturday (0=Sun..6=Sat)
  hour: 8,
  minute: 0,
  minKm: 200, // medium-to-long
  maxKm: 600,
  entryFee: 50,
  prizes: [1800, 1200, 900], // 1e / 2e / 3e (money only)
} as const;

/**
 * The weekly calendar (Brussels time), one fixed line-up per weekday.
 *
 *   ma  08:00 internationaal
 *   di  10:00 regionaal        · 12:00 oefenvlucht
 *   wo  08:00 nationaal
 *   do  08:00 internationaal
 *   vr  10:00 regionaal        · 12:00 oefenvlucht
 *   za  08:00 titanenwedstrijd (replaces everything else that day)
 *   zo  08:00 nationaal        · 17:00 regionaal
 *
 * Deliberately fewer races than the old daily long+short calendar: every flight
 * draws from the same pool of birds, so a lighter schedule concentrates the
 * field and makes each race more competitive.
 */
/**
 * Estafettevlucht (relay) — the other weekend special, alternating week by week
 * with the TITANENWEDSTRIJD. A loft enters ONE team of exactly three birds that
 * fly the route in sequence: bird 1 from the release point to the first handover,
 * bird 2 on to the second, bird 3 home. Every leg is EXACTLY the same length, so
 * each bird flies a third of the route and only one bird of a team is airborne at
 * a time. The team's time is its three legs added up; if any bird fails to make
 * it (pulled or gave out), the whole team is eliminated. Money only — no ranking
 * points — but the birds' own leg results do feed the duivenranglijsten.
 */
export const RELAY = {
  name: 'Estafettevlucht',
  hour: 5, // early start: ~900 km in three legs eats most of the day
  minute: 0,
  teamSize: 3,
  minKm: 850, // total route (the sum of the three legs)
  maxKm: 950,
  entryFee: 100, // once per team, not per bird
  prizes: [3000, 2000, 1500, 1100, 800], // 1e..5e, money only
  /** How stale a leg's weather forecast may get before it is fetched again.
   *  Tightened close to the start so what players plan with is what they fly. */
  forecastRefreshHours: 6,
  forecastFinalHours: 2, // within this many hours of the start, refresh hourly
  /** Rough cruising speed (km/h) used only to estimate WHEN a later leg starts,
   *  so its forecast is taken for roughly the right hour of the day. */
  nominalKmh: 85,
  /** A handover point closer than this to a known city is described as "bij X"
   *  instead of "ten noorden van X". */
  nearCityKm: 25,
} as const;

/**
 * Which weekend special a Saturday gets. The weekend slot alternates week by
 * week: `Math.floor(dayNumber / 7)` counts whole weeks since the Unix epoch, so
 * consecutive Saturdays flip the parity. Anchored so that 22 August 2026 (the
 * first estafettevlucht) lands on the relay side.
 */
export function isRelayWeek(dayNumber: number): boolean {
  return (((Math.floor(dayNumber / 7) % 2) + 2) % 2) === 1;
}

export const REAL_SCHEDULE: ScheduleSlot[] = [
  { key: 'mon-international', tier: 'international', weekday: 1, hour: 8, minute: 0 },
  { key: 'tue-regional', tier: 'regional', weekday: 2, hour: 10, minute: 0 },
  { key: 'tue-practice', tier: 'regional', weekday: 2, hour: 12, minute: 0, practice: true },
  { key: 'wed-national', tier: 'national', weekday: 3, hour: 8, minute: 0 },
  { key: 'thu-international', tier: 'international', weekday: 4, hour: 8, minute: 0 },
  { key: 'fri-regional', tier: 'regional', weekday: 5, hour: 10, minute: 0 },
  { key: 'fri-practice', tier: 'regional', weekday: 5, hour: 12, minute: 0, practice: true },
  // The weekend special. Its key stays 'titan' (it is the same calendar slot, and
  // the key is what dedupes a day) but its FORMAT alternates: on relay weeks
  // `ensureFlightsScheduled` builds an estafettevlucht at RELAY.hour instead.
  { key: 'titan', tier: 'international', weekday: TITAN.weekday, hour: TITAN.hour, minute: TITAN.minute, titan: true },
  { key: 'sun-national', tier: 'national', weekday: 0, hour: 8, minute: 0 },
  { key: 'sun-regional', tier: 'regional', weekday: 0, hour: 17, minute: 0 },
];

/**
 * Oefenvlucht (practice flight). Costs almost no energie, has no entry fee and
 * awards no money or ranking points. Its purpose is TRAINING: a high chance to
 * grow — mostly conditie/oriëntatie, less snelheid — and a private coach makes
 * those gains more likely. Gentle: no DNF, injury or death.
 */
export const PRACTICE = {
  energyCost: 8, // total energie spent over the whole practice flight
  improveChance: 0.7, // chance a bird gains something
  coachedImproveChance: 0.92, // higher with a private coach
  weights: { speed: 0.15, endurance: 0.45, orientation: 0.4 }, // conditie/oriëntatie-heavy
  gainMin: 0.4,
  gainMax: 1.4,
  coachedBonusGain: 0.5, // extra gain on conditie/oriëntatie for a coached bird
} as const;

/**
 * Tournament-flight risk from flying on low energie (energie = `form`). Graded by
 * the energie the bird STARTED the race with:
 *  - under 20: a chance of a LICHT letsel/ziekte;
 *  - under 10: a chance of a MATIG (or lighter) letsel/ziekte;
 *  - under 5: a small chance of DEATH (or any of the above).
 * Above 20 there is only the small "rough flight" base injury chance (HEALTH).
 */
export const TOURNEY_RISK = {
  // The graded light/moderate ailment rolls that used to sit here are GONE: the
  // vluchtvorm now drives injury odds directly, so a bird starting on an empty tank
  // is already deep in the danger zone — rolling a second ailment on top was double
  // jeopardy. Racing on a nearly empty tank can still kill, and that stays.
  deathThreshold: 5,
  deathChance: 0.07,
} as const;

/**
 * Rustkuur (rest cure). Pay money to actively recover a tired bird: it rests for
 * `durationHours` (can't race during the cure) and then gets a big energie boost.
 */
export const REST_CURE = {
  cost: 300,
  // Two full days off. EVERY bird may be put on a cure — the old limit of one cure
  // per LOFT per week is gone — but each bird individually may only take one a week
  // (`cooldownDays`, measured from the start of its previous cure and tracked per
  // pigeon in `Pigeon.lastRestCureAt`). So a big loft can rest several birds at once,
  // yet no single bird can be topped up over and over.
  //
  // A cure that was already running keeps the end time it was given (cureUntil is an
  // absolute timestamp), so birds on the old 24-hour cure are unaffected.
  durationHours: 48,
  cooldownDays: 7, // per PIGEON, from the start of its last cure
  energy: 40,
  health: 15, // real rest mends the bird too, not just its tank
} as const;

// ===========================================================================
// Funny Dutch pigeon names
// ===========================================================================
// A name is "<voornaam> <bijnaam>". Doffers get male first names, duivinnen
// female ones. The epithet mixes trait-based, neutral and pitch-black humour,
// with a preference for alliteration (e.g. "Stevie de Snelle").

export const MALE_FIRST_NAMES = [
  'Harry', 'Sjaak', 'Rico', 'Kevin', 'Willy', 'Freddy', 'Ronnie', 'Marcel', 'Achiel', 'Cyriel',
  'Pol', 'Ludo', 'Nand', 'Karel', 'Fons', 'Rambo', 'Rocky', 'Gaston', 'Dirk', 'Patrick',
  'Jean-Pierre', 'Bompa', 'Nonkel', 'Sef', 'Miel', 'Stef', 'Stevie', 'Bert', 'Gust', 'Frans',
  'Jos', 'Leon', 'Marc', 'Rik', 'Theo', 'Vic', 'Wim', 'Zeger', 'Denis', 'Edgard',
  'Georges', 'Herman', 'Ivan', 'Jules', 'Koen', 'Lowie', 'Maurice', 'Norbert', 'Oscar', 'Prosper',
  'Roger', 'Staf', 'Tuur', 'Valere', 'Warre', 'Dave', 'José', 'Turbo',
  // A nod to real racing legends: Armando (€1,25 M, 2019), Bolt (Leo Heremans),
  // and the decorated war pigeons Gustav, Paddy, Joe (G.I. Joe) and Commando.
  'Armando', 'Bolt', 'Gustav', 'Paddy', 'Joe', 'Commando', 'Klak',
];

export const FEMALE_FIRST_NAMES = [
  'Betsy', 'Gerda', 'Chantal', 'Brenda', 'Rita', 'Fien', 'Roos', 'Bertha', 'Godelieve', 'Bella',
  'Trees', 'Whitney', 'Kimberly', 'Samantha', 'Yvonne', 'Marleen', 'Sandra', 'Tante', 'Wies', 'Nancy',
  'Denise', 'Simonne', 'Agnes', 'Bea', 'Carine', 'Diane', 'Emma', 'Francine', 'Greet', 'Hilde',
  'Ingrid', 'Josée', 'Katrien', 'Lea', 'Maria', 'Nadine', 'Odette', 'Paula', 'Rosa', 'Sonja',
  'Tinne', 'Ursula', 'Viviane', 'Wendy', 'Christine', 'Godelieve', 'Martha', 'Zoë',
  // Real racing hens: New Kim (€1,6 M, 2020), Cher Ami (Croix de Guerre, WO I),
  // Winkie (first Dickin Medal) and Mary of Exeter.
  'Kim', 'Ami', 'Winkie', 'Mary', 'Vita',
];

/** All first names (both sexes), used to detect legacy/wrong-gender names. */
export const PIGEON_FIRST_NAMES = [...MALE_FIRST_NAMES, ...FEMALE_FIRST_NAMES];

export const EPITHETS = {
  slowSpeed: ['de Trage', 'de Slak', 'op Slippers', 'de Treuzelaar', 'de Zondagsvlieger', 'met de Handrem'],
  fastSpeed: ['de Hete', 'de Rappe', 'de Bliksem', 'Turbo', 'de Kogel', 'Speedy'],
  lowEndurance: ['de Fatsy', 'de Dikke', 'Kortademig', 'de Puffer', 'met de Zwembandjes', 'de Frietvreter', 'de Hijger'],
  highEndurance: ['de Taaie', 'de Diesel', 'den IJzeren', 'de Volhouder', 'de Marathon'],
  lowOrientation: ['de Verdwaalde', 'de Toerist', 'Zonder-GPS', 'de Dwaler', 'Blindganger'],
  highOrientation: ['de Slimme', 'het Kompas', 'de GPS', 'de Wegwijze', 'de Navigator'],
  neutral: [
    'de Verschrikkelijke', "van 't Stad", 'Junior', 'de Derde', 'de Kale', 'de Legende', 'met de Snor',
    'de Zatte', 'de Gepensioneerde', 'de Mysterieuze', 'uit de Goot', 'de Onverwoestbare', 'Bonus',
  ],
  /**
   * Knipoog naar de échte duivensport: legendarische kampioenen en de klassiekers
   * die elke melker kent. Zeldzamer dan de rest — een duif met zo'n bijnaam mag
   * wat opvallen.
   */
  legend: [
    'de Kannibaal', 'de Nieuwe Kim', 'de Armando', 'de Olympiade', 'de Gouden Prins',
    'de Blauwe Prins', 'Dolce Vita', 'de Miljoenenduif', 'de Barcelona-Kampioen',
    'van Klak', 'de Dickin-Medaille', 'het Wonder van Wetteren', 'de Nationale',
    'de Fondkoning', 'de Asduif', 'de Bourges-Winnaar', 'de Perpignan-Held',
  ],
  // Pikzwarte humor: galgenhumor over duivenpech, sperwers en de soeppot.
  dark: [
    'Toekomstige Soep', 'de Sperwersnack', 'Bijna-Dood', 'de Orgaandonor', 'Kanonnenvlees',
    'met één Poot in het Graf', 'de Laatste Adem', 'de Doodgraver', 'Rouwrandje', 'de Terminale',
    'de Weduwmaker', 'de Kamikaze', 'Uitvaart Inbegrepen', 'de Hartaanval', 'de Wees',
    'Vulling voor de Kat', 'de Zelfmoordvlieger', 'Laatste Wens', 'de Nabestaande', 'de Doodskist-Ontwijker',
    'Postuum Kampioen', 'de Grafdelver', 'Bijna Opgegeten', 'de Onterfde', 'met een Testament op Zak',
  ],
} as const;

// ===========================================================================
// Live race commentary (dark-ish Flemish humour). The feed reports REAL events
// from the frozen pace profiles — overtakes and their cause — so it tells you
// something useful, not just jokes. {name} = the bird acting, {name2} = the one
// it passes, {km} = a rough detour distance (for a strayed bird).
// ===========================================================================
export const COMMENTARY = {
  start: [
    'De manden gaan open — daar vliegen ze, richting huis!',
    'Lossing! De hemel kleurt grijs van de duiven.',
    'En ze zijn vertrokken, zat van de vrijheid.',
  ],
  // A clean pass, no obvious cause.
  overtake: [
    '{name} steekt {name2} voorbij en pakt de plek.',
    '{name} duikt onder {name2} door — plaats gewonnen.',
    '{name} wringt zich langs {name2}.',
    '{name} laat {name2} achter zich en schuift op.',
  ],
  // {name} passes {name2} because {name} is accelerating.
  overtakeSurge: [
    '{name} zet een tussensprint in en wipt over {name2}.',
    '{name} versnelt fors en steekt {name2} voorbij.',
    '{name} vindt een tweede adem en rondt {name2}.',
    '{name} schakelt een tandje bij en gaat over {name2} heen.',
  ],
  // {name} passes {name2} because {name2} is fading / running out of legs.
  overtakeTired: [
    '{name2} zakt weg door vermoeidheid — {name} gaat er moeiteloos over.',
    '{name2} verliest tempo, {name} glipt voorbij.',
    '{name2} vliegt plots met de handrem op; {name} neemt de plek over.',
    '{name2} raakt op, {name} profiteert en steekt voorbij.',
  ],
  // {name} passes {name2} because {name2} strayed off course (~{km} km detour).
  overtakeLost: [
    '{name2} is van koers (~{km} km omweg) — {name} steekt zonder moeite voorbij.',
    '{name2} dwaalt af en verliest ~{km} km; {name} pikt de plaats in.',
    '{name2} zoekt de weg kwijt, {name} gaat er vlotjes over.',
  ],
  // A pass that takes over the lead of the race.
  leadChange: [
    '{name} grijpt de kop! {name2} moet lossen.',
    'Nieuwe leider: {name} gaat over {name2} heen.',
    '{name} neemt de leiding over van {name2}.',
    'Wissel aan de kop — {name} kopt {name2} eraf.',
  ],
  // A bird wanders off course (~{km} km extra) and slides down the field.
  stray: [
    '{name} twijfelt aan de route en draait een lus — een omweg van ~{km} km, en zakt weg in de stand.',
    '{name} raakt van koers en vliegt ~{km} km te veel. Kostbare minuten verspeeld.',
    '{name} verliest het noorden, ~{km} km omweg, en valt terug.',
  ],
  // A bird collapses from exhaustion mid-flight (a DNF you can see happen).
  dnfExhausted: [
    '{name} valt stil — de tank is leeg. Ze geraakt niet meer thuis.',
    '{name} strijkt onderweg neer, doodop. Einde vlucht.',
    '{name} kan niet meer, uitgeput langs de kant. Geen finish.',
  ],
  // A bird loses the way completely — she is not hurt, she simply has no idea
  // where she is. She turns up at the loft days later (see LOST).
  dnfLost: [
    '{name} is het noorden volledig kwijt en verdwijnt uit beeld. Ze raakt vandaag niet meer thuis.',
    '{name} draait rondjes, kiest de verkeerde richting en is weg. Wachten wordt het.',
    '{name} verliest alle houvast en vliegt de horizon in — die komt hier vandaag niet meer aan.',
  ],
  // A bird pulls up injured mid-flight.
  dnfInjury: [
    '{name} grijpt naar een vleugel — kramp! Ze moet opgeven.',
    '{name} plooit door met een blessure en staakt de vlucht.',
    '{name} loopt een kwetsuur op en komt niet verder.',
  ],
  // The owner pulls the bird from the race.
  pulled: [
    'De melker roept {name} terug — energie sparen voor de volgende keer.',
    '{name} wordt uit de wedstrijd gehaald en spaart haar krachten.',
  ],
  finish: [
    '{name} valt in! Klok gedrukt!',
    '{name} plooit de vleugels en duikt het hok in. Binnen!',
    'Daar is {name}! De melker pinkt een traantje weg.',
    '{name} landt en vraagt meteen om eten. Typisch.',
  ],
  // --- Estafettevlucht ------------------------------------------------------
  // A relay handover: {name} arrives at the swap point, {name2} takes over.
  handover: [
    '{name} raakt het wisselpunt {km} — {name2} neemt over en vertrekt.',
    'Wissel {km}: {name} lost af, {name2} pakt de draad op.',
    '{name} komt binnen bij het wisselpunt {km} en stuurt {name2} de baan op.',
  ],
  // A relay team is eliminated because one of its birds never made it.
  relayOut: [
    'Drama voor de ploeg van {name2}: {name} raakt er niet, en daarmee ligt de hele ploeg eruit.',
    '{name} strandt — de ploeg van {name2} is uitgeschakeld.',
    'Einde verhaal voor {name2}: zonder {name} raakt de estafette niet thuis.',
  ],
  // A relay team completes the full route.
  relayFinish: [
    'De ploeg van {name2} is compleet binnen — {name} drukt de klok!',
    '{name} sluit af voor {name2}: de estafette zit erop!',
    'Daar is {name}! De ploeg van {name2} heeft de volle route uitgevlogen.',
  ],
} as const;
