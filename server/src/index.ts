/**
 * Roekoe game server.
 *
 * Boots the JSON-backed store, seeds the world (bots, first flights, market)
 * on first run, wires up the REST API and starts listening. In production it
 * can also serve the built client from ../client/dist.
 */

import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { Store } from './db/store.js';
import { authMiddleware } from './auth/auth.js';
import { authRoutes } from './routes/auth.routes.js';
import { gameRoutes } from './routes/game.routes.js';
import { seedWorld } from './game/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 4000);
const DATA_DIR = process.env.DATA_DIR ?? './data';

const store = new Store(DATA_DIR);
seedWorld(store);

const app = express();
app.use(cors());
app.use(express.json());
app.use(authMiddleware(store));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, week: store.data.world.currentWeek, players: store.data.users.filter((u) => !u.isBot).length });
});

app.use('/api/auth', authRoutes(store));
app.use('/api', gameRoutes(store));

// Serve the built client if it exists (single-deployment mode).
const clientDist = join(__dirname, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(clientDist, 'index.html'));
  });
}

const server = app.listen(PORT, () => {
  console.log(`🕊️  Roekoe-server draait op http://localhost:${PORT}`);
  console.log(`    Week ${store.data.world.currentWeek}, seizoen ${store.data.world.seasonYear}`);
});

// Persist on shutdown so nothing is lost.
function shutdown() {
  console.log('\nAfsluiten, database opslaan...');
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
