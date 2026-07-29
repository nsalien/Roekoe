/**
 * Client-side DTO types. These mirror the shapes returned by the server's
 * presenters (server/src/routes/presenters.ts). Kept as plain interfaces so
 * there is no build coupling between client and server.
 */

export type Sex = 'doffer' | 'duivin';
export type FeedRation = 'low' | 'normal' | 'high';
export type FlightType = 'regional' | 'national' | 'international';
export type FlightStatus = 'scheduled' | 'live' | 'completed';
export type Severity = 'licht' | 'matig' | 'ernstig';

export interface Ailment {
  kind: 'ziekte' | 'kwetsuur';
  name: string;
  severity: Severity;
  description: string;
  sinceWeek: number;
}

export interface AuthUser {
  id: string;
  username: string;
  isAdmin: boolean;
}

export interface Pigeon {
  id: string;
  ownerId: string;
  ownerName: string;
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
  retired: boolean;
  ailment: Ailment | null;
  inInfirmary: boolean;
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
  money: number;
  food: number;
  feedRation: FeedRation;
  capacity: number;
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
  weather: string;
  entryCount: number;
  entries: FlightEntry[];
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

export type BadgeGroup = 'race' | 'podium' | 'breed' | 'market' | 'care' | 'milestone' | 'fun';

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
}

export interface World {
  currentWeek: number;
  seasonYear: number;
  seeded: boolean;
}

export interface FeedRationInfo {
  label: string;
  foodPerPigeon: number;
  formRecovery: number;
  healthRecovery: number;
}

export interface GameState {
  world: World;
  isAdmin: boolean;
  loft: Loft | null;
  pigeons: Pigeon[];
  scheduledFlights: Flight[];
  rankings: RankingRow[];
  feedRations: Record<FeedRation, FeedRationInfo>;
  infirmary: InfirmaryConfig;
  unreadNotifications: number;
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
