# Roekoe online zetten — vanaf je telefoon (geen computer nodig)

Alles hieronder kan in de browser van je telefoon. Je hoeft **geen enkel bestand
te bewerken** en geen commando's te typen. Je regelt alles in het
Cloudflare-dashboard.

> Belangrijk: er staat **expres geen `wrangler.toml`** in deze repo. Als die er
> wél stond, zou Cloudflare Pages alle instellingen uit het dashboard negeren
> (en zou je login stukgaan). Nu is het dashboard de baas — precies wat we willen
> voor telefoon-only.

Duur: ~10 minuten.

---

## 1. Cloudflare-account
Ga naar **dash.cloudflare.com** en log in (of maak een gratis account).

## 2. Maak de database (D1)
1. Menu links: **Workers & Pages → D1 SQL Database → Create**.
2. Naam: `roekoe-db` → **Create**.

## 3. Maak de tabellen aan
1. Open `roekoe-db` → tabblad **Console** (of "Query").
2. Plak onderstaande SQL en klik **Execute / Run**:

```sql
CREATE TABLE IF NOT EXISTS world (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_week INTEGER NOT NULL,
  season_year INTEGER NOT NULL,
  seeded INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_bot INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE TABLE IF NOT EXISTS lofts (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  money REAL NOT NULL,
  food REAL NOT NULL,
  feed_ration TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  season_points INTEGER NOT NULL DEFAULT 0,
  total_wins INTEGER NOT NULL DEFAULT 0,
  is_bot INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pigeons (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sex TEXT NOT NULL,
  birth_week INTEGER NOT NULL,
  speed REAL NOT NULL,
  endurance REAL NOT NULL,
  orientation REAL NOT NULL,
  form REAL NOT NULL,
  health REAL NOT NULL,
  experience REAL NOT NULL,
  sire_id TEXT,
  dam_id TEXT,
  for_sale INTEGER NOT NULL DEFAULT 0,
  price INTEGER,
  created_at_week INTEGER NOT NULL,
  retired INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pigeons_owner ON pigeons (owner_id);
CREATE TABLE IF NOT EXISTS breeding_pairs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  sire_id TEXT NOT NULL,
  dam_id TEXT NOT NULL,
  hatch_week INTEGER NOT NULL,
  created_at_week INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  week INTEGER NOT NULL,
  template_key TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  distance_km INTEGER NOT NULL,
  entry_fee INTEGER NOT NULL,
  status TEXT NOT NULL,
  entries TEXT NOT NULL DEFAULT '[]',
  weather TEXT NOT NULL DEFAULT '',
  weather_factor REAL NOT NULL DEFAULT 1,
  results TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flights_status ON flights (status);
CREATE INDEX IF NOT EXISTS idx_flights_week ON flights (week);
```

Je hoeft dit maar één keer te doen.

## 4. Maak het Pages-project
1. **Workers & Pages → Create → Pages → Connect to Git**.
2. Kies de repo **nsalien/roekoe** (geef Cloudflare toegang als het daarom vraagt).
3. **Production branch**: `claude/roekoe-game-website-jwa0vo`.
4. Build-instellingen:
   - **Framework preset**: None
   - **Build command**: `npm run build`
   - **Build output directory**: `client/dist`
5. Klik **Save and Deploy**. De eerste build draait (~1-2 min). Hij werkt nog niet
   helemaal tot je stap 5 hebt gedaan — dat is normaal.

## 5. Koppel de database + zet het geheim
Ga naar je nieuwe project → **Settings**.

1. **Bindings** (of "Functions → D1 database bindings") → **Add**:
   - Variable name: `DB`  *(exact zo, hoofdletters)*
   - D1 database: `roekoe-db`
2. **Variables and Secrets → Add**:
   - Name: `JWT_SECRET` — Value: een lange willekeurige tekst (verzin iets van 30+
     tekens) — type: **Secret / Encrypt**. *(Verplicht: zonder dit werkt inloggen niet.)*
   - Name: `INVITE_CODE` — Value: bv. `roekoe-vrienden` — type: gewone (Plaintext).
     Dit is de code die je vrienden nodig hebben om te registreren. Leeg = iedereen mag.
   - (optioneel) `ADMIN_USERS` — komma-gescheiden gebruikersnamen die ook beheerder zijn.

## 6. Opnieuw deployen
Ga naar **Deployments → (laatste) → Retry deployment** (of push desnoods een klein
wijzigingetje). Dit is nodig zodat de binding + het geheim actief worden.

## 7. Spelen 🎉
Open het adres `https://<jouw-project>.pages.dev` op je telefoon.
- **Registreer** als eerste — jij wordt automatisch **beheerder**.
- Deel het adres + de `INVITE_CODE` met je vrienden zodat ze zich kunnen aanmelden.
- Als beheerder klik je bovenaan op **Volgende week** om alle vluchten te vliegen,
  duiven te voeren en jongen geboren te laten worden.

---

## Werkt het niet?
- **Login/registreren geeft een fout** → is `JWT_SECRET` gezet als Secret, en heb je
  daarna opnieuw gedeployed (stap 6)?
- **"no such table"** → stap 3 (SQL) is niet (goed) uitgevoerd op `roekoe-db`.
- **Witte pagina / build faalt** → check dat build command `npm run build` en output
  `client/dist` zijn, en dat de branch klopt.
- **Vrienden kunnen niet registreren** → ze hebben de juiste `INVITE_CODE` nodig.

## Later een update uitrollen
Elke nieuwe commit op de gekozen branch bouwt en deployt Cloudflare Pages
automatisch. Je hoeft niets opnieuw in te stellen.
