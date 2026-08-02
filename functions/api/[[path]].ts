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

import { D1Store, ensureSchema } from '../../core/d1.js';
import type { User } from '../../core/schema.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from '../../core/auth.js';
import { newId } from '../../core/store.js';
import {
  BETTING,
  BREEDING,
  COACH,
  FEED_RATIONS,
  INFIRMARY,
  REST_CURE,
  RENAME_COST,
  RENAME_LOFT_COST,
  TRAINING,
  DAILY_UPKEEP_BASE,
  DAILY_UPKEEP_PER_PIGEON,
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
  renameLoft,
  renamePigeon,
  seedWorld,
  setCoach,
  setInfirmary,
  setInfirmaryStaff,
  setMedicatedFood,
  setPigeonCompartment,
  setPigeonRation,
  startBreeding,
  startRestCure,
  stopBreeding,
  trainPigeon,
  unlist,
  upgradeCapacity,
  upgradeInfirmary,
  withdrawFlight,
} from '../../core/game/engine.js';
import { advanceRealtime, flightsAwaitingStart } from '../../core/game/schedule.js';
import { pigeonSeasonRankings } from '../../core/game/season.js';
import { velocityBreakdown, weightsForDistance } from '../../core/game/flight.js';
import { ageInWeeks } from '../../core/game/pigeon.js';
import { ownerName } from '../../core/game/engine.js';
import { fetchFlightWeather, type WeatherResult } from '../../core/game/weather.js';
import { auctionKind, placeBid } from '../../core/game/auction.js';
import { betsView, placeBet, previewBet } from '../../core/game/betting.js';
import type { BetKind } from '../../core/schema.js';
import { refreshDailyMissions } from '../../core/game/missions.js';
import { evaluateSponsorOffers, sponsorView } from '../../core/game/sponsors.js';
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
  if (!schemaReady) {
    await ensureSchema(c.env.DB);
    schemaReady = true;
  }
  let store = await D1Store.load(c.env.DB);
  if (!store.data.world.seeded) {
    seedWorld(store);
    await store.persist();
    store = await D1Store.load(c.env.DB); // fresh snapshots for any later write
  }
  // Real-time flight lifecycle + one-time data migrations. Persist any changes.
  const nowMs = Date.now();
  // Fetch real weather for any flight about to start, so it's frozen against
  // actual conditions in the release region (falls back to a random sky).
  const due = flightsAwaitingStart(store.data, nowMs);
  const weatherByFlight = new Map<string, WeatherResult>();
  for (const f of due) {
    weatherByFlight.set(f.id, await fetchFlightWeather(f.fromCity, f.toCity));
  }
  advanceRealtime(store.data, nowMs, weatherByFlight);
  await store.persist();
  c.set('store', store);

  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const payload = await verifyToken(auth.slice(7), c.env.JWT_SECRET);
    if (payload) {
      const user = store.data.users.find((u) => u.id === payload.sub);
      if (user) {
        c.set('user', user);
        // Per-user: roll over daily missions/streak (and maybe a dilemma), and
        // let sponsors make new offers when the loft has earned their interest.
        const loft = store.data.lofts.find((l) => l.userId === user.id);
        if (loft) {
          let dirty = refreshDailyMissions(store.data, loft, nowMs);
          if (evaluateSponsorOffers(store.data, loft, nowMs)) dirty = true;
          if (dirty) await store.persist();
        }
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

app.get('/health', (c) => {
  const db = c.get('store').data;
  return c.json({ ok: true, week: db.world.currentWeek, players: db.users.filter((u) => !u.isBot).length });
});

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
  const store = c.get('store');
  const user = store.data.users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase() && !u.isBot,
  );
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
    .map((p) => pigeonDTO(db, p))
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
      dailyUpkeepBase: DAILY_UPKEEP_BASE,
      dailyUpkeepPerPigeon: DAILY_UPKEEP_PER_PIGEON,
      trainCost: TRAINING.cost,
      breedCost: BREEDING.cost,
      betMinStake: BETTING.minStake,
      betMaxStake: BETTING.maxStake,
      betWindowHours: BETTING.windowHours,
      restCureCost: REST_CURE.cost,
      restCureEnergy: REST_CURE.energy,
      restCureHours: REST_CURE.durationHours,
    },
    missions: loft?.missions ?? [],
    streak: loft?.streak ?? 0,
    pendingEvent: loft?.pendingEvent ?? null,
    unreadNotifications: notificationsFor(db, user.id).unread,
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
    pigeon: pigeonDTO(db, p),
    sire: sire ? pigeonDTO(db, sire) : null,
    dam: dam ? pigeonDTO(db, dam) : null,
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
  const listings = db.pigeons
    .filter((p) => p.forSale && p.ownerId !== user.id)
    .map((p) => pigeonDTO(db, p))
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  return c.json({ listings, trades: recentTrades(db), auctions: auctionsDTO(db) });
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
