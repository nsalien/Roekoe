# Roekoe — Dev gepauzeerd (sinds 11 okt 2026)

Deze branch (`claude/demo-hokinrichting`, **Dev**) staat **op pauze** op vraag van de eigenaar,
zodat hij niets van Cloudflare verbruikt. Cloudflare bouwde er één statische pauzepagina van
(pauzecommit **`b21060f`**), zonder `functions/`: geen Worker, geen D1, geen demo, en zolang
niemand pusht ook geen builds. Productie en haar databank zijn **niet** aangeraakt.

> Een commit op deze branch die **begint met `[CF-Pages-Skip]`** laat Cloudflare niet bouwen.
> Gebruik dat voor elke wijziging zolang Dev gepauzeerd is.

## Waar alles staat
De volledige Dev-stand is de commit **vóór** de pauzecommit: **`bc8c415`** ("Markt: zoekertje
naar boven — €50, 12 uur bovenaan tot iemand anders boost"). Daar staan de code, de echte
`context.md` (§0b: elke dev-feature met zijn valkuilen) en `spelregels.md`. Lezen zonder iets
terug te zetten:

    git show bc8c415:context.md

**Inhoud van Dev:** demomodus (preview = demo in de browser), hokoverzicht, pagina **Inrichting**
(hygiëne + poetser, vaccins & kuren, uitrusting, verzekering, vakblad, weerstation),
**Marktwaarde v2**, vaccinprijzen van de eigenaar (PMV €10, pokken €8, salmonella €6, kuren €5)
en het **zoekertje naar boven** (€50, 12 uur bovenaan). Scout, koppels, partnerhok en weduwschap
waren al van Dev gehaald.

## Dev terugzetten (precies zoals hij was)
Nagekeken: de revert geeft exact `bc8c415`.

    git fetch origin claude/demo-hokinrichting
    git checkout claude/demo-hokinrichting
    git reset --hard origin/claude/demo-hokinrichting
    git revert --no-edit b21060f
    git push origin claude/demo-hokinrichting      # Cloudflare bouwt de demo-preview opnieuw

Het demohok van de eigenaar staat nog in de browser (localStorage op het preview-adres) en is er
meteen terug. Na de revert is dit bestand weer de volledige `context.md`.

**Nieuwe ontwikkeling** terwijl Dev gepauzeerd is: eerst Dev terugzetten, tenzij de eigenaar
iets anders zegt.

## Dev naar productie (de features zoals ze nu zijn)
Enkel op uitdrukkelijke vraag van de eigenaar. Dev hoeft daarvoor niet eerst terug aan.

1. **Waarom geen gewone merge:** prod (`claude/roekoe-game-website-jwa0vo`, laatst `973bffc`) heeft
   2 eigen commits: `ef48798` *Marktwaarde houdt stand* en `973bffc` *nooit onder 1/5*. Dev heeft
   daar zijn eigen versie van, aangepast aan Marktwaarde v2 (`81c8450`, `da33cc6`; zelfde
   `MIN_SALE_SHARE` en `IGNORED_TRADES`). Een gewone merge botst in 9 bestanden. Dev bevat alles
   wat prod heeft (enkel woorden verschillen: "koppelen" → "broeden"). Dus: Dev's code integraal
   overnemen en prod als samengevoegd registreren. Nagekeken: de boom is daarna exact `bc8c415`,
   en de push naar prod is een fast-forward.

       git fetch origin claude/demo-hokinrichting claude/roekoe-game-website-jwa0vo
       git checkout -B dev-naar-prod bc8c415     # of de top van Dev, als die terug aan staat
       git merge -s ours origin/claude/roekoe-game-website-jwa0vo -m "Dev naar productie"
       # controle (§7 in de echte context.md): npx tsc --noEmit
       #   cd client && npm run typecheck && npm run typecheck:demo && cd ..
       #   npm --prefix client run build && rm -rf client/dist
       #   de testreeks (age-cup was al rood)
       git push origin dev-naar-prod:claude/roekoe-game-website-jwa0vo   # geen force nodig

2. **Databank:** prod's 56 `SCHEMA_STEPS` zijn **exact het begin** van Dev's 61. Bij het eerste
   verzoek voegt `ensureSchema` er 5 kolommen aan toe: `lofts.equipment`, `pigeons.care`,
   `flights.forecast`, `trades.quality` en `pigeons.boosted_at`. Niets te herschikken. De
   waarschuwing "achteraan productie's lijst" in §0b geldt **enkel** als je losse features
   cherry-pickt.
3. **Demomodus** gaat mee maar doet niets in productie: een build op de prod-branch is een gewone
   build, byte-identiek zonder demo (`client/vite.config.ts`, bewaakt door `tests/demo-build.test.mts`).
4. **Eerst beslissen** (open punten uit §0b): Marktwaarde v2 verandert de waarde die iedereen
   ziet; besmetting per ziekte (de kuren lonen nu voor geen enkele duif); blijven de
   opvangcentrum-veilingen buiten de marktwaarde?
5. **Daarna:** `context.md` op prod is dan Dev's versie. Zet §0b op "live", werk de branchtabel
   bij en herstart Dev vanaf prod.
6. **Enkel sommige features?** Cherry-pick per commit uit
   `git log --oneline origin/claude/roekoe-game-website-jwa0vo..bc8c415` (30 commits). Een
   schema-stap gaat dan **achteraan prod's lijst**, in de volgorde waarin hij live gaat.
