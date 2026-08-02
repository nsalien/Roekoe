/**
 * Client-side DTO types. These mirror the shapes returned by the server's
 * presenters (server/src/routes/presenters.ts). Kept as plain interfaces so
 * there is no build coupling between client and server.
 */

export type Sex = 'doffer' | 'duivin';
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
  speed: number;
  endurance: number;
  orientation: number;
  libido: number;
  form: number;
  health: number;
  experience: number;
  talent: number;
  value: number;
  canRace: boolean;
  forSale: boolean;
  price: number | null;
  sireId: string | null;
  damId: string | null;
  ailment: Ailment | null;
  inInfirmary: boolean;
  coached: boolean;
  ration: FeedRation;
  compartment: boolean;
  cureUntil: string | null;
  onCure: boolean;
  trainAvailableAt: { speed: string | null; endurance: string | null; orientation: string | null };
  racing: boolean;
  breeding: boolean;
  dailyCare: DailyCareProjection | null;
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
}

export interface EconomyCosts {
  renameCost: number;
  renameLoftCost: number;
  coachHireCost: number;
  coachSalary: number; // per day (recurring costs are charged daily)
  dailyUpkeepBase: number;
  dailyUpkeepPerPigeon: number;
  trainCost: number;
  breedCost: number;
  betMinStake: number;
  betMaxStake: number;
  betWindowHours: number;
  restCureCost: number;
  restCureEnergy: number;
  restCureHours: number;
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
  weather: string;
  entryCount: number;
  entries: FlightEntry[];
  entrants: FlightEntrant[];
  bettingOpen: boolean;
  results: FlightResult[];
  recap: string;
  createdAt: string;
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
}

export interface CommentLine {
  atSeconds: number;
  text: string;
}

export interface LiveResponse {
  flight: Flight;
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

export type BadgeGroup = 'race' | 'podium' | 'breed' | 'market' | 'care' | 'milestone' | 'sponsor' | 'fun';

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
  weeklyStipend: number;
  winBonus: number;
  breakPenalty: number;
  requirement: string;
  signedBefore: boolean;
  // Present on active contracts:
  since?: string;
  // Present on offers/available (a same-category rival you'd have to drop):
  conflictWith?: string | null;
  conflictPenalty?: number;
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
