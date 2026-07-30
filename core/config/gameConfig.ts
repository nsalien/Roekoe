/**
 * Central, data-driven game configuration.
 *
 * Almost every tunable number in Roekoe lives here. To rebalance the game,
 * add a new food type, add a building, or change the flight calendar, edit
 * this file — the engine reads from it rather than hard-coding values. This is
 * the main "knob board" for extending the game later.
 */

export const WEEKS_PER_YEAR = 52;

/** A pigeon can be entered into flights once it reaches this age (in weeks). */
export const RACE_AGE_WEEKS = 8;

/** Loft capacity a new player starts with (max pigeons owned). */
export const STARTING_LOFT_CAPACITY = 20;

/** Money every new player (and bot) starts with. */
export const STARTING_MONEY = 5000;

/** How many pigeons a new player starts their loft with. */
export const STARTING_PIGEONS = 6;

/** Food (kg) a new player starts with in stock. Consumed daily, so this is a
 *  buffer of roughly two weeks for a starting loft. */
export const STARTING_FOOD = 80;

/**
 * Feed rations. `foodPerPigeon` is consumed PER DAY per pigeon; a higher ration
 * costs more food but restores more energie/health. `formRecovery` and
 * `healthRecovery` are WEEKLY targets — the daily care applies 1/7 of them each
 * day.
 */
export const FEED_RATIONS = {
  low: { label: 'Zuinig', foodPerPigeon: 0.7, formRecovery: 6, healthRecovery: 2 },
  normal: { label: 'Normaal', foodPerPigeon: 1.0, formRecovery: 12, healthRecovery: 5 },
  high: { label: 'Royaal', foodPerPigeon: 1.4, formRecovery: 18, healthRecovery: 8 },
} as const;
export type FeedRationKey = keyof typeof FEED_RATIONS;

/** Price of one kg of pigeon food when buying from the supply store. */
export const FOOD_PRICE_PER_KG = 3;

/** Fixed weekly overhead per player (loft maintenance, bedding, etc.). */
export const WEEKLY_UPKEEP_BASE = 150;

/** Extra weekly upkeep charged per pigeon owned. */
export const WEEKLY_UPKEEP_PER_PIGEON = 15;

/**
 * Training options. Training costs money and a bit of the pigeon's form now,
 * in exchange for a small permanent improvement to a chosen attribute (capped)
 * plus experience. This is the long-term progression lever.
 */
export const TRAINING = {
  cost: 120,
  formCost: 15,
  attributeGain: 1.2, // average points added to the trained attribute
  attributeCap: 92, // training alone cannot push an attribute past this
  experienceGain: 4,
  restWeeks: 0,
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
  regional: [300, 180, 110, 70, 45, 30, 20, 12],
  national: [900, 550, 350, 220, 140, 90, 60, 40, 25, 15],
  international: [2200, 1300, 800, 500, 320, 200, 130, 85, 55, 35, 25, 15],
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
  short: { speed: 0.55, endurance: 0.2, orientation: 0.25 },
  long: { speed: 0.2, endurance: 0.45, orientation: 0.35 },
} as const;

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
  /** Parents must have at least this much form to breed. */
  minParentForm: 40,
} as const;

/** Age curve: performance multiplier by age in weeks. Interpolated. */
export const AGE_CURVE: { weeks: number; multiplier: number }[] = [
  { weeks: 0, multiplier: 0.0 },
  { weeks: RACE_AGE_WEEKS, multiplier: 0.6 },
  { weeks: 20, multiplier: 0.85 },
  { weeks: 52, multiplier: 1.0 }, // ~1 year: coming into prime
  { weeks: 156, multiplier: 1.0 }, // 1-3 years: prime
  { weeks: 260, multiplier: 0.9 }, // ~5 years
  { weeks: 416, multiplier: 0.7 }, // ~8 years
  { weeks: 520, multiplier: 0.5 }, // ~10 years
];

/** The NPC supply market lists this many fresh pigeons for sale each week. */
export const NPC_MARKET_LISTINGS_PER_WEEK = 4;

/** Number of bot lofts the world is seeded with on first boot. */
export const DEFAULT_BOT_COUNT = 6;

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

export type Country = 'BE' | 'NL' | 'FR' | 'GB' | 'LU' | 'DE';

/** A racing city, with coordinates used for distance + real weather. */
export interface RaceCity {
  name: string;
  lat: number;
  lon: number;
  country: Country;
  flanders?: boolean; // true for cities in Vlaanderen (regional races)
}

/**
 * Cities used to build flights. Regional races pick two Flemish cities,
 * national races two Belgian cities, international races any two across the
 * six countries. Routes (start + finish) are randomised per flight.
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
  regional: { label: 'Regionaal', name: 'Regiovlucht', entryFee: 20, minKm: 30, maxKm: 160 },
  national: { label: 'Nationaal', name: 'Nationale vlucht', entryFee: 40, minKm: 60, maxKm: 290 },
  international: { label: 'Internationaal', name: 'Internationale vlucht', entryFee: 80, minKm: 180, maxKm: 950 },
};

/**
 * Auctions. A single top pigeon is auctioned every Sunday (see auction.ts).
 * On top of that, rescue-centre ("opvangcentrum") birds pop up at random,
 * regular moments: low-quality pigeons that still fetch a starting bid of €25
 * because a new owner can always train them up.
 */
export const AUCTION = {
  /** Rescue-centre auctions: mean hours between appearances (memoryless). */
  shelterMeanIntervalHours: 9,
  /** How long a rescue-centre auction stays open, in hours. */
  shelterWindowHours: 6,
  /** Never run more than this many rescue auctions at once. */
  shelterMaxConcurrent: 2,
  /** Opening bid for a rescue-centre bird. */
  shelterStartBid: 25,
  /** Quality range for rescue birds (they are no racers). */
  shelterQualityMin: 0.05,
  shelterQualityMax: 0.35,
} as const;

/**
 * Sponsors. When a loft performs well, companies want to invest in the melker.
 * Each sponsor unlocks at a prestige threshold and, once signed as your head
 * sponsor, pays a one-time signing bonus plus a weekly stipend and a bonus for
 * every flight you win. Only one sponsor can be active at a time — picking one
 * is a small strategic choice. Amounts are deliberately modest.
 */
export interface SponsorDef {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  tier: number;
  /** Unlock thresholds (all listed conditions must be met). */
  req: {
    level?: number;
    totalWins?: number;
    seasonPoints?: number;
    bestTalent?: number;
    gold?: number;
  };
  signingBonus: number; // one-time, first time you sign this sponsor
  weeklyStipend: number; // paid every "volgende week" tick while active
  winBonus: number; // paid each time one of your pigeons wins a flight
}

export const SPONSORS: SponsorDef[] = [
  {
    id: 'zatte_duif', name: 'Café De Zatte Duif', icon: '🍺', tier: 1,
    tagline: 'Ons café hangt vol duivenfoto’s. Kom erbij, den eerste pint is voor u.',
    req: {}, signingBonus: 150, weeklyStipend: 30, winBonus: 10,
  },
  {
    id: 'vetzakske', name: "Frituur 't Vetzakske", icon: '🍟', tier: 1,
    tagline: 'Elke overwinning trakteren we op een grote friet met stoofvleessaus.',
    req: { totalWins: 3 }, signingBonus: 300, weeklyStipend: 60, winBonus: 20,
  },
  {
    id: 'kruimeltje', name: "Bakkerij 't Kruimeltje", icon: '🥖', tier: 2,
    tagline: 'Verse pistolets voor de kampioen, elke zondagmorgen.',
    req: { seasonPoints: 120 }, signingBonus: 400, weeklyStipend: 80, winBonus: 15,
  },
  {
    id: 'van_hoof', name: 'Landbouwmachines Van Hoof', icon: '🚜', tier: 2,
    tagline: 'Wij houden van sterke beesten met pk’s onder de vleugels.',
    req: { bestTalent: 75 }, signingBonus: 600, weeklyStipend: 120, winBonus: 25,
  },
  {
    id: 'fondinvest', name: 'Duivenbank Fondinvest', icon: '🏦', tier: 3,
    tagline: 'Uw prestaties, onze investering. Beleg in pluimen.',
    req: { level: 6 }, signingBonus: 1000, weeklyStipend: 180, winBonus: 35,
  },
  {
    id: 'snelle_vleugel', name: 'Racing Team Snelle Vleugel', icon: '🏎️', tier: 3,
    tagline: 'Alleen echte winnaars dragen ons logo. Ben jij er klaar voor?',
    req: { gold: 10 }, signingBonus: 1500, weeklyStipend: 260, winBonus: 55,
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
} as const;

/** Dutch labels for the three trainable/improvable attributes. */
export const IMPROVE_ATTR_LABEL: Record<'speed' | 'endurance' | 'orientation', string> = {
  speed: 'snelheid',
  endurance: 'conditie',
  orientation: 'oriëntatie',
};

// ===========================================================================
// Health: disease, injury, the infirmary and mortality
// ===========================================================================

export type Severity = 'licht' | 'matig' | 'ernstig';

export interface AilmentTemplate {
  name: string;
  severity: Severity;
  description: string;
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
  { name: 'Gebroken slagpen', severity: 'licht', description: 'Een afgebroken slagpen hindert de vlucht tot ze weer aangroeit.' },
  { name: 'Gekneusde poot', severity: 'licht', description: 'Gezwollen pootje na een botsing; de duif hinkt wat rond.' },
  { name: 'Verrekte borstspier', severity: 'licht', description: 'Overbelaste vliegspier die rust nodig heeft.' },
  { name: 'Verstuikte vleugel', severity: 'matig', description: 'Gezwollen vleugelgewricht; tijdelijk niet vliegklaar.' },
  { name: 'Borstbeenkneuzing', severity: 'matig', description: 'Kneuzing na een harde landing; pijnlijk bij elke vleugelslag.' },
  { name: 'Sperwerverwonding', severity: 'ernstig', description: 'Klauw- en beetwonden na de aanval van een roofvogel.' },
  { name: 'Botbreuk in de vleugel', severity: 'ernstig', description: 'Gebroken vleugelbot; langdurig herstel, vliegen uitgesloten.' },
];

/** The infirmary (ziekenboeg): isolate + treat ailing birds. */
export const INFIRMARY = {
  baseCapacity: 4, // upgradeable later
  medicatedFoodPerBird: 45, // weekly € per bird in the infirmary when medicated feed is on
  doctorSalary: 400, // weekly € per pigeon doctor hired
  physioSalary: 350, // weekly € per pigeon physiotherapist hired
  birdsPerDoctor: 2, // one doctor treats up to this many sick birds well
  birdsPerPhysio: 2, // one physio treats up to this many injured birds well
} as const;

/** Health-system tuning. All probabilities are per weekly tick. */
export const HEALTH = {
  /** Health lost when an ailment first strikes, by severity. */
  onsetHealthHit: { licht: 10, matig: 22, ernstig: 38 } as Record<Severity, number>,
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
  contagionPerSource: 0.11,
  /** Weekly chance a low-condition bird falls ill on its own (× (1-health/100)). */
  spontaneousIllness: 0.05,
  /** Extra weekly death chance from an untreated severe/moderate ailment. */
  ailmentMortalityOutside: { licht: 0, matig: 0.03, ernstig: 0.1 } as Record<Severity, number>,
  ailmentMortalityInfirmary: { licht: 0, matig: 0.005, ernstig: 0.025 } as Record<Severity, number>,
  /** Chance a finished flight leaves a bird injured, plus a per-km term. */
  flightInjuryBase: 0.025,
  flightInjuryPerKm: 0.00018,
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
}

export const REAL_SCHEDULE: ScheduleSlot[] = [
  // Morning: a long-distance race (national or international, rotating per day).
  { key: 'morning-long', tiers: ['national', 'international'], weekday: null, hour: 10, minute: 0 },
  // Late afternoon: a short regional race.
  { key: 'evening-short', tier: 'regional', weekday: null, hour: 17, minute: 0 },
];

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
];

export const FEMALE_FIRST_NAMES = [
  'Betsy', 'Gerda', 'Chantal', 'Brenda', 'Rita', 'Fien', 'Roos', 'Bertha', 'Godelieve', 'Bella',
  'Trees', 'Whitney', 'Kimberly', 'Samantha', 'Yvonne', 'Marleen', 'Sandra', 'Tante', 'Wies', 'Nancy',
  'Denise', 'Simonne', 'Agnes', 'Bea', 'Carine', 'Diane', 'Emma', 'Francine', 'Greet', 'Hilde',
  'Ingrid', 'Josée', 'Katrien', 'Lea', 'Maria', 'Nadine', 'Odette', 'Paula', 'Rosa', 'Sonja',
  'Tinne', 'Ursula', 'Viviane', 'Wendy', 'Christine', 'Godelieve', 'Martha', 'Zoë',
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
// Live race commentary (dark-ish Flemish humour). {name}/{name2} get filled in.
// ===========================================================================
export const COMMENTARY = {
  start: [
    'De manden gaan open — daar vliegen ze, richting huis!',
    'Lossing! De hemel kleurt grijs van de duiven.',
    'En ze zijn vertrokken, zat van de vrijheid.',
  ],
  leading: [
    '{name} vliegt op kop alsof de frituur zo sluit.',
    '{name} leidt de dans en kijkt geen één keer om.',
    '{name} voorop — de rest mag de veren opeten.',
    '{name} ruikt de overwinning (of is dat de mestkar?).',
  ],
  lagging: [
    '{name} bengelt achteraan en overweegt een tussenstop bij de frietkot.',
    '{name} vliegt met de handrem op.',
    '{name} is even geland om op een standbeeld te schijten.',
    '{name} twijfelt of dit wel de juiste kant is.',
    '{name} had misschien beter niet zo veel gegeten voor de start.',
  ],
  incident: [
    'Een sperwer cirkelt boven de groep… iedereen doet plots héél hard zijn best.',
    '{name} scheert rakelings langs een hoogspanningskabel. Spannend!',
    '{name} pikt onderweg nog een frietje mee — multitasken heet dat.',
    'Een kat kijkt hongerig omhoog. {name} versnelt wijselijk.',
    '{name} vliegt door een zwerm muggen. Gratis eiwitten.',
  ],
  midrace: [
    '{name} haalt {name2} in! Wat een duel!',
    '{name} en {name2} vechten om elke meter.',
    'Halverwege, en {name} ruikt de thuishaven.',
    '{name} vliegt op routine, sigaar in de snavel.',
    '{name} laat {name2} het vuile werk in de wind opknappen.',
  ],
  finish: [
    '{name} valt in! Klok gedrukt!',
    '{name} plooit de vleugels en duikt het hok in. Binnen!',
    'Daar is {name}! De melker pinkt een traantje weg.',
    '{name} landt en vraagt meteen om eten. Typisch.',
  ],
} as const;
