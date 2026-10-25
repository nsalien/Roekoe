# Roekoe — Dev gepauzeerd (sinds 25 okt 2026, derde keer)

Deze branch staat **op pauze** op vraag van de eigenaar ("Haal Dev omgeving nu ook eventjes terug offline
zodat die niets van resources verbruikt"). Cloudflare bouwt er één statische pauzepagina van
(`pauze/index.html`, via `npm run build` → `pauze/build.mjs`), **zonder `functions/`**: geen Worker, geen D1,
geen demo, en zolang niemand pusht ook geen builds. Productie en haar databank zijn **niet** aangeraakt.
Zelfde werkwijze als de vorige pauzes (11 okt `b21060f`, 12 okt `dea321f`, 14 okt `2ea049c`).

Gepauzeerd zijn **beide** dev-branches, die op dezelfde commit staan:
`claude/demo-hokinrichting` (preview `claude-demo-hokinrichting.roekoe.pages.dev`) en
`ccr-45f5bf10-t7yi6h` (preview `ccr-45f5bf10-t7yi6h.roekoe.pages.dev`).

> Een commit op deze branch die **begint met `[CF-Pages-Skip]`** laat Cloudflare niet bouwen.
> Gebruik dat voor elke wijziging zolang Dev gepauzeerd is.

> ⚠️ Oudere previews blijven bij Cloudflare op hun eigen adres (`<hash>.roekoe.pages.dev`) staan, mét hun
> Worker. Enkel het branch-adres toont de pauzepagina; wie een oud hash-adres opent, start daar nog een demo.

## Waar alles staat
De volledige Dev-stand is de commit **vóór** de pauzecommit: **`d2820bf`** ("Dev gelijk met prod: CPU-fix
(formatters cachen, rij-diff)"). Daar staan de code, de echte `context.md` (§0b: elke dev-feature met zijn
valkuilen) en `spelregels.md`. Lezen zonder iets terug te zetten:

    git show d2820bf:context.md

## Wat er live staat (productie, `claude/roekoe-game-website-jwa0vo`, laatste commit `d423c1b`)
Alles van Dev **behalve** wat hieronder onder *Enkel op Dev* staat. Recent (24–25 okt):
- `5169df1` — seizoen 3 afgesloten en seizoen 4 gestart, met het criterium (migratie v66).
- `9b413a0` — **de leagues** in plaats van het leeftijdscriterium (v67): ★ t/m 60 · 61–70 · 71–80 · 81+,
  minstens 4 duiven van 3 melkers, eindprijzen per league (★ 81+ €1.600/1.300/950/…).
- `684e61f` — bots bijgevuld tot 10 duiven, ★60–75, in stappen van 3 per verzoek (v68).
- `d423c1b` — **CPU-fix ronde 3**: tijdzone-formatters gecachet en geen dubbele JSON-snapshot van
  duiven/hokken/koppels meer (een volledig verzoek bij ~325 duiven van 9,85 naar 5,53 ms lokaal).
Prod staat op **dataVersion 68**.

## Enkel op Dev (nog niet live)
- **Marktwaarde v2** en de **demomodus** (zoals voorheen).
- **Voorstel prijsregel (24 okt, dev `b4ea10c`):** élke duif die thuis raakt krijgt het geld van haar plaats,
  de seizoenspunten blijven voor de beste 3 per hok; hogere leagueprijzen per vlucht (zege ★ t/m 60
  €800/€1.200 … ★ 81+ €1.100/€1.650); bel **v69** (wacht op v68), rondleiding, wiki, spelregels.
  ⚠️ Gaat dit live: v69 is op prod nog vrij (prod staat op 68).
- **Voorstel coachprijs (25 okt, dev `7d70007`):** de scoreschijf is de basis, + 3 % per 10 ervaring (max
  30 %) en + 10 % per duivenjaar (max 20 %), op €10. Bij ★80: pas geboren €220, 4 jaar/ervaring 90 €320.
  Nog geen bel.
- ⚠️ Schema: op Dev staat `trades.quality` (v2) onder de kop "ENKEL OP DEV" in `core/d1.ts`, na prod's lijst.

## Dev terugzetten (precies zoals hij was)
Draai álle commits sinds `d2820bf` terug (de pauzecommit en eventuele documentatie erna). De laatste revert
heeft dan geen skip-vlag, dus Cloudflare bouwt de demo opnieuw. Doe het op beide branches (ze delen dezelfde
commits, dus één revert pushen naar allebei volstaat):

    git fetch origin claude/demo-hokinrichting
    git checkout claude/demo-hokinrichting
    git reset --hard origin/claude/demo-hokinrichting
    git revert --no-edit d2820bf..HEAD
    git push origin claude/demo-hokinrichting
    git push origin HEAD:ccr-45f5bf10-t7yi6h

Is prod intussen verder gegaan, herstart dan zoals op 24 okt: vanaf prod, met de dev-only stukken erbovenop,
als samenvoegcommit bovenop de pauzecommits (geen force-push) — zie `git show d2820bf:context.md`, §0b.

Het demohok van de eigenaar staat nog in de browser (localStorage op het preview-adres) en is er meteen
terug (de demo bouwt zich wel opnieuw op als `DEMO_VERSION` intussen veranderde). Na de revert is dit
bestand weer de volledige `context.md`.

**Nieuwe ontwikkeling** terwijl Dev gepauzeerd is: eerst Dev terugzetten, tenzij de eigenaar iets anders zegt.
