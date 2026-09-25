# Seizoen 3 — wat er bij de seizoenswissel in het spel komt

> **Voor Claude:** zegt de speler **"implementeer seizoen3.md"**, dan bouw je
> **elk onderdeel** hieronder dat nog niet op ✅ staat, in de volgorde van de
> onderdelen. Lees eerst `context.md` (§0 werkafspraken, §2 architectuur, §7
> verificatie) en volg die werkwijze: dev-branch → verifiëren → commit → deploy.
> Werk dit bestand bij terwijl je bouwt (status per onderdeel, afwijkingen,
> gemeten balanscijfers) en neem de blijvende uitleg op in `context.md`,
> `spelregels.md` en de wiki.
>
> Dit bestand groeit nog: nieuwe onderdelen komen onder **§ Onderdelen** als
> `## N. …` met dezelfde opbouw (idee → regels → technisch → tests → klaar als).

---

## Algemeen

- **Wanneer:** alles gaat aan **bij de start van seizoen 3** (de eerste
  seizoenswissel na de uitrol). De code mag vooraf live staan; wat het spel
  verandert, wacht op de wissel (zie *Activering* per onderdeel).
- **Controleer eerst het seizoensnummer.** Lees `world.seasonYear` uit (admin of
  een snelle query) en zet de poort op het seizoen dat na de uitrol begint. Heet
  dat seizoen niet 3, pas dan de naam van de poort aan en noteer het hier.
- **Productie:** de speler zegt zelf wanneer seizoen 3 naar productie mag. Bouw en
  commit op de dev-branch; cherry-pick naar prod **pas na zijn uitdrukkelijk
  akkoord** (dit wijkt bewust af van de gewone "deploy meteen"-afspraak).
- **Taal:** alles wat de speler ziet in het Nederlands/Vlaams, code en commentaar
  in het Engels (zie `context.md`).
- **Tekstbudget (context.md §0.4):** schermen tonen enkel wat de beslissing
  stuurt; uitleg en getallen gaan in `WikiPage.tsx`, met een link
  "Meer info over … →".

## Status

| # | Onderdeel | Status |
|---|---|---|
| 1 | Kenmerken per duif | ⬜ uitgewerkt, nog niet gebouwd |
| 2 | Sponsorlimiet (tier 4 −75 % per dag, max. 6 sponsors) | ⬜ uitgewerkt, nog niet gebouwd |
| 3 | Coach volgens de algemene score + trainen altijd +1 | ⬜ uitgewerkt, nog niet gebouwd |
| 4 | Gezondheidsverbruik na een vlucht ×1,15 | ⬜ uitgewerkt, nog niet gebouwd |
| 6 | Prijsuitreiking: nieuwe Roekoe-bedragen + seizoenspremie voor iedereen met punten | ⬜ uitgewerkt, nog niet gebouwd |
| 5 | Communicatie naar alle spelers bij de start | ⬜ uitgewerkt, nog niet gebouwd — **bouw als laatste** |

---

# Onderdelen

## 1. Kenmerken per duif

Afkomstig van De Stem: *"✨ Unieke eigenschappen per duif"* (`core/game/stem.ts`).
Zet dat idee na de uitrol op status **`uitgevoerd`** ("In het spel").

### 1.1 Het idee
Sommige duiven krijgen bij hun geboorte één vast **kenmerk**: een eigenschap die
enkel in **bepaalde omstandigheden** meetelt. Zo wordt een duif herkenbaar, en
krijgt de keuze wie je inschrijft er een laag bij: *vandaag is het haar vlucht*.

### 1.2 Ontwerpregels (niet van afwijken zonder de speler te vragen)
1. **Enkel voordelen.** Geen enkel kenmerk heeft een nadeel.
2. **Een kenmerk is een vluchtfactor, geen stat-wijziging.** Het raakt nooit de
   opgeslagen snelheid/conditie/oriëntatie (dus niet de gen-plafonds, de
   `attrLog`, de vooruitgangsranglijst of de talentscore). Het werkt zoals de
   bestaande inteelt-`quirk` in `pigeonVelocity`: een factor tijdens de vlucht.
3. **Geen kalendermaanden.** Een seizoen duurt 28 echte dagen; voorwaarden hangen
   af van weer, temperatuur, zon, afstand en het veld — nooit van de maand.
4. **Geen formatievliegen.** Er komt **geen** optie om duiven samen te laten
   vliegen (begeleider, partner, "vlieg bij …"). Wie in elkaars buurt vliegt,
   volgt enkel uit de simulatie.
5. **Situatiebonus = +5 % snelheid**, en enkel zolang de voorwaarde geldt.

### 1.3 De 15 kenmerken

| id | | Naam | Voorwaarde | Effect | Soort |
|---|---|---|---|---|---|
| `tailwind` | 🌬️ | **Snelle flapper** | rugwind bij de lossing | +5 % snelheid | gewoon |
| `headwind` | 🪨 | **Stormbreker** | tegenwind bij de lossing | +5 % snelheid | gewoon |
| `rain` | 🌧️ | **Regenvogel** | regen bij de lossing | +5 % snelheid | gewoon |
| `fair` | ☀️ | **Mooiweervlieger** | kalm weer én geen regen bij de lossing | +5 % snelheid | gewoon |
| `night` | 🌙 | **Nachtvlieger** | *dynamisch:* zolang het donker is waar ze vliegt | +5 % snelheid | gewoon |
| `sprint` | ⚡ | **Sprinter** | afstand ≤ 200 km | +5 % snelheid | gewoon |
| `fond` | 🏔️ | **Fondvogel** | afstand ≥ 600 km | +5 % snelheid | gewoon |
| `social` | 🐦 | **Sociale duif** | *dynamisch:* ≥ 2 andere vliegende duiven binnen 10 km | +5 % snelheid | gewoon |
| `loner` | 🦅 | **Eenzaat** | *dynamisch:* geen enkele andere vliegende duif binnen 10 km | +5 % snelheid | gewoon |
| `cold` | ❄️ | **Koudevlieger** | temperatuur op de losplaats < 10 °C | +5 % snelheid | zeldzaam |
| `warm` | 🔥 | **Zomervogel** | temperatuur op de losplaats ≥ 10 °C | +5 % snelheid | zeldzaam |
| `day` | 🌞 | **Dagvlieger** | *dynamisch:* zolang het licht is waar ze vliegt | +5 % snelheid | zeldzaam |
| `homing` | 🧭 | **Thuisvinder** | altijd | verdwaalt 25 % minder | zeldzaam |
| `frugal` | 🔋 | **Zuinige vlieger** | altijd | 8 % minder energieverbruik per vlucht | zeldzaam |
| `sturdy` | 🛡️ | **IJzeren gestel** | altijd | 30 % minder kans op ziekte | zeldzaam |

Namen, emoji en een korte speler-uitleg (één zin, Vlaams, mag grappig zijn zoals
`PIGEON_QUIRKS`) staan in de config. De ids hierboven zijn een voorstel; ze
worden in de DB bewaard, dus kies ze één keer en verander ze daarna niet meer.

**Bewust weggelaten** (niet opnieuw voorstellen): Vroege vogel, Avondvlieger
(vaste losuren), Schemervlieger, Ploegduif, Titanentemmer, en elk kenmerk met een
nadeel of op kalendermaanden.

#### Precieze voorwaarden
- **Wind** — gebruik de langs-de-route-component `along` (km/u, + = rugwind) die
  `weather.ts` al berekent, dezelfde drempels als het weerlabel:
  - rugwind: `along > 6`
  - tegenwind: `along < −6`
  - kalm: `|along| ≤ 6`
- **Regen:** neerslag > 0,2 mm (zelfde drempel als het label ", regen").
- **Mooiweervlieger:** kalm **en** geen regen.
- **Temperatuur:** `temperature_2m` op de losplaats bij de lossing; grens 10 °C
  (< 10 = koud, ≥ 10 = warm).
- **Afstand:** `flight.distanceKm`; bij de estafette de lengte van **haar eigen
  etappe**. Een omweg door verdwalen telt niet mee voor de drempel.
- **Licht/donker:** de zon staat boven de horizon (hoogte > −0,833°, de gewone
  definitie van zonsopgang/-ondergang) **op de plek waar de duif op dat moment
  vliegt**.
- **Sociale duif / Eenzaat:** afstand tot de andere duiven die **op dat moment
  vliegen** (niet thuis, niet opgegeven, niet uitgevallen), **eigen duiven
  inbegrepen**. Bij de estafette tellen alle duiven die op dat moment vliegen,
  ook op een andere etappe.
- **Alle vluchtsoorten** tellen: wedstrijd, criterium, titan, estafette en
  oefenvlucht.

### 1.4 Wie krijgt een kenmerk

- **Kans:** **30 %** van elke nieuwe duif krijgt een kenmerk; **hoogstens één**,
  **voor het leven** (ook bij verkoop, bij veroudering, enz.).
- **Verdeling binnen die 30 %:** **80 % gewoon** (9 kenmerken, elk even
  waarschijnlijk: ~8,9 %) en **20 % zeldzaam** (6 kenmerken: ~3,3 % elk).
- **Waar:** overal waar nu een ras wordt geloot (`rollBreed` in `pigeon.ts`, via
  de standaardwaarde in de duif-fabriek rond `pigeon.ts:315`, en de migratie in
  `schedule.ts:~1422`): markt, veiling, opvangcentrum, gebeurtenissen, bots.
  Zoek bij de bouw alle aanmaakplekken op; niet één mag het vergeten.
- **Kweek (`breed()` in `breeding.ts`):**
  - elke ouder mét een kenmerk geeft het door met **35 %** kans;
  - hebben **beide** ouders **hetzelfde** kenmerk: **60 %**;
  - hebben ze **elk een ander** kenmerk: eerst 35 % voor dat van de vader, anders
    35 % voor dat van de moeder;
  - komt er niets door: de gewone worp van 30 %.
  - Volg het randomness-patroon dat `breed()` nu gebruikt (zie de opmerking daar
    en `context.md` §8 *Openstaande ideeën* over de rauwe `Math.random()`).
- **Los van het inteeltmerkteken** (`quirk`): een duif kan beide hebben.
- **Bots** krijgen kenmerken met exact dezelfde regels.

### 1.5 Zichtbaarheid en waarde
- **Openbaar**, meteen, voor iedereen (zoals ras en `quirk` in `pigeonDTO`): een
  koper moet zien wat hij koopt.
- **Marktwaarde:** gewoon **+5 %**, zeldzaam **+12 %**, in `estimateValue`
  (market.ts/pigeon.ts). De marktcurve schaalt dat vanzelf mee (`valuePigeon`).

### 1.6 Hoe het in de vlucht werkt

**Alles wordt bij de lossing berekend en in de `sim` bevroren**, zoals de rest van
het pace-profiel. Live bord, verslag en uitslag lezen enkel die bevroren waarden
(`context.md` §2: *live-einde == einduitslag*).

**Statische voorwaarden** (wind, regen, mooi weer, temperatuur, afstand): de
factor 1,05 op de basissnelheid van de duif. Plaats: een `traitFactor(pigeon,
ctx)` naast `quirkFactor` in `pigeonVelocity` (`flight.ts`), met een context
(afstand, `along`, regen, temperatuur). Houd de preview-tool die `pigeonVelocity`
spiegelt (`flight.ts:~175`) in sync.

**Dynamische voorwaarden** (nacht, dag, sociaal, eenzaat): per stuk van de route.
- Het pace-profiel heeft `FLIGHT_DYNAMICS.segments` = 10 stukken (`segMult[]`).
- Zet de bonus op `segMult[i]` in `buildPaceProfile`, **na** de normalisatie
  (`Σ 1/m = N`) — net als de `SUSTAIN`-pass, want dit moet de finishtijd **wel**
  veranderen. Doe het vóór de verdwaal-omwegen, zodat die onafhankelijk blijven.
- Valt een overgang (zonsondergang, een buur die wegvalt) midden in een stuk,
  dan krijgt dat stuk de bonus naar rato van het deel waarin de voorwaarde gold.
- Loop de stukken in volgorde af, zodat het klokuur van elk stuk vastligt
  (voorwaartse pass, geen kringloop).
- Herbereken daarna `durationSeconds` zoals de bestaande code dat doet.

**Zon (Nachtvlieger/Dagvlieger):**
- Bereken de zonshoogte **zelf** (NOAA/zonsopgangsformule: declinatie,
  tijdsvereffening, uurhoek) — geen API, geen netwerk, deterministisch. Werk in
  UTC; de weergave in Brussel-tijd.
- Positie van de duif = punt op de grootcirkel van losplaats naar aankomst, op
  het deel van de route dat ze op dat moment afgelegd heeft. Coördinaten:
  `CITY_COORDS`; bij de estafette de coördinaten van haar etappe (`Flight.legs`).
  De client heeft al grootcirkelcode in `client/src/components/geo.ts`; de
  server heeft ze nodig in `core/` (niet importeren uit de client).
- Donker = zonshoogte ≤ −0,833°; licht = daarboven.

**Sociale duif / Eenzaat (buren binnen 10 km):**
- Na het bouwen van **alle** profielen van de vlucht (in `startLiveFlight` en
  `startLiveRelay`): loop de vlucht af in stappen van **5 minuten** en bepaal per
  stap de positie van elke vliegende duif met `raceProgress` (dezelfde functie als
  het live bord).
- Afstand tussen twee duiven = verschil in afgelegde afstand langs de route (ze
  vliegen dezelfde lijn; bij de estafette: positie op de hele route).
- **Tellen zonder de sociaal/eenzaat-bonus zelf:** de buren worden bepaald op de
  profielen **vóór** deze twee bonussen. Daarna krijgen enkel de duiven met die
  kenmerken hun bonus op de stukken waar de voorwaarde gold. Dat voorkomt een
  kringloop; de fout is hooguit enkele honderden meters. Zo afgesproken.
- **CPU:** sorteer per stap de posities en tel met een schuivend venster (niet
  paarsgewijs). Zit er geen enkele Sociale duif of Eenzaat in het veld, sla de
  hele berekening over. Moet binnen `cpu-budget.test.mts` blijven (10 ms, koud)
  voor een veld van ~180 duiven op 1200 km.

**Niet-snelheidskenmerken:**
- **Thuisvinder:** het verwachte aantal verdwaal-episodes (`expected` in de
  LOST-blok van `buildPaceProfile`) × **0,75**.
- **Zuinige vlieger:** de routekost × **0,92** in `routeEnergyCost` (flight.ts).
  Dat raakt zo ook `expectedFlightEnergyCost` (bots).
- **IJzeren gestel:** de dagelijkse kans op ziekte × **0,70** in `health.ts`
  (`runHealthDay`: besmetting én spontaan; ook de oude `runHealthWeek`). Niet op
  blessures door een vlucht.

**Bevriezen in de sim** (`SimEntry` in `schema.ts`, rijdt mee in de `sim`-JSON,
geen migratie):
- `trait?: string` — het kenmerk op het moment van de lossing;
- `traitWindows?: [fromSeconds, toSeconds][]` — wanneer de bonus actief was (voor
  statische kenmerken: de hele vlucht).
Daarmee tonen live bord, verslag en uitslag het zonder herberekening.

**Weddenschappen (`betting.ts`):** de kansen roepen `pigeonVelocity` aan vóór de
lossing, zonder weer. Neem de **afstandskenmerken** (zeker) volledig mee. Voor
weer-, temperatuur- en dynamische kenmerken: een vaste verwachte factor uit de
config (`1 + 0,05 · verwachtAandeel`), zodat de bookmaker niet systematisch te
verslaan is. `betting-odds.test.mts` moet groen blijven.

### 1.7 Weer uitbreiden (`core/game/weather.ts`)
- `WeatherResult` krijgt: `along: number` (km/u), `rain: boolean`, `tempC: number`.
- `fetchFlightWeather`: voeg `temperature_2m` toe aan `current=` (zelfde oproep).
- `fetchLegForecast` (estafette): voeg `temperature_2m` toe aan `hourly=`.
- **Terugvalweer** (geen netwerk): de `FALLBACK`-lijst krijgt `along`/`rain`, en
  een **gemiddelde temperatuur per maand voor België** (ongeveer: jan 3, feb 4,
  mrt 7, apr 10, mei 14, jun 17, jul 19, aug 18, sep 15, okt 11, nov 7, dec 4 °C)
  ± 3 °C willekeurig.
- **Bewaren op de vlucht** zodat uitslag en verslag het later nog weten:
  `Flight.weatherAlong`, `Flight.weatherRain`, `Flight.tempC` (nieuwe kolommen
  via `ensureSchema` + `migrations/0001_init.sql`), en dezelfde velden per etappe
  in `Flight.legs` (JSON).
- Het weerlabel toont voortaan de temperatuur: *"Rugwind 14 km/u, 7 °C (echt weer)"*.

### 1.8 Datamodel en persistentie
- `Pigeon.trait?: string | null` — kolom **`trait TEXT`**:
  - `ensureSchema` in `core/d1.ts`: `ALTER TABLE pigeons ADD COLUMN trait TEXT`;
  - `migrations/0001_init.sql`;
  - `PIGEON_COLUMNS` / de kolomlijst van de load en de rij-mapping (zoek hoe
    `quirk` het doet, `d1.ts:~185/372/413`).
- **Geen nieuwe tabel, geen extra query per verzoek.** `query-budget`,
  `idle-writes`, `poll-budget` en `daily-budget` moeten groen blijven.

### 1.9 Config (`core/config/gameConfig.ts`)
Alle getallen hier, niets hardcoded in de engine:
```
PIGEON_TRAITS = [ { id, name, emoji, description, rarity: 'gewoon'|'zeldzaam',
                    kind: 'static'|'dynamic'|'passive', oddsShare? }, … ]
TRAITS = {
  chance: 0.30,            // kans op een kenmerk bij het ontstaan
  rareShare: 0.20,         // aandeel zeldzaam binnen de kenmerken
  inheritChance: 0.35,     // per ouder
  inheritBothSame: 0.60,   // beide ouders hetzelfde kenmerk
  speedBonus: 1.05,        // situatiebonus
  windThreshold: 6,        // km/u langs de route (zelfde als het weerlabel)
  rainThresholdMm: 0.2,
  coldBelowC: 10,
  sunAltitudeDeg: -0.833,
  neighbourKm: 10,
  socialMinNeighbours: 2,
  proximityStepMinutes: 5,
  homingLostMult: 0.75,
  frugalEnergyMult: 0.92,
  sturdyIllnessMult: 0.70,
  valueMult: { gewoon: 1.05, zeldzaam: 1.12 },
}
```
Plus `traitById(id)` naast `quirkById`.

### 1.10 Activering: migratie v53
- `runDataMigrations` in `schedule.ts`: `dataVersion` staat op **52** → nieuw
  blok **v53**.
- **Wacht op het nieuwe seizoen:** het blok doet niets zolang
  `world.seasonYear` < het startnummer van seizoen 3 (zie *Algemeen*). Pas bij de
  eerste request na de prijsuitreiking loopt het, en dan zet het
  `dataVersion = 53`. Zo kan de code vooraf live.
- Het blok lot een kenmerk voor **elke bestaande duif zonder kenmerk** (spelers
  én bots), **geseed** op `'trait:' + pigeon.id` (dubbele verwerking = zelfde
  uitkomst, `context.md` §2).
- **Nieuwe duiven vóór de wissel:** krijgen nog **geen** kenmerk (anders lekt de
  feature vóór het seizoen). Laat `rollTrait` pas werken als de poort open is, of
  laat v53 ze gewoon meenemen — kies één aanpak en noteer ze hier.
- **Geen aparte melding hier:** het aantal duiven met een kenmerk komt in de
  gezamenlijke welkomstmelding van **§5**.
- Kost: één keer ~alle duivenrijen schrijven — ruim binnen het dagbudget.

### 1.11 Wat de speler ziet (client)
- **Duifkaart / duifpagina** (`PigeonCard`, duifdetail): een label
  `🌬️ Snelle flapper`; klik → één zin uitleg + "Meer info over kenmerken →"
  (`/wiki#kenmerken`). Zeldzaam krijgt een subtiele accentkleur.
- **Markt / veiling:** het label staat ook op andermans duiven.
- **Inschrijven voor een vlucht:** bij een eigen duif met een kenmerk:
  - zeker van toepassing (afstand) → **"✨ in haar element"**;
  - hangt af van het weer/temperatuur → **"✨ als de wind meezit"**, **"✨ bij
    regen"**, **"✨ onder 10 °C"**, …;
  - dynamisch → **"✨ in het donker"** / **"✨ bij daglicht"** / **"✨ in een
    groep"** / **"✨ als ze alleen vliegt"**.
  - Toon op de vluchtkaart ook **zonsopgang en -ondergang** van die dag
    (Brussel-tijd), zodat je kan inschatten wie in het donker thuiskomt.
- **Live bord:** een ✨ (of het kenmerk-emoji) bij de duif **zolang** haar bonus
  actief is (uit `traitWindows`).
- **Live verslag** (`flightCommentary` + `gameConfig.COMMENTARY`): een regel op het
  moment dat een kenmerk aanslaat, per kenmerk een eigen tekstpool, bv.:
  - *"De zon zakt boven Reims — Nachtvlieger {name} zet aan."*
  - *"{name} laat het peloton achter zich; de Eenzaat vliegt nu op haar best."*
  - *"Snelle flapper {name} zet de rugwind om in meters."*
  Deterministisch (vast tijdstip, gefilterd op `elapsed`) en met de bestaande
  demping; `commentary.test.mts` moet groen blijven.
- **Uitslag:** een ✨ achter de duif als haar kenmerk meetelde (met het aandeel
  van de vlucht bij een dynamisch kenmerk, bv. "🌙 38 %").
- **Wiki** (`WikiPage.tsx`): nieuwe sectie **`kenmerken`** met de volledige tabel,
  de kans (30 %), gewoon/zeldzaam, de overerving, en hoe de dynamische werken.
  Getallen staan **enkel hier** (niet op de schermen).
- **Stamboom** (`pedigree.ts` / `FamilyMember`): het kenmerk meesturen zoals `quirk`,
  zodat je een lijn op een kenmerk kan kweken.
- **Prestaties (optioneel, als er tijd is):** een verzamelbadge
  "Kenmerkenverzamelaar" (5 verschillende kenmerken tegelijk in je hok).

### 1.12 Balans — wat de test moet aantonen
Nieuw: **`tests/traits.test.mts`** (draai vanuit de repo-root, zie `context.md` §7):
- **Verdeling:** over 10.000 worpen ~30 % met kenmerk, ~80/20 gewoon/zeldzaam.
- **Overerving:** 35 % / 60 % kloppen binnen een marge.
- **Migratie v53:** doet niets vóór de poort, loot daarna geseed (twee runs =
  identiek), raakt duiven met een kenmerk niet, stuurt precies één melding per
  speler.
- **Statische bonus:** enkel actief als de voorwaarde geldt (bv. Sprinter op
  150 km wel, op 250 km niet).
- **Zon:** een vlucht die vóór zonsondergang vertrekt en erna eindigt geeft een
  Nachtvlieger een bonus **enkel** op het donkere deel; controleer met bekende
  zonsondergangen (bv. Brussel 21 dec ≈ 16:40, 21 jun ≈ 22:00).
- **Buren:** een duif in een dicht peloton krijgt de sociale bonus, een
  weggelopen kopduif de eenzaat-bonus; duiven die thuis zijn tellen niet mee;
  eigen duiven tellen wel mee.
- **Tweeling-duel:** in haar eigen situatie wint een duif met kenmerk ~70–75 %
  van de duels tegen een identieke duif zonder. Buiten haar situatie: ~50 %.
- **Seizoen:** een hok met kenmerken verdient over een gesimuleerd seizoen
  hoogstens ~7 % meer dan hetzelfde hok zonder.
- **Blijft groen:** `upset-balance`, `attribute-balance`, `velocity-model`,
  `betting-odds`, `commentary`, `live-speed`, `flight-map`, `flock`,
  `cpu-budget` (apart gedraaid), `query-budget`, `idle-writes`, `poll-budget`,
  `daily-budget`, `d1-partial-load`.

Zijn de balansdoelen niet haalbaar met +5 %, **vraag de speler** voor je
`speedBonus` aanpast (+5 % is een bewuste keuze van de speler).

### 1.13 Documentatie
- **`spelregels.md`:** nieuwe sectie **§7ter Kenmerken** (tabel, kans,
  overerving, dynamische werking, zonsopgang/-ondergang), en een verwijzing in
  §2.5 (weer: temperatuur erbij), §3 (Zuinige vlieger), §5.2 (IJzeren gestel).
- **`context.md`:** datamodel (§4: `Pigeon.trait`, `Flight.tempC`/`weatherAlong`/
  `weatherRain`, `SimEntry.trait`/`traitWindows`), config (§5: `TRAITS`), de v53-
  migratie (§2 `dataVersion` → 53), en de valstrikken (bevriezen in de sim,
  buren tellen vóór de bonus, geen kenmerk vóór de poort).
- **De Stem:** het idee op **`uitgevoerd`** zetten.

### 1.14 Klaar als
- [ ] Alle 15 kenmerken werken volgens §1.3 en zijn geconfigureerd in `gameConfig.ts`.
- [ ] Nieuwe duiven, kweek en bots krijgen kenmerken volgens §1.4.
- [ ] v53 loopt pas bij seizoen 3 en is geseed.
- [ ] Het weer bevat `along`/`rain`/`tempC`, ook in het terugvalweer en per etappe.
- [ ] Zon en buren zijn dynamisch, bevroren in de sim, en zichtbaar op het live bord en in het verslag.
- [ ] Duifkaart, markt, inschrijven, live bord, uitslag, stamboom en wiki tonen het kenmerk.
- [ ] `tests/traits.test.mts` bestaat en alle tests uit §1.12 zijn groen.
- [ ] `spelregels.md`, `context.md` en de wiki zijn bijgewerkt.
- [ ] Gecommit op de dev-branch en gedeployed naar productie vóór de seizoenswissel.

---

## 2. Sponsorlimiet

### 2.1 Het probleem
Sommige spelers krijgen **meer dan €1.200 per dag** van sponsors. Er zijn 17
sponsors in 13 categorieën (één per categorie), dus nu tot 13 contracten tegelijk:
met de beste sponsor per categorie is dat ~€1.220/dag, en een heraanbod kan
×0,7–1,5 van het basisbedrag zijn (`SPONSOR_REOFFER_MULT_*`), dus nog meer.

### 2.2 De regels
1. **Tier 4: het dagbedrag daalt met 75 %.** Enkel het **dagbedrag**
   (`dailyStipend`). Het **tekengeld** en de **podiumpremie** blijven ongewijzigd.
   | Sponsor | Nu | Nieuw |
   |---|---|---|
   | 📡 Telecom Vleugelnet | €165 | **€40** |
   | 🎰 Nationale Loterij — De Gouden Ring | €150 | **€40** |
   | 🏆 Formule Duif Racing | €200 | **€50** |
   - Geldt voor **nieuwe aanbiedingen**, **heraanbiedingen** (ook na de ×0,7–1,5)
     én **bestaande contracten** en **openstaande aanbiedingen** (eenmalig bij de
     seizoenswissel, zie §2.4). Afronden op €5, zoals `round5` in `sponsors.ts`.
   - "Tier 4 en hoger": er is nu enkel tier 4. Komt er ooit een tier 5, dan valt
     die er automatisch onder (regel op `tier >= 4`, niet op de drie ids).
2. **Maximaal 6 sponsors tegelijk** per speler (`active.length ≤ 6`).
3. **Een zevende aanbod** mag gewoon binnenkomen, maar tekenen kan enkel als de
   speler **in dezelfde handeling** een van zijn huidige sponsors opzegt.
   - Opzeggen kost dan de **gewone verbrekingsvergoeding** (`breakPenalty`), want
     het is een eigen keuze. *(Bevestigd door de speler.)*
   - Komt het aanbod van een **concurrent in dezelfde categorie**, dan blijft het
     gewone overstappen gelden (de oude sponsor vervalt, het aantal blijft gelijk);
     er hoeft dan niets extra opgezegd te worden.
   - Dit geldt ook voor het **startersaanbod** van nieuwe spelers (§18), al zal
     een nieuwe speler zelden aan 6 zitten.
4. **Meer dan 6 bij de seizoenswissel → verplicht afbouwen.**
   - Wie bij de start van seizoen 3 meer dan 6 sponsors heeft, moet er zelf
     zoveel **opzeggen** tot hij er 6 heeft. Die opzeggingen zijn **gratis**
     (geen verbrekingsvergoeding).
   - **Zolang hij niet gekozen heeft, betaalt geen enkele sponsor iets uit**:
     geen dagbedrag én geen podiumpremie, van **alle** sponsors. Wat hij in die
     periode misloopt, wordt **niet** nabetaald.
   - Hij krijgt een melding (stabiele id `ntf:season3:sponsorcap:<userId>`) en op
     de sponsorpagina een verplichte keuze; bovenaan het spel een rode balk tot het
     opgelost is. De rest van het spel blijft speelbaar.
   - Een sponsor die zo gratis opgezegd wordt, gaat in `declined` zoals een gewone
     opzegging (mag later opnieuw aankloppen, zonder nieuw tekengeld), maar
     **niet** als definitieve weigering.
5. **"Nee is nee" en de hogere tier.** De regel dat een geweigerde concurrent die
   per dag niet meer betaalt **nooit meer** terugkomt (`refusalIsFinal` in
   `sponsors.ts`), geldt **niet** als het aanbod uit een **hogere tier** komt dan
   de huidige sponsor in die categorie. Anders zou bv. Formule Duif Racing (tier 4,
   nu €50/dag) voorgoed wegblijven bij wie Racing Team Snelle Vleugel (tier 3,
   €135/dag) heeft. *(Bevestigd door de speler.)*

### 2.3 Technisch
- **Config (`gameConfig.ts`):**
  - `SPONSOR_MAX_ACTIVE = 6`;
  - `SPONSOR_HIGH_TIER = 4` en `SPONSOR_HIGH_TIER_DAILY_MULT = 0.25`;
  - pas de catalogus **niet** met de hand aan: de 75 % wordt toegepast via die
    constante, zodat heraanbiedingen, `legacyDaily` en de weergave dezelfde regel
    volgen. Eén helper `effectiveDailyStipend(def, raw)` in `sponsors.ts`, gebruikt
    door `catalogTerms`, `scaledTerms` en `legacyDaily`.
- **Aanvaarden (`applyAcceptSponsor`):** met 6 actieve contracten en geen
  concurrent in dezelfde categorie → vereist een `dropSponsorId`; zonder →
  foutmelding `!Je hebt al 6 sponsors. Kies eerst welke je opzegt.` Met → dat
  contract opzeggen (vergoeding volgens §2.2 punt 3), dan tekenen. Nooit meer dan
  6 na afloop (ook niet bij twee gelijktijdige verzoeken: controleer het aantal
  opnieuw vlak voor het toevoegen).
- **Endpoint** (`functions/api/[[path]].ts`): het accept-endpoint neemt een
  optionele `dropSponsorId`. Nieuw endpoint voor de verplichte afbouw, bv.
  `POST /api/sponsors/reduce` met de ids om gratis op te zeggen; weigert als het
  resultaat nog boven 6 zit of als er geen afbouw openstaat.
- **Afbouw-toestand:** een vlag op de sponsorstate, bv.
  `SponsorState.mustReduce?: boolean` (rijdt mee in de bestaande `sponsorship`-
  JSON van de loft, geen migratie van het schema). Gezet door de migratie (§2.4),
  gewist zodra `active.length ≤ 6`.
- **Uitbetalen blokkeren zolang `mustReduce`:**
  - dagbedrag: `schedule.ts:~2743` (`stipend = activeContracts(...)`) → 0;
  - podiumpremie: `schedule.ts:~996` (`sponsorPodiumBonus`) → overslaan;
  - de **Dagbalans** (`economy.ts:~395`) toont de sponsors dan met €0 en de reden.
- **"Nee is nee":** `refusalIsFinal` → `false` als `def.tier > rival.tier`.
- **Bots:** hebben geen sponsors; niets te doen. Controleer het wel.
- **Badges:** "Goed Omringd" (3 tegelijk) en "Sponsorimperium" (4 categorieën)
  blijven haalbaar onder 6; niets te doen.

### 2.4 Activering: migratie v54
- Zelfde poort als v53: niets vóór de start van seizoen 3.
- Zet voor elke loft:
  - elk **actief tier-4-contract** en elk **openstaand tier-4-aanbod**:
    `dailyStipend = round5(dailyStipend × 0,25)`;
  - `mustReduce = true` als `active.length > 6`, en stuur de melding.
- Idempotent via `dataVersion` (één keer), en de afronding mag nooit twee keer
  toegepast worden.
- Volgorde: v53 (kenmerken) en v54 (sponsors) mogen in hetzelfde verzoek lopen.

### 2.5 Wat de speler ziet
- **Sponsorpagina:**
  - teller **"Sponsors: 5 / 6"**;
  - bij 6/6 op een aanbod: de knop **"Tekenen"** opent een keuze *"Wie laat je
    gaan?"* met per huidige sponsor zijn verbrekingsvergoeding;
  - bij een verplichte afbouw: bovenaan een rood blok *"Je hebt X sponsors, het
    maximum is 6. Kies er Y om op te zeggen — gratis. Tot dan betaalt geen enkele
    sponsor uit."* met aanvinkvakjes en één bevestigknop.
- **Overal in het spel:** zolang `mustReduce`, een rode balk met link naar de
  sponsorpagina.
- **Wiki:** de limiet van 6, de −75 % op tier 4 (met de nieuwe bedragen), en de
  afbouwregel. Getallen enkel in de wiki.

### 2.6 Tests
Nieuw: **`tests/sponsor-cap.test.mts`**:
- tier-4-dagbedragen worden ×0,25 bij nieuw aanbod, heraanbod (×0,7–1,5) en in de
  migratie (bestaand contract + openstaand aanbod); tekengeld en podiumpremie niet;
- v54 doet niets vóór de poort, loopt precies één keer;
- een zevende tekenen zonder `dropSponsorId` faalt, met lukt en kost de
  verbrekingsvergoeding; een concurrent in dezelfde categorie gaat zonder;
- nooit meer dan 6 actief, ook niet na twee gelijktijdige accepts;
- met `mustReduce`: dagbedrag én podiumpremie 0, geen nabetaling na het afbouwen;
  afbouwen is gratis en wist de vlag; afbouwen tot boven 6 wordt geweigerd;
- `refusalIsFinal` is `false` voor een aanbod uit een hogere tier.
- **Blijft groen:** `sponsor-refusal.test.mts`, `newcomer.test.mts`,
  `idle-writes`, `query-budget`, `daily-budget`.

### 2.7 Beslissingen van de speler
- ✅ Opzeggen om een **zevende** sponsor te tekenen kost de gewone
  verbrekingsvergoeding.
- ✅ Een sponsor uit een **hogere tier** mag na een weigering terugkomen, ook als
  hij per dag minder betaalt dan de huidige sponsor in die categorie.

### 2.8 Documentatie
- **`spelregels.md` §12 Sponsors:** de limiet van 6, de −75 % voor tier 4 (en de
  nieuwe "orde van grootte": tier 4 €40–50/dag), de afbouwregel, en de
  aangepaste "nee is nee"-regel.
- **`context.md`:** `SPONSOR_MAX_ACTIVE`, `SPONSOR_HIGH_TIER_DAILY_MULT`,
  `SponsorState.mustReduce`, migratie v54.

### 2.9 Klaar als
- [ ] Tier-4-dagbedragen zijn ×0,25 voor nieuw, heraanbod, bestaand en openstaand.
- [ ] Nooit meer dan 6 actieve sponsors; een zevende tekenen vraagt een opzegging.
- [ ] Verplichte, gratis afbouw bij de seizoenswissel; tot dan betaalt geen sponsor.
- [ ] `tests/sponsor-cap.test.mts` en de bestaande tests zijn groen.
- [ ] Spelregels, wiki en `context.md` zijn bijgewerkt.

---

## 3. Coachprijs volgens de algemene score, en trainen altijd +1

### 3.1 Het probleem
Een privécoach kost nu voor elke duif **€80 per dag**. Voor een zwakke of
middelmatige duif is dat goed, maar een topduif haalt voor diezelfde €80 veel
meer waarde (en hoe beter haar genen, hoe sneller ze groeit). Daarnaast geeft
handmatig trainen nu een willekeurige **+0,84 tot +1,56** (gemiddeld +1,2), terwijl
de spelregels "~+1" zeggen.

### 3.2 De regels
1. **Het dagsalaris van een coach hangt af van de algemene score** van de duif
   (`talent` = gemiddelde van snelheid, conditie en oriëntatie, `pigeon.ts`):

   | Algemene score | Coach per dag |
   |---|---|
   | lager dan 65 | **€80** |
   | 65 tot 70 | **€100** |
   | 70 tot 75 | **€140** |
   | 75 tot 80 | **€180** |
   | 80 tot 85 | **€220** |
   | 85 tot 90 | **€300** |
   | 90 en hoger | **€400** |

   - Grenzen: de ondergrens hoort bij de hogere schijf (score 65,0 → €100; 64,9 →
     €80). De score heeft één decimaal.
   - **Elke dag opnieuw bepaald** bij de dagafrekening, op de score van dat moment.
     Stijgt een duif over een grens, dan betaalt ze vanaf de volgende afrekening het
     hogere tarief (en omgekeerd bij veroudering).
   - Verder verandert er **niets** aan de coach: hij traint nog altijd alle drie de
     vaardigheden richting de gen-cap, met dezelfde winst per dag
     (`coachDailyGain`), en is nog altijd het enige wat boven 90 gaat.
   - **Bewust niet gekozen** (niet opnieuw voorstellen): betalen per opgeleverd
     punt, een percentage van de marktwaarde, of een coach die per punt bijna even
     duur is als handmatig trainen. De speler koos deze vaste schijven, wetende dat
     de coach per punt tot score 85 nog altijd 3 à 7× goedkoper is dan handmatig.
2. **Handmatig trainen geeft altijd precies +1** aan de gekozen vaardigheid (geen
   willekeur meer), nog steeds afgekapt op het handmatige plafond
   (min(80, gen-cap)). Prijs, energiekost (15), ervaring (+4 × leerfactor) en de
   limiet van 1× per week per vaardigheid blijven gelijk.
   - Een punt kost dus exact de prijs van een trainingsbeurt: 60 → 61 €355,
     65 → 66 €610, 70 → 71 €1.035, 75 → 76 €1.765, 79 → 80 ~€2.700.

### 3.3 Technisch
- **Config (`gameConfig.ts`):** vervang `COACH.dailySalary: 80` door een tabel,
  bv. `COACH.salaryBands = [{ minTalent: 0, salary: 80 }, { minTalent: 65, salary:
  100 }, … { minTalent: 90, salary: 400 }]`, plus een helper
  `coachSalaryFor(talent)`. Houd `dailySalary` (80) enkel als het tarief van de
  laagste schijf, voor oude clients (`functions/api/[[path]].ts:~478` stuurt
  `coachSalary` mee — vervang door de schijven of een bedrag per duif).
  `TRAINING.attributeGain` → **1** en verwijder de `randFloat(0.7, 1.3)`.
- **Afrekening (`economy.ts:~386`):** `coaches = coachedCount × dailySalary` wordt
  een **som per gecoachte duif**: `Σ coachSalaryFor(talent(p))`. De functie krijgt
  dus de gecoachte duiven mee in plaats van enkel een aantal. Pas alle aanroepers
  aan (dagafrekening in `schedule.ts`, de dagbalans/projectie, de schuld-poort).
- **Starterspakket (`newcomer.ts`):** de gratis coach blijft **één gratis
  gecoachte duif**. Nu de tarieven verschillen: de gratis coach dekt **de duurste**
  gecoachte duif van dat hok (het gunstigste voor de nieuwe speler; zo komt er
  geen verrassing als die duif stijgt). Pas `billableCoachedCount` daarop aan en de
  afloopmelding (`newcomer.ts:~167`, die nu "€80/dag" noemt) naar het tarief van
  zijn duiven.
- **Bots (`bots.ts` `manageCoaches`):** betalen hetzelfde tarief. Controleer dat
  `BOT.coachReserve` volstaat nu een coach op een topduif €300–400 kost, zodat bots
  zich niet in het rood coachen (zie `bot-market.test.mts`).
- **Trainen (`engine.ts:~953`, en de bot-training `bots.ts:~283`):** `gain = 1`.
- **Schuld (`context.md` §5-Schuld):** in het rood worden coaches nog steeds meteen
  ontslagen; niets te doen behalve dat het vrijgekomen bedrag nu per duif verschilt.

### 3.4 Wat de speler ziet
- **Duifpagina, bij de coachknop:** het tarief van **deze** duif (bv. "€220 per
  dag"), en vanaf welke score het volgende tarief ingaat (bv. "vanaf 85: €300").
- **Mijn hok / dagbalans:** de coachkost per duif in plaats van aantal × €80.
- **Trainknop:** "+1" in plaats van "~+1".
- **Wiki:** de tabel van de schijven, en dat trainen altijd +1 geeft. Getallen
  enkel in de wiki.

### 3.5 Activering
- Pas **vanaf de start van seizoen 3**, zoals de rest. Laat de nieuwe tarieven en
  de vaste +1 pas gelden als de seizoenspoort open is (zelfde poort als v53/v54),
  of zorg dat de deploy op het moment van de wissel gebeurt — de speler zegt zelf
  wanneer het live mag.
- **Geen aparte melding hier:** de nieuwe coachkost komt in de gezamenlijke
  welkomstmelding van **§5**.
- Geen datamigratie nodig: het tarief wordt elke dag berekend.

### 3.6 Tests
Nieuw of uitgebreid (bv. `tests/coach-salary.test.mts`):
- `coachSalaryFor` op de grenzen (64,9 / 65,0 / 69,9 / 70,0 / … / 90,0 / 95);
- de dagafrekening telt per duif, ook met een mix van schijven;
- de gratis starterscoach dekt de duurste gecoachte duif;
- een duif die over een grens stijgt, betaalt vanaf de volgende afrekening meer;
- trainen geeft exact +1 en blijft onder min(80, gen-cap);
- vóór de seizoenspoort: nog €80 en de oude willekeur.
- **Blijft groen:** `newcomer.test.mts`, `debt.test.mts`, `bot-market.test.mts`,
  `idle-writes`, `daily-budget`.

### 3.7 Documentatie
- **`spelregels.md`:** §8 (trainen = altijd +1), §13 (privécoach: de schijven),
  §4.2 (vaste onkosten: coach per duif), §18 (starterspakket: gratis coach dekt de
  duurste).
- **`context.md`:** §5 (`COACH.salaryBands`, `TRAINING.attributeGain = 1`).

### 3.8 Klaar als
- [ ] De coach kost per duif volgens de schijven van §3.2, elke dag herberekend.
- [ ] Handmatig trainen geeft altijd +1.
- [ ] Starterscoach, bots en schuld werken met de nieuwe tarieven.
- [ ] Het gaat pas in bij seizoen 3, met één melding per speler met een coach.
- [ ] Tests groen; spelregels, wiki en `context.md` bijgewerkt.

---

## 4. Gezondheidsverbruik na een vlucht ×1,15

### 4.1 De regel
Het gezondheidsverlies na een vlucht gaat **×1,15** (15 % meer), net zoals het
energieverbruik eerder (dat is al live, niet in dit bestand).

```
gezondheidskost = ((0,5 + afstand/250) × (1 + (100 − energie bij aankomst)/100 × 0,8)
                   + extra bij uitval (4…9)) × 1,15
```
- Geldt voor de **volledige** kost, ook de extra −4 tot −9 van een duif die
  onderweg uitvalt (die wordt dus −4,6 tot −10,4).
- **Blijft 0:** een duif die zelf opgeeft, en een oefenvlucht.
- **Estafette:** dezelfde ×1,15 op de kost van haar eigen etappe.
- Het **herstel** per dag (voer, apart hok, rebound) verandert **niet**.

### 4.2 Voor en na (gewone vlucht, zonder uitval)

| Afstand | Aankomst met 100 energie | met 70 | met 40 | leeg (0) |
|---|---|---|---|---|
| 100 km | 0,9 → **1,0** | 1,1 → **1,3** | 1,3 → **1,5** | 1,6 → **1,9** |
| 200 km | 1,3 → **1,5** | 1,6 → **1,9** | 1,9 → **2,2** | 2,3 → **2,7** |
| 300 km | 1,7 → **2,0** | 2,1 → **2,4** | 2,5 → **2,9** | 3,1 → **3,5** |
| 500 km | 2,5 → **2,9** | 3,1 → **3,6** | 3,7 → **4,3** | 4,5 → **5,2** |
| 700 km | 3,3 → **3,8** | 4,1 → **4,7** | 4,9 → **5,6** | 5,9 → **6,8** |
| 1000 km | 4,5 → **5,2** | 5,6 → **6,4** | 6,7 → **7,7** | 8,1 → **9,3** |
| 1200 km | 5,3 → **6,1** | 6,6 → **7,6** | 7,8 → **9,0** | 9,5 → **11,0** |

### 4.3 Technisch
- **Config (`gameConfig.ts`, `HEALTH`):** nieuwe knop `flightHealthMultiplier: 1.15`
  naast `flightHealthBase`/`flightHealthPerKm`/`emptyTankFactor`, en werk het
  commentaar met de formule (`gameConfig.ts:~2015`) bij.
- **Toepassen** op de volledige `healthDelta` op beide plekken:
  - gewone vlucht: `finalizeFlight`, `flight.ts:~1208`;
  - estafette: `flight.ts:~1411`.
  Het liefst via één kleine helper (zoals `routeEnergyCost` voor de energie), zodat
  de twee niet uit elkaar kunnen lopen.
- **Activering:** vanaf de start van seizoen 3, via dezelfde seizoenspoort als de
  andere onderdelen (of de deploy op het moment van de wissel). Een vlucht die
  vóór de wissel vertrok en erna eindigt: de kost wordt bij de afronding berekend,
  dus die krijgt al ×1,15 — aanvaardbaar, niet speciaal afvangen.

### 4.4 Tests
- Een uitgevlogen duif verliest exact ×1,15 van de oude kost (gewone vlucht én
  estafette-etappe), een uitgevallen duif ook op het extra deel.
- Opgegeven en oefenvlucht: 0.
- Vóór de seizoenspoort: nog de oude kost.
- **Blijft groen:** `force-finish.test.mts` (natuurlijk uitvliegen == admin
  beëindigen), `flight-eligibility`, `upset-balance`.

### 4.5 Documentatie
- **`spelregels.md` §3** (tabel "Effect van een vlucht": de gezondheidsregel) en
  **§4.4** (formule ×1,15, en de tabel "leeg thuis" rechtzetten — die stond al te
  laag: 200 km −2,3 → nu −2,7; 1000 km −8,1 → nu −9,3).
- **`context.md` §5:** `HEALTH.flightHealthMultiplier`.
- **Wiki:** als de gezondheidskost daar met getallen staat, mee aanpassen.

### 4.6 Klaar als
- [ ] De gezondheidskost na een vlucht is ×1,15 (inclusief uitval), gewone vlucht en estafette.
- [ ] Opgeven en oefenvlucht blijven 0; herstel ongewijzigd.
- [ ] Gaat pas in bij seizoen 3.
- [ ] Tests groen; spelregels, wiki en `context.md` bijgewerkt.

---

## 5. Communicatie: iedereen mee in seizoen 3

**Bouw dit onderdeel als laatste**: het vat alle andere onderdelen samen. Komt er
later nog een onderdeel bij, werk dan ook de teksten hieronder bij.

### 5.1 Doel
Op het moment dat seizoen 3 live gaat, weet **elke** speler wat er veranderd is,
ook wie nooit de wiki opent, en ook de wijziging die al eerder live ging:
- **al live sinds eind september:** vluchten kosten ×1,15 energie, en ervaring
  spaart nog maar ±6 % energie uit (was ±25 %);
- **nieuw bij seizoen 3:** onderdeel 1 t/m 4 van dit bestand.

Het idee "Unieke eigenschappen per duif" kwam uit **De Stem**: de communicatie
zegt dat ook ("jullie stemden, hier is het").

### 5.2 Vier kanalen, in deze volgorde
Het spel heeft al twee bewezen patronen: een **belmelding via een migratie**
(zie v51 voor De Stem) en een eenmalige **"wat is er nieuw"-rondleiding** met
een eigen localStorage-sleutel (`newsKey` in `Layout.tsx`, stappen in `Tour.tsx`,
bv. `RELAY_NEWS_STEPS`). Gebruik die, niets nieuws uitvinden.

1. **Prijsuitreiking** (bestaat al, `PrizeCeremony`): toont de prijzen van seizoen 2,
   volgens de nieuwe regels van **onderdeel 6** — ook de seizoenspremie, dus nu
   krijgt bijna iedereen een prijsuitreiking te zien.
   Die komt **eerst**; de rest wacht tot ze gesloten is.
2. **Belmelding** (§5.3): bereikt iedereen, ook wie niet inlogt tot later.
3. **Rondleiding "Nieuw in seizoen 3"** (§5.4): verschijnt één keer bij de eerste
   pagina na de prijsuitreiking, met de spotlight op de plek waar het verandert.
4. **Wiki-pagina "Nieuw in seizoen 3"** (§5.5): alles op een rij, met de getallen.
   Alle andere kanalen linken hierheen (`/wiki#seizoen3`).

Plus één **actiemelding** voor wie te veel sponsors heeft (§5.3), en een kleine
**kaart op het Overzicht** (§5.6).

**Timing:** alles hangt aan dezelfde seizoenspoort als v53/v54. Vóór de wissel is
er niets van te zien, ook niet als de code al live staat. De rondleiding toont
enkel als `world.seasonYear` ≥ het startnummer van seizoen 3. De sleutel is
`roekoe.newsSeen.seizoen3.<userId>`. Een **nieuwe speler** die de volledige
welkomstrondleiding krijgt, krijgt deze niet (zelfde regel als nu in `closeTour`).

### 5.3 Belmeldingen

**Welkomstmelding** — elke speler (geen bots), één keer, stabiele id
`ntf:season3:welcome:<userId>`. Vervangt de losse meldingen die in onderdeel 1 en 3
stonden. De regels met • verschijnen enkel als ze op deze speler van toepassing
zijn.

> **🎉 Seizoen 3 is begonnen!**
> Jullie stemden in De Stem, en het winnende idee vliegt nu mee: **kenmerken**.
> Voor jou betekent seizoen 3:
> • ✨ **{n} van je duiven** kregen een kenmerk — kijk in je hok wanneer ze in hun element zijn.
> • 🎓 Je coaches kosten nu samen **€{x} per dag** (de prijs hangt af van hoe goed de duif is).
> • 🤝 Je hebt **{s} sponsors** — het maximum is nu 6.
> • ⚡ Vliegen vraagt meer: meer energie en gezondheid per vlucht, dus rust wordt belangrijker.
> Alles op een rij: **Wiki → Nieuw in seizoen 3**.

- `{n} = 0` → die regel wordt: *"✨ Geen van je duiven kreeg een kenmerk — jongen
  uit je kweek of een aankoop kunnen er wel een hebben."*
- Geen coach → coachregel weg. Geen sponsors → sponsorregel weg. Meer dan 6
  sponsors → sponsorregel weg (de actiemelding hieronder neemt het over).
- De ⚡-regel staat er altijd.

**Actiemelding** — enkel wie meer dan 6 sponsors heeft, stabiele id
`ntf:season3:sponsorcap:<userId>` (zie onderdeel 2):

> **⚠️ Kies je sponsors**
> Je hebt **{s} sponsors**, het maximum is nu 6. Kies op de sponsorpagina welke
> **{s−6}** je laat gaan — dat is **gratis**. Tot je gekozen hebt, betaalt geen
> enkele sponsor uit.

### 5.4 Rondleiding "Nieuw in seizoen 3"
Zes korte stappen, in `Tour.tsx` als `SEASON3_NEWS_STEPS`. Teksten zoals ze in het
spel komen (Vlaams, kort, zonder tabellen; getallen enkel waar het een harde grens
is):

1. **Overzicht** — *🎉 Welkom in seizoen 3*
   > Jullie stemden, en het winnende idee zit in het spel. Daarnaast is er aan een
   > paar knoppen gedraaid. De belangrijkste in vijf stappen — alles in detail
   > staat in de wiki.
2. **Mijn hok** (spotlight op een duifkaart met een kenmerk; heeft de speler er
   geen, dan op de eerste duifkaart) — *✨ Kenmerken*
   > Ongeveer één op de drie duiven heeft nu een kenmerk: ze vliegt sneller in één
   > bepaalde situatie — bij rugwind, in de kou, in het donker, op een sprint…
   > Klik op het label om te zien wanneer. Kenmerken zijn **erfelijk** en voor
   > iedereen zichtbaar, ook op de markt.
3. **Vluchten** (spotlight op de vluchtkalender) — *✨ Wie is vandaag in haar element?*
   > Bij het inschrijven zie je welke duif haar kenmerk kan gebruiken. Sommige
   > hangen af van het weer bij de lossing; andere — dag, nacht, in groep of
   > alleen — slaan zelfs pas **tijdens** de vlucht aan. Volg het op het live bord.
4. **Sponsors** (spotlight op de sponsorteller) — *🤝 Hoogstens 6 sponsors*
   > Je kan nog **maximaal 6 sponsors** tegelijk hebben. De prestigesponsors
   > betalen per dag minder; hun tekengeld en podiumpremie blijven. Wil je een
   > zevende, dan zeg je er eerst een op.
5. **Mijn hok** (spotlight op de coachknop van een duif) — *🎓 Een betere duif, een duurdere coach*
   > De prijs van een privécoach hangt nu af van hoe goed je duif is: een gewone
   > duif blijft goedkoop, een topduif kost meer. En zelf trainen geeft voortaan
   > altijd precies **+1**.
6. **Vluchten** — *⚡ Vliegen vraagt meer*
   > Een vlucht kost je duiven meer **energie** en meer **gezondheid** dan vroeger,
   > en ervaring spaart minder energie uit. Een volle tank en genoeg rust wegen dus
   > zwaarder. Alles op een rij: **Wiki → Nieuw in seizoen 3**.
   (knop "Naar de wiki" → `/wiki#seizoen3`)

Bestaat een selector niet (bv. `data-tour`-attribuut op de coachknop of de
sponsorteller), voeg hem toe; de rondleiding mag nooit op een lege plek wijzen.

### 5.5 Wiki: "Nieuw in seizoen 3"
Nieuwe sectie **bovenaan** `WikiPage.tsx`, id `seizoen3`, die na seizoen 3 gewoon
blijft staan (als changelog). Inhoud, kort per blok, met een link naar de
volledige sectie eronder:

| Blok | Inhoud |
|---|---|
| ✨ **Kenmerken** | wat het is, de 15 kenmerken in één tabel (emoji, naam, wanneer, effect), 30 % kans, erfelijk, gewoon/zeldzaam → link naar `#kenmerken` |
| 🤝 **Sponsors** | max. 6; prestigesponsors (tier 4) −75 % per dag met de nieuwe bedragen; een zevende = eerst opzeggen (met verbrekingsvergoeding); wie er te veel had: gratis afbouwen |
| 🎓 **Coach & trainen** | de tabel van de zeven schijven; trainen = altijd +1 |
| ❤️ **Gezondheid** | verlies na een vlucht ×1,15, met 3 voorbeelden (300 / 500 / 1000 km) |
| ⚡ **Energie** *(al live sinds eind september)* | verbruik ×1,15; ervaring spaart nog maar ±6 % (was ±25 %); 2–3 voorbeelden |
| 🏆 **Prijsuitreiking** | Roekoes nu €2.000 / €1.700 / €1.400; elke andere melker met punten krijgt seizoenspunten ÷ 3 in euro (voorbeeld: 1.200 punten → €400) |
| 🗳️ **Van De Stem** | "Unieke eigenschappen per duif" staat op *In het spel*; stem mee op het volgende idee → link naar De Stem |

### 5.6 Kaart op het Overzicht
Een kleine, wegklikbare kaart bovenaan het Overzicht, **7 dagen** vanaf de start
van seizoen 3: *"🎉 Seizoen 3: kenmerken, sponsorlimiet en meer — bekijk wat er
nieuw is →"* (link naar `/wiki#seizoen3`). Wegklikken onthouden per browser
(localStorage, in try/catch). Zo vindt ook wie de rondleiding wegklikte het later
terug.

### 5.7 De Stem
Zet het idee "✨ Unieke eigenschappen per duif" op **`uitgevoerd`** ("In het spel")
op het moment dat seizoen 3 start (via de migratie of met de admin-knop — noteer
welke).

### 5.8 Tests
- De welkomstmelding: precies één per speler, geen voor bots, stabiele id (dubbele
  verwerking = één rij); de regels met • verschijnen enkel wanneer van toepassing
  ({n}=0, geen coach, geen sponsors, >6 sponsors).
- De actiemelding enkel bij >6 sponsors.
- Vóór de seizoenspoort: geen meldingen, en `/state` geeft niets waardoor de
  rondleiding of de kaart zou tonen.
- `idle-writes` blijft groen (de meldingen komen uit de eenmalige migratie, nooit
  uit een tick die elke poll draait).

### 5.9 Klaar als
- [ ] Welkomstmelding en (waar nodig) actiemelding worden bij de start verstuurd.
- [ ] De rondleiding verschijnt één keer, na de prijsuitreiking, met werkende spotlights.
- [ ] De wiki heeft "Nieuw in seizoen 3" bovenaan, inclusief de energiewijziging die al live was.
- [ ] De kaart op het Overzicht staat er 7 dagen.
- [ ] Het Stem-idee staat op "In het spel".
- [ ] Niets hiervan is zichtbaar vóór de start van seizoen 3.

---

## 6. Prijsuitreiking: nieuwe Roekoe-bedragen en een seizoenspremie voor iedereen

### 6.1 De regels
Bij de prijsuitreiking op het einde van een seizoen (`runSeasonEnd` in
`core/game/season.ts`), voor de **melkerranglijst** (seizoenspunten):

| Plaats | Prijs | Geld |
|---|---|---|
| 1 | 🏆 Gouden Roekoe | **€2.000** (+ badge Seizoenskampioen) |
| 2 | Zilveren Roekoe | **€1.700** (was €1.500) |
| 3 | Bronzen Roekoe | **€1.400** (was €1.000) |
| 4 en verder | 💰 **Seizoenspremie** | **seizoenspunten ÷ 3**, in euro |

- **Seizoenspremie:** elke melker **buiten de top 3** met **minstens 1
  seizoenspunt** krijgt `floor(seizoenspunten / 3)` euro. Voorbeelden: 1.200 punten
  → €400; 300 → €100; 100 → €33; 2 → €0 (geen premie, geen kaart).
- De **top 3 krijgt enkel de Roekoe**, geen premie erbovenop.
- **Bots** krijgen de premie ook (zoals ze nu al Roekoes kunnen winnen; ze krijgen
  geen melding).
- **Nieuwe spelers:** hun seizoenspunten tellen in hun eerste seizoen dubbel
  (starterspakket), dus hun premie volgt vanzelf. Niet apart afvangen.
- De **Vleugels** en het **criterium** blijven ongewijzigd.
- **Gelijke stand** rond plaats 3: de bestaande sortering (punten, dan zeges dit
  seizoen) beslist, zoals nu.

### 6.2 Technisch
- **Config (`gameConfig.ts`, `SEASON_AWARDS`):** `roekoe: [2000, 1700, 1400]` en
  een nieuwe knop `pointsPremiumDivisor: 3`.
- **`runSeasonEnd`:** na de top 3 loopt het over `standings[3…]` en geeft elk hok
  met `floor(seasonPoints / 3) > 0` een award van een nieuw soort, bv.
  `kind: 'premie'` (`SeasonAward` in `schema.ts`), met `value = seizoenspunten` en
  `reward = het bedrag`. Via `give()`, zodat geld, `loft.awards` en de melding
  hetzelfde pad volgen.
  - ⚠️ `loft.awards` groeit zo elk seizoen bij bijna elk hok. Kijk of de erelijst
    (Prestaties → Seizoensprijzen) de premies apart of niet toont: **niet** als
    beker tellen (het is geen Roekoe), eventueel als regel "Seizoenspremie".
- **Melding** (bestaande prijsuitreiking-melding, `ntf:season:<seizoen>:<userId>`):
  de regel *"💰 Seizoenspremie: {punten} punten → €{bedrag}"*. Die melding gaat nu
  naar bijna iedereen, niet enkel de top 3.
- **Scherm** (`PrizeCeremony.tsx`): een eigen kaart voor de premie (💰, de punten
  en het bedrag). `Layout.tsx` toont de uitreiking nu enkel als er awards zijn;
  dat blijft zo, en geldt nu ook voor de premie.
- **Ranglijst** (optioneel, als het klein blijft): per hok buiten de top 3 de
  premie die hij **nu** zou krijgen ("≈ €400"). Enkel weergave.

### 6.3 Activering
- **Vanaf de prijsuitreiking bij de wissel naar seizoen 3**, dus voor de stand
  van **seizoen 2**. Dat is het eerste wat de spelers van seizoen 3 zien.
  ⚠️ Daarvoor moet de code live staan **vóór** de wissel; de speler bepaalt dat
  moment. Staat ze pas na de wissel live, dan geldt het vanaf het einde van
  seizoen 3 — noteer dan hier wat er gebeurde.
- Geen datamigratie nodig.

### 6.4 Tests
Uitbreiden: `tests/season-prizes.test.mts`:
- de top 3 krijgt €2.000 / €1.700 / €1.400 en geen premie;
- plaats 4+ krijgt `floor(punten/3)`; 1.200 → 400; 2 punten → niets; 0 punten →
  niets;
- bots krijgen de premie maar geen melding;
- één melding per speler met alle prijzen samen (stabiele id, dubbele verwerking
  = één rij);
- `seasonWins`-reset en de rest van de bestaande asserties blijven groen.

### 6.5 Documentatie
- **`spelregels.md` §15.2:** de nieuwe bedragen en de seizoenspremie.
- **`context.md`:** `SEASON_AWARDS` en het award-soort `premie`.
- **Wiki:** de tabel van de Roekoe met de premie, en de rij in "Nieuw in seizoen 3" (§5.5).

### 6.6 Klaar als
- [ ] Roekoes betalen €2.000 / €1.700 / €1.400.
- [ ] Elke andere melker met punten krijgt seizoenspunten ÷ 3 (afgerond naar beneden).
- [ ] Melding, prijsuitreiking op het scherm en erelijst tonen de premie correct.
- [ ] Tests groen; spelregels, wiki en `context.md` bijgewerkt.

---

<!-- Nieuwe onderdelen hieronder toevoegen als "## 2. …", "## 3. …" met dezelfde
     opbouw (idee → regels → technisch → tests → klaar als), en een rij in de
     statustabel bovenaan. -->
