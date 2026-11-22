# Roekoe — Spelregels & Berekeningen

De regels en formules van het spel, kort. De getallen komen uit `core/config/gameConfig.ts`
(daar herbalanceer je), de logica uit `core/game/`. De sectienummers zijn vast: code en tests
verwijzen ernaar. Uitleg voor spelers staat in de wiki (`client/src/pages/WikiPage.tsx`).

> Intern heet **conditie** `endurance` en **energie** `form`.

---

## 1. Eigenschappen van een duif

Alles 0–100.

| Eigenschap | Wat ze doet |
|---|---|
| **Snelheid** | Rauwe snelheid; weegt overal het zwaarst, het sterkst op korte vluchten. |
| **Conditie** | Hoe lang ze haar tempo vasthoudt (§2.3b); weegt zwaarder met de afstand. Groeit door te vliegen. |
| **Oriëntatie** | Navigatie: omvliegen of de weg kwijtraken (§3.5). Maakt niet sneller. |
| **Energie** | Daalt door vluchten, stijgt door rust en voer. Laag = trager, meer blessures en ziekte. |
| **Gezondheid** | Vermenigvuldigt de vluchtsnelheid; ≤ 15 = niet vluchtklaar. |
| **Libido** | Broeddrift; volgt conditie en energie (§4.1). |
| **Ervaring** | Maakt zuinig, niet sneller (§2.3, §3, §3.7). Geen gen-cap. |

**Vluchtklaar:** niet gepensioneerd, geen ziekte of kwetsuur, niet in de ziekenboeg, minstens
**8 weken** oud en gezondheid > 15. **Talent** (de algemene score ★) = gemiddelde van snelheid,
conditie en oriëntatie. Die drie hebben elk een aangeboren maximum (§7bis) en zakken met de
ouderdom (§6).

---

## 2. Vluchten

### 2.1 Kalender (Brussel-tijd)

> ⚠️ **Sinds 22 november 2026 is de kalender stilgelegd** (migratie v77): er worden geen
> vluchten meer gepland. Enkel **The Last Flight** staat nog op de kalender (§2.11). De tabel
> hieronder is hoe de kalender liep.

| Dag | Vluchten |
|---|---|
| **Maandag** | 06:00 **league ★ t/m 60** (§2.10) · 08:00 internationaal |
| **Dinsdag** | 10:00 regionaal · 12:00 **oefenvlucht** (§2.7) |
| **Woensdag** | 06:00 **league ★ 61–70** (§2.10) · 08:00 nationaal |
| **Donderdag** | 06:00 **league ★ 71–80** (§2.10) · 08:00 internationaal |
| **Vrijdag** | 06:00 **league ★ 81+** (§2.10) · 07:00 **nationaal — lange omloop** · 12:00 **oefenvlucht** (§2.7) · 17:00 regionaal |
| **Zaterdag** | 08:00 **Titanenwedstrijd** (§2.8) of 05:00 **Estafettevlucht** (§2.9) — week om week, en de **enige** vlucht die dag |
| **Zondag** | 08:00 nationaal · 17:00 regionaal |

Per week: 9 wedstrijdvluchten (3 regionaal, 3 nationaal, 2 internationaal, 1 weekendwedstrijd),
4 leaguevluchten en 2 oefenvluchten. De vrijdagnationale is de lange: **430–500 km**.

- **Eén vlucht per duif per dag** (§3.9).
- Een **wedstrijdvlucht** (ook de titan) gaat enkel door met minstens **2 verschillende
  melkers**; een league met 3 melkers en 4 duiven (§2.10). Anders: afgelast, inschrijfgeld
  terug. Een oefenvlucht mag met één deelnemer.
- In het spel staat de kalender per dag, met filters op soort en op dag; een lopende vlucht
  staat altijd bovenaan.

### 2.2 Niveaus

| Niveau | Steden | Afstand | Inschrijfgeld |
|---|---|---|---|
| Regionaal | twee Vlaamse steden | 100–200 km | €10 |
| Nationaal | België + buurlanden (BE, NL, FR, LU, DE) | 200–500 km | €20 |
| Internationaal | tot de **grote fond** (BE, NL, FR, GB, LU, DE, ES) | 400–1200 km | €40 |

Start en aankomst worden willekeurig gekozen binnen het niveau; de afstand is Haversine.
Internationaal reikt tot de grote-fondlosplaatsen (Bordeaux, Toulouse, Perpignan, Barcelona).

### 2.3 Vluchtsnelheid (m/min)

Per duif, bevroren bij de start:

```
gewicht(afstand) — drie ankers: 100 km → 700 km → 1200 km
  tot 700 km:  t = (afstand − 100) / 600
    gewicht.snelheid = 0.76 + (0.46 − 0.76)·t
    gewicht.conditie = 0.24 + (0.54 − 0.24)·t
  vanaf 700 km: t = (afstand − 700) / 500
    gewicht.snelheid = 0.46 + (0.38 − 0.46)·t
    gewicht.conditie = 0.54 + (0.62 − 0.54)·t

basisscore = gewicht.snelheid·Snelheid + gewicht.conditie·Conditie
# Oriëntatie zit hier BEWUST niet in — zie §3.5.

# Energie doseren met ervaring:
effectieve_energie = Energie + (Ervaring/100)·(100 − Energie)·0.35
# Energiefactor is afstandsafhankelijk (kort mild, lang streng), op de effectieve energie:
energiefactor_kort = interp: 0→0.80, 50→0.95, 100→1.05
energiefactor_lang = interp: 0→0.45, 50→0.85, 100→1.20
energiefactor      = energiefactor_kort + (energiefactor_lang − energiefactor_kort)·t

gezondheidsf.  = interp(Gezond.):  0→0.40, 50→0.85, 100→1.00
leeftijdfactor = leeftijdscurve (zie §6)
weerfactor     = 0.70 … 1.20 (zie §2.5)
geluk          = willekeurig 0.90 … 1.10

snelheid = (700 + basisscore·9) · energiefactor · gezondheidsf. · leeftijdfactor · weerfactor · geluk
# Ervaring zit hier BEWUST niet in — zie hieronder en §3.7.
```

- **Oriëntatie en ervaring zitten niet in de snelheid.** Ervaring helpt enkel een lage tank
  indelen (de `effectieve_energie` hierboven): bij volle energie niets, bij energie 20 tot
  ~+15 km/u op 500 km.
- **Dagvorm:** elke duif trekt per vlucht één keer een afwijking (meestal klein, soms een
  goede of slechte dag) die voor de hele rit geldt. Afgesteld zodat een duidelijk betere duif
  tegen zeven zwakkere ~55 % wint en de topper ~1 op 7 keer naast het podium valt.

### 2.3b Conditie: het tempo vasthouden

De vlucht is in stukken verdeeld; per stuk vraagt de duif een tempo. Conditie bepaalt welk
deel daarvan ze onbeperkt volhoudt: vraagt ze meer, dan bouwt ze vermoeidheid op, houdt ze
in, dan zakt die weer weg (sneller bij betere conditie). Tempo dat overblijft in het laatste
derde van de rit:

| Conditie | 150 km | 300 km | 500 km | 700 km |
|---|---|---|---|---|
| 40 | 94 % | 90 % | 87 % | 89 % |
| 55 | 98 % | 92 % | 89 % | 88 % |
| 70 | 99 % | 93 % | 92 % | 92 % |
| 85 | 99 % | 97 % | 96 % | 95 % |
| 95 | 100 % | 100 % | 96 % | 97 % |

### 2.4 Duur en live-weergave

```
seconden = (afstand_km · 1000 / snelheid_m_per_min) · 60
duur     = max(300, afgerond(seconden))
```

- **Kop en staart:** twee balken op het live-bord: de leider, en de laatste duif die nog in
  de wedstrijd zit (opgevers en uitvallers tellen niet). Bij een estafette gaat het om ploegen.
- **Live kaart:** de route met een stip per duif, op haar echte positie; een verdwaalde duif
  wijkt zichtbaar af over de kilometers die ze omvloog. Tik een stip voor haar stand.
- **Km/u op het bord** is de echte effectieve snelheid en loopt vloeiend mee.
- **Live verslag:** enkel echte gebeurtenissen (voorbijsteken met de reden, van koers,
  uitvallen, opgeven, koploperwissels, aankomsten). Het volgt de kopgroep, bemonstert elke
  10 minuten (op een lange vlucht ongeveer elk uur) en dempt twee duiven die blijven wisselen.

### 2.5 Weer

Het echte windbeeld op de startplaats (Open-Meteo), omgezet naar een factor:

```
along = windsnelheid · cos(hoek tussen windrichting en route)   // + = rugwind
weerfactor = clamp(1 + along/120 − min(neerslag, 4)·0.04, 0.70, 1.20)
```

Zonder netwerk: willekeurig weer, met een temperatuur uit het Belgische maandgemiddelde. De
vlucht bewaart `along`, regen en temperatuur (per etappe bij een estafette) voor de kenmerken
(§7ter): rug-/tegenwind vanaf 6 km/u, "kalm, droog" = geen regen en |along| ≤ 6, koud < 10 °C.

### 2.6 Uitslag: prijzengeld & punten

Gerangschikt op finishtijd. **Elke duif die thuis raakt verdient iets**; wie niet finisht
krijgt niets.

| Plaats | Regionaal | Nationaal | Internationaal |
|---|---|---|---|
| 1 | €800 | €1.200 | €2.200 |
| 2 | €600 | €800 | €1.800 |
| 3 | €350 | €500 | €1.000 |
| 4 | €220 | €320 | €650 |
| 5 | €140 | €210 | €420 |
| 6 | €110 | €180 | €270 |
| 7 | €100 | €150 | €240 |
| 8 | €90 | €140 | €200 |
| 9 | €70 | €120 | €140 |
| 10 | €70 | €100 | €140 |
| 11 | €70 | €80 | €140 |
| 12–13 | €60 | €80 | €100 |
| 14–15 | €60 | €70 | €100 |
| 16–17 | €40 | €70 | €75 |
| 18 en verder | €40 | €50 | €75 |

**Punten** (top 20): 100, 80, 65, 55, 47, 40, 34, 29, 25, 21, 18, 15, 13, 11, 9, 7, 5, 3, 2, 1.

- **Hoogstens 3 duiven per hok verdienen per vlucht** (geld én punten): je 3 best geplaatste.
  De rest vliegt mee en staat in de uitslag ("buiten de 3"). Een duif die niet finisht kost
  geen plaats. Het geld van een niet-beloonde plaats vervalt; het schuift niet door.
- **Prijzengeld krijg je zodra je duif finisht**, met een melding. Punten, medailles,
  weddenschappen en prestaties volgen bij de afronding van de hele vlucht.

### 2.7 Oefenvluchten (dinsdag & vrijdag, 12:00)

Kort en gratis. Geen prijzengeld, punten, medailles of ranglijsten (ook niet voor de
vooruitgangsranglijst); geen bots, geen weddenschappen; geen DNF, kwetsuur of sterfte.
Energiekost ~8. Na afloop een kans op groei, gewogen snelheid 0,15 / conditie 0,45 /
oriëntatie 0,40:

```
kans        = 0.70              (zonder coach)
            = 0.92              (met privécoach)
groei       = willekeurig(0.4 … 1.4) · (0.4 + ruimte)
              + 0.5 extra bij een gecoachte duif op conditie/oriëntatie
```

### 2.8 Titanenwedstrijd (om de week, zaterdag 08:00)

Wisselt week om week met de estafette (§2.9) en is die dag de enige vlucht.

- **Eén duif per melker**, ~200–600 km, inschrijfgeld **€50**.
- Prijzengeld: **1e €1800, 2e €1200, 3e €900**. Geen seizoenspunten.
- Een podium geeft wel medailles (§15.5), en de vlucht telt mee voor de duivenranglijsten
  (§15.3). De duif gaat er gewoon op vooruit.

### 2.9 Estafettevlucht (om de week, zaterdag 05:00)

- **Eén ploeg van exact 3 duiven per hok**, inschrijfgeld **€100 voor de ploeg**.
- ~900 km in **drie even lange etappes**; er vliegt één duif tegelijk en de ploegtijd is de
  som. Elke duif betaalt enkel de energie van haar eigen etappe (~25).
- **Eén schakel weg = ploeg weg** (opgeven, uitputting, blessure). Wie nog niet aan de beurt
  was, vliegt niet en betaalt niets.
- **Elke etappe heeft haar eigen weer**, dagen vooraf voorspeld en bijgewerkt. De volgorde
  van je duiven mag je wisselen tot de start.
- **Uitslag:** eerst de complete ploegen op tijd, dan de uitgeschakelde op afgelegde afstand.

| Plaats | Prijzengeld |
|---|---|
| 1e | €3.000 |
| 2e | €2.000 |
| 3e | €1.500 |
| 4e | €1.100 |
| 5e | €800 |

- Vanaf de 6e plaats geen geld. Geen seizoenspunten, geen weddenschappen. Een podium geeft
  één medaille per ploeg. Telt mee voor de duivenranglijsten (elke duif haar eigen
  etappegemiddelde). De duiven gaan vooruit volgens de plaats van de ploeg.
- Geen 3 vluchtklare duiven bij de start, of één duif uitgeschreven: de hele ploeg is eruit,
  inschrijfgeld terug. Er moeten minstens 2 volledige ploegen starten.

### 2.10 Leagues (ma/wo/do/vr, 06:00)

Een tweede competitie, per duif, in vier leagues volgens haar algemene score:

| League | Score | Vluchtdag |
|---|---|---|
| 🌱 **★ t/m 60** | ★60 of lager | maandag 06:00 |
| 🌿 **★ 61–70** | ★60,1 tot en met ★70 | woensdag 06:00 |
| 🌳 **★ 71–80** | ★70,1 tot en met ★80 | donderdag 06:00 |
| 👑 **★ 81+** | ★80,1 of hoger | vrijdag 06:00 |

- **Inschrijfgeld €20**, zoveel duiven als je wil; enkel je 3 best geplaatste verdienen (§2.6).
- De league is die van haar score **op het moment van inschrijven** (één decimaal: ★60,0 is
  nog de laagste league).
- Een league gaat pas door met minstens **4 duiven** van minstens **3 verschillende
  melkers** aan de start (bots tellen mee); anders afgelast met terugbetaling.
- Wisselt per seizoensweek: week 1 en 3 een **sprint** (100–300 km), week 2 en 4 een
  **grote fond** (400–1000 km), voor alle vier de leagues hetzelfde.
- Verder een gewone wedstrijd (energie, blessures, vooruitgang). Bots doen mee.
- **Geen** seizoenspunten, sponsorpremie of weddenschappen. **Wel** medailles, en de vlucht
  telt mee voor de duivenranglijsten.

**Prijzengeld per vlucht** (de hoogste league 100 %, dan 85 %, 70 % en 50 %, afgerond op €5):

🏁 **Sprint**

| Plaats | ★ t/m 60 | ★ 61–70 | ★ 71–80 | ★ 81+ |
|---|---|---|---|---|
| 1e | €500 | €700 | €850 | €1.000 |
| 2e | €350 | €490 | €595 | €700 |
| 3e | €250 | €350 | €425 | €500 |
| 4e | €150 | €210 | €255 | €300 |
| 5e | €125 | €175 | €215 | €250 |
| 6e | €110 | €155 | €185 | €220 |
| 7e | €90 | €125 | €155 | €180 |
| 8e | €60 | €85 | €100 | €120 |
| 9e – 11e | €50 | €70 | €85 | €100 |
| 12e – 15e | €40 | €55 | €70 | €80 |
| 16e en verder | €30 | €40 | €50 | €60 |

🛰️ **Grote fond**

| Plaats | ★ t/m 60 | ★ 61–70 | ★ 71–80 | ★ 81+ |
|---|---|---|---|---|
| 1e | €800 | €1.120 | €1.360 | €1.600 |
| 2e | €700 | €980 | €1.190 | €1.400 |
| 3e | €600 | €840 | €1.020 | €1.200 |
| 4e | €425 | €595 | €725 | €850 |
| 5e | €300 | €420 | €510 | €600 |
| 6e | €200 | €280 | €340 | €400 |
| 7e | €175 | €245 | €300 | €350 |
| 8e | €150 | €210 | €255 | €300 |
| 9e – 11e | €90 | €120 | €150 | €175 |
| 12e – 15e | €65 | €90 | €105 | €125 |
| 16e en verder | €45 | €65 | €75 | €90 |

**De stand loopt één seizoen**, met de puntentabel van §2.6 (sprint en fond wegen even
zwaar). Bij gelijke punten: aantal zeges, dan beste gemiddelde snelheid. Verandert een duif
van league, dan blijven haar punten staan waar ze verdiend zijn. Bij de prijsuitreiking
(§15) wint de top 10 van elke league geld; de top 3 krijgt ook een titel **op de duif**, die
bij haar blijft als ze verkocht wordt. Daarna gaat elke stand op nul.

| Plaats | ★ t/m 60 | ★ 61–70 | ★ 71–80 | ★ 81+ |
|---|---|---|---|---|
| 🥇 1e | €800 | €1.100 | €1.350 | €1.600 |
| 🥈 2e | €650 | €900 | €1.100 | €1.300 |
| 🥉 3e | €500 | €650 | €800 | €950 |
| 4e | €200 | €300 | €350 | €400 |
| 5e | €150 | €200 | €250 | €300 |
| 6e | €100 | €150 | €200 | €250 |
| 7e – 10e | €75 | €100 | €125 | €150 |

### 2.11 The Last Flight (vrijdag 27 november 2026, 07:00)

De afscheidsvlucht van het spel, en de enige vlucht die nog gepland staat.

| | |
|---|---|
| Route | **Madrid → Brussel, 1.316 km** — de langste vlucht ooit; Madrid is enkel voor deze vlucht |
| Soort | een gewone **internationale wedstrijd**: €40 inschrijfgeld, prijzengeld (§2.6), punten, medailles, weddenschappen |
| Energie | gemiddeld ~64–72 per duif (§3), naargelang de ervaring |
| Duur | de snelste duiven ~15 uur, de traagste tot ~1,5 dag |

- Het racemodel rekent alles boven 1.200 km als 1.200 km (gewichten, energiefactor); enkel
  afstand en duur groeien mee.
- Bij het stilleggen (v77) werden alle geplande vluchten weggehaald: inschrijfgeld terug (per
  ploeg bij een estafette), weddenschappen terugbetaald, en elke speler kreeg een bel. Een
  vlucht die al liep, vloog gewoon uit.
- Daarna plant de kalender niets meer (`World.scheduleEndedAt`).

---

## 3. Effect van een vlucht op de duif

| Effect | Formule | Wanneer |
|---|---|---|
| **Energie** (verbruik) | −((10 + afstand/30) · ervaringsfactor + willekeurig 0…10) · 1,15 | **geleidelijk tijdens de vlucht** (zie hieronder) |
| **Conditie** (opbouw) | +(0.3 + afstand/500 + willekeurig 0…0.4) | na afloop |
| **Gezondheid** | −(0,5 + afstand/250) × (1 + leegte van de tank) × 1,15 — zie §4.4 | na afloop |
| **Ervaring** | +(2 + afstand/100) × **leerfactor** (§3.7) | na afloop |

```
ervaringsfactor = 1 − (ervaring/100 − 0.5) · 0.125
  ervaring 0   → ×1.0625   (6,25% meer verbruik)
  ervaring 50  → ×1.00
  ervaring 100 → ×0.9375   (6,25% minder verbruik)
```

- De spreiding (0…10) komt erbovenop, en het geheel gaat ×1,15. **Zuinige vlieger** (§7ter): ×0,92.
- **Energie loopt gaandeweg leeg:** de kost wordt bij de start vastgeklikt en per 30 minuten
  afgetrokken, evenredig met de afgelegde afstand. Wie opgeeft of uitvalt, betaalt enkel het
  gevlogen stuk.

Gemiddeld verbruik (inclusief spreiding en ×1,15):

| Afstand | Onervaren (erv. 0) | Gemiddeld (erv. 50) | Ervaren (erv. 100) |
|---|---|---|---|
| 100 km (regio) | ~22,0 | ~21,1 | ~20,1 |
| 200 km (regio/nationaal) | ~26,1 | ~24,9 | ~23,7 |
| 300 km (nationaal) | ~30,2 | ~28,7 | ~27,3 |
| 500 km (nationaal/intl.) | ~38,3 | ~36,4 | ~34,5 |
| 700 km (internationaal) | ~46,5 | ~44,1 | ~41,7 |
| 1000 km (grote fond) | ~58,7 | ~55,6 | ~52,5 |

### 3.1 Kans op verbetering van een vaardigheid

Elke duif die thuis raakt maakt kans om te groeien in de vaardigheid die voor die afstand
telt. Hoe zwakker de duif en hoe beter haar plaats, hoe groter de kans en de stap:

```
plafond     = laagste van 90 en haar gen-cap        // boven 90 enkel de coach (§8)
ruimte      = (plafond − huidige_waarde) / plafond
zwakte      = 1 − (gemiddelde van snelheid, conditie, oriëntatie) / 100
plaats      = (aantal − plaats_in_de_uitslag) / aantal   // winnaar ≈ 1, laatste ≈ 0
kans        = 0,4 · (0,4 + ruimte) · (0,5 + zwakte · 1,5) · (0,6 + plaats · 0,8)   // hoogstens 0,92
groei       = willekeurig(0,4 … 1,6) · (0,4 + ruimte) · (1 + zwakte · 0,8)
```

### 3.2 Vluchtvorm en blessures

Inschrijven vraagt minstens **1 energie**. Vertrekt een duif met minder dan **5 energie**, dan
is er ~7 % kans dat ze sterft.

```
vluchtvorm = (2 × laagste(energie, gezondheid) + hoogste) / 3   − rustaftrek (§3.6)
```

De vluchtvorm staat op de duifpagina en in de inschrijflijst (🟢/🟡/🔴), al na de rustaftrek.

- **Overbelasting** (verrekte borstspier, verstuikte vleugel, borstbeenkneuzing, botbreuk):
  kans en ernst hangen af van de vluchtvorm.
- **Pech** (sperwer, botsing, gebroken slagpen): een kleine vaste kans, los van verzorging.

Kans op een blessure per vlucht (beide soorten samen):

| Vluchtvorm | 150 km | 300 km | 500 km | 700 km | 1000 km |
|---|---|---|---|---|---|
| 90 (top) | 2 % | 3 % | 3 % | 4 % | 5 % |
| 75 (goed) | 4 % | 5 % | 6 % | 7 % | 9 % |
| 65 (normaal) | 7 % | 9 % | 11 % | 13 % | 15 % |
| 55 (matig) | 12 % | 14 % | 17 % | 20 % | 25 % |
| 45 (zwak) | 18 % | 21 % | 26 % | 31 % | 38 % |
| 30 (gevaarlijk) | 30 % | 36 % | 44 % | 52 % | 64 % |

Ernst bij overbelasting:

| Vluchtvorm | Licht | Matig | Ernstig |
|---|---|---|---|
| 90 | 66 % | 26 % | 8 % |
| 70 | 58 % | 28 % | 14 % |
| 50 | 50 % | 30 % | 20 % |
| 30 | 42 % | 32 % | 26 % |

Opgeven en oefenvluchten kennen geen blessure- of sterfterisico.

### 3.3 Geen tijdslimiet

Een wedstrijd loopt tot de laatste duif die het haalt thuis is. DNF is enkel wie opgegeven
wordt (§3.4) of onderweg uitvalt (§3.2).

### 3.4 Zelf opgeven

Tijdens een live vlucht kan je een eigen duif laten opgeven: ze telt als DNF, verliest enkel
de energie die ze al vloog, geen gezondheid, geen kans op kwetsuur, en bouwt geen conditie
op. Wie al binnen of uitgevallen is, kan je niet meer opgeven.

### 3.5 Oriëntatie: omvliegen en de weg kwijtraken

- **Zwerm:** zolang het veld samen vliegt, raakt een duif zo goed als niet van koers. Pas als
  het veld uiteenvalt telt haar oriëntatie. Gevolg: bijna niets in de eerste kilometers,
  minder op korte vluchten, meer in een klein veld.
- Hoe langer de vlucht, hoe meer gelegenheden: een slechte navigator kan meerdere keren
  afdwalen. Slecht weer verhoogt de kans, het hardst bij slechte navigators.
- **Thuisvinder** (§7ter): ×0,75.

Kans op minstens één afdwaling (mooi weer, vol veld):

| Oriëntatie | 150 km | 300 km | 500 km | 700 km | 1000 km |
|---|---|---|---|---|---|
| 95 | 3 % | 6 % | 10 % | 13 % | 18 % |
| 85 | 11 % | 21 % | 33 % | 41 % | 53 % |
| 70 | 26 % | 46 % | 64 % | 75 % | 87 % |
| 60 | 36 % | 61 % | 78 % | 88 % | 95 % |
| 50 | 47 % | 71 % | 88 % | 95 % | 98 % |
| 30 | 64 % | 89 % | 96 % | 99 % | 100 % |

**Meestal is het een omweg:** echte extra kilometers, dus tijdverlies en extra energie.
Hoogstens ~15 % van de route op de fond en ~7 % op een korte vlucht.

| Oriëntatie | Totale omweg op 300 km | Op 700 km | Op 1000 km |
|---|---|---|---|
| 95 | ~9 km | ~17 km | ~26 km |
| 85 | ~13 km | ~26 km | ~42 km |
| 70 | ~20 km | ~51 km | ~83 km |
| 60 | ~23 km | ~71 km | ~114 km |
| 30 | ~28 km | ~102 km | ~148 km |

**Soms raakt ze de weg helemaal kwijt** (DNF). Ze komt altijd terug, na een paar dagen, met
een lege tank, minder gezondheid en vaak een kwetsuur of ziekte. Tot dan kan ze niets, eet
ze niet en lijdt ze geen honger.

| Oriëntatie | Niet thuis (300 km) | 1000 km | 1000 km, slecht weer |
|---|---|---|---|
| 85 of hoger | praktisch nul | praktisch nul | praktisch nul |
| 70 | ~0 % | 0,1 % | 0,1 % |
| 50 | 0,9 % | 1,3 % | 1,7 % |
| 30 | 3,2 % | 4,9 % | 5,0 % |

Oriëntatie groeit door te vliegen (het snelst op lange vluchten), door training (tot 80) en
door de coach.

### 3.6 Twee dagen op rij vliegen kost vorm

| Laatste vlucht | Aftrek op de vluchtvorm |
|---|---|
| gisteren | **−15** |
| eergisteren | −7 |
| langer geleden | geen |

Een oefenvlucht telt voor een derde (−5). Het getoonde vormcijfer is al ná de aftrek.

### 3.7 Ervaring: de leerfactor

Elke ervaringswinst (vlucht, oefenvlucht, training, coach, gebeurtenis) wordt vermenigvuldigd:

```
ruimte      = (100 − Ervaring) / 100
leerfactor  = 0.12 + 1.68 · ruimte^1.6
Ervaring   += rauwe_winst · leerfactor
```

| Ervaring van de duif | Leerfactor | Wat dat betekent |
|---|---|---|
| 0 | **×1,80** | een groentje leert bijna dubbel zo snel als vroeger |
| 20 | ×1,30 | nog altijd sneller dan vroeger |
| **33** | **×1,00** | het omslagpunt — vanaf hier gaat het trager dan vroeger |
| 50 | ×0,67 | een vlucht levert nog twee derde op |
| 70 | ×0,36 | ruim een derde |
| 90 | ×0,16 | een tiende — de laatste punten zijn een grind |
| 100 | ×0,12 | (de bodem; hoger dan 100 kan sowieso niet) |

Orde van grootte met ~3 wedstrijden en 2 oefenvluchten per week plus een coach: na 2 weken
ervaring 50, na 6 weken 80, ~11 weken voor 100.

### 3.8 Thuis = meteen weer beschikbaar

Zodra haar eigen race erop zit (finish, uitval of opgeven) is een duif weer vrij voor alles:
inschrijven voor een latere dag, trainen, koppelen, ziekenboeg, rustkuur, verkopen. Zolang ze
nog vliegt, kan je haar nergens voor inschrijven.

- **Estafette:** haar eigen etappe telt; valt een ploegmaat vóór haar uit, dan is ze meteen vrij.
- De energie is op dat moment al volledig betaald; conditie- en ervaringswinst, punten,
  medailles en weddenschappen volgen bij de afronding. Prijzengeld komt bij het finishen.
- Een duif die de weg kwijt is, is pas beschikbaar als ze thuiskomt.

### 3.9 Eén vlucht per duif per dag (harde regel)

- Geldt voor alle vluchtsoorten door elkaar, ook als de andere race al gevlogen is.
- Uitschrijven vóór de start geeft de dag terug (met het inschrijfgeld). Een gevlogen race
  niet, ook niet na DNF of opgeven. Een afgelaste vlucht telt niet.
- **Niet inzetbaar bij de lossing** (nog onderweg, de weg kwijt, ziek of gewond, in de
  ziekenboeg, op rustkuur, aan het koppelen): ze wordt van de vlucht gehaald, inschrijfgeld
  terug, met een melding; weddenschappen op haar worden terugbetaald. Bij een estafette gaat
  de hele ploeg eruit.
- De bots volgen dezelfde regel.

---

## 4. Voeding & verzorging (dagelijks)

Voeding en herstel gebeuren elke dag om **00:00** (Belgische tijd), voor alle duiven tegelijk.
Elke duif heeft haar eigen voertype en eet 1/7 van haar weekverbruik per dag uit de voorraad
van dat type. In *Mijn hok* toont elke eigenschap een ▲/▼ per dag volgens de huidige keuzes.
Bovenaan kies je **Kaarten** of **Lijst** (één regel per duif).

| Type | Voer/duif/week | Prijs/kg | Effect (per week) |
|---|---|---|---|
| Normaal | 1.0 kg | €3 | energie +21, gezondheid +5 |
| Premium | 1.5 kg | €6 | energie +28, gezondheid +9, **conditie +4** |
| Libido-mix | 1.4 kg | €4.5 | energie +18, gezondheid +5, **libido +14** |
| Herstel | 1.5 kg | €3 | **energie +42**, **gezondheid +12** |

Iedereen start met 50 kg Normaal. **Terugverkopen** kan aan **80 %** van de aankoopprijs. Voer
gaat per 0,1 kg; de aankoopprijs wordt naar boven afgerond op een euro, de terugkoop naar
beneden.

```
Energie   += (energie_per_week / 7) · (1 + Ervaring/200)   // ervaring = sneller herstel
Gezondheid+= (gezondheid_per_week / 7) · (1 + (100 − Gezondheid)/100) + Conditie/280
             // hoe verder gezakt, hoe sneller ze terugveert
```

- **In de ziekenboeg:** energieherstel aan 50 %, en enkel met de juiste staf (anders 0); geen
  rustbonus (§5.4).
- **Rustbonus:** elke 3e dag thuis mét eten geeft +4 energie. Een vlucht zet de teller op
  nul, een hongerdag breekt de reeks.

### 4.0 Honger & verhongeren

Is de voorraad van haar type op, dan lijdt de duif honger, elke dag erger. Trainbare
vaardigheden dalen er niet door. Weer eten zet de honger op 0.

```
dag N zonder eten:
  Energie   −= 8 · N
  Gezondheid−= 5 · N
  Libido    −= 4 · N
sterftekans = 0                          als N < 3
            = min(0.25 · (N−2), 0.95)    vanaf dag 3
            = 100%                        vanaf dag 7
```

### 4.1 Libido (dagelijkse drift)

```
doel = Conditie·0.5 + Energie·0.5
frisse minderheid (~12%, vast per duif): doel = max(doel, 65…89)
Libido += (doel − Libido) · 0.04
```

### 4.2 Vaste onkosten (dagelijks, automatisch)

```
onkosten/dag = 22                                    (vast, ongeacht hokgrootte)
             + onderhoud per duif (in schijven, zie hieronder)
             + dagloon per gecoachte duif           (coach, volgens haar score — §13)
             + 57 · dokters + 50 · kinesisten        (ziekenboegstaf, §5)
             + 6  · duiven_in_boeg (met medicatievoer)
             + hokinrichting en verzekeringspremies   (§5.2bis/§5.2ter)
```

Onderhoud per duif gaat in schijven (elke duif het tarief van haar eigen schijf):

| Schijf | Per duif/dag |
|---|---|
| duif 1 – 8 | €2 |
| duif 9 – 12 | €6 |
| duif 13 – 16 | €12 |
| duif 17 – 20 | €20 |

| Duiven | Onderhoud/dag | Per week |
|---|---|---|
| 8 | €38 | €266 |
| 10 | €50 | €350 |
| 12 | €62 | €434 |
| 14 | €86 | €602 |
| 16 | €110 | €770 |
| 18 | €150 | €1.050 |
| 20 | €190 | €1.330 |

*(De tweede tabel is inclusief de vaste €22.)*

Sponsors betalen op hetzelfde ritme (§12). De *Dagbalans* op het Overzicht toont kosten,
sponsorinkomsten en het saldo per dag. Onkosten kunnen de kassa onder nul duwen (§4.5).

### 4.3 Rustkuur

- Kost **€150** per duif en duurt **48 uur**; in die tijd kan de duif niets.
- Daarna in één keer **+40 energie en +15 gezondheid**, met een melding.
- Elke duif mag, ook meerdere tegelijk, maar **elke duif één keer per week**, geteld vanaf
  de start van haar kuur.
- Niet voor een duif die ingeschreven staat of al vol energie én gezondheid heeft.

### 4.4 Wat een wedstrijd aan gezondheid kost

```
gezondheidskost = ((0,5 + afstand/250) × (1 + (100 − energie bij aankomst)/100 × 0,8)
                   + extra bij uitval) × 1,15
```

Uitval onderweg: nog 4 tot 9 erbij, vóór de ×1,15. Opgeven en oefenvluchten kosten niets.

| Afstand | Thuis met 70 energie | Leeg thuis |
|---|---|---|
| 200 km | ≈ −1,9 | ≈ −2,7 |
| 300 km | ≈ −2,4 | ≈ −3,5 |
| 500 km | ≈ −3,6 | ≈ −5,2 |
| 1000 km | ≈ −6,4 | ≈ −9,3 |

### 4.5 Rode cijfers

| Wanneer | Wat er gebeurt |
|---|---|
| **Meteen** | Al je **privécoaches worden ontslagen** en je kan **niets meer kopen** |
| **Na 10 dagen** | Je duif met het **laagste talent** gaat 24 u onder de hamer |
| **Elke 10 dagen daarna** | De volgende duif volgt, tot je kassa weer klopt |

- **Kan niet in het rood:** duiven of voer kopen, trainen, koppelen, rustkuur, hernoemen,
  hok of ziekenboeg uitbreiden, personeel aannemen, wedden, bieden, inschrijven, een coach
  inhuren.
- **Kan wel:** een duif te koop zetten, voer terugverkopen, een bod aanvaarden, personeel
  ontslaan, een duif vrijlaten of naar de bistro brengen.
- **Gedwongen veiling:** de duif opent op haar marktwaarde (§9.0), loopt 24 uur, de volledige
  opbrengst is voor jou; zelf meebieden kan niet. Geen bod: ze blijft en gaat de volgende
  ronde 25 % lager onder de hamer.
- Je laatste duif wordt nooit geveild, en evenmin duiven die ingeschreven staan, koppelen of
  de weg kwijt zijn. De bots hebben een eigen kasvloer.

---

## 5. Ziekte, kwetsuur & ziekenboeg

### 5.1 Aandoeningen

- **Ziektes (besmettelijk):** Het Geel (licht), Duivenpokken, Ornithose, Coccidiose (matig),
  Paramyxovirose, Salmonellose (ernstig).
- **Kwetsuren door overbelasting:** verrekte borstspier (licht), verstuikte vleugel,
  borstbeenkneuzing (matig), botbreuk in de vleugel (ernstig).
- **Kwetsuren door pech:** gebroken slagpen, gekneusde poot (licht), sperwerverwonding (ernstig).

Bij het uitbreken: gezondheid **−10 / −22 / −38** (licht/matig/ernstig). Daarna per dag
**−0,6 / −1,5 / −2,5**, ×1,5 buiten de ziekenboeg.

### 5.2 Kans op ziekte (per dag, bij de dagovergang)

Elke gezonde, niet-geïsoleerde duif maakt kans, volgens dezelfde vluchtvorm als bij
blessures (§3.2). **IJzeren gestel** (§7ter): 30 % minder.

| Vluchtvorm | Kans om ziek te worden, per week |
|---|---|
| 90 (top) | ≈ 1 % |
| 75 (goed) | ≈ 3 % |
| 65 (normaal) | ≈ 5 % |
| 55 (matig) | ≈ 9 % |
| 45 (zwak) | ≈ 14 % |
| 30 (gevaarlijk) | ≈ 24 % |

**Besmetting gaat per ziekte:** een zieke duif buiten de ziekenboeg geeft haar eigen ziekte
door. Kans per week per hokgenoot, per zieke duif:

| Ziekte | Besmettelijk | Vluchtvorm 75 | Vluchtvorm 45 |
|---|---|---|---|
| Paramyxovirose (ernstig) | ×1,5 | ≈ 10 % | ≈ 18 % |
| Ornithose (matig) | ×1,3 | ≈ 8 % | ≈ 16 % |
| Het Geel (licht) | ×1,2 | ≈ 7,5 % | ≈ 14 % |
| Coccidiose (matig) | ×1 | ≈ 6 % | ≈ 12 % |
| Duivenpokken (matig) | ×0,7 | ≈ 4 % | ≈ 8 % |
| Salmonellose (ernstig) | ×0,6 | ≈ 3,5 % | ≈ 7 % |

Ernst van een spontane ziekte:

| Vluchtvorm | Licht | Matig | Ernstig |
|---|---|---|---|
| 80 of hoger | 55 % | 33 % | 12 % |
| 55 | 47 % | 34 % | 19 % |
| 30 | 40 % | 34 % | 26 % |

- Een duif in de ziekenboeg besmet niemand en wordt niet besmet. Een apart hok verlaagt de
  ziektekans.
- **Onbehandeld:** een ernstige aandoening die haar hele beloop buiten de ziekenboeg blijft,
  kost de duif in ~1 op 4 gevallen; in de ziekenboeg ~2 %. Lichte zijn nooit dodelijk (§6).

### 5.2bis Hokhygiëne & vers stro

Een meter van 0 tot 100; vers stro zet hem op 100. Wie nooit stro kocht, staat op 50 en
merkt niets.

```
stro          = €18 per baal, 1 baal per 8 plaatsen        (12 plaatsen = 2 balen = €36)
ziektekans   ×= 1 − 0,2 · (hygiëne − 50) / 50   als hygiëne > 50    (×0,8 bij 100)
             ×= 1                               als hygiëne ≤ 50    (zoals altijd)
verval/dag    = 8 · (duiven thuis / capaciteit) · (1,5 met een zieke duif buiten de ziekenboeg)
                · (0,75 met dakventilatie)
```

- **Hokpoetser:** per dag €10 t/m 8 duiven, €15 t/m 12, €20 t/m 14, €30 t/m 16, €45 t/m 18,
  €75 t/m 20; aannemen en ontslaan gratis. Onder **70** strooit hij vers stro (aan de gewone
  prijs). Besmetting tussen duiven ×0,85.
- **Bodem:** hygiëne, apart hok, poetser en IJzeren gestel samen maken de ziektekans nooit
  kleiner dan ×0,4.

### 5.2ter Hokinrichting, vaccins & diensten

Uitrusting koop je één keer (op te waarderen tot niveau 4); enkel de poetser, het vakblad en
een verzekering kosten per dag.

| Wat | Aankoop | Per dag | Effect |
|---|---|---|---|
| Dakventilatie | €1.200 | — | ornithose ×0,6; gezondheidsherstel uit voer +5 %; hygiëne zakt 25 % trager |
| Buitenren | €2.500 | — | rustbonus +6 i.p.v. +4; libido-doel +3; zonder afweer gemiddeld 1× per 40 dagen een sperwer: wie thuis rust −6 energie |
| Roofvogelafweer | €900 | — | vraagt een ren; geen sperwer in de ren; "Sperwer in de buurt" wordt ongevaarlijk |
| Kunstlicht | €700 | — | libido-doel +6 |
| Infrarood nestbakken | €1.600 voor 2, +€500/bak | — | uitkomen ×1,15 sneller, +6 pp tweelingkans, onder 10 °C +4 pp succes |
| Betere reismanden | €1.000 | — | vlucht −3 % energie, −5 % gezondheid |
| Weerstation | €1.500 | — | voorspelling vanaf 24 u vóór de lossing |
| Duivenlokker | €500, tot niveau 5 (§9.2bis) | — | vangt soms een duif die een andere speler vrijlaat |
| Vakblad | — | €6 | bandbreedtes (±6) bij andermans duif; marktrapport 28 dagen; maandag Het Duivenblad |

**Vaccins & kuren** (per ziekte, buiten de bodem ×0,4), elk met één vaste prijs:
PMV €10 (91 d, 80 %), pokken €8 (91 d, 80 %), salmonella €6 (45 d, 60 %) — een vaccin =
2 dagen niet vliegen; geelkuur €5 (7 d, 75 %), coccidiosekuur €5 (10 d, 75 %),
ademhalingskuur €5 (7 d, 60 %, libido −10).

| Middel | Loont vanaf een marktwaarde van | Topduif (~€37.000) haalt |
|---|---|---|
| PMV-vaccin €10 | ~€6.400 | 3,8× de prijs |
| Pokkenvaccin €8 | ~€8.600 | 2,6× |
| Salmonellavaccin €6 | ~€11.400 | 2,3× |
| Geel-, coccidiose-, ademhalingskuur €5 | geen realistische duif | 0,2–0,5× |

**Verzekering:** uitkering 60 % van de marktwaarde bij afsluiten; premie/dag =
1,3 × uitkering × (0,04 % + ouderdomssterfte per dag). Niet gedekt: honger, vertrekken met
< 5 energie, een ziekte die nooit in de ziekenboeg lag, de eerste 7 dagen. Vervalt bij verkoop.

**Bots** kopen vers stro (meter ≤ 60) en dakventilatie, verder niets.

### 5.3 Herstel (in echte tijd)

Zolang ze niet genezen is, kan een duif niet vliegen, trainen of broeden. Rustend in het hok:

```
licht ~5 dagen · matig ~11 dagen · ernstig ~18 dagen
```

Versnellers stapelen: ziekenboeg ×1,8, een dekkende dokter/kinesist ×1,4, medicinaal voer
×1,2. Met alles: licht ~1,5 dag, matig ~3,5, ernstig ~6. Elke 12 uur komt er per
herstellende duif een statusbericht.

### 5.4 De ziekenboeg

- Capaciteit **2** (uitbreidbaar naar 3/4/5/6 voor €800/1200/1800/2400).
- **Medicinaal voer** €6/duif/dag. **Dokter** €57/dag, behandelt 2 zieke duiven.
  **Kinesist** €50/dag, behandelt 2 gekwetste.
- Meer patiënten dan plaatsen: je zet zelf een duif vast ("📌 Deze duif laten behandelen");
  de overige plaatsen gaan naar de ernstigste gevallen.
- **Personeel wordt elke dag betaald, ook zonder patiënt** van zijn soort. Het spel
  waarschuwt: op de pagina, met ⚠️ in de Dagbalans en hoogstens één melding per week.
- Energie in de ziekenboeg: zie §4.

---

## 6. Leeftijd & sterfte

- Duiven verouderen **4× versneld**: 4 speelweken per echte week. Een jong is na ~2 echte
  weken vliegklaar (8 weken).
- **Leeftijdscurve** (vermenigvuldiger): 0 wk → 0,0 · 8 wk → 0,6 · 20 wk → 0,85 · 1 jaar →
  1,0, daarna vlak.
- **Verouderen:** vanaf ~4 duivenjaar verliest een duif per speelweek wat snelheid, conditie
  en oriëntatie, steeds sneller; het tempo verschilt per duif (`declineRate` ~0,6–1,6×).
- **Sterfte:** ouderdom één keer per speelweek; een onbehandelde aandoening elke dag
  (weekkans → dagkans via `1 − (1 − p)^(1/7)`). Vóór haar vierde verjaardag sterft een duif
  nooit van ouderdom. Elk overlijden geeft een melding met de reden.

```
leeftijd (interp, per week): tot 4j 0 · 6j 0.006 · 8j 0.025 · 10j 0.07 · 12j 0.16 · 15j 0.40
onbehandelde aandoening (per week):
    buiten de boeg: matig +0.03 · ernstig +0.10
    in de boeg:     matig +0.005 · ernstig +0.025
```

---

## 7. Kweken (broeden)

**Voorwaarden:** een doffer en een duivin, beide minstens 8 weken, energie ≥ 20, gezond, niet
in de ziekenboeg, niet ingeschreven voor een vlucht, niet aan het uitrusten van een vorig
nest (§7.2). Kost **€750** en −15 energie per ouder, meteen bij het koppelen. Een broedende
duif kan niet vliegen; het koppel stoppen kan altijd, zonder terugbetaling.

```
libido_gem  = (Libido_vader + Libido_moeder) / 2
energie_gem = (Energie_vader + Energie_moeder) / 2
energiefactor = clamp(0.5 + energie_gem/200, 0.5, 1)      // lage energie halveert de kans
succeskans  = clamp((0.55 + libido_gem/100 · 0.45) · energiefactor, 0.2, 1)
```

```
tweelingkans = clamp(libido_gem/100 · 0.7 · energiefactor, 0, 0.7)
```

- **Uitkomen** gebeurt op een willekeurig moment, sneller bij hoger libido en energie:
  gemiddeld ~1,3 dag bij fertiliteit 90, ~4,9 dag bij 20. Eén melding per nest.
- **Overerving:** elke vaardigheid = gemiddelde van de ouders ± 8, begrensd op de gen-cap van
  het jong. De genen zelf (plafonds, verouderingstempo) erven ook: gemiddelde ± mutatie.

### 7.1 Een vol hok bij het uitkomen

Het hele nest wacht bij *Kweek* tot je per jong **houden** of niet kiest; wat je niet kiest,
vliegt weg. Plaats maken kan vanuit hetzelfde scherm (vrijlaten of het restaurant, §9.2).

- Zolang een nest wacht, kan je geen nieuw koppel starten. Het nest verloopt niet.
- Jongen in het nest eten niet, kosten niets en worden niet ziek; hun geboortedatum ligt vast.
- Dezelfde wachtkamer geldt voor een duif uit een gebeurtenis (§12) bij een vol hok, en
  altijd voor een duif die je duivenlokker ving (§9.2bis). Die tellen niet als nest.

### 7.2 Na het nest

**Een koppel is voor één nest**, ook bij een lege worp. Daarna **rusten beide ouders
21 dagen**, per duif en geteld vanaf het uitkomen. Een lege worp legt geen rust op. De bots
volgen dezelfde regel.

| Wat er gebeurt | Krijg je iets terug? |
|---|---|
| De worp komt leeg uit | **€375** (de helft) |
| Er komt één jong of een tweeling | niets — je hebt waar je voor betaalde |
| Je **stopt het koppel zelf** (knop bij *Kweek*) | niets |
| Een ouder wordt verkocht of sterft, het koppel vervalt | niets |

### 7.3 Stamboom & inteelt

Op de duifpagina staat de kaart *Familie*; "Toon volledige stamboom" opent één diagram met
voorouders (tot overgrootouders), broers en zussen, partners en nakomelingen. Een tak stopt
bij een duif die er niet meer is.

Kweken met familie mag, na een waarschuwing, maar het jong betaalt: lagere gen-caps en een
kans op een zichtbare afwijking (ze vliegt dan ook een tikje trager). Verwantschap wordt tot
drie generaties terug bekeken, via levende duiven. Bots kweken nooit met familie.

| Verwantschap | Plafonds omlaag | Kans op een afwijking |
|---|---|---|
| Ouder, kind of grootouder | −22 | 85 % |
| Volle broer en zus | −18 | 75 % |
| Halfbroer en halfzus | −11 | 45 % |
| Verder familie | −5 | 15 % |

### 7.4 Samen kweken met de duif van een andere speler

Enkel tussen echte spelers, bij *Kweek → Samen kweken*. Geen duif verandert van eigenaar.

1. **Aanbieden** (gratis): een eigen duif van minstens 8 weken. Je kiest wat je wil — **de
   jongen** (jij betaalt de vergoeding) of **de vergoeding** — en de minimumeisen voor de
   partner (score, energie, libido). Een aangeboden duif is voor iedereen volledig zichtbaar.
2. **Voorstellen:** een andere speler kiest een eigen duif van het andere geslacht die aan
   de eisen voldoet en noemt een bedrag (€0 mag). Hij ziet de geschatte score en marktwaarde
   van het jong.
3. **Onderhandelen:** enkel over het bedrag; akkoord, tegenvoorstel of weigeren.
4. **Akkoord = meteen broeden.** Beide duiven moeten op dat moment kunnen broeden (§7) en de
   partner moet nog aan de eisen voldoen. **Elke speler betaalt €1.000**; beide duiven −15
   energie. Wie de jongen krijgt, moet ook de vergoeding kunnen betalen en mag geen wachtend
   nest hebben.

- Een aangeboden of voorgestelde duif moet gezond en thuis zijn, en kan niet ingeschreven
  worden voor een vlucht.
- Het nest loopt als een gewoon nest. Alle jongen gaan naar dezelfde speler; de vergoeding
  wordt betaald wanneer de jongen er zijn.
- Eigen uitrusting (infrarood) telt niet mee. Inteelt geldt ook hier.

```
per vaardigheid:  gemiddelde van de ouders ± 8,
                  begrensd door de gen-cap van het jong
                  (gemiddelde van de ouders ± 6, lager bij inteelt, §7.3)
geschatte score = gemiddelde van snelheid, conditie en oriëntatie
```

| Wat er gebeurt | Wie de jongen krijgt | De andere speler |
|---|---|---|
| Akkoord | betaalt €1.000 | betaalt €1.000 |
| Jongen geboren | krijgt alle jongen, betaalt de vergoeding | ontvangt de vergoeding |
| Lege worp | krijgt €500 terug | krijgt €500 terug |
| Nest gestopt / ouder sterft | niets terug | niets terug |

---

## 7bis. Genen: het aangeboren plafond

Snelheid, conditie en oriëntatie hebben elk een aangeboren maximum per duif: hoogstens **95**,
meestal lager. Betere bronnen (dure veilingduiven) loten hoger, opvangduiven lager. Een rood
streepje op de statbalk toont de cap; hogere genen maken een duif meer waard.

| Cap-bereik | Kans | |
|---|---|---|
| 70–73 | ~1 % | zeer zeldzaam (ondergrens) |
| 74–77 | ~10 % | zwakke aanleg |
| 78–81 | ~26 % | ondergemiddeld |
| 82–85 | ~34 % | gemiddeld |
| 86–89 | ~22 % | bovengemiddeld |
| 90–93 | ~7 % | sterk |
| 94–95 | ~1 % | uitzonderlijk (topgenen) |

---

## 7ter. Kenmerken

Eén kenmerk per duif, voor het leven, publiek zichtbaar, altijd een voordeel. Elke nieuwe
duif: **30 %** kans, daarvan 80 % gewoon / 20 % zeldzaam.

| Kenmerk | Zeldzaamheid | Soort | Wanneer | Effect |
|---|---|---|---|---|
| 🌬️ Snelle flapper | gewoon | statisch | rugwind (along > 6 km/u) | +5 % snelheid |
| 🪨 Stormbreker | gewoon | statisch | tegenwind (along < −6 km/u) | +5 % |
| 🌧️ Regenvogel | gewoon | statisch | regen | +5 % |
| ☀️ Mooiweervlieger | gewoon | statisch | droog en \|along\| ≤ 6 | +5 % |
| 🌙 Nachtvlieger | gewoon | dynamisch | zolang het donker is | +5 % |
| ⚡ Sprinter | gewoon | statisch | vlucht ≤ 200 km | +5 % |
| 🏔️ Fondvogel | gewoon | statisch | vlucht ≥ 600 km | +5 % |
| 🐦 Sociale duif | gewoon | dynamisch | ≥ 2 andere duiven binnen 10 km | +5 % |
| 🦅 Eenzaat | gewoon | dynamisch | geen enkele duif binnen 10 km | +5 % |
| ❄️ Koudevlieger | zeldzaam | statisch | onder 10 °C | +5 % |
| 🔥 Zomervogel | zeldzaam | statisch | vanaf 10 °C | +5 % |
| 🌞 Dagvlieger | zeldzaam | dynamisch | zolang het licht is | +5 % |
| 🧭 Thuisvinder | zeldzaam | passief | altijd | verdwaalkans ×0,75 (§3.5) |
| 🔋 Zuinige vlieger | zeldzaam | passief | altijd | energieverbruik ×0,92 (§3) |
| 🛡️ IJzeren gestel | zeldzaam | passief | altijd | ziektekans ×0,7 (§5.2) |

- **Bonus:** een statisch kenmerk versnelt alle 10 stukken van het tempo-profiel met 5 %,
  een dynamisch enkel het deel waar het geldt. Alles wordt bij de lossing bevroren.
- **Licht en donker:** de zonshoogte wordt op 4 momenten per stuk berekend, op de plek waar
  de duif dan vliegt.
- **Gezelschap:** elke 5 minuten worden de vliegende duiven binnen 10 km geteld (eigen
  duiven tellen mee; thuis of uitgevallen niet).
- **Overerving:** elke ouder geeft zijn kenmerk door met 35 % (eerst de vader); hebben beide
  hetzelfde: 60 %. Anders de gewone loting.
- **Waarde:** gewoon +5 %, zeldzaam +12 % op de modelwaarde (§9.0).
- **Weddenschappen** rekenen een kenmerk mee aan zijn verwachte waarde.
- Gemeten: in haar eigen situatie wint een duif met kenmerk ~65–70 % van de duels tegen een
  identieke duif zonder.

---

## 8. Training & de drie groeitrappen

| Bereik | Hoe je er groeit |
|---|---|
| **0 → 80** | **trainen**, **vluchten** of een **coach** |
| **80 → 90** | **vluchten** of een **coach** |
| **90 → gen-cap** | enkel een **privécoach** (§13) |

**Handmatig trainen:** 15 energie, altijd precies **+1** (+4 ervaring × de leerfactor), tot
**80** of de gen-cap. Enkel als de duif thuis is, en elke eigenschap één keer per week.

| Van → naar | Kost |
|---|---|
| 40 → 41 | ~€40 |
| 50 → 51 | ~€125 |
| 60 → 61 | ~€355 |
| 70 → 71 | ~€1.035 |
| 79 → 80 | **~€2.700** |

---

## 9. Markt

- Enkel duiven van echte spelers staan te koop. De verkoopgeschiedenis toont de laatste
  7 dagen.
- Een **oranje stipje** op de Markt-knop meldt een nieuw zoekertje of een nieuwe veiling,
  tot je de markt opent.

### 9.0 Wat is een duif waard?

De geschatte waarde komt uit **echte verkopen** (markt, privébod, veiling), elk onthouden
met het talent van de duif.

- Vergelijkbare duiven bepalen de prijs: een paar punten talent verschil telt bijna volledig
  mee, twaalf punten nauwelijks.
- Een nieuwere verkoop weegt zwaarder (het gewicht halveert elke **10 dagen**); een verkoop
  telt **60 dagen** mee. Zonder nieuwere verkoop blijft de prijs staan.
- Een betere duif is nooit minder waard dan een mindere.
- Zonder verkopen: een model op talent, genen, leeftijd en ervaring.
- Niets wisselt van eigenaar onder **1/5 van de waarde**. Een veiling start op 30 % ervan.

### 9.1 Te koop zetten

Je geeft een **marktprijs** op (wie die betaalt, koopt meteen) en optioneel een **bieden
vanaf** (daarboven mogen anderen bieden; jij aanvaardt of weigert).

- Prijs, ondergrens en elk bod liggen minstens op 1/5 van de waarde. De ondergrens mag niet
  boven de prijs liggen; een bod op of boven de prijs wordt geweigerd.
- Je krijgt een bel bij elk nieuw of verhoogd bod. Aanvaard je, dan verkoop je voor het
  geboden bedrag. Wordt de duif voor de volle prijs gekocht, dan vervallen de biedingen.
- Je eigen zoekertje zie je op de markt staan en kan je daar uit de verkoop halen.
- **Bots** kopen en bieden op jouw duiven, nooit boven de marktwaarde en niet in de eerste
  24 uur (§17). Zelf verkopen ze tegen hun vraagprijs; op hun duiven kan je niet bieden.
- **Zoekertje naar boven** (€50): 12 uur bovenaan. Er is één plek; een latere boost neemt ze
  over. Weg bij verkoop of uit de verkoop halen. Niet in het rood; bots boosten nooit.

### 9.1b Privé-biedingen

Bieden op een duif die niet te koop staat, kan via de Markt (kies een speler, dan een duif,
dan een bedrag) of op de duifpagina. Van zo'n duif zie je enkel de algemene score, de
waarde, het geslacht, de leeftijd en het ras. Duiven die te koop of in veiling staan, zie je
volledig.

- Het geld wordt niet vastgehouden; het wordt gecontroleerd bij het aanvaarden.
- Eén lopend bod per duif; intrekken kan altijd. De eigenaar ziet het bij de Markt.
- Bij aanvaarden vervallen de andere biedingen op die duif.

### 9.2 Afscheid nemen van een duif

Op de duifpagina (eerst uitschrijven als ze ingeschreven staat):

- **🕊️ Vrijlaten:** €0, geen gevolgen voor de rest. Een duivenlokker kan haar vangen (§9.2bis).
- **🍲 Bistro De Laatste Vlucht:** **€50**, maar elke andere duif verliest 1 tot 5 energie.

Openstaande biedingen op de duif vervallen.

### 9.2bis De duivenlokker

Te koop bij *Inrichting → Uitrusting*, op te waarderen tot niveau 5. Eenmalig, geen dagkost.
Enkel echte spelers.

| Niveau | Prijs | Samen | Trekkracht | Kans als enige lokker | Naast één lokker van hetzelfde niveau |
|---|---|---|---|---|---|
| 1 | €500 | €500 | 10 | 10 % | 9,1 % |
| 2 | €750 | €1.250 | 14 | 13,5 % | 11,9 % |
| 3 | €1.500 | €2.750 | 19 | 17,4 % | 14,8 % |
| 4 | €3.000 | €5.750 | 25 | 21,7 % | 17,9 % |
| 5 | €5.000 | €10.750 | 32 | 26,2 % | 20,8 % |

Laat een speler een duif vrij, dan maakt de lokker van elke andere speler kans. De vrije
lucht trekt met **90**:

```
kans voor lokker i      = trekkracht_i ÷ (90 + Σ trekkracht van alle lokkers)
kans dat ze verdwijnt   = 90 ÷ (90 + Σ trekkracht van alle lokkers)
```

- Ze landt bij hoogstens één lokker; je eigen lokker vangt nooit je eigen duif.
- De vanger krijgt een bel; de duif wacht bij *Kweek* (§7.1) tot hij **houden** of **laten
  gaan** kiest. Laten gaan = voorgoed weg. Ze houdt haar vaardigheden, genen, leeftijd,
  ervaring, vaccins, stamboom en historiek; coach, apart hok, verzekering, zoekertje en
  kweekaanbod blijven achter.
- Wie vrijlaat, hoort meteen of ze gevangen werd of verdween.
- **Niet gelokt:** een duif voor het restaurant, een jong of gebeurtenisduif die je in de
  wachtkamer niet houdt, duiven van bots, een duif in een veiling.

### 9.3 Bieden op een veiling

| Tijd tot het einde | Wat mag je? |
|---|---|
| meer dan **30 minuten** | onbeperkt bieden, zo vaak je wil |
| laatste **30 minuten** | nog **maximaal 3 biedingen** per speler, op die duif |
| laatste **5 minuten** | elk bod zet de klok terug op **5 minuten** (anti-snipe) |

De veilingkaart toont je tegoed in de slotfase. Een bod in de laatste 5 minuten telt gewoon
mee voor je drie. De countdown en de biedingen lopen live mee.

---

## 10. Namen

Doffers krijgen mannennamen, duivinnen vrouwennamen, met een bijnaam (bv. *Dirk de
Doodgraver*). **Elke naam is uniek** in de club; raakt de voorraad op, dan volgt *II*, *III*.
Hernoemen kost geld (§13) en blijft uniek.

### 10.1 Tags op je duiven

- Tot **3 tags** per duif, elk hoogstens **20 tekens**, gescheiden door een komma. Gratis.
- Zichtbaar in *Mijn hok*, op de duifpagina en bij het inschrijven. **Enkel jij** ziet ze.
- Geen invloed op het spel. Bij een eigendomswissel verdwijnen ze.

---

## 11. Meldingen (belknop)

Bij een vluchtuitslag, verbetering, kwetsuur, ziekte, herstel, sterfte en geboorte, en één
keer bij een groot nieuw onderdeel.

## 11bis. De Stem

Het ideeënbord: spelers stemmen (één stem per speler per idee, intrekbaar; bots stemmen
niet; de beheerder ziet wie stemde), reageren in een draad per idee, en dienen zelf ideeën
in (**maximaal 3 per dag**; iedereen krijgt er een melding van).

| Label | Wat het wil zeggen |
|---|---|
| **In stemming** | kandidaat — hierop kan je stemmen |
| **Gepland** | weerhouden, wordt gebouwd |
| **In het spel** | zit er intussen in; stemmen kan niet meer |
| **Niet weerhouden** | gaat er niet komen, met de reden in de draad |

Enkel de beheerder verzet de labels. Een idee wordt nooit herschreven of gewist.

## 11ter. Het Lokaal

Een vrije chat met alle spelers: hoogstens **500 tekens** per bericht, minstens **2 seconden**
ertussen, ververst elke ~15 seconden. Een bolletje op de knop meldt ongelezen berichten.
Eigen berichten kan je weghalen, de beheerder elk bericht. Berichten blijven **30 dagen**.

## 12. Dagopdrachten, gebeurtenissen, veilingen & sponsors

**Dagopdrachten.** 3 per dag (~€15–60 elk) plus XP. Een streakbonus per speeldag: €5 + €2 per
streakdag, tot €25. Samen ~€750 per week.

**Gebeurtenissen (dilemma's).** Ongeveer 1 op 3 dagen een keuzekaart: koopman, verdwaalde
duif, griepgolf, frituursponsor, kwakzalver, hittegolf, dorpsfeest, kat in een zak, dubieuze
sportarts, erfenis (spaarpot **€2.000**, oude kampioen of jonge belofte), talentenjager,
sperwer, liefdadigheidsvlucht. Een duif uit een gebeurtenis gaat bij een vol hok naar de
wachtkamer (§7.1).

**De markt volgt het spel.** Veilingduiven krijgen een score ten opzichte van het gemiddelde
talent van alle duiven in een hok (spelers en bots), begrensd tussen **40** en **78**.

**Zondagveiling.** Elke zondag twee duiven:

| Zondagduif | Algemene score | Bij een gemiddelde van 65 | Loopt van | tot (Brussel) |
|---|---|---|---|---|
| Duif 1 | gemiddelde −5 tot +5 | 60 – 70 | 10:00 | 20:00 |
| Duif 2 | gemiddelde +5 tot +15 | 70 – 80 | 11:00 | 21:00 |

- Beide gaan uit van het gemiddelde op het moment dat duif 1 opent.
- Heb je het hoogste bod op de ene, dan kan je pas op de andere bieden met 2 vrije plaatsen.
- Geld dat je biedt moet je hebben, maar het wordt niet vastgehouden. Bij sluiting wint de
  hoogste bieder die nog kan betalen en plaats heeft; anders de volgende.
- Je krijgt een melding als je overboden wordt, en bij sluiting als je niet wint (met de reden).
- Zolang een zondagveiling loopt, komt er geen opvangduif tussen.

**Opvangcentrum-veiling.** Gemiddeld 1 per 60 uur. Meestal gemiddelde −10 tot −3, ongeveer
1 op 5 keer −3 tot +3. Startbod **€25**, 24 uur. Geen bel, wel het stipje op de Markt-knop.

**Sponsors.**

- Een aanbod komt enkel na een **competitievlucht waaraan je deelnam**: 50 % kans na een
  zege, 25 % na een podium, 10 % na deelnemen. Hoogstens één per keer, minstens 6 uur
  ertussen, hoogstens 2 openstaande aanbiedingen.
- Vier tiers; een tier opent ook op spelersniveau (tier 1 meteen · 2: niveau 3 · 3: niveau 6
  · 4: niveau 10) of op resultaten.
- Aanvaarden geeft eenmalig tekengeld, daarna een dagbedrag en een **podiumpremie** per
  podiumplaats op een wedstrijdvlucht (niet op oefenvlucht, titan, estafette of league):

| Niveau | 1e plaats | 2e plaats | 3e plaats |
|---|---|---|---|
| Regionaal | ×0,6 | ×0,36 | ×0,21 |
| Nationaal | **×1,0** | ×0,6 | ×0,35 |
| Internationaal | ×1,8 | ×1,08 | ×0,63 |

- Orde van grootte: tier 1 €25–40 per dag en €50–70 voor een nationale zege; tier 4 €75–100
  per dag en €235–310.
- **Hoogstens 6 sponsors**, en per categorie één. Een zevende tekenen of overstappen binnen
  een categorie = een contract opzeggen tegen een verbrekingsvergoeding.
- Weigeren: de sponsor kan na ~3 dagen terugkomen. **Uitzondering:** een concurrent van een
  sponsor die je al hebt en die niet méér betaalt, is definitief weg (met een waarschuwing
  vooraf). Een hogere tier komt altijd terug.
- **Een sponsor stapt zelf op** als je seizoenspunten onder 60 % van het vorige seizoen
  zakken. Het eerste seizoen is enkel ijkpunt; een seizoen onder 20 punten telt niet.

## 13. Je geld uitgeven: hok, voeding & coaches

**Hokcapaciteit.** Start op 8, uitbreiden per twee:

| Stap | Prijs | Cumulatief vanaf 8 |
|---|---|---|
| 8 → 10 | €1.500 | €1.500 |
| 10 → 12 | €3.500 | €5.000 |
| 12 → 14 | €10.000 | €15.000 |
| 14 → 16 | €17.500 | €32.500 |
| 16 → 18 | €30.000 | €62.500 |
| 18 → 20 | €50.000 | €112.500 |

**Aparte hokken.** Los te kopen (telkens duurder); je kiest zelf welke duiven er een krijgen.
Een duif in een apart hok herstelt sneller energie en wordt minder snel ziek. Gaat ze naar
de ziekenboeg, dan komt haar hok vrij; ze krijgt er bij terugkeer weer een als er een vrij is.

**Ziekenboeg uitbreiden:** §5.4. **Voer per duif:** §4.

**Privécoach.** Per duif, tegen een dagloon volgens haar score, elke dag opnieuw bepaald:

| Algemene score | Coach per dag |
|---|---|
| lager dan 65 | €80 |
| 65 tot 70 | €100 |
| 70 tot 75 | €140 |
| 75 tot 80 | €180 |
| 80 tot 85 | €220 |
| 85 tot 90 | €300 |
| 90 en hoger | €400 |

- Traint elke dag snelheid, conditie, oriëntatie en ervaring richting de gen-cap; de winst
  krimpt naarmate een eigenschap haar cap nadert. Werkt niet terwijl de duif vliegt.
- **Plafonds samengevat:** trainen tot 80, vluchten tot 90, premiumvoer bouwt conditie mee
  op tot 80, enkel de coach gaat boven 90 (tot de gen-cap, max 95).

**Hernoemen:** een duif €1.000, je hok €2.000.

### 13.1 De bank: lenen

Wat je de bank nog moet terugbetalen (rente inbegrepen) mag nooit meer zijn dan **10 dagen
van je gemiddelde inkomsten**, met een maximum van **€50.000**:

```
gemiddelde = inkomsten van de laatste 14 volle dagen / 14     (vandaag telt pas na middernacht mee)
limiet     = min(€50.000, gemiddelde × 10), afgerond naar beneden op €100
nog vrij   = limiet − wat je nog terug moet betalen
```

- **Telt als inkomsten:** prijzengeld, sponsors (dagbedrag, podiumpremies, tekengeld),
  seizoens- en leagueprijzen, dagopdrachten.
- **Telt niet:** een duif verkopen, terugbetaald inschrijfgeld, weddenschappen, gebeurtenissen.

| Looptijd | Rente | Leen je €5.000 | Samen terug |
|---|---|---|---|
| 7 dagen | 5 % | €750 per dag | €5.250 |
| 14 dagen | 10 % | €393 per dag | €5.500 |
| 28 dagen | 20 % | €215 per dag | €6.000 |

```
terug te betalen = bedrag × (1 + rente), naar boven afgerond op €1
per dag          = nog terug te betalen / dagen die nog resten, naar boven afgerond op €1
                   (zo is het na precies de looptijd afbetaald; sommige dagen €1 minder)
```

- Je leent vanaf **€100**, in stappen van €100, en hebt hoogstens **5 leningen** tegelijk.
- **Afbetalen** gebeurt elke middernacht, samen met de onkosten (§4.2), en gaat altijd door,
  ook in het rood (§4.5). Wie in het rood staat, krijgt geen lening.
- **Aflossen** kan altijd, rente inbegrepen: het spaart geen rente uit maar maakt je limiet vrij.
- De bots lenen niet.

## 14. Weddenschappen

- Vanaf **12 uur voor de start** tot de start, **één weddenschap per vlucht**, inzet
  **€10–€500**. Enkel op regionale, nationale en internationale wedstrijdvluchten.
- **Types:** wint de vlucht · duif in top 3 · eindigt allerlaatste (van wie thuiskomt) ·
  eigen duif in top 3 · een van mijn duiven wint · komt eerder thuis dan… (kop-aan-kop).
- De kans komt uit een Monte-Carlo-simulatie van hetzelfde racemodel; de ratio volgt de
  kans, met een marge voor het huis. De inzet gaat er meteen af; winst = inzet × ratio.
- **Terugbetaling:** wordt de duif (of haar tegenstander) uitgeschreven, dan krijg je je
  inzet meteen terug; bij "een van mijn duiven wint" zodra je laatste duif eruit is. Ook bij
  een afgelaste vlucht.
- Afgeronde weddenschappen blijven 24 uur zichtbaar onder *Vluchten → Uitslagen*.

## 15. Seizoenen, ranglijst & prijzen

### 15.1 Seizoensklok

Een seizoen duurt **4 weken** van 7 echte dagen. Na week 4: prijsuitreiking, een nieuw
seizoen en de ranglijst op nul. De interne speelweek (leeftijd) loopt apart door.

### 15.2 Melkerranglijst → de Roekoe

Op seizoenspunten; enkel wedstrijdvluchten geven die. Bots dingen mee.

| Plaats | Prijs | Prijzengeld |
|---|---|---|
| 1e | **de Gouden Roekoe** | €2.000 |
| 2e | **de Zilveren Roekoe** | €1.700 |
| 3e | **de Bronzen Roekoe** | €1.400 |
| 4e en verder | 💰 **seizoenspremie** | je seizoenspunten ÷ 3 |

De winnaar krijgt ook de badge *Seizoenskampioen*. Buiten de top 3: punten ÷ 3 in euro, naar
beneden afgerond. De kolom *Winst* telt de zeges van dit seizoen; je totaal staat op je profiel.

### 15.3 Duivenranglijsten → de Vleugel

Drie ranglijsten van individuele duiven (top 10) per seizoen. Alle vluchten tellen behalve
oefenvluchten. De leagues hebben daarnaast hun eigen standen (§2.10).

- **⚡ Snelste duiven:** het beste ritgemiddelde (afstand ÷ vluchttijd) van één wedstrijd.
- **🎖️ Meeste podiums:** aantal top-3-plaatsen.
- **📈 Meeste vooruitgang:** groei van snelheid + conditie + oriëntatie + libido + ervaring
  sinds de seizoensstart.

De top 3 van elke lijst wint een Vleugel; het geld gaat naar de eigenaar:

| Plaats | Prijs | Prijzengeld |
|---|---|---|
| 1e | **de Gouden Vleugel** | €1.000 |
| 2e | **de Zilveren Vleugel** | €750 |
| 3e | **de Bronzen Vleugel** | €500 |

### 15.4 Prestige

Roekoes en Vleugels staan bij *Prestaties → Seizoensprijzen*. Wie iets wint, krijgt een
melding en bij het eerstvolgende bezoek een prijsuitreiking op het scherm.

### 15.5 Medailles: een podium is een podium

Elke top-3-plaats geeft goud, zilver of brons, levenslang bijgehouden; ze voeden de
podiumbadges.

| Wedstrijd | Medaille bij een podium? | Seizoenspunten? |
|---|---|---|
| Regionaal / nationaal / internationaal | ✅ | ✅ |
| Titanenwedstrijd (§2.8) | ✅ | ❌ |
| Estafettevlucht (§2.9) | ✅ (één per ploeg) | ❌ |
| Leagues (§2.10) | ✅ | ❌ |
| Oefenvlucht (§2.7) | ❌ | ❌ |

- Meerdere duiven op het podium = meerdere medailles; een estafetteploeg telt als één.
- Een duif die niet finisht, levert geen medaille op.
- De badges *Regiowinnaar*, *Nationale zege* en *Internationale zege*, de kolom *Winst* en
  de sponsordrempels tellen enkel zeges op de drie competitieniveaus.

---

## 16. Rassen

Het ras bepaalt de foto en heeft een zeldzaamheid; verder is het cosmetisch, op een kleine
prijstoeslag na.

### 16.1 Toewijzing

Elke nieuwe duif krijgt een ras volgens een gewogen loting:

| Ras | Zeldzaamheid | Kans | Prijstoeslag |
|---|---|---|---|
| De Stadsduif | Algemeen | 20,8 % | — |
| Blauwe Geschelpte | Algemeen | 14,4 % | — |
| Blauwe Band | Algemeen | 14,4 % | — |
| Rode | Algemeen | 12,8 % | — |
| Schimmel | Algemeen | 12,8 % | — |
| Bruine | Ongewoon | 8,0 % | +8 % |
| Witte | Ongewoon | 8,0 % | +8 % |
| Vale | Ongewoon | 4,8 % | +8 % |
| Meulemans | Zeldzaam | 2,4 % | +20 % |
| Bonte | Legendarisch | 0,8 % | +40 % |
| Golden Ace | Legendarisch | 0,8 % | +40 % |

### 16.2 Kweken

Hebben beide ouders hetzelfde ras, dan behoudt het jong dat ras; anders wordt het **Gemengd**
(zonder toeslag).

### 16.3 Verzamelbadges

Onder *Prestaties → Rassen*: een badge per ras, per zeldzaamheid (plus *Mengelmoes* voor een
zelf gekweekte Gemengde), en *Rassenverzamelaar* voor alle rassen tegelijk (+500 XP).

---

## 17. De computermelkers (bots)

Acht bots vullen het veld en spelen met dezelfde regels, zonder extra geld of betere duiven.

- **Hok:** ze kopen voer (Herstelvoer zodra ze het kunnen betalen), gebruiken de ziekenboeg
  en personeel, geven rustkuren, huren coaches, breiden uit en kweken.
- **Inschrijven:** tot vlak voor de lossing bekijken ze elke geplande vlucht opnieuw. Ze
  zetten een duif enkel in als ze de afstand aankan en gezond genoeg is, en houden een koppel
  thuis als hun hok dun wordt. Bij de estafette geldt geen energiedrempel.
- **Zelfde beperkingen:** één vlucht per duif per dag (§3.9), 21 dagen rust na een nest en
  €375 terug bij een lege worp (§7.2), nooit kweken met familie (§7.3).
- **Doen niet:** oefenvluchten, samen kweken (§7.4), lenen (§13.1), stemmen of chatten, een
  duivenlokker kopen, boosten.
- **Markt:** ze kopen duiven van spelers als die hun hok verbeteren, of bieden rond de
  marktwaarde als er een *bieden vanaf* staat; nooit ver boven de geschatte waarde. Een vol
  bothok laat zijn slechtste duif gaan. **De eerste 24 uur is een zoekertje enkel voor
  spelers** (🆕 op de markt). Op hun duiven kan je niet bieden.
- **Ze winnen ook:** prijzengeld, punten, Roekoes en Vleugels (§15).

---

## 18. Startershulp: je eerste seizoen

Elke nieuwe speler krijgt zes startduiven en een starterspakket, bovenaan het Overzicht.

**Startduiven.** Hun algemene score ligt tussen **★50 en ★80**, met altijd **minstens één van
★75–80**. Elk van de andere vijf loot eerst een schijf en dan een score daarbinnen:

| Schijf | Kans (de andere vijf) | Over alle zes |
|---|---|---|
| ★50–60 | 25 % | ~21 % |
| ★60–70 | **55 %** | ~46 % |
| ★70–80 | 20 % | ~33 % |

- Gemiddeld scoort een startduif **~★67**. Snelheid, conditie en oriëntatie liggen elk een paar
  punten rond die score; elke gen-cap ligt minstens 3 punten boven de eigenschap.
- Bots krijgen de gewone loting (~★52).

### 18.1 Punten die je zelf verdeelt

Een tegoed dat niet vervalt.

| Tegoed | Hoeveel | Waar het heen mag |
|---|---|---|
| 🎓 **Ervaring** | **30** punten | allemaal naar **één** duif naar keuze |
| 💪 **Eigenschappen** | **5** punten | vrij te spreiden over duiven én over snelheid/conditie/oriëntatie |

- De ervaringspunten gaan allemaal naar dezelfde duif; de leerfactor (§3.7) geldt er niet.
- Eigenschapspunten respecteren de gen-cap (§7bis); wat niet past, blijft in je tegoed.

### 18.2 Voordelen voor 28 dagen

| Voordeel | Wat het doet |
|---|---|
| 🎯 **Gratis privécoach** | één gecoachte duif kost je niets — altijd je **duurste**. Een tweede coach betaal je gewoon (§13) |
| 💰 **Dubbele winst** | op **wedstrijdvluchten** krijg je **2×** prijzengeld én **2×** ranglijstpunten |
| ⚡ **Volle duiven** | al je startduiven beginnen op **100 energie**, dus met een groene vluchtvorm (§3.2) |
| 🤝 **Eerste sponsor** | er ligt meteen een aanbod van een kleine sponsor klaar |

Het startgeld is **€5.000**, zoals voor iedereen.

### 18.3 En daarna?

Na 28 dagen stoppen de voordelen: de coach kost het gewone dagloon en je wint enkelvoudig.
Je krijgt daar een melding van. Niet-uitgegeven punten blijven van jou.
