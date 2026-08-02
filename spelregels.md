# Roekoe — Spelregels & Berekeningen

Dit document beschrijft alle spelregels en de exacte formules achter Roekoe.
De waarden komen uit `core/config/gameConfig.ts`; de logica uit de bestanden in
`core/game/`. Alles is zo opgezet dat je het spel kunt herbalanceren door enkel
de constanten aan te passen.

> Notitie over opslag: om historische redenen heet de eigenschap **conditie**
> intern `endurance` en **energie** intern `form`. In dit document gebruiken we
> de spelnamen (conditie / energie).

---

## 1. Eigenschappen van een duif

Elke duif (0–100 per waarde):

| Eigenschap | Type | Betekenis |
|---|---|---|
| **Snelheid** | vaardigheid | Rauwe snelheid. Weegt het zwaarst op korte vluchten. |
| **Conditie** | vaardigheid | Fitheid/uithouding. Laat een duif haar snelheid **aanhouden** op lange vluchten; verbetert door te vliegen; tilt gezondheid en libido op. |
| **Oriëntatie** | vaardigheid | Navigatie. Weegt zwaarder op lange vluchten. |
| **Energie** | dynamisch | "Fut". Daalt door vluchten, stijgt door rust + eten. Lage energie = slechtere prestaties, meer kans op ziekte/blessure, minder kans op broeden. |
| **Gezondheid** | dynamisch | Algemene gezondheid. Vermenigvuldigt de vluchtsnelheid; laag = niet vluchtklaar. |
| **Libido** | dynamisch | Broeddrift. Volgt conditie + energie (met een frisse minderheid als uitzondering). |
| **Ervaring** | groeit | Zelfvertrouwen. Betere prestaties + sneller energieherstel. Groeit door te vliegen. |

Een duif is **vluchtklaar** als: niet gepensioneerd, geen ziekte/kwetsuur, niet
in de ziekenboeg, minstens **8 weken** oud en gezondheid > 15.

**Talent** (voor marktprijs/bots) = gemiddelde van snelheid, conditie, oriëntatie.

---

## 2. Vluchten

### 2.1 Kalender (Brussel-tijd)
- **10:00 — lange vlucht**: nationaal of internationaal (wisselt per dag).
- **12:00 — oefenvlucht**: korte training, **om de 2 dagen** (zie §2.7).
- **17:00 — korte vlucht**: regionaal.
- **Zaterdag 11:00 — Titanenwedstrijd** (zie §2.8): die dag is er **enkel** deze
  vlucht — ze **vervangt** alle andere vluchten van die dag.

**Gaat een wedstrijd wel door?** Een **wedstrijdvlucht** (regionaal, nationaal,
internationaal én de titanenwedstrijd) gaat **enkel door als er minstens 2
verschillende duivenmelkers** meedoen. Doet er maar één mee, dan wordt de vlucht
**afgelast** en krijgt iedereen zijn **inschrijfgeld terugbetaald**. Een
**oefenvlucht** mag wél doorgaan met één deelnemer.

### 2.2 Niveaus
| Niveau | Steden | Afstand | Inschrijfgeld |
|---|---|---|---|
| Regionaal | twee Vlaamse steden | 30–160 km | €20 |
| Nationaal | twee Belgische steden | 60–290 km | €40 |
| Internationaal | BE, NL, FR, GB, LU, DE | 180–950 km | €80 |

Start- en aankomststad worden **willekeurig** gekozen binnen het niveau; de
afstand wordt berekend uit de coördinaten (Haversine).

### 2.3 Vluchtsnelheid (m/min)
Per duif, bevroren bij de start:

```
gewicht(afstand): t = clamp((afstand − 100) / 600, 0, 1)
  gewicht.snelheid   = 0.55 + (0.20 − 0.55)·t
  gewicht.conditie   = 0.20 + (0.45 − 0.20)·t
  gewicht.oriëntatie = 0.25 + (0.35 − 0.25)·t

basisscore = gewicht.snelheid·Snelheid + gewicht.conditie·Conditie + gewicht.oriëntatie·Oriëntatie

energiefactor  = interp(Energie):  0→0.55, 50→0.90, 100→1.10
gezondheidsf.  = interp(Gezond.):  0→0.40, 50→0.85, 100→1.00
ervaringfactor = 1 + Ervaring/300           (tot +33%)
leeftijdfactor = leeftijdscurve (zie §6)
weerfactor     = 0.70 … 1.20 (zie §2.5)
geluk          = willekeurig 0.90 … 1.10

snelheid = (700 + basisscore·9) · energiefactor · gezondheidsf. · ervaringfactor · leeftijdfactor · weerfactor · geluk
```

**Alle drie de vaardigheden tellen dus mee** (snelheid vooral kort, conditie &
oriëntatie vooral lang), net als gezondheid, energie en ervaring.

> **Voorbeeld.** Een sterke duif (snelheid 80, conditie 70, oriëntatie 65,
> energie 90, gezondheid 85, ervaring 40) op een vlucht van **300 km**:
> de gewichten worden ≈ snelheid 0.43 / conditie 0.28 / oriëntatie 0.28, dus
> basisscore ≈ 73. Met de energie- (×1.06), gezondheids- (×0.96) en
> ervaringbonus (×1.13) en een lichte rugwind (×1.1) komt ze aan
> **≈ 100 km/u** en doet ze **≈ 2 u 55** over de 300 km.
> Een futloze duif (energie 30, gezondheid 45) op dezelfde vlucht haalt maar
> ~70 km/u en verliest zo een half uur — energie en gezondheid maken echt
> het verschil.

### 2.4 Duur (echte tijd)
```
seconden = (afstand_km · 1000 / snelheid_m_per_min) · 60
duur     = max(300, afgerond(seconden))
```
Een vlucht duurt dus echt zo lang als de duiven erover doen (minimum 5 min).

### 2.5 Weer
Het echte windbeeld op de startplaats (Open-Meteo) wordt omgezet naar een factor:
```
along = windsnelheid · cos(hoek tussen windrichting en route)   // + = rugwind
weerfactor = clamp(1 + along/120 − min(neerslag, 4)·0.04, 0.70, 1.20)
```
Rugwind versnelt, tegenwind + regen vertragen. Zonder netwerk: willekeurig weer.

> **Voorbeeld.** 20 km/u wind recht op de rug → factor 1 + 20/120 ≈ **1.17**
> (17% sneller). Diezelfde 20 km/u recht tegen → **0.83** (17% trager). Giet het
> ook nog eens (3 mm regen), dan gaat er nog eens ~0.12 af.

### 2.6 Uitslag: prijzengeld & punten
Gerangschikt op finishtijd (snelste eerst).

**Prijzengeld** (index 0 = winnaar):
- Regionaal: 300, 180, 110, 70, 45, 30, 20, 12
- Nationaal: 900, 550, 350, 220, 140, 90, 60, 40, 25, 15
- Internationaal: 2200, 1300, 800, 500, 320, 200, 130, 85, 55, 35, 25, 15

**Punten** (top 20): 100, 80, 65, 55, 47, 40, 34, 29, 25, 21, 18, 15, 13, 11, 9, 7, 5, 3, 2, 1.
Seizoenspunten tellen op over **alle** vluchten en **alle** duiven van een hok.

### 2.7 Oefenvluchten (om de 2 dagen, rond 12:00)
Een **oefenvlucht** is een korte training, geen wedstrijd:
- **Gratis** inschrijven — geen inschrijfgeld.
- **Geen** prijzengeld, **geen** seizoenspunten, **geen** overwinningen/medailles.
- **Telt niet mee voor de ranglijsten** (§15): enkel nationale, regionale en
  internationale **wedstrijdvluchten** tellen daar. Ook de opgebouwde conditie/
  oriëntatie van een oefenvlucht telt **niet** mee voor de vooruitgangsranglijst.
- Verbruikt **heel weinig** energie (in totaal ~**4**, ook geleidelijk afgetrokken).
- Bots doen **niet** mee; je kan er **niet** op wedden.
- Iedereen komt thuis: **geen** DNF, **geen** kwetsuur- of sterfterisico.

De bedoeling is **conditie en oriëntatie opbouwen** (en in mindere mate snelheid).
Na afloop maakt elke duif kans om te groeien in één vaardigheid — gewogen naar
**oriëntatie/conditie** (snelheid 0.15 / conditie 0.45 / oriëntatie 0.40):
```
kans        = 0.70              (zonder coach)
            = 0.92              (met privécoach)
groei       = willekeurig(0.4 … 1.4) · (0.4 + ruimte)
              + 0.5 extra bij een gecoachte duif op conditie/oriëntatie
```
Zo kan een duif zonder energie voor wedstrijden tóch elke dag beter worden. Een
**privécoach** (§13) maakt de kans én de winst op conditie/oriëntatie groter.

### 2.8 Titanenwedstrijd (zaterdag)
Eén keer per week, in het **weekend** (zaterdag 11:00), is er een prestigieuze
**Titanenwedstrijd**:
- **Elke duivenmelker mag maar één duif inschrijven.**
- **Middellange tot lange** afstand (~200–600 km).
- Er is **inschrijfgeld** (€200) en er valt **enkel geld** te winnen — **geen**
  rangschikkingspunten, geen medailles, en het telt **niet** mee voor de
  ranglijsten (§15). Prijzengeld: **1e €1400, 2e €1200, 3e €1000**.
- Je duif kan er, zoals bij elke vlucht, **wel op vooruitgaan** (conditie, enz.).
- Deze wedstrijd **vervangt** die dag alle andere vluchten (er is dus maar één).

---

## 3. Effect van een vlucht op de duif

Per deelnemende duif:

| Effect | Formule | Wanneer |
|---|---|---|
| **Energie** (verbruik) | −(5 + afstand/60 + willekeurig 0…5) | **geleidelijk tijdens de vlucht** (zie hieronder) |
| **Conditie** (opbouw) | +(0.3 + afstand/500 + willekeurig 0…0.4) | na afloop |
| **Gezondheid** | −(willekeurig 0 … afstand/200) | na afloop |
| **Ervaring** | +(2 + afstand/100) | na afloop |

**Energie loopt gaandeweg leeg, niet in één klap achteraf.** Bij de start wordt
de totale energiekost van de rit vastgeklikt en vervolgens **per 30 minuten**
afgetrokken, evenredig met de afgelegde afstand. Je ziet de energiebalk van je
duif dus tijdens de wedstrijd zakken. Wie de hele vlucht uitvliegt, betaalt de
volledige kost; wie halverwege **opgeeft** (§3.4), heeft alleen betaald voor het
stuk dat ze al vloog — je kan de energiekost dus niet ontlopen door je duif net
voor de finish uit de race te halen.

> **Voorbeeld.** Een vlucht van **300 km** kost in totaal ongeveer **12 energie**.
> Op een rit van ~5 uur gaat er dus zowat **1,2 energie per 30 minuten** af.
> De duif wint na afloop ~**1 conditie** en ~**5 ervaring**, en er gaat een beetje
> gezondheid af. Een korte regiovlucht van 60 km kost maar ~6 energie; een
> internationale van 700 km ~17. Met de nieuwe herstelwaarden (§4) is een duif
> zo weer inzetbaar na een paar dagen rust — of sneller met Herstelvoer.

### 3.1 Kans op verbetering van een vaardigheid
Elke deelnemer maakt kans om te groeien in de vaardigheid die voor die afstand
telt (gewogen keuze uit snelheid/conditie/oriëntatie):
```
ruimte      = (96 − huidige_waarde) / 96
plaatsbonus = (aantal − plaats) / aantal · 0.3      // winnaar tot +0.3
kans        = clamp(0.4 · (0.5 + ruimte) + plaatsbonus, 0, 0.9)
groei       = willekeurig(0.4 … 1.6) · (0.4 + ruimte)   // cap 96
```
Bij een verbetering krijgt de speler een melding.

> **Voorbeeld.** Een duif met conditie 70 wint een vlucht met 12 deelnemers.
> Ruimte = (96−70)/96 ≈ 0.27, plaatsbonus (winnaar) = 0.3, dus kans ≈
> **61%** op groei van ~**+0.7 conditie**. De laatst aankomende duif heeft
> dezelfde ruimte maar amper plaatsbonus, en dus maar ~35% kans. Winnen én
> onervaren/zwakke duiven leren dus het snelst bij.

### 3.2 Energie, thuiskomen & kans op kwetsuur

Om in te schrijven heeft een duif **minstens 1 energie** nodig. Vliegt ze op een
haast lege tank, dan is er een reële kans dat ze de vlucht **niet uitrijdt (DNF)**
— ze raakt niet thuis, verdient geen punten of prijs, en is nadien vaak gekwetst.
Onder ~22 energie loopt die kans snel op; bij bijna 0 energie komt ze zo goed als
zeker niet thuis.

```
basiskans   = 0.025 + afstand · 0.00018
kans_duif   = basiskans · (1 + (100 − Energie)/100) + extra_bij_lage_energie
```
Onder ~25 energie komt er een extra blessurekans bij (tot +0.6 bij 0 energie); een
duif die niet thuis raakt, is bijna altijd gewond. De kwetsuur is willekeurig uit
de lijst (zie §5).

> **Voorbeeld.** Op een fondvlucht van **490 km** is de basiskans 0.025 +
> 490·0.00018 ≈ **11%** bij volle energie. Vliegt de duif op haar tandvlees
> (energie 30), dan wordt dat ×1.7 → **~19%**. Uitgeputte duiven laten vliegen
> is dus vragen om blessures.

**Getrapt risico op een wedstrijdvlucht bij lage energie.** Naast de gewone
blessurekans gelden er extra gevaren, bepaald door de energie waarmee de duif
**vertrekt** (een duif die je zelf **opgeeft** loopt deze risico's níet):

| Startenergie | Risico |
|---|---|
| **onder 20** | kans (~20%) op een **licht** letsel of lichte ziekte |
| **onder 10** | kans (~30%) op een **matig** letsel of matige ziekte (of het bovenstaande) |
| **onder 5** | kleine kans (~7%) op **sterfte** — of anders alles hierboven |

Sterfte gaat vóór alle andere aandoeningen: sterft de duif, dan verlaat ze het
hok (met een melding). Oefenvluchten (§2.7) kennen deze risico's **niet**.

### 3.3 Wedstrijddeadline (90 minuten na de eerste duif)

Een wedstrijd loopt niet eindeloos door. **Zodra de eerste duif thuis is, start
een deadline van 90 minuten.** Elke duif die daarna nog niet binnen is, wordt
**geëlimineerd**: ze telt als *niet thuis* (DNF) — geen punten, geen prijs. Zo
sleept een enkele trage duif de uitslag niet urenlang aan.

```
duur_wedstrijd = min(traagste duif, eerste duif + 90 min)
```

### 3.4 Zelf opgeven om energie te sparen

Tijdens een **live** wedstrijd kan je een eigen duif laten **opgeven** (knop op
de live-pagina). Ze finisht dan niet en telt als DNF — géén punten of prijs —
**maar** ze spaart de rest van haar krachten:

- ze verliest **alleen de energie die ze al vloog** tot het moment van opgeven
  (evenredig met de afgelegde afstand); de rest van de energiekost blijft je
  bespaard. Vroeg opgeven spaart dus veel, vlak voor de finish opgeven bijna
  niets — je kan de kost niet meer ontlopen door laat te stoppen;
- vanaf het moment van opgeven verliest ze **geen** energie meer;
- **geen** gezondheidsverlies en **geen** kans op kwetsuur;
- ze bouwt ook geen conditie op (ze heeft de rit niet afgemaakt).

Handig als je vroeg merkt dat een duif toch niet gaat scoren en je haar zoveel
mogelijk fris wil houden voor de volgende vlucht, in plaats van haar helemaal
leeg te laten lopen.

---

## 4. Voeding & verzorging (dagelijks, echte tijd)

Voeding en herstel gebeuren **elke dag** automatisch (niet pas op weekeinde) —
energie, gezondheid, conditie en libido bewegen dus dagelijks.

> **Zie het per duif.** In **Mijn hok** staat bij elke duif — naast de voerkeuze
> en de apart-hok-knop — bij elke eigenschap een klein **▲/▼-cijfer per dag**:
> hoeveel die eigenschap volgens je **huidige keuze** (voer, apart hok, coach)
> morgen verandert. Een groene **▲** = stijgt, een rode **▼** = daalt. Zet je de
> duif in een **apart hok**, dan loopt haar energiegroei op; wissel je van voer,
> dan verschuiven de cijfers mee. Heeft je duif geen voer meer, dan zie je de
> cijfers rood worden (▼): honger laat de eigenschappen dalen (zie hieronder).

**Voorraad wordt per type apart bijgehouden**, en **elke duif** krijgt een eigen
type (in te stellen bij *Mijn hok* of op de duifpagina). Een duif eet 1/7 van
haar weekverbruik per dag uit de voorraad van háár type. Is die voorraad op, dan
gaat die duif **honger lijden** (zie §4.1). Op het **Overzicht** koop je
voorraad per type; er is geen algemene "alles ineens"-knop.

De tabel toont **weekwaarden**; in het spel (Overzicht) zie je ze **per dag** (1/7).

| Type | Voer/duif/week | Prijs/kg | Effect (per week) |
|---|---|---|---|
| Normaal | 1.0 kg | €3 | energie +21, gezondheid +5 |
| Premium | 1.5 kg | €6 | energie +28, gezondheid +9, **conditie +4** |
| Libido-mix | 1.4 kg | €4.5 | energie +18, gezondheid +5, **libido +14** |
| Herstel | 1.5 kg | €3 | **energie +42**, gezondheid +3 |

Iedereen start (na de overstap) met **50 kg Normaal**; alle duiven staan standaard
op Normaal.

Per dag, per gevoerde duif (weekwaarden gedeeld door 7):
```
Energie   += (energie_per_week / 7) · (1 + Ervaring/200)   // ervaring = sneller herstel
Gezondheid+= (gezondheid_per_week / 7) + Conditie/280       // goede conditie = betere gezondheid
```

**Rustbonus.** Blijft een duif thuis (doet ze geen vlucht) én eet ze elke dag, dan
bouwt ze rust op: **elke 3e zulke dag** krijgt ze **+4 energie** bovenop het gewone
voer-herstel. De teller **reset zodra ze een vlucht doet**, en een **hongerdag**
(geen voorraad) breekt de reeks. Zo loont het om een uitgeruste duif af en toe
thuis te laten — maar voer blijft nodig.

> **Voorbeeld.** Een hok met **6 duiven** op Normaal eet 6 kg/dag, dus je
> startvoorraad van 50 kg is na ~**8 dagen** op. Een goed gevoerde duif met
> ervaring 40 wint ongeveer **+3,6 energie per dag** op Normaal (≈ +25 per week),
> en tot **~+7/dag** op Herstelvoer. Zo herstelt een duif na een vlucht binnen
> een paar dagen weer genoeg om opnieuw mee te doen. Koop wel tijdig bij (€3/kg)
> — een lege voorraad is gevaarlijk (§4.1).

### 4.0 Honger & verhongeren (voorraad op)

Heeft een duif geen voorraad meer van háár voertype, dan lijdt ze **honger**, en
dat wordt **elke dag erger**. Op honger-dag `N` verliest ze per eigenschap `N ×`
het dagbedrag — de daling **versnelt** dus zolang er geen eten is:

```
dag N zonder eten:
  Energie   −= 8 · N
  Gezondheid−= 5 · N
  Conditie  −= 3 · N
  Libido    −= 4 · N
sterftekans = 0                          als N < 3
            = min(0.25 · (N−2), 0.95)    vanaf dag 3
            = 100%                        vanaf dag 7
```

Zodra je de duif weer voer geeft (voorraad van haar type), springt de honger
terug op 0 en herstelt ze weer normaal. Maar blijft ze zonder eten, dan gaat het
snel bergaf en **sterft ze** — realistisch gezien houdt een duif het maar een
paar dagen vol zonder eten. Vanaf dag 3 is er een reële kans dat ze het niet
haalt, en na een week is het zeker. Je krijgt een melding als een duif verhongert.

> **Voorbeeld.** Een duif met 85 energie die geen eten meer krijgt: dag 1 −8
> (→77), dag 2 −16 (→61), dag 3 −24 (→37) mét ~25% sterftekans, dag 4 −32 (→5)
> mét ~50% kans… Reken er niet op dat ze het overleeft. Koop op tijd bij.

### 4.1 Libido (dagelijkse drift)
```
doel = Conditie·0.5 + Energie·0.5
frisse minderheid (~12%, vast per duif): doel = max(doel, 65…89)
Libido += (doel − Libido) · 0.04
```
Zo volgt libido conditie + energie, maar een handvol duiven houdt ondanks lage
energie tóch een hoog libido.

> **Voorbeeld.** Een duif met conditie 70 en energie 40 heeft een libido-doel
> van 55; haar libido kruipt met ~1 per dag richting die 55. Een fitte duif
> (conditie 90, energie 90) mikt op 90. Ongeveer **1 op de 8** duiven is van
> nature "fris" en houdt libido 65–89, ook al is de energie laag.

### 4.2 Wekelijkse onkosten
Bij "Volgende week" (spelleider) wordt aangerekend:
```
onkosten = 150 + 15 · aantal_duiven
```
Daarbovenop komen coachsalarissen (§13) en de ziekenboegkosten (§5). Ziekte/
herstel/sterfte en het seizoen worden ook dan verwerkt (zie §5, §6).

Onkosten kunnen je kassa **onder €0** duwen. Sta je negatief, dan **kan je niet
meer inschrijven** voor vluchten: eerst een duif verkopen om terug uit het rood
te geraken.

### 4.3 Rustkuur (energie kopen met tijd)
Naast wachten en Herstelvoer kan je een duif een **betaalde rustkuur** geven op
haar duifpagina:
- Kost **€300** en duurt **één dag** (24 u, echte tijd).
- Tijdens de kuur **rust** de duif verplicht: ze kan **niet inschrijven of vliegen**.
- Als de kuur voorbij is, krijgt ze in één keer **+40 energie** (met een melding).
- **Maximaal één rustkuur per week** per hok (dus ook maar **één duif per week**);
  daarna telt een cooldown van **7 dagen** vóór de volgende kan. Zo blijft energie
  kopen in balans.

Handig als al je duiven futloos zijn en je snel iemand vluchtklaar wil krijgen
zonder op de dagelijkse verzorging te wachten. Je kan geen kuur starten voor een
duif die al ingeschreven staat of al vol energie zit.

---

## 5. Ziekte, kwetsuur & ziekenboeg

### 5.1 Aandoeningen
**Ziektes (besmettelijk):** Het Geel (licht), Duivenpokken (matig), Ornithose
(matig), Coccidiose (matig), Paramyxovirose (ernstig), Salmonellose (ernstig).
**Kwetsuren (via vluchten):** gebroken slagpen (licht), gekneusde poot (licht),
verrekte borstspier (licht), verstuikte vleugel (matig), borstbeenkneuzing
(matig), sperwerverwonding (ernstig), botbreuk in de vleugel (ernstig).

Bij het uitbreken zakt de gezondheid: **licht −10, matig −22, ernstig −38**.

### 5.2 Kans op ziekte (wekelijks)
Voor elke gezonde, niet-geïsoleerde duif:
```
energierisico = clamp(1.3 − Energie/100, 0.3, 1.3)        // laag = risicovoller
per_bron      = 0.11 · clamp(1.2 − Gezondheid/100, 0.1, 1.2) · energierisico
van_anderen   = 1 − (1 − per_bron)^(aantal zieke, niet-geïsoleerde duiven)
spontaan      = 0.05 · clamp(1 − Gezondheid/100, 0, 1) · energierisico
totale_kans   = clamp(1 − (1 − van_anderen)·(1 − spontaan), 0, 0.85)
```
Een duif **in de ziekenboeg** is geïsoleerd: besmet niemand en wordt niet besmet.

> **Voorbeeld.** Eén zieke hokgenoot loopt rond. Een fitte duif (gezondheid 85,
> energie 90) heeft daardoor maar **~2% kans/week** om ziek te worden. Een
> verzwakte duif (gezondheid 40, energie 20) zit rond **~13% kans/week** — meer
> dan zes keer zoveel. Lage gezondheid én lage energie maken je hok dus veel
> kwetsbaarder; zet zieke duiven meteen in de ziekenboeg om de ketting te breken.

### 5.3 Herstel (in echte tijd)
Herstel loopt **continu in echte tijd** (niet meer als wekelijkse kansworp). Een
duif die gewoon in het hok rust, geneest volledig na (bij benadering):
```
licht ~2,5 dagen · matig ~5 dagen · ernstig ~9 dagen
```
Goede zorg **versnelt** dat: de ziekenboeg ×2,2, een dekkende dokter/kinesist
×1,6, en medicinaal voer ×1,35 — die stapelen. Met alles samen (×~4,75) geneest
een licht letsel in een halve dag, een matig in ~1 dag en een ernstig in ~2 dagen.

> **Statusupdates.** Om de **12 uur** krijg je per herstellende duif een bericht
> van de kinesist/dokter met het **herstelpercentage**, een schatting **hoe lang
> nog** tot ze weer vliegensklaar is, en een tip (bv. "zet ze in de ziekenboeg"
> of "zet medicatievoer aan"). In de ziekenboeg zie je bovendien een herstelbalk
> per duif. Zo zie je meteen dat je verzorging helpt.

### 5.4 De ziekenboeg
- Capaciteit: **2 duiven** (uitbreidbaar naar 3/4/5/6 voor €800/1200/1800/2400).
- **Medicinaal voer**: €45/duif/week, verhoogt herstel van iedereen in de boeg.
- **Duivendokter**: €400/week, geneest **2** zieke duiven (ziektes).
- **Duivenkinesist**: €350/week, geneest **2** duiven (kwetsuren).
- Dekking gaat eerst naar de ernstigste gevallen.
- Zieke/gekwetste duiven en duiven in de ziekenboeg kunnen niet vliegen, trainen
  of broeden.

---

## 6. Leeftijd & sterfte

**Leeftijdscurve** (prestatievermenigvuldiger): 0 wk → 0.0, 8 wk → 0.6,
20 wk → 0.85, 1 jaar → 1.0, 1–3 jaar → 1.0 (prime), 5 jaar → 0.9, 8 jaar → 0.7,
10 jaar → 0.5.

**Sterftekans per week:**
```
leeftijd (interp): 4j 0.001 · 6j 0.006 · 8j 0.025 · 10j 0.07 · 12j 0.16 · 15j 0.40
+ onbehandelde aandoening:
    buiten de boeg: matig +0.03 · ernstig +0.10
    in de boeg:     matig +0.005 · ernstig +0.025
```
Bij overlijden krijgt de eigenaar een melding.

> **Voorbeeld.** Een gezonde duif van **8 jaar** heeft ~**2.5% kans/week** om te
> sterven; op **12 jaar** al ~**16%**. Een duif met een **onbehandelde ernstige**
> aandoening krijgt daar +10% bovenop (in de ziekenboeg maar +2.5%). Een oude,
> zieke, onverzorgde duif kan dus zomaar 25%+ kans per week hebben — verzorging
> in de ziekenboeg drukt dat fors.

---

## 7. Kweken (broeden)

**Voorwaarden:** een doffer + een duivin, beide met energie ≥ **20**, geen
ziekte/kwetsuur, niet in de ziekenboeg, en **niet ingeschreven voor een vlucht**.
Kost **€200** en **−15 energie** per ouder.

Een duif die aan het **broeden** is, **kan niet deelnemen aan vluchten**. Wil je
haar terug laten vliegen, dan **stop je het koppel** (knop bij *Kweek*) — het
koppel vervalt zonder jongen en de duiven zijn weer vluchtklaar.

**Kans op jongen** (bij het uitkomen):
```
libido_gem  = (Libido_vader + Libido_moeder) / 2
energie_gem = (Energie_vader + Energie_moeder) / 2
energiefactor = clamp(0.5 + energie_gem/200, 0.5, 1)      // lage energie halveert de kans
succeskans  = clamp((0.55 + libido_gem/100 · 0.45) · energiefactor, 0.2, 1)
```
Mislukt de worp, dan zijn er **geen** jongen. Bij succes: 1 jong, met kans op een
tweede:
```
tweelingkans = clamp(libido_gem/100 · 0.7 · energiefactor, 0, 0.7)
```

> **Voorbeeld.** Twee fitte ouders (libido 70, energie 80) hebben ~**78% kans**
> op minstens één jong en ~**44% kans** op een tweeling. Zakt hun energie naar
> 20, dan valt de succeskans terug naar ~**52%** en komt de worp vaker leeg uit.
> Koppel dus goed uitgeruste, energieke duiven met een hoog libido.

**Uitkomen: onvoorspelbaar.** Er is géén vaste tijd en geen aftelklok. Elk
moment is er een willekeurige kans dat de eieren uitkomen; die kans is groter
naarmate het **libido en de energie** van de ouders hoger zijn. Een topfit koppel
komt gemiddeld al na ~1 dag uit, een lusteloos koppel kan tot ~6 dagen duren —
maar het kan altijd vroeger of later. De speler krijgt een melding zodra het
gebeurt.

> **Voorbeeld.** Met de "fertiliteit" = gemiddelde van libido en energie: bij
> een zeer fit koppel (fertiliteit ~90) is de gemiddelde uitkomsttijd ~1,3 dag;
> bij een futloos koppel (fertiliteit ~20) eerder ~4,9 dag. Omdat het een kans
> per moment is, weet je nooit exact wanneer — soms is het er al in enkele uren,
> soms pas na een week.

**Overerving:** elke vaardigheid = gemiddelde van beide ouders ± willekeurige
mutatie (±8), begrensd op 5…99.

---

## 8. Training

Kost **€120**, verbruikt **15 energie**, en geeft een kleine blijvende
verbetering (~+1.2, tot max **90**) aan snelheid, conditie of oriëntatie, plus
**+4 ervaring**. Vereist voldoende energie. Je kan een duif **enkel trainen als
ze thuis is** — niet zolang ze voor een vlucht ingeschreven staat.

> **Voorbeeld.** Eén trainingsbeurt tilt bv. snelheid van 78 naar ~79 en kost
> €120 + 15 energie. Kleine stapjes dus: trainen is een trage, betrouwbare manier
> om een duif op te bouwen, terwijl vluchten sneller (maar met risico) verbeteren.

---

## 9. Markt

- Alleen duiven van **echte spelers** staan te koop (geen NPC-markt).
- Bij elke verkoop verhuist het geld naar de verkoper; de transactie komt in de
  **verkoopgeschiedenis** (laatste 200).
- Elke duif toont haar eigenaar; je koopt niet je eigen duiven en je hok mag niet
  vol zitten.

---

## 10. Namen

Doffers krijgen mannennamen, duivinnen vrouwennamen. De bijnaam is een mix van
karaktergebonden, neutrale en pikzwarte humor, met voorkeur voor alliteratie
(zelfde beginletter), bv. *Stevie de Snelle*, *Dirk de Doodgraver*,
*Nadine de Nabestaande*.

---

## 11. Meldingen (belknop)

De speler krijgt een melding bij: vluchtuitslag, verbetering van een duif,
kwetsuur, ziekte, herstel, sterfte en geboorte van jongen.

## 12. Dagopdrachten, gebeurtenissen, veilingen & sponsors

- **Dagopdrachten.** Elke dag krijg je 3 kleine opdrachten (bv. een duif
  inschrijven, een vlucht winnen, voer kopen, trainen). Voltooien geeft geld +
  XP. Elke dag dat je speelt verhoogt je **streak** met een groeiende dagbonus
  (€10 + €5 per streakdag, tot €120).
- **Gebeurtenissen (dilemma's).** Nu en dan (~1 op 3 dagen) verschijnt een
  keuzekaartje: een koopman die je beste duif wil kopen, een verdwaalde duif, een
  griepgolf, een gulle frituursponsor, een kwakzalver, een hittegolf, een
  dorpsfeest of een "kat in een zak". Elke keuze heeft gevolgen — soms winst,
  soms risico.
- **Zondagveiling.** Elke **zondag van 11:00 tot 20:00** (Brussel) gaat een
  topduif onder de hamer op de markt. Je moet het geld dat je biedt op dat moment
  ook echt hebben, maar het wordt **niet vastgehouden** — je kan het intussen nog
  gewoon gebruiken. Bij sluiting wint de hoogste bieder, **op voorwaarde dat hij
  het bedrag nog kan betalen** (en plaats heeft). Kan hij niet, dan gaat de duif
  naar de volgende hoogste bieder aan diens bod, enzovoort.
  - **Word je overboden, dan krijg je meteen een melding** met het nieuwe hoogste
    bod en het minimumbedrag om er weer over te gaan — zo kan je op tijd terug
    bieden voordat de veiling sluit.
  - **Bij het sluiten krijg je altijd een melding** als je meegeboden hebt maar
    niet wint — inclusief de reden. Belangrijk: had je het hoogste bod, maar zat
    je **hok vol** of had je op dat moment **het geld niet meer**, dan gaat de
    duif naar een ander en zeggen we je dat. Zo verdwijnt een duif waarop je bood
    nooit meer zonder uitleg. Hou dus plaats én genoeg geld vrij tot de veiling sluit.
- **Opvangcentrum-veiling.** Op willekeurige maar regelmatige momenten (gemiddeld
  ~1 per 9 uur) duikt er een duif uit het opvangcentrum op de markt op. Het is
  geen renduif — de eigenschappen zijn matig — maar met training groeit ze en kan
  je ze later opnieuw verkopen. **Startbod: €25**, venster van 6 uur.
- **Sponsors.** Er is **niets beschikbaar tot je het verdient**. Zodra je duiven
  en resultaten een drempel halen (bv. je eerste overwinning, veel deelnames, een
  getalenteerde duif, seizoenspunten, niveau of gouden medailles), **biedt** die
  sponsor zich aan: er verschijnt een melding én een aanbod op de sponsorpagina
  dat je **aanvaardt of weigert**. Hoe beter je duiven en prestaties, hoe grotere
  sponsors zich melden en hoe groter het aanbod.
  - Aanvaarden geeft eenmalig **tekengeld**, daarna elke week een **weekbijdrage**
    (bij "Volgende week") en een **bonus per gewonnen vlucht**.
  - Je kan **meerdere sponsors tegelijk** hebben, maar **per categorie** (café,
    frituur, bakkerij, …) telkens maar **één** — concurrenten vechten om jou. Wil
    je overstappen naar een concurrent in dezelfde categorie, dan moet je het oude
    contract opzeggen en een **verbrekingsvergoeding** betalen. Sponsors uit
    verschillende categorieën gaan probleemloos samen.
  - Weiger je een aanbod, dan **verdwijnt het**. De sponsor kan later (na een
    afkoelperiode van ~3 dagen) **opnieuw aankloppen** — met een aanbod dat mee
    schaalt met je prestaties intussen: beter gepresteerd → een rijker aanbod,
    minder goed → een magerder aanbod. Het tekengeld krijg je maar één keer per
    sponsor. Ook een opgezegd contract kan later opnieuw aangeboden worden.
  - **Een sponsor kan zélf opstappen na een seizoen.** Bij de seizoenswissel (§15)
    vergelijkt elke sponsor je seizoenspunten met die van het **vorige** seizoen.
    Zakken ze tot **onder 60%** daarvan, dan vindt de sponsor dat je niet meer zo
    goed presteert en **beëindigt hij het contract** — zonder verbrekingsvergoeding
    voor jou (het is de sponsor die vertrekt). Het eerste seizoen na tekenen dient
    enkel als ijkpunt (geen oordeel), en een seizoen met heel weinig punten (< 20)
    telt niet mee als maatstaf. Klim je later weer, dan kan die sponsor opnieuw
    aankloppen.
  - Er zijn eigen **sponsorbadges** (Prestaties): je eerste contract, tekenen bij
    een topsponsor (tier 3), 3 sponsors tegelijk, en een "sponsorimperium" met
    sponsors in 4 verschillende categorieën tegelijk.

## 13. Je geld uitgeven: hok, voeding & coaches

Verdiend geld kan je investeren in je hok en je duiven (bij *Mijn hok*, de
*Ziekenboeg* en de duifpagina):

- **Hokcapaciteit.** Je start met plaats voor **8** duiven en breidt uit naar
  10, 12, 16 en 20 (elke stap kost meer). Zonder plaats kan je niet kopen,
  adopteren of kweken.
- **Aparte hokken.** Koop losse compartimenten zodat je duiven niet allemaal op
  elkaar zitten. Elk apart hok wordt los gekocht (telkens wat duurder), en je
  **kiest zelf welke duiven** er een krijgen (knop bij *Mijn hok* of op de
  duifpagina). Heb je minder aparte hokken dan duiven, dan zitten de rest gewoon
  samen. Een duif in een apart hok **herstelt sneller energie** en heeft een
  **kleinere kans op ziekte**.
- **Ziekenboeg uitbreiden.** Koop extra bedden (van 2 naar 3, 4, 5 of 6) zodat je
  meer zieke duiven tegelijk kan verzorgen.
- **Voerschema's — per duif.** Elke duif heeft eigen noden (vluchten vs. broeden),
  dus je kiest **per duif** een voerschema (bij *Mijn hok* of op de duifpagina).
  Op het overzicht kan je met één klik álle duiven op hetzelfde schema zetten.
  Naast Zuinig/Normaal/Royaal zijn er twee premiumopties: **Premium** (meer
  energie- en gezondheidsherstel én bouwt langzaam conditie op) en **Libido-mix**
  (verhoogt de voortplantingsdrang). Ze verbruiken meer voer.
- **Privécoach.** Huur een coach voor één specifieke duif. Die traint haar
  dagelijks in **snelheid, conditie én oriëntatie** plus ervaring, puur om beter
  te racen — **nooit libido**. Een coach werkt niet terwijl de duif effectief aan
  het vliegen is (een lopende vlucht); ingeschreven-maar-nog-niet-gestart mag wel.
  Kost veel bij het inhuren én een weeksalaris zolang hij aanblijft.
- **Trainingsplafonds.** Zelf **trainen** komt tot **90**, **premiumvoer** bouwt
  conditie tot **92**, en enkel een **coach** duwt een race-eigenschap helemaal
  tot **100**. Voer verlaagt nooit een al hoger opgebouwde waarde.
- **Duif hernoemen** kost €1.000. **Je hok hernoemen** (bij Profiel) kost €2.000.

## 14. Weddenschappen

Vanaf **12 uur voor de start** tot het moment dat de vlucht begint, verschijnt bij
de vlucht een knop om te **wedden**. Is het nog geen 12 uur voor de start, dan
toont de vlucht een **aftelklok** tot de weddenschappen openen. Zodra de vlucht
start, kan je niet meer inzetten. Je kan **maximaal één weddenschap per vlucht**
plaatsen.

Je kan wedden op **alle wedstrijdvluchten** (regionaal, nationaal én
internationaal). Op **oefenvluchten** (§2.7) kan je niet wedden.

Je kiest een **inzet**, een **type weddenschap** en (meestal) een **doelduif** —
ook duiven van andere spelers. Types:
- **Wint de vlucht** — de gekozen duif wordt eerste.
- **Duif in top 3** — de gekozen duif (van jou of een ander) eindigt bij de eerste drie.
- **Eindigt allerlaatste** — de gekozen duif is de **laatste die thuiskomt**.
  Duiven die niet finishen (DNF/opgegeven) tellen hier níet als "laatste".
- **Eigen duif in top 3** — een van jóuw duiven eindigt bij de eerste drie.
- **Een van mijn duiven wint** — om het even welke van jouw ingeschreven duiven.
- **Komt eerder thuis dan…** — kop-aan-kop tussen twee duiven.

Het spel schat de **kans** met een **Monte-Carlo-simulatie** van net hetzelfde
racemodel als de echte vlucht (snelheid × geluk, plus de DNF-kans uit energie),
duizenden keren doorgerekend. De prijzen volgen dus de echte kansen en zijn niet
te misbruiken. Een sterke favoriet heeft een grote kans en dus een **lagere
uitbetalingsratio**; een outsider betaalt meer. Vóór je bevestigt zie je de
geschatte kans, de **ratio** en je **mogelijke winst** (inzet × ratio, met een
bookmakersmarge waardoor het huis licht in het voordeel is). Je inzet wordt meteen
afgehouden; bij winst krijg je inzet × ratio terug. Doet de doelduif niet mee
(uitgeschreven), dan is de weddenschap vervallen en krijg je je inzet terug.

Het invoerveld voor je inzet wordt automatisch begrensd tot **min. €10** en
**max. €5.000**.

## 15. Seizoenen, ranglijst & prijzen

### 15.1 Seizoensklok (echte tijd)
Een **seizoen duurt 4 weken**, elke week **7 echte dagen** (dus 28 dagen per
seizoen). De weekteller in de ranglijst (**"Seizoen X · week Y/4"**) loopt
automatisch mee met de echte tijd — je hoeft niets te doen. Zodra de vierde week
voorbij is, wordt de **prijsuitreiking** gehouden, start een nieuw seizoen op
**week 1** en **reset de ranglijst** (alle seizoenspunten terug op 0).

> De interne "speelweek" (die leeftijden en aandoeningen bijhoudt) loopt apart
> gewoon door; de ranglijst toont voortaan de **seizoensweek** (1–4).

### 15.2 Melkerranglijst → de Roekoe
De ranglijst rangschikt alle hokken op **seizoenspunten** (enkel wedstrijdvluchten
geven punten; oefenvluchten niet). **Bots dingen gewoon mee** en kunnen ook winnen —
zij hebben het prijzengeld ook nodig. Bij de prijsuitreiking winnen de **top 3
hokken**:

| Plaats | Prijs | Prijzengeld |
|---|---|---|
| 1e | **de Gouden Roekoe** | €2.000 |
| 2e | **de Zilveren Roekoe** | €1.500 |
| 3e | **de Bronzen Roekoe** | €1.000 |

De winnaar krijgt ook de badge **Seizoenskampioen**.

### 15.3 Duivenranglijsten → de Vleugel
Naast de melkers zijn er **drie ranglijsten van individuele duiven** (top 10),
allemaal voor het **lopende seizoen**. **Alleen wedstrijdvluchten** (regionaal,
nationaal, internationaal) tellen mee — **oefenvluchten niet**:
- **⚡ Snelste duiven** — hoogste **pieksnelheid** ooit gehaald dit seizoen (niet
  het gemiddelde), in km/u.
- **🎖️ Meeste podiums** — aantal top-3-plaatsen dit seizoen.
- **📈 Meeste vooruitgang** — grootste **algemene groei** dit seizoen
  (snelheid + conditie + oriëntatie + libido + ervaring, t.o.v. de stand bij
  seizoensstart).

Bij de prijsuitreiking winnen de **top 3 duiven** van **elke** ranglijst een
**Vleugel** — het prijzengeld gaat naar de **eigenaar** (ook bots kunnen winnen):

| Plaats | Prijs | Prijzengeld |
|---|---|---|
| 1e | **de Gouden Vleugel** | €1.000 |
| 2e | **de Zilveren Vleugel** | €750 |
| 3e | **de Bronzen Vleugel** | €500 |

Eén duif kan in meerdere ranglijsten top-3 halen en zo meerdere Vleugels winnen.

### 15.4 Prestige
Roekoes en Vleugels worden bewaard bij **Prestaties → Seizoensprijzen**: hoeveel
gouden/zilveren/bronzen van elk je verzamelde, plus een erelijst per seizoen. De
prijsuitreiking komt ook binnen als **melding**.

---

*Alle getallen hierboven zijn de tuning-constanten; pas ze aan in
`core/config/gameConfig.ts` om het spel te herbalanceren.*
