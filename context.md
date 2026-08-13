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
| **Dev** | `claude/hallo-49m6hj` | Alle ontwikkeling/commits komen hier **eerst**. |
| **Prod** | `claude/roekoe-game-website-jwa0vo` | Elke commit wordt hierheen **gecherry-pickt**; deze branch triggert de **Cloudflare Pages**-deploy naar productie. |

> De vorige dev-branch `claude/hallo-49m6hj` bestaat niet meer (lokaal
> noch op origin). Ontwikkelt een sessie op een nieuwe `claude/…`-branch, gebruik
> die dan als dev-branch en **werk deze tabel meteen bij** — de prod-branch
> hierboven verandert nooit.

**Workflow per wijziging (zie §7 voor de exacte commando's):**
1. Commit op **dev** (`claude/hallo-49m6hj`) + push.
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
- **Ontwikkelbranch:** `claude/hallo-49m6hj` — hier ontwikkelen en committen.
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
1. laadt de wereld uit D1 in een in-memory `Database` (`core/d1.ts`),
2. draait de **synchrone** engine erop,
3. schrijft alleen de **gewijzigde rijen** terug (per-rij JSON-diff).

**Niet meer letterlijk "de hele wereld" (nieuwste — leesbudget):** D1 rekent
**gelezen rijen** af, en dát is wat het spel plat legt (zie §Performance). De drie
**log-vormige** tabellen worden daarom **gedeeltelijk** geladen, via `viewerId`
(= de `sub` uit de JWT, die vóór de load geverifieerd wordt want dat kost geen DB):
- `notifications` → **enkel de inbox van de viewer** (`WHERE user_id = ?`),
- `bets` → **alle openstaande** (elk verzoek kan de afhandelaar zijn) + de
  **eigen afgehandelde** van de viewer,
- `trades` → enkel de **nieuwste `TRADE_LOAD_LIMIT` (100)** (`ORDER BY at DESC`).

Alles wat de engine globaal nodig heeft (users, lofts, pigeons, flights, auctions,
offers, auction_bids) wordt nog steeds volledig geladen; die zijn begrensd door het
aantal spelers en de 2-daagse vluchtretentie.

**Gevolgen om te onthouden bij nieuwe code:**
- De engine mag deze drie arrays **niet meer aftoppen** (`db.trades.slice(-200)`
  e.d. is overal weg): wat niet geladen is, zou de per-rij-diff als *verwijderd*
  zien. Aftoppen gebeurt nu in **SQL** via `boundedCleanups` in `d1.ts::persist`,
  en enkel op verzoeken die écht een rij toevoegen (een gewone poll doet niets).
- Elke partiële query **moet** door een index gedekt zijn, anders scant SQLite —
  en factureert D1 — de tabel alsnog. `ensureSchema` maakt daarom
  `idx_notifications_user_created`, `idx_trades_at` en `idx_bets_status` aan.
- Dedupe op een **stabiele melding-id** werkt enkel nog binnen de eigen inbox; voor
  een andere speler valt hij terug op `INSERT OR REPLACE` (zelfde rij, maar
  `read` gaat terug op false). Dat gebeurt alleen bij dubbele verwerking.

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
   (staat nu op **23**; nieuwe migratie = nieuw `if ((db.world.dataVersion ?? 0) < N)`
   blok + `db.world.dataVersion = N`). v21 zet **bestaande geplande vluchten terug naar de
   OUDE, kortere afstanden** (regio 30–160 / nat 60–290 / intl 180–950 km): elke nog-
   geplande niet-titan-vlucht buiten haar legacy-venster wordt her-routeerd via
   `pickRoute(tier, min, max)`; enkel **nieuwe** vluchten (nadien) krijgen de verbrede
   afstanden. v20 (voorloper) routeerde geplande vluchten net de andere kant op — v21 haalt
   de huidige kalender terug. v22 is een **eenmalige** ingreep: de aankomende
   internationale ochtendvlucht (`morning-long`, 10:00) wordt ingekort naar een
   **300–400 km**-route (blijft internationaal, enkel korter) — enkel als ze nog
   `scheduled` is en rond nu start. v19 wist oude openstaande sponsoraanbiedingen;
   v18 backfilt `Pigeon.raceLog` uit bestaande
   vluchthistorie vóór de eerste prune (zie §Performance).
2. `ensureFlightsScheduled(db, nowMs)` — plant vluchten volgens `REAL_SCHEDULE`.
3. `ensureAuctions(db, nowMs)` — zondagsveiling + willekeurige opvangcentrum-veilingen
   (+ **verlies-meldingen** bij sluiting aan wie meebood maar niet wint). Bieden via
   `placeBid` (auction.ts): een bod in de **laatste 5 min** schuift `endAt` naar
   **nu + 5 min** (anti-snipe), zodat anderen nog kunnen terugbieden.
4. `tickDailyCare(db, nowMs)` — **dagelijkse** voeding/herstel/**honger**/**rustbonus**
   (afgerekend op de **dagovergang om 00:00** in `TIMEZONE` — elke duif krijgt op
   net hetzelfde moment energie bij, ongeacht wanneer de eigenaar inlogt; het
   aantal gepasseerde middernachten sinds `world.lastDailyTick` wordt ingehaald,
   tot 30 dagen; `world.lastDailyTick` staat telkens op de laatst verwerkte
   lokale middernacht).
   Verhongerde duiven worden hier verwijderd. **Rekent ook alle vaste onkosten dagelijks
   af** (`dailyRunningCost`: onderhoud + coach + ziekenboegstaf/medicatie) en betaalt
   **sponsorbijdragen dagelijks** (weekbedrag ÷ 7). `advanceWeek` doet dit **niet** meer.
   Roept per gepasseerde dag ook **`runHealthDay(db, week)`** (health.ts) aan: dáár
   worden duiven **effectief ziek in echte tijd** (besmetting + spontaan), zakt de
   gezondheid van een aandoening **elke dag verder**, en kan een **onbehandelde**
   matige/ernstige aandoening **dodelijk** aflopen. (De oude `runHealthWeek` blijft
   enkel voor de admin-`/advance-week`-knop; illness/sterfte gebeurde vroeger
   *alleen* daar, dus in normaal spel werden duiven nooit ziek en verouderden ze
   niet — nu wel.)
   **Verouderen in echte tijd (4×):** de loop rolt `world.currentWeek` met
   `GAME_WEEKS_PER_REAL_WEEK` (=4) weken per échte week (gelijkmatig via
   `floor(dn·4/7)`-delta per dag). Zo is een jong na ~2 echte weken vliegklaar en
   speelt ouderdom over echte maanden mee. **Per gerolde gameweek** draait
   `runAgeMortality(db, week)` (health.ts) met de **rauwe weekkans** — zo blijft de
   `MORTALITY_CURVE` kloppen ongeacht de veroudersnelheid. (Ailment-sterfte zit in
   `runHealthDay`, per dag. Vlucht-sterfte zat al in `finalizeFlight` via
   `TOURNEY_RISK.deathChance`.) **Ook `runAgeDecline(db, week)`** draait hier: boven de
   piekleeftijd (`AGING.peakEndWeeks`) zakken snelheid/conditie/oriëntatie **echt** (per-duif
   `declineRate`); `AGE_CURVE` is daarom neerwaarts afgevlakt.
5. `tickBreedingHatch(db, nowMs)` — jongen komen uit in echte tijd.
6. `tickFlightEnergy(db, nowMs)` — trekt vlucht-energie **geleidelijk per 30 min** af.
7. `tickHealing(db, nowMs)` — **real-time herstel** van ziekte/kwetsuur + 12u-statusupdates.
8. `tickRestCures(db, nowMs)` — laat afgelopen **rustkuren** aflopen (+40 energie, melding).
9. `tickSeason(db, nowMs)` — **real-time seizoensklok** (`core/game/season.ts`): zet
   `world.seasonWeek`/`seasonEndsAt`, en bij het einde van week 4 → `runSeasonEnd`
   (prijsuitreiking Roekoes + Vleugels, **sponsorreview** via `reviewSponsorContracts`,
   geld + meldingen, ranglijst reset, seizoen++).
9b. `payFinishedFlightPrizes(db, nowMs)` (vóór `tickFlights`) — **betaalt prijzengeld
   uit zodra een duif finisht**, niet pas bij afronding. Per live wedstrijd-/titanvlucht:
   `computeFinishPayouts(flight)` (flight.ts) leidt uit de **bevroren sim** de finisher-
   ordening af (zelfde sort als finalize → identieke rank/prijs), en voor elke finisher
   met `finishSeconds ≤ elapsed` + prijs > 0 + nog niet betaald wordt `loft.money += prize`
   gezet, `SimEntry.prizePaid = true` (idempotent, rijdt in `sim`-JSON) en een melding
   gestuurd (stabiele id `ntf:prize:<flightId>:<pigeonId>`). Veilig want een finisher-rank
   ligt vast zodra ze finisht (een snellere duif die opgeeft, geeft op vóór haar finish).
   Punten/medailles/bets/prestaties blijven bij de afronding.
10. `tickFlights(db, nowMs, ...)` — laat vluchten `scheduled → live → completed`
   overgaan (deterministische `finalizeFlight`; **oefenvluchten** via
   `finalizePracticeFlight`; dode duiven uit `sim.deaths` worden verwijderd; werkt
   ook per-seizoen duivenstatistieken bij: `seasonPeakSpeed`, `seasonPodiums`).
   `finalizeFlight` telt het **al vroeg uitbetaalde prijzengeld niet nog eens** mee
   (`acc.prize += s.prizePaid ? 0 : prize`); punten/wins blijven volledig.
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
  echt tijdverlies en een forse val in de stand, maar de duif **finisht nog steeds**
  (late thuiskomst; er is geen tijdslimiet meer die haar wegstreept).
- **Onderweg opgeven** (`dnfAtSeconds`/`dnfKind`) — uitputting (lage start-energie via
  `FLIGHT_RISK`) of blessure (kans ↑ bij ruw weer): de duif stopt zichtbaar midden in
  de vlucht en finisht niet.
Live posities komen uit `raceProgress(sim, distance, elapsed)` (stukje-per-stukje
afstand); **live-rangschikking = op afgelegde afstand** (verst = leider), aangekomen
duiven vooraan (op finishtijd), opgegeven/uitgevallen achteraan. `liveSnapshot`
**bevriest de stand op `total`** zodra de race klaar is, zodat de replay de eindstand
toont. `total = flightTotalSeconds` = de **traagste duif die effectief finisht** (géén
cutoff meer). `finalizeFlight` bepaalt DNF **uit ditzelfde bevroren profiel** — enkel
**zelf opgegeven** (`gaveUp`) of **onderweg uitgevallen** (`dnfAtSeconds`, uitputting/
blessure); trage/verdwaalde duiven komen gewoon (laat) thuis — dus **live-einde ==
einduitslag**.
**Élke duif kan presteren, geordend op kwaliteit** (afgesteld op `dayNoise`/tails,
±17%): getest op een veld van 6 (beste→slechtste) over alle weertypes gaf ~ win /
top-3 / niet-laatste / laatste: beste **40% / 76% / 94% / 6%**, slechtste **2% / 12% /
60% / 40%**, monotoon aflopend ertussen. Dus: de beste is het **waarschijnlijkst**
(niet zeker) en wordt **zeer zelden laatste**; de slechtste heeft een **heel kleine**
winkans maar haalt geregeld top-5 (van 6). Balansknoppen in `FLIGHT_DYNAMICS`
(`dayNoise` breder = meer upsets; `segSpread` = zichtbaarder inhalen; `weatherSpread`;
`lost*`). Energie wordt nog steeds **geleidelijk** afgetrokken (`tickFlightEnergy`, per
30 min); opgeven spaart de resterende energie.

**Live verslag = échte gebeurtenissen (`flightCommentary` in `flight.ts`).** Het
📻-verslag naast het live-bord is geen willekeurige grap meer maar wordt **afgeleid
uit het bevroren `sim`**: het bemonstert het veld elke `COMMENTARY_INTERVAL_SECONDS`
(10 min) via `raceProgress` en meldt **wie wie voorbijsteekt** (positiewissels tussen
twee nog-vliegende duiven), met de **reden** waar die duidelijk is: overtaker
versnelt (`curMult`>1.15 → `overtakeSurge`), ingehaalde zakt weg (`curMult`<0.8 →
`overtakeTired`), ingehaalde is **verdwaald** (`SimEntry.lost` actief →
`overtakeLost`, met ~detourKm), of een **koploperwissel** (`leadChange`). Plus
eigen-oorzaak-lijnen op hun tijdstip: **van koers** (`stray`, ~X km omweg),
**uitputting**-DNF (`dnfExhausted`), **kramp/blessure**-DNF (`dnfInjury`), **opgeven**
(`pulled`) en aankomsten (`finish`). Een blijvend heen-en-weer wisselend paar wordt
**gedempt** (pair-cooldown van 3 intervallen), behalve bij een koploperwissel of
verdwaalde duif. Volledig **deterministisch** (geseed op `flight.id`) → stabiel over
polls, groeit monotoon (elke regel vast tijdstip, gefilterd op `elapsed`). Legacy-
vluchten zonder pace-profiel vallen netjes terug op enkel start-/finish-lijnen.
Tekstpools in `gameConfig.COMMENTARY` (categorieën `overtake`/`overtakeSurge`/
`overtakeTired`/`overtakeLost`/`leadChange`/`stray`/`dnfExhausted`/`dnfInjury`/
`pulled`/`start`/`finish`).

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
│   ├── d1.ts                    D1-persistentie (load(viewerId)/diff/ensureSchema/
│   │                            boundedCleanups/findUserBy*, auction_bids)
│   ├── auth.ts                  wachtwoord-hash + JWT via Web Crypto
│   ├── presenters.ts            entiteit → client-DTO (pigeonDTO(db,p,viewerId?) → dailyCare + info-hiding)
│   └── game/
│       ├── engine.ts            speler-acties (buy/train/enter/giveUpFlight/breed/…)
│       ├── schedule.ts          advanceRealtime + data-migraties + alle ticks
│       ├── flight.ts            vluchtsim (velocity, DETERMINISTISCHE finalize, live; geen finish-timer)
│       ├── betting.ts           weddenschappen (Monte-Carlo odds + settle, stats,
│       │                        void+refund bij uitschrijven duif / afgelaste vlucht)
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
├── d1-partial-load.test.mts     regressietest op de partiële load (npx tsx, node:sqlite)
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
- `Pigeon.breed?` — **ras** (breed-id, kolom `breed TEXT`; zie §Rassen). Puur
  cosmetisch: bepaalt de **foto** + een kleine **prijstoeslag** via de rarity, géén
  effect op eigenschappen/prestaties. Toegewezen via gewogen loting bij ontstaan
  (`rollBreed` in `pigeon.ts`); geërfd bij kweek (zelfde ras behouden, anders `mixed`).
  Migratie **v23** backfilt bestaande duiven.
- `Pigeon.genes?` — **genetische plafonds** `{speed,endurance,orientation}` (kolom `genes`
  JSON, ≤95). Bepalen hoe ver elke racevaardigheid kan groeien (zie §5-Genen), de waarde, en
  erven over. Migratie **v29** backfilt.
- `Pigeon.declineRate?` — **verouderingstempo** (~0.6–1.6, kolom `decline_rate REAL`); drijft
  `runAgeDecline`. Erft over. Migratie **v29**.
- `Pigeon.attrLog?: AttrChange[]` — **auditlog van skill-wijzigingen** (kolom `attr_log` JSON,
  cap 40). Elke verandering aan snelheid/conditie/oriëntatie wordt gelogd via
  `noteAttrChange(p, attr, before, reason)` (pigeon.ts) met `from/to/reason/at`. Redenen:
  `training`/`coach`/`vlucht`/`veroudering`/`premiumvoer`/`gebeurtenis: …`. Geen fantoom-entry
  als de afgeronde (0,1) waarde niet beweegt. Zichtbaar in de admin-duifinspector. Startte bij
  uitrol (geen historiek van daarvoor).
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
- `SimEntry.lost?: { atSeconds, detourKm } | null` — een **verdwaal-stuk** (lage
  oriëntatie), bij de start bevroren zodat het **live verslag** de reden kan noemen
  (van koers, ~detourKm km omweg). Rijdt mee in de `sim`-JSON (geen migratie).
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
  `DAILY_UPKEEP_PER_PIGEON 2`, `COACH.dailySalary 80`, `INFIRMARY.doctorSalary 57` /
  `physioSalary 50` / `medicatedFoodPerBird 6`. Aangerekend in `tickDailyCare` via
  `economy.dailyRunningCost`; sponsorbijdrage dagelijks (weekbedrag ÷ 7).
- **Privécoach = dagelijkse groei richting de gen-cap** (`COACH`): geen instapdrempel
  (`hireCost 0`), enkel **€80/dag per gecoachte duif** (`dailySalary`). `coachDailyGain(attr,
  cap) = COACH.maxDailyGain (1.1) · (cap − attr)/cap` — werkt op **elk niveau**, afnemend
  richting de cap, **0 op/boven de cap** (per eigenschap onafhankelijk). Enkel de coach
  passeert 90 (trainen ≤80, vluchten ≤90). `applyDayOfCare` drilt per attribuut en geeft
  `experienceDailyGain 0.5` zolang er nog minstens één eigenschap onder haar cap zit. Werkt
  niet terwijl de duif vliegt. `pigeonDTO.coachGain` (per attribuut) voedt de UI;
  `attributeCap`/`coachMinAttr`/`eliteGainPerDay` bestaan niet meer. Zie ook §5-Genen.
- **Dagopdrachten/streak verlaagd** (missions.ts): opdrachtgeld ~gehalveerd (15–60),
  streakbonus `min(25, 5 + streak·2)` → samen ~€750/week i.p.v. ~€1750.
- **Weddenschap max inzet €500** (`BETTING.maxStake`, was 5000).
- **Prijzengeld (nieuwste, `PRIZE_MONEY`)** — verhoogd: regionaal `[800,600,350,220,140,90,55,30]`
  (8 pl.), nationaal `[1200,800,500,320,210,140,95,60,40,25]` (10 pl.), internationaal
  `[2200,1800,1000,650,420,270,170,100]` (**8 pl.**, was 12). Titan `[1800,1200,900]`.
- **Inschrijfgelden gehalveerd (nieuwste)** (`FLIGHT_TIERS.entryFee`): regionaal **€10**
  (was 20), nationaal **€20** (was 40), internationaal **€40** (was 80); **Titan €50**
  (`TITAN.entryFee`, was 100). Oefenvluchten blijven gratis.
- **Voeding (`FEED_RATIONS`)** — herstelwaarden zijn WEKELIJKS, 1/7 per dag (UI toont
  per dag): Normaal energie **+21**/wk, Premium **+28** (+conditie/gezondheid),
  Libido-mix **+18** (+libido), Herstel **+42** (veel energie).
- **Rustbonus (`REST_BONUS`)** — elke **3e** gevoede rustdag zonder vlucht **+4**
  energie; reset zodra de duif vliegt of een hongerdag heeft.
- **Honger (`STARVATION`)** — geen voorraad = versnellende daling (energie 8·N,
  gezondheid 5·N, libido 4·N per honger-dag N); sterftekans vanaf dag 3, zeker vanaf
  dag 7. **Honger raakt géén trainbare skills meer** (conditie-daling geschrapt;
  `conditiePerDay` ongebruikt): trainbare skills dalen enkel via `runAgeDecline`.
- **Vlucht-energiekost (`FLIGHT_FATIGUE`)** — volle-routekost = `(10 + afstand/30)·ervaringsfactor
  + rand(0..10)`, bevroren bij start, **per 30 min** geleidelijk afgetrokken. Een duif betaalt
  **enkel voor het afgelegde deel**: de aftrek (in `tickFlightEnergy` én de finale-settlement)
  stopt op `dnfAtSeconds` voor een **DNF**-duif, dus die betaalt `formCost·(dnfAtSeconds/duur)`
  i.p.v. de volle route; een finisher betaalt de volle route; een `gaveUp`-duif enkel wat al
  geleidelijk werd afgetrokken. **Geen extra DNF-straf** (`exhaustionPenalty`+jitter verwijderd) —
  geen punten/prijs + de gezondheids-/blessureklap is straf genoeg. `stepMinutes: 30`. **Ervaringsfactor** = `1 − (ervaring/100 −
  0.5)·experienceReliefSpread` (spread 0.5 → draaipunt ervaring 50 = ×1.0, ervaring 0 =
  ×1.25 méér verbruik, ervaring 100 = ×0.75 minder). Onervaren duiven verbruiken dus
  meer, ervaren minder. NB: dit staat los van de ervaring-**dosering** in het snelheids­
  model (`ENERGIE_IMPACT`), die enkel de *prestatie* raakt, niet het verbruik.
- **Genen & caps (`GENE`, cruciaal):** elke duif heeft een **gen-cap per racevaardigheid**
  (`Pigeon.genes`), **nooit ≥ 96** (`ceil 95`, `floor 70`). Trappen: **trainen `trainCap 80`**,
  **vluchten `raceCap 90`**, **coach → gen-cap** (`coachMinAttr 90`). Helpers `trainCeil`/
  `raceCeil`/`geneCap`/`avgGeneCap` (pigeon.ts). Premiumvoer-conditie capt nu op `min(80,
  geneCap)` (niet meer `FOOD_ENDURANCE_CAP 92`). Overerving via `GENE.mutation 6`. Waarde
  ×`potentieelFactor=(avgGeneCap/82)³`. Nieuwe duiven: startwaarde ≤ cap; bestaande (v29) mogen
  boven hun cap staan en behouden dat.
- **Veroudering (`AGING`):** `runAgeDecline` trekt boven `peakEndWeeks 208` per gerolde
  gameweek `declinePerWeekBase(0.08)·(leeftijd−208)/52·declineRate` van de 3 skills af
  (bodem `floor 5`). `Pigeon.declineRate` ~0.6–1.6. `AGE_CURVE` neerwaartse tak afgevlakt → 1.0.
- **Snelheidsmodel (`DISTANCE_WEIGHTING` + `ENERGIE_IMPACT`):** korte-vlucht­weging
  snelheid **0.65** / conditie 0.13 / oriëntatie 0.22 (was 0.55/0.20/0.25); lang
  0.20/0.45/0.35. Energiefactor is **afstandsafhankelijk** (kort `0.80→1.05`, lang
  `0.45→1.20`, geblend op `t`) en werkt op de **effectieve energie** = `energie +
  (ervaring/100)·(100−energie)·0.35` (ervaring laat energie **doseren**). Zie
  `pigeonVelocity` + `velocityBreakdown` in `flight.ts`.
- **Training (`TRAINING`):** −15 energie, +~1.2 eigenschap, +4 ervaring, **cap `trainCeil`
  (min 80, gen-cap)**. **Kost exponentieel**: `trainingCost(v)=max(15, round5(costBase 0.6·
  costGrowth 2.9^(v/10)))` → ~€125 @50, ~€1035 @70, ~€2700 @79→80. `pigeonDTO.training[attr]=
  {cost,cap}`. **`cooldownDays: 7`** — elke categorie max. 1×/week (`Pigeon.trainedAt`);
  `trainAvailableAt` + `training` vergrendelen/beprijzen de knoppen op `PigeonPage`.
- **Vluchtrisico (`FLIGHT_RISK`):** onder ~22 energie DNF-kans; onder ~25 extra
  blessurekans. **Geen finish-timer/cutoff meer** (`FLIGHT_CUTOFF_MINUTES` verwijderd):
  `flightTotalSeconds` = de traagste duif die effectief finisht, dus trage/verdwaalde
  duiven worden niet meer weggestreept. Enkel `gaveUp`/`dnfAtSeconds` = DNF.
- **Kweken (`BREEDING`):** ouders minstens **20** energie (`minParentForm`, was 40);
  meer energie+libido = sneller een jong.
- **Ziekenboeg (`INFIRMARY`):** basiscapaciteit **2** (was 4); upgrades 3/4/5/6 voor
  €800/1200/1800/2400 (`INFIRMARY_CAPACITY_TIERS`). Dokter €400/wk, kinesist €350/wk,
  medicatievoer €45/duif/wk. **`energyRecoveryFactor 0.5`** — een duif in de ziekenboeg
  recupereert energie enkel als ze **door staf gedekt** is (`coveredInInfirmary`: dokter=
  ziekte, kinesist=kwetsuur) en dan aan **50 %** van het gezonde voer-tempo; ongedekt = 0.
  In de boeg geen rustbonus (zie §Verzorging).
- **Herstel (`HEALING`)** — real-time: `baseHoursOutside` licht 120 / matig 264 /
  ernstig 432 (uren rustend in hok); ziekenboeg ×1,8, dokter/kinesist ×1,4,
  medicatievoer ×1,2 (stapelen → volle zorg ×~3). Volle zorg: licht ~1,5 dag /
  matig ~3,5 dagen / ernstig ~6 dagen — een aandoening is bewust een echte
  tegenslag (was ~1 dag voor matig). `updateHours: 12` (statusupdate-cadans).
- **Ziekte/impact (`HEALTH`)** — `runHealthDay` draait nu **real-time** per dag
  (zie tick 4). Nieuw: `ailmentHealthDrainPerDay` licht 0,6 / matig 1,5 / ernstig
  2,5 gezondheid/dag zolang de duif aan een aandoening lijdt, `×ailmentDrainOutsideFactor`
  (1,5) buiten de ziekenboeg. Besmetting/spontane ziekte (`contagionPerSource` 0,11,
  `spontaneousIllness` 0,05, wekelijks) en ailment-sterfte (`ailmentMortality*`) worden
  weekkans→dagkans omgerekend (`1−(1−p)^(1/7)`). **Ouderdomssterfte** (`ageMortality`
  / `MORTALITY_CURVE`) draait in `runAgeMortality` **per gerolde gameweek** (rauwe
  weekkans), gedreven door de 4× real-time veroudering (`GAME_WEEKS_PER_REAL_WEEK`).
  `runHealthWeek` (admin) behoudt de oude wekelijkse variant.
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
  `entryFee 50`, `prizes [1800,1200,900]`. **Enkel geld** voor de melker-economie: geen
  **seizoenspunten**/medailles/wins, telt **niet** mee voor de **melkerranglijst (Roekoe)**;
  **max. 1 duif per hok** (`enterFlight` + bots 1 vogel); geen wedden (`bettingOpen`).
  Prijzengeld via `finalizeFlight` (`flight.titan` → `TITAN.prizes`, 0 punten, 0 wins).
  **Telt sinds kort wél mee voor de duivenranglijsten (Vleugel):** in `tickFlights` draait
  de per-seizoen-stats­update (`seasonPeakSpeed`/`seasonPodiums`) óók voor titans, en titan-
  groei gaat **niet** meer naar `seasonPracticeGain` (dus vooruitgang telt mee). Enkel de
  melker-economie-stappen (badges/medailles, bets, missies, sponsorbonus) blijven over-
  geslagen via `if (flight.titan) continue;`. Duiven verbeteren sowieso normaal.
- **Wedstrijd-annulering:** een niet-oefenvlucht met **< 2 verschillende eigenaars**
  bij de start wordt afgelast (`tickFlights`), inschrijfgeld **terugbetaald** per
  ingeschreven duif + melding. Oefenvluchten mogen solo doorgaan.
- **Duivenranglijsten tellen wedstrijdvluchten én de titanenwedstrijd** (enkel
  oefenvluchten niet). Snelheid/podiums negeren enkel practice; **vooruitgang** trekt de
  practice-groei af via `Pigeon.seasonPracticeGain` (kolom `season_practice_gain`, enkel
  door practice gevuld), bijgewerkt in `tickFlights` en gereset bij seizoenswissel. De
  **melkerranglijst (seizoenspunten)** telt titan/practice níet (0 punten uit `finalizeFlight`).

---

## 6. Client-pagina's (`client/src/pages/`)

- `DashboardPage` — home. **Seizoen-sectie** onder de stat-tegels: "Seizoen X · week
  Y/4" + badge met **dagen tot de volgende speelweek** (`nextPlayWeek`+`timeUntil` in
  `ui.tsx`; week 4 → "nieuw seizoen"). Voorraad per voertype (kopen), voer-effecten **per dag** in
  **tekst** (energie/gezondheid/conditie/libido). Tegel "**Ziek/gewond in je hok**"
  (ziekenboeg telt niet mee). **Klikbare tegel "Dagelijkse kosten"** — **full-width,
  onderaan de tegelrij** (`gridColumn: 1 / -1`, zodat het oneven tegelaantal er niet
  scheef uitkomt) — toont de cumulatieve dagkost (`loft.dailyCosts.total`); klikken opent
  een **onderverdeling** (vast onderhoud, onderhoud per duif, privécoach, duivendokter,
  kinesist, medicatievoer + totaal & ≈weekbedrag) — cijfers uit `loft.dailyCosts`
  (`dailyRunningCostBreakdown` in `economy.ts`, zelfde bron als de dagelijkse afrekening in
  `tickDailyCare`). De onderverdeling is een **flex-lijst (geen `table.data`)** — die heeft
  `white-space: nowrap` op cellen en liep op gsm horizontaal over; nu wrapt/​krimpt de
  labelkant (`min-width:0`) en blijft het bedrag rechts staan (`flex-shrink:0`). Dagopdrachten.
  Beheerder-kaart (admin): "Volgende week" + "Toon recente veilingen" (biedgeschiedenis).
- `LoftPage` (Mijn hok) — duivenlijst met per duif: voerkeuze-select, apart/samen-knop
  (of "🏥 Ziekenboeg"-label als ze daar zit), verkoop, uitbreidingen. De statbalken
  tonen een **▲/▼ per dag** (groei/daling door je huidige keuze; via `pigeon.dailyCare`).
- `PigeonPage` — één duif: stats, afstamming, historiek; training; coach; voerkeuze;
  **rustkuur** (POST `/pigeons/:id/restcure`); hernoemen; **"Afscheid nemen"**
  (POST `/pigeons/:id/release` = vrijlaten, geen geld; POST `/pigeons/:id/restaurant`
  = verkoop aan het duivenrestaurant voor €50 + moraal-energieklap op de rest van het
  hok). Beide met bevestigingsstap; geblokkeerd zolang de duif ingeschreven/koppelt.
  (De per-dag-▲/▼ staan in het hokoverzicht, niet hier.)
- `FlightsPage` — kalender/uitslagen; inschrijven; weddenschap-paneel (max. 1/vlucht,
  o.a. type **top3**). **Oefenvluchten** krijgen een eigen badge, tonen "gratis" i.p.v.
  inschrijfgeld en hebben geen weddenschap-paneel.
- `LiveFlightPage` — live bord; knop **🏳️ Opgeven** (spaart resterende energie).
  Het **📻 Live verslag** meldt nu échte gebeurtenissen (voorbijsteken + reden), zie §2.
- `InfirmaryPage` (Ziekenboeg) — zieke/gekwetste duiven; dokter/kinesist/medicatievoer;
  **herstelbalk per duif** (`ailment.healed`).
- `ProfilePage` — hoknaam, **thema-toggle (donker/licht)**, **"Start rondleiding"**.
- `RankingPage` — tabs **Melkers** (seizoenspunten) + **Duiven** (drie ranglijsten:
  hoogste gemiddelde vluchtsnelheid, meeste podiums, meeste vooruitgang — via `state.pigeonRankings`).
  Kop toont "Seizoen X · week Y/4 · nog Z dagen" (tot seizoenseinde) + een tweede regel
  met **dagen tot de volgende speelweek** (`nextPlayWeek`+`timeUntil`).
- `AchievementsPage` (Prestaties) — tabs Badges · Trofeeën · **Seizoensprijzen**
  (Roekoes + Vleugels: tellingen goud/zilver/brons + erelijst uit `profile.awards`).
- `WikiPage` (`/wiki`, nav 📖 **Wiki**) — **statische**, client-only uitlegpagina van
  de strategie-bepalende mechanismen + kansen (energie/herstel, vlucht-verbruik, DNF/
  blessure/dood bij lage energie, broedkans, ziektekans, sterfte, ras-rariteit). Bewust
  **niet 100% transparant**: richtwaarden i.p.v. exacte formules, geluk blijft benoemd.
  Geen backend/kosten. Cijfers **handmatig** in sync houden met `core/config/gameConfig.ts`.
- `AdminPage` (`/beheer`, **enkel admins**) — uitbreidbare **beheerconsole** (tabs).
  Eerste tool **Vlucht-analyse**: per duif van een afgeronde vlucht de volledige
  snelheidsontleding (eigenschappen + weging + energie/gezondheid/ervaring/leeftijd-
  factoren + berekende vs. echte snelheid + residu ≈ geluk). Nav-link + route enkel
  bij `state.isAdmin`; API's `GET /admin/flights` en `GET /admin/flight-analysis/:id`
  checken `user.isAdmin` (403 anders). Kern: `velocityBreakdown()` in `flight.ts`.
  Tweede tool **Duif-inspector** (`GET /admin/pigeons?q=`): exacte opgeslagen waarden
  (op 0,1) van élke duif (eigen of andermans) — skills, gen-caps, `birthWeek`/leeftijd,
  `declineRate` + **verouderingsdiagnose** (`aging` enkel > `AGING.peakEndWeeks`, met de
  exacte `declinePerWeek`), plus een **uitklapbaar wijzigingslogboek** (`Pigeon.attrLog`):
  elke skill-verandering met reden + tijdstip. Zo verifieerbaar óf, wanneer én waardoor
  een duif zakt/stijgt.
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
volledige `STEPS`). De volledige tour dekt o.a. **rassen** (`BREED_STEP`, anker
`[data-tour="pigeon"]`: foto/zeldzaamheid/kans/kweek), oefenvluchten, rustkuur, markt +
**"🕊️ Bied op andermans duiven"** (anker `[data-tour="market-bid"]`: speler→duif→
bedrag + verborgen eigenschappen), **seizoen, ranglijst (Roekoe), duivenranglijsten
(Vleugel)** en de prestige-seizoensprijzen. Eenmalig per speler (localStorage
`roekoe.tourSeen.<id>`), draait vanuit `Layout` (blijft gemonteerd tijdens navigatie);
de profielknop herhaalt hem via `window.dispatchEvent(new Event('roekoe:start-tour'))`.

**"Wat is nieuw"-melding:** dezelfde `Tour` maar met een **subset** stappen. Actueel
= **`FAREWELL_NEWS_STEPS`** (afscheid nemen: intro + vrijlaten vs. duivenrestaurant +
moraal-energieklap). Eigen localStorage-sleutel `roekoe.newsSeen.farewell.<id>`; toont
pas als de hoofd-tour niet open is. `closeTour` zet ook de news-sleutel, zodat een
nieuwe speler die de volledige tour afrondt niet nog eens de news krijgt. Bump de
sleutel-suffix + wissel de `steps`-set (import in `Layout`) voor een volgende
aankondiging. De vorige sets `BREED_NEWS_STEPS`, `BID_NEWS_STEPS` en `SEASON_NEWS_STEPS`
blijven in `Tour.tsx` als referentie. (De oude `FeatureTour` met gecentreerde kaarten
is verwijderd — alles zit nu in `Tour`.)

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
Uitzondering die **wél blijft staan**: `d1-partial-load.test.mts` — persistentie is
te subtiel om op zicht te vertrouwen. Draai die na **elke** wijziging aan `core/d1.ts`:
```bash
npx tsx d1-partial-load.test.mts
```
(Staat buiten `tsconfig.json` (`include` = `core/` + `functions/`), dus tsc raakt hem niet.)

### Git + deploy (ALTIJD, zie §0)
1. Ontwikkel + commit op **`claude/hallo-49m6hj`**; push met
   `git push -u origin claude/hallo-49m6hj` (retry met backoff).
2. **Deploy meteen naar productie** door de commit op de deploy-branch te zetten:
   ```bash
   git fetch origin claude/roekoe-game-website-jwa0vo
   git checkout claude/roekoe-game-website-jwa0vo
   git reset --hard origin/claude/roekoe-game-website-jwa0vo
   git cherry-pick <commit>        # of meerdere
   # typecheck + build ter controle
   git push -u origin claude/roekoe-game-website-jwa0vo   # triggert Cloudflare Pages
   git checkout claude/hallo-49m6hj           # terug naar dev
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
**`dataVersion = 30`**.

**503-fix ronde 2: `ensureSchema` blies de 50-querylimiet op (nieuwste)**
- De 503-golf kwam terug, maar **niet** door het dagquotum (metrics: 273 k van 5 M
  gelezen rijen). Oorzaak: `ensureSchema` vuurde **71 losse D1-statements** af bij
  **elke cold start**, tegen een limiet van **50 queries per Worker-invocatie** op
  het gratis plan → zo'n verzoek sterft vóór het het spel bereikt, op eender welke
  route (ook inloggen). Nu **gegate op `world.schema_version`**: 1 query op een
  bijgewerkte database. **Bump `SCHEMA_VERSION` bij elk nieuw statement.**
- Meegenomen: **featherweight inlogpad** (~1 rij i.p.v. ~1300) + **partieel laden**
  van `notifications`/`bets`/`trades` + **SQL-begrenzing** + **indexen** — die
  drukken vooral de CPU per verzoek (10 ms-limiet). Details, cijfers en verificatie:
  §Performance & stabiliteit onderaan. **Geen migratie / geen `dataVersion`-bump.**

**Trainbare skills dalen enkel door ouderdom + Tinne-correctie (nieuwste)**
- **Invariant:** snelheid/conditie/oriëntatie kunnen **enkel dalen via `runAgeDecline`**
  (ouderdom > `AGING.peakEndWeeks`). **Honger vreet geen conditie meer** (de
  `endurance`-daling in `applyDayOfCare`/`projectDailyCare` is geschrapt; honger blijft
  energie/gezondheid/libido + sterfte). Exhaustieve grep bevestigde dat er verder geen
  enkel pad een skill verlaagt (events/training/coach/vluchten verhogen enkel; de bot-
  `trim` v15 was eenmalig en bot-only). Zo verliest een (jonge, gevoede) duif nooit
  **onterecht** skill-levels.
- **Migratie v30:** eenmalige correctie — "Tinne de Doodskist-Ontwijker" (echte speler)
  terug naar **79 snelheid** (enkel omhoog, gelogd via `noteAttrChange` als
  `admin-correctie`). Haar 79→78 was een afrondingsartefact; bij 41 weken kan geen enkel
  mechanisme haar snelheid verlagen. **dataVersion → 30.**

**Prijzengeld direct bij finish (nieuwste)**
- Prijzengeld wordt uitbetaald **op het moment dat een duif finisht**, i.p.v. te wachten
  tot de hele vlucht is afgerond (kon lang duren door een trage/verdwaalde duif). Nieuwe
  tick `payFinishedFlightPrizes` (zie §2, item 9b) + helper `computeFinishPayouts` (flight.ts).
  Idempotent via `SimEntry.prizePaid`; `finalizeFlight` trekt het al-uitbetaalde af. **Enkel
  geld** gaat vroeg; punten/medailles/weddenschappen/prestaties blijven bij de afronding.
  Geen migratie/schemakolom (rijdt in `sim`-JSON). Geverifieerd met tsx (rank==finalize,
  geen dubbele uitbetaling, gedeeltelijke uitbetaling). Inschrijfgelden bovendien gehalveerd
  (regio €10 / nat €20 / intl €40 / titan €50).

**Genen, groeitrappen, exponentiële trainingskost & veroudering**
- Elke duif heeft nu een **genetisch plafond per racevaardigheid** (`Pigeon.genes =
  {speed,endurance,orientation}`, JSON-kolom `genes`) — **nooit ≥ 96** (`GENE.ceil 95`).
  Geloot via `rollGeneCap` (bell 70–96, quality-shift, clamp 70–95); `generatePigeon`
  clampt de startwaarde ≤ cap. Verdeling ~centraal 82–85, 95 & 70 zeldzaam. Helpers in
  `pigeon.ts`: `geneCap`/`avgGeneCap`/`trainCeil`(min80,cap)/`raceCeil`(min90,cap)/
  `trainingCost`/`rollGenes`.
- **Drie groeitrappen** per vaardigheid: **trainen ≤ 80**, **vluchten ≤ 90**, **coach
  → gen-cap** (enkel de coach passeert 90). `engine.trainPigeon` cap = `trainCeil`;
  `flight.ts` (finalize + practice + `applyFlightEffects` + racing-conditie) clampt op
  `raceCeil`; premiumvoer-conditie (`economy`) capt op `min(80, geneCap)`. Grandfathered
  duiven boven hun cap worden **nooit verlaagd** (guards `current < cap`).
- **Coach werkt op elk niveau, dooft uit richting de gen-cap** (`COACH.maxDailyGain 1.1`):
  `coachDailyGain(attr, cap) = 1.1·(cap−attr)/cap`, **0 op/boven de cap**, per eigenschap
  onafhankelijk; enkel de coach passeert 90. (Oude `attributeCap 100` + de tussentijdse
  `eliteGainPerDay`/`coachMinAttr 90`-variant zijn **verwijderd** — de coach doet dus **niet**
  enkel boven 90.) `applyDayOfCare` drilt per attribuut, geeft ervaring zolang er iets te
  groeien valt. `pigeonDTO` stuurt `coachGain` per attribuut.
- **Trainingskost exponentieel** (`TRAINING.costBase 0.6`, `costGrowth 2.9`, `costMin 15`):
  `trainingCost(v) = max(15, round5(0.6·2.9^(v/10)))` → ~€125 @50, ~€1035 @70, ~€2700 @79→80.
  `pigeonDTO.training[attr] = {cost, cap}`; `bots.ts` volgt dezelfde regels.
- **Waarde ~ genen**: `estimateValue` × `potentieelFactor = clamp((avgGeneCap/82)³, 0.6, 1.7)`
  → hoge genen = duurdere duif, ook bij lage huidige stats.
- **Overerving** (`breeding.ts`): kind-cap = `avg(ouder-caps) ± GENE.mutation` (clamp 70–95),
  `declineRate` idem; startwaarden geclampt op de kind-cap.
- **Veroudering = échte terugval** (`health.runAgeDecline`, per gerolde gameweek in
  `tickDailyCare`): boven `AGING.peakEndWeeks (208)` zakken de 3 skills met
  `declinePerWeekBase(0.08)·(leeftijd−peak)/52·declineRate`. `AGE_CURVE` **neerwaartse
  tak afgevlakt** naar 1.0 (dubbele bestraffing vermeden). `Pigeon.declineRate` (~0.6–1.6,
  kolom `decline_rate`).
- **Persistentie**: `ensureSchema` + kolommen `genes TEXT` / `decline_rate REAL`; rowToPigeon
  + INSERT uitgebreid. **Migratie v29** backfilt genen + declineRate voor bestaande duiven
  (caps onafhankelijk gerold → bestaande hoge duiven zitten mogelijk boven hun cap en
  behouden hun waarde). **dataVersion → 29.**
- **UI**: rood, klikbaar **cap-streepje** op de statbalken van snelheid/conditie/oriëntatie
  (`StatBar` `cap`-prop + `PigeonStats` uit `pigeon.genes`); `PigeonPage` toont per-eigenschap
  de geschaalde trainingskost + plafond, en de nieuwe coach-uitleg (o.b.v. `coachGain`).
  Wiki-sectie **🧬 Genen & training**; tour-stap `GENE_STEP`; eerste-login-melding
  `GENES_NEWS_STEPS` (sleutel `roekoe.newsSeen.genes.<id>`).

**Energie-recuperatie in de ziekenboeg**
- Een duif in de **ziekenboeg** recupereert nu energie aan **50 %** van het gezonde
  voer-tempo (`INFIRMARY.energyRecoveryFactor 0.5`) — en **enkel als ze door staf gedekt
  is** (dokter voor een ziekte, kinesist voor een kwetsuur, via de bestaande
  `coveredInInfirmary`-dekking die ook het herstel versnelt). Een **ongedekte**
  ziekenboeg-duif krijgt **geen** energie meer (was voorheen het volle tempo). In de boeg
  telt ook de **rustbonus** niet meer mee, zodat dit halve voerherstel de enige energiebron
  in de ziekenboeg is.
- `economy.ts`: `applyDayOfCare(loft, pigeons, livePigeonIds, coveredInfirmaryIds?)` — de
  voer-energiewinst wordt ×`energyRecoveryFactor` (gedekt) of ×0 (ongedekt) voor
  `p.inInfirmary`; rustbonus/rest-streak overgeslagen in de boeg. `projectDailyCare(loft, p,
  live, covered?)` spiegelt dit voor de ▲/▼-weergave in Mijn hok. `tickDailyCare`
  (schedule.ts) berekent `coveredInInfirmary(loft, owned)` en geeft de set door;
  `pigeonDTO` (presenters.ts) draait de dekking-scan **enkel voor ziekenboeg-duiven**
  (hot path blijft goedkoop). **Geen migratie** (config/logica), `dataVersion` blijft 28.

**Minimumafstanden per niveau**
- Wedstrijdvluchten hebben nu een **harde ondergrens**: regionaal **≥ 100 km** (was 0),
  nationaal **≥ 200**, internationaal **≥ 400** (die twee waren al zo). `FLIGHT_TIERS.regional.minKm`
  van 0 → **100**.
- `pickRoute` verscherpt: 120 pogingen + **beste-fallback op vensterafstand** (kiest het paar
  dat het dichtst bij `[minKm,maxKm]` ligt i.p.v. het eerste willekeurige paar), zodat de
  ondergrens gehaald wordt zolang de pool ze kan bereiken. Geverifieerd op 200k trekkingen:
  0% onder de floor voor alle drie de niveaus.
- **Oefenvluchten blijven kort**: `makeRealtimeFlight` routeert practice met
  `pickRoute(tier, 0)` (min-override 0), dus de regionale floor lengt ze niet op (avg ~75 km).
- **Migratie v28**: elke nog-**scheduled** wedstrijdvlucht onder haar tier-floor wordt
  her-routeerd via `pickRoute(tier)` (tier uit `f.type`, niet uit de afstand — een te korte
  nationale blijft dus nationaal). Practice, live/completed (bevroren sim) en titans blijven
  ongemoeid. **dataVersion → 28.**

**Apart hok komt vrij bij ziekenboeg + auto-terugname (nieuwste)**
- Een duif die naar de **ziekenboeg** gaat, **geeft haar aparte hok vrij** — de slot komt
  vrij en kan (tijdelijk of niet) aan een andere duif. Ze **behoudt intern haar
  compartment-vlag** terwijl ze geïsoleerd zit (om de slot te kunnen terugnemen), maar telt
  níet mee in de bezetting en krijgt géén rustbonus zolang ze in de boeg zit.
- **Auto-terugname bij genezing:** `setInfirmary(wantIn=false)` zet de duif terug in een
  apart hok **als er nog eentje vrij is** (anders komt ze zonder terug). Ze pakt nooit een
  slot af van een duif die er intussen in kwam, en een duif die **nooit** een apart hok had
  krijgt er ook geen.
- Implementatie: de compartment-vlag blijft staan bij binnenkomst (geen clear meer). De
  **rustbonus** in `economy.ts` (`applyDayOfCare` + `projectDailyCare`) gebruikt nu
  `compartment && !inInfirmary`; `pigeonDTO.compartment` toont `compartment && !inInfirmary`
  (intern behouden, extern verborgen tijdens de boeg). `compartmentsUsed` en de
  assign-check in `setPigeonCompartment` negeren ziekenboeg-duiven al; assign aan een
  ziekenboeg-duif blijft geweigerd. `PigeonPage`-knop toont "🏥 Ziekenboeg" (disabled) als
  de duif daar zit. **Migratie v27** (vorige stap) klaarde bestaande ziekenboeg-duiven —
  die enkele duiven nemen hun oude hok niet automatisch terug; nieuwe wel. **dataVersion = 27.**

**Finish-timer/cutoff verwijderd (nieuwste)**
- De **90-minuten-deadline** na de eerste finisher is **weg** (`FLIGHT_CUTOFF_MINUTES`
  verwijderd uit `gameConfig.ts`; import weg uit `flight.ts`). `flightTotalSeconds` geeft
  nu de **traagste duif die effectief finisht** (`Math.max(durations)`), zonder cap. Zo
  krijgt **elke duif de tijd om (mogelijk) thuis te komen** — een trage of **verdwaalde**
  duif wordt niet meer weggestreept omdat de kopvrouw al lang binnen is.
- `finalizeFlight`: de `timedOut`-set (duif voorbij de cutoff → DNF) is verwijderd; DNF is
  nu enkel **`gaveUp`** (zelf opgegeven) of **`dnfAtSeconds`** (onderweg uitgevallen door
  uitputting/blessure). `liveSnapshot`/`flightCommentary` lopen vanzelf mee (ze lezen
  `flightTotalSeconds`). `raceProgress` bevriest opgegeven/uitgevallen duiven al intern op
  `gaveUpAtSeconds`/`dnfAtSeconds`, dus de tail-ordening blijft juist. Keerzijde: een race
  kan langer duren (zeker met een verdwaalde duif) — bewuste keuze. Spelregels §3.3 herschreven.

**Titanenwedstrijd telt mee voor de duivenranglijsten (nieuwste)**
- De titan voedt nu de **drie duivenranglijsten** (⚡ gemiddelde snelheid / 🎖️ podiums /
  📈 vooruitgang) — vroeger werd ze daar volledig uit geweerd (behandeld als practice).
  Enkel **oefenvluchten** tellen nog nergens mee. De **melkerranglijst (Roekoe)** blijft
  ongemoeid: titan-resultaten dragen **0 seizoenspunten** (uit `finalizeFlight`), en geen
  medailles/wins/bets/missies/sponsorbonus.
- `tickFlights` (schedule.ts) is gesplitst: **enkel `flight.practice`** gaat naar
  `seasonPracticeGain` + `continue`; de per-seizoen-stats­update (`seasonPeakSpeed`/
  `seasonPodiums`) draait nu óók voor titans; daarna `if (flight.titan) continue;` slaat
  de melker-economie-stappen over. Zo telt de titan wél voor snelheid/podiums/vooruitgang,
  niet voor punten.
- **Migratie v26**: bestaande **afgewerkte titanvluchten die nog bewaard zijn** (2-daagse
  retentie → de recentste titan) worden nagerekend: `seasonPeakSpeed` opgetrokken naar het
  titan-ritgemiddelde + podiums geteld. **Vooruitgang** kan niet retroactief hersteld
  worden (de titan-groei zat al in `seasonPracticeGain` en is niet scheidbaar); geprunede
  oudere titans evenmin. **dataVersion → 26.**

**Weddenschap terugbetalen bij uitschrijven duif (nieuwste)**
- Een open weddenschap wordt nu **onmiddellijk geannuleerd + terugbetaald** zodra de
  duif waarop ze steunt uit een vlucht wordt gehaald — niet pas bij het afhandelen van
  de vlucht. `withdrawFlight` (engine.ts) roept `voidBetsForWithdrawnPigeon(db, flight,
  pigeonId)` (betting.ts) ná de `entries.splice`. Geldt voor `win`/`top3`/`own_top3`/
  `last` op die duif en `head2head` waar de duif óf de tegenstander verdwijnt;
  `mine_wins` valt pas als de eigenaar **geen** ingeschreven duif meer heeft in die
  vlucht. Terugbetaling via stabiele melding-id `ntf:bet:<betId>` (idempotent, deelt de
  id met de settle-melding → nooit dubbel).
- **Migratie v25** (`voidOrphanedBets` in betting.ts, aangeroepen in `runDataMigrations`):
  bestaande **open** weddenschappen waarvan de duif al niet meer meedoet worden
  terugbetaald — duif niet meer in `entries` van een `scheduled`/`live` vlucht, vlucht
  **afgelast** (completed met lege `results`, die liep nooit door `settleFlightBets`), of
  vlucht helemaal verdwenen. Normaal-afgewerkte vluchten regelen hun eigen bets en
  blijven ongemoeid.

**Afscheid nemen van een duif: vrijlaten + duivenrestaurant (nieuwste)**
- Twee nieuwe speler-acties op de duifpagina (enkel eigen duif, geblokkeerd zolang de
  duif ingeschreven/koppelt):
  - **Vrijlaten** — `releasePigeon(store, userId, pigeonId)` (engine.ts): verwijdert de
    duif, **geen geld**, geen bijwerkingen. Endpoint `POST /pigeons/:id/release`.
  - **Verkoop aan het duivenrestaurant** — `sellToRestaurant(...)` (engine.ts): **vast
    €50** (`PIGEON_RESTAURANT.payout`), en **elke andere duif in het hok verliest
    `randInt(1,5)` energie** (moraalklap, `form` geclampt ≥ 0). Endpoint
    `POST /pigeons/:id/restaurant`. Restaurantnaam **`Bistro De Laatste Vlucht`**.
  - Config: **`PIGEON_RESTAURANT`** (`gameConfig.ts`: `name`/`payout`/`moraleEnergyMin`/
    `moraleEnergyMax`). Beide acties delen `pigeonBusy` (racing/breeding-guard) +
    `purgePigeon` (verwijdert duif + laat openstaande `offers` erop vervallen mét
    melding aan de bieders; defensief ook breedingPairs/flight-entries). Elke actie
    stuurt de speler een bevestigingsmelding.
- Restaurant-config gaat mee in de **economy-DTO** (`/state`): `restaurantName`/
  `restaurantPayout`/`restaurantMoraleMin`/`restaurantMoraleMax` → `client/src/types.ts`
  `EconomyCosts`. UI: kaart **"⚠️ Afscheid nemen"** op `PigeonPage` (bevestigingsstap,
  `.btn.danger`). Wiki: nieuwe sectie **👋 Afscheid nemen**. Spelregels: **§9.2**.
- **Eerste-login-melding**: `FAREWELL_NEWS_STEPS` (Tour.tsx) + sleutel
  `roekoe.newsSeen.farewell.<id>` (import + key in `Layout.tsx` omgezet van breeds).

**Rassen (breeds) — nieuwste**
- Elke duif heeft een **ras** (`Pigeon.breed`, kolom `breed`): bepaalt de **foto** +
  een kleine **prijstoeslag** via de rarity, verder **puur cosmetisch** (geen effect
  op eigenschappen/prestaties). Config in `gameConfig.ts` (`PIGEON_BREEDS`,
  `BREED_RARITY`, `MIXED_BREED_ID`, `DEFAULT_BREED_ID`) — namen/gewichten/foto's
  gespiegeld van **roekoe.org/wiki/breeds**. 11 rollbare rassen (Algemeen/Ongewoon/
  Zeldzaam/Legendarisch) + `mixed` (Gemengd).
- **Toewijzing** via gewogen loting `rollBreed()` in `pigeon.ts` — zit in
  `generatePigeon`, dus alle bronnen (kweek/bots/veiling/opvangcentrum/events) krijgen
  automatisch een ras. **Kweek** (`breeding.ts::inheritBreed`): 2× hetzelfde ras →
  behouden, verschillend → `mixed`. **Prijs**: `estimateValue` × `breedPriceMult`
  (Ongewoon +8 %, Zeldzaam +20 %, Legendarisch +40 %).
- **Foto's** in `client/public/pigeon-images/` (`pigeon.png` + `1.png`…`10.png`).
  `PigeonAvatar` toont de rasfoto (rond kader, warmere rand voor zeldzaam/legendarisch),
  met de oude SVG als fallback. `PigeonPage` toont een **ras-badge** (naam · zeldzaamheid).
  DTO: `pigeonDTO.breed = { id, name, rarity, rarityLabel, image }` (publiek, ook voor
  andermans duiven — de foto is zichtbaar). Migratie **v23** backfilt bestaande duiven.
- **Persistentie**: `ensureSchema` voegt kolom `breed TEXT` toe; `rowToPigeon` +
  pigeon-`INSERT` uitgebreid.
- **Verzamelbadges** (`badges.ts`, nieuwe groep **`collection`** — 🕊️ Rassen):
  één "bezit dit ras"-badge **per ras** (`breed_own_<id>`, XP ∝ rarity), één badge
  **per zeldzaamheid** (`rarity_ongewoon`/`_zeldzaam`/`_legendarisch`/`_gemengd`)
  en de kapstok **`breed_collector_all`** (bezit tegelijk elk ras, +500 XP).
  Programmatisch gegenereerd uit `PIGEON_BREEDS` via `test`-helpers (`ownsBreed`/
  `ownsRarity`); opgepikt door `evaluateBadges` (kopen/kweken/offers/vluchten/tick).
  Client: `BadgeGroup` + `GROUP_LABEL`/`GROUP_ORDER` in `AchievementsPage` uitgebreid.
- **Eerste-login-melding + tour**: `BREED_NEWS_STEPS` (eenmalig, sleutel
  `roekoe.newsSeen.breeds.<id>`) + gedeelde `BREED_STEP` in de volledige tour
  (herhaalbaar vanaf profiel), verankerd op `[data-tour="pigeon"]`.

**Vluchten & energie**
- Vlucht-energie wordt **geleidelijk per 30 min** afgetrokken (`tickFlightEnergy`),
  niet meer in één klap; opgeven betaalt enkel het gevlogen deel.
- `finalizeFlight` is **deterministisch** (seeded op vlucht-id) → geen
  tegenstrijdige uitslagen bij gelijktijdige afhandeling; resultaat-/verbeter-/
  blessure-/sponsor-/weddenschapsmeldingen hebben **stabiele id's** (dedupe).
- **Live verslag toont nu echte info i.p.v. enkel grappen** (`flightCommentary`):
  wie wie **voorbijsteekt**, met de reden als die duidelijk is (versnellen / wegzakken
  / **verdwaald ~X km omweg** / uitputting / kramp / opgeven) + koploperwissels en
  aankomsten. Afgeleid uit het bevroren `sim` (positiesampling per 10 min), gedempt
  voor oscillerende paren, deterministisch. Nieuw veld `SimEntry.lost`. Zie §2.

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
  hoogste gemiddelde vluchtsnelheid (km/u; `seasonPeakSpeed` = beste rit­gemiddelde
  `r.velocity`, ondanks de veldnaam géén momentane piek), meeste podiums, meeste
  vooruitgang (`seasonScore`-delta).
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
  `COACH.dailySalary 80`, ziekenboeg dokter 57 / kinesist 50 / medicatie 6 — in
  `tickDailyCare` via `economy.dailyRunningCost`; sponsorbijdrage dagelijks (weekbedrag/7).
- Dagopdrachten/streak verlaagd (~€750/week i.p.v. ~€1750). Weddenschap max €500.
  Regionaal prijzengeld verdubbeld. Inschrijfgelden gehalveerd (regio €10 / nat €20 /
  intl €40 / titan €50).
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

**Terugkeer van de 503 — tweede ronde (nieuwste)**
**Symptoom (identiek):** 503 op alles, spelers zien plots het inlogscherm en
**inloggen geeft dezelfde 503**. Dat "uitloggen" is trouwens schijn: `AuthContext`
gooit het token niet weg bij 5xx (fix 5 hierboven), maar als `/auth/me` faalt blijft
`user` null → de app toont LoginPage. En inloggen faalde óók, dus je raakte er niet in.

> ⚠️ **Het was déze keer NIET het dagquotum.** Eerste hypothese was opnieuw "rows
> read op". De D1-metrics weerlegden dat: **273,4 k gelezen / 37,1 k geschreven
> rijen** op de dag van de storing, tegen limieten van 5 M / 100 k — dus ~5 %
> van het leesbudget. Check dus **altijd eerst de metrics** vóór je op quota gokt.

**Echte oorzaak (gevonden): de D1-limiet van 50 queries per Worker-invocatie**
(gratis plan; betaald 1000). Dat is een **per-verzoek**-limiet, los van het dagquotum.
`ensureSchema` vuurde **71 losse statements** af (56 `ALTER` + 6 `CREATE TABLE` +
6 `CREATE INDEX` + …) en draaide bij **élke cold start** — een isolate wordt continu
gerecycleerd, dus dat gebeurt willekeurig en vaak. Zo'n verzoek gaat over de limiet en
**sterft vóór het bij het spel raakt**, ongeacht welke route het was: /state, maar net
zo goed /auth/login. Dat verklaart de willekeur ("soms werkt het, soms niet") én
waarom inloggen meeging.

**Fix:** `ensureSchema` is nu **gegate op `world.schema_version`** (`SCHEMA_VERSION`
in `d1.ts`). Een bijgewerkte database kost **1 query** i.p.v. 71; de upgrade draait
enkel nog wanneer de versie achterloopt, en zet daarna de versie. **Bump
`SCHEMA_VERSION` telkens je een statement toevoegt**, anders draait je nieuwe
`ALTER`/`CREATE INDEX` nooit.

**Daarnaast meegenomen (basiskost, want die was sowieso onnodig hoog):** elk verzoek
deed **11× `SELECT *`**, óók `/api/auth/login` en `/api/auth/me` — de "light routes"
sloegen wél `advanceRealtime` + `persist` over, **maar niet de load**. Ruwe telling:
pigeons ~200 + notifications ~640 + trades 200 + bets 200 + de rest ≈ **~1300 rijen**
per verzoek. Dat is geen quotumprobleem gebleken, maar wel **CPU** (JSON.parse van de
hele wereld + `snapshot()` die élke entiteit stringify't) — en de gratis Workers-limiet
is **10 ms CPU per invocatie**, met **Error 1102 "Worker exceeded resource limits"** als
je eroverheen gaat. Minder rijen = minder parse/stringify, dus dit blijft nuttig.

**Relevante Cloudflare-limieten om te onthouden (gratis plan):**

| Limiet | Gratis | Waar het pijn doet |
|---|---|---|
| D1 **queries per Worker-invocatie** | **50** | `ensureSchema` (71!), en een `batch()` met veel statements |
| Workers **CPU per invocatie** | **10 ms** | de hele wereld parsen/stringify'en → Error 1102 |
| D1 rijen gelezen/dag | 5 M | wás de oorzaak in ronde 1, níet in ronde 2 |
| D1 rijen geschreven/dag | 100 k | zat op 37 k tijdens de storing |
| D1 databasegrootte | 500 MB | zat op ~0,7 MB |
| Externe `fetch`-subrequests | 50 | `fetchFlightWeather` (1 per startende vlucht) |

> **Let op bij `persist()`:** één `db.batch([...])` met veel statements telt mee voor de
> 50-querylimiet. Een vluchtafronding raakt tientallen duiven + meldingen tegelijk —
> hou dat in de gaten als er ooit weer 503's zijn net ná een race.

**Wat is gefixt:**
7. **`ensureSchema` gegate op `world.schema_version`** — 71 queries → **1** op een
   bijgewerkte database. Dit is de hoofdfix voor ronde 2.
8. **Inloggen laadt de wereld niet meer.** `/api/health`, `/api/auth/login` en
   `/api/auth/me` zijn nu **featherweight**: het token wordt geverifieerd vóór elke
   DB-toegang (pure crypto), en de speler wordt opgezocht met één rij via
   `findUserById`/`findUserByUsername` (`core/d1.ts`). **~1 rij i.p.v. ~1300** → je
   raakt altijd binnen, ook op een dag dat de spelstate haar budget opgesoupeerd
   heeft. `/health` raakt **geen enkele tabel** meer (`{ok:true}`; week/spelersaantal
   zijn eruit — de client gebruikte ze niet). `/auth/register` houdt de volle load
   (maakt een hok aan, en is zeldzaam).
9. **Partieel laden van `notifications`/`bets`/`trades`** (zie §2, D1Store-patroon)
   → de basiskost zakt van ~1300 naar **~450 rijen** per verzoek: minder leeswerk,
   en vooral minder JSON-parse/stringify-CPU.
10. **SQL-begrenzing i.p.v. array-begrenzing** (`boundedCleanups`): inbox 40/speler,
   trades 100, afgehandelde weddenschappen 100 — **openstaande** weddenschappen
   overleven altijd. Draait enkel bij een echte toevoeging.
11. **Indexen** die die queries dekken (`idx_notifications_user_created`,
   `idx_trades_at`, `idx_bets_status`), aangemaakt achteraan `ensureSchema` zodat
   alle tabellen al bestaan. Zonder index scant SQLite alsnog de hele tabel.

**Geverifieerd** met `d1-partial-load.test.mts` (repo-root, `npx tsx …`): draait de
echte `d1.ts` tegen een `node:sqlite`-nep-D1 en checkt dat (a) enkel de juiste slice
geladen wordt, (b) `persist` **niets** wist wat niet geladen was, (c) de opruiming de
tabellen aftopt zonder open weddenschappen te raken, en (d) het inlogpad 2 rijen kost.
Query-plannen gecontroleerd met `EXPLAIN QUERY PLAN` — alles index-gedekt behalve
`lower(username)` bij login, en dat is een scan over ~16 rijen.

**Nog beschikbare hefbomen als het toch weer krap wordt:** `advanceRealtime` throttlen
(bv. max. 1×/20 s via een `world.lastAdvance`-guard); `/state` kort cachen (Cache API);
`TRADE_LOAD_LIMIT` verlagen. **Structureel** blijft `pigeons` (~200 rijen) de grootste
volledige load — die is echt globaal nodig (vluchten, markt, bots).

### Openstaande ideeën / balans om op te letten
- Sterfte is nog **wekelijks** terwijl herstel real-time is (evt. op elkaar afstemmen).
- Ziekenboeg-**kosten** (salarissen/medicatievoer) zijn nog wekelijks.
- Weddenschappen als geldbron; rustbonus + sneller herstel + goedkopere vluchten
  samen → hou in de gaten of energie niet te makkelijk wordt.
- **Trofee-showcase** toont enkel podia van **nu-bezeten** duiven (uit `raceLog`);
  medailletellingen (`loft.stats`) blijven wél volledig. Verkochte/overleden duiven
  vallen uit de trofeeënlijst (niet uit de tellingen).

**Afstand, coach, live-bord, veilingen, dilemma's & sponsors (deze sessie)**
- **Afstandsvensters** (`FLIGHT_TIERS` in gameConfig): regionaal **100–200 km**,
  nationaal **200–500 km**, internationaal **400–1200 km** (regionaal-min was 0 → **100**;
  eerdere vensters waren 30–160 / 60–290 / 180–950). Zie §"Minimumafstanden" onderaan §8.
  `tierPool` (schedule.ts): nationaal = BE + buurlanden (geen GB/ES, geen `intlOnly`);
  internationaal = alles incl. de nieuwe **grote-fond­losplaatsen**. Nieuwe steden in
  `RACE_CITIES` (Berlijn + `intlOnly`: Lyon, Bordeaux, Toulouse, Marseille, Perpignan,
  **Barcelona**), nieuw land **`ES`** in `Country`. `pickRoute` filtert nog altijd op
  `[minKm,maxKm]`, dus de pools hoeven enkel genoeg in-window-paren te bevatten
  (geverifieerd: regio max ~183 km, nationaal ruim 200–500, internationaal tot ~1150).
  **Migratie v21** (huidige regel): bestaande **geplande** vluchten horen bij de **OUDE,
  kortere afstanden** (regio 30–160 / nat 60–290 / intl 180–950 km); enkel **nieuwe**
  vluchten (nadien geplant) gebruiken de verbrede vensters. Elke nog-geplande niet-titan-
  vlucht buiten haar legacy-venster wordt her-routeerd via `pickRoute(tier, min, max)`
  (overrides toegevoegd aan `pickRoute`); vluchten al in het oude bereik houden hun lengte,
  live/afgewerkte vluchten (bevroren `sim`) en titans blijven ongemoeid. **v20** was een
  voorloper die geplande vluchten juist naar de nieuwe vensters duwde — v21 haalt de huidige
  kalender terug (draait op elke wereld, ook die al op v20 stond). Geverifieerd met tsx:
  legacy-vensters 100% haalbaar per tier-pool, en `pickRoute` zonder override levert nog
  steeds de nieuwe afstanden.
- **Energieverbruik-tabel** in `spelregels.md` §3 herrekend voor de nieuwe afstanden
  (formule ongewijzigd: `(10 + km/30)·ervaringsfactor + rand(0..10)`); geverifieerd met tsx.
- **Privécoach-doc gelijkgetrokken met de code** (§13 spelregels + coach-UI): geen
  instapkost, **€80/dag**, afnemende groei `1,1·(100−attr)/100` per race-eigenschap
  (+0,5 ervaring/dag), cap 100. De **duifpagina** toont nu de **concrete per-dag-winst
  voor déze duif** (o.b.v. haar eigen eigenschappen) onder de coach-knop; economy-DTO
  kreeg `coachMaxDailyGain`/`coachAttributeCap`/`coachExpDailyGain`.
- **Live-vlucht km/u = echte effectieve snelheid** (`liveSnapshot` in flight.ts): de
  cosmetische ±5%-wobble is weg; de km/u wordt **op een 5-minutenraster** bemonsterd
  (`SPEED_STEP_SECONDS = 300`), dus stabiel tussen polls, geen nep-jitter. Posities
  blijven continu. Lage perf-impact (pure berekening, geen extra werk).
- **Veiling-countdown live** (`AuctionCard` in MarketPage): zelf-plannende tick (30 s
  ver weg, **1 s in de laatste 5 min**), `countdownTo(endAt, nowMs)`; bij het sluiten
  `onExpire → load()+refresh()`. MarketPage pollt bovendien elke 15 s zolang een veiling
  in haar **slotfase (<6 min)** zit → andermans biedingen + anti-snipe-verlenging
  verschijnen zonder handmatige refresh.
- **Meer dilemma's** (`events.ts`): `doping` (💉, boost of boete+ziekte), `inheritance`
  (📜, **3-keuze**: geld / oude kampioen / jonge belofte — `generatePigeon` met
  `birthWeek` voor leeftijd), `scout` (🔎, prospect op proef), `poacher` (🦅, incl.
  **sterftekans**), `charity` (🎗️). Client-modal rendert opties generiek → 3-keuze werkt.
- **Meer sponsors, aangeboden op vluchtprestatie** (`SPONSORS` + `evaluateSponsorOffers`):
  nieuwe categorieën (slagerij, brouwerij, dierenwinkel, bouw, verzekering, telecom,
  loterij), extra rivalen (café/racing) en een **tier 4**; gebruikt ook `seasonPoints`.
  **Belangrijk (2 iteraties):** aanbiedingen komen NIET meer per request op basis van
  drempels/tijd — dat gaf een **wal van aanbiedingen tegelijk**. Nu:
  - **Trigger = goede competitievlucht.** In `tickFlights`, per eigenaar met een podium/
    win in een echte wedstrijd, met kans `SPONSOR_OFFER_ON_PERFORMANCE` (win 0.5 / podium
    0.25, seeded op `flight.id+ownerId`) → `evaluateSponsorOffers`. Practice/titan tellen
    niet (staan vóór het `continue`). De per-request-call in `[[path]].ts` is **weg**.
  - **evaluateSponsorOffers** emit hoogstens **één** aanbod (laagste tier eerst), met twee
    floors: cap `SPONSOR_MAX_PENDING_OFFERS (2)` + `SPONSOR_OFFER_SPACING_HOURS (6 u)`.
    `SponsorState.lastOfferAt` bewaakt de spacing; `state()` trimt een te grote stapel op
    het lezen (self-heal).
  - **Migratie v19**: bestaande openstaande aanbiedingen (uit het oude model) worden
    **gewist** voor alle hokken (actieve contracten + signed/declined blijven), zodat
    niemand nog met een wal zit; nieuwe komen enkel via vluchtprestatie. **dataVersion → 19.**
- **Duif-card-breedte (echte fix)**: de horizontale overflow op de **duifpagina** kwam
  van grid-items met default `min-width:auto` + een **niet-afbreekbare** brede knop
  (`.btn` is `white-space:nowrap`, bv. "🔒 Oriëntatie — weer vanaf <datum>"): die zette
  de min-content-breedte van de kolom breder dan het scherm, waardoor in één kolom álle
  rijen (ook de statbalken) meeliepen. Opgelost in `global.css`: `.grid > * { min-width: 0 }`
  (items mogen krimpen) + `.btn.block { white-space: normal }` (volle-breedte-knoppen
  breken af) + `.grid.cols-2` → 1 kolom onder 820px. `PigeonPage`-naamblok kreeg
  `flex:1; min-width:0; overflow-wrap:anywhere`. (Enkel de kolom naar 1fr zetten was niet
  genoeg — vandaar dat het eerst erger leek.)
- **Card-breedte deel 2+3 (statgrid)**: de **statgrid** in `PigeonCard` (inline grid, NIET
  de `.grid`-class) liep over op smalle schermen zodra álle drie de bovenste stats een
  `+delta` kregen — "Oriëntatie …" viel dan rechts weg. `global.css`: `.stat { min-width: 0 }`
  + `.stat-top { flex-wrap: wrap }`. **Definitief kogelvrij** gemaakt door de inline
  kolomdefinities van `1fr 1fr 1fr` / `1fr 1fr` naar **`repeat(3|2, minmax(0, 1fr))`** te
  zetten: `minmax(0,1fr)` dwingt het track-minimum op 0 (los van item-`min-width`), dus de
  kolommen zijn altijd exacte breuken van de kaart en de inhoud breekt binnen de cel af.
  (Was zichtbaar hardnekkig door **browsercache** — geen service worker; harde refresh nodig.)
- **Schemawijziging**: `SponsorState.lastOfferAt?` (rijdt mee in de `sponsorship`-JSON,
  geen kolom nodig). Datamigratie **v19** wist openstaande sponsoraanbiedingen. Verder
  config/logica/CSS.

---

## 9. Snelle oriëntatie voor een nieuwe sessie

1. Lees dit bestand + `spelregels.md` (spelersregels) + `README.md` (opzet).
2. `core/config/gameConfig.ts` = alle balans-getallen ("de knoppen").
3. `core/schema.ts` = datamodel (let op `form`=energie, `endurance`=conditie).
4. `advanceRealtime` in `core/game/schedule.ts` = wat er elk verzoek gebeurt (§2).
5. Endpoints in `functions/api/[[path]].ts`; UI in `client/src/pages/`.
6. Verifieer met de typecheck/build-commando's (§7), **update context.md**, commit,
   en **deploy meteen naar productie** (§0/§7).
