/**
 * Client-side DTO types. These mirror the shapes returned by the server's
 * presenters (server/src/routes/presenters.ts). Kept as plain interfaces so
 * there is no build coupling between client and server.
 */

export type Sex = 'doffer' | 'duivin';
export type FeedRation = 'low' | 'normal' | 'high';
export type FlightType = 'club' | 'national';
export type FlightStatus = 'scheduled' | 'live' | 'completed';

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
  fromNpc?: boolean;
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
  pigeonCount: number;
  rank: number;
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
  unreadNotifications: number;
}

export type NotificationKind = 'result' | 'improve' | 'info';

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
  hatchWeek: number;
  weeksLeft: number;
}
