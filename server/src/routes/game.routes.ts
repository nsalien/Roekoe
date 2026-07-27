/** All authenticated gameplay endpoints: state, care, training, market, flights. */

import { Router } from 'express';
import { z } from 'zod';
import type { Store } from '../db/store.js';
import { requireAuth, requireAdmin, type AuthedRequest } from '../auth/auth.js';
import {
  advanceWeek,
  buyFood,
  buyPigeon,
  enterFlight,
  listForSale,
  NPC_OWNER_ID,
  startBreeding,
  trainPigeon,
  unlist,
  withdrawFlight,
} from '../game/engine.js';
import { FEED_RATIONS, FLIGHT_TEMPLATES } from '../config/gameConfig.js';
import { flightDTO, loftDTO, pigeonDTO, rankingRows } from './presenters.js';

/** Fail helper: run an engine action that returns an error string or null. */
function run(res: import('express').Response, err: string | null, ok: object = { ok: true }) {
  if (err) res.status(400).json({ error: err });
  else res.json(ok);
}

export function gameRoutes(store: Store): Router {
  const router = Router();
  router.use(requireAuth);

  // --- World + my dashboard state -----------------------------------------
  router.get('/state', (req: AuthedRequest, res) => {
    const db = store.data;
    const userId = req.user!.id;
    const loft = db.lofts.find((l) => l.userId === userId);
    const myPigeons = db.pigeons
      .filter((p) => p.ownerId === userId)
      .map((p) => pigeonDTO(db, p))
      .sort((a, b) => b.talent - a.talent);
    const scheduled = db.flights
      .filter((f) => f.status === 'scheduled')
      .map((f) => flightDTO(db, f));
    res.json({
      world: db.world,
      isAdmin: req.user!.isAdmin,
      loft: loft ? loftDTO(db, loft) : null,
      pigeons: myPigeons,
      scheduledFlights: scheduled,
      rankings: rankingRows(db),
      feedRations: FEED_RATIONS,
      flightTemplates: FLIGHT_TEMPLATES,
    });
  });

  router.get('/pigeons/:id', (req: AuthedRequest, res) => {
    const db = store.data;
    const p = db.pigeons.find((x) => x.id === req.params.id);
    if (!p) return void res.status(404).json({ error: 'Duif niet gevonden' });
    const dto = pigeonDTO(db, p);
    const sire = p.sireId ? db.pigeons.find((x) => x.id === p.sireId) : null;
    const dam = p.damId ? db.pigeons.find((x) => x.id === p.damId) : null;
    res.json({
      pigeon: dto,
      sire: sire ? pigeonDTO(db, sire) : null,
      dam: dam ? pigeonDTO(db, dam) : null,
      mine: p.ownerId === req.user!.id,
    });
  });

  // --- Care ----------------------------------------------------------------
  router.post('/loft/ration', (req: AuthedRequest, res) => {
    const schema = z.object({ ration: z.enum(['low', 'normal', 'high']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Ongeldige keuze' });
    store.mutate((db) => {
      const loft = db.lofts.find((l) => l.userId === req.user!.id);
      if (loft) loft.feedRation = parsed.data.ration;
    });
    res.json({ ok: true });
  });

  router.post('/loft/food', (req: AuthedRequest, res) => {
    const schema = z.object({ kg: z.number().positive().max(10000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Ongeldige hoeveelheid' });
    run(res, buyFood(store, req.user!.id, parsed.data.kg));
  });

  router.post('/pigeons/:id/train', (req: AuthedRequest, res) => {
    const schema = z.object({ attr: z.enum(['speed', 'endurance', 'orientation']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Ongeldige eigenschap' });
    run(res, trainPigeon(store, req.user!.id, req.params.id, parsed.data.attr));
  });

  // --- Breeding ------------------------------------------------------------
  router.get('/breeding', (req: AuthedRequest, res) => {
    const db = store.data;
    const mine = db.breedingPairs
      .filter((bp) => bp.ownerId === req.user!.id)
      .map((bp) => ({
        id: bp.id,
        sire: db.pigeons.find((p) => p.id === bp.sireId)?.name ?? '?',
        dam: db.pigeons.find((p) => p.id === bp.damId)?.name ?? '?',
        hatchWeek: bp.hatchWeek,
        weeksLeft: Math.max(0, bp.hatchWeek - db.world.currentWeek),
      }));
    res.json({ pairs: mine });
  });

  router.post('/breeding', (req: AuthedRequest, res) => {
    const schema = z.object({ sireId: z.string(), damId: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Ongeldige keuze' });
    run(res, startBreeding(store, req.user!.id, parsed.data.sireId, parsed.data.damId));
  });

  // --- Market --------------------------------------------------------------
  router.get('/market', (req: AuthedRequest, res) => {
    const db = store.data;
    const listings = db.pigeons
      .filter((p) => p.forSale && p.ownerId !== req.user!.id)
      .map((p) => ({ ...pigeonDTO(db, p), fromNpc: p.ownerId === NPC_OWNER_ID }))
      .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    res.json({ listings });
  });

  router.post('/market/list', (req: AuthedRequest, res) => {
    const schema = z.object({ pigeonId: z.string(), price: z.number().positive().max(1_000_000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Ongeldige gegevens' });
    run(res, listForSale(store, req.user!.id, parsed.data.pigeonId, parsed.data.price));
  });

  router.post('/market/unlist', (req: AuthedRequest, res) => {
    const schema = z.object({ pigeonId: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Ongeldige gegevens' });
    run(res, unlist(store, req.user!.id, parsed.data.pigeonId));
  });

  router.post('/market/buy', (req: AuthedRequest, res) => {
    const schema = z.object({ pigeonId: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Ongeldige gegevens' });
    run(res, buyPigeon(store, req.user!.id, parsed.data.pigeonId));
  });

  // --- Flights -------------------------------------------------------------
  router.get('/flights', (req: AuthedRequest, res) => {
    const db = store.data;
    const scheduled = db.flights
      .filter((f) => f.status === 'scheduled')
      .map((f) => flightDTO(db, f));
    const completed = db.flights
      .filter((f) => f.status === 'completed')
      .sort((a, b) => b.week - a.week || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((f) => flightDTO(db, f));
    res.json({ scheduled, completed });
  });

  router.get('/flights/:id', (req: AuthedRequest, res) => {
    const db = store.data;
    const f = db.flights.find((x) => x.id === req.params.id);
    if (!f) return void res.status(404).json({ error: 'Vlucht niet gevonden' });
    res.json({ flight: flightDTO(db, f) });
  });

  router.post('/flights/:id/enter', (req: AuthedRequest, res) => {
    const schema = z.object({ pigeonId: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Ongeldige gegevens' });
    run(res, enterFlight(store, req.user!.id, req.params.id, parsed.data.pigeonId));
  });

  router.post('/flights/:id/withdraw', (req: AuthedRequest, res) => {
    const schema = z.object({ pigeonId: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: 'Ongeldige gegevens' });
    run(res, withdrawFlight(store, req.user!.id, req.params.id, parsed.data.pigeonId));
  });

  // --- Admin: advance the world by one week --------------------------------
  router.post('/admin/advance-week', requireAdmin, (_req, res) => {
    const summary = advanceWeek(store);
    res.json({ summary, world: store.data.world });
  });

  return router;
}
