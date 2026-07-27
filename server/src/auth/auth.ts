/**
 * Authentication: password hashing, JWT session tokens and an Express
 * middleware that resolves the current user from the Authorization header.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { Store } from '../db/store.js';
import type { User } from '../db/schema.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TOKEN_TTL = '30d';

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(user: User): string {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

export interface AuthedRequest extends Request {
  user?: User;
}

/**
 * Express middleware factory. Attaches `req.user` when a valid bearer token is
 * present. Does not reject on its own — combine with `requireAuth`.
 */
export function authMiddleware(store: Store) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length);
      try {
        const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
        const user = store.data.users.find((u) => u.id === payload.sub);
        if (user) req.user = user;
      } catch {
        // invalid/expired token -> stay anonymous
      }
    }
    next();
  };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Niet ingelogd' });
    return;
  }
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Niet ingelogd' });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: 'Alleen de beheerder mag dit doen' });
    return;
  }
  next();
}
