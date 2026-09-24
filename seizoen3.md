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
- Stuur elke **speler** (geen bots) één melding met **stabiele id**
  `ntf:season3:traits:<userId>`: *"Seizoen 3 is gestart: X van je duiven hebben een
  kenmerk gekregen. Bekijk ze in je hok."* met link naar de wiki.
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
     het is een eigen keuze. ⚠️ *Nog te bevestigen door de speler* — zie §2.7.
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
   €135/dag) heeft. ⚠️ *Voorstel, nog te bevestigen door de speler* — zie §2.7.

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

### 2.7 Open vragen (vóór het bouwen aan de speler stellen als nog open)
- ⬜ Kost het opzeggen voor een **zevende** sponsor de gewone
  verbrekingsvergoeding? (voorstel: ja)
- ⬜ Mag een tier-4-sponsor terugkomen na een weigering, ook al betaalt hij per
  dag minder dan de huidige sponsor in die categorie? (voorstel: ja, §2.2 punt 5)

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
- [ ] De twee open vragen van §2.7 zijn beantwoord en verwerkt.
- [ ] `tests/sponsor-cap.test.mts` en de bestaande tests zijn groen.
- [ ] Spelregels, wiki en `context.md` zijn bijgewerkt.

---

<!-- Nieuwe onderdelen hieronder toevoegen als "## 2. …", "## 3. …" met dezelfde
     opbouw (idee → regels → technisch → tests → klaar als), en een rij in de
     statustabel bovenaan. -->
