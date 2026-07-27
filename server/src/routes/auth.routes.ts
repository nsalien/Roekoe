/** Registration, login and "who am I" endpoints. */

import { Router } from 'express';
import { z } from 'zod';
import type { Store } from '../db/store.js';
import { newId } from '../db/store.js';
import type { User } from '../db/schema.js';
import { hashPassword, signToken, verifyPassword, requireAuth, type AuthedRequest } from '../auth/auth.js';
import { createLoftForUser } from '../game/engine.js';
import { loftDTO } from './presenters.js';

const credsSchema = z.object({
  username: z.string().trim().min(2).max(24),
  password: z.string().min(4).max(200),
  loftName: z.string().trim().min(2).max(40).optional(),
  inviteCode: z.string().optional(),
});

export function authRoutes(store: Store): Router {
  const router = Router();
  const INVITE_CODE = process.env.INVITE_CODE ?? '';
  const ADMIN_USERS = (process.env.ADMIN_USERS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  router.post('/register', (req, res) => {
    const parsed = credsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ongeldige gegevens (gebruikersnaam min. 2, wachtwoord min. 4 tekens)' });
      return;
    }
    const { username, password, loftName, inviteCode } = parsed.data;

    if (INVITE_CODE && inviteCode !== INVITE_CODE) {
      res.status(403).json({ error: 'Verkeerde uitnodigingscode' });
      return;
    }

    const existing = store.data.users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase(),
    );
    if (existing) {
      res.status(409).json({ error: 'Deze gebruikersnaam bestaat al' });
      return;
    }

    const humanCount = store.data.users.filter((u) => !u.isBot).length;
    const isAdmin = humanCount === 0 || ADMIN_USERS.includes(username.toLowerCase());

    const user: User = {
      id: newId('usr'),
      username,
      passwordHash: hashPassword(password),
      isAdmin,
      isBot: false,
      createdAt: new Date().toISOString(),
    };
    store.mutate((db) => db.users.push(user));
    createLoftForUser(store, user, loftName?.trim() || `Hok ${username}`);

    const token = signToken(user);
    const loft = store.data.lofts.find((l) => l.userId === user.id)!;
    res.json({
      token,
      user: { id: user.id, username: user.username, isAdmin: user.isAdmin },
      loft: loftDTO(store.data, loft),
    });
  });

  router.post('/login', (req, res) => {
    const parsed = credsSchema.pick({ username: true, password: true }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ongeldige gegevens' });
      return;
    }
    const { username, password } = parsed.data;
    const user = store.data.users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase() && !u.isBot,
    );
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Verkeerde gebruikersnaam of wachtwoord' });
      return;
    }
    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username, isAdmin: user.isAdmin } });
  });

  router.get('/me', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    res.json({ id: user.id, username: user.username, isAdmin: user.isAdmin });
  });

  return router;
}
