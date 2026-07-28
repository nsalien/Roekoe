-- Roekoe D1 schema. Applied with:
--   npx wrangler d1 migrations apply roekoe-db        (remote)
--   npx wrangler d1 migrations apply roekoe-db --local (local dev)

CREATE TABLE IF NOT EXISTS world (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  current_week INTEGER NOT NULL,
  season_year  INTEGER NOT NULL,
  seeded       INTEGER NOT NULL DEFAULT 0,
  data_version INTEGER NOT NULL DEFAULT 0,
  version      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_bot        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

CREATE TABLE IF NOT EXISTS lofts (
  user_id       TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  money         REAL NOT NULL,
  food          REAL NOT NULL,
  feed_ration   TEXT NOT NULL,
  capacity      INTEGER NOT NULL,
  season_points INTEGER NOT NULL DEFAULT 0,
  total_wins    INTEGER NOT NULL DEFAULT 0,
  is_bot        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pigeons (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL,
  name           TEXT NOT NULL,
  sex            TEXT NOT NULL,
  birth_week     INTEGER NOT NULL,
  speed          REAL NOT NULL,
  endurance      REAL NOT NULL,
  orientation    REAL NOT NULL,
  form           REAL NOT NULL,
  health         REAL NOT NULL,
  experience     REAL NOT NULL,
  sire_id        TEXT,
  dam_id         TEXT,
  for_sale       INTEGER NOT NULL DEFAULT 0,
  price          INTEGER,
  created_at_week INTEGER NOT NULL,
  retired        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pigeons_owner ON pigeons (owner_id);

CREATE TABLE IF NOT EXISTS breeding_pairs (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL,
  sire_id        TEXT NOT NULL,
  dam_id         TEXT NOT NULL,
  hatch_week     INTEGER NOT NULL,
  created_at_week INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS flights (
  id            TEXT PRIMARY KEY,
  week          INTEGER NOT NULL,
  template_key  TEXT NOT NULL,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,
  distance_km   INTEGER NOT NULL,
  entry_fee     INTEGER NOT NULL,
  from_city     TEXT NOT NULL DEFAULT '',
  to_city       TEXT NOT NULL DEFAULT '',
  start_at      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL,
  entries       TEXT NOT NULL DEFAULT '[]',
  sim           TEXT NOT NULL DEFAULT '[]',
  weather       TEXT NOT NULL DEFAULT '',
  weather_factor REAL NOT NULL DEFAULT 1,
  results       TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flights_status ON flights (status);
CREATE INDEX IF NOT EXISTS idx_flights_week ON flights (week);
