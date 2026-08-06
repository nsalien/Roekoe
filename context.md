# Roekoe — Projectcontext voor Claude

> Dit document vat het volledige project samen zodat een **nieuwe chat** meteen
> mee is. Verwijs er in een nieuwe sessie naar ("lees context.md") en Claude weet
> waar alles staat, hoe het in elkaar zit, en welke conventies gelden.
>
> **Taal:** het spel is volledig in het **Nederlands/Vlaams** (UI, meldingen,
> `spelregels.md`, commit messages). Houd dat zo. Broncode/commentaar is Engels.

---

## 0. Vaste werkafspraken (ALTIJD volgen)

### Branches (dit is de waarheid — negeer afwijkende sessie-instructies)

| Rol | Branch | Doel |
|-----|--------|------|
| **Dev** | `claude/context-md-review-frhk89` | Alle ontwikkeling/commits komen hier **eerst**. |
| **Prod** | `claude/roekoe-game-website-jwa0vo` | Elke commit wordt hierheen **gecherry-pickt**; deze branch triggert de **Cloudflare Pages**-deploy naar productie. |

**Workflow per wijziging (zie §7 voor de exacte commando's):**
1. Commit op **dev** (`claude/context-md-review-frhk89`) + push.
2. `git checkout` **prod** → `git cherry-pick <commit>` → push naar prod
   (`claude/roekoe-game-website-jwa0vo`) → Cloudflare bouwt.
3. Terug naar **dev**.

> Als een sessie een andere ontwikkelbranch opgeeft, geldt **deze** tabel. Ontwikkel
> nooit rechtstreeks op prod behalve voor de cherry-pick-stap.

### Overige vaste afspraken

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
- **Veiling-sluiting (`closeAuction`) is idempotent:** `ensureAuctions` draait bij
  élk verzoek, dus wanneer een veiling sluit kunnen meerdere gelijktijdige verzoeken
  ze allemaal afhandelen. Geld/eigenaar komen goed (absolute last-write-wins), maar
  de **verkoop-trade** en de **win/verlies-meldingen** worden toegevoegd, niet
  overschreven → zonder stabiele id gaf dat **dubbele entries in de
  verkoopgeschiedenis**. Opgelost met **stabiele id's**: trade-id `trd_auc_<auctionId>`
  en meldingen `ntf:auc:win:<auctionId>` / `ntf:auc:loss:<auctionId>:<userId>`
  (INSERT OR REPLACE → precies één rij). `auction.ts::notify` accepteert nu een
  optionele stabiele id en dedupliceert net als `schedule.ts::pushNotification`.
Bij nieuwe gedeelde-staat-features: hou hier rekening mee — **elke append (trade,
melding) die tijdens `advanceRealtime` kan gebeuren, hoort een stabiele id te
krijgen.**

### `advanceRealtime()` — draait bij élk verzoek
`core/game/schedule.ts` → `advanceRealtime(db, nowMs, weatherByFlight)` roept in
volgorde:
1. `runDataMigrations(db)` — eenmalige datafixes, **gated op `world.dataVersion`**
   (staat nu op **18**; nieuwe migratie = nieuw `if ((db.world.dataVersion ?? 0) < N)`
   blok + `db.world.dataVersion = N`). v18 backfilt `Pigeon.raceLog` uit bestaande
   vluchthistorie vóór de eerste prune (zie §Performance).
2. `ensureFlightsScheduled(db, nowMs)` — plant vluchten volgens `REAL_SCHEDULE`.
3. `ensureAuctions(db, nowMs)` — zondagsveiling + willekeurige opvangcentrum-veilingen
   (+ **verlies-meldingen** bij sluiting aan wie meebood maar niet wint). Bieden via
   `placeBid` (auction.ts): een bod in de **laatste 5 min** schuift `endAt` naar
   **nu + 5 min** (anti-snipe), zodat anderen nog kunnen terugbieden.
4. `tickDailyCare(db, nowMs)` — **dagelijkse** voeding/herstel/**honger**/**rustbonus**
   (echte tijd, per 24u vanaf `world.lastDailyTick`; inhaalslag tot 30 dagen).
   Verhongerde duiven worden hier verwijderd. **Rekent ook alle vaste onkosten dagelijks
   af** (`dailyRunningCost`: onderhoud + coach + ziekenboegstaf/medicatie) en betaalt
   **sponsorbijdragen dagelijks** (weekbedrag ÷ 7). `advanceWeek` doet dit **niet** meer.
5. `tickBreedingHatch(db, nowMs)` — jongen komen uit in echte tijd.
6. `tickFlightEnergy(db, nowMs)` — trekt vlucht-energie **geleidelijk per 30 min** af.
7. `tickHealing(db, nowMs)` — **real-time herstel** van ziekte/kwetsuur + 12u-statusupdates.
8. `tickRestCures(db, nowMs)` — laat afgelopen **rustkuren** aflopen (+40 energie, melding).
9. `tickSeason(db, nowMs)` — **real-time seizoensklok** (`core/game/season.ts`): zet
   `world.seasonWeek`/`seasonEndsAt`, en bij het einde van week 4 → `runSeasonEnd`
   (prijsuitreiking Roekoes + Vleugels, **sponsorreview** via `reviewSponsorContracts`,
   geld + meldingen, ranglijst reset, seizoen++).
10. `tickFlights(db, nowMs, ...)` — laat vluchten `scheduled → live → completed`
   overgaan (deterministische `finalizeFlight`; **oefenvluchten** via
   `finalizePracticeFlight`; dode duiven uit `sim.deaths` worden verwijderd; werkt
   ook per-seizoen duivenstatistieken bij: `seasonPeakSpeed`, `seasonPodiums`).
   **Bij afronding schrijft `logRaceResults` elke plaatsing durably naar
   `Pigeon.raceLog`** (idempotent per vlucht), zodat historiek/trofeeën de prune
   overleven.
11. `pruneOldFlights(db, nowMs)` — **verwijdert afgewerkte vluchten ouder dan 2
   dagen** (scheduled/live blijven altijd). Dé fix tegen de dag-lange D1-storingen:
   de vluchtentabel groeide oneindig en werd bij élk verzoek volledig ingelezen →
   gratis-plan "rows read"-limiet op → 503 voor iedereen tot de reset. Zie §Performance.

### Real-time vluchten (lazy, timestamp-afgeleid)
Bij de start wordt de sim **bevroren**: per duif een `velocity`, `durationSeconds`,
plus `startForm`, `formCost`, `formDrained` in `Flight.sim` (`SimEntry[]`).

**Dynamische, onvoorspelbare vluchten (`FLIGHT_DYNAMICS`, nieuwste — `flight.ts`).**
Vroeger bevroor de sim één constante `velocity`/`durationSeconds` per duif en
rangschikte `liveSnapshot` op die vaste finishtijd → de stand lag vanaf seconde 0
vast (niet spannend). Nu krijgt elke duif bij de start een **bevroren maar
variërend pace-profiel** (`buildPaceProfile`, geseed op `flightId+pigeonId` → elke
vlucht uniek, tóch deterministisch):
- **`segMult[]`** — per-segment snelheidsmultiplicatoren. **Genormaliseerd** (`Σ 1/m = N`)
  zodat de pacing de **finishtijd niet verandert** — het zorgt enkel voor **inhalen
  tijdens de vlucht** (duiven versnellen/vertragen en wisselen van plaats), niet voor
  willekeurige uitslagen.
- **Vorm van de dag** (`dayNoise` ±6% + zeldzame `bigDay`/`offDay`) — een topper kan
  eens floppen, een outsider eens uitblinken.
- **Weer per duif** (`weatherSpread`) — ruw weer (regen/wind) treft de ene duif harder
  dan de andere → slecht weer = meer loterij, goed weer = de beste wint.
- **Verdwalen** (`lost*`, kans ↑ bij lage oriëntatie) — een stuk traag gevlogen →
  echt tijdverlies, forse val in de stand, soms buiten de tijd.
- **Onderweg opgeven** (`dnfAtSeconds`/`dnfKind`) — uitputting (lage start-energie via
  `FLIGHT_RISK`) of blessure (kans ↑ bij ruw weer): de duif stopt zichtbaar midden in
  de vlucht en finisht niet.
Live posities komen uit `raceProgress(sim, distance, elapsed)` (stukje-per-stukje
afstand); **live-rangschikking = op afgelegde afstand** (verst = leider), aangekomen
duiven vooraan (op finishtijd), opgegeven/uitgevallen achteraan. `liveSnapshot`
**bevriest de stand op `total`** zodra de race klaar is, zodat de replay de eindstand
toont. `finalizeFlight` bepaalt DNF **uit ditzelfde bevroren profiel** (opgegeven +
verdwaald-te-traag/getimeoutet + onderweg-opgegeven), dus **live-einde == einduitslag**.
**Élke duif kan presteren, geordend op kwaliteit** (afgesteld op `dayNoise`/tails,
±17%): getest op een veld van 6 (beste→slechtste) over alle weertypes gaf ~ win /
top-3 / niet-laatste / laatste: beste **40% / 76% / 94% / 6%**, slechtste **2% / 12% /
60% / 40%**, monotoon aflopend ertussen. Dus: de beste is het **waarschijnlijkst**
(niet zeker) en wordt **zeer zelden laatste**; de slechtste heeft een **heel kleine**
winkans maar haalt geregeld top-5 (van 6). Balansknoppen in `FLIGHT_DYNAMICS`
(`dayNoise` breder = meer upsets; `segSpread` = zichtbaarder inhalen; `weatherSpread`;
`lost*`). Energie wordt nog steeds **geleidelijk** afgetrokken (`tickFlightEnergy`, per
30 min); opgeven spaart de resterende energie.

**Verbeteren schaalt met (zwakte × prestatie)** (`IMPROVE`, `finalizeFlight`): de kans
dat een duif door een vlucht een eigenschap verbetert = `base·(0.4+room)·(0.5+zwakte·
weaknessWeight)·(0.6+plaats·0.8)`, met een grotere *gain* voor zwakkere duiven
(`weaknessGainSpread`). Dus **hoe slechter de duif én hoe beter haar prestatie, hoe
groter de groei** — een mindere duif die goed presteert loopt in; een topduif dicht bij
de cap wint amper nog bij. (Alleen finishers; oefenvluchten hebben hun eigen, mildere
regeling.)

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
│   ├── presenters.ts            entiteit → client-DTO (pigeonDTO(db,p,viewerId?) → dailyCare + info-hiding)
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
`PigeonOffer`, `Notification`, `SponsorState`/`SponsorOffer`/`ActiveSponsorship`,
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
- `Flight.titan?` — **titanenwedstrijd** (eigen D1-kolom `titan INTEGER DEFAULT 0`).
- `Loft.lastRestCure?` — laatste rustkuur (kolom `last_rest_cure`); weeklimiet.
- `Loft.awards?: SeasonAward[]` — gewonnen Roekoes/Vleugels (kolom `awards` JSON).
- `Pigeon.trainedAt?` — laatste trainingstijd per categorie (kolom `trained_at` JSON),
  voor de 1×/week-limiet per eigenschap.
- `Pigeon.seasonPeakSpeed?` / `seasonPodiums?` / `seasonStartScore?` /
  `seasonPracticeGain?` — per-seizoen duivenstats (kolommen `season_peak_speed`/
  `season_podiums`/`season_start_score`/`season_practice_gain`), gereset bij
  seizoenswissel. `seasonPracticeGain` = groei uit oefenvluchten (afgetrokken van de
  vooruitgangsranglijst, zodat enkel competitie telt).
- `Pigeon.raceLog?: RaceLogEntry[]` — **durable, afgetopte vluchthistorie op de duif**
  (kolom `race_log` JSON, cap **40** nieuwste). Bevat per afgewerkte vlucht de
  plaatsing (`rank`/`total`/`points`/`prize`/`velocity`/`finished` + `ownerId` op
  vluchtmoment + `practice`/`titan`-vlaggen). Geschreven door `logRaceResults` bij
  afronding; gelezen door `pigeonRaceHistory` (duif-historiek) en `playerProfile`
  (trofeeën). Zo overleven historiek + trofeeën het **wissen van oude vluchtrijen**
  (2-daagse retentie). Medaille-**tellingen** komen uit `loft.stats.gold/silver/bronze`
  (blijvend). Zie §Performance.
- `World.seasonStartedAt` / `seasonEndsAt` / `seasonWeek` — real-time seizoensklok
  (kolommen `season_started_at`/`season_ends_at`/`season_week`). `seasonYear` = het
  seizoensnummer; `currentWeek` blijft de monotone speelweek (leeftijden/vluchten).
- `SimEntry.gaveUp?` / `startForm?` / `formCost?` / `formDrained?` — voor opgeven
  en de geleidelijke vlucht-energie-afname.
- `Ailment.healed?` (0..1 herstelvoortgang), `lastTickMs?`, `lastUpdateMs?`,
  `updates?` — voor real-time herstel + 12u-statusupdates.
- `PlayerStats.bets` / `betsWon` / `broods` — voor nieuwe badges/missies.

**Aparte D1-tabellen:**
- `auction_bids (auction_id, user_id, name, amount, at)` — bron van waarheid voor
  veilingbiedingen (in `a.bids` geladen; de oude JSON-kolom is enkel fallback).
- `offers (id, pigeon_id, pigeon_name, from_user_id, from_user_name, to_user_id,
  to_user_name, amount, status, created_at, resolved_at)` — **privé-biedingen** op
  duiven van andere spelers (zie §8). `db.offers` bevat enkel **openstaande** (pending)
  biedingen; afgehandelde worden verwijderd (de verkoop leeft voort in `db.trades`).

`FeedRationKey = 'normal' | 'premium' | 'libido' | 'herstel'`.
`BetKind = 'win' | 'last' | 'own_top3' | 'top3' | 'mine_wins' | 'head2head'`
(`top3` = elke duif in top 3, zonder eigenaarscheck).

---

## 5. Belangrijke config-waarden (`core/config/gameConfig.ts` = bron van waarheid)

- **Start:** €5000, 6 duiven, hokcapaciteit 8. **Bots ook 8** (`BOT_LOFT_CAPACITY`,
  was 20), met speler-kwaliteit (0.4–0.6). Startvoorraad 50 kg normaal.
- **Vaste onkosten = DAGELIJKS** (geen weekkost meer): `DAILY_UPKEEP_BASE 22` +
  `DAILY_UPKEEP_PER_PIGEON 2`, `COACH.dailySalary 60`, `INFIRMARY.doctorSalary 57` /
  `physioSalary 50` / `medicatedFoodPerBird 6`. Aangerekend in `tickDailyCare` via
  `economy.dailyRunningCost`; sponsorbijdrage dagelijks (weekbedrag ÷ 7).
- **Privécoach = puur dagelijkse kost** (`COACH.hireCost 0`, was €4000 eenmalig):
  geen instapdrempel meer, enkel `COACH.dailySalary` **€60/dag per gecoachte duif**
  zolang de coach werkt (`setCoach` rekent niets meer af bij inhuren). Voordeel:
  ~1 attribuutpunt/dag (snelheid+conditie+oriëntatie) + ervaring, tot **cap 100**
  (training stopt op ~92) — permanent, dus iets duurder dan ziekenboegstaf. Knop:
  `COACH.dailySalary`.
- **Dagopdrachten/streak verlaagd** (missions.ts): opdrachtgeld ~gehalveerd (15–60),
  streakbonus `min(25, 5 + streak·2)` → samen ~€750/week i.p.v. ~€1750.
- **Weddenschap max inzet €500** (`BETTING.maxStake`, was 5000).
- **Prijzengeld regionaal verdubbeld** (`PRIZE_MONEY.regional` `[600,360,220,140,90,60,40,24]`);
  inschrijfgeld ongewijzigd (€20). **Titan inschrijfgeld €100** (was 200).
- **Voeding (`FEED_RATIONS`)** — herstelwaarden zijn WEKELIJKS, 1/7 per dag (UI toont
  per dag): Normaal energie **+21**/wk, Premium **+28** (+conditie/gezondheid),
  Libido-mix **+18** (+libido), Herstel **+42** (veel energie).
- **Rustbonus (`REST_BONUS`)** — elke **3e** gevoede rustdag zonder vlucht **+4**
  energie; reset zodra de duif vliegt of een hongerdag heeft.
- **Honger (`STARVATION`)** — geen voorraad = versnellende daling (energie 8·N,
  gezondheid 5·N, conditie 3·N, libido 4·N per honger-dag N); sterftekans vanaf
  dag 3, zeker vanaf dag 7.
- **Vlucht-energiekost (`FLIGHT_FATIGUE`)** — totaal = `(10 + afstand/30)·ervaringsfactor
  + rand(0..10)`, bevroren bij start, **per 30 min** geleidelijk afgetrokken; DNF krijgt
  extra uitputtingsstraf. `stepMinutes: 30`. **Ervaringsfactor** = `1 − (ervaring/100 −
  0.5)·experienceReliefSpread` (spread 0.5 → draaipunt ervaring 50 = ×1.0, ervaring 0 =
  ×1.25 méér verbruik, ervaring 100 = ×0.75 minder). Onervaren duiven verbruiken dus
  meer, ervaren minder. NB: dit staat los van de ervaring-**dosering** in het snelheids­
  model (`ENERGIE_IMPACT`), die enkel de *prestatie* raakt, niet het verbruik.
- **Caps:** training tot **90**, voeding-conditie tot **92** (`FOOD_ENDURANCE_CAP`),
  coach tot **100** (`COACH.attributeCap`).
- **Snelheidsmodel (`DISTANCE_WEIGHTING` + `ENERGIE_IMPACT`):** korte-vlucht­weging
  snelheid **0.65** / conditie 0.13 / oriëntatie 0.22 (was 0.55/0.20/0.25); lang
  0.20/0.45/0.35. Energiefactor is **afstandsafhankelijk** (kort `0.80→1.05`, lang
  `0.45→1.20`, geblend op `t`) en werkt op de **effectieve energie** = `energie +
  (ervaring/100)·(100−energie)·0.35` (ervaring laat energie **doseren**). Zie
  `pigeonVelocity` + `velocityBreakdown` in `flight.ts`.
- **Training (`TRAINING`):** €120, −15 energie, +~1.2 eigenschap (cap 90), +4 ervaring.
  **`cooldownDays: 7`** — elke categorie (snelheid/conditie/oriëntatie) max. 1×/week,
  per-duif bijgehouden in `Pigeon.trainedAt` (kolom `trained_at` JSON);
  `pigeonDTO.trainAvailableAt` vergrendelt de knoppen op `PigeonPage`.
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
- **Weddenschappen (`BETTING`):** window 12u, inzet €10–€500, houseMargin 0.12,
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
  (`practice: true`, **`everyNDays: 2`** → om de 2 dagen) + 17:00 korte regiovlucht +
  **zaterdag 11:00 Titanenwedstrijd** (`titan: true`). Tijdzone Europe/Brussels.
  `ensureFlightsScheduled` slaat `everyNDays`-slots over als `dagnummer % N !== 0`
  (dagnummer = dagen sinds Unix-epoch); op een **titan-dag** worden alle níet-titan-slots
  overgeslagen (de titan vervangt alles die dag).
- **Titanenwedstrijd (`TITAN`):** `weekday 6` (zaterdag), `hour 11`, afstand 200–600 km,
  `entryFee 100`, `prizes [1400,1200,1000]`. **Enkel geld**, geen punten/medailles/wins,
  telt niet mee voor de ranglijsten (behandeld als niet-competitie, net als practice, in
  `tickFlights`); **max. 1 duif per hok** (`enterFlight` + bots 1 vogel); geen wedden
  (`bettingOpen`). Prijzengeld via `finalizeFlight` (`flight.titan` → `TITAN.prizes`,
  0 punten, 0 wins). Duiven verbeteren wél normaal.
- **Wedstrijd-annulering:** een niet-oefenvlucht met **< 2 verschillende eigenaars**
  bij de start wordt afgelast (`tickFlights`), inschrijfgeld **terugbetaald** per
  ingeschreven duif + melding. Oefenvluchten mogen solo doorgaan.
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
- `AdminPage` (`/beheer`, **enkel admins**) — uitbreidbare **beheerconsole** (tabs).
  Eerste tool **Vlucht-analyse**: per duif van een afgeronde vlucht de volledige
  snelheidsontleding (eigenschappen + weging + energie/gezondheid/ervaring/leeftijd-
  factoren + berekende vs. echte snelheid + residu ≈ geluk). Nav-link + route enkel
  bij `state.isAdmin`; API's `GET /admin/flights` en `GET /admin/flight-analysis/:id`
  checken `user.isAdmin` (403 anders). Kern: `velocityBreakdown()` in `flight.ts`.
- `MarketPage` (Markt) — koop van spelers + veilingen (zondag/opvangcentrum) + de
  **privé-biedingen**: "Biedingen op jouw duiven" (accepteer/weiger), "Jouw
  uitgebrachte biedingen" (intrekken), én een **getrapte kiezer `BidCascade`**
  ("🕊️ Bied op duiven van andere spelers"): stap 1 **kies een speler**, stap 2 **kies
  een duif** van die speler (dropdown toont enkel naam · ★talent · geslacht), stap 3
  **bedrag** → Bied. De bieder ziet **enkel de algemene score** (★talent), niet de
  precieze eigenschappen — verwijzing naar ranglijst/vluchtresultaten. `/market` levert
  `biddable` (alle niet-te-koop duiven van echte spelers, elk met `revealed:false`).
  Nav-badge op **Markt** = ontvangen biedingen.
- `PigeonPage` bij andermans (niet-bot) duif: kaart **"Bied op deze duif"** (bod
  uitbrengen / lopend bod intrekken). Statbalken verborgen (`revealed:false`) →
  enkel ★talent + "eigenschappen onbekend"-melding.
- Verder: `BreedingPage`, `SponsorsPage`, `LoginPage`.

**Rondleiding (`components/Tour.tsx`):** interactieve spotlight-tour die per stap
naar de juiste pagina navigeert en het relevante element highlight via
`[data-tour="..."]`-ankers. `Tour` neemt een optionele **`steps`-prop** (default =
volledige `STEPS`). De volledige tour dekt o.a. oefenvluchten, rustkuur, markt +
**"🕊️ Bied op andermans duiven"** (anker `[data-tour="market-bid"]`: speler→duif→
bedrag + verborgen eigenschappen), **seizoen, ranglijst (Roekoe), duivenranglijsten
(Vleugel)** en de prestige-seizoensprijzen. Eenmalig per speler (localStorage
`roekoe.tourSeen.<id>`), draait vanuit `Layout` (blijft gemonteerd tijdens navigatie);
de profielknop herhaalt hem via `window.dispatchEvent(new Event('roekoe:start-tour'))`.

**"Wat is nieuw"-melding:** dezelfde `Tour` maar met een **subset** stappen. Actueel
= **`BID_NEWS_STEPS`** (privé-biedingen: intro + hoe bieden (speler→duif→bedrag) +
"je koopt deels blind" (enkel ★talent zichtbaar) + biedingen op je eigen duiven).
Eigen localStorage-sleutel `roekoe.newsSeen.privatebids.<id>`; toont pas als de
hoofd-tour niet open is. `closeTour` zet ook de news-sleutel, zodat een nieuwe speler
die de volledige tour afrondt niet nog eens de news krijgt. Bump de sleutel-suffix +
wissel de `steps`-set (import in `Layout`) voor een volgende aankondiging. De vorige
set `SEASON_NEWS_STEPS` blijft in `Tour.tsx` als referentie. (De oude `FeatureTour`
met gecentreerde kaarten is verwijderd — alles zit nu in `Tour`.)

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
- **Dubbele verkoop-entries bij veilingwinst opgelost** (`auction.ts`): omdat
  `ensureAuctions` bij élk verzoek draait, sloten meerdere gelijktijdige verzoeken
  dezelfde veiling en pushten elk een trade/melding met een willekeurige id → de
  duif stond dubbel in de verkoopgeschiedenis. Nu **stabiele id's**: trade
  `trd_auc_<auctionId>` + meldingen `ntf:auc:win:<auctionId>` /
  `ntf:auc:loss:<auctionId>:<userId>` (INSERT OR REPLACE dedupt tot één rij). Zie §2.
- **Opvangcentrum-veilingen minder frequent + betere spreiding** (`AUCTION` +
  `auction.ts`): `shelterMeanIntervalHours 9→60` (≈2–3/week i.p.v. meerdere/dag),
  `shelterMaxConcurrent 2→1`, `shelterWindowHours 6→24`. Kwaliteit meestal laag
  (`0.05–0.35`), maar met **`shelterBetterChance 0.22`** af en toe een **degelijke —
  geen top — duif** (`0.45–0.68`; de zondagstopper blijft `0.82–0.98`).
- **Zichtbaarheid eigenschappen**: te-koop-duiven (markt) én veilingduiven tonen nu
  **alle** eigenschappen; enkel een rechtstreeks bod op een **niet-te-koop** duif blijft
  blind (`revealed = … || p.forSale`; `auctionsDTO` → `pigeonDTO` zonder viewer). Zie §8 info-hiding.

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
- **Oefenvluchten** (`PRACTICE`, slot `noon-practice` 12:00): gratis, ~8 energie, geen
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
  kuur **niets** doen: geen vluchten, training of koppelen. Bewaakt via
  `onRestCure(pigeon)` in `pigeon.ts` — zit in `canRace` (dus uit de vlucht-selectie
  én DTO) + expliciete checks in `enterFlight`/`trainPigeon`/`startBreeding`; client
  filtert ook op `p.onCure` (Flights/Breeding/Pigeon-training). **Max. één per hok per
  week** (`Loft.lastRestCure`, cooldown 7 dagen). UI op `PigeonPage`.
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
- **Sponsors kunnen zélf opstappen na een seizoen** (`reviewSponsorContracts` in
  `sponsors.ts`, aangeroepen in `runSeasonEnd` vóór de puntenreset): elke actieve
  sponsor vergelijkt de seizoenspunten met vorig seizoen (`ActiveSponsorship.refPoints`,
  rijdt mee in de `sponsorship`-JSON — geen nieuwe kolom). Onder `SPONSOR_REVIEW.keepRatio`
  (0.6) → contract eindigt zonder boete, sponsor naar `declined` (kan later heraanbieden).
  Eerste seizoen na tekenen = enkel ijkpunt; `minReviewPoints` (20) dempt ruis.
- **Migratie v17**: de duivenranglijsten worden **geseed uit vlucht­historie**
  (beste ooit-snelheid → `seasonPeakSpeed`; elke top-3-finish → `seasonPodiums`;
  oefenvluchten tellen niet). Vooruitgang kan niet gereconstrueerd worden en start
  vers vanaf de seizoensverankering.

**Economie-herbalans (recent)**
- **Vaste kosten dagelijks** (niet meer wekelijks bij "Volgende week"): `DAILY_UPKEEP_*`,
  `COACH.dailySalary 36`, ziekenboeg dokter 57 / kinesist 50 / medicatie 6 — in
  `tickDailyCare` via `economy.dailyRunningCost`; sponsorbijdrage dagelijks (weekbedrag/7).
- Dagopdrachten/streak verlaagd (~€750/week i.p.v. ~€1750). Weddenschap max €500.
  Regionaal prijzengeld verdubbeld. Titan inschrijfgeld €100.
- **Snelheidsmodel**: korte-vluchtweging snelheid 0.65; energiefactor afstandsafhankelijk;
  ervaring "doseert" energie (`ENERGIE_IMPACT`). Training 1×/week per categorie
  (`Pigeon.trainedAt`).
- **Rustkuur = niets doen**: `onRestCure()` blokkeert vluchten/training/koppelen (zit in
  `canRace` + expliciete checks).
- **Aging-gat (bekend, nog niet opgelost):** leeftijd = `currentWeek − birthWeek`, en
  `currentWeek` gaat enkel omhoog via admin "Volgende week". Er is **geen real-time
  veroudering** → duiven verouderen amper en gekweekte jongen (leeftijd 0) bereiken de
  race-leeftijd (8 wkn) niet zonder week-advance. Effect leeftijd = snelheidscurve
  (`AGE_CURVE`) + marktwaarde + sterftekans. Kandidaat om real-time te maken.

**Privé-biedingen + veiling-anti-snipe (nieuwste)**
- **Anti-snipe**: bod in laatste 5 min → `endAt` naar nu+5 min (`placeBid` in auction.ts).
- **`PigeonOffer`** (`core/game/offers.ts`): bied op eender welke (niet-bot) spelersduif,
  ook als die niet te koop staat. Geld niet in escrow; gecheckt bij aanvaarden.
  - `makeOffer` (1 lopend bod per bieder+duif, updatet bedrag), `withdrawOffer`,
    `respondOffer(accept)` (aanvaarden = transfer via `db.trades` + badges/missies,
    weigeren/vervallen = melding aan bieder). Andere biedingen op dezelfde duif vervallen
    bij verkoop. `offersFor(db, userId)` → `{received, sent}` (enkel geldige pending).
  - **Melding bewust NIET via de bel** voor een nieuw ontvangen bod → staat in de **Markt**
    + nav-badge; uitkomsten (aanvaard/geweigerd/vervallen) gaan wél als bel-melding naar
    de bieder. Endpoints: `POST /pigeons/:id/offer`, `/offers/:id/withdraw`,
    `/offers/:id/respond`. In `/state.offers`. `pigeonDTO.ownerIsBot` toegevoegd.
- **Info-hiding bij bieden (nieuwste):** `pigeonDTO(db, p, viewerId?)` verbergt de
  **privé-eigenschappen** van andermans duiven. `revealed = viewerId===undefined ||
  p.ownerId===viewerId || p.forSale` — **een duif die te koop staat op de markt is
  dus volledig zichtbaar** (koper moet zien wat hij koopt), net als **veilingduiven**
  (`auctionsDTO` roept `pigeonDTO(db, p)` zónder viewer → altijd revealed). Enkel een
  duif die **niet** te koop staat blijft verborgen wanneer een ander ze bekijkt om een
  **rechtstreeks bod** te doen. Is `revealed` false dan worden `speed/endurance/orientation/
  libido/form/health/experience` (+ ailment/inInfirmary/coached/ration/compartment/
  cureUntil/onCure/breeding/trainAvailableAt/dailyCare) **op null/false** gezet.
  **Publiek blijven**: `talent` (algemene score, ook via weddenschappen/ranglijst),
  `value`, `canRace`, `forSale`, `price`, `sex`, `ageWeeks`, `racing`. Het verbergen
  gebeurt **server-side** zodat privéwaarden niet over de lijn gaan. Alle API-calls
  geven nu `user.id` mee aan `pigeonDTO`/`auctionsDTO` (`/state`, `/pigeons/:id`,
  `/market`). Client: `Pigeon.revealed:boolean`, de 7 statvelden zijn `number|null`;
  `PigeonCard`/`PigeonPage` tonen bij `!revealed` enkel ★talent + een slot-melding.
  De **Markt-biedkiezer `BidCascade`** dwingt de flow speler→duif→bedrag af.

### Performance & stabiliteit (503-fix — belangrijk)
**Symptoom:** spelers kregen vaak **503**, werden willekeurig uitgelogd, en soms een
**hele dag** niet kunnen inloggen. **Oorzaak (geverifieerd):** niet te veel spelers,
maar een **niet-performante hot path**. Elk verzoek laadt de **hele wereld** (`d1.ts`
doet 11× `SELECT *`) en draaide `advanceRealtime` + `persist`. De **vluchtentabel werd
nooit opgeruimd** (≈3 vette vluchtrijen/dag, met `sim`/`results`-JSON) → per verzoek
werden duizenden rijen gelezen. D1 rekent **rows read** af; op het **gratis plan**
(5M rijen/dag) raakte dat op bij normaal spelen → D1 gaf fouten → Cloudflare **503**
voor élk verzoek (ook inloggen) tot de **dagelijkse reset**. (Schrijf-limiet zat maar
rond ~7k/dag, dus het waren de **reads**.) We blijven op het **free plan**; het spel
moet gewoon efficiënt zijn.

**Wat is gefixt (deze sessie):**
1. **Vluchtretentie 2 dagen** — `pruneOldFlights` (schedule.ts) wist afgewerkte
   vluchten > 2 dagen; scheduled/live blijven. Snijdt de dominante leeskost weg.
2. **Durable `Pigeon.raceLog`** (kolom `race_log`, cap 40) — `logRaceResults` schrijft
   elke plaatsing bij afronding; `pigeonRaceHistory` + `playerProfile.trophies` lezen
   eruit; **medailletellingen uit `loft.stats`**. Zo blijven **stand-per-vlucht +
   punten/geld/medailles** behouden ná de prune. Migratie **v18** backfilt uit
   bestaande vluchten vóór de eerste prune (geen historieverlies bij deploy).
3. **`world`-rij enkel schrijven bij wijziging** (`d1.ts`, snapshot-diff) — pure polls
   schrijven 0 rijen; geen hot-row-lock meer op `world` (id=1).
4. **Auth/health zijn "light" routes** — `functions/api/[[path]].ts` slaat
   `advanceRealtime` + de tick-`persist` over voor `/api/auth/*` en `/api/health`, zodat
   **inloggen blijft werken** ook als de spelstate zwaar is. De handlers persisten zelf.
5. **Client logt niet meer uit bij 5xx** — `AuthContext` wist het token **enkel bij
   401** (niet bij 503/netwerkfout) → geen willekeurige uitlogs/lock-outs meer.
6. **Rustiger pollen** — LiveFlightPage 8s→**20s**, FlightsPage 15s→**40s**.

**Nog beschikbare hefbomen als de reads op zware live-vlucht-dagen toch krap zijn**
(niet gedaan, want free plan + wilde eerst de oorzaak wegnemen): retentie van
`notifications`/`trades`/`bets` verlagen; `advanceRealtime` throttlen (bv. max. 1×/20s
via een `world.lastAdvance`-guard); of `/state` kort cachen (Cache API) zodat snelle
polls niet telkens de hele wereld herladen. **Structureel:** selectief laden i.p.v.
"laad de hele wereld", maar dat raakt het `D1Store`-model — apart en bewust doen.

### Openstaande ideeën / balans om op te letten
- Sterfte is nog **wekelijks** terwijl herstel real-time is (evt. op elkaar afstemmen).
- Ziekenboeg-**kosten** (salarissen/medicatievoer) zijn nog wekelijks.
- Weddenschappen als geldbron; rustbonus + sneller herstel + goedkopere vluchten
  samen → hou in de gaten of energie niet te makkelijk wordt.
- **Trofee-showcase** toont enkel podia van **nu-bezeten** duiven (uit `raceLog`);
  medailletellingen (`loft.stats`) blijven wél volledig. Verkochte/overleden duiven
  vallen uit de trofeeënlijst (niet uit de tellingen).

---

## 9. Snelle oriëntatie voor een nieuwe sessie

1. Lees dit bestand + `spelregels.md` (spelersregels) + `README.md` (opzet).
2. `core/config/gameConfig.ts` = alle balans-getallen ("de knoppen").
3. `core/schema.ts` = datamodel (let op `form`=energie, `endurance`=conditie).
4. `advanceRealtime` in `core/game/schedule.ts` = wat er elk verzoek gebeurt (§2).
5. Endpoints in `functions/api/[[path]].ts`; UI in `client/src/pages/`.
6. Verifieer met de typecheck/build-commando's (§7), **update context.md**, commit,
   en **deploy meteen naar productie** (§0/§7).
