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
| **Oriëntatie** | vaardigheid | Navigatie. **Maakt niet sneller** — bepaalt of je duif omvliegt of de weg kwijtraakt (§3.5). Weegt zwaarder op lange vluchten en bij slecht weer. |
| **Energie** | dynamisch | "Fut". Daalt door vluchten, stijgt door rust + eten. Lage energie = slechtere prestaties, meer kans op ziekte/blessure, minder kans op broeden. |
| **Gezondheid** | dynamisch | Algemene gezondheid. Vermenigvuldigt de vluchtsnelheid; laag = niet vluchtklaar. |
| **Libido** | dynamisch | Broeddrift. Volgt conditie + energie (met een frisse minderheid als uitzondering). |
| **Ervaring** | groeit | Routine. **Maakt niet sneller** — maakt zuinig: minder energieverbruik per vlucht, sneller energieherstel, en een lage tank beter indelen (§2.3). Groeit door te vliegen, te trainen en met een coach — **snel bij een groentje, steeds trager bij een routinier** (§3.7). |

Een duif is **vluchtklaar** als: niet gepensioneerd, geen ziekte/kwetsuur, niet
in de ziekenboeg, minstens **8 weken** oud en gezondheid > 15.

**Talent** (voor marktprijs/bots) = gemiddelde van snelheid, conditie, oriëntatie.
Dat gemiddelde is eerlijk, want de **drie racevaardigheden zijn even veel waard**:
tien punten van elk leveren over een volledige speelweek ongeveer hetzelfde op. Ze
leveren het alleen op verschillende vluchten — zie §2.3 en §3.5.

> **Genen.** Snelheid, conditie en oriëntatie hebben elk een **aangeboren maximum**
> (per duif verschillend, **nooit 100**). Hoe die plafonds werken, hoe je ernaartoe
> groeit (trainen → vluchten → coach) en hoe ze de waarde bepalen: zie **§7bis** en
> **§8**. Duiven **verouderen** bovendien echt (§6).

---

## 2. Vluchten

### 2.1 Kalender (Brussel-tijd)
Elke dag heeft haar **eigen vaste programma**:

| Dag | Vluchten |
|---|---|
| **Maandag** | 06:00 **criterium onder 1 jaar** (§2.10) · 08:00 internationaal |
| **Dinsdag** | 10:00 regionaal · 12:00 **oefenvlucht** (§2.7) |
| **Woensdag** | 06:00 **criterium 1–2 jaar** (§2.10) · 08:00 nationaal |
| **Donderdag** | 06:00 **criterium 2–3 jaar** (§2.10) · 08:00 internationaal |
| **Vrijdag** | 06:00 **criterium ouder dan 3 jaar** (§2.10) · 10:00 regionaal · 12:00 **oefenvlucht** (§2.7) |
| **Zaterdag** | 08:00 **Titanenwedstrijd** (§2.8) of 05:00 **Estafettevlucht** (§2.9) — week om week, en de **enige** vlucht die dag |
| **Zondag** | 08:00 nationaal · 17:00 regionaal |

Dat zijn **8 wedstrijdvluchten + 4 criteriumvluchten + 2 oefenvluchten per week**:
3 regionale, 2 nationale, 2 internationale, 1 weekendwedstrijd en 4
leeftijdsvluchten. Bewust **minder vluchten dan
vroeger** (toen was er élke dag een lange én een korte vlucht): alle melkers
putten uit dezelfde duiven, dus een lichtere kalender betekent **meer duiven aan
de start van élke vlucht** en dus een **sterker deelnemersveld** om tegen te
strijden.

**Eén vlucht per duif per dag.** Staan er twee vluchten op één dag, dan kies je per
duif welke van de twee ze vliegt — een duif kan er **nooit twee op dezelfde dag**
doen (harde regel, §3.9). Met een breed hok pak je ze allebei mee, elk met een
andere duif.

> **De kalender in het spel staat per dag gegroepeerd**, met bovenaan twee rijen
> knoppen: één om te filteren op **soort** (🏁 competitie · 🏆 buiten competitie,
> dat zijn titan/estafette/oefenvlucht · 🎂 criterium) en één om **één dag** te
> bekijken. Een vlucht die **nu bezig** is staat altijd bovenaan, los van je
> filter.

**Gaat een wedstrijd wel door?** Een **wedstrijdvlucht** (regionaal, nationaal,
internationaal én de titanenwedstrijd) gaat **enkel door als er minstens 2
verschillende duivenmelkers** meedoen. Doet er maar één mee, dan wordt de vlucht
**afgelast** en krijgt iedereen zijn **inschrijfgeld terugbetaald**. Een
**oefenvlucht** mag wél doorgaan met één deelnemer.

### 2.2 Niveaus
| Niveau | Steden | Afstand | Inschrijfgeld |
|---|---|---|---|
| Regionaal | twee Vlaamse steden | 100–200 km | €10 |
| Nationaal | België + buurlanden (BE, NL, FR, LU, DE) | 200–500 km | €20 |
| Internationaal | tot de **grote fond** (BE, NL, FR, GB, LU, DE, ES) | 400–1200 km | €40 |

Start- en aankomststad worden **willekeurig** gekozen binnen het niveau; de
afstand wordt berekend uit de coördinaten (Haversine). Elke wedstrijdvlucht
respecteert een **minimumafstand** — regionaal **nooit onder 100 km**, nationaal
**nooit onder 200 km**, internationaal **nooit onder 400 km** — zodat de niveaus
duidelijk verschillen in zwaarte. De niveaus overlappen aan de bovenkant nog wel
een stukje: een regiovlucht loopt van ~100 tot bijna 200 km, een nationale tot
500 km, en de internationale vluchten reiken van ~400 km tot de klassieke
**grote-fond­losplaatsen** in het diepe zuiden (Bordeaux, Toulouse, Perpignan,
**Barcelona**), tot ~1200 km ver. Grotere afstand = zwaardere vlucht: meer
energieverbruik (§3) en meer gewicht op conditie en oriëntatie (§2.3).
(**Oefenvluchten** — §2.7 — vallen hierbuiten: die blijven bewust **kort**.)

### 2.3 Vluchtsnelheid (m/min)
Per duif, bevroren bij de start:

```
gewicht(afstand): t = clamp((afstand − 100) / 600, 0, 1)
  gewicht.snelheid = 0.68 + (0.26 − 0.68)·t
  gewicht.conditie = 0.32 + (0.74 − 0.32)·t

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

**Je tempo komt van snelheid en conditie**: snelheid is de sprint-eigenschap die
op korte vluchten het zwaarst weegt (0.68), conditie neemt het over naarmate de
vlucht langer wordt (tot 0.74).

> **De drie racevaardigheden zijn even veel waard.** Tien punten snelheid, tien
> punten conditie en tien punten oriëntatie leveren over een volledige speelweek
> ongeveer hetzelfde op — ze leveren het alleen op **verschillende vluchten**.
> Snelheid wint de regiovlucht, conditie en oriëntatie (§3.5) winnen de fond, en
> op een nationale vlucht wegen alle drie ongeveer even zwaar. Wie alles op één
> eigenschap zet, staat de halve kalender met lege handen.

> **Oriëntatie maakt een duif niet sneller.** Ze bepaalt of je duif de weg vindt —
> of ze omvliegt, of zelfs helemaal de weg kwijtraakt. Zie **§3.5**. Vroeger telde
> oriëntatie wél mee in de snelheid (op de fond zelfs zwaarder dan snelheid zelf),
> en dat klopte niet: navigeren is iets anders dan snel vliegen.

**Energie werkt afstandsafhankelijk:** op een **korte** vlucht wordt een futloze
duif maar licht afgestraft (ze kan er nog goed presteren); vanaf **middellange tot
lange** afstand weegt weinig energie veel zwaarder door.

> **Ervaring maakt een duif niet sneller.** Ze telde vroeger als een vaste bonus
> van tot +33% mee in de formule hierboven, en dat maakte haar in de praktijk een
> tweede snelheids-eigenschap — een duif met ervaring 0 kon simpelweg niet mee,
> hoe snel ze ook was. Dat is weg. **Snelheid bepaalt hoe hard een duif vliegt;
> energie en conditie bepalen hoe lang ze dat tempo volhoudt.** Precies dezelfde
> opruiming die oriëntatie eerder kreeg (§3.5).

**Wat ervaring wél doet, is je duif zuinig maken.** Ze verbruikt minder energie
per vlucht (§3), herstelt sneller van haar voer (§4), en kan een **lage tank
beter indelen**: tot 35% van haar energietekort wordt "goedgemaakt" in de
energiefactor hierboven. Dat laatste is **voorwaardelijk** — het is een
rantsoeneringstalent, geen snelheid:

| Energie van je duif | Wat ervaring 0 → 100 oplevert (500 km) |
|---|---|
| 100 (volle tank) | **niets** |
| 70 | +5 km/u |
| 40 | +10 km/u |
| 20 (bijna leeg) | +15 km/u |

Een frisse duif haalt dus **geen enkel** voordeel uit ervaring; een uitgeputte
wel. Bij gelijke andere eigenschappen kan een **ervaren duif met weinig energie**
daardoor nog steeds beter scoren dan een onervaren duif met weinig energie — maar
ze wint het nooit van een even snelle duif die gewoon uitgerust is.

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

**Kop en staart van de wedstrijd.** Bovenaan het live-bord staan twee balken: de
**kop** volgt de duif op de **eerste plaats** (die springt op 100% zodra de leider
thuis is) en de **staart** volgt de **laatste duif die nog in de wedstrijd zit**.
Duiven die **niet meer meedoen** — opgegeven of onderweg uitgevallen (§3.2, §3.4)
— tellen níet als staart: die zijn uit de race, niet achteraan. Zolang de twee
balken uit elkaar liggen, is het veld nog uitgesmeerd; staan ze allebei op 100%,
dan is iedereen die het haalt ook effectief thuis. Bij een **estafettevlucht**
(§2.9) gaan de balken over **ploegen** in plaats van losse duiven.

**🗺️ Live kaart.** Boven het bord staat een **echte kaart** met de route van de
losplaats naar huis en een stip voor elke duif die nog in de wedstrijd zit. De
posities zijn **echte geografie**: een duif die op 40 % van de route zit, staat
op 40 % van de werkelijke afstand. **Klik een stip** en je ziet van wie ze is,
haar plaats in de stand, hoeveel kilometer ze al vloog en nog moet, haar
snelheid en wanneer ze thuis verwacht wordt. Je eigen duiven staan groot in het
oranje, de leider in het goud. Duiven die **niet meer meedoen** (opgegeven,
uitgevallen of de weg kwijt) staan **niet** op de kaart — die zie je in het bord
eronder, met de reden. Bij een **estafettevlucht** (§2.9) toont de kaart de drie
etappes met hun wisselpunten, en vliegt elke duif op haar eigen etappe.

> **Een verdwaalde duif zie je ook echt afdwalen.** Raakt ze van koers (§3.5),
> dan schuift ze niet gewoon achteruit op de lijn — ze **verlaat de route** en
> komt er verderop weer op. De omweg die je op de kaart ziet is even lang als de
> extra kilometers die ze werkelijk vloog, dus je ziet meteen wáár haar tijd
> naartoe ging.

**Live-bord.** Tijdens de vlucht zie je per duif de afgelegde afstand en haar
**snelheid in km/u**. Dat is de **echte, effectieve snelheid** — berekend uit haar
eigenschappen, vorm-van-de-dag en het weer op het stuk dat ze op dat moment vliegt,
geen opsmuk. Het **loopt vloeiend mee**: bij elke verversing van het bord (om het
minuutje) staat er een actueel cijfer, dat geleidelijk op- en afloopt naarmate je
duif versnelt, wegzakt of een omweg vliegt.

> Vroeger sprong dat cijfer maar tien keer per vlucht — één keer per stuk waarin
> de route intern verdeeld is. Op een fondvlucht stond het daardoor tot een uur
> lang stil terwijl de afgelegde afstand ernaast elke minuut opschoof, wat las
> als een defect. De onderliggende race is niet veranderd: enkel de **weergave**
> loopt nu netjes tussen die stukken door.

**📻 Live verslag.** Het verslag naast het bord meldt **enkel wat er echt gebeurt**,
kort en zakelijk — geen sfeerzinnen, geen herhaling van wat het bord al toont. Je
leest er alleen feiten: de lossing, aankomsten, en onderweg vooral **wie wie
voorbijsteekt** — en, als de reden duidelijk is, **waaróm**:
- een duif **versnelt** / zet een tussensprint in en gaat erover;
- een duif **zakt weg** (verliest tempo) en wordt ingehaald;
- een duif **raakt van koers** en maakt een omweg (met een ruwe **~X km te veel**),
  waardoor ze fors terugvalt;
- een duif **valt stil door uitputting** (leeg) of krijgt **kramp/blessure** en geeft
  onderweg op;
- de melker **roept een duif terug** (opgeven);
- **koploperwissels** en de aankomsten.

Twee gelijkwaardige duiven die telkens van plaats wisselen worden even **gedempt**
(niet elke 10 min dezelfde ruil), behalve bij een koploperwissel of een verdwaalde
duif — die zijn altijd het vermelden waard.

**Het verslag houdt de kopgroep in de gaten, niet het hele veld.** Voorbijsteken
wordt gemeld voor de duiven die vooraan meedoen; dat iemand van de 77e naar de 76e
plaats gaat, is geen nieuws. En bij een **lange fondvlucht** (die uren of zelfs een
halve dag duurt) wordt de stand **minder vaak** bemonsterd — grofweg elk uur in
plaats van elke tien minuten — zodat het verslag leesbaar blijft in plaats van
honderden regels lang te worden. Aankomsten, uitvallers, opgevers en verdwaalde
duiven worden nog altijd **op hun eigen moment** gemeld, exact wanneer het gebeurt.

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

**Prijzengeld — élke duif die thuis raakt verdient iets.** De tabel loopt door
tot de laatste finisher: na de kopplaatsen volgen vlakke banden en daaronder een
bodem die iedereen krijgt. Wie **niet** finisht (opgegeven, uitgevallen of de weg
kwijt) krijgt niets.

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

Het **leeftijdscriterium** (§2.10) heeft eigen tabellen met dezelfde vorm: sprint
1.000/700/500/300/250/220/180/120, dan €100 (plaats 9–11), €80 (12–15) en €60
vanaf 16; fond 1.600/1.400/1.200/850/600/400/350/300, dan €175, €125 en €90.

**Punten** (top 20): 100, 80, 65, 55, 47, 40, 34, 29, 25, 21, 18, 15, 13, 11, 9, 7, 5, 3, 2, 1.
Seizoenspunten tellen op over **alle** vluchten en **alle** duiven van een hok.

### Hoogstens 3 duiven per hok verdienen per vlucht

Per vlucht worden enkel je **3 best geplaatste duiven** beloond — **geld én
seizoenspunten**. Je mag er gerust meer inschrijven: die vliegen gewoon mee, staan
in de uitslag, bouwen conditie en ervaring op en tellen mee voor de
duivenranglijsten — maar ze leveren geen geld en geen punten op. In de uitslag
staat er bij zo’n duif **“buiten de 3”**.

- **Een duif die niet finisht kost je geen plaats.** De limiet telt enkel duiven
  die thuis raken, dus wie onderweg twee duiven verliest heeft nog altijd drie die
  kunnen scoren.
- **Het geld vervalt, het schuift niet door.** Wordt je vierde duif zesde, dan
  blijft ze zesde in de uitslag en wordt het prijzengeld van plaats 6 gewoon niet
  uitbetaald — de duif die zevende werd krijgt nog steeds het bedrag van plaats 7.
- **Waarom.** Zonder deze regel is een diepe prijzentabel een machine voor het
  grootste hok: acht duiven inschrijven, acht keer incasseren. Nu bepaalt de
  kwaliteit van je beste drie wat een vlucht opbrengt, niet de omvang van je hok.

**Prijzengeld krijg je meteen — zodra je duif finisht.** Je hoeft niet te wachten
tot de hele vlucht is afgelopen (en de traagste duif eindelijk thuis is). **Op het
moment dat je duif over de finish komt**, staat haar eindplaats vast en wordt het
bijhorende **prijzengeld direct op je rekening gezet**, met een melding. De rest
(ranglijstpunten, medailles, weddenschappen, prestaties) wordt afgerekend wanneer de
vlucht **volledig** is afgerond. Zo blijf je nooit lang wachten op je centen, ook al
sukkelt er nog een verdwaalde duif rond.

### 2.7 Oefenvluchten (dinsdag & vrijdag, 12:00)
Een **oefenvlucht** is een korte training, geen wedstrijd:
- **Gratis** inschrijven — geen inschrijfgeld.
- **Geen** prijzengeld, **geen** seizoenspunten, **geen** overwinningen/medailles.
- **Telt niet mee voor de ranglijsten** (§15): enkel nationale, regionale en
  internationale **wedstrijdvluchten** tellen daar. Ook de opgebouwde conditie/
  oriëntatie van een oefenvlucht telt **niet** mee voor de vooruitgangsranglijst.
- Verbruikt **weinig** energie (in totaal ~**8**, ook geleidelijk afgetrokken).
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

### 2.8 Titanenwedstrijd (om de week, zaterdag 08:00)
De zaterdagwedstrijd **wisselt week na week** tussen twee prestigeformats: de
**Titanenwedstrijd** (hieronder) en de **Estafettevlucht** (§2.9). De titan
vraagt je **beste duif**, de estafette vraagt de **diepte van je hok** — samen
dwingen ze je dus twee verschillende hokken te bouwen. Welk van de twee er
aankomt, zie je gewoon op de vluchtkalender.

Bij de **Titanenwedstrijd**:
- **Elke duivenmelker mag maar één duif inschrijven.**
- **Middellange tot lange** afstand (~200–600 km).
- Er is **inschrijfgeld** (€50) en er valt **geld** te winnen: **geen
  seizoenspunten**, dus het telt **niet mee voor de melkerranglijst (de Roekoe,
  §15.2)**. Prijzengeld: **1e €1800, 2e €1200, 3e €900**.
- **Een podium telt wél mee voor je medailles en je prestaties** (§15.5) — goud,
  zilver en brons worden hier net zo geboekt als op een gewone wedstrijd.
- **Voor de duivenranglijsten (de Vleugel, §15.3) telt de titanenwedstrijd wél mee.**
  De snelheid, podiumplaatsen en vooruitgang van je duif in deze wedstrijd tellen dus
  gewoon mee voor de drie ranglijsten van individuele duiven — het is alleen de
  melker-puntentelling die er niet door beweegt.
- Je duif kan er, zoals bij elke vlucht, **wel op vooruitgaan** (conditie, enz.).
- Deze wedstrijd **vervangt** die dag alle andere vluchten (er is dus maar één).

### 2.9 Estafettevlucht (om de week, zaterdag 05:00)
De andere zaterdag is het **estafette**: geen solo-exploot, maar een **ploeg van
drie duiven** die elkaar aflossen over een lange route van zowat **900 km**. Ze
start **vroeg (05:00)**, want die afstand kost een ploeg een halve dag.

**Hoe het werkt**
- Je schrijft **één ploeg per hok** in, van **exact 3 duiven**. Inschrijfgeld:
  **€100 voor de hele ploeg** (niet per duif).
- De route wordt in **drie exact even lange etappes** gesneden (± 300 km elk).
  Start en aankomst zijn echte steden; de twee **wisselpunten** ertussen liggen
  precies op een derde en twee derde van de route, en worden aangeduid met de
  stad in de buurt (bv. *"ten oosten van Limoges"*).
- Er vliegt altijd maar **één duif van je ploeg tegelijk**. Bij elk wisselpunt
  neemt de volgende duif over. De **tijd van je ploeg** is de drie etappes bij
  elkaar opgeteld.
- **Elke duif betaalt enkel de energie van haar eigen etappe** (± 25 voor een
  gemiddelde duif) — per duif dus lichter dan één solo-fondvlucht, al zet je er
  wel drie tegelijk voor in.

**Eén schakel weg = ploeg weg.** Geeft een van je duiven onderweg op, of raakt ze
er niet (uitputting of blessure), dan is de **hele ploeg uitgeschakeld**. De
duiven die nog niet aan de beurt waren, vliegen dan gewoon **niet**: die betalen
geen energie en lopen geen enkel risico.

**Elke etappe heeft haar eigen weer.** Bij elke etappe staat een **weerbericht**,
al **dagen voor de start**, en dat wordt bijgewerkt zolang de voorspelling nog
verandert. Daarom mag je de **volgorde van je duiven wisselen tot de vlucht
begint**: de etappes zijn even lang, dus het weer is het enige wat je volgorde
uitmaakt. Vuistregel: **zet je sterkste duif op de zwaarste etappe** — daar
verlies je met haar de minste tijd. Bij overal hetzelfde weer maakt de volgorde
niets uit.

**Uitslag en prijzengeld**
- Eerst komen de ploegen die **compleet thuis** raken, op tijd. Daarna de
  **uitgeschakelde** ploegen, gerangschikt op hoe ver ze geraakt zijn. Een ploeg
  die uitvalt kan dus nog steeds in de prijzen eindigen als er weinig ploegen
  aankomen — maar nooit vóór een ploeg die het wél haalde.

| Plaats | Prijzengeld |
|---|---|
| 1e | €3.000 |
| 2e | €2.000 |
| 3e | €1.500 |
| 4e | €1.100 |
| 5e | €800 |

- Vanaf de **6e plaats** is er geen prijzengeld meer.
- Net als de titan: geen seizoenspunten, dus het telt **niet mee voor de
  melkerranglijst** (§15.2). Er kan ook **niet op gewed** worden. Een podiumplaats
  levert je wél een **medaille** op (§15.5) — één per ploeg, niet één per duif.
- **Voor de duivenranglijsten (§15.3) telt ze wél mee**: elke duif krijgt haar
  eigen gemiddelde over haar etappe. Duiven die door de uitschakeling nooit
  gevlogen hebben, tellen nergens mee.
- Je duiven gaan er gewoon op **vooruit** (conditie, ervaring, enz.), op basis
  van de plaats van je ploeg.

**Praktisch.** Heb je bij de start geen 3 vluchtklare duiven ingeschreven, dan
wordt je ploeg uit de wedstrijd gehaald en krijg je je inschrijfgeld terug. Haal
je één duif uit je ploeg, dan schrijf je meteen de **hele ploeg** uit (je kan
niet met twee vliegen) — ook dan komt je inschrijfgeld terug. En zoals bij elke
wedstrijd: er moeten **minstens 2 volledige ploegen** aan de start staan.

### 2.10 Leeftijdscriterium (ma/wo/do/vr, 06:00)

Naast het gewone seizoen loopt er een **tweede competitie, alleen voor duiven**.
Er zijn **vier leeftijdsklassen** en elke klasse krijgt **één eigen vlucht per
week**, waar enkel duiven van die leeftijd in mogen. Zo hoeft je jonge duif niet
meteen tegen doorwinterde routiniers, en heeft een oude kampioen nog altijd haar
eigen wedstrijd.

| Klasse | Leeftijd | Vluchtdag |
|---|---|---|
| 🐣 **Onder 1 jaar** | tot 1 jaar | maandag 06:00 |
| 🕊️ **1 tot 2 jaar** | 1 – 2 jaar | woensdag 06:00 |
| 🦅 **2 tot 3 jaar** | 2 – 3 jaar | donderdag 06:00 |
| 🏅 **Ouder dan 3 jaar** | vanaf 3 jaar | vrijdag 06:00 |

- **Inschrijfgeld €20**, en je mag er **zoveel duiven in zetten als je wil** —
  zolang ze in de juiste leeftijdsklasse vallen.
- De vlucht **wisselt week na week** tussen een **🏁 sprint** (100–300 km) en een
  **🛰️ grote fond** (400–1000 km). Alle vier de klassen vliegen dezelfde week
  hetzelfde format, dus per klasse zijn dat **2 sprints en 2 fondvluchten per
  seizoen**.
- Verder is het een **gewone wedstrijd**: normale energiekost (§3), normale kans
  op een blessure (§3.2), en je duif gaat er gewoon op vooruit.
- Bots doen mee, zodat de klassen een echt deelnemersveld hebben.

**Prijzengeld per vlucht**

| Plaats | 🏁 Sprint | 🛰️ Grote fond |
|---|---|---|
| 1e | €1.000 | €1.600 |
| 2e | €800 | €1.400 |
| 3e | €600 | €1.200 |
| 4e | €420 | €850 |
| 5e | €300 | €600 |
| 6e | €200 | €400 |
| 7e | €130 | €260 |
| 8e | €80 | €160 |

**De stand loopt drie seizoenen.** Eén vlucht per klasse per week is maar vier
resultaten per seizoen — veel te weinig om een veld te scheiden. Daarom telt de
criteriumstand **drie seizoenen** door (12 weken, dus 6 sprints en 6
fondvluchten) voor er een prijsuitreiking en een reset volgt. Punten krijg je met
**dezelfde tabel als een gewone vlucht** (100, 80, 65, 55, … — §2.6): een sprint
en een fondvlucht wegen **even zwaar**, alleen het geld verschilt.

| Plaats na 3 seizoenen | Prijs |
|---|---|
| 🥇 1e | €2.000 + **gouden titel** |
| 🥈 2e | €1.600 + **zilveren titel** |
| 🥉 3e | €1.200 + **bronzen titel** |

Het geld gaat naar de **eigenaar**, maar de **titel komt op de duif zelf** te
staan — die blijft bij haar, ook als je haar later verkoopt. Je ziet ze op haar
duifpagina.

**Wat het níet doet.** Het criterium is een **aparte rangschikking**: **geen
seizoenspunten** en geen overwinningen voor je hok, geen sponsorpremie (§12) en je
kan er **niet op wedden**. De **melkerranglijst (de Roekoe, §15.2) beweegt er dus
niet door.** Voor de gewone **duivenranglijsten** (§15.3) telt de vlucht wél mee,
net als de titanenwedstrijd.

**Wat het wél doet: medailles.** Een podiumplaats op een criteriumvlucht levert
gewoon goud, zilver of brons op, met de bijhorende prestaties (§15.5) — een
podium is een podium, op welke wedstrijd dan ook.

**Je duif wordt ouder — en klimt mee.** Duiven verouderen **4× sneller** dan de
echte klok (§6), dus over een volledige cyclus van drie seizoenen wordt een duif
bijna een jaar ouder. **Haar klasse wordt bepaald op het moment dat je haar
inschrijft.** Groeit ze tijdens de cyclus uit haar klasse, dan **blijven de punten
die ze daar verdiende gewoon staan** en begint ze bovendien punten te verzamelen
in haar nieuwe klasse. Ze kan dus in twee standen tegelijk verschijnen.

> **Strategie.** De klasse *onder 1 jaar* is de goedkoopste plek om een jong te
> laten rijpen: ze vliegt er tegen leeftijdsgenoten in plaats van tegen het hele
> veld. En omdat de stand drie seizoenen loopt, is **elke week meedoen** meer
> waard dan één keer schitteren — een duif die alle twaalf de vluchten uitvliegt,
> verzamelt meer dan een kampioen die de helft mist.

---

## 3. Effect van een vlucht op de duif

Per deelnemende duif:

| Effect | Formule | Wanneer |
|---|---|---|
| **Energie** (verbruik) | −((10 + afstand/30) · ervaringsfactor + willekeurig 0…10) | **geleidelijk tijdens de vlucht** (zie hieronder) |
| **Conditie** (opbouw) | +(0.3 + afstand/500 + willekeurig 0…0.4) | na afloop |
| **Gezondheid** | −(0,5 + afstand/250) × (1 + leegte van de tank) — zie §4.4 | na afloop |
| **Ervaring** | +(2 + afstand/100) × **leerfactor** (§3.7) | na afloop |

**Ervaring bepaalt mee hoeveel energie een vlucht kost.** Een ervaren duif vliegt
efficiënter en verbruikt **minder**; een onervaren duif verbruikt **meer**. De
ervaringsfactor draait rond **ervaring 50** (factor ×1,0) en zwenkt **±25%** aan de
uiteinden:
```
ervaringsfactor = 1 − (ervaring/100 − 0.5) · 0.5
  ervaring 0   → ×1.25   (25% meer verbruik)
  ervaring 50  → ×1.00
  ervaring 100 → ×0.75   (25% minder verbruik)
```
Jonge, pas gekweekte duiven (ervaring 0) betalen dus een toeslag; doorwinterde
vliegers besparen. De willekeurige spreiding (0…10) komt er los bovenop.

**Energie loopt gaandeweg leeg, niet in één klap achteraf.** Bij de start wordt
de totale energiekost van de rit vastgeklikt en vervolgens **per 30 minuten**
afgetrokken, evenredig met de afgelegde afstand. Je ziet de energiebalk van je
duif dus tijdens de wedstrijd zakken. **Een duif betaalt altijd alleen voor het
stuk dat ze effectief vloog:** wie de hele vlucht uitvliegt, betaalt de volledige
kost; wie halverwege **opgeeft** (§3.4) of **onderweg uitvalt** (DNF), betaalt
enkel voor de afgelegde afstand tot dat punt — nooit voor het stuk dat ze niet
meer vloog. Je kan de energiekost dus niet ontlopen door je duif net voor de
finish uit de race te halen, en een vroege uitvaller verliest navenant minder.

**Gemiddeld verbruik per afstand** (energie, inclusief de gemiddelde spreiding +5).
Nu de vluchten veel verder kunnen reiken (§2.2), loont ervaring — en een goede
energie­planning — nog meer op de lange fond:

| Afstand | Onervaren (erv. 0) | Gemiddeld (erv. 50) | Ervaren (erv. 100) |
|---|---|---|---|
| 100 km (regio) | ~21,7 | ~18,3 | ~15,0 |
| 200 km (regio/nationaal) | ~25,8 | ~21,7 | ~17,5 |
| 300 km (nationaal) | ~30,0 | ~25,0 | ~20,0 |
| 500 km (nationaal/intl.) | ~38,3 | ~31,7 | ~25,0 |
| 700 km (internationaal) | ~46,7 | ~38,3 | ~30,0 |
| 1000 km (grote fond) | ~59,2 | ~48,3 | ~37,5 |

> **Voorbeeld.** Een vlucht van **300 km** kost een gemiddelde duif ongeveer
> **25 energie**. Op een rit van ~5 uur gaat er dus zowat **2,5 energie per 30
> minuten** af. Een ervaren duif (ervaring 100) doet diezelfde vlucht met ~**20**
> energie, een groentje (ervaring 0) met ~**30**. Op een **grote-fondvlucht van
> 1000 km** loopt dat op tot ~**48** energie gemiddeld — en tot ~**59** voor een
> onervaren duif: zo'n rit legt een lege duif zowat helemaal plat. De duif wint na
> afloop conditie en ervaring, maar heeft daarna duidelijk meer rust (of
> Herstelvoer, §4) nodig voor ze weer inzetbaar is. Zet dus je meest ervaren,
> best uitgeruste duiven op de verste vluchten.
>
> **Let op:** een duif die **niet thuis raakt** (uitputting of een blessure
> onderweg, §3.2) krijgt **geen extra energiestraf** — ze betaalt enkel voor het
> stuk dat ze **wél** vloog, tot ze uitvalt. Op een lange fondvlucht is dat stuk
> echter vaak bijna de volledige route, dus een duif die pas **laat** uitvalt komt
> er alsnog zo goed als **leeg** uit (bovenop het verlies van punten/prijs en de
> blessure). Vroeg uitvallen spaart wél veel energie.

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

### 3.2 Vluchtvorm: waarom een duif geblesseerd raakt

Om in te schrijven heeft een duif **minstens 1 energie** nodig. Vliegt ze op een
haast lege tank, dan is er een reële kans dat ze de vlucht **niet uitrijdt (DNF)**
— ze raakt niet thuis, verdient geen punten of prijs, en is nadien vaak gekwetst.

Of een duif een **blessure** oploopt, hangt af van één cijfer: haar
**vluchtvorm**. Die combineert **energie** en **gezondheid**, waarbij de
**laagste van de twee dubbel telt** — één zwakke schakel wordt dus niet verstopt
door de andere.

```
vluchtvorm = (2 × laagste(energie, gezondheid) + hoogste) / 3   − rustaftrek (§3.6)
```

| Energie / Gezondheid | Vluchtvorm | |
|---|---|---|
| 90 / 95 | ≈ 92 | 🟢 fris |
| 80 / 90 | ≈ 83 | 🟢 fris |
| 60 / 85 | ≈ 68 | 🟡 matig |
| 40 / 70 | ≈ 50 | 🔴 risico |
| 20 / 50 | ≈ 30 | 🔴 gevaarlijk |

Je ziet de vluchtvorm op de duifpagina en in de keuzelijst bij het inschrijven,
met een 🟢/🟡/🔴-stip. **Kijk daarnaar, niet alleen naar de energiebalk.**

**Er zijn twee soorten blessures.**

- **Overbelasting** — verrekte borstspier, verstuikte vleugel, borstbeenkneuzing,
  botbreuk in de vleugel. Die loopt een duif op omdat de inspanning te zwaar was:
  **hoe lager de vluchtvorm, hoe groter de kans** én hoe zwaarder het letsel.
- **Pech** — een sperwer, een botsing, een afgebroken slagpen. Dat overkomt een
  topduif net zo goed als een sukkelaar: een **kleine, vaste kans** die je met
  geen enkele verzorging wegkrijgt. Bij een duif in topvorm is dít meestal de
  reden dat ze toch eens gehavend thuiskomt.

**Kans op een blessure per vlucht** (beide soorten samen):

| Vluchtvorm | 150 km | 300 km | 500 km | 700 km | 1000 km |
|---|---|---|---|---|---|
| 90 (top) | 2 % | 3 % | 3 % | 4 % | 5 % |
| 75 (goed) | 4 % | 5 % | 6 % | 7 % | 9 % |
| 65 (normaal) | 7 % | 9 % | 11 % | 13 % | 15 % |
| 55 (matig) | 12 % | 14 % | 17 % | 20 % | 25 % |
| 45 (zwak) | 18 % | 21 % | 26 % | 31 % | 38 % |
| 30 (gevaarlijk) | 30 % | 36 % | 44 % | 52 % | 64 % |

Afstand telt dus nog mee, maar veel minder dan vroeger: een fitte duif kan de
grote fond aan, terwijl een uitgeputte duif zelfs op een regiovlucht een risico
loopt.

**Hoe erg het wordt, hangt óók van de vluchtvorm af** (enkel bij overbelasting —
pech is pech). Dat scheelt dagen uitval: licht ≈ 1,5 dag met volle zorg,
ernstig ≈ 6 dagen.

| Vluchtvorm | Licht | Matig | Ernstig |
|---|---|---|---|
| 90 | 66 % | 26 % | 8 % |
| 70 | 58 % | 28 % | 14 % |
| 50 | 50 % | 30 % | 20 % |
| 30 | 42 % | 32 % | 26 % |

**Sterfte bij een bijna lege tank.** Vertrekt een duif met **minder dan 5
energie**, dan is er een kleine kans (~7 %) dat ze het niet haalt. Een duif die
je zelf **opgeeft** loopt dat risico niet, en oefenvluchten (§2.7) kennen géén
blessure- of sterfterisico.

> **Voorbeeld.** Een duif met energie 46 en gezondheid 90 heeft vluchtvorm 61 —
> "matig". Op een nationale vlucht van 300 km is haar kans op een blessure ~10 %.
> Dezelfde duif goed uitgerust (energie 80, gezondheid 90 → vorm 83) zit op ~3 %.
> Uitrusten loont dus echt.

### 3.3 Geen tijdslimiet — elke duif krijgt de tijd om thuis te komen

Er is **geen wedstrijddeadline**. Vroeger startte er een klok van 90 minuten zodra
de eerste duif thuis was, en werd elke duif die daarna nog niet binnen was
geëlimineerd. Dat is **afgeschaft**: een wedstrijd loopt nu door **tot de laatste
duif die het effectief haalt ook thuis is**. Een trage duif — of een die onderweg
**verdwaald** raakte en een omweg vloog — wordt dus **niet meer weggestreept** puur
omdat de kopvrouw al lang binnen is; ze krijgt gewoon de tijd om (mogelijk) alsnog
thuis te komen, verdient haar plaats in de uitslag en kan er punten/prijs aan
overhouden.

```
duur_wedstrijd = de traagste duif die thuis raakt
```

Enkel duiven die **echt niet thuis raken** blijven DNF: wie je **zelf opgeeft**
(§3.4), of wie **onderweg uitvalt** door uitputting of een blessure (§3.2). Dat een
race daardoor wat langer kan duren (zeker met een verdwaalde duif) is de bewuste
prijs: iedereen mag uitvliegen. Je hoeft daar zelf **niet** op te wachten: een duif
die binnen is, is meteen weer vrij (§3.8).

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

### 3.5 Oriëntatie: verdwalen, omvliegen en de weg kwijtraken

Oriëntatie is je **navigatie-eigenschap** en doet niets met je snelheid. Ze bepaalt
of je duif de lijn naar huis houdt — of kilometers omvliegt en soms de weg helemaal
kwijtraakt. Op een lange vlucht is ze **even veel waard als conditie** (§2.3).

**🕊️ Eerst: duiven vliegen als een zwerm.** Bij de lossing gaan alle korven
tegelijk open en vertrekt het hele veld als één wolk. Zolang je duif in die groep
zit, **raakt ze zo goed als niet van koers** — de duiven die de weg kennen slepen
de rest gewoon mee, ook een duif met een zwakke oriëntatie. Pas wanneer het veld
**uit elkaar getrokken** wordt — de snelle duiven lopen weg, de groep valt in
kleinere groepjes uiteen — vliegt ze op haar eigen kompas, en dán pas telt haar
oriëntatie echt mee.

Daaruit volgt vanzelf:
- **In de eerste kilometers gebeurt er bijna niets.** Van alle afdwalingen valt er
  maar zo'n **3 %** in het eerste tiende van de route.
- **Op een korte vlucht blijft de groep langer samen** — er is minder tijd om uit
  elkaar te lopen — dus verdwalen is er zeldzamer.
- **Op de fond breekt het veld snel open**, en daar doet oriëntatie dus het meeste
  werk. Precies zoals het hoort.
- **Hoe groter het deelnemersveld, hoe beter de dekking.** Vlieg je in een klein
  veld van drie of vier duiven, dan is er nauwelijks een groep om je in te
  verstoppen.

**Het is geen enkele muntworp.** Hoe verder de vlucht, hoe meer gelegenheid om af
te dwalen: een slechte navigator kan op de fond twee of zelfs drie keer de lijn
kwijtraken, een goede houdt hem vast. En het blijft **een kans** — ook een matige
navigator vliegt geregeld een volkomen schone race, ze heeft er alleen minder vaak
geluk mee.

**Kans dat ze minstens één keer van koers raakt** (mooi weer, vol deelnemersveld):

| Oriëntatie | 150 km | 300 km | 500 km | 700 km | 1000 km |
|---|---|---|---|---|---|
| 95 | 5 % | 8 % | 11 % | 13 % | 18 % |
| 85 | 19 % | 29 % | 37 % | 44 % | 52 % |
| 70 | 46 % | 63 % | 72 % | 80 % | 86 % |
| 60 | 60 % | 77 % | 85 % | 91 % | 95 % |
| 50 | 76 % | 88 % | 93 % | 97 % | 99 % |
| 30 | 89 % | 97 % | 98 % | 99 % | 100 % |

Belangrijker dan die kans is hoe vaak ze **helemaal schoon** thuiskomt — één kleine
omweg kost je zelden de wedstrijd, drie grote wel:

| Oriëntatie | Vlucht zonder één omweg (150 km) | 500 km | 1000 km |
|---|---|---|---|
| 95 | 94 % | 89 % | 82 % |
| 85 | 80 % | 62 % | 48 % |
| 70 | 51 % | 28 % | 14 % |
| 60 | 40 % | 15 % | 5 % |
| 30 | 14 % | 2 % | 0 % |

**Slecht weer maakt het erger, maar niet voor iedereen.** Mist, regen en harde wind
verhogen de kans fors. Op 700 km gaat een duif met oriëntatie 95 van 13 % naar
21 %, terwijl oriëntatie 70 van 80 % naar 92 % springt. Een goede navigator merkt
er weinig van; een slechte is bij ruw weer nagenoeg kansloos.

**Meestal is het een omweg.** Echte extra kilometers: dus echt tijdverlies, een val
in de stand, én **extra energie** — die kilometers moeten gevlogen worden. De
omvang varieert sterk: soms een wiebeltje, soms een lus. **Op de live kaart
(§2.4) zie je het gebeuren**: je duif buigt van de route af en komt er verderop
weer op, over precies de kilometers die haar de tijd kostten.

| Oriëntatie | Totale omweg op 300 km | Op 700 km | Op 1000 km |
|---|---|---|---|
| 95 | ~9 km | ~17 km | ~26 km |
| 85 | ~13 km | ~26 km | ~42 km |
| 70 | ~20 km | ~51 km | ~83 km |
| 60 | ~23 km | ~71 km | ~114 km |
| 30 | ~28 km | ~102 km | ~148 km |

*(gemiddelde wanneer ze effectief van koers raakt — komt ze schoon thuis, dan is het nul)*

**De fond is bewust milder geworden.** Oriëntatie woog daar veel te zwaar: een duif
met oriëntatie 60 vloog op een vlucht van ~730 km gemiddeld **102 km** om en zat in
**bijna drie op vier** vluchten tegen het maximum aan. Dat maakte van de eigenschap
geen risico meer maar een vaste tol — en daardoor voelde een verschil van veertien
punten oriëntatie aan als een afgrond in plaats van een gradiënt. Nu is dat
gemiddeld **66 km** en raakt ze het maximum nog in ongeveer één op vier vluchten.
Op 1000 km ging de omweg van een goede navigator van ~57 naar ~26 km.

**Op een korte vlucht blijft de omweg klein.** Een omweg is een hap uit de route,
en op een sprint van 120 km beslist die hap meteen de wedstrijd. Daar praat je over
zo'n **6 km** (hoogstens 8), tegen tientallen kilometers op de fond. Van koers raken
kost je op een sprint dus plaatsen, en op de fond nog altijd je dag — alleen niet
meer je hele week. Je raakt op een sprint wél iets **vaker** van koers dan vroeger:
de eigenschap telt nu over de hele kalender mee in plaats van bijna alleen op de fond.

**Er is een bovengrens.** Hoe slecht het ook loopt, een duif vliegt op de fond
**nooit meer dan ~15 % om**, en op een korte vlucht **nooit meer dan ~7 %**. Een
fondvlucht van 1000 km wordt in het allerergste geval 1150 km, geen odyssee — je
verliest de wedstrijd, niet je hele dag.

**Soms raakt ze de weg helemaal kwijt.** Dan komt ze die dag niet thuis en telt ze
als DNF. **Je duif is nooit voorgoed weg** — duiven vinden hun weg terug — maar het
duurt een **paar dagen**, en ze komt binnen met een **lege tank**, fors minder
gezondheid en vaak een kwetsuur of ziekte. Zolang ze onderweg is kan ze niets: niet
vliegen, trainen, koppelen, op rustkuur of verkocht worden. Ze eet ook niets van je
voorraad en lijdt geen honger — ze is er simpelweg niet.

| Oriëntatie | Niet thuis (300 km) | 1000 km | 1000 km, slecht weer |
|---|---|---|---|
| 85 of hoger | praktisch nul | praktisch nul | praktisch nul |
| 70 | ~0 % | 0,1 % | 0,1 % |
| 50 | 0,9 % | 1,3 % | 1,7 % |
| 30 | 3,2 % | 4,9 % | 5,0 % |

*(deze kansen zijn bewust gelijk gehouden aan vroeger — de herbalans hierboven gaat
over de omweg, niet over het risico dat je duif helemaal wegblijft)*

**Oriëntatie groeit door te vliegen**, en het snelst op **lange vluchten**. Je kan
haar ook trainen (tot 80), en een **privécoach** werkt er eveneens aan tot het
genetische plafond.

> **Strategie.** Zet een duif met zwakke oriëntatie op **korte vluchten bij goed
> weer** — daar blijft de zwerm het langst samen en is de omweg klein — en bouw
> haar op met oefenvluchten en de coach. Voor de grote fond — zeker
> met slecht weer op komst — stuur je je beste navigators. Op die vluchten is een
> goede navigator evenveel waard als een goede conditie.

### 3.6 Twee dagen op rij vliegen kost vorm

**Rust kan je niet kopen.** Energie wel: met Herstelvoer en een apart hok komt er
tot ~14 energie per nacht bij, genoeg om een korte vlucht dag na dag te doen
zonder dat de energiebalk het laat zien. Daarom gaat er **rechtstreeks vluchtvorm
af** als een duif net gevlogen heeft:

| Laatste vlucht | Aftrek op de vluchtvorm |
|---|---|
| gisteren | **−15** |
| eergisteren | −7 |
| langer geleden | geen |

Een **oefenvlucht** telt maar voor een derde (−5). In de praktijk **verdubbelt**
zo'n aftrek de kans op een blessure — ook al ziet je duif er verder prima uit.

> **Je hoeft er zelf niet mee te rekenen.** Het vormcijfer op de duifpagina en in
> de inschrijflijst is **al ná die aftrek**, net als de 🟢/🟡/🔴-stip. Vloog je duif
> gisteren, dan zie je haar vorm gewoon lager staan.

> Wie zijn duiven laat roteren in plaats van dezelfde vogel elke dag op te
> offeren, heeft dus meetbaar minder blessures.

### 3.7 Ervaring: een groentje leert snel, een veteraan amper nog

Ervaring stijgt **niet** aan een vast tempo. Élke ervaringswinst — een vlucht, een
oefenvlucht, een trainingsbeurt, een dag privécoach, een gebeurtenis — wordt
vermenigvuldigd met een **leerfactor** die afhangt van hoeveel ervaring de duif al
heeft:

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

**Wat blijft gelden:**
- **Een verre vlucht leert nog steeds meer dan een korte.** De leerfactor schaalt
  alles evenredig, dus de rangorde tussen vluchten verandert niet — een fondvlucht
  blijft de beste leerschool.
- **Het loopt nooit helemaal vast.** Ook op ervaring 95 pikt een duif nog iets op;
  het duurt gewoon lang.
- **Ervaring heeft geen gen-cap.** Elke duif kan in principe 100 halen (anders dan
  snelheid/conditie/oriëntatie, §7bis) — het is een kwestie van kilometers maken.

**Ruwe orde van grootte.** Een duif die ~3 wedstrijden en 2 oefenvluchten per week
vliegt met een coach erbij, zit na ongeveer **2 weken op ervaring 50**, na **6
weken op 80**, en heeft er zo'n **11 weken** voor nodig om tegen de 100 aan te
leunen. Het volledige traject 0 → 100 kost dus ruwweg **2,5× meer vluchten** dan
vroeger, terwijl de eerste helft juist **sneller** gaat dan vroeger.

> **Strategie.** Laat jonge duiven **vroeg en vaak** meevliegen: hun ervaring is er
> in enkele weken. Bij een duif die al ver zit, koop je met een extra vlucht amper
> nog ervaring bij — die zet je beter in wanneer het écht telt.

> **Bestaande duiven** behouden hun opgebouwde ervaring; enkel de groei **vanaf nu**
> volgt de leerfactor. Een doorwinterde duif verliest dus niets, maar haar voorsprong
> is voortaan wél moeilijker in te halen.

### 3.8 Thuis = meteen weer beschikbaar

Een vlucht loopt door tot de **laatste** duif thuis is (§3.3). Op een fondvlucht van
1000 km kan die staart **uren** duren. Je duif hoeft daar niet op te wachten:
**zodra haar eigen race erop zit, is ze weer vrij** — ook al staat de vlucht nog
"live" op het bord.

Vrij betekent **alles wat normaal kan, kan weer**: haar **inschrijven voor een
volgende wedstrijd**, **trainen**, **koppelen**, in de **ziekenboeg** zetten, een
**rustkuur** geven, te koop zetten of verkopen.

> **Omgekeerd geldt het net zo hard: zolang ze nog vliegt, kan je haar nergens voor
> inschrijven.** Ook niet voor een vlucht van morgen of overmorgen. Je weet op dat
> moment namelijk niet wanneer ze thuis is — of **óf** ze thuis komt: een duif die de
> weg helemaal kwijt raakt (§3.5) is dagen weg. Wacht dus tot haar race erop zit; dan
> staat ze meteen weer ter beschikking.

Haar race zit erop zodra ze:
- **over de finish** komt, of
- **onderweg uitvalt** (uitputting of blessure, §3.2), of
- door jou **opgegeven** wordt (§3.4) — precies waar opgeven voor dient: ze staat
  meteen weer paraat i.p.v. de rest van de vlucht geblokkeerd te zijn.

> **Uitzondering: een tweede vlucht diezelfde dag kan niet.** "Vrij" betekent
> alles hierboven, maar **geen tweede race op dezelfde kalenderdag** — zie de harde
> regel in §3.9. Ze is dus wel meteen te trainen, te koppelen of te verkopen, en je
> kan haar meteen inschrijven voor een vlucht van **morgen**.

**Estafettevlucht** (§2.9): daar telt je **eigen leg**. Wie leg 1 gevlogen heeft, is
vrij zodra ze het stokje doorgeeft; wie op leg 3 staat te wachten blijft geblokkeerd
tot haar beurt geweest is. Valt een ploegmaat vóór haar uit, dan vliegt ze die dag
niet meer en is ze op dat moment meteen vrij.

> **Let op — je energie is al betaald.** Een duif die finisht heeft op dat moment de
> **volledige** energiekost van haar rit al betaald (die loopt geleidelijk mee, §3).
> Je wint dus niets door haar vroeg terug in te zetten: na een zware fondvlucht staat
> ze gewoon leeg, en de aftrek op haar **vluchtvorm** (§3.6) voor "gisteren gevlogen"
> geldt onverkort.
>
> De rest van de afrekening — **ranglijstpunten, medailles, weddenschappen,
> prestaties** en de **conditie-/ervaringswinst** van de rit — volgt nog altijd bij de
> **afronding** van de hele vlucht. Je **prijzengeld** krijg je wél al meteen bij het
> finishen (§2.6).

Twee uitzonderingen blijven staan: een duif die **de weg helemaal kwijt** is (§3.5) is
pas beschikbaar als ze een paar dagen later thuiskomt, en wie al binnen of al
uitgevallen is kan je **niet meer opgeven** — haar uitslag ligt dan vast.

### 3.9 Eén vlucht per duif per dag (harde regel)

Een duif vliegt **hoogstens één vlucht per kalenderdag**. Punt. Het maakt niet uit
of die andere race nog moet beginnen, bezig is, of allang uitgevlogen: staat je duif
die dag op een vlucht, dan is haar dag **op**.

- Geldt voor **alle** vluchtsoorten door elkaar: een oefenvlucht, een
  leeftijdscriterium (§2.10), een titanenwedstrijd (§2.8) of een estafettevlucht
  (§2.9) tellen alle vier mee als "haar vlucht van vandaag".
- Op de kalender staan meerdere vluchten per dag (§2.1) — je **kiest** er dus één per
  duif. Wil je beide vluchten van een dag meepakken, dan doe je dat met **twee
  verschillende duiven**.
- **Uitschrijven geeft de dag terug.** Haal je haar vóór de start weer van de vlucht
  (met terugbetaling van het inschrijfgeld), dan is die dag weer vrij voor een andere
  vlucht. Een race die ze **effectief gevlogen** heeft geef je niet meer terug — ook
  niet als ze DNF ging of als je haar hebt laten **opgeven** (§3.4).
- Een vlucht die **afgelast** wordt (te weinig melkers, §2.1) telt niet mee: die is
  nooit doorgegaan, dus je duif kan diezelfde dag gewoon een andere vlucht doen.
- **Niet inzetbaar bij de lossing = niet mee, met terugbetaling.** Je schrijft dagen
  vooraf in, en er kan intussen van alles gebeuren. Is je duif op het moment van de
  lossing nog **onderweg op een andere vlucht**, **de weg kwijt** (§3.5), **ziek of
  gewond**, **in de ziekenboeg**, **op rustkuur** of aan het **koppelen**, dan gaat ze
  niet mee: ze wordt van de vlucht gehaald, je **inschrijfgeld komt terug** en je
  krijgt een melding. Openstaande weddenschappen op die duif worden ook terugbetaald
  (§14). Bij een **estafette** neemt één zo'n duif de **hele ploeg** uit de wedstrijd —
  je kan geen etappe te kort vliegen.
- **Computermelkers volgen exact dezelfde regel** (§17) — geen enkele bot zet een duif
  twee keer op één dag in.

In het spel zie je dit meteen: een duif die die dag al ergens ingeschreven staat,
staat **niet** in de keuzelijst bij het inschrijven, met een regeltje eronder dat
zegt hoeveel duiven om die reden wegvallen.

> **Waarom.** Dit maakt het plannen van je week de eigenlijke keuze. Zonder deze regel
> kon een topduif op een drukke dag twee keer starten en dubbel scoren; nu moet je per
> dag beslissen wélke vlucht ze rijdt, en de rest van je hok vult de andere op. Boven
> op deze regel blijft de vormaftrek voor "gisteren gevlogen" (§3.6) gewoon gelden —
> twee dagen op rij vliegen mág, maar kost vorm.

---

## 4. Voeding & verzorging (dagelijks, echte tijd)

Voeding en herstel gebeuren **elke dag** automatisch (niet pas op weekeinde) —
energie, gezondheid, conditie en libido bewegen dus dagelijks. Dat gebeurt bij de
**dagovergang, om 00:00** (Belgische tijd): op dat ene moment krijgen álle duiven
tegelijk hun dagelijkse voeding/herstel — het maakt dus niet uit hoe laat je
inlogt. Heeft een duif haar energie vandaag al gehad, dan is het **volgende**
moment terug morgen om **0 u 00**. Zo is iedereen op hetzelfde moment aan de
beurt — het eerlijkst voor iedereen.

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
| Herstel | 1.5 kg | €3 | **energie +42**, **gezondheid +12** |

Iedereen start (na de overstap) met **50 kg Normaal**; alle duiven staan standaard
op Normaal.

**Voer kopen én terugverkopen.** Op de **Overzicht**-pagina (Verzorging) staat een
voerbalie die twee kanten op werkt. Kopen gebeurt aan de prijs uit de tabel
hierboven. Te veel gekocht, of een voertype dat je niet meer gebruikt? Dan neemt de
voerhandelaar het terug aan **80 % van de aankoopprijs** — je maakt op een verkoop
dus **altijd een klein verlies**. Met de knop *Alles* verkoop je in één keer je hele
voorraad van dat type.

| Type | Koopprijs/kg | Terugkoopprijs/kg | Verlies per kg |
|---|---|---|---|
| Normaal | €3 | €2,40 | €0,60 |
| Premium | €6 | €4,80 | €1,20 |
| Libido-mix | €4,50 | €3,60 | €0,90 |
| Herstel | €3 | €2,40 | €0,60 |

> Voer is dus **geen spaarpot**: 100 kg Premium kopen en meteen terugverkopen kost
> je €120. Koop wat je de komende dagen nodig hebt — de terugkoop is een uitweg uit
> een misrekening, geen handel.

Per dag, per gevoerde duif (weekwaarden gedeeld door 7):
```
Energie   += (energie_per_week / 7) · (1 + Ervaring/200)   // ervaring = sneller herstel
Gezondheid+= (gezondheid_per_week / 7) · (1 + (100 − Gezondheid)/100) + Conditie/280
             // hoe verder gezakt, hoe sneller ze terugveert
```

> **Duif in de ziekenboeg?** Dan geldt dit energieherstel maar aan **50 %** — en enkel
> als ze door een dokter/kinesist verzorgd wordt (anders 0). Zie §5.4.

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
  Libido    −= 4 · N
sterftekans = 0                          als N < 3
            = min(0.25 · (N−2), 0.95)    vanaf dag 3
            = 100%                        vanaf dag 7
```

> **Honger vreet geen getrainde vaardigheden meer op.** Vroeger daalde ook de
> **conditie** door honger; dat is geschrapt. **Trainbare vaardigheden (snelheid,
> conditie, oriëntatie) kunnen enkel nog dalen door échte ouderdom** (§6) — nooit
> door een tijdelijk voertekort of iets anders. Honger blijft wel hard toeslaan op
> energie, gezondheid en libido (en kan dodelijk zijn).

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

### 4.2 Vaste onkosten (dagelijks, automatisch)
Alle terugkerende kosten worden **elke dag automatisch** afgerekend (niet meer
wekelijks/handmatig):
```
onkosten/dag = 22                                    (vast, ongeacht hokgrootte)
             + onderhoud per duif (in schijven, zie hieronder)
             + 80 · aantal_gecoachte_duiven          (coach, §13)
             + 57 · dokters + 50 · kinesisten        (ziekenboegstaf, §5)
             + 6  · duiven_in_boeg (met medicatievoer)
```

**Onderhoud per duif gaat in schijven — hoe groter je hok, hoe duurder elke
extra duif.** Het werkt zoals belastingschijven: élke duif betaalt het tarief
van háár schijf, nooit het toptarief op je hele hok.

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

*(inclusief de vaste €22 basiskost)*

Een hok van **8 duiven betaalt exact hetzelfde als vroeger** — deze schijven
raken enkel wie groter gaat. Een vol hok van 20 kost nu ongeveer **5× een hok
van 8**, in verhouding tot de veel grotere verdiencapaciteit die zo'n hok heeft
(meer duiven = meer inschrijvingen = een groter deel van de prijzenpot). De
volledige onderverdeling staat in de **Dagbalans** op het Overzicht, met een
regel per schijf.
**Sponsors** betalen op datzelfde ritme: elke actieve sponsor stort **elke dag**
zijn vaste bijdrage (§12). Op het **Overzicht** vind je daarom een **dagbalans**:
je kosten, je sponsorinkomsten en wat je netto per dag over- of tekortkomt.
Voer wordt apart uit je voorraad verbruikt (§4). Ziekte/sterfte-rondes en de
seizoenswissel lopen los daarvan (§5, §6, §15).

Onkosten kunnen je kassa **onder €0** duwen. Sta je negatief, dan **kan je niet
meer inschrijven** voor vluchten: eerst een duif verkopen om terug uit het rood
te geraken.

### 4.3 Rustkuur (energie én gezondheid kopen met tijd)
Naast wachten en Herstelvoer kan je een duif een **betaalde rustkuur** geven op
haar duifpagina:
- Kost **€300** en duurt **twee dagen** (48 u, echte tijd).
- Tijdens de kuur **rust** de duif volledig: ze kan **niets** doen — **geen
  vluchten, geen training, geen koppelen** — tot de 48 u om zijn.
- Als de kuur voorbij is, krijgt ze in één keer **+40 energie en +15
  gezondheid** (met een melding). Het is dus de snelste weg terug naar een
  groene vluchtvorm (§3.2).
- **Elke duif mag op kuur**, en je mag er gerust meerdere tegelijk op zetten —
  maar **elke duif maar één keer per week**. Die teller loopt **per duif**,
  vanaf het moment dat haar kuur begon: na de twee dagen kuur duurt het dus nog
  vijf dagen voor diezelfde duif opnieuw kan. Op haar duifpagina staat vanaf
  wanneer dat is.

Handig als een duif in het rood staat en je haar snel weer inzetbaar wil krijgen
zonder op de dagelijkse verzorging te wachten. Je kan geen kuur starten voor een
duif die al ingeschreven staat, of die al vol energie én gezondheid zit.

### 4.4 Wat een wedstrijd aan gezondheid kost

Vliegen slijt. Elke wedstrijd kost gezondheid, en **extra als je duif leeg
thuiskomt**:

```
gezondheidskost = (0,5 + afstand/250) × (1 + (100 − energie bij aankomst)/100 × 0,8)
```

| Afstand | Kost (leeg thuis) |
|---|---|
| 200 km | ≈ −2 |
| 300 km | ≈ −3 |
| 500 km | ≈ −4 |
| 1000 km | ≈ −7 |

Gezondheid komt vanzelf terug met voer, en **sneller naarmate ze verder gezakt
is**. Herstelvoer is daarvoor het beste (§4). Grofweg: **één à twee wedstrijden
per week** houdt een duif duurzaam op peil; wie er drie of meer vliegt, ziet haar
gezondheid — en dus haar vluchtvorm — stelselmatig zakken.

## 5. Ziekte, kwetsuur & ziekenboeg

### 5.1 Aandoeningen
**Ziektes (besmettelijk):** Het Geel (licht), Duivenpokken (matig), Ornithose
(matig), Coccidiose (matig), Paramyxovirose (ernstig), Salmonellose (ernstig).
**Kwetsuren (via vluchten)** komen in twee soorten (zie §3.2):
- **Door overbelasting** — verrekte borstspier (licht), verstuikte vleugel
  (matig), borstbeenkneuzing (matig), botbreuk in de vleugel (ernstig). De kans
  én de ernst hangen af van de vluchtvorm van je duif.
- **Door pech** — gebroken slagpen (licht), gekneusde poot (licht),
  sperwerverwonding (ernstig). Een kleine, vaste kans die niets met verzorging te
  maken heeft.

Bij het uitbreken zakt de gezondheid meteen: **licht −10, matig −22, ernstig −38**.
Bovendien blijft een aandoening de gezondheid **elke dag verder ondermijnen**
zolang de duif niet genezen is — **licht −0,6, matig −1,5, ernstig −2,5 per dag**,
en **×1,5** zolang ze *niet* in de ziekenboeg zit. Een zieke of gekwetste duif die
je laat aanmodderen wordt dus steeds zwakker; snel behandelen beperkt de schade.

### 5.2 Kans op ziekte (elke dag, in echte tijd)
Duiven worden **effectief ziek tijdens het spelen**: elke dagovergang (00:00)
krijgt elke gezonde, niet-geïsoleerde duif een kans om ziek te worden.

**Ziek worden werkt op dezelfde vluchtvorm als een blessure** (§3.2): de
combinatie van **energie en gezondheid**, met de laagste van de twee dubbel
geteld. Zo bepaalt één en dezelfde vraag — *hoe goed houd ik deze duif?* — zowel
je blessure- als je ziekterisico.

| Vluchtvorm | Kans om ziek te worden, per week |
|---|---|
| 90 (top) | ≈ 1 % |
| 75 (goed) | ≈ 3 % |
| 65 (normaal) | ≈ 5 % |
| 55 (matig) | ≈ 9 % |
| 45 (zwak) | ≈ 14 % |
| 30 (gevaarlijk) | ≈ 24 % |

Een hok van acht kerngezonde duiven ziet zo ongeveer **één ziektegeval per tien
weken**; een verwaarloosd hok gaat binnen de week onderuit.

**Gezondheid is geen schild.** Ook in topvorm blijft er ~1 % per week over — net
als bij mensen wordt een topfit beest af en toe eens ziek. En een **zieke duif
die je niet isoleert besmet de rest**: een fitte hokgenoot vangt minder makkelijk
iets op, maar is nooit immuun.

**Hoe erg de ziekte is, hangt óók van die vluchtvorm af.** Een duif in goede doen
sleept meestal iets lichts op; een verzwakte duif is degene die iets zwaars
oploopt:

| Vluchtvorm | Licht | Matig | Ernstig |
|---|---|---|---|
| 80 of hoger | 55 % | 33 % | 12 % |
| 55 | 47 % | 34 % | 19 % |
| 30 | 40 % | 34 % | 26 % |

Een duif **in de ziekenboeg** is geïsoleerd: ze besmet niemand en wordt niet
besmet. Een **apart hok** verlaagt de ziektekans eveneens fors.

**Onbehandeld = gevaarlijk.** Een matige of ernstige aandoening die je niet
verzorgt kan **dodelijk** aflopen. Een ernstig letsel dat je z'n hele beloop
buiten de ziekenboeg laat, heeft zo'n **~1 kans op 4** om de duif te kosten; in de
ziekenboeg zakt dat tot **~2 %**. Lichte aandoeningen zijn nooit dodelijk.

### 5.3 Herstel (in echte tijd)
Herstel loopt **continu in echte tijd** (niet meer als wekelijkse kansworp). Een
ziekte of kwetsuur is een **echte tegenslag**: de duif kan niet vliegen, trainen
of broeden zolang ze niet genezen is. Een duif die gewoon in het hok rust,
geneest volledig na (bij benadering):
```
licht ~5 dagen · matig ~11 dagen · ernstig ~18 dagen
```
Goede zorg **versnelt** dat, maar geneest niet in een dag: de ziekenboeg ×1,8, een
dekkende dokter/kinesist ×1,4, en medicinaal voer ×1,2 — die stapelen. Met alles
samen (×~3) geneest een licht letsel in **~1,5 dag**, een matig in **~3,5 dagen**
en een ernstig in **~6 dagen**. Reken dus op enkele dagen uitval — zet je meest
kwetsbare duiven niet nodeloos op de zwaarste vluchten.

> **Statusupdates.** Om de **12 uur** krijg je per herstellende duif een bericht
> van de kinesist/dokter met het **herstelpercentage**, een schatting **hoe lang
> nog** tot ze weer vliegensklaar is, en een tip (bv. "zet ze in de ziekenboeg"
> of "zet medicatievoer aan"). In de ziekenboeg zie je bovendien een herstelbalk
> per duif. Zo zie je meteen dat je verzorging helpt.

### 5.4 De ziekenboeg
- Capaciteit: **2 duiven** (uitbreidbaar naar 3/4/5/6 voor €800/1200/1800/2400).
- **Medicinaal voer**: €6/duif/dag, verhoogt herstel van iedereen in de boeg.
- **Duivendokter**: €57/dag, geneest **2** zieke duiven (ziektes).
- **Duivenkinesist**: €50/dag, geneest **2** duiven (kwetsuren).
- **Meer patiënten dan plaatsen? Jij kiest.** Eén dokter behandelt maar **2** zieke
  duiven en één kinesist maar **2** gekwetste. Heb je er drie liggen met maar één
  dokter, dan duid je op de ziekenboegpagina zelf aan wie behandeld wordt met de knop
  **"📌 Deze duif laten behandelen"**. Zo'n vastgezette duif houdt haar plaats tot je
  ze weer **vrijgeeft** — handig als je liever je kampioen snel terug op de baan hebt
  dan de duif die toevallig het ziekst is.
- **Kies je niets, dan kiest het spel**: de vrije plaatsen gaan automatisch naar de
  **ernstigste** gevallen eerst, precies zoals vroeger. Zet je er zelf één vast, dan
  wordt de rest van de plaatsen nog steeds automatisch ingevuld.
- Wil je iederéén tegelijk behandelen, neem dan een **tweede dokter of kinesist** in
  dienst — elk extra personeelslid geeft er twee plaatsen bij.
- ⚠️ **Personeel wordt élke dag betaald, ook met een lege ziekenboeg.** Een dokter of
  kinesist staat op je loonlijst tot je hem zelf op 0 zet; hij kost je dus €57 resp.
  €50 per dag, ook op een dag dat er niemand ziek of gewond is. Aannemen en ontslaan
  kosten niets, dus je mag ze gerust op 0 zetten tot je ze nodig hebt.
  **Het spel waarschuwt je** wanneer dat gebeurt: op de ziekenboegpagina staat het bij
  de knop zelf, in de **Dagbalans** (Overzicht) krijgt de regel een ⚠️, en je krijgt er
  hoogstens **één melding per week** over zolang de situatie duurt. Let op de soort:
  een dokter behandelt enkel **ziektes** en een kinesist enkel **kwetsuren**, dus een
  kinesist met alleen zieke duiven in de boeg zit óók stil.
- Zieke/gekwetste duiven en duiven in de ziekenboeg kunnen niet vliegen, trainen
  of broeden.
- **Energie in de ziekenboeg.** Een duif die in de ziekenboeg herstelt, recupereert
  daar óók energie uit haar voer — maar **alleen als ze door je staf verzorgd wordt**
  (een **dokter** voor een ziekte, een **kinesist** voor een kwetsuur) en dan nog aan
  **50 %** van het tempo dat ze gezond zou halen. Een herstellende duif komt dus trager
  weer op krachten dan een gezonde. Zit ze in de boeg **zonder** de juiste staf (geen
  dokter/kinesist, of buiten de dekking van je staf), dan krijgt ze er **geen** energie
  bij tot je verzorging voorziet. In de boeg telt bovendien de **rustbonus** (§4) niet
  mee — enkel dit (halve) voerherstel telt.

---

## 6. Leeftijd & sterfte

**Duiven verouderen in echte tijd — en 4× versneld.** De gameweek-teller schuift
**4 weken op per échte week** (gelijkmatig gespreid over de dagen). Zo hoef je
niet eindeloos te wachten: een **pas gekweekte jong is al na ~2 echte weken
vliegklaar** (leeftijd 8 wk), en ouderdom gaat over echte **maanden** meespelen
i.p.v. jaren. Dit drijft zowel de prestatiecurve als de ouderdomssterfte hieronder.

**Leeftijdscurve** (prestatievermenigvuldiger, enkel de **opbouw**): 0 wk → 0.0,
8 wk → 0.6, 20 wk → 0.85, 1 jaar → 1.0, daarna **vlak op 1.0**. De neerwaartse tak
van vroeger is weg — **verouderen gebeurt nu als een échte terugval van de
vaardigheden** (hieronder), niet meer als een verborgen multiplier.

**Verouderen: de vaardigheden zakken echt (nieuw).** Na haar piek (rond **~4
duivenjaar**) verliest een duif elke gerolde gameweek een beetje **snelheid,
conditie en oriëntatie** — en dat gaat **sneller naarmate ze ouder wordt**. Het
**tempo verschilt per duif** (een aangeboren `declineRate`-gen, ~0,6–1,6×): de ene
houdt lang stand, de andere fadet vroeg. Je ziet de cijfers dus effectief zakken.
Realistisch: piek ~1–4 jaar, merkbare terugval vanaf ~4 jaar, sterk richting 8–10
jaar. (Omdat verouderen 4× real-time loopt, speelt dit over echte **maanden**.)

**Sterfte gebeurt nu ook in echte tijd.** Ouderdomssterfte draait **één keer per
gerolde gameweek** (met de rauwe weekkans hieronder, dus de curve blijft kloppen
hoe snel duiven ook verouderen); de sterftekans van een onbehandelde aandoening
draait **elke dag** (weekkans → dagkans via `1 − (1 − p)^(1/7)`).
```
leeftijd (interp, per week): tot 4j 0 · 6j 0.006 · 8j 0.025 · 10j 0.07 · 12j 0.16 · 15j 0.40
onbehandelde aandoening (per week):
    buiten de boeg: matig +0.03 · ernstig +0.10
    in de boeg:     matig +0.005 · ernstig +0.025
```
**Vóór haar vierde verjaardag sterft een duif nooit van ouderdom** — die kans is
daar exact **nul**, niet "klein". Vier jaar is dezelfde grens waarop haar
vaardigheden beginnen te zakken (zie hierboven): ouderdom begint op één moment.
Daarna loopt de kans op, en met de 4× versnelde veroudering bereikt een duif van
~2,5 jaar die grens na zo'n **4–5 echte maanden**.

Een jonge duif kan dus wél sterven — door een **onbehandelde** ziekte of
kwetsuur, door **honger** (§4.0), of doordat ze **uitgeput aan een vlucht begint**
(§3.2) — maar nooit "op hoge leeftijd". Bij elk overlijden krijgt de eigenaar
een melding die de **reden** noemt.

> **Voorbeeld.** Een gezonde duif van **8 jaar** heeft ~**2.5% kans/week** om te
> sterven; op **12 jaar** al ~**16%**. Een duif met een **onbehandelde ernstige**
> aandoening krijgt daar +10% bovenop (in de ziekenboeg maar +2.5%). Een oude,
> zieke, onverzorgde duif kan dus zomaar 25%+ kans per week hebben — verzorging
> in de ziekenboeg drukt dat fors.

---

## 7. Kweken (broeden)

**Voorwaarden:** een doffer + een duivin, beide **minstens 8 weken oud** (dezelfde
leeftijd waarop ze mogen vliegen), beide met energie ≥ **20**, geen
ziekte/kwetsuur, niet in de ziekenboeg, **niet ingeschreven voor een vlucht**, en
geen van beide mag nog **uitrusten van een vorig nest** (§7.2).
Kost **€750** en **−15 energie** per ouder. Dat bedrag gaat er **meteen** af bij
het koppelen, niet bij het uitkomen.

Een duif die aan het **broeden** is, **kan niet deelnemen aan vluchten**. Wil je
haar terug laten vliegen, dan **stop je het koppel** (knop bij *Kweek*) — het
koppel vervalt zonder jongen en de duiven zijn weer vluchtklaar. Je krijgt het
inschrijfgeld dan **niet** terug.

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

**Uitkomen: onvoorspelbaar, en op eender welk moment.** Er is géén vaste tijd en
geen aftelklok, en het is **niet** gebonden aan de dagovergang: een nest kan om
het even welk uur van de dag uitkomen, ook 's nachts. Elk
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

**Je krijgt er altijd een melding van** (belknop), of het nest nu meteen in je
hok past, moet wachten omdat je hok vol zit (§7.1), of leeg uitkwam. Eén melding
per nest — je hoeft er dus niet voor te blijven kijken.

### 7.1 Een vol hok bij het uitkomen: jij kiest

Je mag **altijd** koppelen, ook als je hok al vol zit. Komen de jongen uit terwijl
er geen plaats is, dan gaan ze **niet verloren** — het hele nest blijft wachten
tot jij beslist. Je krijgt een melding, en bij *Kweek* verschijnt het nest met
alle jongen erin: naam, geslacht, algemene score én hun **gen-caps**, zodat je
ziet welk jong een plaats waard is.

Per jong kies je **houden** of niet. Wat je niet kiest, **vliegt weg** — dat
brengt niets op (het duivenrestaurant is enkel voor volwassen duiven, §9.2). Je
mag:

- **alle jongen houden** — als je genoeg plaatsen vrijmaakt;
- **een deel houden** — bij een tweeling bijvoorbeeld enkel de duivin met de
  betere genen;
- **geen enkel jong houden** — een volwaardige keuze.

**Plaats maken doe je vanuit hetzelfde scherm.** Onder *Maak plaats* staan je
duiven met dezelfde twee knoppen als bij *Afscheid nemen* (§9.2): 🕊️ vrijlaten
(€0) of 🍲 verkopen aan het duivenrestaurant (€50, maar **elke andere duif
verliest 1–5 energie**). Een duif die ingeschreven staat voor een vlucht of zelf
koppelt, kan niet weg.

> **Zolang een nest op je keuze wacht, kan je geen nieuw koppel starten.** Zo
> blijft er nooit een vergeten nest hangen. Er staat een teller op *Kweek* in het
> menu tot je beslist hebt. Het nest **verloopt niet** — er is geen klok, je
> verliest dus nooit een topjong omdat je even niet inlogde.
>
> Jongen in het nest zitten nog niet in je hok: ze **eten niet**, kosten geen
> onderhoud en kunnen niet ziek worden. Hun **geboortedatum ligt wel vast** vanaf
> het uitkomen — wacht je weken, dan komen ze navenant ouder binnen.

### 7.2 Na het nest: het koppel gaat uiteen en de ouders rusten

**Een koppel is voor één nest.** Zodra de jongen er zijn, is het koppel voorbij:
de twee duiven staan weer los in je hok en kunnen meteen weer vliegen, trainen
en verkocht worden. Ook een **mislukte worp** beëindigt het koppel — je €750 en
de energie zijn dan gewoon weg.

**Daarna rusten beide ouders 21 dagen** (3 weken) voor ze opnieuw kunnen
koppelen. Dat komt neer op ongeveer **vier nesten per duivenjaar**, net als bij
echte duiven — duiven verouderen hier 4× zo snel als de klok (§6), dus drie echte
weken zijn zowat drie duivenmaanden.

- De rust hangt **aan de duif, niet aan het koppel**. Je kan haar dus ook niet
  omzeilen door haar met een andere partner te koppelen.
- Ze telt vanaf het moment dat de jongen **uitkwamen**.
- Een **mislukte worp legt géén rust op**: er zijn geen jongen geweest, en je
  hebt het inschrijfgeld en de energie al betaald. Je mag meteen opnieuw
  proberen.
- Bij *Kweek* verdwijnen rustende duiven uit de keuzelijsten, met eronder een
  regeltje hoeveel er uitrusten en wanneer de eerste weer mag. Op de duifpagina
  staat het per duif.
- **Computermelkers volgen dezelfde regel** (§17).

> **Strategie.** Met een rust van drie weken per duif is kweken geen kraan meer
> die je kan openzetten: wil je meerdere nesten tegelijk, dan heb je meerdere
> koppels nodig — en dus een breder hok. Kies je fokkoppels dus met zorg, want
> een misgelopen worp kost je niet alleen €750 maar ook je beurt.


---

**Overerving:** elke vaardigheid = gemiddelde van beide ouders ± willekeurige
mutatie (±8), begrensd op de **gen-cap** van het jong (zie §7bis). Ook de
**genen zelf** (de plafonds + het verouderingstempo) erven over — gemiddelde van
de ouders ± mutatie. Koppel dus je best gegende duiven om een sterke lijn te bouwen.

---

### 7.3 Stamboom & inteelt

Op de pagina van elke duif staat de kaart **Familie**: bovenaan haar **vader en
moeder**, en daaronder de knop **"Toon volledige stamboom"**. Die opent **één
diagram met haar hele familie**, van links naar rechts:

```
Overgrootouders · Grootouders · Ouders │ DEZE DUIF │ Kinderen · Kleinkinderen
                                       │ broers    │
                                       │ & zussen  │
                                       │ partners  │
```

- **Links haar voorouders** — ouders, grootouders en overgrootouders, met de
  verbindingslijnen ertussen.
- **In het midden haar eigen generatie** — de duif zelf, met daarboven haar
  **broers en zussen** (met erbij of het een **volle** broer/zus is, of een
  **halve** en via welke ouder) en daaronder de duiven waarmee ze **gekoppeld**
  is geweest en jongen kreeg.
- **Rechts haar nakomelingen** — kinderen en kleinkinderen. Elk nest hangt aan
  **beide** ouders, dus je ziet meteen welk koppel welk jong opleverde.

Doffers krijgen een blauwe rand, duivinnen een roze. Per duif zie je haar
**algemene score (★)**, of ze **nog leeft** en, zo ja, in **welk hok** ze zit —
ook als dat het hok van een andere speler is. Klik erop om naar haar pagina te
gaan, en van daaruit klim je verder door de familie.

Op een smal scherm is het diagram breder dan je toestel. Het **opent gecentreerd
op de duif zelf**; **sleep opzij** voor haar voorouders (links) en haar jongen
(rechts).

**Een tak stopt bij een duif die er niet meer is**, en dat werkt beide kanten op.
Naar boven: met een overleden duif verdwijnt ook wie háár ouders waren. Naar
beneden: een jong dat gestorven is, is zelf niet meer te zien — en haar eigen
jongen dus ook niet. Haar **naam** blijft wel bewaard waar een levende duif haar
onthoudt, dus je ziet nog steeds dat ze bestaan heeft. **Broers, zussen en
partners overleven zo'n overlijden wél**: die worden herkend aan de duiven die er
nog zijn.

**Kweken met familie wordt afgeraden.** Kies je bij *Kweek* twee verwanten, dan
waarschuwt het spel je vooraf en moet je de keuze bevestigen. Je mág doorgaan —
maar het jong betaalt de rekening, en die blijft:

- **Lagere genetische plafonds.** De gen-caps van het jong gaan omlaag, en daar
  traint of coacht ze zich **nooit meer uit** (§7bis, §8).
- **Grote kans op een afwijking.** Drie vleugels, twee koppen, geen staart, een
  reuzensnavel of een duif die consequent ondersteboven vliegt. Je ziet het
  meteen aan haar prentje, en zo'n duif vliegt ook een tikje trager.

| Verwantschap | Plafonds omlaag | Kans op een afwijking |
|---|---|---|
| Ouder, kind of grootouder | −22 | 85 % |
| Volle broer en zus | −18 | 75 % |
| Halfbroer en halfzus | −11 | 45 % |
| Verder familie | −5 | 15 % |

Verwantschap wordt tot **drie generaties** terug bekeken. Loopt de enige link
naar een gemeenschappelijke voorouder via duiven die intussen gestorven zijn,
dan is het verband niet meer te zien en waarschuwt het spel niet — zo'n
verwantschap is dan ook al flink verwaterd. **Computermelkers kweken nooit met
familie** (§17).

---

## 7bis. Genen: het aangeboren plafond van een duif

Elke duif heeft **aangeboren maxima** (genen) voor **snelheid, conditie en
oriëntatie**. **Geen enkele duif haalt ooit 100** in een racevaardigheid: de
absolute bovengrens is **95**, en de meeste duiven cappen lager. De ene duif kan
op snelheid tot 92 groeien, een andere blijft op 78 steken — en dat verschilt óók
per vaardigheid (een snelheidsbeest kan matig zijn in oriëntatie).

**Kansen op de gen-cap** (per vaardigheid, gewogen loting; betere bronnen —
dure veilingduiven — loten hoger, opvangcentrum-duiven lager):

| Cap-bereik | Kans | |
|---|---|---|
| 70–73 | ~1 % | zeer zeldzaam (ondergrens) |
| 74–77 | ~10 % | zwakke aanleg |
| 78–81 | ~26 % | ondergemiddeld |
| 82–85 | ~34 % | gemiddeld |
| 86–89 | ~22 % | bovengemiddeld |
| 90–93 | ~7 % | sterk |
| 94–95 | ~1 % | uitzonderlijk (topgenen) |

In je hok toont een **rood streepje** op elke statbalk waar de duif capt; **klik
erop** voor de exacte waarde. **Hogere genen maken een duif meer waard** — ook al
zijn haar huidige stats nog laag: een jong met topgenen is goud waard.

> **Bestaande duiven** die vóór deze update al hoger stonden dan hun (nieuw
> gelote) gen-cap **behouden** die waarde — ze groeien enkel niet verder. Enkel
> nieuwe groei kan nooit boven de cap.

---

## 8. Training & de drie groeitrappen

Een vaardigheid groeit in **drie trappen**:

| Bereik | Hoe je er groeit |
|---|---|
| **0 → 80** | **trainen**, **vluchten** of een **coach** |
| **80 → 90** | **vluchten** of een **coach** |
| **90 → gen-cap** | enkel een **privécoach** (§13) |

**Handmatig trainen** verbruikt **15 energie**, geeft ~**+1** aan de gekozen
vaardigheid (+**4 ervaring**, ×de leerfactor van §3.7 — bij een routinier dus
merkbaar minder) en kan **tot 80** (of de gen-cap als die lager is —
79→80 is dus de hoogste handmatige stap). Je kan enkel trainen als de duif **thuis**
is, en **elke eigenschap maar 1× per week** (aparte teller per categorie).

**De kost stijgt exponentieel met het niveau** — laag is spotgoedkoop, hoog wordt
een echte investering:

| Van → naar | Kost |
|---|---|
| 40 → 41 | ~€40 |
| 50 → 51 | ~€125 |
| 60 → 61 | ~€355 |
| 70 → 71 | ~€1.035 |
| 79 → 80 | **~€2.700** |

**Boven 80** helpt handmatig trainen niet meer: **80→90 verdien je door te vliegen
of met een coach**, en **alles boven 90 kan enkel met een privécoach** (§13). Groei
vertraagt bovendien naarmate een duif haar plafond nadert: 50→51 gaat vlot, 88→89 is
een grind.

---

## 9. Markt

- Alleen duiven van **echte spelers** staan te koop (geen NPC-markt).
- Bij elke verkoop verhuist het geld naar de verkoper; de transactie komt in de
  **verkoopgeschiedenis** onderaan de Markt. Die lijst toont de **laatste 7
  dagen** — wat daarvóór verkocht werd verdwijnt eruit, zodat je ziet wat er
  *nu* op de markt gebeurt in plaats van een scroll van maandoude deals.
  ⚠️ De **waardeschatting** (§9.0) kijkt wél verder terug (vier weken), dus een
  verkoop stuurt de prijzen nog een tijdje nadat ze van dit lijstje af is.
- Elke duif toont haar eigenaar; je koopt niet je eigen duiven en je hok mag niet
  vol zitten.

### 9.0 Wat is een duif waard? De markt beslist

De **geschatte waarde** komt niet uit een vaste formule maar uit **wat spelers echt
betalen**. Elke afgeronde verkoop — markt, privébod of veilinghamer — wordt onthouden
mét het talent van die duif, en samen vormen die de prijslijst van de club.

- **Vergelijkbare duiven bepalen de prijs.** Ging een duif van talent 70 weg voor
  €7.000, dan schuiven alle duiven in die klasse mee omhoog.
- **Recente verkopen wegen zwaarder:** het gewicht halveert elke **10 dagen** en na
  **4 weken** telt een verkoop niet meer mee. Prijzen verschillen dus **van week tot
  week**, zoals op een echte markt.
- **Waar niet op geboden wordt, is weinig waard.** Gaan zwakke duiven voor een
  habbekrats weg, dan zakt de schatting voor dat soort duiven mee tot enkele tientjes.
- **Een betere duif is nooit minder waard** dan een mindere, ook al kwam er in haar
  klasse toevallig één koopje voorbij.
- **Zonder verkopen** valt de schatting terug op talent, genen, leeftijd en ervaring.
  Op de duifpagina zie je hoe de prijs tot stand kwam: hoeveel procent markt, en op
  hoeveel verkopen.

De waarde is een **richtprijs**: je mag je duif voor elk bedrag te koop zetten. Ze
bepaalt wel het **startbod van een veiling** (30 % van de waarde, zodat er nog te
bieden valt) en wat de gladde koopman voor je pronkstuk neerlegt.

### 9.1 Te koop zetten: marktprijs én "bieden vanaf"

Zet je een duif op de markt, dan geef je **twee** bedragen op:

| Veld | Wat het doet |
|---|---|
| **Marktprijs** | Wie dit bedrag betaalt, koopt je duif **meteen**. Geen tussenkomst van jou. |
| **Bieden vanaf** *(optioneel)* | Vanaf dit bedrag mogen anderen een **bod** doen. Jij krijgt een melding en beslist zelf: aanvaarden of weigeren. |

> **Voorbeeld.** Marktprijs €4.000, bieden vanaf €3.000. Wie €4.000 neertelt, heeft
> de duif direct. Wie liever onderhandelt, kan €3.000 of meer bieden — jij bepaalt
> of je erop ingaat.

- Vul je **geen** ondergrens in, dan is je duif **enkel voor de marktprijs** te
  koop; bieden kan dan niet.
- De ondergrens mag **niet boven** je marktprijs liggen — dan zou niemand ooit
  bieden, want kopen is dan goedkoper.
- Een bod **op of boven** je marktprijs wordt geweigerd: dan koopt de bieder haar
  gewoon meteen.
- Je krijgt een **belmelding** bij elk nieuw bod, en opnieuw als iemand zijn bod
  **verhoogt**. Het bod zelf beheer je bij **Markt → Biedingen op jouw duiven**.
- Aanvaard je een bod, dan verkoop je voor het **geboden** bedrag, niet voor je
  marktprijs. Weiger je, dan blijft je duif gewoon te koop staan.
- Wordt je duif intussen voor de **volle marktprijs** gekocht, dan vervallen alle
  openstaande biedingen erop en krijgen die bieders daar bericht van.
- **Verkopen doe je enkel als échte speler.** Een computermelker (§17) verkoopt
  tegen zijn vraagprijs en onderhandelt nooit — op zijn duiven kan je niet bieden.
- **Bots kopen en bieden wél op jouw duiven.** Een computermelker die je duif de
  moeite vindt, koopt ze voor je marktprijs, of doet — als je een ondergrens hebt
  ingesteld — een bod dat jij aanvaardt of weigert, net als een speler. Hij biedt
  nooit meer dan de duif volgens de markt waard is (§9.0), dus een torenhoge
  ondergrens laat hij gewoon liggen. Je duif blijft ook de eerste dag na het te
  koop zetten alleen voor spelers (§17).

### 9.1b Privé-biedingen (bieden op een duif die niet te koop staat)
Je kan een **bod** uitbrengen op de duif van **een andere speler**, ook al staat
die **niet te koop**. Dat kan op **twee plaatsen**: op de **Markt** onder
**"🕊️ Bied op duiven van andere spelers"**, of via de knop **"Bied op deze duif"**
op de duifpagina zelf. Op de Markt gaat het **stap voor stap**: (1) kies eerst de
**speler** op wie je wilt bieden, (2) kies daarna een **duif** van die speler, en
(3) geef je **bedrag** in.

**Wat je te koop ziet, zie je volledig.** Van elke duif die **op de markt staat**
— van een andere speler of van een bot — en van elke duif in een **veiling**
(zondagveiling én opvangcentrum) zie je **alle eigenschappen**: snelheid,
conditie, oriëntatie, energie, gezondheid, libido en ervaring. Je moet nu eenmaal
kunnen zien wat je koopt.

**Enkel bij een rechtstreeks bod op een duif die níet te koop staat, tast je in
het duister.** Dan blijven die eigenschappen **geheim** en zie je enkel de
**algemene score (★ talent)**, de geschatte waarde, het geslacht, de leeftijd en
het ras. Je weet dus niet *exact* wat je koopt, maar je kan wel een idee vormen
via die algemene score, de **duivenranglijst** of de **resultaten van specifieke
vluchten**.
- Je geld wordt **niet** vastgehouden; het wordt pas gecontroleerd wanneer de
  eigenaar aanvaardt (heb je dan te weinig geld of geen plaats, dan vervalt het bod).
- De eigenaar ziet het bod **bij de Markt** (niet via de belknop) — met een teller
  bij het **Markt**-menu — en kan het **aanvaarden of weigeren**.
- Zolang de eigenaar niet reageert, **blijft je bod geldig**. Je kan het altijd zelf
  **intrekken** (dan vervalt het).
- Je hebt **één lopend bod per duif** (een nieuw bod past het bedrag aan).
- Bij **aanvaarden** verhuist de duif zoals bij een gewone verkoop; andere lopende
  biedingen op die duif vervallen. Je krijgt een melding bij aanvaarden/weigeren.

### 9.3 Bieden op een veiling: vrij, dan geteld

Een veiling (§12) kent **twee fases**:

| Tijd tot het einde | Wat mag je? |
|---|---|
| meer dan **30 minuten** | onbeperkt bieden, zo vaak je wil |
| laatste **30 minuten** | nog **maximaal 3 biedingen** per speler, op die duif |
| laatste **5 minuten** | elk bod zet de klok terug op **5 minuten** (anti-snipe) |

- **Je ziet je tegoed.** Zodra de slotfase begint, toont de veilingkaart hoeveel van
  je 3 biedingen je al gebruikt hebt en hoeveel er nog over zijn. Zijn ze op, dan kan
  je op die duif niet meer bieden — ook niet als iemand je nadien overbiedt.
- **De klok terugzetten kost je een bod.** Een bod in de laatste 5 minuten verlengt de
  veiling, maar telt gewoon mee voor je drie. Eindeloos rekken lukt dus niet.
- **Winnen op de valreep bestaat niet:** door die verlenging krijgen de anderen altijd
  de kans om terug te bieden.
- In de slotfase telt de resterende tijd **live** af — de countdown loopt vanzelf
  verder en de laatste biedingen verschijnen **zonder dat je de pagina hoeft te
  vernieuwen**.

**Waarom?** Met een beperkt aantal biedingen loont nibbelen met het minimumbedrag niet
meer: je zet beter meteen een stevige stap, of gewoon je échte maximum. Zo eindigt een
veiling in een handvol duidelijke stappen in plaats van tientallen kleine — spannender,
en het houdt het spel snel voor iedereen.

### 9.2 Afscheid nemen van een duif (vrijlaten of het duivenrestaurant)
Wil je van een duif af, dan hoef je niet te wachten tot iemand ze koopt. Op de
**duifpagina** (klik een duif in je hok aan) staat onderaan **"Afscheid nemen"** met
twee keuzes. Een duif die **ingeschreven staat voor een vlucht** moet je eerst
**uitschrijven**.

- **🕊️ Vrijlaten.** Je laat de duif gaan; ze verdwijnt uit je hok. Dit brengt **geen
  geld** op en heeft **geen** bijwerkingen op je andere duiven — de nette manier om
  simpelweg plaats te maken.
- **🍲 Verkopen aan Bistro De Laatste Vlucht.** Het lokale duivenrestaurant maakt er
  **duivensoep** van. Je krijgt een **vast bedrag van €50**, maar het nieuws **drukt de
  moraal** van je hele hok: **elke andere duif verliest 1 tot 5 energie** (willekeurig
  per duif). Energie zakt nooit onder 0.

| Manier | Opbrengst | Effect op de rest van je hok |
|---|---|---|
| 🕊️ Vrijlaten | €0 | geen |
| 🍲 Duivenrestaurant | €50 (vast) | elke andere duif −1 tot −5 energie |

Bij beide keuzes vervallen eventuele **openstaande biedingen** van andere spelers op
die duif (de bieders krijgen een melding). Zet een duif dus niet naar de soep vlak
vóór een belangrijke vlucht — de energie-dip treft je hele ploeg.

---

## 10. Namen

Doffers krijgen mannennamen, duivinnen vrouwennamen. De bijnaam is een mix van
karaktergebonden, neutrale en pikzwarte humor, met voorkeur voor alliteratie
(zelfde beginletter), bv. *Stevie de Snelle*, *Dirk de Doodgraver*,
*Nadine de Nabestaande*.

De naamvoorraad is bewust **ruim**: ruim 250 voornamen en bijna 200 bijnamen, dus
in een club van een paar honderd duiven kom je zelden twee keer dezelfde tegen.

**Elke naam is uniek.** Geen twee duiven in de club dragen dezelfde combinatie van
voornaam én bijnaam — of ze nu geboren, gekweekt, geveild, geadopteerd of via een
gebeurtenis binnengekomen zijn. Zo weet je bij een uitslag, een ranglijst of een bod
altijd over wélke duif het gaat. Raakt de namenvoorraad ooit helemaal op, dan begint
er gewoon een dynastie: *Karel de Kale II*, *III*, enzovoort. Je kan een duif altijd
zelf hernoemen (§13) — ook dan blijft de naam uniek.

**Knipoog naar de echte duivensport.** Tussen de bijnamen zitten verwijzingen naar
legendes uit de echte wereld: *de Kannibaal*, *de Nieuwe Kim*, *de Armando*, *de
Barcelona-Kampioen*, *de Olympiade*, *de Gouden Prins*… En bij de voornamen duiken
kampioenen en oorlogsduiven op als **Armando**, **Bolt**, **Kim**, **Ami** (naar Cher
Ami), **Winkie**, **Paddy** en **Gustav**. Zo'n legendarische bijnaam is zeldzamer dan
de rest — een duif die er een krijgt, mag gezien worden.

---

## 11. Meldingen (belknop)

De speler krijgt een melding bij: vluchtuitslag, verbetering van een duif,
kwetsuur, ziekte, herstel, sterfte en geboorte van jongen. Ook grote nieuwe
onderdelen van het spel worden er één keer via aangekondigd.

## 12. Dagopdrachten, gebeurtenissen, veilingen & sponsors

- **Dagopdrachten.** Elke dag krijg je 3 kleine opdrachten (bv. een duif
  inschrijven, een vlucht winnen, voer kopen, trainen). Voltooien geeft geld
  (~€15–60 per opdracht) + XP. Elke dag dat je speelt verhoogt je **streak** met
  een groeiende dagbonus (€5 + €2 per streakdag, tot €25). Samen leveren bonus +
  opdrachten zo ongeveer **€750 per week** op — een basisinkomen, geen hoofdbron.
- **Gebeurtenissen (dilemma's).** Nu en dan (~1 op 3 dagen) verschijnt een
  keuzekaartje dat je écht doet twijfelen: een koopman die je beste duif wil kopen,
  een verdwaalde duif, een griepgolf, een gulle frituursponsor, een kwakzalver, een
  hittegolf, een dorpsfeest, een "kat in een zak", een **dubieuze sportarts** (een
  dikke boost voor je hele hok… of een boete en een zieke duif), een **erfenis**
  waarbij je moet kiezen tussen geld, een oude kampioen of een jonge belofte, een
  **talentenjager** die je pronkstuk een week op proef wil (sterker terug… of net
  op), een **sperwer** in de buurt (van niets doen tot een dode duif) of een
  **liefdadigheidsvlucht** met je ace. Elke keuze heeft gevolgen — soms winst,
  soms flink risico.
- **Zondagveiling.** Elke **zondag van 11:00 tot 20:00** (Brussel) gaat **één**
  topduif onder de hamer op de markt — nooit meerdere tegelijk, zodat alle melkers
  om dezelfde duif strijden. Zolang die veiling loopt, komt er ook **geen**
  opvangcentrum-duif tussen. Je moet het geld dat je biedt op dat moment
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
  sponsors zich melden en hoe groter het aanbod. Er is een brede waaier aan sponsors
  in veel categorieën (café, frituur, bakkerij, slagerij, brouwerij, dierenwinkel,
  landbouw, bank, verzekering, bouw, telecom, loterij, racingteam…) verspreid over
  **vier tiers** — van een buurtcafé tot echte prestige-partners die enkel de absolute
  top binnenhaalt. **Sponsors verdien je op de vlucht.** Een aanbod komt **enkel ná een
  goede competitievlucht** — wanneer een van je duiven op het **podium** eindigt of
  **wint** — en dan nog **op een willekeurig moment** (het is een kans, groter bij een
  overwinning dan bij een derde plaats). Ze verschijnen dus **nooit zomaar** en **nooit
  allemaal tegelijk**: er meldt zich hoogstens **één nieuwe sponsor per keer**. Presteer
  je goed, dan komen de suitors vanzelf langs; presteer je niet, dan blijft het stil.
  - Aanvaarden geeft eenmalig **tekengeld**, daarna **elke dag** een vaste
    bijdrage (zichtbaar in de dagbalans op het Overzicht, §4.2) en telkens een
    van je duiven op het **podium** eindigt een **podiumpremie**.
  - **De podiumpremie hangt af van de vlucht én van de plaats.** Een sponsor
    haalt meer eer uit een internationale zege dan uit een regiovlucht, dus hij
    betaalt in verhouding — net als het prijzengeld zelf. Elke sponsor heeft één
    basisbedrag (= een zege op een **nationale** vlucht); daarop staan deze
    vermenigvuldigers:

| Niveau | 1e plaats | 2e plaats | 3e plaats |
|---|---|---|---|
| Regionaal | ×0,6 | ×0,36 | ×0,21 |
| Nationaal | **×1,0** | ×0,6 | ×0,35 |
| Internationaal | ×1,8 | ×1,08 | ×0,63 |

    Enkel **wedstrijdvluchten** tellen: een oefenvlucht (§2.7), de
    titanenwedstrijd (§2.8), de estafettevlucht (§2.9) en het leeftijdscriterium
    (§2.10) leveren **geen** sponsorgeld op. Zet je meerdere duiven in en pakken ze 1-2-3, dan krijg je
    alle drie de premies. Na elke wedstrijd waarin je scoort, krijg je een
    melding met wat elke sponsor precies betaalde.
  - **Orde van grootte.** Een buurtsponsor (tier 1) geeft €25–40 per dag en
    €50–70 voor een nationale zege; een prestigesponsor (tier 4) €150–200 per
    dag en €235–310. Drie buurtsponsors samen dekken dus ruwweg een derde van de
    dagelijkse kosten van een gemiddeld hok.
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
  - **Eén uitzondering: nee is nee.** Komt het aanbod van een **concurrent** van
    een sponsor die je al hebt (zelfde categorie, dus overstappen kost een
    verbrekingsvergoeding) én betalen ze **niet meer** dan die sponsor, dan is
    weigeren **definitief**: die sponsor klopt nooit meer aan. Zo'n aanbod is
    immers gewoon slechter — je zou geld betalen om er op achteruit te gaan — en
    dan hoef je er niet elke paar dagen opnieuw nee tegen te zeggen. De
    sponsorpagina waarschuwt je vooraf en vraagt een bevestiging.
    Een concurrent die **méér** biedt blijft wél terugkomen: die weiger je
    misschien alleen omdat de boete er nú niet in zit.
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

- **Hokcapaciteit.** Je start met plaats voor **8** duiven en breidt uit in
  stappen van twee. Zonder plaats kan je niet kopen, adopteren of kweken.

| Stap | Prijs | Cumulatief vanaf 8 |
|---|---|---|
| 8 → 10 | €1.500 | €1.500 |
| 10 → 12 | €3.500 | €5.000 |
| 12 → 14 | €10.000 | €15.000 |
| 14 → 16 | €17.500 | €32.500 |
| 16 → 18 | €30.000 | €62.500 |
| 18 → 20 | €50.000 | €112.500 |

  Een groot hok is de sterkste structurele troef in het spel — meer duiven
  betekent meer inschrijvingen en dus een groter deel van de prijzenpot. Daarom
  is het bewust een **investering van lange adem**: de trap wordt steil, én elke
  extra duif kost je daarna méér onderhoud per dag (de schijven in §4.2). Op de
  uitbreidingskaart in *Mijn hok* zie je die tarieven vóór je koopt.
- **Aparte hokken.** Koop losse compartimenten zodat je duiven niet allemaal op
  elkaar zitten. Elk apart hok wordt los gekocht (telkens wat duurder), en je
  **kiest zelf welke duiven** er een krijgen (knop bij *Mijn hok*). Heb je minder aparte hokken dan duiven, dan zitten de rest gewoon
  samen. Een duif in een apart hok **herstelt sneller energie** en heeft een
  **kleinere kans op ziekte**. Gaat een duif naar de **ziekenboeg**, dan **komt
  haar aparte hok meteen vrij**: ze zit daar toch al apart, dus de plek gaat
  terug in de pot en je kan ze (tijdelijk of niet) aan een **andere** duif geven.
  Komt ze genezen terug, dan **springt ze automatisch weer in een apart hok als
  er nog eentje vrij is**. Is haar plek intussen aan een andere duif gegeven
  (alles bezet), dan komt ze gewoon zonder terug en wijs je er later opnieuw een
  toe zodra er eentje vrijkomt.
- **Ziekenboeg uitbreiden.** Koop extra bedden (van 2 naar 3, 4, 5 of 6) zodat je
  meer zieke duiven tegelijk kan verzorgen.
- **Voerschema's — per duif.** Elke duif heeft eigen noden (vluchten vs. broeden),
  dus je kiest **per duif** een voerschema, bij *Mijn hok*.
  Op het overzicht kan je met één klik álle duiven op hetzelfde schema zetten.
  Naast Zuinig/Normaal/Royaal zijn er twee premiumopties: **Premium** (meer
  energie- en gezondheidsherstel én bouwt langzaam conditie op) en **Libido-mix**
  (verhoogt de voortplantingsdrang). Ze verbruiken meer voer.
- **Privécoach.** Huur een coach voor één specifieke duif tegen een **dagsalaris
  van €80** (geen instapkost, dagelijks afgerekend). Hij traint haar **elke dag** in
  snelheid, conditie én oriëntatie (plus ervaring) — puur om te racen, nooit libido.
  De coach werkt op **elk niveau** (of de duif nu 50 of 92 heeft) en duwt elke
  vaardigheid richting haar **gen-cap** (nooit hoger). De **dagwinst wordt kleiner
  naarmate een eigenschap haar cap nadert** en **stopt zodra de cap bereikt is** —
  die vaardigheid stijgt dan niet meer, terwijl de andere (nog onder hun cap) wél
  verder kunnen. Enkel de coach gaat **boven 90** (trainen stopt op 80, vluchten op
  90), dus voor de allerlaatste punten is hij onmisbaar. Werkt niet terwijl de duif
  effectief vliegt. De concrete winst per dag zie je op de **duifpagina** (onder de
  coach-knop); zitten alle drie de vaardigheden al op hun gen-cap, dan meldt de pagina
  dat de coach niets meer kan toevoegen. Zijn dagelijkse **ervaringswinst** volgt de
  leerfactor van §3.7: bij een groentje bijna een punt per dag, bij een veteraan nog
  maar een fractie — de duifpagina toont het exacte cijfer voor déze duif.
- **Trainingsplafonds (samengevat).** Zelf **trainen** tot **80**, **vluchten** tot
  **90**, **premiumvoer** bouwt conditie mee op tot **80**, en enkel de **coach** gaat
  boven 90 — tot de **gen-cap** van de duif (max 95, nooit 100). Voer/vlucht verlagen
  nooit een al hoger opgebouwde waarde.
- **Duif hernoemen** kost €1.000. **Je hok hernoemen** (bij Profiel) kost €2.000.

## 14. Weddenschappen

Vanaf **12 uur voor de start** tot het moment dat de vlucht begint, verschijnt bij
de vlucht een knop om te **wedden**. Is het nog geen 12 uur voor de start, dan
toont de vlucht een **aftelklok** tot de weddenschappen openen. Zodra de vlucht
start, kan je niet meer inzetten. Je kan **maximaal één weddenschap per vlucht**
plaatsen.

Je kan wedden op **alle wedstrijdvluchten** (regionaal, nationaal én
internationaal). Op **oefenvluchten** (§2.7), de **titanenwedstrijd** (§2.8), de
**estafettevlucht** (§2.9) en de **criteriumvluchten** (§2.10) kan je niet wedden.

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
afgehouden; bij winst krijg je inzet × ratio terug.

**Wordt de duif uitgeschreven, dan krijg je je inzet meteen terug.** Zodra de duif
waarop je weddenschap steunt uit de vlucht wordt gehaald (uitgeschreven), wordt je
weddenschap **onmiddellijk geannuleerd** en je **inzet volledig terugbetaald** — je
hoeft niet te wachten tot de vlucht afgelopen is. Dat geldt voor elke weddenschap die
op die duif rust: "wint de vlucht", "top 3", "allerlaatste" en een **kop-aan-kop** waar
de duif (of haar tegenstander) uit verdwijnt. Bij "een van mijn duiven wint" gebeurt de
terugbetaling zodra je **laatste** ingeschreven duif in die vlucht is uitgeschreven.
Wordt een **hele vlucht afgelast** (te weinig deelnemers, §2.1), dan worden alle
weddenschappen erop eveneens terugbetaald.

Het invoerveld voor je inzet wordt automatisch begrensd tot **min. €10** en
**max. €500** (om te vermijden dat één gelukkige weddenschap de economie ontwricht).

**Afgeronde weddenschappen blijven 24 uur staan.** Onder *Vluchten → Uitslagen*
zie je wat je gewonnen, verloren of terugbetaald kreeg — tot **een dag** na de
afhandeling, daarna verdwijnt de regel. Vluchten zelf worden na twee dagen
opgeruimd, dus een oudere weddenschap hoort bij een race die je toch niet meer
kan nakijken. Je **lopende** weddenschappen staan op de Kalender-tab en blijven
altijd staan tot de vlucht gelopen is.

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
geven punten; **de titanenwedstrijd, de estafettevlucht, het leeftijdscriterium en
oefenvluchten geven géén seizoenspunten**).
**Bots dingen gewoon mee** en kunnen ook winnen —
zij hebben het prijzengeld ook nodig. Bij de prijsuitreiking winnen de **top 3
hokken**:

| Plaats | Prijs | Prijzengeld |
|---|---|---|
| 1e | **de Gouden Roekoe** | €2.000 |
| 2e | **de Zilveren Roekoe** | €1.500 |
| 3e | **de Bronzen Roekoe** | €1.000 |

De winnaar krijgt ook de badge **Seizoenskampioen**.

> De kolom **Winst** toont het aantal vluchten dat je **dit seizoen** won; ze gaat
> bij de seizoenswissel mee op nul. Je **totale** aantal overwinningen blijft
> staan op je profiel — daar kijken de sponsors naar (§12).

### 15.3 Duivenranglijsten → de Vleugel
Naast de melkers zijn er **drie ranglijsten van individuele duiven** (top 10),
allemaal voor het **lopende seizoen**. **Wedstrijdvluchten** (regionaal, nationaal,
internationaal), **de weekendwedstrijden** (titan en estafette) **én de
criteriumvluchten** (§2.10) tellen mee — **enkel oefenvluchten niet**.

Daarnaast staan er onder *Ranglijst → Criterium* nog **vier aparte ranglijsten per
leeftijdsklasse**. Die lopen **drie seizoenen** door in plaats van één, hebben hun
eigen prijzen, en staan volledig los van alles hierboven — zie **§2.10**.
(De titan geeft geen seizoenspunten voor de melkerranglijst, maar de prestaties van je
duif erin tellen hier wél volwaardig mee.)
- **⚡ Snelste duiven** — hoogste **gemiddelde vluchtsnelheid** dit seizoen, in
  km/u. Dit is het beste **rit­gemiddelde** (afgelegde afstand ÷ vluchttijd) van
  één wedstrijd — **niet** de momentane pieksnelheid die je live tijdens een
  vlucht ziet. De live km/u schommelt (de duif versnelt en vertraagt onderweg) en
  ligt op snelle stukken hoger dan haar gemiddelde; deze ranglijst rekent met dat
  gemiddelde, dus een korte live-piek verschijnt hier niet als zodanig.
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

Win je iets, dan krijg je bij je eerstvolgende bezoek een **prijsuitreiking op je
scherm**: elke prijs apart, met de beker en het prijzengeld erbij.

### 15.5 Medailles: een podium is een podium

Elke **top-3-plaats** levert je een medaille op — **goud** voor een zege, **zilver**
voor de tweede, **brons** voor de derde plaats. Ze worden levenslang bijgehouden bij
**Prestaties** en voeden de podiumbadges (*Op het schavot*, *Podiumbeest*,
*Podiumvaste waarde*).

**Dat geldt op élke wedstrijd**, ook op de formats die geen seizoenspunten geven:

| Wedstrijd | Medaille bij een podium? | Seizoenspunten? |
|---|---|---|
| Regionaal / nationaal / internationaal | ✅ | ✅ |
| Titanenwedstrijd (§2.8) | ✅ | ❌ |
| Estafettevlucht (§2.9) | ✅ (één per ploeg) | ❌ |
| Leeftijdscriterium (§2.10) | ✅ | ❌ |
| Oefenvlucht (§2.7) | ❌ | ❌ |

- Zet je meerdere duiven in en pakken ze 1-2-3, dan krijg je **alle drie** de
  medailles. Bij een **estafette** telt je ploeg als één deelnemer, dus een
  ploegzege is **één** gouden medaille en niet drie.
- Een duif die **niet finisht** (opgegeven, uitgevallen of de weg kwijt) levert
  nooit een medaille op.
- **Let op het verschil met "overwinningen".** De badges *Regiowinnaar*,
  *Nationale zege* en *Internationale zege* tellen alleen zeges op de drie
  competitieniveaus. Een titan, een estafette of een criterium is geen regionale,
  nationale of internationale vlucht, dus die tellen daar níet mee — je medaille
  krijg je wel. Hetzelfde geldt voor de kolom **Winst** op de ranglijst en voor de
  drempels van je sponsors (§12).

---

## 16. Rassen (breeds)

Elke duif heeft een **ras**. Het ras bepaalt de **foto** van de duif en heeft
een **zeldzaamheid**; verder is het **puur cosmetisch** — het verandert **niets**
aan de eigenschappen of de prestaties. Wel maakt een zeldzamer ras de duif een
**beetje duurder** (hogere geschatte marktwaarde), ook al blijven de
eigenschappen identiek. Je ziet het ras (naam + zeldzaamheid) wanneer je op een
duif klikt.

### 16.1 Toewijzing (bij nieuwe duiven)
Elke nieuwe duif — of ze nu gekweekt, geadopteerd, gekocht, geveild of via een
gebeurtenis binnenkomt — krijgt bij haar ontstaan een ras toegewezen volgens
onderstaande **kansen** (gewogen loting). Bestaande duiven kregen eenmalig een
ras via dezelfde loting.

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

De kansen komen rechtstreeks van de gewichten op
[roekoe.org/wiki/breeds](https://roekoe.org/wiki/breeds); dezelfde foto's worden
in het spel gebruikt.

### 16.2 Kweken: ras van het jong
Bij het **broeden** erft een jong het ras van zijn ouders **enkel als beide
ouders hetzelfde ras hebben** — dan behoudt het jong dat ras. Kweek je **twee
verschillende rassen**, dan wordt het jong een **Gemengd** ras (zonder
prijstoeslag). Zo kan je door gericht te koppelen een zeldzaam ras zuiver
houden, of net mengen.

### 16.3 Verzamelbadges (Prestaties → Rassen)
Rassen verzamelen is een eigen prestige-doel. In **Prestaties** vind je onder
**🕊️ Rassen** badges voor:
- **Elk ras** — één badge per ras (bezit een duif van dat ras). Hoe zeldzamer
  het ras, hoe meer XP de badge oplevert.
- **Elke zeldzaamheid** — een badge voor het bezitten van een **Ongewone**, een
  **Zeldzame** (Meulemans) en een **Legendarische** duif (Bonte of Golden Ace),
  plus **Mengelmoes** voor een zelf-gekweekte **Gemengde** duif.
- **Alle rassen** — de kapstok-badge **Rassenverzamelaar**: bezit **tegelijk**
  een duif van **elk** ras (+500 XP).

---

## 17. De computermelkers (bots)

Naast de echte spelers rijden er **acht computermelkers** mee. Ze zijn er om het
deelnemersveld te vullen: zonder hen zou een vlucht met drie inschrijvingen aan
de start staan. Ze spelen met **exact dezelfde regels** als jij — geen extra
geld, geen betere duiven, geen vrijstellingen.

**Ze runnen hun hok net als jij.** Een bot koopt voer (en schakelt over op
**Herstelvoer** zodra hij het kan betalen), zet zieke duiven in de **ziekenboeg**,
neemt een **dokter** of **kinesist** in dienst, koopt er **bedden** bij, geeft een
uitgeputte duif een **rustkuur**, huurt een **privécoach** voor zijn beste duiven,
**breidt zijn hok uit** en **kweekt jongen**. Dat laatste is belangrijk voor jou:
vroeger konden bothokken alleen maar krimpen — duiven gingen dood en er kwam
niets bij — waardoor het veld seizoen na seizoen dunner werd. Nu houden ze zichzelf
op peil, dus je blijft echte tegenstand houden.

**Ze schrijven in tot vlak voor de lossing.** Een bot bekijkt elke geplande
vlucht opnieuw zolang ze nog niet vertrokken is. Zie je vandaag pas drie
inschrijvingen voor de vlucht van overmorgen, dan zegt dat dus niets — er komen
er nog bij naarmate hun duiven uitrusten.

**Eén vlucht per duif per dag geldt ook voor hen** (§3.9). Een bot die zijn duif 's
ochtends op het criterium zet, heeft haar 's middags niet meer beschikbaar — dus ook
bij hen roteert het hok over de dagen heen, net als bij jou.

**En de rust tussen twee nesten geldt ook voor hen** (§7.2). Een bot betaalt
dezelfde €750 en zijn ouders rusten dezelfde drie weken uit, dus hij kan zijn hok
niet sneller aanvullen dan jij. Hij koppelt bovendien **nooit twee verwanten**
(§7.3) en houdt zich aan dezelfde kweekleeftijd van 8 weken.

**Ze kiezen hun duiven met verstand.** Een bot zet een duif enkel in als ze de
route ook echt aankan (genoeg energie voor de afstand) en niet als haar
gezondheid te ver gezakt is. Hij houdt bovendien een **koppel thuis** wanneer zijn
hok dun wordt, om te kunnen kweken. **Behalve bij de estafettevlucht** — daar
geldt geen enkele energiedrempel, net zoals bij jou (§2.9): drie duiven aan de
start krijgen is daar het punt, en hoeveel energie een duif voor haar etappe
nodig heeft, beslist de melker zelf.

**Ze handelen ook.** Een bot koopt duiven van spelers die te koop staan, en sinds
kort **biedt** hij ook: staat er een *bieden vanaf* op je duif en vindt hij de
vraagprijs te hoog, dan doet hij een bod rond de **marktwaarde** van die duif — jij
beslist. Hij biedt nooit boven wat ze waard is, en nooit op een duif die nog geen
dag te koop staat: die eerste dag is voor de spelers.

**Ze winnen ook.** Bots pakken prijzengeld, seizoenspunten, Roekoes en Vleugels
als ze het verdienen (§15). Ze doen niet mee aan **oefenvluchten** en je kan geen
bod uitbrengen op hun duiven.

**Ze kopen op de markt.** Zet je een duif te koop (§9), dan kan een bot ze kopen —
als ze een verbetering is voor zijn hok en hij het geld heeft. Zit zijn hok vol,
dan laat hij zijn slechtste duif gaan om plaats te maken. Je krijgt er een melding
van en het geld staat meteen op je rekening. Ze betalen wel nooit veel meer dan de
**geschatte waarde** (§9.0), dus een fantasieprijs vragen werkt niet.

**De eerste dag is van de spelers.** Een duif die net te koop staat, blijft
**24 uur lang onaantastbaar voor de bots**. Op de markt zie je bij zo'n duif hoe
lang die voorsprong nog loopt (🆕). Haal je haar uit de markt en zet je haar
opnieuw te koop, dan begint die dag opnieuw.

---

## 18. Startershulp: je eerste seizoen

Kom je binnen in een club die al een tijd draait, dan vlieg je tegen duiven die
al weken getraind en gecoacht zijn. Zonder hulp is dat geen achterstand maar een
muur: een vers hok haalt tegen zulke duiven **geen enkele keer** een podium. Elke
speler die zich vanaf nu registreert krijgt daarom een **starterspakket**.

Je vindt het bovenaan je **Overzicht**, zolang je er nog iets van over hebt.

### 18.1 Punten die je zelf verdeelt

Deze twee zijn een **tegoed**, geen automatische bonus: jij kiest waar ze
landen. Ze **vervallen niet** — ook na je eerste seizoen kan je ze nog uitgeven.

| Tegoed | Hoeveel | Waar het heen mag |
|---|---|---|
| 🎓 **Ervaring** | **30** punten | allemaal naar **één** duif naar keuze |
| 💪 **Eigenschappen** | **5** punten | vrij te spreiden over duiven én over snelheid/conditie/oriëntatie |

**Waarom ervaring naar één duif?** Ervaring is veruit de grootste rem op een
nieuw hok — ze telt drie keer mee (§2.3): sneller vliegen, energie beter
doseren, en minder verbruik per vlucht (§3). Alles op één duif zetten levert je
één echte kanshebber op in plaats van zes duiven die net iets minder kansloos
zijn. Kies dus met overleg: eens gekozen, gaan de rest van je punten naar
diezelfde duif.

Je krijgt de volle 30 punten ervaring; de leerfactor van §3.7 (waardoor een
routinier steeds trager bijleert) geldt hier **niet** — dat is een voorsprong
die je cadeau krijgt, geen ervaring die je zelf hebt gevlogen.

**Eigenschapspunten respecteren wél het genetisch plafond** van je duif (§7bis).
Zit een duif nog maar 2 onder haar cap, dan landen er ook maar 2 punten — de
overige blijven in je tegoed staan voor een andere duif.

### 18.2 Voordelen voor 28 dagen (één seizoen)

| Voordeel | Wat het doet |
|---|---|
| 🎯 **Gratis privécoach** | je **eerste** gecoachte duif kost je niets. Een tweede coach betaal je gewoon (§13) |
| 💰 **Dubbele winst** | op **wedstrijdvluchten** krijg je **2×** prijzengeld én **2×** ranglijstpunten |
| ⚡ **Volle duiven** | al je startduiven beginnen op **100 energie**, dus met een groene vluchtvorm (§3.2) |
| 🤝 **Eerste sponsor** | er ligt meteen een aanbod van een kleine sponsor klaar |

Dat laatste lost meteen een vervelend kip-en-ei-probleem op: sponsors melden
zich normaal pas **na een podiumplaats** (§12), en die haalt een nieuwe speler
nu net niet. Zo zie je het sponsorsysteem vanaf dag één.

Je **startgeld blijft €5.000**, net als bij iedereen.

### 18.3 En daarna?

Na 28 dagen stoppen de voordelen uit §18.2 gewoon: je coach kost weer €80 per
dag en je wint weer enkelvoudig. **Je krijgt daar een melding van** — het is
niet de bedoeling dat je er pas achter komt als je kassa sneller leegloopt dan
je gewend was. Punten die je dan nog niet uitgaf, blijven gewoon van jou.

---

*Alle getallen hierboven zijn de tuning-constanten; pas ze aan in
`core/config/gameConfig.ts` om het spel te herbalanceren.*
