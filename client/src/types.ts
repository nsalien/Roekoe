/**
 * Client-side DTO types. These mirror the shapes returned by the server's
 * presenters (server/src/routes/presenters.ts). Kept as plain interfaces so
 * there is no build coupling between client and server.
 */

export type Sex = 'doffer' | 'duivin';
export type BreedRarity = 'algemeen' | 'ongewoon' | 'zeldzaam' | 'legendarisch' | 'gemengd';

export interface PigeonBreed {
  id: string;
  name: string;
  rarity: BreedRarity;
  rarityLabel: string;
  image: string; // filename under /pigeon-images/
}
export type FeedRation = 'normal' | 'premium' | 'libido' | 'herstel';
export type FoodStock = Record<FeedRation, number>;
export type BetKind = 'win' | 'last' | 'own_top3' | 'top3' | 'mine_wins' | 'head2head';
export type FlightType = 'regional' | 'national' | 'international';
export type FlightStatus = 'scheduled' | 'live' | 'completed';
export type Severity = 'licht' | 'matig' | 'ernstig';

export interface Ailment {
  kind: 'ziekte' | 'kwetsuur';
  name: string;
  severity: Severity;
  description: string;
  sinceWeek: number;
  healed?: number; // real-time recovery progress, 0..1
}

export interface AuthUser {
  id: string;
  username: string;
  isAdmin: boolean;
}

/** Planned per-day attribute changes from a pigeon's current care selection. */
export interface DailyCareProjection {
  ration: FeedRation;
  fed: boolean;
  compartment: boolean;
  coachActive: boolean;
  deltas: {
    form: number;
    health: number;
    endurance: number;
    libido: number;
    speed: number;
    orientation: number;
    experience: number;
  };
}

export interface Pigeon {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerIsBot: boolean;
  name: string;
  sex: Sex;
  ageWeeks: number;
  // Individual attributes are only revealed for your OWN pigeons; for other
  // players' birds these are null (see `revealed`). The general score (talent)
  // is always public.
  revealed: boolean;
  speed: number | null;
  endurance: number | null;
  orientation: number | null;
  libido: number | null;
  form: number | null;
  health: number | null;
  experience: number | null;
  talent: number;
  // Breed (ras): cosmetic photo + rarity. Public for every bird.
  breed: PigeonBreed;
  value: number;
  canRace: boolean;
  forSale: boolean;
  price: number | null;
  sireId: string | null;
  damId: string | null;
  ailment: Ailment | null;
  /** What the market says this bird is worth (see server game/market.ts). */
  valueModel: number;
  valueMarket: number | null;
  /** How strongly recent comparable sales set the price, in %. */
  valueTrust: number;
  valueSamples: number;
  inInfirmary: boolean;
  /** Actually being treated by a dokter/kinesist right now. */
  treated: boolean;
  /** The owner pinned this bird to a staff slot (vs. the automatic choice). */
  careAssigned: boolean;
  coached: boolean;
  ration: FeedRation;
  compartment: boolean;
  cureUntil: string | null;
  onCure: boolean;
  /** Lost her way on a flight and not home yet; she always returns. */
  away: boolean;
  awayUntil: string | null;
  /** When this bird may take its next rest cure (one per bird per week), or null. */
  restCureAvailableAt: string | null;
  trainAvailableAt: { speed: string | null; endurance: string | null; orientation: string | null };
  racing: boolean;
  breeding: boolean;
  dailyCare: DailyCareProjection | null;
  // Genetics (own birds only; null for other players' birds).
  genes: { speed: number; endurance: number; orientation: number } | null; // per-skill ceilings (≤95)
  training: {
    speed: { cost: number; cap: number };
    endurance: { cost: number; cap: number };
    orientation: { cost: number; cap: number };
  } | null; // per-attr next-step cost + manual ceiling (min(80, geneCap))
  // Coach's daily polish per skill (0 at the gene cap) + the ervaring it adds,
  // which shrinks as the bird gets more experienced.
  coachGain: { speed: number; endurance: number; orientation: number; experience: number } | null;
  /** Vluchtvorm: energie + gezondheid (laagste telt dubbel) − rustaftrek. Drives
   *  the injury odds; null for another player's hidden bird. */
  flightForm: number | null;
  formLabel: 'fris' | 'matig' | 'risico' | null;
  restPenalty: number; // vorm docked for having raced in the last couple of days
}

export interface Trade {
  id: string;
  pigeonName: string;
  sellerName: string;
  buyerName: string;
  price: number;
  at: string;
}

export interface RaceHistoryRow {
  flightId: string;
  name: string;
  fromCity: string;
  toCity: string;
  distanceKm: number;
  startAt: string;
  rank: number;
  total: number;
  points: number;
  prize: number;
}

export interface Loft {
  userId: string;
  name: string;
  sponsorCount: number;
  sponsorOfferCount: number;
  money: number;
  food: FoodStock;
  feedRation: FeedRation;
  capacity: number;
  compartments: number;
  compartmentsUsed: number;
  compartmentCost: number | null;
  nextCapacity: { capacity: number; price: number } | null;
  nextInfirmary: { capacity: number; price: number } | null;
  pigeonCount: number;
  seasonPoints: number;
  totalWins: number;
  isBot: boolean;
  infirmaryCapacity: number;
  infirmaryCount: number;
  medicatedFood: boolean;
  doctors: number;
  physios: number;
  sickCount: number;
  injuredCount: number;
  restCureAvailableAt: string | null;
  coachedCount: number;
  dailyCosts: DailyCostBreakdown;
}

/** Cumulative recurring daily costs of a loft, split per category (€ per day). */
export interface DailyCostBreakdown {
  upkeepBase: number;
  upkeepPerPigeon: number; // total over all bands
  /** Per-pigeon upkeep split over the progressive bands (duif 1–8, 9–12, …). */
  upkeepBands: { from: number; to: number; perPigeon: number; birds: number; amount: number }[];
  coaches: number;
  doctors: number;
  physios: number;
  medicatedFeed: number;
  total: number;
  /** Daily sponsor income, per contract and totalled. */
  sponsors: { id: string; name: string; icon: string; amount: number }[];
  sponsorTotal: number;
  /** Income − costs: what the loft nets per day. */
  net: number;
}

export interface EconomyCosts {
  renameCost: number;
  renameLoftCost: number;
  coachHireCost: number;
  coachSalary: number; // per day (recurring costs are charged daily)
  coachExpDailyGain: number; // flat ervaring gained per day while coached (only ≥90)
  dailyUpkeepBase: number;
  dailyUpkeepPerPigeon: number; // the first band's rate (headline)
  /** Progressive per-pigeon upkeep schedule: every bird pays its own band's rate. */
  upkeepBands: { upTo: number; perPigeon: number }[];
  trainCost: number;
  breedCost: number;
  betMinStake: number;
  betMaxStake: number;
  betWindowHours: number;
  restCureCost: number;
  restCureEnergy: number;
  restCureHealth: number;
  restCureHours: number;
  restCureCooldownDays: number;
  restaurantName: string; // the local pigeon-soup restaurant
  restaurantPayout: number; // fixed coins for selling a bird there
  restaurantMoraleMin: number; // each remaining bird loses this much energie…
  restaurantMoraleMax: number; // …up to this much (random per bird)
}

export interface FlightEntrant {
  pigeonId: string;
  name: string;
  ownerId: string;
  ownerName: string;
  talent: number;
}

export interface BetView {
  id: string;
  kind: BetKind;
  pigeonName: string;
  rivalName: string | null;
  stake: number;
  ratio: number;
  potentialWin: number;
  status: 'open' | 'won' | 'lost' | 'void';
  flightName: string;
  flightId: string;
}

export interface BetPreview {
  ratio: number;
  prob: number;
  potentialWin: number;
  label: string;
}

export interface InfirmaryConfig {
  baseCapacity: number;
  medicatedFoodPerBird: number;
  doctorSalary: number;
  physioSalary: number;
  birdsPerDoctor: number;
  birdsPerPhysio: number;
}

export interface FlightEntry {
  pigeonId: string;
  ownerId: string;
  /** Estafettevlucht: which leg this bird flies. */
  leg?: number;
}

export interface FlightResult {
  pigeonId: string;
  pigeonName: string;
  ownerId: string;
  ownerName: string;
  velocity: number;
  timeSeconds: number;
  rank: number;
  points: number;
  prize: number;
  finished: boolean;
}

export interface Flight {
  id: string;
  week: number;
  name: string;
  type: FlightType;
  distanceKm: number;
  entryFee: number;
  fromCity: string;
  toCity: string;
  startAt: string;
  status: FlightStatus;
  practice: boolean;
  titan: boolean;
  /** Estafettevlucht: one team of `teamSize` birds per loft, flying equal legs. */
  relay: boolean;
  legs?: RelayLeg[];
  teamSize?: number;
  legKm?: number;
  teams?: RelayEntryTeam[];
  weather: string;
  entryCount: number;
  entries: FlightEntry[];
  entrants: FlightEntrant[];
  bettingOpen: boolean;
  results: FlightResult[];
  recap: string;
  createdAt: string;
}

/** One equal stretch of an estafettevlucht, with its own forecast. */
export interface RelayLeg {
  index: number;
  fromName: string;
  toName: string;
  distanceKm: number;
  weather: string;
  weatherFactor: number;
  forecastAt?: string;
}

/** A loft's entered relay team, in running order. */
export interface RelayEntryTeam {
  ownerId: string;
  ownerName: string;
  complete: boolean;
  legs: { leg: number; pigeonId: string; name: string }[];
}

export interface LiveRelayLeg {
  leg: number;
  pigeonId: string;
  pigeonName: string;
  kmDone: number;
  kmTotal: number;
  speedKmh: number;
  status: 'wachtend' | 'onderweg' | 'binnen' | 'gestopt';
}

export interface LiveRelayTeam {
  ownerId: string;
  ownerName: string;
  kmDone: number;
  kmTotal: number;
  kmRemaining: number;
  progress: number;
  activeLeg: number;
  speedKmh: number;
  legs: LiveRelayLeg[];
  finished: boolean;
  out: boolean;
  etaSeconds: number;
  liveRank: number;
}

export interface LiveBird {
  pigeonId: string;
  pigeonName: string;
  ownerId: string;
  ownerName: string;
  kmDone: number;
  kmTotal: number;
  kmRemaining: number;
  speedKmh: number;
  progress: number;
  finished: boolean;
  gaveUp: boolean;
  etaSeconds: number;
  liveRank: number;
}

export interface LiveSnapshot {
  status: FlightStatus;
  elapsedSeconds: number;
  totalSeconds: number;
  overallProgress: number;
  allFinished: boolean;
  birds: LiveBird[];
  /** Estafettevlucht only: the same race grouped per team. */
  teams?: LiveRelayTeam[];
}

export interface CommentLine {
  atSeconds: number;
  text: string;
}

/**
 * The live board answers from the flight row alone (two D1 rows instead of ~350
 * — see loadLiveFlight/liveBoardDTO on the server), so it carries only the
 * fields this page actually renders. Deliberately NOT the full `Flight`: if the
 * page ever needs `entrants`/`teams`, add them on the server rather than falling
 * back to the full load — that route is polled by every player at once.
 */
export interface LiveFlight {
  id: string;
  name: string;
  fromCity: string;
  toCity: string;
  distanceKm: number;
  startAt: string;
  status: FlightStatus;
  weather: string;
  relay: boolean;
  entries: FlightEntry[];
  results: FlightResult[];
  recap: string | null;
}

export interface LiveResponse {
  flight: LiveFlight;
  live: LiveSnapshot | null;
  commentary: CommentLine[];
}

export interface RankingRow {
  userId: string;
  name: string;
  isBot: boolean;
  seasonPoints: number;
  totalWins: number;
  level: number;
  pigeonCount: number;
  rank: number;
}

export type BadgeGroup = 'race' | 'podium' | 'breed' | 'market' | 'care' | 'milestone' | 'sponsor' | 'fun' | 'collection';

export interface BadgeItem {
  key: string;
  group: BadgeGroup;
  label: string;
  description: string;
  xp: number;
  icon: string;
  earned: boolean;
  earnedAt: string | null;
}

export interface Trophy {
  flightId: string;
  name: string;
  fromCity: string;
  toCity: string;
  startAt: string;
  pigeonName: string;
  rank: number;
}

export type WingCategory = 'speed' | 'podium' | 'progress';

export interface SeasonAward {
  kind: 'roekoe' | 'vleugel';
  rank: number;
  season: number;
  at: string;
  reward: number;
  category?: WingCategory;
  pigeonName?: string;
  value?: number;
}

export interface PlayerProfile {
  level: number;
  xp: number;
  intoLevel: number;
  needForNext: number;
  earnedCount: number;
  totalBadges: number;
  badges: BadgeItem[];
  medals: { gold: number; silver: number; bronze: number };
  trophies: Trophy[];
  roekoes: { gold: number; silver: number; bronze: number };
  vleugels: { gold: number; silver: number; bronze: number };
  awards: SeasonAward[];
}

export interface World {
  currentWeek: number;
  seasonYear: number;
  seeded: boolean;
  seasonStartedAt: string;
  seasonEndsAt: string;
  seasonWeek: number;
}

export interface PigeonRankRow {
  pigeonId: string;
  name: string;
  ownerId: string;
  ownerName: string;
  isBot: boolean;
  value: number;
}

export interface PigeonRankings {
  fastest: PigeonRankRow[];
  podiums: PigeonRankRow[];
  progress: PigeonRankRow[];
}

export interface FeedRationInfo {
  label: string;
  foodPerPigeon: number;
  pricePerKg: number;
  formRecovery: number;
  healthRecovery: number;
  enduranceRecovery: number;
  libidoRecovery: number;
}

export interface OfferView {
  id: string;
  pigeonId: string;
  pigeonName: string;
  fromUserName: string;
  toUserName: string;
  amount: number;
  createdAt: string;
}

export interface GameState {
  world: World;
  isAdmin: boolean;
  loft: Loft | null;
  pigeons: Pigeon[];
  scheduledFlights: Flight[];
  rankings: RankingRow[];
  pigeonRankings: PigeonRankings;
  offers: { received: OfferView[]; sent: OfferView[] };
  feedRations: Record<FeedRation, FeedRationInfo>;
  infirmary: InfirmaryConfig;
  economy: EconomyCosts;
  missions: DailyMission[];
  streak: number;
  pendingEvent: EventCard | null;
  /** Held clutches awaiting a keep/let-go choice — a nag badge on Kweek. */
  pendingNests: number;
  unreadNotifications: number;
}

export interface DailyMission {
  key: string;
  label: string;
  target: number;
  progress: number;
  rewardMoney: number;
  rewardXp: number;
  done: boolean;
}

export interface EventCard {
  key: string;
  title: string;
  text: string;
  icon: string;
  options: { label: string }[];
}

export interface AuctionInfo {
  id: string;
  kind: 'sunday' | 'shelter';
  sellerName: string;
  pigeon: Pigeon | null;
  startAt: string;
  endAt: string;
  currentBid: number;
  currentBidderName: string | null;
  minNextBid: number;
  /** When the endgame starts: from here every player has only `maxBids` left. */
  finalPhaseAt: string;
  finalPhase: boolean;
  finalPhaseMinutes: number;
  antiSnipeMinutes: number;
  maxBids: number;
  /** Bids this viewer already spent in the final phase, and what is left. */
  bidsUsed: number;
  bidsLeft: number;
}

export interface Sponsor {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  tier: number;
  category: string;
  categoryLabel: string;
  signingBonus: number;
  /** Paid every day the contract is active. */
  dailyStipend: number;
  /** Reference podium bonus (a win on a national flight). */
  podiumBase: number;
  /** The full payout grid: per tier, the amount for 1e / 2e / 3e. */
  podium: { regional: number[]; national: number[]; international: number[] };
  breakPenalty: number;
  requirement: string;
  signedBefore: boolean;
  // Present on active contracts:
  since?: string;
  // Present on offers/available (a same-category rival you'd have to drop):
  conflictWith?: string | null;
  conflictPenalty?: number;
  /** Refusing is definitive: this offer pays less than the sponsor you already
   *  have in the same category, so they will not come back. */
  refusalIsFinal?: boolean;
}

export interface SponsorView {
  bestTalent: number;
  active: Sponsor[];
  offers: Sponsor[];
}

export type NotificationKind = 'result' | 'improve' | 'info' | 'health' | 'badge';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  flightId: string | null;
  createdAt: string;
  read: boolean;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unread: number;
}

export interface BreedingPair {
  id: string;
  sire: string;
  dam: string;
  hatchAt: string;
}

/** A youngster in a held nest: hatched, but not in the loft until you keep it. */
export interface BroodYoung {
  id: string;
  name: string;
  sex: Sex;
  speed: number;
  endurance: number;
  orientation: number;
  libido: number;
  form: number;
  health: number;
  talent: number;
  breed: Pigeon['breed'];
  genes: { speed: number; endurance: number; orientation: number } | null;
  declineRate: number;
}

/** A clutch that hatched into a full loft and is waiting on your keep/let-go choice. */
export interface PendingNest {
  id: string;
  sire: string;
  dam: string;
  createdAt: string;
  young: BroodYoung[];
}

export interface BreedingView {
  pairs: BreedingPair[];
  nests: PendingNest[];
  capacity: number;
  pigeonCount: number;
  freeSpace: number;
}
