/**
 * Roekoe API — runs as a Cloudflare Pages Function (Workers runtime).
 *
 * A single Hono app handles every /api/* route. Each request loads the world
 * from D1, runs the shared game engine (identical to what a plain Node build
 * would run), then persists the changed rows. Auth is stateless JWT.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handle } from 'hono/cloudflare-pages';
import type { D1Database } from '@cloudflare/workers-types';

import { D1Store, ensureSchema, findUserById, findUserByUsername } from '../../core/d1.js';
import type { User } from '../../core/schema.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../../core/auth.js';
import { newId } from '../../core/store.js';
import {
  ADVANCE_THROTTLE_SECONDS,
  AGING,
  BETTING,
  BREEDING,
  COACH,
  FEED_RATIONS,
  GENE,
  INFIRMARY,
  PIGEON_RESTAURANT,
  REST_CURE,
  RENAME_COST,
  RENAME_LOFT_COST,
  TRAINING,
  DAILY_UPKEEP_BASE,
  DAILY_UPKEEP_PER_PIGEON,
  UPKEEP_BANDS,
} from '../../core/config/gameConfig.js';
import {
  acceptSponsor,
  advanceWeek,
  buyCompartment,
  buyFood,
  buyPigeon,
  cancelSponsor,
  createLoftForUser,
  chooseEvent,
  enterFlight,
  giveUpFlight,
  listForSale,
  refuseSponsor,
  releasePigeon,
  renameLoft,
  renamePigeon,
  seedWorld,
  sellToRestaurant,
  setCoach,
  setInfirmary,
  setInfirmaryStaff,
  setCareAssignment,
  setMedicatedFood,
  setPigeonCompartment,
  setPigeonRation,
  setRelayOrder,
  startBreeding,
  startRestCure,
  stopBreeding,
  trainPigeon,
  unlist,
  upgradeCapacity,
  upgradeInfirmary,
  withdrawFlight,
} from '../../core/game/engine.js';
import { advanceRealtime, applyRelayForecasts, flightsAwaitingStart, relayLegsNeedingForecast } from '../../core/game/schedule.js';
import { pigeonSeasonRankings } from '../../core/game/season.js';
import { velocityBreakdown, weightsForDistance } from '../../core/game/flight.js';
import { ageInWeeks } from '../../core/game/pigeon.js';
import { ownerName } from '../../core/game/engine.js';
import { fetchFlightWeather, fetchLegForecast, type WeatherResult } from '../../core/game/weather.js';
import { auctionKind, placeBid } from '../../core/game/auction.js';
import { betsView, placeBet, previewBet } from '../../core/game/betting.js';
import { makeOffer, withdrawOffer, respondOffer, offersFor } from '../../core/game/offers.js';
import type { BetKind } from '../../core/schema.js';
import { refreshDailyMissions } from '../../core/game/missions.js';
import { sponsorView } from '../../core/game/sponsors.js';
import {
  auctionsDTO,
  flightDTO,
  liveFlightDTO,
  loftDTO,
  notificationsFor,
  pigeonDTO,
  pigeonRaceHistory,
  playerProfile,
  rankingRows,
  recentTrades,
} from '../../core/presenters.js';

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  INVITE_CODE?: string;
  ADMIN_USERS?: string;
}
type Vars = { store: D1Store; user?: User };

const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath('/api');

app.use('*', cors());

let schemaReady = false;

// Load the world, seed on first ever request, run the real-time clock (schedule
// flights, start/finish live races, bots auto-enter), and resolve the user.
app.use('*', async (c, next) => {
  // The schema upgrade is chunked to stay inside D1's per-invocation query budget
  // (see core/d1.ts), so keep asking until it reports it is finished. On an
  // up-to-date database that is a single query, once per isolate.
  if (!schemaReady) schemaReady = await ensureSchema(c.env.DB);

  // Verify the token BEFORE touching D1: it is a pure crypto check, and knowing
  // who is asking lets us load only their notifications/bets instead of every
  // player's (see core/d1.ts — reads are the scarce resource).
  const auth = c.req.header('Authorization');
  const payload = auth?.startsWith('Bearer ')
    ? await verifyToken(auth.slice(7), c.env.JWT_SECRET)
    : null;

  const nowMs = Date.now();
  const path = c.req.path;

  // Login / "who am I" / health must keep working even when the game state's read
  // budget is exhausted — otherwise a heavy day locks everyone out of the game
  // entirely. They resolve the user with a single indexed row lookup and never
  // load the world at all. Registration is the exception: it creates a loft, so
  // it needs the real store (and it's rare enough not to matter).
  const featherweight =
    path === '/api/health' || path === '/api/auth/login' || path === '/api/auth/me';
  if (featherweight) {
    if (payload) {
      const user = await findUserById(c.env.DB, payload.sub);
      if (user) c.set('user', user);
    }
    await next();
    return;
  }

  let store = await D1Store.load(c.env.DB, payload?.sub);
  if (!store.data.world.seeded) {
    seedWorld(store);
    await store.persist();
    store = await D1Store.load(c.env.DB, payload?.sub); // fresh snapshots for any later write
  }
  // Registration is "light": it skips the real-time engine (flight lifecycle,
  // ticks, migrations) and its write, so signing up stays cheap. Its own handler
  // still persists what it changes.
  const light = path.startsWith('/api/auth/');

  // Skip the engine on a read-only request that arrives while a recent run is
  // still fresh (see ADVANCE_THROTTLE_SECONDS). This is the CPU fix: `advance`
  // + `persist` are ~9 ms of a ~14 ms request, and on a poll where nothing
  // happened that work is discarded anyway. A mutating request always advances
  // first so it never acts on a stale world.
  const lastAdvance = Date.parse(store.data.world.lastAdvance ?? '');
  const fresh =
    !Number.isNaN(lastAdvance) &&
    nowMs - lastAdvance >= 0 &&
    nowMs - lastAdvance < ADVANCE_THROTTLE_SECONDS * 1000;
  const readOnly = c.req.method === 'GET' || c.req.method === 'HEAD';
  const throttled = fresh && readOnly;

  if (!light && !throttled) {
    // Real-time flight lifecycle + one-time data migrations. Persist any changes.
    // Fetch real weather for any flight about to start, so it's frozen against
    // actual conditions in the release region (falls back to a random sky).
    // These are the only outbound calls in the request path, and they used to run
    // ONE AFTER THE OTHER, each with its own 4 s timeout. An estafettevlucht needs
    // three leg forecasts (refreshed hourly in the last two hours before the
    // lossing), so a single unlucky request could sit there for 12 s or more with
    // the player staring at a spinner. Running them together bounds the whole
    // block at one timeout instead of one per call. Well within the 50-subrequest
    // budget: at most three legs plus the handful of flights starting at once.
    const due = flightsAwaitingStart(store.data, nowMs).filter((f) => !f.relay);
    // A relay freezes against its own per-leg forecasts, fetched alongside.
    const legs = relayLegsNeedingForecast(store.data, nowMs);
    const [dueWeather, legWeather] = await Promise.all([
      Promise.all(due.map(async (f) => [f.id, await fetchFlightWeather(f.fromCity, f.toCity)] as const)),
      Promise.all(
        legs.map(async (leg) =>
          [`${leg.flightId}:${leg.legIndex}`, await fetchLegForecast(leg.from, leg.to, leg.atMs)] as const,
        ),
      ),
    ]);
    const weatherByFlight = new Map<string, WeatherResult>(dueWeather);
    if (legWeather.length > 0) applyRelayForecasts(store.data, new Map(legWeather), nowMs);
    advanceRealtime(store.data, nowMs, weatherByFlight);
    // Stamp it AFTER the engine ran, so a slow run does not shorten the window.
    store.data.world.lastAdvance = new Date(nowMs).toISOString();
    await store.persist();
  }
  c.set('store', store);

  if (payload) {
    const user = store.data.users.find((u) => u.id === payload.sub);
    if (user) {
      c.set('user', user);
      // Per-user: roll over daily missions/streak (and maybe a dilemma).
      // Sponsor offers are NOT made here — they only appear after a good
      // competition result (see tickFlights).
      const loft = store.data.lofts.find((l) => l.userId === user.id);
      if (loft && !light) {
        const dirty = refreshDailyMissions(store.data, loft, nowMs);
        if (dirty) await store.persist();
      }
    }
  }
  await next();
});

function requireUser(c: any): User {
  const user = c.get('user');
  if (!user) throw new HttpError(401, 'Niet ingelogd');
  return user;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as any);
  console.error(err);
  return c.json({ error: 'Serverfout' }, 500);
});

const TOKEN_TTL = 60 * 60 * 24 * 30;

// Pure liveness — deliberately touches no table, so it stays answerable when the
// database is the thing that's struggling.
app.get('/health', (c) => c.json({ ok: true }));

// --- Auth ------------------------------------------------------------------
app.post('/auth/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  const loftName = String(body.loftName ?? '').trim();
  const inviteCode = String(body.inviteCode ?? '');
  if (username.length < 2 || username.length > 24 || password.length < 4) {
    return c.json({ error: 'Ongeldige gegevens (gebruikersnaam min. 2, wachtwoord min. 4 tekens)' }, 400);
  }

  const inviteRequired = c.env.INVITE_CODE ?? '';
  if (inviteRequired && inviteCode !== inviteRequired) {
    return c.json({ error: 'Verkeerde uitnodigingscode' }, 403);
  }

  const store = c.get('store');
  if (store.data.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return c.json({ error: 'Deze gebruikersnaam bestaat al' }, 409);
  }

  const adminUsers = (c.env.ADMIN_USERS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const humanCount = store.data.users.filter((u) => !u.isBot).length;
  const isAdmin = humanCount === 0 || adminUsers.includes(username.toLowerCase());

  const user: User = {
    id: newId('usr'),
    username,
    passwordHash: await hashPassword(password),
    isAdmin,
    isBot: false,
    createdAt: new Date().toISOString(),
  };
  store.mutate((db) => db.users.push(user));
  createLoftForUser(store, user, loftName || `Hok ${username}`);
  await store.persist();

  const token = await signToken({ sub: user.id, username: user.username }, c.env.JWT_SECRET, TOKEN_TTL);
  const loft = store.data.lofts.find((l) => l.userId === user.id)!;
  return c.json({
    token,
    user: { id: user.id, username: user.username, isAdmin: user.isAdmin },
    loft: loftDTO(store.data, loft),
  });
});

app.post('/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  // Single indexed row lookup — no world load, so logging in survives a day where
  // the game state has burned through the read budget.
  const user = await findUserByUsername(c.env.DB, username);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return c.json({ error: 'Verkeerde gebruikersnaam of wachtwoord' }, 401);
  }
  const token = await signToken({ sub: user.id, username: user.username }, c.env.JWT_SECRET, TOKEN_TTL);
  return c.json({ token, user: { id: user.id, username: user.username, isAdmin: user.isAdmin } });
});

app.get('/auth/me', (c) => {
  const user = requireUser(c);
  return c.json({ id: user.id, username: user.username, isAdmin: user.isAdmin });
});

// --- State -----------------------------------------------------------------
app.get('/state', (c) => {
  const user = requireUser(c);
  const store = c.get('store');
  const db = store.data;
  const loft = db.lofts.find((l) => l.userId === user.id);
  const pigeons = db.pigeons
    .filter((p) => p.ownerId === user.id)
    .map((p) => pigeonDTO(db, p, user.id))
    .sort((a, b) => b.talent - a.talent);
  const upcoming = db.flights
    .filter((f) => f.status === 'scheduled' || f.status === 'live')
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((f) => flightDTO(db, f));
  return c.json({
    world: db.world,
    isAdmin: user.isAdmin,
    loft: loft ? loftDTO(db, loft) : null,
    pigeons,
    scheduledFlights: upcoming,
    rankings: rankingRows(db),
    pigeonRankings: pigeonSeasonRankings(db),
    feedRations: FEED_RATIONS,
    infirmary: INFIRMARY,
    economy: {
      renameCost: RENAME_COST,
      renameLoftCost: RENAME_LOFT_COST,
      coachHireCost: COACH.hireCost,
      coachSalary: COACH.dailySalary,
      coachExpDailyGain: COACH.experienceDailyGain,
      dailyUpkeepBase: DAILY_UPKEEP_BASE,
      dailyUpkeepPerPigeon: DAILY_UPKEEP_PER_PIGEON,
      // The progressive per-pigeon upkeep schedule, so the loft page can show
      // what the NEXT birds will cost before you buy the capacity for them.
      upkeepBands: UPKEEP_BANDS,
      trainCost: TRAINING.cost,
      breedCost: BREEDING.cost,
      betMinStake: BETTING.minStake,
      betMaxStake: BETTING.maxStake,
      betWindowHours: BETTING.windowHours,
      restCureCost: REST_CURE.cost,
      restCureEnergy: REST_CURE.energy,
      restCureHealth: REST_CURE.health,
      restCureHours: REST_CURE.durationHours,
      restCureCooldownDays: REST_CURE.cooldownDays,
      restaurantName: PIGEON_RESTAURANT.name,
      restaurantPayout: PIGEON_RESTAURANT.payout,
      restaurantMoraleMin: PIGEON_RESTAURANT.moraleEnergyMin,
      restaurantMoraleMax: PIGEON_RESTAURANT.moraleEnergyMax,
    },
    missions: loft?.missions ?? [],
    streak: loft?.streak ?? 0,
    pendingEvent: loft?.pendingEvent ?? null,
    unreadNotifications: notificationsFor(db, user.id).unread,
    offers: offersFor(db, user.id),
  });
});

// --- Events (dilemmas) -----------------------------------------------------
app.post('/event/choose', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const result = chooseEvent(store, user.id, Number(body.choice) || 0);
  await store.persist();
  if (result.startsWith('!')) return c.json({ error: result.slice(1) }, 400);
  return c.json({ ok: true, result });
});

app.post('/loft/name', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = renameLoft(store, user.id, String(body.name ?? ''));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

// --- Prestige (badges, level, trophies) ------------------------------------
app.get('/profile', (c) => {
  const user = requireUser(c);
  const db = c.get('store').data;
  const profile = playerProfile(db, user.id);
  if (!profile) return c.json({ error: 'Geen hok gevonden' }, 404);
  return c.json(profile);
});

// --- Sponsors --------------------------------------------------------------
app.get('/sponsors', (c) => {
  const user = requireUser(c);
  const db = c.get('store').data;
  const loft = db.lofts.find((l) => l.userId === user.id);
  if (!loft) return c.json({ error: 'Geen hok gevonden' }, 404);
  return c.json(sponsorView(db, loft));
});

app.post('/sponsors/accept', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const result = acceptSponsor(store, user.id, String(body.sponsorId ?? ''), body.replace === true);
  await store.persist();
  if (result.startsWith('!')) return c.json({ error: result.slice(1) }, 400);
  return c.json({ ok: true, result });
});

app.post('/sponsors/refuse', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const result = refuseSponsor(store, user.id, String(body.sponsorId ?? ''));
  await store.persist();
  if (result.startsWith('!')) return c.json({ error: result.slice(1) }, 400);
  return c.json({ ok: true, result });
});

app.post('/sponsors/cancel', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const result = cancelSponsor(store, user.id, String(body.sponsorId ?? ''));
  await store.persist();
  if (result.startsWith('!')) return c.json({ error: result.slice(1) }, 400);
  return c.json({ ok: true, result });
});

// --- Notifications ---------------------------------------------------------
app.get('/notifications', (c) => {
  const user = requireUser(c);
  const db = c.get('store').data;
  return c.json(notificationsFor(db, user.id));
});

app.post('/notifications/read', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const ids: string[] | null = Array.isArray(body.ids) ? body.ids.map(String) : null;
  store.mutate((db) => {
    for (const n of db.notifications) {
      if (n.userId !== user.id) continue;
      if (ids === null || ids.includes(n.id)) n.read = true;
    }
  });
  await store.persist();
  return c.json(notificationsFor(store.data, user.id));
});

app.get('/pigeons/:id', (c) => {
  const user = requireUser(c);
  const db = c.get('store').data;
  const p = db.pigeons.find((x) => x.id === c.req.param('id'));
  if (!p) return c.json({ error: 'Duif niet gevonden' }, 404);
  const sire = p.sireId ? db.pigeons.find((x) => x.id === p.sireId) : null;
  const dam = p.damId ? db.pigeons.find((x) => x.id === p.damId) : null;
  return c.json({
    pigeon: pigeonDTO(db, p, user.id),
    sire: sire ? pigeonDTO(db, sire, user.id) : null,
    dam: dam ? pigeonDTO(db, dam, user.id) : null,
    mine: p.ownerId === user.id,
    history: pigeonRaceHistory(db, p.id),
  });
});

// --- Care ------------------------------------------------------------------
app.post('/pigeons/:id/ration', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = setPigeonRation(store, user.id, c.req.param('id'), String(body.ration ?? ''));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/pigeons/:id/compartment', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = setPigeonCompartment(store, user.id, c.req.param('id'), body.on === true);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/pigeons/:id/restcure', async (c) => {
  const user = requireUser(c);
  const store = c.get('store');
  const err = startRestCure(store, user.id, c.req.param('id'));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/loft/food', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const kg = Number(body.kg);
  if (!(kg > 0) || kg > 10000) return c.json({ error: 'Ongeldige hoeveelheid' }, 400);
  const store = c.get('store');
  const err = buyFood(store, user.id, String(body.type ?? 'normal'), kg);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/loft/capacity', async (c) => {
  const user = requireUser(c);
  const store = c.get('store');
  const err = upgradeCapacity(store, user.id);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/loft/compartment', async (c) => {
  const user = requireUser(c);
  const store = c.get('store');
  const err = buyCompartment(store, user.id);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/loft/infirmary/upgrade', async (c) => {
  const user = requireUser(c);
  const store = c.get('store');
  const err = upgradeInfirmary(store, user.id);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/pigeons/:id/coach', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = setCoach(store, user.id, c.req.param('id'), body.on === true);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/pigeons/:id/rename', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = renamePigeon(store, user.id, c.req.param('id'), String(body.name ?? ''));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/pigeons/:id/release', async (c) => {
  const user = requireUser(c);
  const store = c.get('store');
  const err = releasePigeon(store, user.id, c.req.param('id'));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/pigeons/:id/restaurant', async (c) => {
  const user = requireUser(c);
  const store = c.get('store');
  const err = sellToRestaurant(store, user.id, c.req.param('id'));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/pigeons/:id/train', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  if (!['speed', 'endurance', 'orientation'].includes(body.attr)) return c.json({ error: 'Ongeldige eigenschap' }, 400);
  const store = c.get('store');
  const err = trainPigeon(store, user.id, c.req.param('id'), body.attr);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

// --- Infirmary (ziekenboeg) ------------------------------------------------
app.post('/pigeons/:id/infirmary', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = setInfirmary(store, user.id, c.req.param('id'), body.in === true);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/loft/infirmary/medicated', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = setMedicatedFood(store, user.id, body.on === true);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

// Pin one infirmary bird to a doctor/physio slot (or release it). With more
// patients than slots the owner picks who gets treated — see setCareAssignment.
app.post('/pigeons/:id/care', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = setCareAssignment(store, user.id, c.req.param('id'), body.on === true);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/loft/infirmary/staff', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = setInfirmaryStaff(store, user.id, Number(body.doctors) || 0, Number(body.physios) || 0);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

// --- Breeding --------------------------------------------------------------
app.get('/breeding', (c) => {
  const user = requireUser(c);
  const db = c.get('store').data;
  const pairs = db.breedingPairs
    .filter((bp) => bp.ownerId === user.id)
    .map((bp) => ({
      id: bp.id,
      sire: db.pigeons.find((p) => p.id === bp.sireId)?.name ?? '?',
      dam: db.pigeons.find((p) => p.id === bp.damId)?.name ?? '?',
      hatchAt: bp.hatchAt,
    }));
  return c.json({ pairs });
});

app.post('/breeding', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = startBreeding(store, user.id, String(body.sireId ?? ''), String(body.damId ?? ''));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/breeding/:id/stop', async (c) => {
  const user = requireUser(c);
  const store = c.get('store');
  const err = stopBreeding(store, user.id, c.req.param('id'));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

// --- Market ----------------------------------------------------------------
app.get('/market', (c) => {
  const user = requireUser(c);
  const db = c.get('store').data;
  const botIds = new Set(db.lofts.filter((l) => l.isBot).map((l) => l.userId));
  const listings = db.pigeons
    .filter((p) => p.forSale && p.ownerId !== user.id)
    .map((p) => pigeonDTO(db, p, user.id))
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  // Every other real player's pigeon that is NOT already listed — you can make a
  // private offer on these (see offers.ts). For-sale ones are in `listings`.
  const biddable = db.pigeons
    .filter((p) => p.ownerId !== user.id && !botIds.has(p.ownerId) && !p.forSale)
    .map((p) => pigeonDTO(db, p, user.id))
    .sort((a, b) => b.talent - a.talent);
  return c.json({ listings, biddable, trades: recentTrades(db), auctions: auctionsDTO(db, user.id) });
});

app.post('/auction/bid', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = placeBid(store.data, user.id, String(body.auctionId ?? ''), Number(body.amount) || 0);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/market/list', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const price = Number(body.price);
  if (!(price > 0)) return c.json({ error: 'Ongeldige prijs' }, 400);
  const store = c.get('store');
  const err = listForSale(store, user.id, String(body.pigeonId ?? ''), price);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/market/unlist', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = unlist(store, user.id, String(body.pigeonId ?? ''));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/market/buy', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = buyPigeon(store, user.id, String(body.pigeonId ?? ''));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

// --- Private pigeon offers (bid on another player's bird) ------------------
app.post('/pigeons/:id/offer', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = makeOffer(store.data, user.id, c.req.param('id'), Number(body.amount) || 0);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/offers/:id/withdraw', async (c) => {
  const user = requireUser(c);
  const store = c.get('store');
  const err = withdrawOffer(store.data, user.id, c.req.param('id'));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/offers/:id/respond', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = respondOffer(store.data, user.id, c.req.param('id'), body.accept === true);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

// --- Flights ---------------------------------------------------------------
app.get('/flights', (c) => {
  requireUser(c);
  const db = c.get('store').data;
  const scheduled = db.flights
    .filter((f) => f.status === 'scheduled')
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((f) => flightDTO(db, f));
  const live = db.flights
    .filter((f) => f.status === 'live')
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((f) => flightDTO(db, f));
  const completed = db.flights
    .filter((f) => f.status === 'completed')
    .sort((a, b) => b.startAt.localeCompare(a.startAt) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20)
    .map((f) => flightDTO(db, f));
  return c.json({ scheduled, live, completed });
});

app.get('/flights/:id', (c) => {
  requireUser(c);
  const db = c.get('store').data;
  const f = db.flights.find((x) => x.id === c.req.param('id'));
  if (!f) return c.json({ error: 'Vlucht niet gevonden' }, 404);
  return c.json({ flight: flightDTO(db, f) });
});

/** Live positions + commentary for a flight (polled by the client). */
app.get('/flights/:id/live', (c) => {
  requireUser(c);
  const db = c.get('store').data;
  const f = db.flights.find((x) => x.id === c.req.param('id'));
  if (!f) return c.json({ error: 'Vlucht niet gevonden' }, 404);
  return c.json(liveFlightDTO(db, f, Date.now()));
});

app.post('/flights/:id/enter', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = enterFlight(store, user.id, c.req.param('id'), String(body.pigeonId ?? ''));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

// --- Betting ---------------------------------------------------------------
app.get('/bets', (c) => {
  const user = requireUser(c);
  const db = c.get('store').data;
  return c.json({ bets: betsView(db, user.id) });
});

app.post('/bets/preview', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const db = c.get('store').data;
  const flight = db.flights.find((f) => f.id === String(body.flightId ?? ''));
  if (!flight) return c.json({ error: 'Vlucht niet gevonden' }, 404);
  const res = previewBet(
    db, flight, user.id,
    String(body.kind ?? '') as BetKind,
    body.pigeonId ? String(body.pigeonId) : null,
    body.rivalId ? String(body.rivalId) : null,
    Number(body.stake) || 0,
  );
  if (typeof res === 'string') return c.json({ error: res.replace(/^!/, '') }, 400);
  return c.json(res);
});

app.post('/bets', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const res = placeBet(
    store.data, user.id,
    String(body.flightId ?? ''),
    String(body.kind ?? '') as BetKind,
    body.pigeonId ? String(body.pigeonId) : null,
    body.rivalId ? String(body.rivalId) : null,
    Number(body.stake) || 0,
    Date.now(),
  );
  await store.persist();
  if (typeof res === 'string') return c.json({ error: res.replace(/^!/, '') }, 400);
  return c.json({ ok: true, bet: res });
});

app.post('/flights/:id/withdraw', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = withdrawFlight(store, user.id, c.req.param('id'), String(body.pigeonId ?? ''));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

// Reorder your estafette team (which bird flies leg 1, 2 and 3) — allowed until
// the flight starts, so you can react to the per-leg forecast.
app.post('/flights/:id/relay-order', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const ids = Array.isArray(body.pigeonIds) ? body.pigeonIds.map((x: unknown) => String(x)) : [];
  const err = setRelayOrder(store, user.id, c.req.param('id'), ids);
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

app.post('/flights/:id/giveup', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = giveUpFlight(store, user.id, c.req.param('id'), String(body.pigeonId ?? ''));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

// --- Admin -----------------------------------------------------------------
/**
 * Diagnostics for the spelleider: recent auctions with the FULL bid list (who
 * bid what) and the real outcome, so it's clear whether others bid or only you,
 * and where a pigeon went (sold, or nobody could pay).
 */
app.get('/admin/auctions', (c) => {
  const user = requireUser(c);
  if (!user.isAdmin) return c.json({ error: 'Alleen de beheerder mag dit doen' }, 403);
  const db = c.get('store').data;
  const humanIds = new Set(db.lofts.filter((l) => !l.isBot).map((l) => l.userId));
  const rows = [...db.auctions]
    .sort((a, b) => b.endAt.localeCompare(a.endAt))
    .map((a) => {
      const p = db.pigeons.find((x) => x.id === a.pigeonId);
      const trade = [...db.trades]
        .filter((t) => t.pigeonId === a.pigeonId && (t.sellerName === 'Opvangcentrum' || t.sellerName === 'Veilinghuis'))
        .sort((x, y) => (x.at < y.at ? 1 : -1))[0];
      const bids = [...(a.bids ?? [])]
        .sort((x, y) => y.amount - x.amount)
        .map((b) => ({ name: b.name, amount: b.amount, human: humanIds.has(b.userId) }));
      let outcome: string;
      if (a.status === 'open') outcome = 'loopt nog';
      else if (trade) outcome = `verkocht aan ${trade.buyerName} voor €${trade.price}`;
      else if (bids.length === 0) outcome = 'gesloten zonder biedingen';
      else outcome = 'gesloten — geen geldige koper (niemand kon betalen of had plaats), duif vervallen';
      return {
        id: a.id,
        kind: auctionKind(a),
        pigeonName: p?.name ?? trade?.pigeonName ?? '(duif niet meer in systeem)',
        status: a.status,
        startAt: a.startAt,
        endAt: a.endAt,
        bidCount: bids.length,
        humanBidCount: bids.filter((b) => b.human).length,
        bids,
        outcome,
      };
    });
  return c.json({ auctions: rows });
});

app.post('/admin/advance-week', async (c) => {
  const user = requireUser(c);
  if (!user.isAdmin) return c.json({ error: 'Alleen de beheerder mag dit doen' }, 403);
  const store = c.get('store');
  const summary = advanceWeek(store);
  await store.persist();
  return c.json({ summary, world: store.data.world });
});

// --- Admin console: diagnostics ------------------------------------------

/** Recent completed flights, for the admin flight-analysis picker. */
app.get('/admin/flights', (c) => {
  const user = requireUser(c);
  if (!user.isAdmin) return c.json({ error: 'Alleen de beheerder mag dit doen' }, 403);
  const db = c.get('store').data;
  const flights = db.flights
    .filter((f) => f.status === 'completed' && f.results.length > 0)
    .sort((a, b) => (a.startAt < b.startAt ? 1 : -1))
    .slice(0, 60)
    .map((f) => ({
      id: f.id, name: f.name, fromCity: f.fromCity, toCity: f.toCity,
      distanceKm: f.distanceKm, startAt: f.startAt, entrants: f.results.length,
      practice: !!f.practice, titan: !!f.titan,
    }));
  return c.json({ flights });
});

/**
 * Admin pigeon inspector: the EXACT stored values of any pigeon (own or another
 * player's) — skills to 1 decimal, gene caps, birthWeek + real age, and the ageing
 * diagnostics. Lets an admin verify a bird isn't unfairly degrading: `aging` is only
 * true past AGING.peakEndWeeks, with `declinePerWeek` the exact points it then loses
 * per rolled game-week. Search by pigeon or owner name via ?q=.
 */
app.get('/admin/pigeons', (c) => {
  const user = requireUser(c);
  if (!user.isAdmin) return c.json({ error: 'Alleen de beheerder mag dit doen' }, 403);
  const db = c.get('store').data;
  const week = db.world.currentWeek;
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  let list = db.pigeons;
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || ownerName(db, p.ownerId).toLowerCase().includes(q));
  const total = list.length;
  const pigeons = list
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 100)
    .map((p) => {
      const age = ageInWeeks(p, week);
      const g = p.genes ?? null;
      const aging = age > AGING.peakEndWeeks;
      return {
        id: p.id,
        name: p.name,
        ownerName: ownerName(db, p.ownerId),
        isBot: db.lofts.find((l) => l.userId === p.ownerId)?.isBot ?? false,
        sex: p.sex,
        birthWeek: p.birthWeek,
        currentWeek: week,
        ageWeeks: age,
        // Exact stored values (1 decimal) — what the UI rounds for display.
        speed: p.speed, endurance: p.endurance, orientation: p.orientation,
        libido: p.libido, form: p.form, health: p.health, experience: p.experience,
        genes: g,
        declineRate: p.declineRate ?? null,
        // Ageing: is this bird old enough to lose skills, and how much per rolled week?
        aging,
        declinePerWeek: aging
          ? Math.round(AGING.declinePerWeekBase * ((age - AGING.peakEndWeeks) / 52) * (p.declineRate ?? 1) * 1000) / 1000
          : 0,
        atGeneCap: g
          ? { speed: p.speed >= g.speed, endurance: p.endurance >= g.endurance, orientation: p.orientation >= g.orientation }
          : null,
        // Audit trail of skill changes (newest first) — the "was it lowered, how?" answer.
        attrLog: (p.attrLog ?? []).slice(-20).reverse(),
      };
    });
  return c.json({
    pigeons,
    total,
    caps: { train: GENE.trainCap, race: GENE.raceCap, ceil: GENE.ceil, peakEndWeeks: AGING.peakEndWeeks },
  });
});

/**
 * Full velocity breakdown per participating pigeon of a flight: the attributes,
 * the distance weighting, and every multiplier (energie/gezondheid/ervaring/
 * leeftijd/weer) that produced its race speed. Energie is the value the bird had
 * AT RELEASE (frozen `startForm`); the other attributes are read from the bird's
 * current state, so they can differ slightly if it has trained/aged since.
 */
app.get('/admin/flight-analysis/:id', (c) => {
  const user = requireUser(c);
  if (!user.isAdmin) return c.json({ error: 'Alleen de beheerder mag dit doen' }, 403);
  const db = c.get('store').data;
  const f = db.flights.find((x) => x.id === c.req.param('id'));
  if (!f) return c.json({ error: 'Vlucht niet gevonden' }, 404);

  const week = f.week;
  const wf = f.weatherFactor ?? 1;
  const resultOf = new Map(f.results.map((r) => [r.pigeonId, r]));
  const source: any[] = f.sim.length
    ? f.sim
    : f.entries.map((e) => ({ pigeonId: e.pigeonId, ownerId: e.ownerId, velocity: null, startForm: null, ownerName: ownerName(db, e.ownerId) }));

  const rows = source.map((s) => {
    const p = db.pigeons.find((x) => x.id === s.pigeonId);
    const res = resultOf.get(s.pigeonId);
    const raceForm: number | null = s.startForm ?? p?.form ?? null;
    const breakdown = p ? velocityBreakdown(p, f.distanceKm, week, wf, raceForm ?? undefined) : null;
    const frozenVelocity: number | null = s.velocity ?? res?.velocity ?? null;
    // Frozen velocity ÷ recomputed (luck=1) ≈ the per-bird luck draw (×0.9–1.1),
    // plus any attribute drift since the race.
    const residual = breakdown && frozenVelocity && breakdown.velocityNoLuck
      ? Math.round((frozenVelocity / breakdown.velocityNoLuck) * 1000) / 1000
      : null;
    return {
      pigeonId: s.pigeonId,
      name: p?.name ?? s.pigeonName ?? 'duif',
      ownerName: s.ownerName ?? ownerName(db, s.ownerId),
      mine: s.ownerId === user.id,
      exists: !!p,
      speed: p?.speed ?? null,
      endurance: p?.endurance ?? null,
      orientation: p?.orientation ?? null,
      raceForm,
      currentForm: p?.form ?? null,
      health: p?.health ?? null,
      experience: p?.experience ?? null,
      ageWeeks: p ? ageInWeeks(p, week) : null,
      breakdown,
      frozenVelocity,
      residual,
      rank: res?.rank ?? null,
      finished: res ? res.finished !== false : null,
      timeSeconds: res?.timeSeconds ?? null,
    };
  }).sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));

  return c.json({
    flight: {
      id: f.id, name: f.name, fromCity: f.fromCity, toCity: f.toCity, distanceKm: f.distanceKm,
      startAt: f.startAt, weather: f.weather, weatherFactor: wf, status: f.status,
      practice: !!f.practice, titan: !!f.titan, week,
    },
    weights: weightsForDistance(f.distanceKm),
    rows,
  });
});

export const onRequest = handle(app);
