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
| **Dev** | `claude/hallo-hrtwtv` | Alle ontwikkeling/commits komen hier **eerst**. |
| **Prod** | `claude/roekoe-game-website-jwa0vo` | Elke commit wordt hierheen **gecherry-pickt**; deze branch triggert de **Cloudflare Pages**-deploy naar productie. |

> Vorige dev-branches (niet meer gebruiken): `claude/hallo-mzjn0e`, `claude/hallo-su75jy`, `claude/hallo-rkr49f`, `claude/hallo-pvwabx`,
> `claude/context-spelregels-q2ywtx`, `claude/hallo-49m6hj`, `claude/hallo-xifh0c`,
> `claude/hallo-w97s85`. Ontwikkelt een sessie op een nieuwe
> `claude/…`-branch, gebruik die dan als dev-branch en **werk deze tabel meteen bij** —
> de prod-branch hierboven verandert nooit.

**Workflow per wijziging (zie §7 voor de exacte commando's):**
1. Commit op **dev** (zie de tabel hierboven) + push.
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
4. **Tekstbudget in de UI.** Een scherm toont enkel wat de beslissing van dít moment
   stuurt (kost, opbrengst voor déze duif, harde beperking). Mechaniek, kansen,
   tabellen en tactiek horen in **`WikiPage`** (`client/src/pages/WikiPage.tsx`), met
   in het scherm een link **"Meer info over … →"** naar `/wiki#<sectie>`. Blokken tekst
   in het spel worden niet gelezen. Zet **getallen bij voorkeur enkel in de wiki**, zodat
   er één plek is om met `gameConfig.ts` te synchroniseren.

---

## 1. Wat is Roekoe

Een online **duivenmelker-managementspel** voor een groepje vrienden (~10 spelers
+ bots). Kernloop: **verzorgen → trainen → inschrijven voor vluchten → punten &
geld verdienen → kopen/kweken/uitbreiden → herhalen.** Bots vullen het veld.

- **Repo:** `nsalien/roekoe` (GitHub).
- **Ontwikkelbranch:** zie de tabel in §0 — hier ontwikkelen en committen.
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

**En `pigeons` is geen `SELECT *` meer (nieuwste — dé CPU-fix):** de wereldload
leest een **expliciete kolomlijst** (`PIGEON_SELECT`, afgeleid van
`PIGEON_COLUMNS`) waar de twee historiekblobs **niet** in zitten. `race_log` en
`attr_log` zijn samen ~13 KB per duif; op 264 duiven scheepte `SELECT *` daarmee
~3,3 MB per verzoek aan, en dat parsen (13 ms) + opnieuw serialiseren voor de diff
(9 ms) was **88 % van de CPU van een volle load** — op data die geen enkele tick
leest. Ze staan nu in **`pigeon_log_entries`** (append-only, één rij per regel) en
worden enkel gelezen door `loadPigeonLogs`. Zie §8.

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
   (staat nu op **42**; nieuwe migratie = nieuw `if ((db.world.dataVersion ?? 0) < N)`
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
   Verhongerde duiven worden hier verwijderd. **Draait per bothok ook
   `botDailyActions`** (bots.ts): voer/ziekenboeg/rustkuur/coach/hokuitbreiding/
   kweek — bewust op de dagovergang en niet per verzoek, want het schrijft rijen. **Rekent ook alle vaste onkosten dagelijks
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
9c. `tickBotEntries(db, nowMs)` — geeft **elke bot opnieuw de kans** om in te
   schrijven voor élke nog niet gestarte vlucht, tot vlak vóór de lossing (zie
   §Bots). Idempotent (een hok met een inschrijving wordt overgeslagen), dus een
   uitgekristalliseerde vlucht schrijft 0 rijen.
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

**Duif is weer vrij zodra háár race erop zit (`birdStillOut` / `pigeonCommittedToFlight`
in `flight.ts`).** Een vlucht eindigt pas bij de traagste finisher (geen cutoff meer), dus
op 1000 km kan de staart uren duren. De "is deze duif bezet?"-check keek naar
`flight.status !== 'completed'` en hield een duif dus gegijzeld tot de laatste binnen was.
Nu leidt `birdStillOut(flight, pigeonId, nowMs)` het **einde van haar eigen race** af uit het
**bevroren sim**: `legStartSeconds + (gaveUpAtSeconds | min(dnfAtSeconds, durationSeconds))`.
`scheduled` = altijd bezet, `completed` = altijd vrij, geen sim-entry = vrij (legacy zonder
`segMult` werkt op `durationSeconds`). **Estafette-bewust:** de timers zijn **leg-lokaal**
(zie `giveUpFlight`) en `legStartSeconds` zet ze op de raceklok, dus een duif die op leg 3
op haar beurt wacht is **bezet**, en een duif achter een uitgevallen ploegmaat komt vrij op
`team.outSeconds` (ze wordt nooit meer gelost) — via `relayTeams(flight)`.
`pigeonCommittedToFlight(db, pigeonId, nowMs?)` is de db-brede versie en **vervangt overal**
het oude `db.flights.some(f => f.status !== 'completed' && …)`-patroon: `engine.ts` (rustkuur,
listForSale, trainPigeon, setInfirmary, `pigeonBusy` → release/restaurant, startBreeding),
`offers.ts`, `presenters.ts` (`pigeonDTO.racing`). Ook de **1-race-per-dag-regel** in
`enterFlight` en de bot-`committed`-set in `botsEnterFlight` (schedule.ts) filteren op
`birdStillOut`. **Veilig qua energie:** `tickFlightEnergy` zet een gestopte duif op de **volle**
`formCost` (`stopped` → fractie 1) en draait in `advanceRealtime` vóór elke handler, dus een
duif kan nooit ingeschreven worden vóór haar energie afgerekend is; `finalizeFlight` settelt
dan nog 0. De "gisteren gevlogen"-vormaftrek blijft ook gewoon gelden. **Bewuste keerzijde:**
de post-vlucht-effecten (conditie/ervaring/gezondheid, verbeterworp, aandoening) landen nog
steeds pas bij de **afronding**, dus die kunnen aankomen terwijl de duif al aan een volgende
vlucht bezig is. `giveUpFlight` weigert nu een duif waarvan de race al voorbij is (dat maakte
van een al uitbetaalde finisher retroactief een DNF). Duiven die **de weg kwijt** zijn blijven
onbeschikbaar via de aparte `isAway`-check.

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
│       │                        Tour.tsx (interactieve rondleiding), PrizeCeremony.tsx,
│       │                        PigeonAvatar, NotificationsBell
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
│   │                            boundedCleanups/findUserBy*, auction_bids); diff schrijft
│   │                            gegroepeerd + kolom-smal (zie §8 503-fix ronde 3)
│   ├── auth.ts                  wachtwoord-hash + JWT via Web Crypto
│   ├── presenters.ts            entiteit → client-DTO (pigeonDTO(db,p,viewerId?,isAdmin?) → dailyCare + info-hiding)
│   └── game/
│       ├── engine.ts            speler-acties (buy/train/enter/giveUpFlight/breed/…)
│       ├── schedule.ts          advanceRealtime + data-migraties + alle ticks
│       ├── flight.ts            vluchtsim (velocity, DETERMINISTISCHE finalize, live; geen finish-timer)
│       ├── relay.ts             estafette: routegeometrie (gelijke etappes, wisselpunten) + ploeghelpers
│       ├── betting.ts           weddenschappen (Monte-Carlo odds + settle, stats,
│       │                        void+refund bij uitschrijven duif / afgelaste vlucht)
│       ├── health.ts            ziekte/kwetsuur + REAL-TIME herstel (tickHealing, per kwartier)
│       │                        + coveredInInfirmary/careSlots (wie de dokter behandelt)
│       ├── breeding.ts          kweek
│       ├── economy.ts           dagverzorging (applyDayOfCare) + projectie + upkeep + honger + rust
│       ├── bots.ts              bot-gedrag
│       ├── auction.ts           veilingen (bieden, slotfase-limiet, sluiten, verlies-meldingen)
│       ├── market.ts            marktgestuurde duivenwaarde (prijs uit echte verkopen)
│       ├── sponsors.ts          sponsors
│       ├── badges.ts            badges/XP/level
│       ├── missions.ts          dagelijkse opdrachten + streak + dilemma-trigger
│       ├── events.ts            dilemma-kaarten
│       ├── pigeon.ts, weather.ts, util.ts (seededRng/hashString/clamp/pickWith)
│       ├── newcomer.ts          starterspakket nieuwe spelers (punten, gratis coach, 2x winst)
│       ├── names.ts             naamgenerator — UNIEKE voornaam+bijnaam (namesInUse/nameKey)
├── functions/api/[[path]].ts    de HELE API (Hono) — dun laagje op de engine (+ /admin/auctions)
├── d1-partial-load.test.mts     regressietest op de partiële load (npx tsx, node:sqlite)
├── query-budget.test.mts        regressietest: queries per verzoek < 50 (D1-limiet)
├── idle-writes.test.mts         regressietest: idle poll schrijft 0 rijen (D1-schrijflimiet)
├── names.test.mts               regressietest: duivennamen zijn uniek
├── advance-throttle.test.mts    regressietest: advanceRealtime-throttle (CPU)
├── cpu-budget.test.mts          regressietest: geen pad over de 10 ms CPU (koud + warm)
├── daily-budget.test.mts        regressietest: D1-daglimieten (5M gelezen / 100k geschreven)
├── sponsor-refusal.test.mts     regressietest: "nee is nee" bij een slechtere concurrent
├── commentary.test.mts          regressietest: live verslag groeit aan, herschrijft niet
├── betting-odds.test.mts        regressietest: weddenschapskansen kloppen + zijn stabiel
├── newcomer.test.mts            regressietest: starterspakket nieuwe spelers (48 checks)
├── velocity-model.test.mts      regressietest: snelheid = snelheid, ervaring = efficiëntie
├── age-cup.test.mts             regressietest: leeftijdscriterium (kalender, klassen, cyclus)
├── pigeon-logs.test.mts         regressietest: historiekboeken staan NIET in de duivenrij
├── season-prizes.test.mts       regressietest: winst-reset + de ceremonie-payload
├── bot-market.test.mts          regressietest: bots op de markt + hun trainingsregels
├── cpu-pigeons.mts              meet wat een duif kost per verzoek (marginale CPU) — diagnose
├── poll-budget.test.mts         regressietest: pollritme + de smalle load (deelnemerslijst!)
├── force-finish.test.mts        regressietest: admin-"match beëindigen" == natuurlijk uitvliegen
├── limits-report.mts            meet queries/rijen gelezen/geschreven per verzoek
├── cpu-sweep.mts                meet CPU per operatie (duurste eerst) — diagnose
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

Entiteiten: `Pigeon`, `Loft`, `User`, `BreedingPair`, `PendingBrood`, `Flight` (+ `SimEntry`,
`FlightEntry`, `FlightResult`), `Trade`, `Auction` (+ `AuctionBid`), `Bet`,
`PigeonOffer`, `Notification`, `SponsorState`/`SponsorOffer`/`ActiveSponsorship`,
`DailyMission`, `EventCard`, `PlayerStats`/`EarnedBadge`, `World`, `Database`.

**Naamgevingsvalstrikken (onthouden!):**
- `Pigeon.form` = **energie** (de "tank"), UI-label "⚡ Energie".
- `Pigeon.endurance` = **conditie**, UI-label "Conditie".
- `Pigeon.orientation` = oriëntatie, `speed` = snelheid, `libido`, `health`,
  `experience`, `talent`.
- `Loft.food` is een **`FoodStock` = Record<FeedRationKey, number>** (kg per type).
  Bijkopen aan `FEED_RATIONS[k].pricePerKg`, terugverkopen aan **`FOOD_RESALE_RATE` (0,8)**
  daarvan — verkopen levert dus altijd een klein verlies op.
- `World.leaderboard` = **JSON-cache** van de twee wereldwijde ranglijsten (hokken +
  duiven). `/state` mag die niet zelf berekenen: dat leest élke duif, en juist dat maakte
  het leesbudget op. Ververst door `computeLeaderboard` bij elke volle engine-run.
- `Loft.pendingBroods` = **`PendingBrood[]`** — uitgekomen jongen die nog **niet** in
  `db.pigeons` zitten omdat het hok vol was. Ze wachten op de keuze van de speler.
  Hangt bewust aan de **loft-rij** (kolom `pending_broods` JSON, net als `pending_event`)
  en níet in een eigen tabel: de lofts worden toch al elk verzoek geladen, en het duurste
  verzoek zit al op **~42 van de 50** queries die één Worker-invocatie mag doen — een
  eigen tabel kostte er structureel één extra.

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
  **progressieve schijven per duif** (zie hieronder), `COACH.dailySalary 80`,
  `INFIRMARY.doctorSalary 57` / `physioSalary 50` / `medicatedFoodPerBird 6`.
  Aangerekend in `tickDailyCare` via `economy.dailyRunningCost`; sponsorbijdrage
  dagelijks (weekbedrag ÷ 7).
- **Progressieve daghuur (`UPKEEP_BANDS`, nieuwste — anti-runaway):** onderhoud per
  duif gaat in **schijven** zoals belastingschijven — elke duif betaalt het tarief van
  háár schijf, nooit het toptarief op het hele hok. **duif 1–8 €2 · 9–12 €6 · 13–16 €12
  · 17–20 €20** per dag. Helpers `pigeonUpkeepBands(count)` (→ `UpkeepBandCost[]`) en
  `dailyPigeonUpkeep(count)` staan in `gameConfig.ts` naast de tabel; `economy.ts::
  dailyRunningCostBreakdown` gebruikt ze en levert `upkeepBands` mee in de DTO, zodat de
  **Dagbalans** een regel per schijf toont. Weekkost: 8 duiven €266 (**exact als
  vroeger**), 12 €434, 16 €770, 20 €1.330 — een vol hok kost nu ~5× een starthok i.p.v.
  1,6×. **Invariant: een hok t/m `STARTING_LOFT_CAPACITY` (8) betaalt exact het oude
  vlakke tarief** — deze maatregel mag een kleine melker níets kosten (bots zitten ook op
  8 en blijven dus ongemoeid). `DAILY_UPKEEP_PER_PIGEON 2` blijft bestaan als het tarief
  van de eerste schijf + wordt nog naar de client gestuurd (oude open tab).
- **Hokcapaciteit (`LOFT_CAPACITY_TIERS`, nieuwste — steiler):** stappen van +2 met
  sterk oplopende prijs: 10 €1.500 · 12 €3.500 · 14 €10.000 · 16 €17.500 · 18 €30.000 ·
  20 €50.000 → **€112.500 cumulatief** van 8 naar 20 (was €29.000 via 8/10/12/16/20).
  Ruimte voor meer duiven is de sterkste structurele troef (meer duiven = meer starts =
  groter aandeel in de prijzenpot), dus dat moet een investering van lange adem zijn.
  `nextCapacityTier`/`upgradeCapacity` zijn ongewijzigd (ze lezen de tabel).
- **Privécoach = dagelijkse groei richting de gen-cap** (`COACH`): geen instapdrempel
  (`hireCost 0`), enkel **€80/dag per gecoachte duif** (`dailySalary`). `coachDailyGain(attr,
  cap) = COACH.maxDailyGain (1.1) · (cap − attr)/cap` — werkt op **elk niveau**, afnemend
  richting de cap, **0 op/boven de cap** (per eigenschap onafhankelijk). Enkel de coach
  passeert 90 (trainen ≤80, vluchten ≤90). `applyDayOfCare` drilt per attribuut en geeft
  `experienceDailyGain 0.5` zolang er nog minstens één eigenschap onder haar cap zit. Werkt
  niet terwijl de duif vliegt. `pigeonDTO.coachGain` (per attribuut) voedt de UI;
  `attributeCap`/`coachMinAttr`/`eliteGainPerDay` bestaan niet meer. Zie ook §5-Genen.
- **Sponsors (`SPONSORS`, nieuwste):** `dailyStipend` (dagelijks, niet meer per week) +
  `podiumBase` (= zege op een nationale vlucht). Uitbetaling per podiumplaats via
  `sponsorPodiumBonus(base, tier, rank)` = `base × SPONSOR_TIER_FACTOR[tier] × SPONSOR_PODIUM_FACTOR[rank-1]`,
  afgerond op €5. Niveau 0,6/1,0/1,8 · plaats 1/0,6/0,35. Enkel wedstrijdvluchten.
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
- **Ervaring groeit met afnemende opbrengst (`EXPERIENCE`, nieuwste):** élke rauwe
  ervaringswinst gaat door **`experienceGain(current, raw)`** (`pigeon.ts`) =
  `raw · (minFactor + (maxFactor − minFactor)·((100−exp)/100)^curve)`, met
  `maxFactor 1.8` / `minFactor 0.12` / `curve 1.6`. Factor ×1,8 op 0, **×1,0 rond
  ervaring 33**, ×0,67 op 50, ×0,16 op 90, ×0,12 op 100. Het volledige traject 0→100
  kost ~2,4× de rauwe eenheden van vroeger; 0→50 blijft even snel. Toegepast **aan de
  bron** (zodat een delta die elders gelezen wordt, zoals `seasonPracticeGain`, het
  échte getal ziet): `flight.ts` (wedstrijd/estafette-etappe/oefenvlucht),
  `engine.ts::trainPigeon`, `bots.ts` (bot-training), `economy.ts` (coach + de
  `projectDailyCare`-projectie) en `events.ts` (talentenjager).
  **Ondergrens op `minFactor`:** ervaring wordt op **1 decimaal** bewaard, dus de
  kleinste terugkerende rauwe winst (coach 0,5/dag, oefenvlucht ~0,5) moet na schaling
  nog ≥ 0,05 opleveren, anders rondt ze stilletjes weg tot niets. `0,5 × 0,12 = 0,06` —
  **zet `minFactor` nooit onder 0,10.** (Keerzijde van diezelfde afronding: zo'n kleine
  winst wordt bij het optellen naar 0,1 afgerond, dus aan de top gaat het in de praktijk
  iets sneller dan de rauwe formule suggereert. Zelfde artefact als bij de andere stats.)
  Ervaring heeft **geen gen-cap** — 100 blijft haalbaar, het duurt gewoon lang.
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
- **Ziekte was in de praktijk onbereikbaar (nieuwste — opgelost):** de spontane kans werd
  vermenigvuldigd met `clamp(1 − gezondheid/100, 0, 1)`, dus bij **gezondheid 100 exact 0** — en
  de dagelijkse verzorging houdt duiven net dáár. Gemeten: eerste ziektegeval na **428 dagen** voor
  een goed verzorgd hok van 8, en **nooit** bij gezondheid 100; besmetting kwam nooit op gang bij
  gebrek aan een patiënt, dus de duivendokter (€57/dag) had niets te doen. Fix: **bodem
  `HEALTH.illnessBaselineRisk 0.18`** op de kwetsbaarheidsfactor (toeval bestaat),
  `spontaneousIllness` 0,05 → **0,10**, `contagionPerSource` 0,11 → **0,30**. Gemeten na de fix:
  kerngezond ~110 d · goed verzorgd ~90 d · normaal ~60 d · verwaarloosd **~17 d**; besmetting binnen
  een week 20/37/57/80%. Gezondheid blijft dus 6× de doorslag geven.
- **Ernst schaalt met de gezondheid** (`DISEASE_SEVERITY` + `diseaseSeverityWeights(health)` in
  gameConfig, gebruikt door `randomDisease(week, health)`): vroeger trok hij **uniform** uit de 6
  ziektes → 33% meteen ernstig. Nu gezondheid ≥80 → licht 55 / matig 33 / ernstig 12%, en bij
  gezondheid 30 → 40/34/**26**%. Het gewicht van een ernstniveau wordt verdeeld over de ziektes
  binnen dat niveau, zodat een nieuwe ziekte de mix niet stiekem verschuift.
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
- **Estafettevlucht (`RELAY`, nieuwste — zaterdag om de week):** ploegformat dat
  **week om week afwisselt met de titan** op hetzelfde zaterdagslot. `isRelayWeek(dayNumber)`
  (`gameConfig.ts`) = `floor(dayNumber/7) % 2 === 1` → eerste estafette **22 aug 2026**;
  `ensureFlightsScheduled` kiest per zaterdag het format en gebruikt dan **`RELAY.hour` 5**
  i.p.v. `TITAN.hour` 8. Slot-key blijft `titan` (dedupe per dag). Knoppen: `teamSize 3`,
  route **850–950 km**, `entryFee 100` (**één keer per ploeg**), `prizes [3000,2000,1500,1100,800]`,
  0 punten, geen wedden. **Route** via `pickRelayRoute` (`core/game/relay.ts`): echte start/
  aankomststad (aankomst altijd Vlaams), wisselpunten **exact op ⅓ en ⅔ van de grootcirkel**
  → elke etappe exact even lang; punten gelabeld met de dichtstbijzijnde stad + windstreek
  (`describePoint` → "ten oosten van Limoges", "bij Lyon" onder `nearCityKm 25`). 36 mogelijke
  routes.
- **Estafette-mechaniek (`flight.ts`):** één duif per ploeg tegelijk in de lucht.
  `startLiveRelay` bevriest per duif een pace-profiel over **haar eigen etappe** met **die
  etappe haar eigen weerfactor** (daarom is de volgorde tactisch), plus `SimEntry.leg` en
  `legStartSeconds` (= som van de eerdere etappes). `relayTeams` leidt per ploeg af of/waar ze
  uitvalt (`outAtLeg`/`outSeconds`) en haar totaaltijd; `relayTeamProgress` geeft afgelegde
  ploegafstand; `relayStandings` = **finishers op tijd, daarna uitgevallen ploegen op afstand**
  (een uitgevallen ploeg kan dus nog in de prijzen vallen, nooit vóór een finisher).
  `relaySnapshot` levert `LiveSnapshot.teams` (ploegrij + 3 etapperijen), `relayCommentary`
  doet ploegduels + **wisselmomenten/uitschakeling/ploegfinish**, `finalizeRelayFlight` rekent
  per ploeg af. **Duiven die nooit aan de beurt kwamen betalen niets en lopen geen risico**
  (ook `tickFlightEnergy` slaat ze over via een `grounded`-set). `giveUpFlight` bewaart
  `gaveUpAtSeconds` **etappe-lokaal**. Prijzengeld gaat **één keer** naar het hok (vroege
  uitbetaling via de anker-duif in `computeFinishPayouts`, `prizePaid` verrekend in finalize);
  in `results` staat het bedrag op de **laatste etappe** zodat de meldingssom klopt.
- **Weer per etappe:** `relayLegsNeedingForecast` + `applyRelayForecasts` (schedule.ts) en
  `fetchLegForecast` (weather.ts, uurlijkse Open-Meteo-forecast op coördinaten). De API haalt
  het op vóór `advanceRealtime`; ververst elke `forecastRefreshHours` (6), en **elk uur** binnen
  `forecastFinalHours` (2) van de start. Kost hoogstens 3 subrequests per venster.
- **Ploegbeheer:** `enterFlight` laat max. 3 duiven per hok toe en rekent het inschrijfgeld
  enkel bij de **eerste** aan; `setRelayOrder` (engine.ts, `POST /flights/:id/relay-order`)
  wisselt de etappevolgorde tot de start; `withdrawFlight` haalt de **hele ploeg** weg met één
  terugbetaling; `tickFlights` gooit **onvolledige ploegen** eruit (terugbetaling + melding)
  vóór de "minstens 2 melkers"-check, en de afgelast-terugbetaling telt voor een estafette
  **één fee per ploeg**. Bots schrijven 3 duiven in of doen niet mee.
- **Migratie v31:** een reeds geplande **titan op een estafette-zaterdag** wordt verwijderd,
  inschrijfgeld terugbetaald + melding (en open weddenschappen erop terugbetaald). **dataVersion → 31.**
- **Bots (`BOT`, nieuwste — de "knoppen" van het botgedrag):** `DEFAULT_BOT_COUNT` **8**.
  `reserve 1500` (kasvloer), `raceHeadroom 1.15` + `minFormRegular 12` (inschrijven op
  routekost i.p.v. een vlakke 45), **`minFormRelay 0`** (geen drempel voor de estafette),
  `minHealthRace 45`, `breedReserveFlock 8` (houdt een koppel thuis als het hok dun wordt),
  `restCureBelowForm 28`/`restCureReserve 3000`, `maxCoached 2`/`coachReserve 8000`,
  `capacityReserveFactor 2.5`/**`maxCapacity 12`** (platformgrens, zie §Performance),
  `maxPairs 2`/`breedReserve 2500`/`breedMinLibido 35`, `foodWeeksBuffer 3`,
  **`goodFeedFrom 2500`** (vanaf dat bedrag Herstelvoer i.p.v. Normaal).
- **Leeftijdscriterium (`AGE_CUP` + `AGE_CATEGORIES`, nieuwste):** een tweede competitie
  náást het seizoen, enkel voor **duiven**. Vier klassen (`AgeCategoryId` = `u1`/`y12`/
  `y23`/`o3`, grenzen 52/104/156 gameweken) met elk **één vlucht per week** op een eigen
  weekdag om **06:00** (ma/wo/do/vr — vroeg, zodat een fondvlucht van 1000 km 's avonds
  binnen is). `entryFee 20`, **geen limiet per hok**. Het format wisselt week na week:
  `sprint` (100–300 km, pool `national`, prijzen `[1000,800,600,420,300,200,130,80]`) en
  `fond` (400–1000 km, pool `international`, `[1600,1400,1200,850,600,400,260,160]`).
  Helpers `ageCategoryFor(ageWeeks)`, `ageCategoryDef(id)` en `isCupSprintWeek(index)`.
  **Cyclus:** `seasons 3` — de stand loopt drie seizoenen door en pas dan volgt de
  prijsuitreiking (`awards [2000,1600,1200]` per klasse) + reset.
- **Schema (`REAL_SCHEDULE`, nieuwste — vaste weekkalender):** één vast programma per
  weekdag i.p.v. het oude dagelijkse lang+kort-ritme. **ma** 08:00 intl · **di** 10:00 regio
  + 12:00 oefenvlucht · **wo** 08:00 nat · **do** 08:00 intl · **vr** 10:00 regio + 12:00
  oefenvlucht · **za** 08:00 **Titan** (`TITAN.hour` van 11 → **8**) · **zo** 08:00 nat +
  17:00 regio. Dat is **8 wedstrijden + 2 oefenvluchten/week** (3 regio, 2 nat, 2 intl,
  1 titan) tegen 11–13 + 2–4 vroeger — bewust minder, zodat er **meer duiven per vlucht**
  aan de start staan. Tijdzone Europe/Brussels; elk slot heeft een eigen `key`
  (`mon-international`, `tue-regional`, `tue-practice`, …) zodat `templateKey` per dag
  uniek blijft. `everyNDays` en `tiers` (dagrotatie) worden niet meer gebruikt maar
  blijven ondersteund. Op een **titan-dag** worden alle níet-titan-slots nog steeds
  overgeslagen (nu redundant: zaterdag heeft er geen).
- **Oude kalenderdagen blijven ongemoeid** (`LEGACY_SLOT_KEYS` in `schedule.ts`): een dag
  die al een vlucht heeft met een **oude** slot-key (`morning-long`/`noon-practice`/
  `evening-short`) wordt door `ensureFlightsScheduled` **volledig overgeslagen**, zodat de
  nieuwe kalender er geen extra races bovenop plant. Zelf-uitdovend: zodra zo'n vlucht niet
  meer binnen de horizon (`SCHEDULE_HORIZON_DAYS 4`) valt, doet de guard niets meer en mag
  hij weg. Een bestaande **titan** deelt zijn key (`titan:<datum>`) en wordt dus door de
  gewone dedupe-check bewaard (blijft op 11:00 tot hij gepasseerd is).
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
  `ui.tsx`; week 4 → "nieuw seizoen"). Voorraad per voertype met een **voerbalie die twee
  kanten op werkt** (Kopen/Verkopen-schakelaar; verkopen aan `FOOD_RESALE_RATE` = 80%, met
  een *Alles*-knop voor de hele voorraad van dat type), voer-effecten **per dag** in
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
  **Enkel voor admins** staat er bij een live vlucht ook **⏩ Match beëindigen**
  (met bevestiging) → `POST /admin/flights/:id/finish`; zie §8.
- `InfirmaryPage` (Ziekenboeg) — zieke/gekwetste duiven; dokter/kinesist/medicatievoer;
  **herstelbalk per duif** (`ailment.healed`).
- `ProfilePage` — hoknaam, **thema-toggle (donker/licht)**, **"Start rondleiding"**.
- `RankingPage` — tabs **Melkers** (seizoenspunten), **Duiven** en **Criterium**
  (`AgeCupPanel`: de vier leeftijdsklassen van §2.10 spelregels, met hoever de
  driejarige cyclus staat). Duiven = drie ranglijsten:
  hoogste gemiddelde vluchtsnelheid, meeste podiums, meeste vooruitgang — via `state.pigeonRankings`).
  Kop toont "Seizoen X · week Y/4 · nog Z dagen" (tot seizoenseinde) + een tweede regel
  met **dagen tot de volgende speelweek** (`nextPlayWeek`+`timeUntil`).
- `AchievementsPage` (Prestaties) — tabs Badges · Trofeeën · **Seizoensprijzen**
  (Roekoes + Vleugels: tellingen goud/zilver/brons + erelijst uit `profile.awards`).
- `WikiPage` (`/wiki`, nav 📖 **Wiki**) — **statische**, client-only uitlegpagina van
  de strategie-bepalende mechanismen + kansen. **Dé plek voor lange uitleg** (zie
  §Tekstbudget): elk scherm houdt het bij het minimum en linkt hierheen. Secties (`id`):
  `genen` · **`coach`** · `ervaring` · `energie` (energie/voer/honger/rustkuur) · `vlucht` ·
  `eigenschappen` · `verdwalen` · `vorm` · `lage-energie` · **`titan`** · `estafette` ·
  `broeden` (kweken/overerving) · `ziekte` · **`ziekenboeg`** · `sterfte` · `rassen` ·
  `veilingen` · `hok` · `waarde` · `afscheid`. Bewust
  **niet 100% transparant**: richtwaarden i.p.v. exacte formules, geluk blijft benoemd.
  Geen backend/kosten. Cijfers **handmatig** in sync houden met `core/config/gameConfig.ts`.
  `WikiPage` scrollt naar de hash bij mount, dus `/wiki#coach` landt op de juiste sectie.
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
  een duif zakt/stijgt. De duifnaam linkt naar `/duif/:id`, en **de admin ziet daar álle
  eigenschappen** (zie §8, admin-doorbraak op de info-hiding).
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
- `BreedingPage`: nieuw koppel + lopende broedsels, én bovenaan het **nest-keuzescherm**
  (`components/NestChoice.tsx`) zodra een worp op een keuze wacht. Dat scherm toont per
  jong de score **en de gen-caps** (daar gaat de keuze over), heeft een uitklapbaar
  *Maak plaats* met 🕊️/🍲 per volwassen duif, en blokkeert het koppelformulier zolang het
  nest openstaat. Nav-teller op **Kweek** = `state.pendingNests`.
- Verder: `SponsorsPage`, `LoginPage`.

**Rondleiding (`components/Tour.tsx`):** interactieve spotlight-tour die per stap
naar de juiste pagina navigeert en het relevante element highlight via
`[data-tour="..."]`-ankers. `Tour` neemt een optionele **`steps`-prop** (default =
volledige `STEPS`). De volledige tour dekt o.a. **rassen** (`BREED_STEP`, anker
`[data-tour="pigeon"]`: foto/zeldzaamheid/kans/kweek), oefenvluchten, rustkuur, markt +
**"🕊️ Bied op andermans duiven"** (anker `[data-tour="market-bid"]`: speler→duif→
bedrag + verborgen eigenschappen), **seizoen, ranglijst (Roekoe), duivenranglijsten
(Vleugel)**, het **leeftijdscriterium** (`AGE_CUP_STEP`, anker `[data-tour="age-cup"]`)
en de prestige-seizoensprijzen. Eenmalig per speler (localStorage
`roekoe.tourSeen.<id>`), draait vanuit `Layout` (blijft gemonteerd tijdens navigatie);
de profielknop herhaalt hem via `window.dispatchEvent(new Event('roekoe:start-tour'))`.

**"Wat is nieuw"-melding:** dezelfde `Tour` maar met een **subset** stappen. Actueel
= **`AGE_CUP_NEWS_STEPS`** (leeftijdscriterium: intro + de vier klassen/inschrijven +
waarom de stand drie seizoenen loopt). Eigen localStorage-sleutel
`roekoe.newsSeen.agecup2.<id>` (de `2` omdat de eerste, te lange versie opnieuw
getoond moest worden); toont pas als de hoofd-tour niet open is. `closeTour` zet ook de news-sleutel, zodat een
nieuwe speler die de volledige tour afrondt niet nog eens de news krijgt. Bump de
sleutel-suffix + wissel de `steps`-set (import in `Layout`) voor een volgende
aankondiging. De vorige sets `FAREWELL_NEWS_STEPS`, `REST_CURE_NEWS_STEPS`,
`RELAY_NEWS_STEPS`, `GENES_NEWS_STEPS`, `BREED_NEWS_STEPS`, `BID_NEWS_STEPS` en
`SEASON_NEWS_STEPS` blijven in `Tour.tsx` als referentie. (De oude `FeatureTour` met gecentreerde kaarten
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
**altijd `context.md`** (§0). Hoort er uitleg bij? Die gaat in **`WikiPage.tsx`**;
het scherm zelf blijft kort en linkt ernaar (§0, punt 4).

### Verifiëren vóór commit
```bash
npx tsc --noEmit                 # server/core typecheck (vanuit root)
cd client && npx tsc --noEmit    # client typecheck
npm run build                    # bouwt de client (vanuit root)
```
Voor engine-logica: snelle integratietests met **tsx** vanuit de repo-root
(`npx tsx <test>.mts`, importeert rechtstreeks uit `./core/...`; achteraf verwijderen).
Uitzonderingen die **wél blijven staan** — draai ze na **elke** wijziging aan
`core/d1.ts` of aan een tick in `schedule.ts`:
```bash
npx tsx d1-partial-load.test.mts   # persistentie: laadt/schrijft de juiste slice
npx tsx query-budget.test.mts      # D1: geen enkel verzoek over de 50 queries
npx tsx idle-writes.test.mts       # D1: een poll zonder gebeurtenissen schrijft niets
npx tsx names.test.mts             # elke duivennaam blijft uniek
npx tsx advance-throttle.test.mts  # CPU: een leespoll slaat de engine over
npx tsx cpu-budget.test.mts        # CPU: geen enkel pad over de 10 ms (koud!)
npx tsx daily-budget.test.mts      # D1-DAGlimieten: een drukke dag < 50% van 5M/100k
npx tsx sponsor-refusal.test.mts   # een slechtere concurrent-sponsor komt niet terug
npx tsx commentary.test.mts        # het live verslag groeit aan, herschrijft niet
npx tsx betting-odds.test.mts      # weddenschapskansen kloppen en zijn stabiel
npx tsx poll-budget.test.mts       # polls + smalle load blijven binnen het dagbudget
npx tsx force-finish.test.mts      # admin-"match beëindigen" == natuurlijk uitvliegen
npx tsx newcomer.test.mts          # starterspakket: punten, tijdvenster, afloopmelding
npx tsx velocity-model.test.mts    # ervaring raakt de snelheid van een frisse duif niet
npx tsx age-cup.test.mts           # leeftijdscriterium: klassen, afwisseling, 3-seizoenencyclus
npx tsx pigeon-logs.test.mts       # de logboeken blijven uit de wereldload, legacy blijft leesbaar
npx tsx season-prizes.test.mts     # seasonWins reset, totalWins niet; ceremonie = laatste seizoen
npx tsx bot-market.test.mts        # de prijsgrens voor bots (anti-exploit) + hun trainingsregels
```
Diagnose zonder assertie: `npx tsx cpu-sweep.mts` (CPU per operatie, duurste
eerst), `npx tsx limits-report.mts` (queries/rijen per verzoek) en
`npx tsx cpu-pigeons.mts` (**marginale** CPU per duif — de helling, niet de
absolute waarde, want lokaal draait SQLite synchroon in hetzelfde proces).
Ook handig: `BREAKDOWN=1 npx tsx query-budget.test.mts` splitst het duurste
verzoek uit per statement.
(Beide staan buiten `tsconfig.json` (`include` = `core/` + `functions/`), dus tsc raakt ze niet.)

### Git + deploy (ALTIJD, zie §0)
1. Ontwikkel + commit op de **dev-branch uit §0**; push met
   `git push -u origin <dev-branch>` (retry met backoff).
2. **Deploy meteen naar productie** door de commit op de deploy-branch te zetten:
   ```bash
   git fetch origin claude/roekoe-game-website-jwa0vo
   git checkout claude/roekoe-game-website-jwa0vo
   git reset --hard origin/claude/roekoe-game-website-jwa0vo
   git cherry-pick <commit>        # of meerdere
   # typecheck + build ter controle
   git push -u origin claude/roekoe-game-website-jwa0vo   # triggert Cloudflare Pages
   git checkout <dev-branch>                  # terug naar dev
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
**`dataVersion = 42`**.

**Leeftijdscriterium: vier leeftijdsklassen, één vlucht per week, drie seizoenen (nieuwste)**
- **Vraag van de eigenaar:** een extra rangschikking per leeftijdsklasse (< 1 j / 1–2 j /
  2–3 j / > 3 j), met per klasse één eigen wekelijkse vlucht waar enkel duiven van die
  leeftijd in mogen, €20 inschrijfgeld, week om week kort (100–300 km) en lang (400–1000 km),
  enkel duivenpunten, en een reset met prijzen na **drie** seizoenen i.p.v. één.
- **Kalender:** vier nieuwe slots in `REAL_SCHEDULE` (`cup-u1` ma · `cup-y12` wo · `cup-y23`
  do · `cup-o3` vr, telkens **06:00**), gegenereerd uit `AGE_CATEGORIES` zodat de tabel en de
  kalender niet uit elkaar kunnen lopen. `ScheduleSlot.ageCat` stuurt `makeRealtimeFlight`
  naar een eigen tak met eigen route-venster, naam en inschrijfgeld.
- ⚠️ **Waarom de afwisseling op een SEIZOENSANKER hangt en niet op `dayNumber`.** De estafette
  gebruikt `floor(dayNumber/7) % 2`, en die weekbuckets beginnen op **donderdag** (dag 0 van de
  epoch). Met vier vluchten op ma/wo/do/vr zou dat maandag+woensdag in een ándere bucket zetten
  dan donderdag+vrijdag — dus binnen één kalenderweek twee verschillende formats. Nu telt
  `cupWeekIndex(db, atMs)` de weken vanaf **`world.ageCupStartedAt`**, dat op een seizoensgrens
  ligt. Die index is dus tegelijk de seizoensweek: even = sprint, oneven = fond → exact **2+2
  per seizoen en 6+6 per cyclus**, en de cyclus eindigt precies op een prijsuitreiking.
  Vóór het anker geeft de helper **−1** en wordt er niets gepland — zo begint de competitie
  vanzelf bij het nieuwe seizoen zonder een datum in de code.
- **Leeftijdsklasse wordt PER VLUCHT bepaald, bij het inschrijven** (`enterFlight` +
  `botRaceCandidates` delen dezelfde `ageCategoryFor`-check). Bewuste keuze van de eigenaar, en
  ze moest gemaakt worden: duiven verouderen **4× real-time**, dus over drie seizoenen (12 echte
  weken = 48 gameweken) wordt een duif **bijna een heel duivenjaar** ouder. Een duif klimt dus
  mid-cyclus een klasse omhoog. De punten die ze in haar oude klasse verdiende **blijven daar
  staan** (`Pigeon.cup` is een record **per klasse**), dus ze kan legitiem in twee standen
  tegelijk verschijnen.
- **Scheiding van de melker-economie:** `flightPrizes(flight)` (nieuw, `flight.ts`) centraliseert
  de drie prijzentabellen; `finalizeFlight` geeft **0 seizoenspunten** en telt **geen `wins`**
  voor een criteriumvlucht, en `tickFlights` slaat er badges/bets/missies/sponsorpremie over via
  dezelfde `continue` als titan/estafette. De **duivenranglijsten tellen hem wél** mee
  (`seasonPeakSpeed`/`seasonPodiums`), net als de titan.
- **Punten naar de duif:** `tickFlights` schrijft `RANKING_POINTS[rank-1]` in
  `Pigeon.cup[ageCat]` (`{points, wins, best, races}`) — sprint en fond wegen **even zwaar**,
  enkel het geld verschilt. `ageCupRankings` (season.ts) sorteert op punten → zeges → beste
  ritgemiddelde.
- **Cyclus-einde in `runSeasonEnd`:** `runAgeCupCycleEnd` telt de seizoenen (`world.
  ageCupSeasonsDone`) en houdt bij de derde de prijsuitreiking: €2000/€1600/€1200 naar de
  **eigenaar** (als `SeasonAward` met `kind: 'criterium'`, dus zichtbaar in Prestaties) én een
  **`PigeonTitle` op de DUIF** (`Pigeon.titles`) — die blijft bij haar als ze verkocht wordt,
  wat het punt van "een badge voor de duif" was. Daarna worden alle `cup`-standen gewist en
  wordt het anker op deze grens gezet. ⚠️ De teller gebruikt een **strikte** vergelijking met
  het anker, anders zou het seizoen dat exact op de startgrens eindigt al meetellen.
- **Leesbudget:** de vier standen scannen élke duif, precies zoals `pigeonSeasonRankings`, dus ze
  rijden mee in **dezelfde `World.leaderboard`-cache** (`computeLeaderboard` → `cupRankings`).
  Ze op `/state` berekenen zou de hele `pigeons`-tabel terug op de heetste route trekken — net
  wat die cache moet voorkomen. Gemeten: `daily-budget` blijft op **24,6 %** van de 5M/dag (was
  24,2 %), `query-budget` op **43 van de 50**, en een idle poll schrijft nog steeds 0 rijen.
- **Persistentie:** kolommen `flights.age_cat` + `cup_sprint`, `pigeons.cup` + `titles`,
  `world.age_cup_started_at` + `age_cup_seasons_done`, alle **achteraan** `SCHEMA_STEPS`
  (append-only). **Migratie v40** zet het anker op `world.seasonEndsAt`. **dataVersion → 40.**
- **UI:** derde tab **Criterium** op `RankingPage` (vier standen + hoever de cyclus staat),
  badges + regelregel + een gefilterde duivenkiezer op `FlightsPage`, en op `PigeonPage` de
  titels als badge naast de naam plus een `CriteriumCard` met haar huidige klasse en stand per
  klasse. Wiki-sectie 🏆 **Leeftijdscriterium**; spelregels **§2.10** (+ §2.1, §12, §14, §15).
- **Communicatie naar de spelers, op twee manieren:**
  1. **Eerste-login-melding** `AGE_CUP_NEWS_STEPS` (Tour.tsx, 3 korte stappen: wat het is · de
     vier klassen + inschrijven · waarom de stand drie seizoenen loopt), sleutel
     `roekoe.newsSeen.agecup2.<id>` — vervangt `REST_CURE_NEWS_STEPS` als actieve set in
     `Layout.tsx`. De gedeelde stap **`AGE_CUP_STEP`** (anker `[data-tour="age-cup"]` op de
     Criterium-tab) zit óók in de **volledige** tour, na `VLEUGEL_STEP`, dus hij blijft
     herhaalbaar vanuit het profiel en nieuwe spelers krijgen hem gewoon mee.
  2. **Migratie v41 — een belmelding** per echte speler (stabiele id
     `ntf:news:agecup:<userId>`, bots overgeslagen), opgebouwd uit `AGE_CUP` door de helper
     **`announceAgeCup(db, idPrefix)`** zodat herbalanceren de melding niet laat liegen.
     ⚠️ Bewust náást de tour: die spotlight is wég zodra iemand ze wegklikt, terwijl de eerste
     criteriumvlucht pas een week later op de kalender staat. **dataVersion → 41.**

**Bots winkelen op de markt, en trainen zoals een speler (nieuwste)**
- **Eerst gemeten, want de vraag ging over achterstand.** Acht weken gesimuleerd tegen de
  echte engine: bots **coachten al aan hun plafond** (16 van de 16 mogelijke, `BOT.maxCoached`
  2 × 8 bots) en trainden ook. Hun talent liep gewoon op, 50,2 → 55,4. Wat ze **niet** deden
  was hun geld uitgeven: tegen week 8 zat elke bot op **€19.000–46.000** stil. Dát was het gat,
  niet de coach.
- **Twee ingrepen.**
  1. **`maybeBuyFromMarket`** (bots.ts, aan het eind van `botDailyActions`): een bot koopt een
     te-koop-staande duif van een échte speler wanneer ze een verbetering is. Met plaats over
     volstaat "niet slechter dan mijn slechtste"; zit het hok vol, dan moet ze de slechtste
     **verslaan** met `BOT.marketMinGain` (3) en wordt die slechtste vrijgelaten om plaats te
     maken. Hoogstens één aankoop per bot per dag.
  2. **`maybeTrain` herschreven.** Het was één duif, één willekeurige eigenschap, op een
     15%-dagworp — ongeveer één training per week voor het hele hok, terwijl een speler élke
     duif op élke eigenschap 1×/week mag trainen. Nu `BOT.trainPerDay` (3) duiven per dag, op
     de goedkoopste nog-trainbare eigenschap, en — nieuw — **mét de weeklimiet per eigenschap**
     (`TRAINING.cooldownDays` via `Pigeon.trainedAt`) die de oude versie stilletjes negeerde.
     Bot-training wordt nu ook gelogd via `noteAttrChange`, dus de admin-inspector ziet ze.
- ⚠️ **`BOT.marketMaxOverpay` (1,25) is de belangrijkste regel van het hele blok.** Een speler
  bepaalt zélf zijn vraagprijs. Zonder plafond zet iemand zijn slechtste duif op €40.000 en
  leegt daarmee elke bot in de club — dat is een geldpers, geen markt. Een bot betaalt nooit
  meer dan 1,25× de **marktwaardering** (`game/market.ts`, zelf afgeleid uit echte verkopen),
  nooit meer dan `marketMaxShare` (0,5) van zijn vrije kas, en nooit onder `marketReserve`
  (€4.000). **Bots kopen ook niet van elkáár**: dat zou enkel geld rondschuiven en de
  waardering vervuilen met prijzen waar nooit een mens mee akkoord ging.
- ⚠️ **Bewuste afwijking van de letterlijke vraag:** "of als ze nog ruimte in hok over hebben"
  is niet "koop dan om het even wat". Een bot die zijn lege stok volzet met talent-40 duiven
  verwatert elk veld waar hij mee instapt. Met plaats over koopt hij dus wel makkelijker, maar
  nog steeds niets dat slechter is dan wat hij al heeft.
- **Gedeeld verkooppad:** `settlePigeonSale(db, buyer, pigeon)` is uit `buyPigeon` gelicht
  (engine.ts) en wordt door beide gebruikt, zodat een botaankoop letterlijk dezelfde transactie
  is als die van een speler: verkoper betaald, `stats.sells`, de handelaar-badge, de
  marktmissie, en de trade als **prijsobservatie** voor de waardering. Meegenomen: de verkoper
  krijgt nu een **melding** dat zijn duif verkocht is — zonder dat verdwijnt er bij een
  botaankoop gewoon een duif uit zijn hok zonder dat iemand iets klikte.
- ⚠️ **Modulecyclus.** `bots.ts` importeert nu `purgePigeon`/`settlePigeonSale` uit `engine.ts`,
  dat op zijn beurt `botTakeWeeklyActions` uit `bots.ts` haalt. Veilig omdat beide kanten elkaar
  enkel *binnen een functie* aanroepen, nooit tijdens het evalueren van de module — geverifieerd
  door de hele suite, die dat pad via `advanceRealtime` → `tickDailyCare` → `botDailyActions`
  echt draait.
- **Gemeten na de ingreep** (8 weken, speler zet elke dag zijn beste duif te koop aan de
  geschatte waarde): **elke** listing werd gekocht (6 van 6), de speler verdiende er €11.942
  mee, en de laagste botkas zakte van €18.927 naar €8.406 — ze geven het dus effectief uit en
  blijven ruim boven hun vloer. Query-budget 40/50, dagbudget 24,3 % gelezen / 7,5 % geschreven.
- ⚠️ **Een verse listing is eerst van de spelers** (`BOT.marketMinListedHours`, 24 u). Bots
  winkelen op de **dagovergang**, dus een duif die om 23:55 te koop gaat kon verkocht zijn
  vóór één speler ze ooit zag verschijnen. Nieuw veld **`Pigeon.listedAt`** (kolom `listed_at`):
  gestempeld door `listForSale`, gewist door `unlist` en door de verkoop zelf — opnieuw
  plaatsen herstart de klok, want dat is een nieuw aanbod. Een listing **zonder** stempel komt
  van vóór deze regel en geldt als oud, dus die blijft gewoon koopbaar.
  Zichtbaar gemaakt op de markt (🆕 "nog X u alleen voor spelers", uit
  `economy.botMarketDelayHours`) — een voorsprong die je niet ziet, is er geen.
- **Nieuwe blijvende test `bot-market.test.mts`** (33 controles), met de wachttijd en de
  prijsgrens als de twee eerste en zwaarste blokken. ⚠️ De wachttijd-test rekent vanaf de
  **échte** `listedAt`-stempel: `listForSale` zet daar de wandklok in, dus een verzonnen
  testklok gleed er ongemerkt langs (dat gebeurde ook — drie controles slaagden vals).

**Prijsuitreiking als ceremonie + de winst-kolom reset mee (nieuwste)**
- **Vraag van de eigenaar:** de prijzen stonden samengeperst in één belmelding. Nu krijgt
  **elke prijs zijn eigen scherm**, met de beker in beeld en het bijhorende bedrag. En de
  kolom **Winst** op de ranglijst moest mee resetten met het seizoen.
- ⚠️ **`totalWins` mocht NIET gereset worden, en dat is niet zichtbaar aan de kolom.**
  Sponsordrempels hangen eraan (`req.totalWins` 1/5/8/12 in `SPONSORS`) en hij weegt in
  `sponsorScore` (`loft.totalWins * 8`); elk seizoen nullen zou die tiers om de vier weken
  opnieuw dichtgooien. Nieuw veld **`Loft.seasonWins`** (kolom `season_wins`, default 0):
  `rankingRows` toont dát als "Winst", `runSeasonEnd` zet het op 0, en de tiebreak in de
  seizoensstand gebruikt het ook. `totalWins` blijft levenslang en blijft op het profiel staan.
  Omdat de kolom op 0 begint, staat iedereen dit seizoen meteen correct — geen migratie nodig.
- **De ceremonie** (`client/src/components/PrizeCeremony.tsx`): volledig scherm, één prijs per
  keer, in de volgorde Roekoe → Vleugels → Criterium en binnen elke soort de hoogste plaats
  eerst. Per prijs: de **beker in SVG**, waarvoor je hem won, en het bedrag dat **omhoog telt**.
  Drie vormen (cup / vleugel / medaille) × drie metalen via één verloop, dus goud-zilver-brons
  komt uit `rank`. Bewust **getekend en niet als afbeelding**: scherp op elk scherm, themavast,
  en geen assets om te beheren. Gecontroleerd met een Playwright-screenshot in **beide thema's**.
- **Geen serverstatus.** `loftDTO.ceremony` draagt de prijzen van het **laatst gewonnen**
  seizoen (bounded: enkel dát seizoen, niet de hele erelijst — dit rijdt mee op `/state`), en
  localStorage (`roekoe.ceremonySeen.<id>`) onthoudt wat al gevierd is.
  ⚠️ **Plus een guard op `world.seasonYear - 1`**: zonder die check vierde een verse browser
  een overwinning van maanden terug opnieuw, want `awards` bewaart alles.
- **Volgorde in `Layout`:** hoofdtour > ceremonie > "wat is nieuw" > gebeurteniskaart. Net
  gewonnen weegt zwaarder dan een aankondiging, en de ceremonie is maar één seizoen relevant.
- De **belmelding blijft** bestaan als naslagwerk; dit is het feestje ernaast.
- `prefers-reduced-motion` zet beide animaties uit.
- **Nieuwe blijvende test `season-prizes.test.mts`** (15 controles): de kolom toont de
  seizoenswinst, de rollover reset `seasonWins` maar niet `totalWins`, en de ceremonie draagt
  precies de prijzen van het net afgelopen seizoen met het juiste bedrag per prijs.

**`SELECT * FROM pigeons` was de CPU-moordenaar — historiek uit de duivenrij (nieuwste)**
- **Vraag van de eigenaar:** "er gebeurt altijd een `select * from pigeons` wanneer de wereld
  laadt … die verbruikt het meest in termen van CPU load." Klopt, maar niet om de reden die
  voor de hand ligt — en de échte oorzaak was erger dan gedacht.
- ⚠️ **De query zélf is I/O.** Wachten op D1 telt **niet** mee voor de 10 ms CPU van een
  Worker-invocatie. Wat wél telt is wat er met die rijen gebeurt: ze omzetten naar entiteiten
  (7× `JSON.parse` per duif) en ze snapshotten voor de diff (`JSON.stringify` per duif).
  Lokaal draait SQLite synchroon in hetzelfde proces, dus een kale timing meet beide door
  elkaar en zegt niets — vandaar het nieuwe `cpu-pigeons.mts`, dat de **marginale** kost per
  duif meet (de helling bij een oplopende wereld).
- **Gemeten, met ablatie (260 duiven, volle load):**

  | | vóór | na |
  |---|---|---|
  | volle load zónder de twee logboeken | 3,79 ms | 3,43 ms |
  | volle load mét beide logboeken op hun cap | **32,41 ms** | **3,61 ms** |
  | aandeel van de logboeken | **88 %** | **5 %** |

  Uitgesplitst op 264 duiven: `JSON.parse` van de twee blobs **13,0 ms**, de `JSON.stringify`
  voor de diff **9,4 ms**. Samen ~22 ms lokaal — en productie is ~1,9× trager (ronde 6), dus
  ~42 ms tegen een budget van **10**. Dat is de terugkerende Error 1102, en hij **groeide
  stilletjes mee**: een duif vult haar logboek in enkele weken tot de cap.
- **Wat er in die blobs zat:** `Pigeon.raceLog` (40 plaatsingen) + `Pigeon.attrLog` (40
  skill-wijzigingen) = ~13 KB per duif, dus ~3,3 MB per verzoek bij 264 duiven. **Geen enkele
  engine-tick leest ze.** Ze worden alleen getoond door de duif-historiek, de trofeeënkast en
  de admin-inspector — drie schermen die een speler bewust opent.
- **De ingreep.** Nieuwe tabel **`pigeon_log_entries (id, pigeon_id, kind, at, data)`**,
  **append-only, één rij per regel**. Dat laatste is de sleutel: de engine is **synchroon** en
  kan midden in een tick niets uit de database lezen, dus een append mag de vorige waarde niet
  nodig hebben — een read-modify-write op een afgetopte array kon dus niet. `noteAttrChange` en
  `logRaceResults` schrijven in **`Pigeon.pendingLog`**, een transiënte wachtrij die `persist`
  leegmaakt. `PIGEON_SELECT` vervangt `SELECT *`.
- ⚠️ **Migratievrij, en waarom dat veilig is.** De oude kolommen blijven gewoon op schijf staan
  en worden nooit meer gelezen of geschreven. Dat mag omdat `diff` een **bestaande** duif met een
  kolom-smalle `UPDATE` wegschrijft (`previousRows`): een kolom die niet in `PIGEON_COLUMNS`
  staat, wordt nooit overschreven. Enkel een **nieuwe** duif gaat door `INSERT OR REPLACE` — en
  die heeft geen historiek te verliezen. `loadPigeonLogs` leest de legacy-blobs er nog steeds
  bij en versmelt ze, dus er verdwijnt niets. **`pigeon-logs.test.mts` bewaakt precies dat**,
  want het is het stilste faalgeval dat er is.
- **Meegenomen, en het was de grootste enkele post geworden:** `boundedCleanups` deed **één
  `DELETE` per genotificeerde speler**. Op een vluchtafronding waren dat **10 van de 49
  statements**, tegen een harde limiet van 50. Nu één statement voor allemaal, met dezelfde
  window-functie als de log-trim. De afronding gaat van **49 → 38 queries** — beter dan de 43
  van vóór deze hele reeks.
- **De log-trim is een SOFT cap:** boven `PIGEON_LOG_TRIM_MAX_APPENDS` (40) appends in één
  verzoek wordt hij overgeslagen. Een vluchtafronding schrijft een regel per finisher, en dat is
  net het verzoek met de minste ruimte; die duiven worden bij hun volgende gewone append
  getrimd. Een handvol extra rijen in een tabel die niemand pollt kost niets.
- **Routes die de logboeken nu apart ophalen** (elk één extra query, geen van drie wordt
  gepollt): `GET /pigeons/:id` (historiek), `GET /profile` (trofeeën), `GET /admin/pigeons`
  (inspector). `pigeonRaceHistory(log)` en `playerProfile(db, userId, logs)` krijgen ze
  binnengereikt — `presenters.ts` blijft runtime-neutraal.
- **Nieuwe blijvende test `pigeon-logs.test.mts`** (20 controles) + `BREAKDOWN=1` op
  `query-budget.test.mts` om het duurste verzoek per statement uit te splitsen.
- ⚠️ **Regel voor nieuwe code:** zet **nooit** een groeiend veld op `Pigeon` (of `Loft`) dat de
  engine niet nodig heeft. Élk veld daar wordt bij ieder verzoek geparsed én gestringify'd voor
  de diff, voor élke duif in de wereld. Groeiende historiek hoort in een eigen append-only
  tabel, met een loader die enkel draait op de route die ze toont.

**Te veel tekst in het spel — ingekort en opnieuw aangekondigd (nieuwste)**
- **Aanleiding (eigenaar):** de update was te woordrijk in het spel, en de tourkaart was
  "moeilijk leesbaar, vooral de 2e stap, want ik kan niet scrollen".
- ⚠️ **Dat scrollen was een echte bug in `Tour.tsx`, niet enkel te veel tekst.** De kaart had
  wél `overflow-y: auto`, maar een **vaste** `maxHeight: calc(100vh - 24px)` — en die klopt
  alleen voor een gecentreerde kaart. Verankerd ónder een doel (`top: rect.bottom + 12`) liep
  ze gewoon voorbij de onderrand: de Vorige/Volgende-knoppen stonden buiten beeld en de eigen
  scrollbar kon er niet bij. Nu bepaalt **`popStyle` de hoogte mee**: de beschikbare ruimte
  boven/onder het doel wordt gemeten, de ruimste kant wint, en past geen van beide (< 180 px)
  dan wordt de kaart over de spotlight gecentreerd. Plus `overscroll-behavior: contain`.
  **Dit gold voor élke tourstap, niet enkel deze aankondiging.**
- **Ingekort volgens de tekstbudgetregel (§0, punt 4):** de belmelding van ~1.100 → **418
  tekens**, de drie news-stappen tot 1–2 zinnen, `AGE_CUP_STEP` tot twee zinnen, het
  criterium-blok op `RankingPage` van drie alinea's naar één regel (seizoen X van 3 + wikilink),
  de regel op `FlightsPage` en de `CriteriumCard` op `PigeonPage`. Alle mechaniek, klassen,
  prijzentabellen en tactiek staan **enkel** in de wiki.
- **Migratie v42 — opnieuw aankondigen** aan wie de eerste versie al zag: de news-sleutel is
  gebumpt naar `agecup2` (tour) en `announceAgeCup` wordt opnieuw gedraaid (bel).
  ⚠️ **Met dezelfde melding-id, en dat is de hele truc.** Een nieuwe id zou de oude, lange rij
  laten staan bij iedereen behálve de ene speler wiens verzoek de migratie toevallig draait:
  `notifications` wordt **per viewer** geladen (`WHERE user_id = ?`), dus `persist` kan enkel
  wissen wat het geladen heeft — de rest hield er dan **twee**. Dezelfde id maakt er één
  `INSERT OR REPLACE` per speler van. Daarna wordt `read` expliciet op **false** gezet: voor
  andere spelers levert `pushNotification` sowieso een verse ongelezen rij, maar voor de viewer
  behoudt hij bewust de bestaande `read`-vlag — precies de speler die de herschrijving dan
  nooit zou zien. **dataVersion → 42.**
- **`age-cup.test.mts` → 68 controles**, met een blok dat de **productiesituatie** naspeelt
  (wereld al op v41, lange tekst al gelezen, één speler draait de migratie): één rij per speler,
  bij iedereen vervangen, bij iedereen weer ongelezen. Een verse wereld kan dat geval niet
  tonen — daar draaien v41 en v42 in hetzelfde verzoek.
- ⚠️ **Om op te volgen:** de klasse **> 3 jaar** kan dun bevolkt zijn (startduiven worden
  8–130 gameweken terug gedateerd), en een wedstrijdvlucht met < 2 melkers wordt afgelast. Bots
  doen mee en vangen dat grotendeels op, maar het is het eerste om te meten als die vlucht vaak
  niet doorgaat. Knop daarvoor: de grens van `o3` verlagen of de klassen samenvoegen.
- **Nieuwe blijvende test `age-cup.test.mts`** (68 controles): het anker, geen vluchten vóór de
  start, vier klassen op hun eigen dag met precies één vlucht per week, de 2+2/6+6-afwisseling en
  dat alle klassen dezelfde week hetzelfde format vliegen, de leeftijdsgrens voor speler én bot,
  geen limiet per hok, prijzengeld ja / seizoenspunten en `wins` nee, punten in de juiste klasse
  (én dat ze een rondje door D1 overleven), dat een gewone seizoenswissel de stand **niet** wist,
  en de reset na drie seizoenen met geld, titel en schone lei. Plus de aankondiging: elke echte
  speler krijgt er precies één, bots geen, de tekst noemt de dingen die de speler moet weten, en
  een tweede run stuurt er geen tweede. ⚠️ Die controle leest **rechtstreeks uit SQL** — een
  viewer-scoped load draagt enkel de inbox van díe speler, dus via de store zou hij altijd 0 zien.
- ⚠️ **Vijf bestaande tests aangepast, niet verzwakt:** `force-finish`, `advance-throttle`,
  `idle-writes`, `query-budget` en `daily-budget` pakten "de eerste geplande wedstrijdvlucht" en
  schreven er willekeurige duiven in. Dat kan nu een criteriumvlucht zijn, en die weigert een duif
  van de verkeerde leeftijd — `force-finish` viel daardoor sporadisch om met een lege deelnemerslijst.
  Ze sluiten `f.ageCat` nu uit, net zoals ze `practice` en `relay` al uitsloten.

**Ervaring is uit de snelheidsformule (nieuwste)**
- **Aanleiding (eigenaar):** "ervaring hoort geen invloed te hebben op snelheid, daar is
  de eigenschap snelheid voor." Terecht — en het was dezelfde fout als bij oriëntatie.
- **Gemeten vóór de ingreep.** `experienceFactor = 1 + ervaring/300` gaf tot **+33 %**.
  Per púnt was ervaring niet te zwaar (0,31–0,37 km/u, tegen snelheid 0,19–0,48), maar
  haar **bereik** wel: ervaring loopt 0→100 (**+31 tot +36 km/u**) terwijl snelheid en
  conditie in hun gen-band 70–95 zitten (**+12 tot +3 km/u**). In een gemengd veld leverde
  ervaring **4,35 km/u** spreiding tegen snelheid 3,06 en conditie 3,20 — ze was dus de
  grootste onderscheider, en een duif met ervaring 0 kon niet mee, hoe snel ook.
- **Wat weg is:** `experienceFactor` uit `pigeonVelocity` **en** uit `velocityBreakdown`
  (de admin-ontleding moet de formule exact spiegelen, anders liegt de tool). Het veld
  `VelocityBreakdown.experienceFactor` bestaat niet meer; `AdminPage` verloor die kolom.
- **Wat blijft — en dat is het punt:** ervaring is nu puur **efficiëntie**. Minder
  energie per vlucht (33–37 %), sneller herstel (+50 %), en **energie-dosering** in
  `energieFactor`. Dat laatste raakt de snelheid nog, maar **voorwaardelijk**: gemeten op
  500 km levert ervaring 0→100 bij een **volle tank 0,0 km/u** op, bij energie 70 +4,8, bij
  40 +10,4 en bij 20 +15,1. Een frisse duif haalt er dus niets uit; een lege wel. Dat is
  precies de rol die de eigenaar beschreef: snelheid bepaalt hoe hard, energie en conditie
  hoe lang.
- **Na de ingreep** weegt op 150 km snelheid het zwaarst (10,3 km/u) en op 1000 km conditie
  (9,3), met ervaring er telkens onder. Het gat tussen ervaring 0 en 90 zakt van **37 % naar
  5 %** — dat is een grotere hulp voor nieuwkomers én voor elk gekweekt jong dan het hele
  starterspakket.
- ⚠️ **Vluchten duren ~27 % langer** en dat is een **bewuste keuze van de eigenschap**: de
  basisconstante is *niet* gecompenseerd. Gemiddeld veld: 150 km 1,4 → 1,7 u · 500 km
  4,5 → 5,7 u · 1000 km 8,8 → 11,2 u. Wil je dat ooit terugdraaien zonder ervaring terug te
  brengen, dan is `(700 + score·9)` → `(890 + score·11,4)` de exacte compensatie.
  **Gecontroleerd op het leesbudget** (langere races = meer live-polls): `daily-budget`
  blijft op **24,2 %** van de 5M/dag, dus daar zit geen probleem.
- **Geen spelersaankondiging** (expliciet niet gewenst), geen migratie, geen schemawijziging,
  `dataVersion` blijft 39.
- **Nieuwe blijvende test `velocity-model.test.mts`** (19 controles): een frisse duif haalt
  niets uit ervaring op 150/500/1000 km, op een lage tank wél en monotoon meer naarmate ze
  leger staat, snelheid/conditie wegen overal zwaarder dan ervaring, snelheid domineert de
  sprint en conditie de fond, een **snelle groentje klopt een trage veteraan**, en de
  admin-ontleding blijft gelijk aan de echte snelheid. Alle 15 andere regressietests +
  beide typechecks + build groen.
- Spelregels **§1** en **§2.3** herschreven; wiki-secties 🎓 **Ervaring** (met de
  doseringstabel) en 📋 **Wat doet elke eigenschap** bijgewerkt.

**Migratie v39 — starterspakket voor "Vleugels Inc." en "Roekoeloos"**
- Op verzoek van de eigenaar krijgen deze twee bestaande spelers het **volledige
  starterspakket** met terugwerkende kracht: 30 ervaringspunten, 5 eigenschapspunten,
  28 dagen gratis coach + dubbele winst, hun duiven bijgetankt naar 100 energie, en een
  tier-1 sponsoraanbod.
- Match op **hoknaam óf gebruikersnaam**, hoofdletter-ongevoelig (`'vleugels inc.'` /
  `'vleugels inc'` / `'roekoeloos'`), **enkel echte spelers** — een bot met dezelfde naam
  blijft ongemoeid. Stabiele melding-id `ntf:admin:newcomergrant:<userId>`, dus twee
  gelijktijdige verzoeken geven nooit twee meldingen of een dubbel pakket.
- **Hun venster van 28 dagen start bij de migratie**, niet bij hun oorspronkelijke
  registratie — anders zouden ze er niets aan hebben. Een hok dat al een pakket heeft
  wordt overgeslagen (`if (loft.newcomer) continue`), dus de klok wordt nooit gereset.
- ⚠️ **Bijtanken slaat twee groepen bewust over:** duiven die **vliegen**
  (`pigeonCommittedToFlight`) — een live vlucht rekent haar energie af tegen een bevroren
  `formCost`, daar moet je niet in prikken — en duiven die **de weg kwijt** zijn
  (`isAway`), want die horen leeg thuis te komen (§3.5 spelregels).
- **dataVersion → 39.** Geverifieerd in `newcomer.test.mts` (14 extra controles): match op
  hoknaam én op gebruikersnaam, een derde speler krijgt niets, een gelijknamige bot krijgt
  niets, de duiven van de anderen blijven op hun energie staan, precies twee meldingen, en
  een tweede run kent niets nog eens toe en verplaatst geen geld.

**Starterspakket voor nieuwe spelers**
- **Aanleiding:** een wereld die al een maand draait is feitelijk **dicht** voor een
  nieuwkomer. Gemeten tegen de echte engine (6 verse duiven tegen 12 duiven van twee
  maandveteranen, 20.000 races per afstand): **0,0 % winst, 0,0 % top-3**, en in ~90 %
  van de races levert de nieuwe speler de **laatste** duif. De veteraan is 44–53 %
  sneller terwijl geluk maar ±10 % speelt — dat is geen nadeel maar een muur.
- **De oorzaak is ervaring, niet talent.** Ablatie: betere startduiven geven (quality
  0,7–0,9 op álle zes) verandert **niets** (0,0 %), want de gen-caps drukken de
  eigenschappen samen. Ervaring 76 cadeau brengt het op 5,1 % winst / 23,7 % top-3.
  Ervaring telt namelijk **drie keer** mee: ×1,33 op de snelheid, energie doseren
  (§2.3 spelregels) én minder verbruik per vlucht (§3). En elke starterduif begon op **0**.
- **Nieuw config-blok `NEWCOMER`** + nieuw bestand **`core/game/newcomer.ts`** met álle
  logica op één plek. Het pakket splitst in twee soorten:
  - een **portemonnee** (`expPoints` 30, `attrPoints` 5) die de speler **zelf richt** en
    die **niet verloopt** — welke duif je backt is de eerste echte keuze van het spel;
  - **tijdgebonden** voordelen die op `endsAt` (28 dagen = 1 seizoen) gewoon stoppen:
    **1 gratis coach** (`billableCoachedCount` trekt er één af vóór `dailyRunningCost`)
    en **dubbele winst** (`winningsMultiplier`, geld **én** ranglijstpunten).
  Verder: alle **startduiven op 100 energie** en meteen **één tier-1 sponsoraanbod**
  (`offerStarterSponsor` in sponsors.ts). Startgeld blijft **€5000**.
- **Dubbele winst zit op de twee uitbetaalplekken**, niet op één: `payFinishedFlightPrizes`
  (vroege uitbetaling, geld) en `applyFlightEffects` (afronding, geld + punten). Beide
  ijken op de **starttijd van de vlucht**, niet op "nu" — een race die binnen het venster
  begon betaalt dubbel, ook als de staart pas erna binnenkomt. Geen dubbeltelling: een al
  vroeg uitbetaalde duif draagt 0 bij aan de finalize (`prizePaid`).
- ⚠️ **Bewuste keuzes die niet vanzelf spreken:**
  - De 30 ervaringspunten gaan naar **één** duif (`expPigeonId` vergrendelt na de eerste
    toekenning) — één echte kanshebber is meer waard dan zes iets-minder-hopeloze duiven.
  - Ze lopen **niet** door `experienceGain`: dit is een voorschot, geen gevlogen ervaring,
    dus de afnemende leerfactor (§3.7) hoort er niet op te drukken. 30 punten = 30 ervaring.
  - Eigenschapspunten respecteren **wél** de gen-cap, en er wordt alleen aangerekend wat
    effectief landde (2 van 5 als de duif na 2 punten haar plafond raakt).
  - `loftDTO.dailyCosts` rekent al mét de gratis coach, anders spreekt de **Dagbalans** het
    geld tegen dat er werkelijk afgaat.
  - Bots krijgen niets van dit alles (`user.isBot`-guard op elk onderdeel).
- **De afloopmelding is verplicht, niet decoratief.** `tickNewcomerExpiry` draait bij de
  dagafsluiting in `tickDailyCare` en stuurt **exact één** melding (`endNotified`, stabiele
  id `ntf:newcomer:end:<userId>`): je coach kost weer €80/dag, je winst is weer enkelvoudig,
  en je resterende punten blijven geldig. Een coach die stilletjes geld begint te kosten is
  precies de verrassing die we niet willen.
- **Persistentie:** nieuwe kolom **`lofts.newcomer TEXT`** achteraan `SCHEMA_STEPS`
  (append-only), leeg voor élk bestaand hok → bestaande spelers merken niets en hun
  kolom-smalle UPDATE blijft hem overslaan. **Geen migratie, `dataVersion` blijft 38.**
- **UI:** `client/src/components/NewcomerPanel.tsx` bovenaan het Overzicht — resterende
  punten, dagen te gaan, en de twee toekenvelden. Verdwijnt vanzelf zodra het pakket
  afgelopen is **én** de punten op zijn. Endpoints `POST /newcomer/experience` en
  `POST /newcomer/attribute`.
- **Nieuwe blijvende test `newcomer.test.mts`** (48 controles): wat een nieuw hok krijgt,
  de gen-cap-klem, ervaring naar één duif, nooit meer uitgeven dan je hebt, de vier
  tijdgebonden gedragingen vóór/na `endsAt`, de afloopmelding (exact één, idempotent, met
  de juiste inhoud) en — belangrijk — dat een hok **zonder** pakket zich exact als vroeger
  gedraagt. Alle 15 regressietests + beide typechecks + build groen.
- ⚠️ **Twee onderdelen zijn tegen mijn advies in meegenomen** (bewuste keuze van de
  eigenaar, hier genoteerd zodat de afweging niet verloren gaat): de **5 eigenschapspunten**
  (meetbaar het zwakste onderdeel, en ze voeden `talent()` → marktwaarde, dus in principe
  door te verkopen) en de **dubbele competitiepunten** (waarmee een nieuwkomer zijn eerste
  seizoen de Gouden Roekoe kan pakken met objectief mindere duiven). Als de Roekoe scheef
  gaat lopen, is `NEWCOMER.winningsMultiplier` splitsen in geld/punten de kleinste ingreep.
- ⚠️ **Het pakket veroudert.** Het is geijkt op "tegen maandveteranen". Wie in november
  instapt staat tegenover tweemaandsveteranen en de dosering klopt dan niet meer. Wil je dat
  niet met de hand blijven bijstellen, dan moet het **relatief** worden (ijken op de mediaan
  van de bestaande hokken) in plaats van op vaste getallen.

**Beheerder kan een lopende vlucht doorspoelen**
- **Aanleiding (eigenaar):** een vlucht loopt door tot de **traagste** duif binnen is
  (sinds de finish-timer weg is, §3.3 spelregels). Op de fond zijn de winnaars dan al
  uren thuis terwijl er nog twee bots rondjes vliegen. Daar wil je niet op wachten.
- **Nieuw: `POST /admin/flights/:id/finish`** (403 voor niet-admins, 400 als de vlucht
  niet `live` is). De knop **⏩ Match beëindigen** staat op `LiveFlightPage`, enkel
  zichtbaar bij `user.isAdmin`, met een `window.confirm` ("Ben je zeker dat je deze
  match wil beëindigen?") die uitlegt dat niemand geschrapt wordt.
- **Bewust géén nieuw afrondingspad.** `tickFlights` kreeg een vierde parameter
  **`forceFinishId?: string`**, en de bestaande voorwaarde werd
  `nowMs >= startMs + total*1000 || flight.id === forceFinishId`. Eén regel, en dus
  per constructie exact dezelfde code als een natuurlijke finish — een apart pad zou
  op termijn uit elkaar kunnen lopen. Het endpoint roept `tickFlights(db, Date.now(),
  undefined, flightId)` aan binnen `store.mutate`. **Geen schemakolom, geen migratie**,
  `dataVersion` blijft **38**.
- **Waarom dit de uitslag niet verandert:** de hele race wordt bij de lossing bevroren
  in `flight.sim`, `finalizeFlight(flight, pigeons)` krijgt **geen klok** mee, en de
  geleidelijk afgetrokken energie wordt daar afgerekend tegen de bevroren `formCost`
  (`formDelta = −(flownTarget − drained)`). Vroeger afronden slaat dus enkel het
  wáchten over.
- ⚠️ **Het echte risico zat bij het prijzengeld**, niet bij de standen:
  `payFinishedFlightPrizes` betaalt een finisher **meteen** uit en zet `prizePaid`.
  Rond je af terwijl de koplopers al betaald zijn, dan mag `finalizeFlight` dat niet
  nog eens doen — dat doet ze ook niet (`acc.prize += s.prizePaid ? 0 : prize`), en de
  test bewaakt precies dat geval.
- **Nieuwe blijvende test `force-finish.test.mts`** (14 controles): dezelfde bevroren
  vlucht wordt twee keer gedraaid — één keer uitgevlogen, één keer afgerond op **85 %**
  van de race met de koplopers al uitbetaald — en uitslag, geld per hok, seizoenspunten
  en élke duif (energie/gezondheid/conditie/skills/aandoening) moeten identiek zijn.
  Plus: niemand geëlimineerd, energie volledig afgerekend, tweede klik idempotent
  zonder extra geld, en zonder force-id blijft de vlucht gewoon live.
  De test **isoleert de vlucht** (alle andere vluchten uit de wereld) — anders vergelijk
  je ook de races die de kalender intussen zelf start, en dat maakt hem flaky.
- **`payFinishedFlightPrizes` is nu geëxporteerd** (was module-privé) zodat de test het
  live-verloop kan naspelen. Alle elf regressietests + beide typechecks + build groen.

**Weddenschappen waren stuk, en de smalle load was minder smal dan gedacht**
- **Symptoom (eigenaar):** in het weddenschapspaneel heette **elke** deelnemer `duif`
  met **★0** — enkel de eigen duiven klopten. Wedden was daardoor onbruikbaar.
- **Oorzaak: één regel op de verkeerde plaats.** In `d1.ts::load` leidde het smalle
  duiven-blok de extra ids af uit `dbObj.flights`, maar die array werd **twintig regels
  later** pas gevuld. `entrantIds` was dus **altijd leeg** en de `UNION` haalde enkel
  `WHERE owner_id = ?` op. `flightDTO.entrants` viel voor elke andere duif terug op
  `p?.name ?? 'duif'` / `talent 0`. Gemeten: 33 van de 35 deelnemers naamloos.
- ⚠️ **De duurdere ontdekking: de naïeve fix mag níet.** `entrants` naamgeven betekent
  élke deelnemer van élke lopende vlucht laden, en dat is zowat de hele populatie. Met
  enkel de volgorde-fix, gemeten op het ontwerpplafond:

  | Duiven per hok per vlucht | Smalle poll | Volle load | Winst van "smal" |
  |---|---|---|---|
  | kapot (de oude toestand) | 73 rijen | 261 | 72 % |
  | 1 | 190 | 263 | 28 % |
  | 2 | 243 | 264 | 8 % |
  | 3 (realistisch) | 242 | 260 | **7 %** |

  De hele winst van de vorige ronde zou dus verdampen: `/api/flights` wordt door élke
  open tab elke 90 s gepolld.
- **Waarom niemand dat zag:** `poll-budget.test.mts` schreef **geen enkele duif in op een
  vlucht** (geen `enterFlight`, geen `entries`). De entrant-helft van de `UNION` was in
  die test altijd leeg, dus de test kon dit per constructie niet meten — zijn cijfer was
  identiek mét en zónder de bug. **Nu bouwt hij een echte kalender** (6 vluchten, 184
  ingeschreven duiven) en bewaakt hij precies dit.
- **De fix: `entrants` van het hete pad halen** — de hefboom die verderop al als
  "volgende stap" stond. `flightDTO` draagt het veld niet meer; de lijst komt van de
  nieuwe route **`GET /api/flights/:id/entrants`** (`flightEntrantsDTO` in
  `presenters.ts`), **bewust níet** in `NARROW_PATHS`, dus met een volle load. Die route
  gaat enkel af **wanneer iemand het weddenschapspaneel opent** — een handvol keer per
  dag i.p.v. elke 90 s per tab. `BetPanel` (`FlightsPage.tsx`) haalt ze op bij het openen
  en toont zolang "Deelnemers laden…".
- **De smalle load laadt nu enkel nog wat een smalle-pad-DTO écht noemt:** de eigen duiven
  plus de **estafetteploegen** van niet-afgelopen vluchten (`flightDTO.teams` is de enige
  overgebleven plek die een vreemde duif bij naam noemt). Dat is één ploeg van 3 per hok,
  om de week — begrensd door het spelersaantal i.p.v. door de kalender.
- **Gemeten na de fix** (204 duiven, 6 geplande vluchten, **184 ingeschreven duiven**):
  smalle poll **71 rijen** vs. volle load **261** — de smalle load blijft op **14 eigen
  duiven** staan, ongeacht hoeveel er ingeschreven is. Het ergste realistische geval zit
  op **18 %** van het dagbudget. `previewBet` zelf is goedkoop: **0,05 ms** met cache,
  **~1,1 ms** bij een cache-miss (≈2,1 ms in productie, van de 10).
- **Om te onthouden:** een DTO die een duif **bij naam** noemt buiten het eigen hok,
  trekt de volle `pigeons`-tabel mee. Zet zoiets nooit op een gepollde route — geef het
  een eigen route die pas afgaat als de speler er om vraagt.
- **Geen migratie, geen schemawijziging**, `dataVersion` blijft **38**. Alle dertien
  regressietests + beide typechecks + build groen.

**Leesbudget: het spel lag plat omdat élk verzoek de hele duivenpopulatie las**
- **Symptoom:** het spel werd onbereikbaar nadat een nieuwe speler een tijd had rondgeklikt.
  Niet de CPU: de bindende limiet is **D1 rijen gelezen**, 5M/dag, en die is **gedeeld door
  alle spelers samen**.
- **Gemeten oorzaak.** Per verzoek: **264 van de ~300 rijen was `SELECT * FROM pigeons`** —
  de complete duivenpopulatie, bij élk verzoek, ongeacht de route. Dat gaf ~17k verzoeken
  per dag voor iedereen samen. Daar bovenop pollden **verborgen tabs gewoon door**: er was
  nergens `visibilitychange`-afhandeling, dus een vergeten Vluchten-tab kostte 960
  verzoeken/dag voor niemand.
- **Client — `useVisiblePoll` (`client/src/game/useVisiblePoll.ts`).** Een poll draait enkel
  terwijl de tab zichtbaar is, en doet één inhaalslag bij terugkomst (met een drempel van
  één interval, zodat tabben geen burst geeft). Toegepast op `FlightsPage` (90 s),
  `LiveFlightPage` (60 s) en `MarketPage` (15 s, enkel in de veiling-slotfase).
- **Client — `/state` ontdubbeld.** `GameContext.refresh` deelt de lopende fetch, want
  pagina's vuurden routinematig hun eigen `load()` én een `refresh()` voor dezelfde actie.
- **Server — smalle duiven-load (`LoadOptions.narrowWhenIdle` in `d1.ts`).** Een verzoek op
  een **allowlist** (`NARROW_PATHS`: `/state`, `/flights`, `/bets`, `/notifications`) dat
  **GET/HEAD** is **én** binnenkomt terwijl de engine nog vers is (`ADVANCE_THROTTLE_SECONDS`),
  krijgt enkel **de eigen duiven + de estafetteploegen van niet-afgelopen vluchten**, in één
  index-gedekte `UNION` (een `OR` over kolommen zou terugvallen op een full scan). Boven 400
  deelnemers valt hij terug op de volle tabel. (Oorspronkelijk **alle** deelnemers — dat
  bleek zowat de hele populatie en maakte de versmalling zinloos; zie het kopstuk van §8.)
- **`store.narrowed`** is publiek en de middleware weigert de engine te draaien op zo'n
  store — expliciet, in plaats van te vertrouwen op twee voorwaarden die toevallig samenvallen.
- **Wat de versmalling mogelijk maakte:** `/state` had alle duiven nodig voor twee top-10-
  lijsten. Die zitten nu in **`World.leaderboard`** (JSON op de world-rij, kolom `leaderboard`),
  ververst door `computeLeaderboard` op élke volle engine-run — precies de momenten waarop
  ze kunnen veranderen. En `flightDTO` levert `teams` niet meer voor **afgelopen**
  vluchten: daar was het dood (de volgorde ligt vast, resultaten dragen hun eigen namen).
  `entrants` is intussen **helemaal uit `flightDTO` verdwenen** — zie het kopstuk van §8.
- **Resultaat (`poll-budget.test.mts`, 264 duiven):** smal **51 rijen** vs. vol **300**.
  Het ergste realistische geval (10 spelers, hele dag een zichtbare tab + 300 handelingen elk)
  gaat van **162% → 13%** van het dagbudget.
- **Bewaakt door `poll-budget.test.mts`:** geen kale `setInterval` die het netwerk raakt,
  geen poll sneller dan 60 s (behalve de veiling-slotfase), en — het echte risico —
  **een smalle load mag bij `persist` nooit andermans duiven wissen**, een schrijf-verzoek
  krijgt altijd de volle wereld, en een verlopen engine dwingt een volle load af.

**Voer kan terug naar de handelaar, aan 80%**
- **Waarom:** voer kopen was eenrichtingsverkeer. Te veel gekocht, of een voertype dat je
  niet meer gebruikt (bv. Libido-mix na de kweekperiode), zat voorgoed vast in je voorraad.
- **`FOOD_RESALE_RATE = 0.8`** in `gameConfig.ts`. `sellFood` + `foodResaleValue` in
  `engine.ts`, route `POST /loft/food/sell` `{type, kg}`, tarief in `/state` als
  `economy.foodResaleRate`.
- **Bewust onder 1:** een rondje kopen → verkopen moet **altijd** geld kosten, anders is
  voer een spaarpot en is overkopen gratis. 100 kg Premium heen en weer = **−€120**.
  `food-resale.test.mts` bewaakt dat voor elk voertype en elke hoeveelheid.
- **Geen missievoortgang op verkopen** (enkel `buyfood` bij kopen), zodat een koop/verkoop-
  lus de dagmissie niet kan uitmelken.
- **UI:** de bestaande voerbalie op `DashboardPage` (kaart *Verzorging*) heeft nu een
  Kopen/Verkopen-schakelaar. In verkoopmodus toont de dropdown de **terugkoopprijs**, staat
  er een **Alles**-knop (hele voorraad van dat type) en wordt de knop geblokkeerd zodra je
  meer opgeeft dan je hebt. Getallen staan verder in de wiki (§Energie, voer & rust).
- **`round1` bij de voorraadcontrole**, want de stock zelf wordt op één decimaal gehouden:
  zonder dat werd "verkoop alles" van 3.4000000000000004 kg geweigerd.

**Vol hok bij het uitkomen: de speler kiest, in plaats van stil verlies**
- **Wat er misging.** `tickBreedingHatch` deed `young.slice(0, capacity - owned)`: paste de
  worp niet, dan werden de overtallige jongen **weggegooid**. Erger nog, de meldingstakken
  waren `admitted.length > 0` en `else if (young.length === 0)` — het geval *"er waren
  jongen, maar er paste er geen"* viel door beide heen. Geen duif, geen melding, en de
  €200 + 2×15 energie weg. `startBreeding` controleerde de capaciteit ook niet; enkel
  `bots.ts:maybeBreed` beschermde zichzelf al (`pairs >= capacity - pigeons.length`).
- **Nu:** past de worp niet, dan wordt **de hele worp** vastgehouden als `PendingBrood` op
  `loft.pendingBroods` (niet de eerste N ervan — anders is de keuze niet echt van de
  speler). De speler kiest per jong houden of niet: **alles, een deel, of niets**. Wat
  niet gekozen is, vliegt weg (€0 — het restaurant blijft voor volwassen duiven).
- **Plaats maken** gebeurt in hetzelfde scherm via de bestaande `/pigeons/:id/release` en
  `/pigeons/:id/restaurant` — geen nieuwe economie, geen nieuwe exploit.
- **Geen deadline, wel een slot:** zolang er een nest openstaat weigert `startBreeding`
  een nieuw koppel (*"Er wacht nog een nest op je keuze"*). Zo hangt er nooit een vergeten
  nest, en verlies je nooit een topjong door even niet in te loggen.
- **Bots** houden het oude afkappen: ze hebben geen UI om mee te kiezen (en `maybeBreed`
  koppelt sowieso nooit meer dan er vrije plaatsen zijn).
- **Een jong in het nest staat niet in `db.pigeons`**, dus het eet niet, veroudert niet mee
  in de verzorgingstick en kan niet ziek worden. `birthWeek` staat wél vast vanaf het
  uitkomen, dus lang wachten levert een oudere duif op — dat is de enige kost van talmen.
- **Badges/statistiek:** `awardBroodBadges` (in `breeding.ts`, gedeeld door het directe
  uitkomen en `resolveBrood`) telt enkel de **gehouden** jongen in `stats.babies`.
  `tweeling` gaat over de wórp (dus ook als je er één houdt); `dynastie` wordt bij het
  uitkomen als boolean op het nest vastgelegd, want bij het beslissen kunnen de ouders
  al weg zijn.
- **Bestanden:** `schema.ts` (`PendingBrood`, `Loft.pendingBroods`), `schedule.ts`
  (`tickBreedingHatch`), `breeding.ts` (`awardBroodBadges`), `engine.ts` (`resolveBrood`,
  slot in `startBreeding`), `d1.ts` (kolom `pending_broods`), `presenters.ts`
  (`broodYoungDTO`), API `GET /breeding` (nu `{pairs, nests, capacity, pigeonCount,
  freeSpace}`) + `POST /breeding/nest/:id` `{keep: string[]}`, `/state` → `pendingNests`,
  client `NestChoice.tsx` + `BreedingPage` + nav-teller in `Layout`.
- **Test:** `brood-choice.test.mts` (29 checks, incl. de D1-round trip en dat je het nest
  van een ander niet kan afhandelen). Query-budget onveranderd: 42–43 bij `PIGEONS=200`.

**503-fix ronde 8: de dagovergang zette het spel vast**
- **Symptoom:** het spel bleef "laden". Gemeten tegen productie: de statische site,
  `/api/health` en `/api/auth/login` antwoordden gewoon, maar **élke route die de wereld
  laadt** gaf `503` met **`error code: 1102`** — de CPU-limiet, niet D1. Login werkt en
  leest een rij, dus een quotum-lockout viel meteen af.
- **Oorzaak: `tickDailyCare` deed een hele dag in één verzoek.** Die tick raakt élke duif
  in de wereld (voer, gezondheid, onkosten, sponsors, botbeheer). Gemeten op 200 duiven:
  een verzoek gaat van **3,4 ms → 6,3 ms lokaal** zodra er één middernacht openstaat, en
  lokaal ≈ 1,9× sneller dan de Workers-runtime (ronde 6: lokaal 14 ms = productie 26 ms).
  Dus ~12 ms in productie → over de 10 ms → verzoek afgeschoten.
- ⚠️ **En daarom herstelde het niet vanzelf.** `world.lastDailyTick` werd pas geschreven
  **ná** de volledige dag, en `world.lastAdvance` pas ná de engine-run. Sterft het verzoek,
  dan is er **niets** gepersisteerd: het volgende verzoek doet exact hetzelfde werk en sterft
  ook. Beide besparingen bewapenen zichzelf pas ná één geslaagde run, dus het spel zat in een
  put waar het niet uit kon — en elke gepasseerde middernacht maakte de hap groter.
- **Fix: de dagverzorging is hervatbaar**, net als `ensureSchema` in ronde 2. Per verzoek
  hoogstens **`DAILY_CARE_LOFTS_PER_RUN` (2)** hokken van **één** openstaande dag; het
  vervolgpunt staat in **`World.dailyCareCursor`** (kolom `daily_care_cursor`, achteraan
  `SCHEMA_STEPS`). De wereldbrede stappen blijven precies één keer per dag lopen:
  weekrol + `runAgeMortality`/`runAgeDecline` bij de **start** van de dag (cursor leeg),
  `runHealthDay` + badges bij het **afsluiten**. Pas dan schuift `lastDailyTick` op.
- **De cursor is een `userId`, geen index.** Hokken worden gesorteerd op `userId` verwerkt en
  het vervolg pakt alles `> cursor`. Een hok dat middenin de dag bijkomt kan zo nooit het
  venster verschuiven en een **tweede** portie voer + daghuur krijgen — dat is hier de ergste
  uitkomst. `DAILY_CARE_MAX_CATCHUP_DAYS` (30) vervangt de oude harde `days < 30`.
- **Gemeten na de fix** (200 duiven, medianen — lokale p90/max zijn GC-ruis en zeggen niets):
  rustig verzoek **3,4 ms**, verzoek mét dagverzorging **3,9 ms** (bij 4 hokken: 4,4; bij 8:
  4,7). Eén dag loopt leeg over ~9 verzoeken; met de 20 s-throttle is dat hooguit enkele
  minuten. **Belangrijker dan de milliseconden:** een verzoek dat toch sneuvelt, blokkeert
  niets meer — het volgende hervat waar het stopte. De harde storing is daarmee omgezet in
  hoogstens een trager tikkende klok.
- **Meegenomen — een bestaand schrijflek op het hete pad.** `tickBreedingHatch` stempelde
  `bp.hatchAt` bij **élk** verzoek voor elk niet-uitgekomen koppel: één rij per koppel per
  poll, precies het patroon dat ronde 4 verbood. Nu gequantiseerd met
  **`BREEDING.hatchCheckMinutes` (15)**; overslaan kost niets want de verstreken uren
  stapelen op en uitkomen is memoryless, dus de gemiddelde uitkomsttijd verandert niet.
  Dit lek zat er al en werd zichtbaar doordat `idle-writes` nu langer doorpollt.
- **`idle-writes.test.mts` aangepast**, niet verzwakt: de test ging ervan uit dat één poll
  een hele dagovergang absorbeert. Hij laat de achterstand nu eerst leeglopen (polls die
  écht werk doen) en eist **daarna** stilte — de eigenlijke bewaking (geen klok die per
  verzoek een rij stempelt) blijft volledig staan, en die ving meteen het koppel-lek.
- **Geen migratie, `dataVersion` blijft 38** (alleen de nieuwe kolom, append-only). Alle
  tien de regressietests + beide typechecks + build groen.
- ⚠️ **Wat hiermee NIET opgelost is:** het rustige verzoek zit nog altijd rond **~6,5 ms in
  productie** van de 10. De marge blijft dun, en de oorzaak is onveranderd het D1Store-patroon
  (elk verzoek laadt+persist de hele wereld). De volgende hefboom blijft de **smalle load**
  voor `/state` en `/flights` — zie de hefbomenlijst verderop.

**Live verslag: enkel nog feiten**
- **Op verzoek van de eigenaar:** het 📻-verslag toont enkel nog **functionele** regels
  — lossing, voorbijsteken (met reden), omweg, verdwaald, uitputting, blessure,
  opgeven, aankomst. Alle sfeer eruit.
- **Wat weg is:** de flavour-staarten in `COMMENTARY` ("de melker pinkt een traantje
  weg", "vraagt meteen om eten. Typisch.", "zat van de vrijheid") en de openingsregel
  **"Vroege stand: X op kop, gevolgd door…"** — die herhaalde letterlijk wat het
  live-bord ernaast continu toont. Elke pool is nu 1–2 korte, feitelijke zinnen
  (`{name} is binnen.` i.p.v. vier grappige varianten).
- **Meegenomen: `entries` gaat niet meer mee bij een gewone vlucht.** `LiveFlightPage`
  leest dat veld **alleen** om estafette-etappes te labelen (beide gebruiken zitten
  achter `flight.relay`); voor een normale vlucht staat elke deelnemer al in
  `live.birds` mét positie. Dat scheelde ~90 objecten per poll.
- **Gemeten** op een fondvlucht van 900 km met 90 duiven, aan het eind van de race:

  | | vóór | na |
  |---|---|---|
  | verslag | 14,0 KB | 9,9 KB |
  | bord | 25,5 KB | 20,9 KB |
  | **antwoord per poll** | **39,4 KB** | **30,8 KB (−22 %)** |

- ⚠️ **Eerlijk over de winst:** dit is **payload**, geen D1-rijen en geen CPU. Na de
  twee vorige rondes kost het verslag nog 0,05 ms warm en 1 ms koud, en de live-route
  leest 2 rijen. Dit is dus vooral **leesbaarheid** (150 regels waarvan 88 aankomsten
  is een muur) met een bescheiden bandbreedtewinst erbovenop.
- **`daily-budget.test.mts`** vergelijkt `entries` nu apart: bij een estafette moet de
  lijst kloppen, bij een gewone vlucht moet ze **leeg** zijn. De rest van de
  gelijkwaardigheidscontrole blijft veld voor veld.
- **Meegenomen fix:** `betting-odds.test.mts` was flaky (~1 op 25). De controle "een
  andere vlucht-id geeft een eigen trekking" keek naar één duif, en bij een kans van
  0,13 % kunnen twee losse trekkingen toevallig op hetzelfde aantal uitkomen. Ze
  vergelijkt nu het hele veld. 30/30 groen.
- **Geen migratie, geen schemawijziging.**

**Sponsors: een slechtere concurrent weigeren is definitief**
- **Op verzoek van de eigenaar:** weiger je een sponsor die in dezelfde categorie zit
  als een sponsor die je al hebt (overstappen kost dus een verbrekingsvergoeding) én
  die **niet meer** betaalt, dan komt die sponsor **nooit meer terug**. Zo'n aanbod is
  puur slechter — je zou betalen om er op achteruit te gaan — dus hoeft de speler er
  niet om de paar dagen opnieuw nee tegen te zeggen.
- **Nieuw veld `DeclinedSponsor.permanent?`** (rijdt mee in de `sponsorship`-JSON,
  **geen kolom, geen migratie**). Gezet door `applyRefuseSponsor` wanneer
  `refusalIsFinal(st, def, offer)` waar is; `evaluateSponsorOffers` slaat zo'n
  ingang over (`if (d.permanent) continue`).
- ⚠️ **Bewust NIET definitief: een concurrent die méér biedt.** De code weet niet
  "slechter", ze weet "conflict + boete". Een speler kan een **betere** concurrent
  weigeren omdat de boete er die dag niet in zit — de beste sponsor van een categorie
  dan voorgoed wegsluiten zou een val zijn. Daarom vergelijkt `refusalIsFinal` de
  **dagbijdrage** met het lopende contract (podiumpremie als tiebreak) en is enkel
  "niet meer dan" definitief. Gelijk telt óók als definitief: overstappen zou dan
  enkel de boete kosten.
- **Zichtbaar vóór de klik:** `sponsorView` stuurt `refusalIsFinal` mee per aanbod; de
  kaart zet er "ze bieden **minder** … komen **niet meer terug**" bij, de knop heet
  **"Definitief weigeren"** en vraagt een bevestiging. Een permanente nee mag nooit
  een verrassing zijn.
- **Ongemoeid:** een opgezegd contract, een sponsor die zelf opstapt na een
  seizoensreview, en een gewone weigering zonder concurrent blijven allemaal
  terugkeerbaar na de afkoelperiode.
- **Nieuwe blijvende test `sponsor-refusal.test.mts`** (13 controles): slechter →
  definitief en na 40 kansen nooit meer aangeboden; beter → blijft terugkomen; geen
  concurrent → tijdelijk; gelijk → definitief; en de vlag overleeft een JSON-ronde
  (zoals de rit door D1). Spelregels **§12**, wiki-sectie 🤝 **Sponsors**.

**Daglimieten van D1: het live-bord uit de hete weg gehaald**
- **Aanleiding:** Cloudflare kondigde aan dat de **daglimieten van D1** vanaf **1 sep
  2026** hard afgedwongen worden op het gratis plan: **5.000.000 rijen gelezen** en
  **100.000 rijen geschreven** per dag, reset om 00:00 UTC. Loopt een van beide vol,
  dan faalt élke query en is het spel onbereikbaar tot middernacht. Dit is een
  **andere** limiet dan de CPU-fix hierboven, en die was nog niet bewaakt.
- **Gemeten met een nieuwe `daily-budget.test.mts`** — een volledige, bewust
  pessimistische speeldag door de echte engine (10 spelers, 300 duiven, volle inboxen,
  10 kijkers die 8 uur een live-bord openhouden, 2 achtergrondverzoeken/min):

  | | vóór | na |
  |---|---|---|
  | rijen gelezen/dag | **2,73 M (54,7 %)** — marge 1,8× | **1,21 M (24,2 %)** — marge 4,1× |
  | rijen geschreven/dag | 6,5 % | 7,1 % (ongewijzigd, marge 14×) |
  | rijen per verzoek | 349 | 158 |

- **Oorzaak: élk verzoek las de hele wereld, en 64 % daarvan was de tabel `pigeons`.**
  Uitgesplitst per verzoek: pigeons 224 · notifications 41 · trades 40 · users 18 ·
  lofts 18 · flights 7. Het **live-bord** was veruit het meeste verkeer (4.800 van de
  7.681 verzoeken) en had van dat alles **niets** nodig: posities, namen en eigenaars
  rijden allemaal mee in de bevroren `sim` en `results` van de vlucht zelf, en de
  pagina leest `entrants`/`teams` niet (die bestaan voor het weddenschapspaneel op een
  *geplande* vlucht).
- **Fix:** `loadLiveFlight` (`core/d1.ts`) haalt de wereldrij + die ene vlucht op —
  **2 rijen** — en `liveBoardDTO` (`presenters.ts`) bouwt het antwoord uit de vlucht
  alleen, zonder `db`. De middleware bedient `GET /api/flights/:id/live` daarmee vóór
  de wereld geladen wordt. Client: `LiveResponse.flight` is nu het smalle type
  `LiveFlight` i.p.v. `Flight`, zodat de compiler afdwingt dat de pagina niets
  gebruikt wat we niet sturen.
- ⚠️ **De valkuil, en hoe ze afgedekt is:** als het live-bord de wereld nooit meer
  laadt, draait `advanceRealtime` niet meer en **stopt de spelklok** wanneer dat het
  enige verkeer is (precies tijdens een fondvlucht!). Daarom neemt de smalle weg het
  alleen over zolang de engine **recent gedraaid heeft** (`ADVANCE_THROTTLE_SECONDS`,
  20 s); is hij toe aan een ronde, dan valt het verzoek gewoon terug op de volle weg.
  Geverifieerd tegen een draaiende server: met uitsluitend live-polls schuift
  `world.last_advance` gewoon door.
- **`daily-budget.test.mts` toetst ook de gelijkwaardigheid**: voor een geplande, een
  lopende én een afgeronde vlucht moet `liveBoardDTO` veld voor veld hetzelfde
  opleveren als de volle `liveFlightDTO`. De smalle weg mag goedkoper zijn, niet anders.
- **Groeitest:** 300 duiven → 24 %, 600 → 36 %, 900 → 47 %. Het praktische plafond van
  het spel ligt rond **264** duiven (10 spelers × capaciteit 20 + 8 bots × 8), dus er is
  ruimte over.
- **Geen migratie, geen schemawijziging**, `dataVersion` blijft **38**.
- **Wat toen nog de hete weg was:** `/state` en `/flights` laadden de hele wereld
  (~349 rijen). De genoemde volgende hefboom — `entrants` uit `/flights` halen en pas
  ophalen wanneer het weddenschapspaneel opengaat — **is intussen uitgevoerd**; zie het
  kopstuk van §8.

**CPU-fix ronde 2: het live verslag en de weddenschapsodds**
- **Aanleiding:** "Exceeded CPU Time Limits" bleef terugkomen, vooral **rond grote
  vluchten** — precies de waarneming van de eigenaar. De vorige ronde (throttle op
  `advanceRealtime`) haalde de basiskost omlaag maar raakte de échte pieken niet.
- **Gemeten** met een nieuwe `cpu-sweep.mts` op een productiewereld (~90 duiven aan
  de start, 950 km). Twee operaties zaten **elk afzonderlijk boven het volledige
  budget van 10 ms**, nog vóór het laden van de wereld:

  | Operatie | Vóór | Na |
  |---|---|---|
  | `previewBet` (Monte-Carlo) | **18,3 ms** | 0,09 ms warm · ≤1,7 ms koud |
  | `flightCommentary` | **12–15 ms** | 0,05 ms warm · ≈1 ms koud |
  | `liveFlightDTO` (= `/flights/:id/live`) | **12,3 ms** | 0,15 ms |
  | `liveSnapshot` | 0,06 ms | ongewijzigd |

- **Oorzaak 1 — het live verslag rekende élke poll de hele race door.**
  `flightCommentary` liep `for (t = 600; t <= total; t += 600)` — dus **tot het
  einde van de race, ongeacht `elapsed`** — en gooide daarna alles weg wat nog niet
  gebeurd was. Een fondvlucht van 50 uur = **300 bemonsteringen**, elk met een
  volledige rangschikking van het veld **plus een O(n²) zoektocht** naar wie wie
  voorbijstak. Bij 95 duiven is dat ~9.000 vergelijkingen per bemonstering, 300 keer,
  **per poll**. Dat schaalt met afstand én deelnemers: exact "grote vluchten".
  - **Nu:** de scan stopt bij `elapsed`, het aantal bemonsteringen is begrensd op
    **`COMMENTARY_LIMITS.maxSamples` (60)** — een lange race wordt gewoon per uur
    bemonsterd i.p.v. per 10 minuten — en overtake-detectie kijkt enkel naar de
    **kopgroep** (`COMMENTARY_LIMITS.field`, 15). Dat laatste maakt het verslag ook
    léésbaarder: "#77 passeert #78" was nooit een regel waard.
  - **Plus een cache** (`commentaryCache`, per vlucht, op een signatuur van `sim`):
    de scan wordt **uitgebreid** i.p.v. herbouwd, dus herhaalde polls binnen hetzelfde
    venster kosten niets.
  - ⚠️ **Waar dit bijna misging:** de scan doet loterijtrekkingen voor de
    formuleringen, en het aantal trekkingen groeit nu tijdens de race. Deelde ze die
    stroom met de gebeurtenisregels (finish/DNF/opgeven), dan zou **het hele verslag
    zichzelf bij elke poll herschrijven**. Daarom nu **drie apart geseede stromen**
    (`:ov` / `:ev` / `:fin`), en hetzelfde in `relayCommentary` (`:relay:ov` /
    `:relay:ev`). `commentary.test.mts` bewaakt precies dat.
- **Oorzaak 2 — de odds herrekenden een volledige Monte-Carlo per toetsaanslag.**
  `simulate` deed **1500 trekkingen × een volledige sortering** van het veld, met
  ~3 arrays + n objecten per trekking (≈140.000 korte allocaties). En de client
  hervroeg `/bets/preview` bij **elke wijziging van de inzet** — terwijl de kans
  helemaal niet van de inzet afhangt.
  - **Nu:** geen enkele inzetsoort heeft de volledige aankomstvolgorde nodig, dus
    één O(duiven)-pass per trekking houdt enkel het **podium en de traagste
    finisher** bij. Geen sortering, geen allocatie. Elke duif trekt uit haar **eigen**
    rng-stroom, zodat `head2head` twee duiven kan naspelen zonder het veld opnieuw
    te draaien.
  - **Cache** per vlucht (`simCache`, op een signatuur van de ingeschreven duiven +
    hun energie/gezondheid), dus een tweede vraag is gratis.
  - **Client:** `stake` is uit de dependency-array van de odds-`useEffect` gehaald;
    de mogelijke winst is gewoon `inzet × ratio`, lokaal gerekend.
  - **`/api/bets/preview` telt nu als read-only** (`READ_ONLY_POSTS`): het muteert
    niets, dus het valt onder dezelfde throttle als een GET en slaat `advanceRealtime`
    + `persist` over.
- **Wat NIET het probleem was** (gemeten, niet aangenomen): `liveSnapshot` (0,06 ms),
  de DTO's, de ranglijsten, `finalizeFlight` (0,6 ms). En het **snapshot-blok in
  `D1Store.load`** kost maar **0,32 ms** van de 2,2 ms — de rest is SQL + rij-naar-
  entiteit parsen. Dat lui maken zou `d1.ts` risico geven voor bijna niets, dus
  bewust **niet** gedaan. `D1Store.load` (~2,5 ms) is nu de grootste post en blijft
  de structurele bodem van het D1Store-patroon.
- **Drie nieuwe blijvende tests.** `cpu-budget.test.mts` is de wacht: hij toetst
  **structureel** (bemonsteringen begrensd, kopgroep begrensd, verslag groeit
  monotoon) én **op tijd**, en meet expliciet de **KOUDE** weg — het eerste verzoek
  na een isolate-recycle, want daar helpt geen enkele cache. `commentary.test.mts`
  bewaakt dat het verslag aangroeit zonder zichzelf te herschrijven (ook estafette).
  `betting-odds.test.mts` bewaakt de kansen zelf: winkansen tellen op tot 1,
  top-3 tot 3, sterker = meer kans, `mine_wins` == de som van je eigen duiven,
  kop-aan-kop is transitief en telt tot 1, en de cache invalideert op energie en
  op een uitgeschreven duif.
- **Geen schema-/configwijziging behalve de nieuwe knop `COMMENTARY_LIMITS`, geen
  migratie**, `dataVersion` blijft **38**. Alle acht regressietests + beide
  typechecks + build groen.
- ⚠️ **Om te onthouden bij nieuwe code:** alles wat over **alle duiven van een
  vlucht** of over **de hele racetijd** itereert, hoort begrensd te zijn en bij
  voorkeur gecachet. Draai `cpu-sweep.mts` als je zoiets toevoegt.

**De beheerder ziet alle duiven volledig (nieuwste)**
- **Probleem:** de **Duif-inspector** (`/beheer` → tab Duif-inspector) toont wél de rauwe
  waarden in zijn eigen tabel, maar de duifnaam linkt naar `/duif/:id` — en dáár sloeg de
  info-hiding toe: `revealed=false`, dus statbalken weg, "🔒 eigenschappen onbekend".
  De beheerder kon andermans duiven dus niet echt inspecteren. Dat de admin álles moet
  kunnen nakijken en gewone spelers níét, is expliciet de bedoeling.
- **Fix:** `pigeonDTO` kreeg een vierde parameter **`viewerIsAdmin = false`**. Intern nu
  twee begrippen: **`publiclyRevealed`** (de oude regel: geen viewer / eigenaar / `forSale`
  / `onAuction`) en **`revealed = publiclyRevealed || viewerIsAdmin`**. Alle API-call sites
  in `functions/api/[[path]].ts` geven `user.isAdmin` mee (`/state`, `/pigeons/:id` incl.
  beide ouders, `/market` listings + biddable).
- ⚠️ **Bewust: `dailyCare` hangt aan `publiclyRevealed`, niet aan `revealed`.** Dat is de
  verzorgingsprojectie van de **eigenaar** (nutteloos voor een kijker), en `projectDailyCare`
  voor élke duif op `/market` zou de admin een CPU-piek geven op een pad met een **10 ms**-
  limiet. De admin ziet dus alle stats, maar geen ▲▼-projectie van andermans duif.
- **Client:** `PigeonPage` zet er een regeltje boven wanneer een admin een vreemde duif
  bekijkt ("🛠️ Je ziet dit als beheerder — gewone spelers zien enkel ★ talent"), zodat de
  admin niet denkt dat iederéén dit ziet.
- **Geen schema-/configwijziging, geen migratie**, `dataVersion` blijft ongewijzigd (**38**). Geverifieerd
  met een wegwerp-tsx-script tegen de échte `pigeonDTO` (19 controles): eigenaar ziet alles,
  gewone speler niets behalve talent, admin alle zeven stats + genen + vluchtvorm, `dailyCare`
  blijft null voor de admin maar niet voor de eigenaar, eigen duif van de admin ongewijzigd,
  en **zonder** de vlag gedraagt de admin zich exact als een gewone speler (regressie).

**Tekstbudget: schermen kort houden, uitleg naar de wiki (nieuwste)**
- **Aanleiding (eigenaar):** blokken tekst in de UI worden niet gelezen. De privécoach-kaart
  op de duifpagina, de estafette-/titan-blokjes onder een vlucht, de Verzorging-kaart op het
  overzicht en de kweekpagina stonden vol regelverklaring die niemand ter plekke nodig heeft.
- **Regel voor nieuwe UI-tekst:** een scherm toont enkel wat de **beslissing van dít moment**
  stuurt (wat kost het, wat levert het déze duif op, wat is de harde beperking). Alle
  mechaniek, kansen, tabellen en tactiek horen in **`WikiPage`**, met eronder een link
  **"Meer info over … →"** naar `/wiki#<sectie>` (patroon dat `LoftPage` al gebruikte met
  "Hoe de schijven werken →").
- **Nieuwe/uitgebreide wiki-secties:** **`coach`** (🎯 privécoach: dagkost, afnemende winst
  richting de gen-cap, enige weg boven 90), **`titan`** (🏆 prijzentabel, één duif per hok,
  telt wel voor de Vleugel niet voor de Roekoe), **`ziekenboeg`** (🏥 personeel + kosten,
  genezingsduur rustend vs. volle zorg, 📌 vastzetten, halve energierecuperatie),
  `energie` verbreed naar **"Energie, voer & rust"** (voorraad per type, hongertabel,
  rustkuur), `broeden` verbreed naar **"Kweken & broeden"** (kost, overerving, uitkomsttijd)
  en `estafette` kreeg zijn **prijzentabel + uitslagregel**.
- **Ingekort:** `PigeonPage` (coach, training, rustkuur, afscheid, bod, 🔒-melding),
  `FlightsPage` (estafette/titan/oefenvlucht → één regel + wikilink), `DashboardPage`
  (Verzorging + dagbalans-intro + beheerderskaart), `BreedingPage`, `InfirmaryPage`
  (introdialoog van 5 lange bullets → 3 korte + wikilink), `SponsorsPage`, `MarketPage`
  (veilingregels), `LiveFlightPage`, `PigeonCard`, `AdminPage` (inspector-uitleg).
- **Meegenomen bugfix:** het titan-blokje op `FlightsPage` toonde nog **€1400/€1200/€1000**
  terwijl `TITAN.prizes` al lang `[1800, 1200, 900]` is. Bedragen staan nu **enkel nog in de
  wiki**, zodat er maar één plek is om te synchroniseren.
- **Opgeruimd:** `DashboardPage.dailyFixed`/`coachedCount` zijn weg — die berekenden een
  dagkost die de **Dagbalans**-tegel er al volledig uit haalt (`loft.dailyCosts`).
- **Geen gedragswijziging**, enkel copy/markup. Beide typechecks, de build en de vier vaste
  regressietests groen.

**Bots zijn echte tegenstanders geworden — 8 bots, eigen hokbeheer, late inschrijving**
- **Aanleiding:** de estafette van 22 aug kreeg maar **5 ploegen**. Drie oorzaken, gemeten
  met een wegwerpsimulatie tegen de echte engine:
  1. `DEFAULT_BOT_COUNT` was **6** → hoogstens 6 botploegen, terwijl een bot bij een gewone
     vlucht 1–2 duiven levert en bij een estafette maar **één ploeg**.
  2. `botsEnterFlight` draaide **enkel bij het aanmaken** van de vlucht (tot
     `SCHEDULE_HORIZON_DAYS` = 4 dagen vooraf) en eiste **3 duiven boven 45 energie op dat
     ene moment**. Midden in een week met 8 wedstrijden haalde bijna geen enkel bothok dat.
  3. **Bothokken konden alleen krimpen**: bots kweekten niet, kochten niet en boden niet.
     Gemeten: 41 → 14 duiven in 4 maanden, **0/6 botploegen** vanaf eind september, terwijl
     elke bot op €20.000–30.000 zat.
- **`DEFAULT_BOT_COUNT` 6 → 8** + **migratie v38** die de twee ontbrekende hokken aanmaakt
  (seedWorld draait maar één keer). **Stabiele ids** (`bot_seed_7/8`, duiven
  `pig_bot_seed_N_i`) en een **deterministisch** duivenaantal (`STARTING_PIGEONS + i % 3`),
  zodat twee gelijktijdige verzoeken die de migratie allebei draaien op dezelfde rijen
  landen i.p.v. dubbele hokken te maken. Duiven zijn meteen vluchtklaar
  (`generatePigeon` dateert 8–130 weken terug), dus ze doen mee aan een vlucht die al op
  de kalender staat. **dataVersion → 38.**
- **Late inschrijving:** nieuwe tick **`tickBotEntries`** (§2, 9c) laat elke bot élke nog
  niet gestarte vlucht opnieuw bekijken, tot vlak vóór de lossing. `botsEnterFlight` slaat
  een hok met een bestaande inschrijving over → idempotent, 0 rijen als er niets verandert.
- **Geen energiedrempel voor de estafette** (`BOT.minFormRelay 0`): drie duiven aan de
  start krijgen is daar het punt, en hoeveel energie een duif nodig heeft is de keuze van
  de melker — precies zoals een speler een duif met 5 energie mag inschrijven. De enige
  echte regel (1 energie, `enterFlight`) blijft gelden.
- **Voor gewone vluchten oordeelt een bot op de route** i.p.v. een vlakke 45: nieuwe helper
  **`expectedFlightEnergyCost(pigeon, km)`** (flight.ts) × `BOT.raceHeadroom` (1,15). Op
  100 km is dat ~21 (méér deelname dan vroeger), op 1000 km ~55 (méér discipline). Plus
  `BOT.minHealthRace` 45 — een versleten duif wordt gerust, niet geracet.
- **`botDailyActions`** (bots.ts, uit `tickDailyCare`, dus **één keer per dagovergang**):
  voer, ziekenboeg + personeel + bedden, rustkuur, coach, hokuitbreiding en **kweek**.
  Alles achter een kasdrempel (`BOT.reserve` + per-actie-reserves) zodat een bot nooit
  negatief gaat — negatief = geen inschrijvingen meer.
- ⚠️ **Twee valstrikken die de simulatie blootlegde** (beide opgelost):
  1. **Bots kweekten nooit**, ook met geld en plaats zat: ze zetten élke fitte duif in een
     vlucht, dus er was nooit een koppel vrij (`koppels 0` maandenlang). Fix:
     `BOT.breedReserveFlock` (8) — onder die hokgrootte houdt een bot zijn beste doffer
     én duivin **uit de racepool**.
  2. **Hokken stortten alsnog in (12 → 0)**, en niet door geld: ze aten **Normaal**
     (+5 gezondheid/week) terwijl ze 2–3× per week vlogen (−9 tot −12/week, spelregels
     §4.4). Gezondheid zakte naar 30–50, dan ziektes, dan dood. Fix: **`BOT.goodFeedFrom`
     (€2.500) → Herstelvoer**, zelfde €3/kg maar +42 energie/+12 gezondheid.
- **`BOT.maxCapacity` 12** — géén economische regel maar een **platformregel**: elke duif
  wordt bij élk verzoek gelezen en om 00:00 herschreven, en die tick loopt rond ~350 duiven
  tegen de 50-querylimiet aan. 8 bots die vrij naar 20 groeien zetten er ~100 bij.
- **Gemeten na de wijziging** (halfjaarsimulatie, 3 runs): **7,8–7,9 botploegen per
  estafette** (was 6 → 2 → 0), alle bothokken stabiel op 12 duiven, laagste kas €5.097, geen
  enkele instorting. Velden: regio 11,6 · nationaal 11,9 · internationaal 11,5 · titan 8,0 ·
  estafette 23,6 duiven aan de start (bots alleen).
- **Geverifieerd** met een wegwerpscript tegen de echte `advanceRealtime` (33 controles):
  migratie voegt exact 2 bots toe en is idempotent over 20 polls, twee gelijktijdige runs
  geven geen dubbele rijen, alle namen/ids blijven uniek, de 8 bots hebben morgen een
  ploeg van 3 met etappenummers, herhaald pollen schrijft niemand dubbel in, met 6 energie
  komen er tóch 8 ploegen maar nooit een duif onder 1 energie, een leeggevlogen bot
  schrijft niet in maar wél zodra ze uitgerust is, een koppelende duif wordt nooit
  ingeschreven, en over 2,5 maand blijft geen enkele bot negatief of uitgedund. De vier
  vaste regressietests + beide typechecks + build groen. Spelregels **§17**.

**Duif weer beschikbaar zodra ze thuis is**
- Probleem: sinds de finish-timer weg is, loopt een vlucht door tot de **traagste**
  finisher binnen is — op 1000 km uren. Elke "is deze duif bezet?"-check keek naar
  `flight.status !== 'completed'`, dus een duif die al lang thuis was kon niet
  ingeschreven, getraind, gekoppeld, in de ziekenboeg gezet, op rustkuur gezet, te koop
  gezet of verkocht worden tot de laatste sukkelaar binnen was.
- Opgelost met `birdStillOut` + `pigeonCommittedToFlight` (flight.ts, zie §2): het einde
  van de **eigen** race komt uit het bevroren sim. Vrij bij **finish**, bij een **DNF
  onderweg** en meteen bij **opgeven** (dat laatste was net de bedoeling van opgeven).
  Alle guards in `engine.ts`/`offers.ts`/`presenters.ts` gebruiken die helper, net als de
  1-race-per-dag-regel en de bot-inschrijving. **Estafette** werkt op leg-klokken (leg 3
  wacht = bezet; ploegmaat valt uit = meteen vrij).
- Client: `FlightsPage` bouwde zijn `committed`-set uit de rauwe entries van **scheduled +
  live** vluchten en verborg de duif dus alsnog. De set kijkt nu enkel naar **scheduled**;
  voor live vluchten telt het server-vlaggetje `pigeon.racing`. De rest van de UI
  (PigeonCard 🏁, PigeonPage, BreedingPage) hangt al aan `pigeon.racing` en volgt vanzelf.
- `giveUpFlight` weigert voortaan een duif waarvan de race al voorbij is — dat maakte van
  een al uitbetaalde finisher retroactief een DNF (bestaande bug).
- Geen schema-/configwijziging, **geen migratie** (puur afgeleid uit `sim`); `dataVersion`
  blijft **37**. Geverifieerd met tsx (32 gevallen: scheduled/live/completed, finish-moment,
  straggler, opgegeven, DNF, legacy-sim zonder `segMult`, onbekende duif, en zes estafette-
  scenario's). Spelregels **§3.8**.

**Migratie v37 — nationale vlucht van woensdag 19 aug eenmalig naar 10:00 (nieuwste)**
- Op verzoek van de eigenaar: de **nationale vlucht van vandaag** vertrekt om **10:00**
  i.p.v. 08:00. **Enkel deze editie** — `REAL_SCHEDULE` houdt `wed-national` gewoon op
  08:00, dus vanaf volgende week is alles weer als vroeger.
- Werkt omdat **`templateKey` een kalenderdag dedupet, niet `startAt`**: het opschuiven
  van de starttijd kan `ensureFlightsScheduled` dus nooit een tweede nationale vlucht op
  dezelfde dag laten bijplannen. Match op `templateKey.startsWith('wed-national:')` +
  status `scheduled` + start binnen `[nu − 2 u, nu + 24 u]`, zodat ze deze editie pakt of
  de deploy nu ruim vóór of net ná 08:00 landt en **nooit** die van volgende week (die
  staat trouwens nog niet op de kalender — horizon is 4 dagen). De nieuwe tijd wordt enkel
  toegepast als ze **nog in de toekomst** ligt; is de vlucht al **live** (bevroren sim),
  dan is de migratie een veilige no-op die enkel `dataVersion` bumpt.
- **Melding aan wie al ingeschreven is** (stabiele id `ntf:admin:delay10:<flightId>:<userId>`,
  bots niet): zij kozen hun duif voor een lossing om 08:00. **Open weddenschappen blijven
  gewoon staan** — het wedvenster (12 u vóór de start) loopt simpelweg twee uur langer, en
  het weer wordt sowieso pas bij de start opgehaald (`flightsAwaitingStart` leest `startAt`).
  **dataVersion → 37.**
- Geverifieerd met een wegwerptest tegen de échte `advanceRealtime` (21 controles): de
  vlucht staat op 10:00 dezelfde dag, idempotent over meerdere polls, geen dubbele melding,
  een al verzette vlucht schuift niet nog eens op, live blijft ongemoeid, op de **echte**
  door `REAL_SCHEDULE` gebouwde kalender beweegt **precies één** van de zeven geplande
  vluchten, bots krijgen niets, twee duiven van dezelfde speler geven één melding, en de
  woensdag van volgende week blijft op 08:00. De vier vaste regressietests + beide
  typechecks + build groen.

**Oriëntatie is een navigatie-eigenschap geworden (nieuwste)**
- **Probleem:** oriëntatie zat als volwaardige term in `pigeonVelocity` (gewicht 0,22 kort →
  **0,35 lang** — op de fond dus **zwaarder dan snelheid zelf**, 0,20). Een duif met snelheid
  71 klopte er een duif met snelheid 80 mee. Erger: het mechanisme dat oriëntatie *hoort* te
  hebben stond feitelijk uit — `lostOrientationRef 62` betekende dat **boven 62 de
  verdwaalkans niet meer bewoog**, dus voor twee behoorlijke duiven was oriëntatie enkel nog
  een snelheidsbonus. Precies omgekeerd.
- **A. Uit de snelheidsformule.** `DISTANCE_WEIGHTING.orientation = 0`, gewicht proportioneel
  herverdeeld: kort **0,83/0,17**, lang **0,31/0,69** (snelheid/conditie). Kort is nu duidelijker
  een sprint, lang draait om conditie.
- **B. Nieuw configblok `LOST`** — `(base 0,005 + max 0,55·room^2,4… )` → in code
  `(LOST.base + LOST.max·room^LOST.curve) × (distBase 0,55 + km·0,0015) × (1 + rough·2,5)`,
  afgetopt op 0,85. Gemeten: oriëntatie 95 → 0,4–1,2 %, 70 → 3,4–9,0 %, 30 → 20–52 % (150→1000 km).
  **Weer versterkt het verschil**: op 700 km gaat 95 van 0,9 → 1,6 % en 30 van 41 → **72 %**
  (`rough = max(0, 1 − weerfactor)`, bestond al).
- **Twee uitkomsten.** Meestal een **omweg**: `km × 0,04 × (0,5 + 1,5·room)` → ~19 km bij
  oriëntatie 30 op 300 km, ~62 km op 1000 km. De vertraging wordt **afgeleid uit die omweg**
  (`slow = spanDist/(spanDist+omweg)`) zodat het tijdverlies exact klopt, en **`formCost` rekent
  op `afstand + omweg`** — een verdwaalde duif komt dus ook leger thuis. Zeldzamer raakt ze de
  weg **helemaal** kwijt: `strandedMax 0,35 · room^3,5`, enkel als ze al verdwaald is → totaal
  2,6 % (or. 30, 300 km) tot 8,5 % (or. 30, 1000 km, zwaar weer); or. 95 praktisch nul.
- **Nieuwe duifstatus VERLOREN** (`Pigeon.awayUntil`, kolom `away_until`): ze is **nooit
  definitief weg** maar komt na `1 + km/1000·2 + room·3` dagen (± jitter) thuis met energie 2–8,
  −15…−25 gezondheid en 45 % kans op een kwetsuur/ziekte (`tickStrayReturn`). Nieuwe
  `dnfKind: 'lost'` + `SimEntry.strayDays`, `SimulatedFlight.strays`, eigen commentaarpool
  `COMMENTARY.dnfLost`, en **twee meldingen** (verdwenen + thuis, stabiele id's).
  **Guards op negen plaatsen** via `isAway(p)` (pigeon.ts): `canRace`, `enterFlight`,
  `trainPigeon`, `startBreeding`, `startRestCure`, `setInfirmary`, `listForSale`, `pigeonBusy`
  (vrijlaten/restaurant), `respondOffer`, plus **overslaan** in `applyDayOfCare` (eet niets,
  **hongerteller loopt niet op**) en in `runHealthDay` (besmet niet, wordt niet besmet). Ze
  **houdt haar hokplaats en telt mee voor de daghuur**.
- ⚠️ **Knock-on die stilletjes zou zijn gebroken:** `pickImproveAttr` gebruikte de
  snelheidsgewichten, dus met oriëntatie op 0 zou **vliegen nooit meer oriëntatie verbeteren**.
  Daarom een **eigen `IMPROVE_WEIGHTING`** (kort 0,55/0,20/0,25 · lang 0,20/0,40/**0,40**) +
  `improveWeightsForDistance()`; de estafette gebruikt de **etappe-afstand**. De coach traint
  oriëntatie al (`RACING_ATTRS`) — daar was niets voor nodig.
- **Bewust ongemoeid gelaten** (beslissing eigenaar): `talent`/marktwaarde/bots en de
  weddenschap-odds. Estafette krijgt geen aparte regel: de kans loopt op de **etappe-afstand**,
  en omdat een omweg de ploeg enkel tijd kost (alleen "helemaal kwijt" schakelt uit) blijft het
  ploegrisico klein (~1,5 % bij oriëntatie 70). **Geen spelersaankondiging** — dit had altijd al
  zo moeten zijn. Oefenvluchten blijven volledig veilig (`if (!practice)`).
- **Wiki**: twee nieuwe secties — 📋 **Wat doet elke eigenschap tijdens een vlucht?** (snelheid/
  conditie/oriëntatie/gezondheid/energie/ervaring) en 🧭 **Verdwalen**. Spelregels **§2.3**
  herschreven, nieuwe **§3.5**, oude 3.5/3.6 doorgeschoven naar **§3.6/§3.7**.
- **Geen migratie, geen `dataVersion`-bump** — alleen de nieuwe kolom (append-only).
- **Geverifieerd** met een wegwerpscript (25 controles): gewichten sommeren tot 1 en oriëntatie
  is 0, kansencurve monotoon en op de ijkpunten 95/70/30, het weer-gat groeit, omweg ≈ 20 km bij
  or. 30 op 300 km, goede navigator raakt praktisch nooit helemaal kwijt, slechte loopt >5 % op de
  fond, vluchten verbeteren oriëntatie nog steeds (méér op lange), en de `isAway`-status.

**Blessures & ziektes op vluchtvorm (energie + gezondheid) — nieuwste**
- **Aanleiding:** de blessurekans was in de praktijk een **vaste tol op ver vliegen**, niet
  op slecht beheer (op 1000 km had een duif met vólle energie nog 20,5 %), de **ernst werd
  uniform geloot** (28,6 % ernstig, terwijl ziektes al een gewogen verdeling hadden), en
  een goed uitgeruste duif kon dag na dag starten zonder dat haar tank het liet zien.
- **Kern: `flightForm(p, nowMs)`** (`pigeon.ts`) = `conditionScore(p) − restPenalty(p)`, met
  `conditionScore = (2·min(energie,gezondheid) + max)/3` (`FORM`). Eén getal stuurt de
  blessurekans, de ernst, de ziektekans en het zichtbare label.
- **Blessure gesplitst** (`AilmentTemplate.cause` op elke entry van `INJURIES`):
  - **`overbelasting`** — `(INJURY.floor 0,015 + INJURY.max 0,9 · ((100−vorm)/100)^2,4) ×
    (0,6 + km·0,001)`. Ernst via **`injurySeverityWeights(vorm)`** (`randomStrainInjury`).
  - **`pech`** — vlakke `INJURY.luckBase 0,01 × afstandsfactor`, **uniform** uit de eigen pool
    (`randomLuckInjury`): sperwer/botsing/slagpen. Nooit nul, dus een perfect hok blijft
    niet onaantastbaar.
  - Gemeten: vorm 90 → 3 % op 500 km (was 16,7 %), vorm 30 (**E20/H50**, de ijkgrens van de
    eigenaar) → 44 % op 500 km en 64 % op 1000 km.
- **Ziekte op dezelfde score** (`ILLNESS.floor 0,01 / max 0,55 / curve 2,4 / contagionFloor
  0,15`, in `runHealthDay`): vorm 90 → ~1 %/week, vorm 30 → ~24 %/week. `randomDisease` neemt
  nu de **conditie-score** i.p.v. enkel gezondheid.
- **Gezondheid is nu een echte resource:** `HEALTH.flightHealthBase 0,5 / flightHealthPerKm
  1/250 / emptyTankFactor 0,8` — een vlucht kost 2 (regio) tot 7 (fond) gezondheid, méér als
  de duif leeg thuiskomt. Tegengewicht: **rebound** (`HEALTH.reboundFactor 1` — herstel ×
  `(1 + (100−gezondheid)/100)`) en **Herstelvoer `healthRecovery 3 → 12`** (dat gaf voordien
  het mínste gezondheid van alle voeders).
- **Rustaftrek (`RECOVERY`)**: gisteren gevlogen −15 vorm, eergisteren −7, oefenvlucht ×⅓.
  Gemeten ×2,2 op de blessurekans — **zelfschalend** (×2,5 voor een frisse duif, ×1,6 voor een
  al wankele) en **niet weg te kopen** met Herstelvoer of een apart hok, wat het punt was.
  Nieuwe velden `Pigeon.lastRaceAt`/`lastRaceWasPractice` (kolommen `last_race_at` +
  `last_race_practice`), gezet in `applyFlightEffects` — **bewust niet** afgeleid uit
  `db.flights`, want die worden na 2 dagen geprunet.
- **`SimEntry.startVorm`** bevriest de vluchtvorm bij de lossing, zodat de blessureworp
  deterministisch blijft als twee verzoeken tegelijk afronden (legacy-vluchten vallen terug
  op de huidige conditie).
- **Rustkuur (`REST_CURE`)**: **elke duif mag** (het oude één-per-HOK-per-week is weg), maar
  **elke duif maar één keer per week** — `cooldownDays 7` geldt nu **per duif**, geteld vanaf
  de **start** van haar vorige kuur via het nieuwe veld **`Pigeon.lastRestCureAt`** (kolom
  `last_rest_cure_at`). Meerdere duiven tegelijk op kuur kan dus wél. Duurt **48 u**, geeft
  **+40 energie én +15 gezondheid**. Lopende kuren houden hun einde (`cureUntil` is absoluut),
  dus wie nu op de oude 24-uurskuur zit blijft ongemoeid. De lock zit nu op
  **`pigeonDTO.restCureAvailableAt`** (per duif); `loftDTO.restCureAvailableAt` blijft bestaan
  maar is altijd `null` (oude open tab). `Loft.lastRestCure` wordt nog geschreven als
  hok-historiek maar is geen poort meer.
- **Eerste-login-melding** hierover: **`REST_CURE_NEWS_STEPS`** (Tour.tsx), sleutel
  `roekoe.newsSeen.restcure.<id>` — 3 stappen: elke duif mag (1×/week per duif, prijs blijft
  €300), +40 energie **én** +15 gezondheid, **2 dagen i.p.v. 1**, plus waaróm gezondheid nu
  telt (de vluchtvorm en de 🟢/🟡/🔴-stip). Vervangt `RELAY_NEWS_STEPS` als actieve set.
- **`TOURNEY_RISK` ingekort**: de extra licht/matig-worp onder 20/10 energie is weg (dubbelop
  nu de vorm dat al stuurt); **de sterfteworp onder 5 blijft**.
- **Zichtbaar** (essentieel — een onzichtbare straf leest als willekeur): `pigeonDTO` stuurt
  `flightForm`/`formLabel`/`restPenalty`; badge op `PigeonPage` en 🟢/🟡/🔴 + vorm in de
  inschrijflijst op `FlightsPage`. **Let op:** `flightForm` is de waarde **ná** de
  rustaftrek (`flightForm = conditionScore − restPenalty`), en de UI toont **enkel dat
  ene cijfer**. Eerst stond er "— net gevlogen, −15" achter, wat las alsof die 15 er nog
  áf moest; op vraag van de eigenaar is die tekst **helemaal weg** — de speler hoeft zich
  er niets bij af te vragen, het is verrekend. `pigeonDTO.restPenalty` blijft wél bestaan
  (server-waarheid, nu ongebruikt door de client). Wiki + spelregels §3.6 idem. Wiki-sectie 🎯 **Vluchtvorm & blessures**, spelregels
  **§3.2**, **§3.5** (rustaftrek), **§4.3/§4.4**, **§5.1/§5.2**.
- **Geen migratie, geen `dataVersion`-bump.** `lastRaceAt` staat leeg bij uitrol (dus geen
  rustaftrek met terugwerkende kracht) en iedereen zit rond gezondheid 100, dus de
  gezondheidskost bouwt pas over enkele weken op — geen schok, maar de tuning is ook pas na
  2–3 weken echt te beoordelen.
- ⚠️ **Om op te volgen:** lagere gezondheid voedt de ziektekans, dus die twee versterken
  elkaar. Meten vóór er nog aan gedraaid wordt.
- **Geverifieerd** met een wegwerpscript (30 controles): vorm-formule, de ijkgrens E20/H50,
  fitte duif <5 % op 500 km, kans nooit nul, monotoniciteit van beide curves, rustaftrek per
  dag + oefenvluchtfactor + de ×2,2, pech/overbelasting trekken enkel uit hun eigen pool,
  ernst schuift mee, gezondheidsbalans houdbaar bij 2 vluchten/week, rustkuur. De vier vaste
  regressietests + beide typechecks + build groen.

**Migratie v36 — kwetsuur van Tinne teruggenomen (nieuwste)**
- Op verzoek van de eigenaar: de **kwetsuur** van "Tinne de Doodskist-Ontwijker" wordt
  weggenomen. Ze kwam met **21 energie over** thuis en raakte toch geblesseerd — precies
  het geval dat het blessuremodel niet hoort te straffen (zie de analyse hieronder).
- Match op naam, **enkel echte spelers**, en enkel zolang ze effectief een
  `kind === 'kwetsuur'` draagt (een **ziekte** blijft staan — dat was de vraag niet).
  Bewust **geen** genezing: geen `stats.cures`/`curesSevere`, geen genezingsbadge — de
  kwetsuur wordt teruggenomen, ze is niet beter verzorgd. De **onset-gezondheidsklap**
  (`HEALTH.onsetHealthHit[severity]`) krijgt ze terug; de dagelijkse drain sindsdien is
  niet reconstrueerbaar en wordt niet vergoed. Ze komt ook uit de ziekenboeg en pakt haar
  **apart hok** terug als er nog een vrij is (zelfde regel als `engine.setInfirmary`).
  Stabiele melding-id `ntf:admin:injuryreset:<pigeonId>`. **dataVersion → 36.**
- Geverifieerd met een wegwerptest tegen de echte `advanceRealtime`: kwetsuur weg,
  gezondheid hersteld, uit de boeg, apart hok terug (én níet afgepakt van een andere duif
  als alles bezet is), andere gewonde duiven ongemoeid, bot met dezelfde naam ongemoeid,
  ziekte blijft staan, idempotent bij een tweede run, en geen fantoom-melding of gratis
  gezondheid voor een gezonde Tinne.

**Blessurekans-analyse (nog geen aanpassing)**
- Aanleiding: speler had 4 gewonde duiven en ervoer de kans als ~50/50. **Per duif** is ze
  5–30 % (`HEALTH.flightInjuryBase 0,025 + km · flightInjuryPerKm 0,00018`, ×`(1 + (100 −
  startenergie)/100)`), maar de **kans dat mínstens één van je ingeschreven duiven gewond
  raakt** is 42 % (3 duiven, 500 km) tot 65 % (3 duiven, 1000 km) — de waarneming klopt dus.
- `finalizeFlight` gebruikt correct de **bevroren `s.startForm`**, niet de leeggelopen
  `pigeon.form` — geen bug daar. De blessureworp geldt wel voor **élke** niet-opgegeven
  duif, finishers inbegrepen (staat buiten het `if (!isDnf)`-blok).
- **Drie structurele bevindingen** voor het herontwerp:
  1. **Afstand domineert, energie nauwelijks.** De energiefactor loopt maar van ×1,0 tot
     ×2,0 (praktijk ×1,3–1,6): op 1000 km heeft een duif met vólle energie nog 20,5 %,
     tegen 34,9 % voor een uitgeputte. Goed hokbeheer wordt dus amper beloond, terwijl de
     spelregels blessures wél als straf voor uitgeputte duiven verkopen.
  2. **`randomInjury` loot de ernst UNIFORM** uit `INJURIES` (3 licht / 2 matig / 2
     ernstig) → **28,6 % ernstig**. Ziektes kregen eerder wél een gezondheidsgewogen
     verdeling (`diseaseSeverityWeights`, 12 % ernstig bij gezondheid ≥80); **kwetsuren
     hebben die fix nooit gekregen.** Grootste enkele bijdrage aan het probleem: ernstig =
     18 dagen rust / 6 dagen met volle zorg.
  3. **Voorraadprobleem.** Instroom ~1,4 kwetsuren/week bij ~10 starts, hersteltijd
     gemiddeld 3,4 d (volle zorg) tot 10,4 d (rustend) → permanent 0,7–2,5 gewonde duiven,
     terwijl de **ziekenboeg standaard 2 bedden** heeft en dokter/kinesist elk 2 duiven
     dekken. Wie erboven komt, komt in een spiraal: onbehandeld verliest een duif
     0,9–3,75 gezondheid/dag, en lagere gezondheid = meer én zwaardere ziektes.

**Schaal afremmen: steilere capaciteitsladder + progressieve daghuur (nieuwste)**
- **Aanleiding:** één speler liep weg met de competitie. Analyse van de mechanismen (geen
  productiedata beschikbaar vanuit de sessie) wees drie versterkende lussen aan:
  1. **Geen limiet op het aantal duiven per hok per wedstrijdvlucht** (`enterFlight`) —
     enkel titan (1) en estafette (3) hebben er een, en **bots schrijven zichzelf op 1–2
     in** (`botsEnterFlight`). Eén groot hok kan dus meerdere prijsplaatsen tegelijk pakken.
  2. **Schaal was zo goed als gratis:** een hok van 20 kostte €434/week tegen €266 voor een
     hok van 8 (1,6×) bij ~2,5× de verdiencapaciteit.
  3. Geld → markt/veiling → betere duiven, en de marktwaardering leert van zijn eigen
     verkopen.
  Ter referentie: de prijzenpot is ~**€30.755/week** (regio 3×€2.285, nat 2×€3.390, intl
  2×€6.610, titan €3.900) en is **top-zwaar** — de top 3 pakt ~75 % per vlucht.
- **Nu geïmplementeerd (lus 2):** `LOFT_CAPACITY_TIERS` steiler (8→20 kost **€112.500**
  i.p.v. €29.000) + **`UPKEEP_BANDS`**, progressieve daghuur per duif. Cijfers en de
  invariant "een hok van 8 betaalt exact als vroeger": zie §5.
- **UI:** de Dagbalans-tegel (`DashboardPage`) toont een **regel per schijf**
  ("Onderhoud duif 9–12 · 4 × €6") i.p.v. één regel. De **volledige uitleg staat in de
  wiki** (sectie 🏠 **Hokcapaciteit & onderhoudskosten**: de ladder, de schijven, de
  weekkost per hokgrootte); de uitbreidingskaart in `LoftPage` houdt het bij het énige
  cijfer dat daar telt — "je volgende duif kost €X/dag" — plus een link naar
  `/wiki#hok`, zodat een groter hok nooit een verborgen terugkerende kost is.
  Economy-DTO kreeg `upkeepBands` (de tabel) en de loft-DTO `dailyCosts.upkeepBands`
  (de eigen verdeling).
- **`WikiPage` scrollt nu naar de hash** (`useEffect` op mount): React Router springt zelf
  niet naar een anker als je van een andere route komt, dus zonder dat landde `/wiki#hok`
  bovenaan de pagina.
- **Geen migratie, geen `dataVersion`-bump** (config + logica). Bestaande hokken behouden
  hun capaciteit; wie al boven 8 zit, betaalt vanaf de eerstvolgende dagovergang het nieuwe
  tarief.
- ⚠️ **Bekend risico, bewust niet mee-geïmplementeerd:** een hok van 18–20 gaat van €406
  naar €1.050–1.330/week. Duikt zo'n speler onder €0, dan blokkeert `enterFlight` hem
  ("Je kassa staat negatief"). Overwogen mitigaties als het knelt: de toeslag in 3 weken
  laten opbouwen, of een eenmalige melding via een `*_NEWS_STEPS`-set in `Tour.tsx`
  (localStorage, geen migratie nodig).
- **Nog niet gedaan (bewust, op verzoek):** de instaplimiet per vlucht (lus 1), degressief
  prijzengeld per hok, clubkas/deelnamegeld. **Rekenpunt voor later:** een duif kan ~1,4
  starts/week aan (energie), en bij 8 wedstrijden/week geeft een limiet van 3 duiven → 24
  startplaatsen → een hok is volledig benut rond **17 duiven**; een limiet van 2 → 16
  plaatsen → rond **11 duiven**. De instaplimiet bepaalt dus hoeveel duiven zinvol zijn,
  de schijven zetten er de prijs op.
- **Geverifieerd** met een wegwerp-tsx-script tegen de echte helpers: ladder loopt strikt
  op, cumulatief €112.500; elk hok t/m 8 duiven ongewijzigd; totaal stijgt monotoon en de
  marginale kost van duif N daalt nooit; elke duif exact één keer aangerekend met
  aansluitende schijven; boven de laatste schijf blijft het toptarief gelden. Beide
  typechecks, de build en de vier vaste regressietests blijven groen.
- **Meegenomen doc-fix:** spelregels §4.2 vermeldde nog `36 · gecoachte duiven` voor de
  coach; dat is al langer **€80/dag** (`COACH.dailySalary`).

**Ervaring stijgt met afnemende opbrengst (nieuwste)**
- **Probleem:** ervaring was de enige eigenschap die **volledig lineair** groeide. Elke
  bron gaf een vast bedrag, los van het huidige niveau (vlucht `2 + km/100`, trainen 4,
  coach 0,5/dag, dilemma 4–8), dus 90→100 kostte precies evenveel vluchten als 0→10.
  Dat terwijl de trainbare skills wél afnemen richting hun plafond (`ruimte`-factor bij
  vluchten, `(cap−attr)/cap` bij de coach). Ervaring liep daardoor bij elke actieve duif
  vanzelf vol en was op termijn geen onderscheidende eigenschap meer — terwijl ze wel
  fors doorweegt (+33 % snelheid, −25 % vluchtverbruik, sneller herstel, energie doseren).
- **Fix:** nieuwe knop **`EXPERIENCE`** in `gameConfig.ts` + pure helper
  **`experienceGain(current, raw)`** in `pigeon.ts` (zie §5 voor de formule, de cijfers en
  de **ondergrens op `minFactor`** wegens de 1-decimaal-afronding). Toegepast **aan de
  bron** in alle zes de paden, zodat `sim.fatigue[].experienceDelta` het werkelijk
  toegepaste getal bevat en `seasonPracticeGain` (schedule.ts) vanzelf klopt.
- **Nog steeds waar:** een verre vlucht leert meer dan een korte (alles schaalt evenredig,
  de rangorde blijft), niets loopt vast (de bodem is 0,12, nooit 0), en ervaring heeft
  **geen gen-cap**.
- **Geen migratie, geen `dataVersion`-bump** (config + logica). Bestaande duiven **behouden**
  hun opgebouwde ervaring; enkel de groei vanaf nu volgt de curve. Een retroactieve
  verlaging zou bestaande spelers straffen voor iets wat ze correct hebben opgebouwd.
- **DTO/UI:** `pigeonDTO.coachGain` kreeg een veld **`experience`** (2 decimalen — de winst
  van een veteraan zit ver onder 0,1); `PigeonPage` toont dat per-duif-cijfer i.p.v. het
  globale `economy.coachExpDailyGain`. Dat economy-veld **blijft** bestaan (een oude, nog
  open tab zou anders op `undefined.toFixed()` crashen), maar wordt niet meer gebruikt.
- **Wiki:** nieuwe sectie 🎓 **Ervaring** (met de leerfactor-tabel); spelregels **§3.5**
  (+ verwijzingen in §1, §3, §8 en §13).
- **Geverifieerd** met een wegwerp-tsx-script tegen de echte helper: monotoon dalend,
  sneller dan vroeger onder ervaring 33, de kleinste terugkerende winst rondt niet weg,
  de rangorde tussen vluchten blijft, een negatieve delta wordt niet geschaald, en geen
  enkel startniveau (70/80/90/95/99) zit muurvast. Realistisch ritme: ervaring 50 na ~2
  weken, 80 na ~6, tegen de 100 na ~11 weken. De vier vaste regressietests + beide
  typechecks + build blijven groen.

**Unieke duivennamen + echte kampioenen als inspiratie (nieuwste)**
- **Regel:** élke combinatie van **voornaam + bijnaam** is uniek in de wereld, ongeacht
  hoe de duif ontstaat (start-hok, kweek, veiling, opvangcentrum, dilemma, migratie).
- `names.ts`: `draftName` (de oude generator) + **`generatePigeonName(sex, traits, taken?)`**
  dat tot 80 keer opnieuw trekt tot het een vrije naam vindt, en bij een écht uitgeputte
  pool een **dynastie** begint (`… II`, `III`, …). Helpers **`nameKey`** (case-insensitive)
  en **`namesInUse(pigeons)`**.
- `GenerateOptions.taken` doorgegeven op **elk** ontstaanspad: `createLoftForUser` en
  `seedWorld` (set groeit mee zodat de 6–8 starters onderling niet botsen), `auction.ts`
  (zondag + opvangcentrum), `events.ts` (alle dilemma-duiven), `breeding.ts::breed(…, taken)`
  (ook een **tweeling** onderling), en de legacy-hernoemmigraties.
- **Migratie v35** ruimt bestaande duplicaten op: de **oudste** duif houdt de naam, de
  rest wordt hernoemd; echte spelers krijgen een melding (`ntf:rename:dup:<id>`) zodat een
  naam nooit stilletjes verandert. **dataVersion → 35.**
- **Echte duivensport als inspiratie** (`gameConfig`): nieuwe epitheton-groep
  **`EPITHETS.legend`** (~8 % kans) met *de Kannibaal*, *de Nieuwe Kim*, *de Armando*,
  *de Olympiade*, *de Gouden Prins*, *de Barcelona-Kampioen*, *van Klak*, … plus voornamen
  **Armando/Bolt/Gustav/Paddy/Joe/Commando/Klak** en **Kim/Ami/Winkie/Mary/Vita** (naar
  Armando €1,25 M, New Kim €1,6 M, Cher Ami, Winkie's Dickin Medal).
- **Nieuwe blijvende test `names.test.mts`**: 400 nieuwe duiven + 40 kweekrondes zonder één
  duplicaat, en de dynastie-fallback op een kunstmatig uitgeputte pool (5.785 combinaties).
- Spelregels **§10** bijgewerkt.

**Duivenwaarde komt van de markt i.p.v. een vaste curve**
- **Probleem:** `estimateValue` is een vaste curve `(talent/50)^2.2 × 800`, en die is te
  vlak aan de top: over de héle talentschaal 40→90 gaat de prijs maar **×6**, terwijl een
  topduif ~€2.500/week aan prijzengeld kan ophalen en een talent-50 duif nooit iets. Een
  veilingduif geschat op €2.300 ging voor **€7.000** weg. Gemeten met `limits-report`-stijl
  script: zondagveiling-duiven schatten op €1.220–€2.910.
- **Nieuw: `core/game/market.ts`.** De markt zet het **niveau**, het model bewaakt de
  **rangorde**:
  1. elke verkoop (markt/privébod/veiling) bewaart het **talent** bij de prijs
     (`Trade.talent`, kolom `talent REAL` achteraan `SCHEMA_STEPS`);
  2. per verkoop een **factor** = prijs ÷ referentiecurve op dat talent;
  3. die factoren worden gemiddeld per talentband, gewogen op **talentafstand**
     (`talentSigma 10`) en **recentheid** (`halfLifeDays 10`, venster 28 dagen);
  4. de curve wordt **monotoon** gemaakt (cumulatief maximum) → een betere duif is nooit
     minder waard, ook niet als er in één band een koopje voorbijkwam.
- **Waarom factoren en niet de prijzen zelf:** met 10 spelers zijn er nooit verkopen in
  élke band. Rechtstreeks naar prijzen blenden maakte een talent-85 duif **goedkoper** dan
  een talent-70 die hoog verkocht was. Schalen van de curve houdt de banden vergelijkbaar.
- **Per verzoek één curve** (`WeakMap` op `Database`, sleutel bevat `db.trades.length` zodat
  een verkoop die in hetzelfde verzoek wordt afgesloten wél meetelt). Nodig want `/state`
  waardeert ~200 duiven binnen 10 ms CPU.
- **Zonder verkopen = het oude gedrag.** `MARKET_VALUATION` knoppen: `trustWeight 1.5`
  (≈2 verse verkopen = volle invloed), `maxTrust 0.85`, factorband `0.1–8`.
- **Gemeten** (verkopen talent 70–72 aan €7.000/€5.200): talent 70 → €7.010, 78 → €8.970,
  85 → €9.370 (monotoon); daarna twee junkverkopen aan €50–60: talent 30 → €120.
- **Doorwerking:** `pigeonDTO.value` + nieuwe velden `valueModel`/`valueMarket`/`valueTrust`/
  `valueSamples` (duifpagina toont "X% bepaald door N recente verkopen"); **veiling-startbod**
  = `AUCTION.openingBidFraction` (**0,3**, was 0,5 van de modelwaarde) zodat de hamer de prijs
  *ontdekt* i.p.v. dicteert; het **koopman-dilemma** biedt nu op marktwaarde.
- **Migratie v34:** de twee veilingverkopen van 16 aug 2026 ("tante … soep" €7.000,
  "Edgard … soep" €5.200) worden als **prijsobservatie** in `db.trades` gezet (het spel lag
  plat, spelers regelden het onderling). **Enkel data:** geen geld verplaatst, geen eigenaar
  gewijzigd. Stabiele id `trd_manual_…`. **dataVersion → 34.**
- **Bekende scheefheden die nog in het model zitten** (nu minder erg, want de markt overrulet
  het niveau): leeftijd verlaagt de waarde **niet** meer boven 1 jaar (`AGE_CURVE` is aan de
  dalende kant afgevlakt naar 1,0), en de ervaringsfactor (×1,0–1,5) weegt zwaarder dan het
  verschil tussen een goede en een elitevogel.
- Wiki-sectie **💰 Wat is een duif waard?**, spelregels **§9.0**.

**Veiling-slotfase: 3 biedingen in de laatste 30 min + één zondagduif**
- **Doel:** minder nibbelen met minimumbedragen → spelers zetten sneller hun echte
  maximum, veilingen eindigen in enkele grote stappen, en dat drukt meteen de
  poll-belasting van het slotkwartier.
- **Regels** (`AUCTION` in gameConfig): vrij bieden tot `finalPhaseMinutes` (30) voor
  het einde; daarbinnen hoogstens `finalPhaseMaxBids` (3) biedingen **per speler per
  veiling**. De anti-snipe (`antiSnipeMinutes`, 5) blijft: een bod in de laatste 5 min
  zet `endAt` terug op nu + 5 min — maar **telt gewoon mee** voor je drie, dus een
  verlenging kan niet gefarmd worden.
- **Teller** = `AuctionBid.lateBids` (kolom `late_bids` achteraan `SCHEMA_STEPS`), rijdt
  mee op de staande bieding van de speler; verhogen buiten de slotfase telt niet mee.
  `placeBid` weigert netjes zodra het budget op is.
- **DTO** (`auctionsDTO`, per viewer): `finalPhase`, `finalPhaseAt`, `finalPhaseMinutes`,
  `antiSnipeMinutes`, `maxBids`, `bidsUsed`, `bidsLeft`. UI: `AuctionCard` toont vóór de
  slotfase de spelregel, erna een gekleurde balk "nog X van je 3 biedingen" en blokkeert
  invoer+knop als het budget op is.
- **Zondag = precies één duif.** `ensureAuctions` draait bij élk verzoek, dus twee
  gelijktijdige verzoeken konden **allebei** een zondagveiling openen (random id's) →
  meerdere topduiven op één zondag. Nu **stabiele id's** afgeleid van de dagsleutel
  (`auc_<slug>` / `pig_<slug>` + melding-id per speler): INSERT OR REPLACE houdt er
  precies één over, hoeveel verzoeken er ook racen. Bovendien spawnt er **geen
  opvangcentrum-veiling** zolang de zondagveiling loopt.
- Wiki-sectie **🔨 Veilingen & bieden**, spelregels **§9.3** + §12. Geen migratie (nieuwe
  kolom met default 0 = huidig gedrag).

**Zelf kiezen wie de dokter/kinesist behandelt**
- **Probleem:** één dokter dekt maar `INFIRMARY.birdsPerDoctor` (2) zieke duiven en één
  kinesist 2 gekwetste, maar de dekking ging **altijd automatisch** naar de ernstigste
  gevallen. Met 3 patiënten en 1 dokter kon je dus niet kiezen wie voorrang kreeg.
- **`Pigeon.careAssigned?: boolean`** (kolom `care_assigned INTEGER DEFAULT 0`, achteraan
  `SCHEMA_STEPS`): de speler zet een duif vast op een personeelsplaats.
  `coveredInInfirmary` (health.ts) neemt **eerst de vastgezette duiven** (onderling op
  ernst) en vult de resterende plaatsen daarna zoals vroeger **ernstigste eerst** — een
  hok dat de knop nooit gebruikt gedraagt zich dus exact als voorheen.
- Nieuwe helper **`careSlots(loft, pigeons, kind)`** → `{slots, assigned, patients}`,
  gebruikt door de guard én de UI-tellers.
- Actie **`setCareAssignment`** (engine.ts) + endpoint **`POST /pigeons/:id/care`**
  (`{on}`). Weigert netjes: geen personeel in dienst, duif niet in de boeg, duif niet
  ziek, of alle plaatsen al vastgezet ("Je dokter behandelt er al 2 — …").
- DTO: `pigeonDTO` stuurt nu **`treated`** (wordt ze effectief behandeld) en
  **`careAssigned`**. De client rekende de dekking vroeger zélf na — die spiegel is weg,
  de server is de waarheid.
- UI (`InfirmaryPage`): per personeelslid een regel "behandelt nu X van je Y patiënten
  · Z door jou vastgezet" plus een rode waarschuwing bij meer patiënten dan plaatsen; op
  elke duifkaart in de boeg een knop **"📌 Deze duif laten behandelen"** /
  **"📌 Behandeling vrijgeven"**. Spelregels **§5.4** bijgewerkt.
- Geen migratie nodig (nieuwe kolom met default 0 = huidige gedrag).

**Migratie v33 — eenmalige veiling-rechtzetting**
- Op verzoek van de eigenaar: **€3.440 van het hok "De Vluchtige Vleugel"** afgehaald om
  een verkeerd afgerekende veiling recht te zetten. Match op **hoknaam óf gebruikersnaam**
  (hoofdletter-ongevoelig), **enkel echte spelers** (bots met dezelfde naam blijven
  ongemoeid). De speler krijgt een bel-melding "⚖️ Rechtzetting van de veiling" met
  stabiele id `ntf:admin:auctioncorrection:3440`, zodat twee gelijktijdige verzoeken
  nooit twee meldingen of een dubbele afboeking geven. **dataVersion → 33.**
- Patroon om te hergebruiken voor een volgende handmatige correctie: zie migratie v30
  (duif-eigenschap) en deze (geld + melding) in `schedule.ts::runDataMigrations`.

**503-fix ronde 3: `persist()` schreef één statement per rij (nieuwste)**
- **Symptoom:** 503 tijdens een live vlucht; spelers konden de vlucht niet volgen én
  niet bieden. **Niet het dagquotum**: de D1-metrics toonden 5 k gelezen / 2 k
  geschreven rijen (limieten 5 M / 100 k) — nog geen 0,1 % van het budget.
- **Oorzaak: opnieuw de 50-queries-per-invocatie-limiet**, nu via `persist()`. De
  per-rij-diff maakte **één `INSERT OR REPLACE` per gewijzigde rij**, en die tellen
  allemaal mee binnen dezelfde `batch()`. Gemeten met `query-budget.test.mts` op een
  productiewereld: een gewone poll 15 queries, maar een **live vlucht 68** (elke 30 min
  krijgt élke ingeschreven duif haar energie-aftrek → 52 rijen), een **afronding 149**
  en de **dagovergang 144**. Zo'n verzoek sterft vóór het het spel bereikt — en omdat de
  tick niet gepersisteerd raakt, doet het vólgende verzoek exact hetzelfde: iedereen
  zit vast zolang de vlucht loopt.
- **Fix, volledig in `core/d1.ts::diff`** (geen migratie, geen gedragswijziging):
  1. **Multi-row statements** — de gewijzigde rijen van een tabel gaan samen in één
     `INSERT OR REPLACE … VALUES (…),(…)`, begrensd door D1's **100 bound parameters
     per query** (`D1_MAX_BOUND_PARAMS`).
  2. **Smalle updates** — `load` bewaart nu ook de **kolomwaarden** van `pigeons` en
     `lofts` (`rowSnapshots`, mappers `pigeonRow`/`loftRow` op moduleniveau), zodat
     `persist` alleen de kolommen schrijft die écht bewogen:
     `WITH v(k, form) AS (VALUES …) UPDATE pigeons SET form = v.form FROM v WHERE
     pigeons.id = v.k`. Een duif heeft 38 kolommen (2 rijen/query); een energie-aftrek
     raakt er één (**50 rijen/query**).
  3. **Groeperen op maat** — rijen die dezelfde kolommen wijzigen gaan samen; wijzigt
     elke rij een iets andere set (een vluchtafronding), dan is één groep op de
     **unie** van de kolommen goedkoper. `diff` rekent beide varianten door en neemt
     de kleinste.
  4. Deletes gaan gegroepeerd via `… WHERE id IN (?,?,…)`.
- **Resultaat (gemeten, ~200 duiven):** live vlucht **68 → 17**, afronding **149 → 41**,
  dagovergang **144 → 42**, kalender plannen **130 → 28**. Alles ruim onder de 50.
- **Bekend plafond:** de dagovergang schaalt met het **totale** aantal duiven — bij
  ~**350** duiven zit ze op 48/50. Rond ~400 duiven moet `tickDailyCare` per hok
  gechunkt worden (per-hok-cursor i.p.v. `world.lastDailyTick`). `query-budget.test.mts`
  bewaakt dit; draai hem met `PIGEONS=400` om het na te meten.
- **Nieuwe blijvende test `query-budget.test.mts`** (naast `d1-partial-load.test.mts`):
  bouwt een productiewereld op de échte engine en telt de queries van een verzoek door
  een hele zondag (kalender → live vlucht → afronding → middernacht). Faalt zodra één
  verzoek 50 queries raakt. **Draai hem na élke wijziging aan `d1.ts` of aan een tick.**

**Sponsors herijkt: dagbedrag + podiumpremie per niveau (nieuwste)**
- **Probleem:** 3 sponsors gaven samen €170/week (€24/dag) tegen ~€280/dag kosten — 8,7% dekking —
  en de bonus hing aan een **overwinning**, wat met 8 wedstrijden/week en 10 melkers zelden lukt.
- **`SponsorDef.weeklyStipend` → `dailyStipend`** (uitbetaald in `tickDailyCare`, geen `/7`-afronding
  meer) en **`winBonus` → `podiumBase`** = het bedrag voor een **zege op een nationale vlucht**. De
  echte uitbetaling = `podiumBase × SPONSOR_TIER_FACTOR × SPONSOR_PODIUM_FACTOR`, afgerond op €5
  (`sponsorPodiumBonus` in gameConfig). Niveaufactoren **0,6 / 1,0 / 1,8** (spiegelen de prijzengeld-
  verhouding), plaatsfactoren **1 / 0,6 / 0,35**. Gemiddelde niveaufactor over een week = 1,06, dus
  het **herverdeelt** richting de grote vluchten i.p.v. te inflateren.
- Bedragen ~4× omhoog (degressief: tier 1 ×4,5 → tier 4 ×3,5): tier 1 €25–40/dag, tier 2 €45–70,
  tier 3 €90–135, tier 4 €150–200. Tekengeld/opzegboete ≈ 14 dagen stipendium (de Loterij houdt haar
  €3.000 tekengeld als flavour). Het trio van de speler gaat van €24 → **€100/dag**.
- **Enkel wedstrijdvluchten betalen** — titan en estafette vallen al vóór dit blok weg in `tickFlights`,
  practice bereikt het nooit. Let op: een titan draagt intern `type: 'international'`, dus nooit op
  het niveau checken.
- **Melding na elke wedstrijd met podium** (`ntf:spon:<flightId>:<userId>`, stabiel): welke duiven
  welke plaats haalden, op welk niveau, en **per sponsor** het uitbetaalde bedrag.
- **Dagbalans op het Overzicht:** `dailyRunningCostBreakdown` (economy.ts) geeft nu ook `sponsors[]`,
  `sponsorTotal` en `net`; de tegel heet **Dagbalans**, toont het **nettobedrag** (groen/rood) en de
  onderverdeling kreeg een inkomstenblok per sponsor + "Netto per dag".
- **Migratie v32** zet lopende contracten én openstaande aanbiedingen om naar de nieuwe velden op het
  **nieuwe** catalogusniveau; een contract dat bij ondertekening geschaald was, behoudt zijn verhouding
  (clamp 0,5–2). `sponsors.ts` leest oude velden defensief (`weeklyStipend/7`) tot de migratie liep.
  **dataVersion → 32.**

**Estafettevlucht (nieuwste)**
- Nieuw weekendformat dat **week om week afwisselt met de titanenwedstrijd** (zie §5 voor
  alle details): één **ploeg van 3 duiven** per hok, ~900 km in **drie exact gelijke
  etappes**, één duif tegelijk in de lucht, **weer per etappe** dat dagen vooraf zichtbaar is
  en waar je je volgorde op afstemt. **Eén duif die er niet geraakt = hele ploeg uit.** Enkel
  geld (top 5), geen seizoenspunten, geen wedden; duivenranglijsten tellen wél mee.
- Nieuw bestand `core/game/relay.ts` (routegeometrie + ploeghelpers); sim/live/uitslag in
  `flight.ts`; nieuw endpoint `POST /flights/:id/relay-order`; UI op `FlightsPage`
  (etappes + weerbericht + ▲▼-volgorde) en `LiveFlightPage` (ploegbord met de 3 etappes);
  wiki-sectie 🔗; spelregels **§2.9**; eerste-login-melding `RELAY_NEWS_STEPS`
  (sleutel `roekoe.newsSeen.relay.<id>`).
- Kolommen `relay INTEGER` + `legs TEXT` achteraan `SCHEMA_STEPS` (append-only).
  **Migratie v31** ruimt een al geplande titan op een estafette-zaterdag op. **dataVersion → 31.**
- Geverifieerd met een wegwerp-tsx-script tegen de echte engine (40+ controles): kalender­
  afwisseling, gelijke etappes, één duif tegelijk, energie enkel tijdens de eigen etappe,
  uitschakeling + niet-gevlogen duiven ongemoeid, klassement finishers-vóór-uitgevallen,
  prijzengeld één keer uitbetaald, ploegbeheer (inschrijven/volgorde/uitschrijven) en
  onvolledige ploegen.

**Lichtere, vaste weekkalender**
- `REAL_SCHEDULE` is herschreven van "elke dag een lange + een korte vlucht (+ om de 2
  dagen een oefenvlucht)" naar **één vast programma per weekdag** (zie §5). Resultaat:
  **10 vluchten/week** (8 wedstrijden + 2 oefen) i.p.v. 13–15. Doel: **hogere deelname
  per vlucht** — hetzelfde aantal duiven verdeeld over minder races = voller veld en meer
  competitie. `TITAN.hour` 11 → **8** (zaterdag blijft de enige vlucht die dag).
- **Enkel voor nog niet geplande dagen.** Reeds geplande vluchten blijven exact zoals ze
  zijn: `ensureFlightsScheduled` slaat elke dag over die al een vlucht met een **oude**
  slot-key draagt (`LEGACY_SLOT_KEYS`), zodat er geen mengeling van oud + nieuw op één dag
  ontstaat. De nieuwe kalender begint dus pas voorbij de horizon (~5 dagen na deploy).
  **Geen migratie, geen `dataVersion`-bump.**
- Geverifieerd met een wegwerp-tsx-script tegen de echte `ensureFlightsScheduled`: de
  weekkalender klopt exact (3 regio / 2 nat / 2 intl / 1 titan / 2 oefen), planning is
  idempotent, een beschermde dag krijgt niets bij, en een bestaande titan wordt niet
  gedupliceerd.

**503-fix ronde 2: `ensureSchema` blies de 50-querylimiet op (nieuwste)**
- De 503-golf kwam terug, maar **niet** door het dagquotum (metrics: 273 k van 5 M
  gelezen rijen). Oorzaak: `ensureSchema` vuurde **71 losse D1-statements** af bij
  **elke cold start**, tegen een limiet van **50 queries per Worker-invocatie** op
  het gratis plan → zo'n verzoek sterft vóór het het spel bereikt, op eender welke
  route (ook inloggen). Nu **gegate op `world.schema_version` én hervatbaar** (max.
  20 statements per invocatie): 1 query op een bijgewerkte database.
  **`SCHEMA_STEPS` is append-only — nieuwe statements achteraan.**
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
- **Oefenvluchten** (`PRACTICE`, slots `tue-practice`/`fri-practice` 12:00; vroeger het
  dagelijkse `noon-practice`): gratis, ~8 energie, geen
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
- **Info-hiding bij bieden:** `pigeonDTO(db, p, viewerId?, viewerIsAdmin?)` verbergt de
  **privé-eigenschappen** van andermans duiven. `publiclyRevealed = viewerId===undefined ||
  p.ownerId===viewerId || p.forSale || onAuction`, en `revealed = publiclyRevealed ||
  viewerIsAdmin` (zie de admin-doorbraak bovenaan §8) — **een duif die te koop staat op de markt is
  dus volledig zichtbaar** (koper moet zien wat hij koopt), net als **veilingduiven**
  (`auctionsDTO` roept `pigeonDTO(db, p)` zónder viewer → altijd revealed). Enkel een
  duif die **niet** te koop staat blijft verborgen wanneer een ander ze bekijkt om een
  **rechtstreeks bod** te doen. Is `revealed` false dan worden `speed/endurance/orientation/
  libido/form/health/experience` (+ ailment/inInfirmary/coached/ration/compartment/
  cureUntil/onCure/breeding/trainAvailableAt/dailyCare) **op null/false** gezet.
  **Ook een duif in een lopende veiling is volledig zichtbaar** (`onAuction`-check in
  `pigeonDTO`): de zondagstopper en de opvangcentrum-duif waren op hun eigen **duifpagina**
  verborgen omdat ze van het veilinghuis zijn en niet `forSale` staan. De **veilingkaart** op de
  markt toonde bovendien helemaal geen statbalken (server stuurde ze wél mee) — nu wel.
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
6. **Rustiger pollen** — LiveFlightPage 8s→20s→**60s**, FlightsPage 15s→40s→**90s**
   (verder verruimd in 503-fix ronde 5, zie onderaan).

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

**Fix: `ensureSchema` is nu gegate én hervatbaar.** Alle statements staan in één
**append-only** lijst `SCHEMA_STEPS`; `world.schema_version` bewaart **hoeveel** er
al toegepast zijn.
- Bijgewerkte database → **1 query**, functie geeft `true` terug.
- Achterlopende database → hoogstens **`SCHEMA_STEPS_PER_RUN` (20)** statements,
  slaat de voortgang op en geeft `false` → de middleware (`schemaReady = await
  ensureSchema(...)`) komt terug voor de rest. Duurste invocatie: **22 queries**.
- Zo blijft **élke** invocatie ver onder de 50, ook de allereerste op een verse
  database (waar de `world`-rij nog niet bestaat en de voortgang dus niet bewaard
  kan worden).

> **Regel: `SCHEMA_STEPS` is append-only.** Nieuwe statements gaan **achteraan**.
> Iets invoegen of herordenen zou databases die al verder staan statements laten
> overslaan. Elk statement is idempotent (`ADD COLUMN` op een bestaande kolom
> gooit, `IF NOT EXISTS` doet niets), dus een verkeerde teller kost hoogstens
> queries, nooit correctheid.

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
| D1 rijen gelezen/dag | 5 M | **hard afgedwongen vanaf 1 sep 2026**; drukke dag zit op 24% — `daily-budget.test.mts` |
| D1 rijen geschreven/dag | 100 k | idem; drukke dag zit op 7% |
| D1 databasegrootte | 500 MB | zat op ~0,7 MB |
| Externe `fetch`-subrequests | 50 | `fetchFlightWeather` (1 per startende vlucht) |

> **Let op bij `persist()`:** één `db.batch([...])` met veel statements telt mee voor de
> 50-querylimiet. Een vluchtafronding raakt tientallen duiven + meldingen tegelijk —
> hou dat in de gaten als er ooit weer 503's zijn net ná een race.

**Wat is gefixt:**
7. **`ensureSchema` gegate + hervatbaar** — 71 queries → **1** op een bijgewerkte
   database, max. 22 tijdens een upgrade. Dit is de hoofdfix voor ronde 2.
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

> **Bots tellen mee in dat plafond.** 8 bots × `BOT.maxCapacity` (12) = ~96 duiven die
> élk verzoek gelezen en om 00:00 herschreven worden. Daarom staat er een plafond op het
> bothok; verhoog `BOT.maxCapacity` of `DEFAULT_BOT_COUNT` niet zonder
> `query-budget.test.mts` opnieuw te draaien (ook met `PIGEONS=350`).

**Nog beschikbare hefbomen als het toch weer krap wordt:** `advanceRealtime` throttlen
(bv. max. 1×/20 s via een `world.lastAdvance`-guard); `/state` kort cachen (Cache API);
`TRADE_LOAD_LIMIT` verlagen. **Structureel** blijft `pigeons` (~200 rijen) de grootste
volledige load — die is echt globaal nodig (vluchten, markt, bots). ⚠️ **Wat er wél uit
kon: de kolommen.** Zie de historiek-fix bovenaan §8 — niet de rijen tellen, maar wat
er per rij aan meerijdt.

### 503-fix ronde 4: elke poll schreef rijen (dé oorzaak, nieuwste)

**Symptoom:** iedereen buiten, hele dag. **Metrics van die dag:** 474 k gelezen (van 5 M,
dus 9 %) maar **77,5 k geschreven van de 100 k/dag** om 19:30 UTC — de **schrijflimiet**
was de bindende, niet de leeslimiet. Loopt die vol, dan faalt élke schrijvende request
tot middernacht UTC.

**Oorzaak: twee klokken die "nu" in een rij stempelden bij élk verzoek.**
- `auction.ts::ensureAuctions` zette `world.lastShelterSpawn = now` op **elke** request
  (`dtHours > 0` is altijd waar) → de wereldrij werd altijd geschreven.
- `health.ts::tickHealing` zette `ailment.lastTickMs = now` + herrekende `healed` op
  **elke** request → **één duifrij per zieke duif per poll** (en `pigeons` heeft een
  index, dus D1 rekent 2 rijen per duif aan).

Met ~12 zieke duiven kostte élke poll ~25 geschreven rijen, ook al gebeurde er niets.
Gemeten: 474 k gelezen ÷ 350 rijen ≈ **1.355 verzoeken op de hele dag** → ×25 ≈ 34 k
rijen, en dat schaalt lineair mee met het pollen (live-bord = 3 verzoeken/minuut).

**Fix — beide klokken gekwantiseerd** (zoals `tickFlightEnergy` al per 30 min werkte):
`HEALING.tickMinutes 15` en `AUCTION.shelterCheckMinutes 15`. Sla je een tick over, dan
blijft `lastTickMs`/`lastShelterSpawn` staan en pakt de volgende de **volle** verstreken
tijd — geen verlies, geen drift, en de spawn-kans blijft memoryless (zelfde gemiddelde
van 60 u). Herstel duurt 1,5–18 dagen, dus kwartierstappen zijn onzichtbaar.

**Resultaat:** een poll zonder gebeurtenissen schrijft **0 rijen** (was 13–25). De zieke
duiven kosten nu ~12 rijen per kwartier (~1.150/dag) i.p.v. per verzoek.

**Nieuwe blijvende test `idle-writes.test.mts`:** pollt herhaaldelijk in een live én een
rustige wereld en faalt zodra een poll zonder gebeurtenissen ook maar één rij schrijft.
**Regel voor nieuwe code: stempel nooit `Date.now()` in een rij op elk verzoek** — geef
zo'n klok altijd een minimuminterval.

**Tweede regel, voor CPU (zie CPU-fix ronde 2 bovenaan §8): niets in het verzoekpad mag
schalen met de racelengte of kwadratisch met het aantal duiven.** Een lus over "alle
duiven van een vlucht" of over "de hele racetijd" hoort een **harde bovengrens** te
hebben, en het resultaat hoort gecachet te worden als het tussen polls niet verandert.
Twee keer is het spel hierop platgegaan (het live verslag, de weddenschapsodds).
Meet met `npx tsx cpu-sweep.mts`, en laat `cpu-budget.test.mts` het bewaken — die test
meet bewust de **koude** weg, want een cache redt je niet na een isolate-recycle.

### 503-fix ronde 5: de estafette duurt een halve dag (⚠️ diagnose achteraf weerlegd — zie ronde 6)

**Symptoom:** site "constant niet aan het laden", tijdens een **live estafettevlucht**.

**Wat het NIET was** (gemeten, niet gegokt):
- **50-querylimiet:** een live-estafettepoll kost **13–16 queries**, het duurste verzoek
  van de hele race (start/afronding) **38–39**. Ruim onder de 50.
- **Schrijflimiet:** een live-estafettepoll tussen de energie-ticks schrijft **0 rijen**
  (8× gemeten). `tickBotEntries` is idempotent zoals bedoeld.

**Wat het volgens deze redenering was — en achteraf NIET bleek (zie ronde 6): het
leesbudget (5 M rijen/dag) × de duur van een estafette.**
Élk verzoek leest de wereld (~350 rijen). Een estafette is **850–950 km in drie etappes**
en duurt gemeten **16–19 uur** — veruit de langste vlucht in het spel. Het live-bord
pollde elke **20 s** = 180 verzoeken/uur:

| | rijen |
|---|---|
| 1 speler die één estafette volledig volgt (19 u × 180 × 352) | **1,2 M** |
| 4–5 spelers die dat samen doen | **5–6 M** → **over de daglimiet** |

Dat is exact het scenario dat §"De tweede limiet" al voorspelde ("tien spelers die samen
een namiddag naar een fondvlucht kijken zitten al aan het dagbudget"); de estafette maakt
er een hele *dag* van. Loopt het budget leeg, dan faalt **élk** verzoek — ook het lichte
inlogpad — tot de reset om middernacht UTC.

**Verzwarend (eerlijk): de bot-uitbreiding van dezelfde dag.** 8 bots i.p.v. 6, en hun
hokken groeien naar `BOT.maxCapacity` (12) → tot ~96 botduiven i.p.v. ~40. Dat is **+15
à +25 % rijen per verzoek**, en met 13 ploegen i.p.v. 5 kijken er ook meer mensen mee.
Het heeft het probleem niet veroorzaakt (de kosten per verzoek zijn structureel), maar
het at wel de marge op.

**Gefixt (hefbomen 1 en 4 uit de lijst hieronder):**
12. **Pollintervallen verruimd** — live-bord **20 s → 60 s** (`LiveFlightPage`), kalender
    **40 s → 90 s** (`FlightsPage`). Factor **3×** resp. **2,25×** minder verzoeken.
    `MarketPage` (15 s) blijft: die pollt enkel in de laatste 6 min van een veiling.
13. **`TRADE_LOAD_LIMIT` 100 → 40** (`core/d1.ts`, nu **geëxporteerd** zodat
    `d1-partial-load.test.mts` de constante volgt i.p.v. 100 te hardcoderen). De
    marktwaardering weegt een verkoop toch al op recentheid (halfwaardetijd 10 dagen,
    venster 28 dagen), dus de oudste 60 bewogen de curve nauwelijks.

**Resultaat (gemeten met `limits-report.mts`):** **352 → 293 rijen** per poll, dagbudget
**14.204 → 17.064** verzoeken. Eén speler die een volledige estafette volgt gaat van
**1,2 M → 0,33 M rijen** (**3,6× minder**); vijf tegelijk passen nu binnen de daglimiet.

> ⚠️ **Nog niet gedaan — de echte fix.** `/flights/:id/live` laadt de **hele wereld**
> (~293 rijen) om **één** vlucht te tonen, en dat is het heetste endpoint dat er is. De
> structurele oplossing is een **smalle load** voor die route (vlucht + deelnemende duiven
> + hoknamen ≈ 70 rijen) of `advanceRealtime` **throttlen** (`world.lastAdvance`, max.
> 1×/20–30 s) zodat een poll de wereld niet meer hoeft te laden. Dat is hefboom 3+5
> hieronder en zou nog eens ~4× schelen — dan kan het pollinterval ook weer omlaag.

### ⚠️ Correctie op ronde 5 + 503-fix ronde 6: CPU en trage weer-fetches (nieuwste)

**De diagnose van ronde 5 was fout.** Ze was gebaseerd op een redenering, niet op de
metrics — precies de fout waar §ronde 2 al voor waarschuwt. De Cloudflare-cijfers
(1–23 aug) weerleggen ze:

| Meting | Waarde | Betekenis |
|---|---|---|
| Verzoeken | **29,06 k / 23 dagen = ~1.263 per dag** | ~1 % van de 100.000/dag |
| Rijen gelezen (afgeleid) | ~380 k/dag | **7,6 %** van de 5 M — het leesbudget was nooit in gevaar |
| **CPU-tijd** | **516.350 ms / 29.060 = 17,8 ms per verzoek** | dít is het uitschieter-cijfer |

Het pollinterval verruimen (ronde 5) was dus geen oplossing voor dít probleem. Het is
op zich geen slechte maatregel — minder verzoeken is minder kosten — maar het raakte de
oorzaak niet. **Les: haal de metrics vóór je een oorzaak benoemt, ook als de theorie mooi klopt.**

**Bevinding 1 — het verzoek kán hangen (dit past op "blijft laden").**
De middleware deed de weer-fetches **sequentieel**, elk met een eigen timeout van 4 s.
Een estafette heeft **drie etappevoorspellingen**, in de laatste 2 u vóór de start
**elk uur** ververst (`relayLegsNeedingForecast`), plus een fetch per startende vlucht.
Worst case zat één verzoek dus 12–20 s te wachten op Open-Meteo — geen foutmelding, maar
een spinner. **Gefixt:** alles draait nu in één `Promise.all`, dus het hele blok is
begrensd op **één** timeout i.p.v. één per call. Ruim binnen de 50 subrequests.

**Bevinding 2 — de CPU per verzoek is structureel hoog.** Lokaal gemeten op een
productiewereld (167 duiven), en het komt opvallend goed overeen met de 17,8 ms uit het
dashboard:

| Onderdeel | ms |
|---|---|
| `D1Store.load` (query + JSON.parse + snapshot) | ~4,2 |
| `advanceRealtime` (alle ticks samen) | ~3,4 |
| `persist` (diff + stringify) | ~5,8 |
| `/state` DTO's (duiven, vluchten, ranglijsten) | ~0,8 |
| **totaal** | **~14 ms** |

Dat is **het D1Store-patroon zelf**, niet één hete tick: élk verzoek — ook een poll waar
niets gebeurt — laadt, parset, snapshot, diff't en stringify't de hele wereld. De DTO-laag
is verwaarloosbaar (0,8 ms), dus daar valt niets te halen. Losse ticks meten lukte niet:
alle metingen kwamen op ~0,9 ms uit, ook `pruneOldFlights` die vrijwel niets doet — dat is
de ruisvloer van de meting, geen signaal. **Claim dus niet dat één tick de boosdoener is.**

**Meegenomen:** `tickBotEntries` slaat nu eerst goedkoop af (staan alle bots al
ingeschreven → meteen klaar) en `botEntryContext` groepeert de duiven **één keer** per
pas i.p.v. per bot per vlucht (was O(bots × vluchten × duiven)). Niet meetbaar boven de
ruis, wel algoritmisch juist.

> **Nog open — dit is de echte fix voor de CPU.** Zolang élk verzoek de hele wereld
> laadt+persist, kost het ~14 ms en is er geen marge. De twee wegen zijn dezelfde als in
> hefboom 3/5 hieronder: een **smalle load** voor de hete routes (`/flights/:id/live`,
> `/state`) of **`advanceRealtime` throttlen** (`world.lastAdvance`, max 1×/20–30 s) zodat
> een poll de wereld helemaal niet meer hoeft aan te raken.

**BEVESTIGD op 23 aug** — het Functions-paneel liet er geen twijfel over bestaan:

| Errors (23 aug) | |
|---|---|
| **Exceeded CPU Time Limits** | **69** |
| Internal / Script Threw Exception / Exceeded Memory / Client Disconnected | 0 |

| CPU per verzoek (µs) | |
|---|---|
| p50 | 25.985 → **26 ms** |
| p75 | 33.690 → **34 ms** |
| p99 | 68.257 → **68 ms** |
| p99.9 | 96.434 → **96 ms** |

Dus: **de CPU is de oorzaak**, en de staart is wat sterft. Mijn lokale ~14 ms was nog
optimistisch — de Workers-runtime en een grotere wereld maken er in productie ~26 ms van.
Alle andere fouttellers staan op 0, dus D1-quota, geheugen en exceptions vallen af.

### 503-fix ronde 7: `advanceRealtime` throttlen (dé CPU-fix, nieuwste)

**Oorzaak staat vast** (zie ronde 6): Error 1102, 69× op één dag, p50 26 ms per verzoek.

**De fix: een read-only verzoek binnen `ADVANCE_THROTTLE_SECONDS` (20) van de vorige
run slaat `advanceRealtime` én `persist` volledig over.** Nieuw veld
**`World.lastAdvance`** (kolom `last_advance TEXT`, achteraan `SCHEMA_STEPS` — de
append-only regel), gestempeld in de middleware ná de engine-run.

- **Alleen leesverzoeken** (GET/HEAD) worden gethrotteld. Élke POST/PUT/DELETE draait
  eerst de engine, zodat een speleractie nooit op een verouderde wereld werkt.
- **Niets gaat verloren.** De hele wereldklok is afgeleid uit tijdstempels (vluchten,
  dagverzorging, herstel, seizoen), dus later draaien verandert geen uitkomst — het
  verschuift alleen wanneer iets *opgemerkt* wordt, met hoogstens 20 s.
- **Veilige terugval:** staat de kolom er nog niet, dan is `lastAdvance` leeg →
  `Date.parse('')` is NaN → nooit "fresh" → exact het oude gedrag tot de migratie liep.
- **Schrijfkost:** een advance schrijft nu ook de wereldrij (`lastAdvance` bewoog), dus
  hoogstens 1 rij per 20 s ≈ **4.300/dag** van de 100.000. Doorgethrottelde polls
  schrijven **0** rijen (er wordt niet eens gepersist).

**Gemeten:** een doorgethrotteld leesverzoek gaat van **5,24 → 2,48 ms** (−53 %) op een
wereld van 200 duiven; van 30 polls over 60 s draait de engine er nog **3**. Wat overblijft
is `D1Store.load` — dát is de volgende hefboom (smalle load voor `/flights/:id/live` en
`/state`), en pas als die er is kunnen de pollintervallen van ronde 5 weer omlaag.

**Nieuwe blijvende test `advance-throttle.test.mts`** (10 controles): leespolls binnen het
venster slaan de engine over, net erbuiten weer niet, een POST draait altijd, doorgethrottelde
polls schrijven niets, en — het belangrijkste — een vlucht gaat gewoon **live** terwijl er
uitsluitend leespolls binnenkomen.

### De tweede limiet: rijen gelezen per dag (meting `limits-report.mts`)

Gemeten op een productiewereld (200 duiven, 16 hokken, 250 trades, 40 meldingen/speler):

| Verzoek | queries | rijen gelezen | rijen geschreven |
|---|---|---|---|
| Poll, niets te doen | 15 | **349** | 1 |
| Poll tijdens live vlucht | 15 | 350 | 1 |
| Live poll met energie-aftrek (per 30 min) | 17 | 350 | 102 |
| Vluchtafronding | 43 | 350 | 429 |
| Dagovergang 00:00 | 41 | 351 | 377 |

**Élk** verzoek leest ~290 rijen, want de middleware laadt de wereld: ~200 duiven +
40 trades (`TRADE_LOAD_LIMIT`) + tot 40 meldingen + hokken + users + vluchten.
Bij 5 M rijen/dag is dat een **plafond van ~17.000 verzoeken per dag** — véél lager dan
de 100.000 Worker-verzoeken/dag. De client pollt `/flights/:id/live` elke **60 s** en
`/flights` elke **90 s** (verruimd in ronde 5), dus één open live-bord = 60 verzoeken/uur.
Een **estafette duurt 16–19 uur**: één speler die er één volledig volgt kost ~0,33 M rijen.

> **Belangrijk:** als het leesbudget op is, faalt **ook het lichte inlogpad** (dat leest
> nog altijd één rij). Vandaar "niemand raakt er nog in" tot de reset om **middernacht
> UTC**. Het featherweight-pad spaart rijen, maar redt je niet als het budget al op is.

**Hefbomen, in volgorde van effect** (nog niet uitgevoerd):
1. `trades` niet meer in de hot path (enkel op `/market`) → −100 rijen (−29 %).
2. Meldingen enkel laden waar ze nodig zijn (`/state`, bel) → −40 rijen.
3. Live-bord **cachen** (Cache API, ~15 s): iedereen ziet hetzelfde bord, dus N pollers
   worden één DB-hit — raakt precies het zwaarste pollpatroon.
4. Pollintervallen verruimen: live 20 → 60 s, kalender 40 → 90 s (−3×).
5. `advanceRealtime` throttlen (max. 1×/20 s) zodat een poll de wereld niet meer hoeft
   te laden; dan kan `/flights/:id/live` toe met de vlucht + haar deelnemers.

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
