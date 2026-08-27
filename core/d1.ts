/**
 * D1-backed store.
 *
 * Loads the world into an in-memory `Database` so the existing synchronous game
 * engine can run against it untouched, then persists only the rows that actually
 * changed. Because we diff per-row, two players acting on different
 * pigeons/lofts in the same instant don't overwrite each other.
 *
 * ## Reads are the scarce resource (see §Performance in context.md)
 * D1 bills *rows read*, and on the free plan the daily budget is what takes the
 * whole game down (every route 503s, login included) once it runs out. So the
 * log-shaped tables are NOT loaded whole any more:
 *
 *  - `notifications` — only the viewer's inbox (`user_id` index).
 *  - `bets`          — only still-open bets plus the viewer's own.
 *  - `trades`        — only the newest `TRADE_LOAD_LIMIT` (index on `at`).
 *
 * Everything the engine reasons about globally (users, lofts, flights, auctions,
 * …) is still loaded whole; those are bounded by the number of players and the
 * 2-day flight retention.
 *
 * `pigeons` is the exception, because it is by far the biggest of them: at the
 * design ceiling of ~264 birds it is **264 of the ~300 rows a request costs**.
 * A request that only READS, and arrives while the engine's last run is still
 * fresh, cannot touch the rest of the world — so those get a NARROW pigeon load
 * (`loadNarrow`): the viewer's own birds, plus the relay teams of any unfinished
 * flight (the one remaining place a narrow-path DTO names a foreign bird). The
 * world-wide leaderboards that used to force a full read are served from
 * `World.leaderboard`, refreshed on every full load.
 *
 * Keeping that extra set SMALL is the whole game: every entrant of every running
 * flight is most of the population, and pulling them in costs as much as a full
 * load. That is why the betting entrant list lives on its own full-load route
 * (`GET /api/flights/:id/entrants`) instead of riding along on `/api/flights`.
 *
 * Because these three tables are no longer fully in memory, the engine can't
 * bound them by rewriting the array. `persist()` therefore appends bounded SQL
 * cleanups — but only on the rare requests that actually append a row.
 */

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type {
  Auction,
  AuctionBid,
  Bet,
  BreedingPair,
  Database,
  Flight,
  Loft,
  Notification,
  Pigeon,
  PendingBrood,
  PigeonOffer,
  SponsorState,
  Trade,
  User,
} from './schema.js';
import { emptyDatabase, emptyFoodStock, emptySponsorState, emptyStats } from './schema.js';
import type { Store } from './store.js';
import { ADVANCE_THROTTLE_SECONDS } from './config/gameConfig.js';

const b = (v: unknown) => (v ? 1 : 0);

/** Newest trades kept in memory (and on disk). Feeds the sale history views and
 *  the market valuation (`market.ts`). Lowered 100 → 40: every request pays for
 *  these rows, and the valuation weights a sale by recency anyway (10-day half
 *  life, 28-day window), so the oldest of a hundred barely moved the curve. */
export const TRADE_LOAD_LIMIT = 40;
/** Settled bets kept on disk; open ones are always kept, whatever their age. */
const BET_KEEP_LIMIT = 100;
/** Notifications kept per user — matches the engine's own in-memory inbox trim
 *  (`trimNotifications`), which can now only reach the viewer's own rows. */
const NOTIFICATION_KEEP_PER_USER = 40;

function rowToUser(r: any): User {
  return {
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    isAdmin: !!r.is_admin,
    isBot: !!r.is_bot,
    createdAt: r.created_at,
  };
}
function rowToLoft(r: any): Loft {
  return {
    userId: r.user_id,
    name: r.name,
    money: r.money,
    food: r.food_stock ? { ...emptyFoodStock(), ...JSON.parse(r.food_stock) } : emptyFoodStock(),
    feedRation: r.feed_ration,
    capacity: r.capacity,
    compartments: r.compartments ?? 0,
    seasonPoints: r.season_points,
    totalWins: r.total_wins,
    isBot: !!r.is_bot,
    infirmaryCapacity: r.infirmary_capacity ?? 4,
    medicatedFood: !!r.medicated_food,
    doctors: r.doctors ?? 0,
    physios: r.physios ?? 0,
    lastRestCure: r.last_rest_cure ?? null,
    xp: r.xp ?? 0,
    level: r.level ?? 1,
    stats: r.stats ? { ...emptyStats(), ...JSON.parse(r.stats) } : emptyStats(),
    badges: r.badges ? JSON.parse(r.badges) : [],
    missions: r.missions ? JSON.parse(r.missions) : [],
    missionsDay: r.missions_day ?? '',
    streak: r.streak ?? 0,
    pendingEvent: r.pending_event ? JSON.parse(r.pending_event) : null,
    pendingBroods: r.pending_broods ? (JSON.parse(r.pending_broods) as PendingBrood[]) : [],
    sponsorship: parseSponsorship(r),
    awards: r.awards ? JSON.parse(r.awards) : [],
  };
}

/**
 * Read the sponsor state. Any older shape (or the pre-blob single-sponsor
 * columns) is tolerated here and fully normalised later by the sponsors module.
 */
function parseSponsorship(r: any): SponsorState {
  if (r.sponsorship) {
    try { return JSON.parse(r.sponsorship) as SponsorState; } catch { /* fall through */ }
  }
  const st = emptySponsorState();
  if (r.sponsor_id) {
    // Terms unknown on this ancient shape; sponsors.ts fills in the catalogue
    // defaults for a contract without stored terms.
    st.active.push({ id: r.sponsor_id, since: r.sponsor_since ?? '', dailyStipend: 0, podiumBase: 0 });
  }
  if (r.sponsors_signed) {
    try { st.signed = JSON.parse(r.sponsors_signed); } catch { /* ignore */ }
  }
  return st;
}
function rowToPigeon(r: any): Pigeon {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    sex: r.sex,
    birthWeek: r.birth_week,
    speed: r.speed,
    endurance: r.endurance,
    orientation: r.orientation,
    libido: r.libido ?? 50,
    form: r.form,
    health: r.health,
    experience: r.experience,
    sireId: r.sire_id,
    damId: r.dam_id,
    forSale: !!r.for_sale,
    price: r.price,
    createdAtWeek: r.created_at_week,
    ailment: r.ailment ? JSON.parse(r.ailment) : null,
    inInfirmary: !!r.in_infirmary,
    careAssigned: !!r.care_assigned,
    races: r.races ?? 0,
    everAiled: !!r.ever_ailed,
    breed: r.breed ?? undefined,
    coached: !!r.coached,
    ration: r.ration ?? 'normal',
    compartment: !!r.compartment,
    hungerDays: r.hunger_days ?? 0,
    restDays: r.rest_days ?? 0,
    cureUntil: r.cure_until ?? null,
    lastRaceAt: r.last_race_at ?? null,
    lastRestCureAt: r.last_rest_cure_at ?? null,
    awayUntil: r.away_until ?? null,
    lastRaceWasPractice: !!r.last_race_practice,
    seasonPeakSpeed: r.season_peak_speed ?? 0,
    seasonPodiums: r.season_podiums ?? 0,
    seasonStartScore: r.season_start_score ?? undefined,
    seasonPracticeGain: r.season_practice_gain ?? 0,
    trainedAt: r.trained_at ? JSON.parse(r.trained_at) : undefined,
    raceLog: r.race_log ? JSON.parse(r.race_log) : undefined,
    genes: r.genes ? JSON.parse(r.genes) : undefined,
    declineRate: typeof r.decline_rate === 'number' ? r.decline_rate : undefined,
    attrLog: r.attr_log ? JSON.parse(r.attr_log) : undefined,
  };
}
function rowToBreeding(r: any): BreedingPair {
  return {
    id: r.id,
    ownerId: r.owner_id,
    sireId: r.sire_id,
    damId: r.dam_id,
    hatchAt: r.hatch_at ?? '',
    createdAtWeek: r.created_at_week,
  };
}
function rowToFlight(r: any): Flight {
  return {
    id: r.id,
    week: r.week,
    templateKey: r.template_key,
    name: r.name,
    type: r.type,
    distanceKm: r.distance_km,
    entryFee: r.entry_fee,
    fromCity: r.from_city ?? '',
    toCity: r.to_city ?? '',
    startAt: r.start_at ?? '',
    status: r.status,
    practice: !!r.practice,
    titan: !!r.titan,
    relay: !!r.relay,
    legs: r.legs ? JSON.parse(r.legs) : undefined,
    entries: JSON.parse(r.entries || '[]'),
    sim: JSON.parse(r.sim || '[]'),
    weather: r.weather,
    weatherFactor: r.weather_factor,
    results: JSON.parse(r.results || '[]'),
    recap: r.recap ?? '',
    createdAt: r.created_at,
  };
}
function rowToNotification(r: any): Notification {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    flightId: r.flight_id ?? null,
    createdAt: r.created_at,
    read: !!r.read,
  };
}
function rowToAuction(r: any): Auction {
  return {
    id: r.id,
    templateKey: r.template_key,
    pigeonId: r.pigeon_id,
    startAt: r.start_at,
    endAt: r.end_at,
    minBid: r.min_bid,
    minIncrement: r.min_increment,
    currentBid: r.current_bid,
    currentBidderId: r.current_bidder_id ?? null,
    currentBidderName: r.current_bidder_name ?? null,
    bids: r.bids ? JSON.parse(r.bids) : [],
    status: r.status,
  };
}
function rowToBet(r: any): Bet {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    flightId: r.flight_id,
    kind: r.kind,
    pigeonId: r.pigeon_id ?? null,
    pigeonName: r.pigeon_name,
    rivalId: r.rival_id ?? null,
    rivalName: r.rival_name ?? null,
    stake: r.stake,
    ratio: r.ratio,
    potentialWin: r.potential_win,
    status: r.status,
    placedAt: r.placed_at,
    settledAt: r.settled_at ?? null,
  };
}
function rowToOffer(r: any): PigeonOffer {
  return {
    id: r.id,
    pigeonId: r.pigeon_id,
    pigeonName: r.pigeon_name,
    fromUserId: r.from_user_id,
    fromUserName: r.from_user_name,
    toUserId: r.to_user_id,
    toUserName: r.to_user_name,
    amount: r.amount,
    status: r.status,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at ?? null,
  };
}
function rowToTrade(r: any): Trade {
  return {
    id: r.id,
    pigeonId: r.pigeon_id,
    pigeonName: r.pigeon_name,
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    buyerId: r.buyer_id,
    buyerName: r.buyer_name,
    price: r.price,
    at: r.at,
    talent: typeof r.talent === 'number' ? r.talent : undefined,
  };
}

/**
 * Look up a single user without loading the world — the whole point being that
 * logging in must keep working even when the read budget for the game state is
 * gone. `users` is tiny and `username` is indexed.
 */
export async function findUserById(db: D1Database, id: string): Promise<User | null> {
  const row = (await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()) as any;
  return row ? rowToUser(row) : null;
}

/**
 * The live board, without loading the world: the world row (for the engine's
 * throttle clock) plus the one flight being watched. **Two rows.**
 *
 * This is the single hottest route in the game — during a fondvlucht every
 * player keeps it open and polls it for hours — and a full load costs ~350 rows,
 * of which ~64% is the entire `pigeons` table. The live board needs none of it:
 * the positions, names and owners all ride in the flight's own frozen `sim` and
 * `results`, and the page never reads `entrants`/`teams`. D1's free plan bills
 * **rows read** (5M/day), so this is what keeps a long race from eating the
 * day's budget. See `liveBoardDTO` for the matching slim response.
 */
export async function loadLiveFlight(
  db: D1Database,
  flightId: string,
): Promise<{ lastAdvance: string; flight: Flight } | null> {
  const [worldRow, flightRow] = await Promise.all([
    db.prepare('SELECT last_advance FROM world WHERE id = 1').first() as Promise<any>,
    db.prepare('SELECT * FROM flights WHERE id = ?').bind(flightId).first() as Promise<any>,
  ]);
  if (!flightRow) return null;
  return { lastAdvance: worldRow?.last_advance ?? '', flight: rowToFlight(flightRow) };
}

/** Same, by name. Case-insensitive and never matches a bot. */
export async function findUserByUsername(db: D1Database, username: string): Promise<User | null> {
  const row = (await db
    .prepare('SELECT * FROM users WHERE lower(username) = lower(?) AND is_bot = 0')
    .bind(username)
    .first()) as any;
  return row ? rowToUser(row) : null;
}

/**
 * Column lists + row mappers for the two tables that dominate a write: `pigeons`
 * (hundreds of rows, 38 columns) and `lofts` (one per player, 26 columns). They
 * live at module scope because `load` snapshots the column values as they are on
 * disk, and `persist` compares against that snapshot to write only the columns
 * that genuinely changed (see `diff`).
 */
const PIGEON_COLUMNS = [
  'id', 'owner_id', 'name', 'sex', 'birth_week', 'speed', 'endurance', 'orientation', 'libido',
  'form', 'health', 'experience', 'sire_id', 'dam_id', 'for_sale', 'price', 'created_at_week',
  'retired', 'ailment', 'in_infirmary', 'races', 'ever_ailed', 'breed', 'coached', 'ration',
  'compartment', 'hunger_days', 'rest_days', 'cure_until', 'season_peak_speed', 'season_podiums',
  'season_start_score', 'season_practice_gain', 'trained_at', 'race_log', 'genes', 'decline_rate',
  'attr_log', 'care_assigned', 'last_race_at', 'last_race_practice', 'last_rest_cure_at', 'away_until',
];

function pigeonRow(p: Pigeon): unknown[] {
  return [
    p.id, p.ownerId, p.name, p.sex, p.birthWeek, p.speed, p.endurance, p.orientation, p.libido, p.form, p.health,
    p.experience, p.sireId, p.damId, b(p.forSale), p.price, p.createdAtWeek, 0,
    p.ailment ? JSON.stringify(p.ailment) : '', b(p.inInfirmary), p.races, b(p.everAiled), p.breed ?? null, b(p.coached),
    p.ration ?? 'normal', b(p.compartment), p.hungerDays ?? 0, p.restDays ?? 0, p.cureUntil ?? null,
    p.seasonPeakSpeed ?? 0, p.seasonPodiums ?? 0, p.seasonStartScore ?? null, p.seasonPracticeGain ?? 0,
    p.trainedAt ? JSON.stringify(p.trainedAt) : null,
    p.raceLog && p.raceLog.length ? JSON.stringify(p.raceLog) : null,
    p.genes ? JSON.stringify(p.genes) : null,
    typeof p.declineRate === 'number' ? p.declineRate : null,
    p.attrLog && p.attrLog.length ? JSON.stringify(p.attrLog) : null,
    b(p.careAssigned), p.lastRaceAt ?? null, b(p.lastRaceWasPractice), p.lastRestCureAt ?? null,
    p.awayUntil ?? null,
  ];
}

const LOFT_COLUMNS = [
  'user_id', 'name', 'money', 'food', 'food_stock', 'feed_ration', 'capacity', 'compartments',
  'season_points', 'total_wins', 'is_bot', 'infirmary_capacity', 'medicated_food', 'doctors',
  'physios', 'xp', 'level', 'stats', 'badges', 'missions', 'missions_day', 'streak',
  'pending_event', 'sponsorship', 'last_rest_cure', 'awards', 'pending_broods',
];

function loftRow(l: Loft): unknown[] {
  return [
    l.userId, l.name, l.money, 0, JSON.stringify(l.food ?? emptyFoodStock()), l.feedRation, l.capacity, l.compartments ?? 0, l.seasonPoints, l.totalWins, b(l.isBot),
    l.infirmaryCapacity, b(l.medicatedFood), l.doctors, l.physios,
    l.xp, l.level, JSON.stringify(l.stats), JSON.stringify(l.badges),
    JSON.stringify(l.missions ?? []), l.missionsDay ?? '', l.streak ?? 0,
    l.pendingEvent ? JSON.stringify(l.pendingEvent) : '',
    JSON.stringify(l.sponsorship ?? emptySponsorState()),
    l.lastRestCure ?? null,
    JSON.stringify(l.awards ?? []),
    // '' rather than '[]' for the common empty case, so an untouched loft's
    // column-narrowed UPDATE keeps skipping this column.
    l.pendingBroods?.length ? JSON.stringify(l.pendingBroods) : '',
  ];
}

/** How `D1Store.load` should size the pigeon read — see the file header. */
export interface LoadOptions {
  /**
   * The caller vouches that this request only READS the viewer's own world. The
   * narrow load still only happens when the engine is also fresh.
   */
  narrowWhenIdle?: boolean;
  /** Injectable clock, so tests can drive the freshness window. */
  nowMs?: number;
}

export class D1Store implements Store {
  private constructor(
    private readonly db: D1Database,
    private readonly world: Database,
    private readonly snapshots: Record<string, Map<string, string>>,
    /** Column values as loaded, for the tables that get column-narrowed updates. */
    private readonly rowSnapshots: Record<string, Map<string, unknown[]>>,
    private readonly worldExisted: boolean,
    private readonly worldSnapshot: string,
    /** Whose inbox/bets were loaded; the bounded cleanups key off this. */
    private readonly viewerId: string | undefined,
    /**
     * True when `pigeons` holds only the viewer's own birds plus flight
     * entrants. Callers MUST NOT run the engine or any world-wide computation
     * on such a store — see the file header.
     */
    readonly narrowed: boolean = false,
  ) {}

  get data(): Database {
    return this.world;
  }

  mutate<T>(fn: (db: Database) => T): T {
    return fn(this.world);
  }

  /**
   * `viewerId` is the logged-in user (decoded from the JWT, which needs no
   * database). It narrows the per-user tables to that player's rows; pass
   * nothing for an anonymous request and those tables come back empty.
   */
  static async load(db: D1Database, viewerId?: string, opts?: LoadOptions): Promise<D1Store> {
    const worldRow = (await db.prepare('SELECT * FROM world WHERE id = 1').first()) as any;
    const dbObj = emptyDatabase();
    let worldExisted = false;
    if (worldRow) {
      worldExisted = true;
      dbObj.world = {
        currentWeek: worldRow.current_week,
        seasonYear: worldRow.season_year,
        seeded: !!worldRow.seeded,
        dataVersion: worldRow.data_version ?? 0,
        lastDailyTick: worldRow.last_daily_tick ?? '',
        lastShelterSpawn: worldRow.last_shelter_spawn ?? '',
        seasonStartedAt: worldRow.season_started_at ?? '',
        seasonEndsAt: worldRow.season_ends_at ?? '',
        seasonWeek: worldRow.season_week ?? 1,
        lastAdvance: worldRow.last_advance ?? '',
        dailyCareCursor: worldRow.daily_care_cursor ?? '',
        leaderboard: worldRow.leaderboard ?? '',
      };
    }

    // The per-user tables are queried through their indexes, never scanned. An
    // anonymous request binds '' and matches nothing, which is what we want.
    const viewer = viewerId ?? '';

    // Narrow the pigeon read? Only when the CALLER says this request is a pure
    // read of the viewer's own world (an allowlisted path — see NARROW_PATHS in
    // the API) AND the engine's last run is still fresh, so `advanceRealtime`
    // will be skipped and nothing will reason over the birds we leave out.
    // Anything else, including every write, still gets the whole table.
    const lastAdvance = Date.parse(dbObj.world.lastAdvance ?? '');
    const engineFresh =
      !Number.isNaN(lastAdvance) &&
      (opts?.nowMs ?? Date.now()) - lastAdvance >= 0 &&
      (opts?.nowMs ?? Date.now()) - lastAdvance < ADVANCE_THROTTLE_SECONDS * 1000;
    // `let`: an oversized entrant list downgrades this back to a full read below.
    let narrowed = !!opts?.narrowWhenIdle && !!viewerId && engineFresh;
    const [users, lofts, pigeons, breeding, flights, notifications, trades, auctions, openBets, myBets] =
      await Promise.all([
        db.prepare('SELECT * FROM users').all(),
        db.prepare('SELECT * FROM lofts').all(),
        // On a narrowed load the pigeons come from a second, index-backed query
        // that needs the flight rows first (for the entrants), so skip it here.
        narrowed ? Promise.resolve({ results: [] }) : db.prepare('SELECT * FROM pigeons').all(),
        db.prepare('SELECT * FROM breeding_pairs').all(),
        db.prepare('SELECT * FROM flights').all(),
        db.prepare('SELECT * FROM notifications WHERE user_id = ?').bind(viewer).all(),
        db.prepare('SELECT * FROM trades ORDER BY at DESC LIMIT ?').bind(TRADE_LOAD_LIMIT).all(),
        db.prepare('SELECT * FROM auctions').all(),
        // Open bets are needed in full: any request may be the one that settles a
        // flight, and settling touches every open bet on it, whoever placed it.
        db.prepare("SELECT * FROM bets WHERE status = 'open'").all(),
        db.prepare("SELECT * FROM bets WHERE user_id = ? AND status != 'open'").bind(viewer).all(),
      ]);

    dbObj.users = (users.results as any[]).map(rowToUser);
    dbObj.lofts = (lofts.results as any[]).map(rowToLoft);
    dbObj.pigeons = (pigeons.results as any[]).map(rowToPigeon);
    // Flights must be parsed BEFORE the narrow pigeon read below, which derives
    // the extra ids it needs from them. (This assignment used to sit twenty
    // lines further down, so the set was always empty and every foreign bird on
    // a narrowed load came back unnamed.)
    dbObj.flights = (flights.results as any[]).map(rowToFlight);
    if (narrowed) {
      // The viewer's own birds (idx_pigeons_owner) plus the relay teams of any
      // flight that has not finished. Those teams are the ONLY birds outside the
      // viewer's loft that a narrow-path DTO still names (flightDTO.teams — see
      // core/presenters.ts); the betting entrant list has its own full-load
      // route precisely so this stays small. A relay is one team of three per
      // loft on alternating Saturdays, so this is bounded by the player count.
      // One statement, both halves index-backed: an OR across columns would drop
      // SQLite back to a full scan, which is the very thing we are avoiding.
      const entrantIds = new Set<string>();
      for (const f of dbObj.flights) {
        if (f.status === 'completed' || !f.relay) continue;
        for (const e of f.entries ?? []) entrantIds.add(e.pigeonId);
      }
      // Above a few hundred entrants the narrow read stops being narrow, and the
      // bound parameters start approaching SQLite's variable limit. At that point
      // the whole table is cheaper and simpler than a giant IN list.
      if (entrantIds.size > 400) {
        narrowed = false;
        dbObj.pigeons = ((await db.prepare('SELECT * FROM pigeons').all()).results as any[]).map(rowToPigeon);
      } else {
        const ids = [...entrantIds];
        const sql = ids.length
          ? `SELECT * FROM pigeons WHERE owner_id = ? UNION SELECT * FROM pigeons WHERE id IN (${ids.map(() => '?').join(',')})`
          : 'SELECT * FROM pigeons WHERE owner_id = ?';
        const mine = await db.prepare(sql).bind(viewer, ...ids).all();
        dbObj.pigeons = (mine.results as any[]).map(rowToPigeon);
      }
    }
    dbObj.breedingPairs = (breeding.results as any[]).map(rowToBreeding);
    dbObj.notifications = (notifications.results as any[]).map(rowToNotification);
    dbObj.trades = (trades.results as any[]).map(rowToTrade).reverse(); // oldest → newest, as before
    dbObj.auctions = (auctions.results as any[]).map(rowToAuction);
    dbObj.bets = [...(openBets.results as any[]), ...(myBets.results as any[])].map(rowToBet);

    // Bids live in their own table (clobber-free). Attach them to each auction,
    // overriding the legacy JSON column when present. Guarded so a database that
    // predates the table (before ensureSchema ran) still loads.
    try {
      const bidRows = (await db.prepare('SELECT * FROM auction_bids').all()).results as any[];
      if (bidRows.length > 0) {
        const byAuction = new Map<string, AuctionBid[]>();
        for (const r of bidRows) {
          const arr = byAuction.get(r.auction_id) ?? [];
          arr.push({ userId: r.user_id, name: r.name, amount: r.amount, lateBids: r.late_bids ?? 0 });
          byAuction.set(r.auction_id, arr);
        }
        for (const a of dbObj.auctions) {
          const t = byAuction.get(a.id);
          if (t) a.bids = t.sort((x, y) => y.amount - x.amount);
        }
      }
    } catch {
      // auction_bids table not present yet — fall back to the JSON column.
    }

    // Private pigeon offers (guarded for databases predating the table).
    try {
      dbObj.offers = ((await db.prepare('SELECT * FROM offers').all()).results as any[]).map(rowToOffer);
    } catch {
      dbObj.offers = [];
    }
    const snapshots: Record<string, Map<string, string>> = {
      users: snapshot(dbObj.users, (u) => u.id),
      lofts: snapshot(dbObj.lofts, (l) => l.userId),
      pigeons: snapshot(dbObj.pigeons, (p) => p.id),
      breedingPairs: snapshot(dbObj.breedingPairs, (bp) => bp.id),
      flights: snapshot(dbObj.flights, (f) => f.id),
      notifications: snapshot(dbObj.notifications, (nt) => nt.id),
      trades: snapshot(dbObj.trades, (t) => t.id),
      auctions: snapshot(dbObj.auctions, (a) => a.id),
      auctionBids: snapshot(flattenAuctionBids(dbObj.auctions), (r) => r.key),
      bets: snapshot(dbObj.bets, (bt) => bt.id),
      offers: snapshot(dbObj.offers, (o) => o.id),
    };
    // Column-level snapshots of the two heavy tables, taken BEFORE the engine
    // mutates the entities, so `persist` can write `SET form = ...` instead of
    // all 38 columns of a pigeon.
    const rowSnapshots: Record<string, Map<string, unknown[]>> = {
      pigeons: rowSnapshot(dbObj.pigeons, (p) => p.id, pigeonRow),
      lofts: rowSnapshot(dbObj.lofts, (l) => l.userId, loftRow),
    };

    return new D1Store(db, dbObj, snapshots, rowSnapshots, worldExisted, JSON.stringify(dbObj.world), viewerId, narrowed);
  }

  /** Write back only what changed. */
  async persist(): Promise<void> {
    const db = this.db;
    const w = this.world;
    const stmts: D1PreparedStatement[] = [];
    // Users who got a fresh notification this request; their inbox is capped
    // afterwards (see `boundedCleanups`).
    const notifiedUsers = new Set<string>();
    let addedTrade = false;
    let addedBet = false;

    const wd = w.world;
    if (!this.worldExisted) {
      stmts.push(
        db.prepare('INSERT INTO world (id, current_week, season_year, seeded, data_version, last_daily_tick, last_shelter_spawn, season_started_at, season_ends_at, season_week, last_advance, daily_care_cursor, leaderboard, version) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')
          .bind(wd.currentWeek, wd.seasonYear, b(wd.seeded), wd.dataVersion ?? 0, wd.lastDailyTick ?? '', wd.lastShelterSpawn ?? '', wd.seasonStartedAt ?? '', wd.seasonEndsAt ?? '', wd.seasonWeek ?? 1, wd.lastAdvance ?? '', wd.dailyCareCursor ?? '', wd.leaderboard ?? ''),
      );
    } else if (JSON.stringify(wd) !== this.worldSnapshot) {
      // Only write the world row when something in it actually changed. Previously
      // this ran on EVERY request (even read-only polls), burning the write quota
      // and making `world` (id=1) a hot row that concurrent requests locked on.
      stmts.push(
        db.prepare('UPDATE world SET current_week = ?, season_year = ?, seeded = ?, data_version = ?, last_daily_tick = ?, last_shelter_spawn = ?, season_started_at = ?, season_ends_at = ?, season_week = ?, last_advance = ?, daily_care_cursor = ?, leaderboard = ?, version = version + 1 WHERE id = 1')
          .bind(wd.currentWeek, wd.seasonYear, b(wd.seeded), wd.dataVersion ?? 0, wd.lastDailyTick ?? '', wd.lastShelterSpawn ?? '', wd.seasonStartedAt ?? '', wd.seasonEndsAt ?? '', wd.seasonWeek ?? 1, wd.lastAdvance ?? '', wd.dailyCareCursor ?? '', wd.leaderboard ?? ''),
      );
    }

    diff(this.snapshots.users, w.users, (u) => u.id, {
      db,
      table: 'users',
      columns: ['id', 'username', 'password_hash', 'is_admin', 'is_bot', 'created_at'],
      keyColumn: 'id',
      row: (u) => [u.id, u.username, u.passwordHash, b(u.isAdmin), b(u.isBot), u.createdAt],
      stmts,
    });

    diff(this.snapshots.lofts, w.lofts, (l) => l.userId, {
      db,
      table: 'lofts',
      columns: LOFT_COLUMNS,
      keyColumn: 'user_id',
      row: loftRow,
      previousRows: this.rowSnapshots.lofts,
      stmts,
    });

    diff(this.snapshots.pigeons, w.pigeons, (p) => p.id, {
      db,
      table: 'pigeons',
      columns: PIGEON_COLUMNS,
      keyColumn: 'id',
      row: pigeonRow,
      previousRows: this.rowSnapshots.pigeons,
      stmts,
    });

    diff(this.snapshots.breedingPairs, w.breedingPairs, (bp) => bp.id, {
      db,
      table: 'breeding_pairs',
      columns: ['id', 'owner_id', 'sire_id', 'dam_id', 'hatch_week', 'hatch_at', 'created_at_week'],
      keyColumn: 'id',
      row: (bp) => [bp.id, bp.ownerId, bp.sireId, bp.damId, 0, bp.hatchAt, bp.createdAtWeek],
      stmts,
    });

    diff(this.snapshots.flights, w.flights, (f) => f.id, {
      db,
      table: 'flights',
      columns: [
        'id', 'week', 'template_key', 'name', 'type', 'distance_km', 'entry_fee', 'from_city',
        'to_city', 'start_at', 'status', 'entries', 'sim', 'weather', 'weather_factor', 'results',
        'recap', 'created_at', 'practice', 'titan', 'relay', 'legs',
      ],
      keyColumn: 'id',
      row: (f) => [
        f.id, f.week, f.templateKey, f.name, f.type, f.distanceKm, f.entryFee,
        f.fromCity, f.toCity, f.startAt, f.status,
        JSON.stringify(f.entries), JSON.stringify(f.sim), f.weather, f.weatherFactor,
        JSON.stringify(f.results), f.recap, f.createdAt, b(f.practice), b(f.titan),
        b(f.relay), f.legs ? JSON.stringify(f.legs) : null,
      ],
      stmts,
    });

    diff(this.snapshots.notifications, w.notifications, (nt) => nt.id, {
      db,
      table: 'notifications',
      columns: ['id', 'user_id', 'kind', 'title', 'body', 'flight_id', 'created_at', 'read'],
      keyColumn: 'id',
      row: (nt) => [nt.id, nt.userId, nt.kind, nt.title, nt.body, nt.flightId, nt.createdAt, b(nt.read)],
      onInsert: (nt) => notifiedUsers.add(nt.userId),
      stmts,
    });

    diff(this.snapshots.trades, w.trades, (t) => t.id, {
      db,
      table: 'trades',
      columns: ['id', 'pigeon_id', 'pigeon_name', 'seller_id', 'seller_name', 'buyer_id', 'buyer_name', 'price', 'at', 'talent'],
      keyColumn: 'id',
      row: (t) => [t.id, t.pigeonId, t.pigeonName, t.sellerId, t.sellerName, t.buyerId, t.buyerName, t.price, t.at, t.talent ?? null],
      onInsert: () => { addedTrade = true; },
      stmts,
    });

    diff(this.snapshots.auctions, w.auctions, (a) => a.id, {
      db,
      table: 'auctions',
      columns: [
        'id', 'template_key', 'pigeon_id', 'start_at', 'end_at', 'min_bid', 'min_increment',
        'current_bid', 'current_bidder_id', 'current_bidder_name', 'bids', 'status',
      ],
      keyColumn: 'id',
      row: (a) => [a.id, a.templateKey, a.pigeonId, a.startAt, a.endAt, a.minBid, a.minIncrement, a.currentBid, a.currentBidderId, a.currentBidderName, JSON.stringify(a.bids ?? []), a.status],
      stmts,
    });

    // Bids as independent rows: one (auction, bidder) each, so a concurrent
    // request closing an auction can never wipe a freshly-placed bid.
    diff(this.snapshots.auctionBids, flattenAuctionBids(w.auctions), (r) => r.key, {
      db,
      table: 'auction_bids',
      columns: ['auction_id', 'user_id', 'name', 'amount', 'at', 'late_bids'],
      row: (r) => [r.auctionId, r.userId, r.name, r.amount, new Date().toISOString(), r.lateBids ?? 0],
      // Composite key, so these deletes can't be folded into one `IN (...)`.
      deleteKeys: (keys) =>
        keys.map((key) => {
          const sep = key.lastIndexOf('::');
          return db.prepare('DELETE FROM auction_bids WHERE auction_id = ? AND user_id = ?')
            .bind(key.slice(0, sep), key.slice(sep + 2));
        }),
      stmts,
    });

    diff(this.snapshots.bets, w.bets, (bt) => bt.id, {
      db,
      table: 'bets',
      columns: [
        'id', 'user_id', 'user_name', 'flight_id', 'kind', 'pigeon_id', 'pigeon_name', 'rival_id',
        'rival_name', 'stake', 'ratio', 'potential_win', 'status', 'placed_at', 'settled_at',
      ],
      keyColumn: 'id',
      row: (bt) => [bt.id, bt.userId, bt.userName, bt.flightId, bt.kind, bt.pigeonId, bt.pigeonName, bt.rivalId, bt.rivalName, bt.stake, bt.ratio, bt.potentialWin, bt.status, bt.placedAt, bt.settledAt],
      onInsert: () => { addedBet = true; },
      stmts,
    });

    diff(this.snapshots.offers, w.offers, (o) => o.id, {
      db,
      table: 'offers',
      columns: [
        'id', 'pigeon_id', 'pigeon_name', 'from_user_id', 'from_user_name', 'to_user_id',
        'to_user_name', 'amount', 'status', 'created_at', 'resolved_at',
      ],
      keyColumn: 'id',
      row: (o) => [o.id, o.pigeonId, o.pigeonName, o.fromUserId, o.fromUserName, o.toUserId, o.toUserName, o.amount, o.status, o.createdAt, o.resolvedAt],
      stmts,
    });

    boundedCleanups(db, stmts, notifiedUsers, addedTrade, addedBet);

    if (stmts.length > 0) await db.batch(stmts);
  }
}

/**
 * Keep the log-shaped tables from growing forever.
 *
 * These used to be bounded in memory (`db.trades.slice(-200)` and friends), which
 * only worked while the whole table was loaded. Now that we load a slice, the cap
 * lives here in SQL instead — and runs only on the rare requests that actually
 * appended a row, so a plain poll adds nothing.
 *
 * Each statement is index-backed and touches a single user's inbox or the tail of
 * one table, so the cleanup itself stays cheap. `OFFSET n` returning no row (fewer
 * rows than the cap) yields NULL, and `< NULL` deletes nothing — exactly right.
 */
function boundedCleanups(
  db: D1Database,
  stmts: D1PreparedStatement[],
  notifiedUsers: Set<string>,
  addedTrade: boolean,
  addedBet: boolean,
): void {
  for (const userId of notifiedUsers) {
    stmts.push(
      db.prepare(
        'DELETE FROM notifications WHERE user_id = ?1 AND created_at < ' +
          '(SELECT created_at FROM notifications WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1 OFFSET ?2)',
      ).bind(userId, NOTIFICATION_KEEP_PER_USER),
    );
  }
  if (addedTrade) {
    stmts.push(
      db.prepare(
        'DELETE FROM trades WHERE at < (SELECT at FROM trades ORDER BY at DESC LIMIT 1 OFFSET ?)',
      ).bind(TRADE_LOAD_LIMIT),
    );
  }
  if (addedBet) {
    // Open bets always survive — they still have to be settled.
    stmts.push(
      db.prepare(
        "DELETE FROM bets WHERE status != 'open' AND placed_at < " +
          "(SELECT placed_at FROM bets WHERE status != 'open' ORDER BY placed_at DESC LIMIT 1 OFFSET ?)",
      ).bind(BET_KEEP_LIMIT),
    );
  }
}

/**
 * How many upgrade statements one invocation may run. D1 allows **50 queries per
 * Worker invocation** on the free plan, and the same request still has to load the
 * world (13) and write its batch, so the upgrade takes a modest slice and resumes
 * on the next call.
 */
const SCHEMA_STEPS_PER_RUN = 20;

/**
 * Every schema statement, in a **frozen, append-only order**.
 *
 * `world.schema_version` stores how many of these have been applied, so an
 * up-to-date database skips the lot in a single query. That makes the order load-
 * bearing: **only ever append**. Inserting or reordering would make already-upgraded
 * databases skip statements they never ran.
 *
 * Every statement is individually idempotent (`ADD COLUMN` on an existing column and
 * `IF NOT EXISTS` both just throw or no-op), so re-running a prefix is always safe —
 * which is what keeps a wrong counter harmless rather than corrupting.
 *
 * Table creation comes first: `D1Store.load` guards its `auction_bids`/`offers`
 * queries, but a fresh install should get them early rather than after 56 ALTERs.
 */
const SCHEMA_STEPS: string[] = [
  // 0 — the progress counter itself, so tracking works from the very first run.
  'ALTER TABLE world ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 0',

  // Tables introduced after migrations/0001.
  'CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, flight_id TEXT, created_at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, pigeon_id TEXT NOT NULL, pigeon_name TEXT NOT NULL, seller_id TEXT NOT NULL, seller_name TEXT NOT NULL, buyer_id TEXT NOT NULL, buyer_name TEXT NOT NULL, price INTEGER NOT NULL, at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS auctions (id TEXT PRIMARY KEY, template_key TEXT NOT NULL, pigeon_id TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL, min_bid INTEGER NOT NULL, min_increment INTEGER NOT NULL, current_bid INTEGER NOT NULL DEFAULT 0, current_bidder_id TEXT, current_bidder_name TEXT, status TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS auction_bids (auction_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, amount INTEGER NOT NULL, at TEXT NOT NULL, PRIMARY KEY (auction_id, user_id))',
  "CREATE TABLE IF NOT EXISTS bets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT NOT NULL, flight_id TEXT NOT NULL, kind TEXT NOT NULL, pigeon_id TEXT, pigeon_name TEXT NOT NULL, rival_id TEXT, rival_name TEXT, stake INTEGER NOT NULL, ratio REAL NOT NULL, potential_win INTEGER NOT NULL, status TEXT NOT NULL, placed_at TEXT NOT NULL, settled_at TEXT)",
  'CREATE TABLE IF NOT EXISTS offers (id TEXT PRIMARY KEY, pigeon_id TEXT NOT NULL, pigeon_name TEXT NOT NULL, from_user_id TEXT NOT NULL, from_user_name TEXT NOT NULL, to_user_id TEXT NOT NULL, to_user_name TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT)',

  // Indexes, including the ones backing the partial loads (see the file header).
  'CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_auction_bids_auction ON auction_bids (auction_id)',
  'CREATE INDEX IF NOT EXISTS idx_bets_user ON bets (user_id)',
  'CREATE INDEX IF NOT EXISTS idx_bets_status ON bets (status)',
  'CREATE INDEX IF NOT EXISTS idx_trades_at ON trades (at)',

  // Columns added after migrations/0001.
  ...([
    'ALTER TABLE world ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE flights ADD COLUMN from_city TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE flights ADD COLUMN to_city TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE flights ADD COLUMN start_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE flights ADD COLUMN sim TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE flights ADD COLUMN recap TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE world ADD COLUMN data_version INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE world ADD COLUMN last_daily_tick TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE breeding_pairs ADD COLUMN hatch_at TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE pigeons ADD COLUMN libido REAL NOT NULL DEFAULT 50',
    "ALTER TABLE pigeons ADD COLUMN ailment TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE pigeons ADD COLUMN in_infirmary INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE lofts ADD COLUMN infirmary_capacity INTEGER NOT NULL DEFAULT 4',
    'ALTER TABLE lofts ADD COLUMN medicated_food INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE lofts ADD COLUMN doctors INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE lofts ADD COLUMN physios INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE lofts ADD COLUMN xp INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE lofts ADD COLUMN level INTEGER NOT NULL DEFAULT 1',
    "ALTER TABLE lofts ADD COLUMN stats TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE lofts ADD COLUMN badges TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE pigeons ADD COLUMN races INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pigeons ADD COLUMN ever_ailed INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE lofts ADD COLUMN missions TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE lofts ADD COLUMN missions_day TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE lofts ADD COLUMN streak INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE lofts ADD COLUMN pending_event TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE lofts ADD COLUMN sponsor_id TEXT",
    "ALTER TABLE lofts ADD COLUMN sponsor_since TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE lofts ADD COLUMN sponsors_signed TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE lofts ADD COLUMN sponsorship TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE lofts ADD COLUMN compartments INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pigeons ADD COLUMN coached INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE pigeons ADD COLUMN ration TEXT NOT NULL DEFAULT 'normal'",
    'ALTER TABLE pigeons ADD COLUMN compartment INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pigeons ADD COLUMN hunger_days INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pigeons ADD COLUMN rest_days INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pigeons ADD COLUMN cure_until TEXT',
    'ALTER TABLE lofts ADD COLUMN last_rest_cure TEXT',
    'ALTER TABLE pigeons ADD COLUMN season_peak_speed REAL NOT NULL DEFAULT 0',
    'ALTER TABLE pigeons ADD COLUMN season_podiums INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pigeons ADD COLUMN season_start_score REAL',
    'ALTER TABLE pigeons ADD COLUMN season_practice_gain REAL NOT NULL DEFAULT 0',
    'ALTER TABLE pigeons ADD COLUMN trained_at TEXT',
    'ALTER TABLE pigeons ADD COLUMN race_log TEXT',
    'ALTER TABLE pigeons ADD COLUMN breed TEXT',
    'ALTER TABLE pigeons ADD COLUMN genes TEXT',
    'ALTER TABLE pigeons ADD COLUMN decline_rate REAL',
    'ALTER TABLE pigeons ADD COLUMN attr_log TEXT',
    "ALTER TABLE lofts ADD COLUMN awards TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE world ADD COLUMN season_started_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE world ADD COLUMN season_ends_at TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE world ADD COLUMN season_week INTEGER NOT NULL DEFAULT 1',
    "ALTER TABLE flights ADD COLUMN practice INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE flights ADD COLUMN titan INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE world ADD COLUMN last_shelter_spawn TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE auctions ADD COLUMN bids TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE lofts ADD COLUMN food_stock TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE flights ADD COLUMN relay INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE flights ADD COLUMN legs TEXT',
    'ALTER TABLE pigeons ADD COLUMN care_assigned INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE auction_bids ADD COLUMN late_bids INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE trades ADD COLUMN talent REAL',
    'ALTER TABLE pigeons ADD COLUMN last_race_at TEXT',
    'ALTER TABLE pigeons ADD COLUMN last_race_practice INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pigeons ADD COLUMN last_rest_cure_at TEXT',
    'ALTER TABLE pigeons ADD COLUMN away_until TEXT',
    "ALTER TABLE world ADD COLUMN last_advance TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE world ADD COLUMN daily_care_cursor TEXT NOT NULL DEFAULT ''",
  ] as string[]),

  // Held clutches (see `PendingBrood`) ride along on the loft row, next to
  // `pending_event`: the lofts table is already loaded on every request, so a
  // separate table would have cost one more query per request — and the worst
  // request is already at ~42 of the 50 a Worker invocation may spend.
  "ALTER TABLE lofts ADD COLUMN pending_broods TEXT NOT NULL DEFAULT ''",

  // Cached world-wide leaderboards, so /state no longer has to read every pigeon
  // just to render two top-10 lists (see World.leaderboard).
  "ALTER TABLE world ADD COLUMN leaderboard TEXT NOT NULL DEFAULT ''",
];

/**
 * Idempotent, **resumable** schema top-up. The base tables come from
 * migrations/0001; this applies everything added since, so existing databases
 * upgrade themselves on deploy (no manual SQL needed).
 *
 * ## Why it is chunked (this caused a day of 503s)
 * This used to fire all ~70 statements on every cold start. D1 allows **50 queries
 * per Worker invocation** on the free plan, so such a request blew its budget and
 * died before it ever reached the game — on any route, login included, at random
 * moments (isolates are recycled constantly). Now:
 *   - an up-to-date database costs **one** query and returns `true`;
 *   - a stale one applies at most `SCHEMA_STEPS_PER_RUN` statements, records how
 *     far it got, and returns `false` so the caller comes back for the rest.
 * Either way a single invocation stays far below the limit.
 *
 * Returns whether the schema is now fully up to date.
 */
export async function ensureSchema(db: D1Database): Promise<boolean> {
  let done = 0;
  try {
    const row = (await db.prepare('SELECT schema_version AS v FROM world WHERE id = 1').first()) as any;
    if (row) done = Number(row.v ?? 0) || 0;
    if (done >= SCHEMA_STEPS.length) return true;
  } catch {
    // No `schema_version` column (or no world row) yet — start from the top. Every
    // step is idempotent, so re-running a prefix costs queries, never correctness.
  }

  const slice = SCHEMA_STEPS.slice(done, done + SCHEMA_STEPS_PER_RUN);
  for (const sql of slice) {
    try {
      await db.exec(sql);
    } catch {
      // Column/table/index already exists — nothing to do.
    }
  }
  const reached = done + slice.length;

  try {
    await db.prepare('UPDATE world SET schema_version = ? WHERE id = 1').bind(reached).run();
  } catch {
    // No world row yet (brand-new database, not seeded). Progress isn't recorded,
    // so the prefix simply runs again after seeding — harmless, and it converges.
  }
  return reached >= SCHEMA_STEPS.length;
}

/** Flatten every auction's bids into one row per (auction, bidder). The key
 *  `${auctionId}::${userId}` lets the per-row diff add/update/remove each bid
 *  independently, so bids survive concurrent writes to the auction row. */
type FlatBid = { key: string; auctionId: string; userId: string; name: string; amount: number; lateBids: number };

function flattenAuctionBids(auctions: Auction[]): FlatBid[] {
  const rows: FlatBid[] = [];
  for (const a of auctions) {
    for (const bd of a.bids ?? []) {
      rows.push({
        key: `${a.id}::${bd.userId}`, auctionId: a.id, userId: bd.userId,
        name: bd.name, amount: bd.amount, lateBids: bd.lateBids ?? 0,
      });
    }
  }
  return rows;
}

function snapshot<T>(items: T[], key: (t: T) => string): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of items) m.set(key(it), JSON.stringify(it));
  return m;
}

/** Same, but keeping the column values, for the column-narrowed updates in `diff`. */
function rowSnapshot<T>(items: T[], key: (t: T) => string, row: (t: T) => unknown[]): Map<string, unknown[]> {
  const m = new Map<string, unknown[]>();
  for (const it of items) m.set(key(it), row(it));
  return m;
}

/**
 * D1 bills TWO budgets that matter here (free plan):
 *   - **50 queries per Worker invocation** — every statement inside a `batch()`
 *     counts, so a request that changes 60 rows used to die before it answered.
 *   - **100 bound parameters per query** — which is what caps how many rows we
 *     can fold into one multi-row statement.
 * `diff` therefore writes a table's changed rows as a handful of MULTI-ROW
 * statements instead of one statement per row: a pigeon has 38 columns, so two
 * birds fit in one query; a notification has 8, so twelve do.
 */
const D1_MAX_BOUND_PARAMS = 100;

/**
 * Write back a table's changed rows (and drop the vanished ones), grouped into
 * as few statements as the parameter ceiling allows.
 *
 * `onInsert` fires only for rows that are genuinely new (not in the snapshot),
 * which is how the caller knows an inbox/trade/bet log actually grew and needs
 * capping (see `boundedCleanups`).
 */
function diff<T>(
  snap: Map<string, string>,
  current: T[],
  key: (t: T) => string,
  ops: {
    db: D1Database;
    table: string;
    columns: string[];
    /** Primary-key column, used for the grouped DELETE. Omit with `deleteKeys`. */
    keyColumn?: string;
    row: (t: T) => unknown[];
    onInsert?: (t: T) => void;
    /**
     * Column values as they are on disk. When given, an existing row is written
     * with a narrow `UPDATE` of just the columns that moved instead of a full
     * 38-column upsert — the difference between 100 statements and 8 on a
     * daily-care tick.
     */
    previousRows?: Map<string, unknown[]>;
    /** Custom deletes for a table whose key is composite (auction_bids). */
    deleteKeys?: (keys: string[]) => D1PreparedStatement[];
    stmts: D1PreparedStatement[];
  },
): void {
  const { db, columns, stmts } = ops;
  const inserts: unknown[][] = [];
  /** changed-column signature → the rows that moved exactly those columns. */
  const bySignature = new Map<string, { cols: number[]; rows: { id: string; row: unknown[] }[] }>();
  const touched = new Set<number>(); // union of every column that moved
  let updateCount = 0;
  const gone: string[] = [];
  const seen = new Set<string>();

  for (const it of current) {
    const id = key(it);
    seen.add(id);
    if (snap.get(id) === JSON.stringify(it)) continue; // untouched
    if (!snap.has(id)) ops.onInsert?.(it);
    const row = ops.row(it);
    const before = snap.has(id) ? ops.previousRows?.get(id) : undefined;
    if (!before) {
      inserts.push(row);
      continue;
    }
    const cols: number[] = [];
    for (let i = 0; i < row.length; i++) if (row[i] !== before[i]) cols.push(i);
    if (cols.length === 0) continue; // JSON moved but nothing persisted changed
    for (const i of cols) touched.add(i);
    updateCount += 1;
    const sig = cols.join(',');
    const group = bySignature.get(sig) ?? { cols, rows: [] };
    group.rows.push({ id, row });
    bySignature.set(sig, group);
  }
  for (const id of snap.keys()) if (!seen.has(id)) gone.push(id);

  // Two ways to pack the updates, and which one is cheaper depends on the tick.
  // Daily care moves the same few columns on every bird → the per-signature
  // groups are already ideal. A race finish moves a slightly different set per
  // bird, fragmenting into dozens of tiny statements; there, writing every row
  // with the UNION of the changed columns (re-writing a few unchanged values,
  // which is harmless) packs far denser. Count both and take the smaller.
  const statementsFor = (cols: number[], rows: number) =>
    Math.ceil(rows / Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / (cols.length + 1))));
  const union = [...touched].sort((x, y) => x - y);
  const splitCost = [...bySignature.values()].reduce((n, g) => n + statementsFor(g.cols, g.rows.length), 0);
  const unionCost = statementsFor(union, updateCount);
  const updates =
    unionCost < splitCost
      ? [{ cols: union, rows: [...bySignature.values()].flatMap((g) => g.rows) }]
      : [...bySignature.values()];

  const rowsPerStatement = Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / columns.length));
  const tuple = `(${columns.map(() => '?').join(', ')})`;
  for (let i = 0; i < inserts.length; i += rowsPerStatement) {
    const chunk = inserts.slice(i, i + rowsPerStatement);
    stmts.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO ${ops.table} (${columns.join(', ')}) VALUES ${chunk.map(() => tuple).join(', ')}`,
        )
        .bind(...chunk.flat()),
    );
  }

  // Narrow updates, one statement per group of rows that changed the same
  // columns. `WITH v(...) AS (VALUES ...)` names the columns explicitly, so the
  // UPDATE ... FROM reads as plain SQL and stays inside the parameter ceiling.
  for (const { cols, rows } of updates) {
    const names = cols.map((i) => columns[i]);
    const perStatement = Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / (names.length + 1)));
    const values = `(${['?', ...names.map(() => '?')].join(', ')})`;
    for (let i = 0; i < rows.length; i += perStatement) {
      const chunk = rows.slice(i, i + perStatement);
      const sql =
        `WITH v(k, ${names.join(', ')}) AS (VALUES ${chunk.map(() => values).join(', ')}) ` +
        `UPDATE ${ops.table} SET ${names.map((n) => `${n} = v.${n}`).join(', ')} ` +
        `FROM v WHERE ${ops.table}.${ops.keyColumn} = v.k`;
      stmts.push(db.prepare(sql).bind(...chunk.flatMap(({ id, row }) => [id, ...cols.map((i2) => row[i2])])));
    }
  }

  if (gone.length === 0) return;
  if (ops.deleteKeys) {
    stmts.push(...ops.deleteKeys(gone));
    return;
  }
  for (let i = 0; i < gone.length; i += D1_MAX_BOUND_PARAMS) {
    const chunk = gone.slice(i, i + D1_MAX_BOUND_PARAMS);
    stmts.push(
      db
        .prepare(`DELETE FROM ${ops.table} WHERE ${ops.keyColumn} IN (${chunk.map(() => '?').join(', ')})`)
        .bind(...chunk),
    );
  }
}
