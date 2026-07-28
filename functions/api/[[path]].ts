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
import { FEED_RATIONS } from '../../core/config/gameConfig.js';
import {
  advanceWeek,
  buyFood,
  buyPigeon,
  createLoftForUser,
  enterFlight,
  listForSale,
  NPC_OWNER_ID,
  seedWorld,
  startBreeding,
  trainPigeon,
  unlist,
  withdrawFlight,
} from '../../core/game/engine.js';
import { advanceRealtime } from '../../core/game/schedule.js';
import { flightDTO, liveFlightDTO, loftDTO, pigeonDTO, rankingRows } from '../../core/presenters.js';

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
  advanceRealtime(store.data, Date.now());
  await store.persist();
  c.set('store', store);

  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const payload = await verifyToken(auth.slice(7), c.env.JWT_SECRET);
    if (payload) {
      const user = store.data.users.find((u) => u.id === payload.sub);
      if (user) c.set('user', user);
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
    feedRations: FEED_RATIONS,
  });
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
  });
});

// --- Care ------------------------------------------------------------------
app.post('/loft/ration', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  if (!['low', 'normal', 'high'].includes(body.ration)) return c.json({ error: 'Ongeldige keuze' }, 400);
  const store = c.get('store');
  store.mutate((db) => {
    const loft = db.lofts.find((l) => l.userId === user.id);
    if (loft) loft.feedRation = body.ration;
  });
  await store.persist();
  return c.json({ ok: true });
});

app.post('/loft/food', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const kg = Number(body.kg);
  if (!(kg > 0) || kg > 10000) return c.json({ error: 'Ongeldige hoeveelheid' }, 400);
  const store = c.get('store');
  const err = buyFood(store, user.id, kg);
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
      hatchWeek: bp.hatchWeek,
      weeksLeft: Math.max(0, bp.hatchWeek - db.world.currentWeek),
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

// --- Market ----------------------------------------------------------------
app.get('/market', (c) => {
  const user = requireUser(c);
  const db = c.get('store').data;
  const listings = db.pigeons
    .filter((p) => p.forSale && p.ownerId !== user.id)
    .map((p) => ({ ...pigeonDTO(db, p), fromNpc: p.ownerId === NPC_OWNER_ID }))
    .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  return c.json({ listings });
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

app.post('/flights/:id/withdraw', async (c) => {
  const user = requireUser(c);
  const body = await c.req.json().catch(() => ({}));
  const store = c.get('store');
  const err = withdrawFlight(store, user.id, c.req.param('id'), String(body.pigeonId ?? ''));
  await store.persist();
  return err ? c.json({ error: err }, 400) : c.json({ ok: true });
});

// --- Admin -----------------------------------------------------------------
app.post('/admin/advance-week', async (c) => {
  const user = requireUser(c);
  if (!user.isAdmin) return c.json({ error: 'Alleen de beheerder mag dit doen' }, 403);
  const store = c.get('store');
  const summary = advanceWeek(store);
  await store.persist();
  return c.json({ summary, world: store.data.world });
});

export const onRequest = handle(app);
