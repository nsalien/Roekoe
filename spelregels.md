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

### 2.1 Kalender (max. 2 per dag, Brussel-tijd)
- **10:00 — lange vlucht**: nationaal of internationaal (wisselt per dag).
- **17:00 — korte vlucht**: regionaal.

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

---

## 3. Effect van een vlucht op de duif

Per deelnemende duif, na afloop:

| Effect | Formule |
|---|---|
| **Energie** (verbruik) | −(8 + afstand/40 + willekeurig 0…6) |
| **Conditie** (opbouw) | +(0.3 + afstand/500 + willekeurig 0…0.4) |
| **Gezondheid** | −(willekeurig 0 … afstand/200) |
| **Ervaring** | +(2 + afstand/100) |

> **Voorbeeld.** Na een vlucht van **300 km** verliest een duif ongeveer
> **18 energie**, wint ze ~**1 conditie** en ~**5 ervaring**, en gaat er een
> beetje gezondheid af. Een korte regiovlucht van 60 km kost maar ~10 energie;
> een internationale van 700 km bijna 30. Vandaar dat je duiven na een zware
> vlucht enkele dagen moet laten recupereren (zie §4).

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

### 3.2 Kans op kwetsuur
```
basiskans   = 0.025 + afstand · 0.00018
kans_duif   = basiskans · (1 + (100 − Energie)/100)     // lage energie = risicovoller
```
De kwetsuur is willekeurig uit de lijst (zie §5).

> **Voorbeeld.** Op een fondvlucht van **490 km** is de basiskans 0.025 +
> 490·0.00018 ≈ **11%** bij volle energie. Vliegt de duif op haar tandvlees
> (energie 30), dan wordt dat ×1.7 → **~19%**. Uitgeputte duiven laten vliegen
> is dus vragen om blessures.

---

## 4. Voeding & verzorging (dagelijks, echte tijd)

Voeding en herstel gebeuren **elke dag** automatisch (niet pas op weekeinde).

**Rantsoenen** (verbruik per duif per **dag**):
| Schema | Voer/duif/dag | Energie/week | Gezondheid/week |
|---|---|---|---|
| Zuinig | 0.7 kg | +6 | +2 |
| Normaal | 1.0 kg | +12 | +5 |
| Royaal | 1.4 kg | +18 | +8 |

Voerprijs: **€3/kg**. Startvoorraad: **80 kg** (± twee weken voor een starthok).

Per dag, per duif (weekwaarden gedeeld door 7):
```
gevoerd:
  Energie   += (energie_per_week / 7) · (1 + Ervaring/200)   // ervaring = sneller herstel
  Gezondheid+= (gezondheid_per_week / 7) + Conditie/280       // goede conditie = betere gezondheid
niet gevoerd (voorraad op):
  Energie   −= 8/7
  Gezondheid−= 6/7
```

> **Voorbeeld.** Een hok met **6 duiven** op Normaal eet 6 kg/dag, dus je
> startvoorraad van 80 kg is na ~**13 dagen** op. Een goed gevoerde duif met
> ervaring 40 wint ongeveer **+2 energie per dag** (≈ +14 per week). Loopt je
> voer leeg, dan verliest élke duif ~1 energie én ~1 gezondheid per dag — dat
> tikt snel aan. Koop dus tijdig bij (€3/kg).

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
Ziekte/herstel/sterfte en het seizoen worden ook dan verwerkt (zie §5, §6).

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

### 5.3 Kans op herstel (wekelijks)
```
basis (in ziekenboeg): licht 0.55 · matig 0.38 · ernstig 0.22
  + medicinaal voer:  +0.18
  + dokter (ziekte) of kinesist (kwetsuur), indien gedekt: +0.28
  cap: 0.92
in het gewone hok (niet geïsoleerd): basis · 0.40   (geen extra's)
```

> **Voorbeeld.** Een **matige** ziekte geneest per week met:
> ~**15%** in het gewone hok · ~**38%** in de ziekenboeg ·
> ~**56%** met medicinaal voer · ~**84%** met voer + dokter.
> Investeren in verzorging halveert dus makkelijk de tijd dat een duif ziek is.

### 5.4 De ziekenboeg
- Capaciteit: **4 duiven** (later uitbreidbaar).
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

**Voorwaarden:** een doffer + een duivin, beide met energie ≥ **40**, geen
ziekte/kwetsuur, niet in de ziekenboeg. Kost **€200** en **−15 energie** per
ouder.

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
verbetering (~+1.2, tot max 92) aan snelheid, conditie of oriëntatie, plus
**+4 ervaring**. Vereist voldoende energie.

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
  topduif onder de hamer op de markt. Je biedt met echt geld; je inzet wordt
  vastgehouden en terugbetaald zodra iemand je overbiedt. Bij sluiting wint de
  hoogste bieder de duif.
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

---

*Alle getallen hierboven zijn de tuning-constanten; pas ze aan in
`core/config/gameConfig.ts` om het spel te herbalanceren.*
