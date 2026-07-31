# Roekoe — Projectcontext voor Claude

> Dit document vat het volledige project samen zodat een **nieuwe chat** meteen
> mee is. Verwijs er in een nieuwe sessie naar ("lees context.md") en Claude weet
> waar alles staat, hoe het in elkaar zit, en welke conventies gelden.
>
> **Taal:** het spel is volledig in het **Nederlands/Vlaams** (UI, meldingen,
> `spelregels.md`, commit messages). Houd dat zo. Broncode/commentaar is Engels.

---

## 1. Wat is Roekoe

Een online **duivenmelker-managementspel** voor een groepje vrienden (~10 spelers
+ bots). Kernloop: **verzorgen → trainen → inschrijven voor vluchten → punten &
geld verdienen → kopen/kweken/uitbreiden → herhalen.** Bots vullen het veld.

- **Repo:** `nsalien/roekoe` (GitHub).
- **Werkbranch:** `claude/roekoe-game-website-jwa0vo` — hier ontwikkelen, committen
  en pushen. **Nooit** naar een andere branch pushen zonder toestemming.
- **Auto-deploy:** een push naar die branch triggert de Cloudflare Pages build.
- **Eigenaar/mail:** nicolaisalien@hotmail.com.

---

## 2. Architectuur (belangrijk)

Draait **volledig op Cloudflare** — geen altijd-aan server:

- **Client:** React + Vite + TypeScript → statische bundle op **Cloudflare Pages**.
- **API:** één Hono-app als **Pages Function** in `functions/api/[[path]].ts`
  (Workers-runtime).
- **Database:** **Cloudflare D1** (serverless SQLite), naam `roekoe-db`.
- **Spelkern:** runtime-neutrale TypeScript in `core/`, gedeeld door de API.

### D1Store-patroon (cruciaal om te begrijpen)
De wereld is klein (~10 spelers + bots), dus **elk verzoek**:
1. laadt de **hele wereld** uit D1 in een in-memory `Database` (`core/d1.ts`),
2. draait de **synchrone** engine erop,
3. schrijft alleen de **gewijzigde rijen** terug (per-rij JSON-diff).

Twee spelers die aan verschillende duiven/hokken werken overschrijven elkaar dus
niet. Wil je ooit slimmer persisteren, dan is `core/d1.ts` de enige plek.

### `advanceRealtime()` — draait bij élk verzoek
`core/game/schedule.ts` → `advanceRealtime(db, nowMs, weatherByFlight)` roept in
volgorde:
1. `runDataMigrations(db)` — eenmalige datafixes, **gated op `world.dataVersion`**
   (staat nu op **13**; nieuwe migratie = nieuw `if ((db.world.dataVersion ?? 0) < N)`
   blok + `db.world.dataVersion = N`).
2. `ensureFlightsScheduled(db, nowMs)` — plant vluchten volgens `REAL_SCHEDULE`.
3. `ensureAuctions(db, nowMs)` — zondagsveiling + willekeurige opvangcentrum-veilingen.
4. `tickDailyCare(db, nowMs)` — **dagelijkse** voeding/herstel (echte tijd, niet
   pas in het weekend).
5. `tickBreedingHatch(db, nowMs)` — jongen komen uit in echte tijd.
6. `tickFlights(db, nowMs, ...)` — laat vluchten `scheduled → live → completed`
   overgaan.

### Real-time vluchten (lazy, timestamp-afgeleid)
Bij de start wordt de sim **bevroren**: per duif een `velocity` + `durationSeconds`
in `Flight.sim` (`SimEntry[]`). Live posities worden puur uit die frozen sim + de
huidige tijd berekend (`liveSnapshot`). Geen tickende server nodig.

### `ensureSchema()` (in `core/d1.ts`)
Idempotente **runtime**-schema-upgrades: `ALTER TABLE … ADD COLUMN` en
`CREATE TABLE IF NOT EXISTS`, elk in try/catch. Zo hoeft er voor een nieuwe kolom
geen handmatige migratie te draaien. `migrations/0001_init.sql` is voor een verse
installatie.

---

## 3. Mappen & bestanden

```
Roekoe/
├── client/                      React + Vite web-app (statisch)
│   └── src/
│       ├── pages/               één bestand per scherm (zie §6)
│       ├── components/          ui.tsx (Money/Spinner/StatBar/countdownTo/useToast…),
│       │                        Layout, PigeonCard, PigeonAvatar, NotificationsBell
│       ├── game/GameContext.tsx useGame(): laadt /state, deelt state + refresh()
│       ├── auth/AuthContext.tsx useAuth(): user + token
│       ├── api/client.ts        api<T>(path, {method, body}) helper
│       └── types.ts             client-DTO's (spiegelen core/presenters.ts)
├── core/                        runtime-neutrale spelkern
│   ├── config/gameConfig.ts     ← ALLE instelbare getallen ("de knoppen")
│   ├── schema.ts                datamodel (entiteiten + Database)
│   ├── store.ts                 Store-interface + in-memory basis + newId()
│   ├── d1.ts                    D1-persistentie (load/snapshot/diff/ensureSchema)
│   ├── auth.ts                  wachtwoord-hash + JWT via Web Crypto
│   ├── presenters.ts            entiteit → client-DTO
│   └── game/
│       ├── engine.ts            speler-acties (buy/train/enter/giveUpFlight/…)
│       ├── schedule.ts          advanceRealtime + data-migraties + tickFlights
│       ├── flight.ts            vluchtsimulatie (velocity, finalize, live, cutoff)
│       ├── betting.ts           weddenschappen (Monte-Carlo odds + settle)
│       ├── health.ts            ziekte/kwetsuur/herstel
│       ├── breeding.ts          kweek
│       ├── economy.ts           kosten/upkeep
│       ├── bots.ts              bot-gedrag
│       ├── auction.ts           veilingen
│       ├── sponsors.ts          sponsors
│       ├── badges.ts            badges/XP/level
│       ├── missions.ts          dagelijkse opdrachten + streak
│       ├── events.ts            dilemma-kaarten
│       ├── pigeon.ts, names.ts, weather.ts, util.ts (seededRng/hashString/clamp)
├── functions/api/[[path]].ts    de HELE API (Hono) — dun laagje op de engine
├── migrations/0001_init.sql     D1-schema voor verse installatie
├── spelregels.md                spelregels + formules (Nederlands, speler-gericht)
├── README.md / DEPLOY.md        opzet + telefoon-only deploy-gids
├── wrangler.example.toml        template; ECHTE wrangler.toml staat in .gitignore
└── context.md                   ← dit bestand
```

> **`server/`** is legacy (alleen leftover `node_modules`, geen actieve broncode).
> De echte backend is `functions/api/[[path]].ts`. Negeer `server/`.

---

## 4. Datamodel (`core/schema.ts`)

Entiteiten: `Pigeon`, `Loft`, `User`, `BreedingPair`, `Flight` (+ `SimEntry`,
`FlightEntry`, `FlightResult`), `Trade`, `Auction` (+ `AuctionBid`), `Bet`,
`Notification`, `SponsorState`/`SponsorOffer`/`ActiveSponsorship`,
`DailyMission`, `EventCard`, `PlayerStats`/`EarnedBadge`, `World`, `Database`.

**Naamgevingsvalstrikken (onthouden!):**
- `Pigeon.form` = **energie** (dagelijkse "tank"), UI-label "⚡ Energie".
- `Pigeon.endurance` = **conditie**, UI-label "Conditie".
- `Pigeon.orientation` = oriëntatie, `speed` = snelheid, `libido`, `health`,
  `experience`, `talent`.
- Andere velden: `coached`, `ration` (FeedRationKey), `compartment` (apart hok),
  `racing`, `breeding`, `inInfirmary`, `ailment`, `forSale`/`price`.
- `Loft.food` is een **`FoodStock` = Record<FeedRationKey, number>** (kg per type),
  **niet** één getal.
- `SimEntry.gaveUp?: boolean` — duif die de eigenaar tijdens de race liet opgeven.
  Zit in de bestaande `sim`-JSON-kolom → geen schema-migratie nodig.
- Verwijderd t.o.v. ouder model: `Pigeon.retired`, `BreedingPair.hatchWeek`.

`FeedRationKey = 'normal' | 'premium' | 'libido' | 'herstel'`.
`BetKind = 'win' | 'last' | 'own_top3' | 'mine_wins' | 'head2head'`.

---

## 5. Belangrijke config-waarden (`core/config/gameConfig.ts` = bron van waarheid)

- **Start:** €5000, 6 duiven, hokcapaciteit 8 (bots 20), startvoorraad 50 kg normaal.
- **Voeding (`FEED_RATIONS`):** `foodPerPigeon` = WEKELIJKS kg (dagelijks 1/7
  verbruikt uit dat type). Herstelwaarden zijn wekelijkse doelen, 1/7 per dag.
  - Normaal (€3/kg), Premium (€6/kg, +conditie/gezondheid), Libido-mix (€4,5/kg),
    Herstel (€3/kg, veel energieherstel).
- **Caps:** training tot **90**, voeding-conditie tot **92** (`FOOD_ENDURANCE_CAP`),
  coach duwt race-eigenschap tot **100** (`COACH.attributeCap`). Voer verlaagt nooit
  een al hogere waarde.
- **Vluchtrisico (`FLIGHT_RISK`):** onder ~22 energie DNF-kans (tot 0.9 bij 0),
  onder ~25 energie extra blessurekans.
- **Wedstrijddeadline:** `FLIGHT_CUTOFF_MINUTES = 90` — 90 min na de eerste
  aankomst worden niet-gearriveerde duiven geëlimineerd (DNF).
- **Weddenschappen (`BETTING`):** window 12u, inzet €10–€5000, houseMargin 0.12,
  ratio 1.05–25, `simIterations` 1500 (Monte-Carlo).
- **Schema (`REAL_SCHEDULE`):** elke dag 10:00 lange vlucht (national/international,
  roterend) + 17:00 korte regionale vlucht. Tijdzone Europe/Brussels.
- **Upkeep:** €150 basis/week + €15/duif/week. Hernoemen duif €1000, hok €2000.
- **Tiers:** `regional` / `national` / `international` (prijzengeld + punten per tier).

---

## 6. Client-pagina's (`client/src/pages/`)

- `DashboardPage` — home. Voorraad **per voedertype** beheren (kopen per type),
  telt `×N duiven` per type, waarschuwt bij (bijna) leeg. **Geen** algemene
  voertype-instelling (bewust verwijderd).
- `LoftPage` (Mijn hok) — duivenlijst, sorteren, verkopen; per duif een
  **voerkeuze-select die de voorraad per type toont** en waarschuwt bij leeg;
  apart-hok-toggle; hokuitbreidingen (capaciteit + aparte hokken).
- `PigeonPage` — één duif: stats, afstamming, historiek; training (alleen thuis,
  niet tijdens vlucht/broeden); coach; voerkeuze (met voorraad); hernoemen.
- `FlightsPage` — kalender/uitslagen. Inschrijven, weddenschap-paneel (BetPanel):
  Monte-Carlo odds-preview, inzet begrensd, aftelklok tot betting opent (>12u),
  **max. 1 weddenschap per vlucht**. Eigen duiven gemarkeerd in uitslagen.
- `LiveFlightPage` — live bord per duif; eigen duiven gemarkeerd ("jij"); knop
  **🏳️ Opgeven** per eigen duif (spaart energie). Toont "opgegeven"-status.
- Verder: `MarketPage`, `BreedingPage`, `InfirmaryPage` (Ziekenboeg),
  `SponsorsPage`, `RankingPage`, `AchievementsPage` (Prestaties), `ProfilePage`,
  `LoginPage`.

---

## 7. Werkwijze & conventies

### Nieuwe feature toevoegen
Meestal: logica in `core/game/` + knoppen in `core/config/gameConfig.ts`, endpoint
in `functions/api/[[path]].ts`, DTO in `core/presenters.ts` + `client/src/types.ts`,
UI in `client/src/pages/`. Update `spelregels.md` als een regel/formule wijzigt.

### Verifiëren vóór commit
```bash
npx tsc --noEmit                 # server/core typecheck (vanuit root)
cd client && npx tsc --noEmit    # client typecheck
npm run build                    # bouwt de client (vanuit root)
```
Voor engine-logica: snelle integratietests met **tsx** vanuit de repo-root, bv.
`npx tsx <test>.mts` die rechtstreeks uit `./core/...` importeert (let op:
`finalizeFlight` muteert `flight.results` + geeft `{fatigue, payouts, improvements,
injuries}` terug; test-flights hebben minstens `type`, `entryFee`, `week`, `status`,
`distanceKm`, `sim` nodig).

### Git
- Werk op `claude/roekoe-game-website-jwa0vo`; push met
  `git push -u origin claude/roekoe-game-website-jwa0vo` (retry met backoff bij
  netwerkfouten).
- **Geen PR** tenzij expliciet gevraagd.
- Commit messages in het **Nederlands**, en eindig met de footer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01RWEh9RPsYEMcCGPqW2dHKg
  ```
  (De `Claude-Session`-URL verschilt per sessie — gebruik de actuele.)

### Veiligheid / niet doen
- **Nooit** een echte `wrangler.toml` committen (staat in `.gitignore`); alleen
  `wrangler.example.toml`. `JWT_SECRET` is een dashboard-secret, niet in git.
- Zet **geen** model-identifier in commits, PR's, code of andere gepushte
  artefacten (enkel in chat).
- Registratie vereist een **INVITE_CODE**; eerste speler wordt automatisch admin.

---

## 8. Recent afgewerkt (laatste batch)

Commit `f1f1432` op de werkbranch:
1. Voerkeuze per duif toont voorraad per type (+ waarschuwing bij leeg) op hok- en
   duifpagina; dashboard telt duiven per type en waarschuwt bij lage voorraad.
2. Weddenschappen: **niet-misbruikbare** odds via Monte-Carlo van het echte
   racemodel; aftelklok tot betting opent; **max. 1 weddenschap per vlucht**;
   inzet begrensd; "Eindigt allerlaatste" telt enkel de laatste **finisher**.
3. **Opgeven tijdens een live race** (knop): duif finisht niet maar spaart energie
   (licht energieverlies, geen gezondheidsschade, geen kwetsuur, geen conditie-opbouw).
4. **Wedstrijddeadline 90 min**: 90 minuten na de eerste aankomst worden
   niet-gearriveerde duiven geëlimineerd (DNF).
5. `spelregels.md` bijgewerkt (§3.3 deadline, §3.4 opgeven, §14 weddenschappen).

### Mogelijke volgende ideeën (niet gestart)
Eerder besproken uitgaven-/economie-hooks: meer sponsor-diepgang, extra
hokupgrades, cosmetics. Zie `spelregels.md` en `gameConfig.ts` voor de huidige balans.

---

## 9. Snelle oriëntatie voor een nieuwe sessie

1. Lees dit bestand + `spelregels.md` (spelersregels) + `README.md` (opzet).
2. `core/config/gameConfig.ts` = alle balans-getallen.
3. `core/schema.ts` = datamodel (let op `form`=energie, `endurance`=conditie).
4. `advanceRealtime` in `core/game/schedule.ts` = wat er elk verzoek gebeurt.
5. Endpoints in `functions/api/[[path]].ts`; UI in `client/src/pages/`.
6. Verifieer met de typecheck/build-commando's uit §7 vóór je commit + pusht.
