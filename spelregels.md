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
| **Ervaring** | groeit | Zelfvertrouwen. Betere prestaties, sneller energieherstel én **minder energieverbruik per vlucht**. Groeit door te vliegen. |

Een duif is **vluchtklaar** als: niet gepensioneerd, geen ziekte/kwetsuur, niet
in de ziekenboeg, minstens **8 weken** oud en gezondheid > 15.

**Talent** (voor marktprijs/bots) = gemiddelde van snelheid, conditie, oriëntatie.

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
| **Maandag** | 08:00 internationaal |
| **Dinsdag** | 10:00 regionaal · 12:00 **oefenvlucht** (§2.7) |
| **Woensdag** | 08:00 nationaal |
| **Donderdag** | 08:00 internationaal |
| **Vrijdag** | 10:00 regionaal · 12:00 **oefenvlucht** (§2.7) |
| **Zaterdag** | 08:00 **Titanenwedstrijd** (§2.8) of 05:00 **Estafettevlucht** (§2.9) — week om week, en de **enige** vlucht die dag |
| **Zondag** | 08:00 nationaal · 17:00 regionaal |

Dat zijn **8 wedstrijdvluchten + 2 oefenvluchten per week**: 3 regionale, 2
nationale, 2 internationale en 1 weekendwedstrijd. Bewust **minder vluchten dan
vroeger** (toen was er élke dag een lange én een korte vlucht): alle melkers
putten uit dezelfde duiven, dus een lichtere kalender betekent **meer duiven aan
de start van élke vlucht** en dus een **sterker deelnemersveld** om tegen te
strijden.

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
  gewicht.snelheid   = 0.65 + (0.20 − 0.65)·t
  gewicht.conditie   = 0.13 + (0.45 − 0.13)·t
  gewicht.oriëntatie = 0.22 + (0.35 − 0.22)·t

basisscore = gewicht.snelheid·Snelheid + gewicht.conditie·Conditie + gewicht.oriëntatie·Oriëntatie

# Energie doseren met ervaring:
effectieve_energie = Energie + (Ervaring/100)·(100 − Energie)·0.35
# Energiefactor is afstandsafhankelijk (kort mild, lang streng), op de effectieve energie:
energiefactor_kort = interp: 0→0.80, 50→0.95, 100→1.05
energiefactor_lang = interp: 0→0.45, 50→0.85, 100→1.20
energiefactor      = energiefactor_kort + (energiefactor_lang − energiefactor_kort)·t

gezondheidsf.  = interp(Gezond.):  0→0.40, 50→0.85, 100→1.00
ervaringfactor = 1 + Ervaring/300           (tot +33%)
leeftijdfactor = leeftijdscurve (zie §6)
weerfactor     = 0.70 … 1.20 (zie §2.5)
geluk          = willekeurig 0.90 … 1.10

snelheid = (700 + basisscore·9) · energiefactor · gezondheidsf. · ervaringfactor · leeftijdfactor · weerfactor · geluk
```

**Alle drie de vaardigheden tellen mee**, met **snelheid als sprint-eigenschap die
op korte vluchten het zwaarst weegt** (0.65) en conditie & oriëntatie die op lange
vluchten belangrijker worden.

**Energie werkt afstandsafhankelijk:** op een **korte** vlucht wordt een futloze
duif maar licht afgestraft (ze kan er nog goed presteren); vanaf **middellange tot
lange** afstand weegt weinig energie veel zwaarder door.

**Ervaring laat energie doseren:** een ervaren duif presteert alsof ze méér energie
heeft (tot 35% van haar energietekort wordt "goedgemaakt"). Bij gelijke andere
eigenschappen kan een **ervaren duif met weinig energie** dus **beter scoren dan een
onervaren duif met veel energie**. Ervaring helpt daardoor extra op lange vluchten.

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

**Live-bord.** Tijdens de vlucht zie je per duif de afgelegde afstand en haar
**snelheid in km/u**. Dat is de **echte, effectieve snelheid** — berekend uit haar
eigenschappen, vorm-van-de-dag en het weer op het stuk dat ze op dat moment vliegt,
geen opsmuk. Om het rustig leesbaar te houden **verspringt het cijfer om de ~5
minuten** in plaats van elke seconde te flikkeren.

**📻 Live verslag.** Het verslag naast het bord is geen willekeurige grap meer: het
meldt de **échte gebeurtenissen** uit de vlucht, afgeleid uit hoe de duiven vliegen.
Vooral **wie wie voorbijsteekt** — en, als de reden duidelijk is, **waaróm**:
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
- Regionaal: 800, 600, 350, 220, 140, 90, 55, 30
- Nationaal: 1200, 800, 500, 320, 210, 140, 95, 60, 40, 25
- Internationaal: 2200, 1800, 1000, 650, 420, 270, 170, 100

**Punten** (top 20): 100, 80, 65, 55, 47, 40, 34, 29, 25, 21, 18, 15, 13, 11, 9, 7, 5, 3, 2, 1.
Seizoenspunten tellen op over **alle** vluchten en **alle** duiven van een hok.

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
- Er is **inschrijfgeld** (€50) en er valt **enkel geld** te winnen: **geen
  seizoenspunten** en **geen medailles**, dus het telt **niet mee voor de
  melkerranglijst (de Roekoe, §15.2)**. Prijzengeld: **1e €1800, 2e €1200, 3e €900**.
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
- Net als de titan: **enkel geld**. Geen seizoenspunten, geen medailles, dus het
  telt **niet mee voor de melkerranglijst** (§15.2). Er kan ook **niet op gewed**
  worden.
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

---

## 3. Effect van een vlucht op de duif

Per deelnemende duif:

| Effect | Formule | Wanneer |
|---|---|---|
| **Energie** (verbruik) | −((10 + afstand/30) · ervaringsfactor + willekeurig 0…10) | **geleidelijk tijdens de vlucht** (zie hieronder) |
| **Conditie** (opbouw) | +(0.3 + afstand/500 + willekeurig 0…0.4) | na afloop |
| **Gezondheid** | −(willekeurig 0 … afstand/200) | na afloop |
| **Ervaring** | +(2 + afstand/100) | na afloop |

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
prijs: iedereen mag uitvliegen.

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
| Herstel | 1.5 kg | €3 | **energie +42**, gezondheid +3 |

Iedereen start (na de overstap) met **50 kg Normaal**; alle duiven staan standaard
op Normaal.

Per dag, per gevoerde duif (weekwaarden gedeeld door 7):
```
Energie   += (energie_per_week / 7) · (1 + Ervaring/200)   // ervaring = sneller herstel
Gezondheid+= (gezondheid_per_week / 7) + Conditie/280       // goede conditie = betere gezondheid
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
onkosten/dag = 22 + 2 · aantal_duiven
             + 36 · aantal_gecoachte_duiven          (coach, §13)
             + 57 · dokters + 50 · kinesisten        (ziekenboegstaf, §5)
             + 6  · duiven_in_boeg (met medicatievoer)
```
Ook **sponsorbijdragen** worden dagelijks uitbetaald (weekbedrag ÷ 7). Voer wordt
apart uit je voorraad verbruikt (§4). Ziekte/sterfte-rondes en de seizoenswissel
lopen los daarvan (§5, §6, §15).

Onkosten kunnen je kassa **onder €0** duwen. Sta je negatief, dan **kan je niet
meer inschrijven** voor vluchten: eerst een duif verkopen om terug uit het rood
te geraken.

### 4.3 Rustkuur (energie kopen met tijd)
Naast wachten en Herstelvoer kan je een duif een **betaalde rustkuur** geven op
haar duifpagina:
- Kost **€300** en duurt **één dag** (24 u, echte tijd).
- Tijdens de kuur **rust** de duif volledig: ze kan **niets** doen — **geen
  vluchten, geen training, geen koppelen** — tot de 24 u om zijn.
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

Bij het uitbreken zakt de gezondheid meteen: **licht −10, matig −22, ernstig −38**.
Bovendien blijft een aandoening de gezondheid **elke dag verder ondermijnen**
zolang de duif niet genezen is — **licht −0,6, matig −1,5, ernstig −2,5 per dag**,
en **×1,5** zolang ze *niet* in de ziekenboeg zit. Een zieke of gekwetste duif die
je laat aanmodderen wordt dus steeds zwakker; snel behandelen beperkt de schade.

### 5.2 Kans op ziekte (elke dag, in echte tijd)
Duiven worden nu **effectief ziek tijdens het spelen**: elke dagovergang (00:00)
krijgt elke gezonde, niet-geïsoleerde duif een kans om ziek te worden. De
weekkansen hieronder worden omgerekend naar een **dagkans**
(`dagkans = 1 − (1 − weekkans)^(1/7)`):
```
energierisico = clamp(1.3 − Energie/100, 0.3, 1.3)        // laag = risicovoller
per_bron      = 0.11 · clamp(1.2 − Gezondheid/100, 0.1, 1.2) · energierisico
van_anderen   = 1 − (1 − per_bron)^(aantal zieke, niet-geïsoleerde duiven)
spontaan      = 0.05 · clamp(1 − Gezondheid/100, 0, 1) · energierisico
totale_kans   = clamp(1 − (1 − van_anderen)·(1 − spontaan), 0, 0.85)   // per week, /7 per dag
```
Een duif **in de ziekenboeg** is geïsoleerd: besmet niemand en wordt niet besmet.

> **Voorbeeld.** Eén zieke hokgenoot loopt rond. Een fitte duif (gezondheid 85,
> energie 90) heeft daardoor maar **~2% kans/week** om ziek te worden. Een
> verzwakte duif (gezondheid 40, energie 20) zit rond **~13% kans/week** — meer
> dan zes keer zoveel. Lage gezondheid én lage energie maken je hok dus veel
> kwetsbaarder; zet zieke duiven meteen in de ziekenboeg om de ketting te breken.

**Onbehandeld = gevaarlijk.** Een matige of ernstige aandoening die je niet
verzorgt kan **dodelijk** aflopen. Een ernstig letsel dat je z'n hele beloop
buiten de ziekenboeg laat, heeft zo'n **~1 kans op 4** om de duif te kosten; in de
ziekenboeg zakt dat tot **~2%**. Lichte aandoeningen zijn nooit dodelijk.

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
- Dekking gaat eerst naar de ernstigste gevallen.
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
leeftijd (interp, per week): 4j 0.001 · 6j 0.006 · 8j 0.025 · 10j 0.07 · 12j 0.16 · 15j 0.40
onbehandelde aandoening (per week):
    buiten de boeg: matig +0.03 · ernstig +0.10
    in de boeg:     matig +0.005 · ernstig +0.025
```
Ouderdom weegt pas echt door vanaf ~4 jaar en loopt daarna op; jonge duiven
sterven zo goed als nooit vanzelf. Met de 4× versnelde veroudering bereikt een
duif van ~2,5 jaar de gevaarlijke leeftijd (~4 jaar) na zo'n **4–5 echte maanden**.
Ook **vluchten** kunnen dodelijk zijn (een uitgeputte duif die het onderweg
begeeft — zie §3.2). Bij overlijden krijgt de eigenaar een melding.

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
mutatie (±8), begrensd op de **gen-cap** van het jong (zie §7bis). Ook de
**genen zelf** (de plafonds + het verouderingstempo) erven over — gemiddelde van
de ouders ± mutatie. Koppel dus je best gegende duiven om een sterke lijn te bouwen.

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
vaardigheid (+**4 ervaring**) en kan **tot 80** (of de gen-cap als die lager is —
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
  **verkoopgeschiedenis** (laatste 200).
- Elke duif toont haar eigenaar; je koopt niet je eigen duiven en je hok mag niet
  vol zitten.

### 9.1 Privé-biedingen (bieden op een duif die niet te koop staat)
Je kan een **bod** uitbrengen op de duif van **een andere speler**, ook al staat
die **niet te koop**. Dat kan op **twee plaatsen**: op de **Markt** onder
**"🕊️ Bied op duiven van andere spelers"**, of via de knop **"Bied op deze duif"**
op de duifpagina zelf. Op de Markt gaat het **stap voor stap**: (1) kies eerst de
**speler** op wie je wilt bieden, (2) kies daarna een **duif** van die speler, en
(3) geef je **bedrag** in.

**Je ziet niet alle eigenschappen van andermans duiven.** Enkel de **algemene
score (★ talent)** is bekend — de precieze snelheid, conditie, oriëntatie, energie,
gezondheid, libido en ervaring blijven **geheim**. Je weet dus niet *exact* wat je
koopt, maar je kan wel een idee vormen via de **algemene score**, de
**duivenranglijst** of de **resultaten van specifieke vluchten**.
- Je geld wordt **niet** vastgehouden; het wordt pas gecontroleerd wanneer de
  eigenaar aanvaardt (heb je dan te weinig geld of geen plaats, dan vervalt het bod).
- De eigenaar ziet het bod **bij de Markt** (niet via de belknop) — met een teller
  bij het **Markt**-menu — en kan het **aanvaarden of weigeren**.
- Zolang de eigenaar niet reageert, **blijft je bod geldig**. Je kan het altijd zelf
  **intrekken** (dan vervalt het).
- Je hebt **één lopend bod per duif** (een nieuw bod past het bedrag aan).
- Bij **aanvaarden** verhuist de duif zoals bij een gewone verkoop; andere lopende
  biedingen op die duif vervallen. Je krijgt een melding bij aanvaarden/weigeren.

De **veilingen** (§12) hebben daarnaast een **anti-snipe**: een bod in de **laatste
5 minuten** schuift de sluitingstijd terug naar **5 minuten**, zodat anderen nog
kunnen terugbieden. In die slotfase telt de resterende tijd **live** af — de
countdown loopt vanzelf verder en de laatste biedingen verschijnen **zonder dat je
de pagina hoeft te vernieuwen**.

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

---

## 11. Meldingen (belknop)

De speler krijgt een melding bij: vluchtuitslag, verbetering van een duif,
kwetsuur, ziekte, herstel, sterfte en geboorte van jongen.

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
  dus je kiest **per duif** een voerschema (bij *Mijn hok* of op de duifpagina).
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
  dat de coach niets meer kan toevoegen.
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
internationaal). Op **oefenvluchten** (§2.7), de **titanenwedstrijd** (§2.8) en de
**estafettevlucht** (§2.9) kan je niet wedden.

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
geven punten; **de titanenwedstrijd, de estafettevlucht en oefenvluchten geven
géén seizoenspunten**).
**Bots dingen gewoon mee** en kunnen ook winnen —
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
allemaal voor het **lopende seizoen**. **Wedstrijdvluchten** (regionaal, nationaal,
internationaal) **én de weekendwedstrijden** (titan en estafette) tellen mee —
**enkel oefenvluchten niet**.
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

*Alle getallen hierboven zijn de tuning-constanten; pas ze aan in
`core/config/gameConfig.ts` om het spel te herbalanceren.*
