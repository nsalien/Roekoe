# Roekoe — Projectcontext voor Claude

> Dit document vat het volledige project samen zodat een **nieuwe chat** meteen
> mee is. Verwijs er in een nieuwe sessie naar ("lees context.md") en Claude weet
> waar alles staat, hoe het in elkaar zit, en welke conventies gelden.
>
> **Taal:** het spel is volledig in het **Nederlands/Vlaams** (UI, meldingen,
> `spelregels.md`, commit messages). Houd dat zo. Broncode/commentaar is Engels.

---

## 0. Vaste werkafspraken (ALTIJD volgen)

1. **Update dit `context.md` direct** bij élke aanpassing die je doet — voeg de
   nieuwe context/feature toe of pas de betrokken sectie aan, in dezelfde commit
   als de wijziging. Dit bestand moet altijd de actuele waarheid zijn.
2. **Deploy direct naar productie** zodra je een aanpassing hebt gedaan (zie §7
   voor de exacte flow). Niet wachten tot de speler erom vraagt.
3. Verifieer altijd met typecheck + build (§7) vóór je commit + deployt.

---

## 1. Wat is Roekoe

Een online **duivenmelker-managementspel** voor een groepje vrienden (~10 spelers
+ bots). Kernloop: **verzorgen → trainen → inschrijven voor vluchten → punten &
geld verdienen → kopen/kweken/uitbreiden → herhalen.** Bots vullen het veld.

- **Repo:** `nsalien/roekoe` (GitHub).
- **Ontwikkelbranch:** `claude/context-md-review-frhk89` — hier ontwikkelen en
  committen.
- **Productie/deploy-branch:** `claude/roekoe-game-website-jwa0vo` — een push
  hiernaartoe triggert de **Cloudflare Pages** build (= live). Elke wijziging
  wordt via cherry-pick naar deze branch gebracht en gepusht (zie §7).
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
De wereld is klein, dus **elk verzoek**:
1. laadt de **hele wereld** uit D1 in een in-memory `Database` (`core/d1.ts`),
2. draait de **synchrone** engine erop,
3. schrijft alleen de **gewijzigde rijen** terug (per-rij JSON-diff).

Twee spelers die aan verschillende rijen werken overschrijven elkaar dus niet.
**Let op — "lost update" op gedeelde hot rows:** dezelfde rij (bv. een veiling,
een live vlucht) kan door gelijktijdige verzoeken wél overschreven worden. Daarom:
- **Veilingbiedingen** staan in een **aparte tabel** `auction_bids` (één rij per
  veiling+bieder) i.p.v. één JSON-kolom → geen verloren biedingen.
- **Vluchtafhandeling is deterministisch** (seeded op vlucht-id) en meldingen
  hebben **stabiele id's**, zodat een dubbele afhandeling identieke output geeft
  en geen dubbele/tegenstrijdige meldingen.
Bij nieuwe gedeelde-staat-features: hou hier rekening mee.

### `advanceRealtime()` — draait bij élk verzoek
`core/game/schedule.ts` → `advanceRealtime(db, nowMs, weatherByFlight)` roept in
volgorde:
1. `runDataMigrations(db)` — eenmalige datafixes, **gated op `world.dataVersion`**
   (staat nu op **17**; nieuwe migratie = nieuw `if ((db.world.dataVersion ?? 0) < N)`
   blok + `db.world.dataVersion = N`).
2. `ensureFlightsScheduled(db, nowMs)` — plant vluchten volgens `REAL_SCHEDULE`.
3. `ensureAuctions(db, nowMs)` — zondagsveiling + willekeurige opvangcentrum-veilingen
   (+ **verlies-meldingen** bij sluiting aan wie meebood maar niet wint).
4. `tickDailyCare(db, nowMs)` — **dagelijkse** voeding/herstel/**honger**/**rustbonus**
   (echte tijd, per 24u vanaf `world.lastDailyTick`; inhaalslag tot 30 dagen).
   Verhongerde duiven worden hier verwijderd.
5. `tickBreedingHatch(db, nowMs)` — jongen komen uit in echte tijd.
6. `tickFlightEnergy(db, nowMs)` — trekt vlucht-energie **geleidelijk per 30 min** af.
7. `tickHealing(db, nowMs)` — **real-time herstel** van ziekte/kwetsuur + 12u-statusupdates.
8. `tickRestCures(db, nowMs)` — laat afgelopen **rustkuren** aflopen (+40 energie, melding).
9. `tickSeason(db, nowMs)` — **real-time seizoensklok** (`core/game/season.ts`): zet
   `world.seasonWeek`/`seasonEndsAt`, en bij het einde van week 4 → `runSeasonEnd`
   (prijsuitreiking Roekoes + Vleugels, geld + meldingen, ranglijst reset, seizoen++).
10. `tickFlights(db, nowMs, ...)` — laat vluchten `scheduled → live → completed`
   overgaan (deterministische `finalizeFlight`; **oefenvluchten** via
   `finalizePracticeFlight`; dode duiven uit `sim.deaths` worden verwijderd; werkt
   ook per-seizoen duivenstatistieken bij: `seasonPeakSpeed`, `seasonPodiums`).

### Real-time vluchten (lazy, timestamp-afgeleid)
Bij de start wordt de sim **bevroren**: per duif een `velocity`, `durationSeconds`,
plus (nieuw) `startForm`, `formCost`, `formDrained` in `Flight.sim` (`SimEntry[]`).
Live posities worden puur uit die frozen sim + de huidige tijd berekend
(`liveSnapshot`). **Live-rangschikking = op bevroren finishtijd (`durationSeconds`),
opgegeven duiven achteraan.** Zo staan aangekomen duiven vanzelf vóór nog-vliegende
(hun duur ≤ verstreken tijd) en blijft de stand stabiel én gelijk aan de einduitslag —
geen "springen naar laatste plaats" meer zodra er duiven binnenkomen. Energie wordt **geleidelijk** afgetrokken tijdens de vlucht
(`tickFlightEnergy`, stappen van 30 min, evenredig met afstand), niet in één klap
achteraf — zo levert opgeven vlak voor de finish geen gratis energie op.

### `ensureSchema()` (in `core/d1.ts`)
Idempotente **runtime**-schema-upgrades: `ALTER TABLE … ADD COLUMN` en
`CREATE TABLE IF NOT EXISTS`, elk in try/catch. Nieuwe kolommen (bv. `hunger_days`,
`rest_days`) en tabellen (bv. `auction_bids`) worden hier toegevoegd; geen
handmatige migratie nodig. JSON-kolommen (bv. `sim`, `ailment`, `stats`) nemen
nieuwe velden vanzelf mee.

---

## 3. Mappen & bestanden

```
Roekoe/
├── client/                      React + Vite web-app (statisch)
│   └── src/
│       ├── pages/               één bestand per scherm (zie §6)
│       ├── components/          ui.tsx (Money/Spinner/StatBar+perDay/DailyGains verwijderd/…),
│       │                        Layout (+ auto-tour), PigeonCard (+ tourId/▲▼),
│       │                        Tour.tsx (interactieve rondleiding), PigeonAvatar, NotificationsBell
│       ├── game/GameContext.tsx useGame(): laadt /state, deelt state + refresh()
│       ├── auth/AuthContext.tsx useAuth(): user + token
│       ├── api/client.ts        api<T>(path, {method, body}) helper
│       ├── styles/global.css    design system + thema via [data-theme] (dark default)
│       └── types.ts             client-DTO's (spiegelen core/presenters.ts)
│   └── index.html               inline script zet data-theme (dark default) vóór paint
├── core/                        runtime-neutrale spelkern
│   ├── config/gameConfig.ts     ← ALLE instelbare getallen ("de knoppen")
│   ├── schema.ts                datamodel (entiteiten + Database)
│   ├── store.ts                 Store-interface + in-memory basis + newId()
│   ├── d1.ts                    D1-persistentie (load/snapshot/diff/ensureSchema, auction_bids)
│   ├── auth.ts                  wachtwoord-hash + JWT via Web Crypto
│   ├── presenters.ts            entiteit → client-DTO (pigeonDTO bevat dailyCare-projectie)
│   └── game/
│       ├── engine.ts            speler-acties (buy/train/enter/giveUpFlight/breed/…)
│       ├── schedule.ts          advanceRealtime + data-migraties + alle ticks
│       ├── flight.ts            vluchtsim (velocity, DETERMINISTISCHE finalize, live, cutoff)
│       ├── betting.ts           weddenschappen (Monte-Carlo odds + settle, stats)
│       ├── health.ts            ziekte/kwetsuur + REAL-TIME herstel (tickHealing)
│       ├── breeding.ts          kweek
│       ├── economy.ts           dagverzorging (applyDayOfCare) + projectie + upkeep + honger + rust
│       ├── bots.ts              bot-gedrag
│       ├── auction.ts           veilingen (bieden, sluiten, verlies-meldingen)
│       ├── sponsors.ts          sponsors
│       ├── badges.ts            badges/XP/level
│       ├── missions.ts          dagelijkse opdrachten + streak + dilemma-trigger
│       ├── events.ts            dilemma-kaarten
│       ├── pigeon.ts, names.ts, weather.ts, util.ts (seededRng/hashString/clamp/pickWith)
├── functions/api/[[path]].ts    de HELE API (Hono) — dun laagje op de engine (+ /admin/auctions)
├── migrations/0001_init.sql     D1-schema voor verse installatie
├── spelregels.md                spelregels + formules (Nederlands, speler-gericht)
├── README.md / DEPLOY.md        opzet + telefoon-only deploy-gids
├── wrangler.example.toml        template; ECHTE wrangler.toml staat in .gitignore
└── context.md                   ← dit bestand
```

> **`server/`** is legacy (geen actieve broncode). De echte backend is
> `functions/api/[[path]].ts`. Negeer `server/`.

---

## 4. Datamodel (`core/schema.ts`)

Entiteiten: `Pigeon`, `Loft`, `User`, `BreedingPair`, `Flight` (+ `SimEntry`,
`FlightEntry`, `FlightResult`), `Trade`, `Auction` (+ `AuctionBid`), `Bet`,
`Notification`, `SponsorState`/`SponsorOffer`/`ActiveSponsorship`,
`DailyMission`, `EventCard`, `PlayerStats`/`EarnedBadge`, `World`, `Database`.

**Naamgevingsvalstrikken (onthouden!):**
- `Pigeon.form` = **energie** (de "tank"), UI-label "⚡ Energie".
- `Pigeon.endurance` = **conditie**, UI-label "Conditie".
- `Pigeon.orientation` = oriëntatie, `speed` = snelheid, `libido`, `health`,
  `experience`, `talent`.
- `Loft.food` is een **`FoodStock` = Record<FeedRationKey, number>** (kg per type).

**Recent toegevoegde velden (rijden mee in bestaande kolommen/JSON — geen migratie):**
- `Pigeon.hungerDays` — opeenvolgende dagen zonder voer (drijft verhongeren).
- `Pigeon.restDays` — opeenvolgende gevoede rustdagen zonder vlucht (rustbonus).
- `Pigeon.cureUntil?` — ISO-tijd waarop een betaalde **rustkuur** afloopt (eigen
  D1-kolom `cure_until TEXT`; duif kan niet vliegen zolang de kuur loopt).
- `Flight.practice?` — **oefenvlucht** (eigen D1-kolom `practice INTEGER DEFAULT 0`).
- `Loft.lastRestCure?` — laatste rustkuur (kolom `last_rest_cure`); weeklimiet.
- `Loft.awards?: SeasonAward[]` — gewonnen Roekoes/Vleugels (kolom `awards` JSON).
- `Pigeon.seasonPeakSpeed?` / `seasonPodiums?` / `seasonStartScore?` /
  `seasonPracticeGain?` — per-seizoen duivenstats (kolommen `season_peak_speed`/
  `season_podiums`/`season_start_score`/`season_practice_gain`), gereset bij
  seizoenswissel. `seasonPracticeGain` = groei uit oefenvluchten (afgetrokken van de
  vooruitgangsranglijst, zodat enkel competitie telt).
- `World.seasonStartedAt` / `seasonEndsAt` / `seasonWeek` — real-time seizoensklok
  (kolommen `season_started_at`/`season_ends_at`/`season_week`). `seasonYear` = het
  seizoensnummer; `currentWeek` blijft de monotone speelweek (leeftijden/vluchten).
- `SimEntry.gaveUp?` / `startForm?` / `formCost?` / `formDrained?` — voor opgeven
  en de geleidelijke vlucht-energie-afname.
- `Ailment.healed?` (0..1 herstelvoortgang), `lastTickMs?`, `lastUpdateMs?`,
  `updates?` — voor real-time herstel + 12u-statusupdates.
- `PlayerStats.bets` / `betsWon` / `broods` — voor nieuwe badges/missies.

**Aparte D1-tabel:** `auction_bids (auction_id, user_id, name, amount, at)` — bron
van waarheid voor biedingen (wordt in `a.bids` geladen; de oude JSON-kolom is
enkel fallback).

`FeedRationKey = 'normal' | 'premium' | 'libido' | 'herstel'`.
`BetKind = 'win' | 'last' | 'own_top3' | 'top3' | 'mine_wins' | 'head2head'`
(`top3` = elke duif in top 3, zonder eigenaarscheck).

---

## 5. Belangrijke config-waarden (`core/config/gameConfig.ts` = bron van waarheid)

- **Start:** €5000, 6 duiven, hokcapaciteit 8. **Bots ook 8** (`BOT_LOFT_CAPACITY`,
  was 20), met speler-kwaliteit (0.4–0.6). Startvoorraad 50 kg normaal.
- **Voeding (`FEED_RATIONS`)** — herstelwaarden zijn WEKELIJKS, 1/7 per dag (UI toont
  per dag): Normaal energie **+21**/wk, Premium **+28** (+conditie/gezondheid),
  Libido-mix **+18** (+libido), Herstel **+42** (veel energie).
- **Rustbonus (`REST_BONUS`)** — elke **3e** gevoede rustdag zonder vlucht **+4**
  energie; reset zodra de duif vliegt of een hongerdag heeft.
- **Honger (`STARVATION`)** — geen voorraad = versnellende daling (energie 8·N,
  gezondheid 5·N, conditie 3·N, libido 4·N per honger-dag N); sterftekans vanaf
  dag 3, zeker vanaf dag 7.
- **Vlucht-energiekost (`FLIGHT_FATIGUE`)** — totaal = `5 + afstand/60 + rand(0..5)`,
  bevroren bij start, **per 30 min** geleidelijk afgetrokken; DNF krijgt extra
  uitputtingsstraf. `stepMinutes: 30`.
- **Caps:** training tot **90**, voeding-conditie tot **92** (`FOOD_ENDURANCE_CAP`),
  coach tot **100** (`COACH.attributeCap`).
- **Vluchtrisico (`FLIGHT_RISK`):** onder ~22 energie DNF-kans; onder ~25 extra
  blessurekans. **`FLIGHT_CUTOFF_MINUTES = 90`.**
- **Kweken (`BREEDING`):** ouders minstens **20** energie (`minParentForm`, was 40);
  meer energie+libido = sneller een jong.
- **Ziekenboeg (`INFIRMARY`):** basiscapaciteit **2** (was 4); upgrades 3/4/5/6 voor
  €800/1200/1800/2400 (`INFIRMARY_CAPACITY_TIERS`). Dokter €400/wk, kinesist €350/wk,
  medicatievoer €45/duif/wk.
- **Herstel (`HEALING`)** — real-time: `baseHoursOutside` licht 60 / matig 120 /
  ernstig 216; ziekenboeg ×2,2, dokter/kinesist ×1,6, medicatievoer ×1,35 (stapelen);
  `updateHours: 12` (statusupdate-cadans).
- **Weddenschappen (`BETTING`):** window 12u, inzet €10–€5000, houseMargin 0.12,
  simIterations 1500. Wedden op **alle wedstrijdvluchten**; **niet** op oefenvluchten
  (`bettingOpen` weigert `flight.practice`).
- **Oefenvlucht (`PRACTICE`):** `energyCost 4`, `improveChance 0.7` /
  `coachedImproveChance 0.92`, `weights {speed 0.15, endurance 0.45, orientation 0.4}`,
  `gainMin 0.4`/`gainMax 1.4`, `coachedBonusGain 0.5` (extra op conditie/oriëntatie).
- **Getrapt wedstrijdrisico bij lage startenergie (`TOURNEY_RISK`):**
  `lightThreshold 20`→licht (kans 0.2), `moderateThreshold 10`→matig (0.3),
  `deathThreshold 5`→sterfte (0.07). Opgegeven duiven zijn gevrijwaard; sterfte gaat
  vóór elke aandoening. Via `randomAilmentOfSeverity(kind, severity, week, rng)`.
- **Seizoen (`SEASON`):** `weeks 4`, `weekDays 7` → 28 echte dagen/seizoen,
  real-time (`tickSeason`). `SEASON_AWARDS`: roekoe `[2000,1500,1000]`,
  vleugel `[1000,750,500]`. **Bots dingen mee en kunnen ook winnen** (geld erbij,
  geen melding). `advanceWeek` doet **geen** seizoensrollover meer.
- **Rustkuur (`REST_CURE`):** `cost 300`, `durationHours 24`, `energy 40`,
  `cooldownDays 7` — **max. één kuur per hok per week** (dus één duif/week), bewaakt
  via `Loft.lastRestCure` (kolom `last_rest_cure TEXT`); `loftDTO.restCureAvailableAt`
  toont de UI wanneer de volgende weer kan.
- **Schema (`REAL_SCHEDULE`):** dagelijks 10:00 lange vlucht + **12:00 oefenvlucht**
  (`practice: true`, **`everyNDays: 2`** → om de 2 dagen) + 17:00 korte regiovlucht.
  Tijdzone Europe/Brussels. `ensureFlightsScheduled` slaat `everyNDays`-slots over als
  `dagnummer % N !== 0` (dagnummer = dagen sinds Unix-epoch).
- **Ranglijsten tellen enkel wedstrijdvluchten** (regionaal/nationaal/internationaal),
  níet oefenvluchten. Snelheid/podiums negeren practice al; **vooruitgang** trekt de
  practice-groei af via `Pigeon.seasonPracticeGain` (kolom `season_practice_gain`),
  bijgewerkt in `tickFlights` en gereset bij seizoenswissel.

---

## 6. Client-pagina's (`client/src/pages/`)

- `DashboardPage` — home. Voorraad per voertype (kopen), voer-effecten **per dag** in
  **tekst** (energie/gezondheid/conditie/libido). Tegel "**Ziek/gewond in je hok**"
  (ziekenboeg telt niet mee). Dagopdrachten. Beheerder-kaart (admin): "Volgende week"
  + "Toon recente veilingen" (biedgeschiedenis).
- `LoftPage` (Mijn hok) — duivenlijst met per duif: voerkeuze-select, apart/samen-knop
  (of "🏥 Ziekenboeg"-label als ze daar zit), verkoop, uitbreidingen. De statbalken
  tonen een **▲/▼ per dag** (groei/daling door je huidige keuze; via `pigeon.dailyCare`).
- `PigeonPage` — één duif: stats, afstamming, historiek; training; coach; voerkeuze;
  **rustkuur** (POST `/pigeons/:id/restcure`); hernoemen. (De per-dag-▲/▼ staan in het
  hokoverzicht, niet hier.)
- `FlightsPage` — kalender/uitslagen; inschrijven; weddenschap-paneel (max. 1/vlucht,
  o.a. type **top3**). **Oefenvluchten** krijgen een eigen badge, tonen "gratis" i.p.v.
  inschrijfgeld en hebben geen weddenschap-paneel.
- `LiveFlightPage` — live bord; knop **🏳️ Opgeven** (spaart resterende energie).
- `InfirmaryPage` (Ziekenboeg) — zieke/gekwetste duiven; dokter/kinesist/medicatievoer;
  **herstelbalk per duif** (`ailment.healed`).
- `ProfilePage` — hoknaam, **thema-toggle (donker/licht)**, **"Start rondleiding"**.
- `RankingPage` — tabs **Melkers** (seizoenspunten) + **Duiven** (drie ranglijsten:
  snelste pieksnelheid, meeste podiums, meeste vooruitgang — via `state.pigeonRankings`).
  Kop toont "Seizoen X · week Y/4 · nog Z dagen".
- `AchievementsPage` (Prestaties) — tabs Badges · Trofeeën · **Seizoensprijzen**
  (Roekoes + Vleugels: tellingen goud/zilver/brons + erelijst uit `profile.awards`).
- Verder: `MarketPage` (koop van spelers + veilingen; opvangcentrum), `BreedingPage`,
  `SponsorsPage`, `LoginPage`.

**Rondleiding (`components/Tour.tsx`):** interactieve spotlight-tour die per stap
naar de juiste pagina navigeert en het relevante element highlight via
`[data-tour="..."]`-ankers. `Tour` neemt een optionele **`steps`-prop** (default =
volledige `STEPS`). De volledige tour dekt o.a. oefenvluchten, rustkuur, **seizoen,
ranglijst (Roekoe), duivenranglijsten (Vleugel)** en de prestige-seizoensprijzen.
Eenmalig per speler (localStorage `roekoe.tourSeen.<id>`), draait vanuit `Layout`
(blijft gemonteerd tijdens navigatie); de profielknop herhaalt hem via
`window.dispatchEvent(new Event('roekoe:start-tour'))`.

**"Wat is nieuw"-melding:** dezelfde `Tour` maar met een **subset** stappen
(`SEASON_NEWS_STEPS`: intro + seizoen/ranglijst/Roekoe/Vleugel/seizoensprijzen), dus
óók visueel met navigatie + spotlight. Eigen localStorage-sleutel
`roekoe.newsSeen.season1.<id>`; toont pas als de hoofd-tour niet open is. `closeTour`
zet ook de news-sleutel, zodat een nieuwe speler die de volledige tour afrondt niet
nog eens de news krijgt. Bump de sleutel-suffix voor een volgende aankondiging. (De
oude `FeatureTour` met gecentreerde kaarten is verwijderd — alles zit nu in `Tour`.)

**Thema:** `data-theme` op `<html>` (default **dark**, gezet door inline script in
`index.html` vóór paint). CSS gebruikt `:root[data-theme='dark']` en
`[data-theme='dark'] …` (geen `prefers-color-scheme` meer). Toggle in Profiel.

---

## 7. Werkwijze & conventies

### Nieuwe feature toevoegen
Logica in `core/game/` + knoppen in `core/config/gameConfig.ts`, endpoint in
`functions/api/[[path]].ts`, DTO in `core/presenters.ts` + `client/src/types.ts`,
UI in `client/src/pages/`. Update **`spelregels.md`** bij een regel/formule, en
**altijd `context.md`** (§0).

### Verifiëren vóór commit
```bash
npx tsc --noEmit                 # server/core typecheck (vanuit root)
cd client && npx tsc --noEmit    # client typecheck
npm run build                    # bouwt de client (vanuit root)
```
Voor engine-logica: snelle integratietests met **tsx** vanuit de repo-root
(`npx tsx <test>.mts`, importeert rechtstreeks uit `./core/...`; achteraf verwijderen).

### Git + deploy (ALTIJD, zie §0)
1. Ontwikkel + commit op **`claude/context-md-review-frhk89`**; push met
   `git push -u origin claude/context-md-review-frhk89` (retry met backoff).
2. **Deploy meteen naar productie** door de commit op de deploy-branch te zetten:
   ```bash
   git fetch origin claude/roekoe-game-website-jwa0vo
   git checkout claude/roekoe-game-website-jwa0vo
   git reset --hard origin/claude/roekoe-game-website-jwa0vo
   git cherry-pick <commit>        # of meerdere
   # typecheck + build ter controle
   git push -u origin claude/roekoe-game-website-jwa0vo   # triggert Cloudflare Pages
   git checkout claude/context-md-review-frhk89           # terug naar dev
   ```
3. **Geen PR** tenzij expliciet gevraagd.
4. Commit messages in het **Nederlands**, en eindig met de footer:
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_XXXX
   ```
   (De `Claude-Session`-URL verschilt per sessie — gebruik de actuele.)

### Veiligheid / niet doen
- **Nooit** een echte `wrangler.toml` committen (staat in `.gitignore`).
  `JWT_SECRET` is een dashboard-secret, niet in git.
- Zet **geen** model-identifier in commits, code of andere gepushte artefacten.
- Registratie vereist een **INVITE_CODE**; eerste speler wordt automatisch admin.

---

## 8. Belangrijkste wijzigingen deze sessie (achtergrond)

Alles hieronder staat **live** op de deploy-branch. Data-migraties liepen door tot
**`dataVersion = 17`**.

**Vluchten & energie**
- Vlucht-energie wordt **geleidelijk per 30 min** afgetrokken (`tickFlightEnergy`),
  niet meer in één klap; opgeven betaalt enkel het gevlogen deel.
- `finalizeFlight` is **deterministisch** (seeded op vlucht-id) → geen
  tegenstrijdige uitslagen bij gelijktijdige afhandeling; resultaat-/verbeter-/
  blessure-/sponsor-/weddenschapsmeldingen hebben **stabiele id's** (dedupe).

**Veilingen**
- Biedingen in aparte tabel **`auction_bids`** → geen verloren biedingen meer.
- **Verlies-meldingen** bij sluiting (reden: hok vol / geld weg / niet hoogste /
  geen koper) + verrijkte overboden-melding.
- Admin-diagnose **`GET /admin/auctions`** + dashboardknop "Toon recente veilingen".

**Verzorging & balans**
- **Per-dag-projectie** `projectDailyCare` → ▲/▼-cijfers in het hokoverzicht.
- **Honger** (`hungerDays` + `STARVATION`): geen voer = versnellende daling → dood.
- **Rustbonus** (`restDays` + `REST_BONUS`): elke 3e gevoede rustdag +4 energie.
- Voer-energieherstel **verhoogd**, `FLIGHT_FATIGUE` **verlaagd** (meer races mogelijk).
- **Kweekgrens** 40 → **20** energie.
- **Bots**: capaciteit 20 → **8**, kwaliteit gelijk aan spelers; migraties v14
  (bots naar 8), v15 (bestaande bot-eigenschappen naar speler-niveau).

**Ziekenboeg**
- Herstel is nu **real-time** (`tickHealing`) i.p.v. wekelijkse worp; **12u-status­
  updates** (kinesist/dokter) met herstel-% + ETA; **herstelbalk per duif**.
- Basiscapaciteit **2** (was 4), upgrades 3/4/5/6; migratie v16.

**UI & onboarding**
- **Donker thema als standaard** (data-theme), toggle in Profiel.
- **Interactieve rondleiding** (`Tour.tsx`) met page-navigatie + highlights.
- Voer-effecten in tekst; dashboardtegel-verduidelijking; "🏥 Ziekenboeg"-label;
  prestige-badges lijnen netjes uit; "Meer/Minder"-navigatierij blijft open.

**Badges & dagopdrachten**
- Nieuwe stats `bets`/`betsWon`/`broods`; badges (De Gokker, Fortuin, Geluksvogel,
  Koppelaar, Eigen Stek, Fijnproever); missies (weddenschap, kweekkoppel, apart hok).

**Laag-energie-gameplay (nieuwste)**
- **Oefenvluchten** (`PRACTICE`, slot `noon-practice` 12:00): gratis, ~4 energie, geen
  punten/prijzen/DNF/blessure; bouwt conditie/oriëntatie op (privécoach = grotere kans
  + bonus). Bots doen niet mee. Aparte `finalizePracticeFlight` in `flight.ts`;
  `botsEnterFlight`/`bettingOpen` slaan practice over; gerichte "oefenvlucht afgerond"-
  melding (geen uitslag) in `emitFlightNotifications`.
- **Getrapt wedstrijdrisico** bij lage startenergie (`TOURNEY_RISK`) in `finalizeFlight`:
  <20 licht, <10 matig, <5 kans op **sterfte**. `SimulatedFlight.deaths` gevuld;
  `tickFlights` verwijdert dode duiven (breeding/entries opgeruimd) + `🕯️`-melding.
- **Wedcategorie `top3`** (elke duif top 3) toegevoegd; wedden nu op **alle**
  wedstrijdvluchten (niet op oefenvluchten).
- **Rustkuur** (`REST_CURE` + `startRestCure` + POST `/pigeons/:id/restcure` +
  `tickRestCures`): €300, 1 dag verplicht rusten, daarna +40 energie; kan tijdens de
  kuur niet vliegen (`enterFlight` blokkeert op `cureUntil`). **Max. één per hok per
  week** (`Loft.lastRestCure`, cooldown 7 dagen). UI op `PigeonPage` (knop vergrendeld
  + datum via `loft.restCureAvailableAt`).
- **Eenmalige "wat is nieuw"-melding**: eerst gecentreerde kaarten (oefenvlucht +
  rustkuur), later vervangen door de **spotlight-`Tour` met `SEASON_NEWS_STEPS`**
  (seizoen/ranglijst/Roekoe/Vleugel/seizoensprijzen). Al die onderwerpen zitten nu
  ook in de **volledige** tour (profiel-herhaalbaar); `FeatureTour.tsx` is verwijderd.
  Ankers: `RankingPage` (`season`/`ranking`/`pigeon-ranks`), `AchievementsPage`
  (`season-prizes`).

**Seizoenen, prijzen & duivenranglijsten (nieuwste)**
- **Real-time seizoen** (`core/game/season.ts`, `SEASON` 4 weken × 7 dagen): `tickSeason`
  zet `world.seasonWeek`/`seasonEndsAt` en houdt op het einde de **prijsuitreiking**
  (`runSeasonEnd`) → ranglijst reset, seizoen++. `advanceWeek` rolt het seizoen niet meer.
- **De Gouden/Zilveren/Bronzen Roekoe** — top-3 hokken (€2000/1500/1000) + badge
  `season_champion` voor #1. Bewaard in `Loft.awards`. Bots dingen mee.
- **Drie duivenranglijsten** (`pigeonSeasonRankings`, in `/state.pigeonRankings`):
  snelste pieksnelheid (km/u), meeste podiums, meeste vooruitgang (`seasonScore`-delta).
- **De Gouden/Zilveren/Bronzen Vleugel** — top-3 duiven per ranglijst
  (€1000/750/500 naar de eigenaar, ook bots). Bewaard in `Loft.awards`.
- Prestige-tab **Seizoensprijzen**; ranglijst-tabs **Melkers/Duiven**; kop toont
  seizoensweek + resttijd. Bots dingen mee (geld erbij, geen melding).
- **Migratie v17**: de duivenranglijsten worden **geseed uit vlucht­historie**
  (beste ooit-snelheid → `seasonPeakSpeed`; elke top-3-finish → `seasonPodiums`;
  oefenvluchten tellen niet). Vooruitgang kan niet gereconstrueerd worden en start
  vers vanaf de seizoensverankering.

### Openstaande ideeën / balans om op te letten
- Sterfte is nog **wekelijks** terwijl herstel real-time is (evt. op elkaar afstemmen).
- Ziekenboeg-**kosten** (salarissen/medicatievoer) zijn nog wekelijks.
- Weddenschappen als geldbron; rustbonus + sneller herstel + goedkopere vluchten
  samen → hou in de gaten of energie niet te makkelijk wordt.

---

## 9. Snelle oriëntatie voor een nieuwe sessie

1. Lees dit bestand + `spelregels.md` (spelersregels) + `README.md` (opzet).
2. `core/config/gameConfig.ts` = alle balans-getallen ("de knoppen").
3. `core/schema.ts` = datamodel (let op `form`=energie, `endurance`=conditie).
4. `advanceRealtime` in `core/game/schedule.ts` = wat er elk verzoek gebeurt (§2).
5. Endpoints in `functions/api/[[path]].ts`; UI in `client/src/pages/`.
6. Verifieer met de typecheck/build-commando's (§7), **update context.md**, commit,
   en **deploy meteen naar productie** (§0/§7).
