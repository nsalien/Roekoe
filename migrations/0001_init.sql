-- Roekoe D1 schema. Applied with:
--   npx wrangler d1 migrations apply roekoe-db        (remote)
--   npx wrangler d1 migrations apply roekoe-db --local (local dev)

CREATE TABLE IF NOT EXISTS world (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  current_week INTEGER NOT NULL,
  season_year  INTEGER NOT NULL,
  seeded       INTEGER NOT NULL DEFAULT 0,
  data_version INTEGER NOT NULL DEFAULT 0,
  last_daily_tick TEXT NOT NULL DEFAULT '',
  last_shelter_spawn TEXT NOT NULL DEFAULT '',
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
  is_bot        INTEGER NOT NULL DEFAULT 0,
  infirmary_capacity INTEGER NOT NULL DEFAULT 4,
  medicated_food     INTEGER NOT NULL DEFAULT 0,
  doctors            INTEGER NOT NULL DEFAULT 0,
  physios            INTEGER NOT NULL DEFAULT 0,
  xp                 INTEGER NOT NULL DEFAULT 0,
  level              INTEGER NOT NULL DEFAULT 1,
  stats              TEXT NOT NULL DEFAULT '',
  badges             TEXT NOT NULL DEFAULT '',
  missions           TEXT NOT NULL DEFAULT '',
  missions_day       TEXT NOT NULL DEFAULT '',
  streak             INTEGER NOT NULL DEFAULT 0,
  pending_event      TEXT NOT NULL DEFAULT '',
  sponsorship        TEXT NOT NULL DEFAULT ''
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
  libido         REAL NOT NULL DEFAULT 50,
  form           REAL NOT NULL,
  health         REAL NOT NULL,
  experience     REAL NOT NULL,
  sire_id        TEXT,
  dam_id         TEXT,
  for_sale       INTEGER NOT NULL DEFAULT 0,
  price          INTEGER,
  created_at_week INTEGER NOT NULL,
  retired        INTEGER NOT NULL DEFAULT 0,
  ailment        TEXT NOT NULL DEFAULT '',
  in_infirmary   INTEGER NOT NULL DEFAULT 0,
  races          INTEGER NOT NULL DEFAULT 0,
  ever_ailed     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pigeons_owner ON pigeons (owner_id);

CREATE TABLE IF NOT EXISTS breeding_pairs (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL,
  sire_id        TEXT NOT NULL,
  dam_id         TEXT NOT NULL,
  hatch_week     INTEGER NOT NULL,
  hatch_at       TEXT NOT NULL DEFAULT '',
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
  recap         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flights_status ON flights (status);
CREATE INDEX IF NOT EXISTS idx_flights_week ON flights (week);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  flight_id  TEXT,
  created_at TEXT NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id);

CREATE TABLE IF NOT EXISTS trades (
  id          TEXT PRIMARY KEY,
  pigeon_id   TEXT NOT NULL,
  pigeon_name TEXT NOT NULL,
  seller_id   TEXT NOT NULL,
  seller_name TEXT NOT NULL,
  buyer_id    TEXT NOT NULL,
  buyer_name  TEXT NOT NULL,
  price       INTEGER NOT NULL,
  at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auctions (
  id                  TEXT PRIMARY KEY,
  template_key        TEXT NOT NULL,
  pigeon_id           TEXT NOT NULL,
  start_at            TEXT NOT NULL,
  end_at              TEXT NOT NULL,
  min_bid             INTEGER NOT NULL,
  min_increment       INTEGER NOT NULL,
  current_bid         INTEGER NOT NULL DEFAULT 0,
  current_bidder_id   TEXT,
  current_bidder_name TEXT,
  status              TEXT NOT NULL
);
