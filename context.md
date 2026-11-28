# Roekoe — Productie gepauzeerd (sinds 28 nov 2026)

Het spel staat **op pauze** op vraag van de eigenaar ("Zet het productiespel op pauze zodat er niets meer gebeurt
op de achtergrond en er geen resources verbruikt worden van Cloudflare"). Dezelfde werkwijze als de pauzes van Dev
(laatst 6 nov, `f063429` op `claude/demo-hokinrichting`).

## Wat de pauze doet

- De productiebranch `claude/roekoe-game-website-jwa0vo` bevat enkel een statische pauzepagina
  (`pauze/index.html`, via `npm run build` → `pauze/build.mjs` → `client/dist`), **zonder `functions/`**: de live
  site draait geen Worker, raakt `roekoe-db` niet en haalt geen weer op. Statische bestanden kosten op Pages niets.
- Het spel heeft geen achtergrondtaak: de motor (`advanceRealtime`) draait enkel op een API-verzoek. Zonder Worker
  gebeurt er dus niets meer. Er is geen cron, geen GitHub Action.
- **De databank is niet aangeraakt.** `roekoe-db` staat zoals na The Last Flight: `world.dataVersion` **77**, de
  kalender stil (`World.scheduleEndedAt`), alle hokken, duiven en kassa's bewaard.
- Elk pad (ook `/api/*`) geeft de pauzepagina terug. Een tab die nog op het oude spel openstaat, ziet in
  `/version.json` een nieuwe build (`pauze-<commit>`) en herlaadt naar de pauzepagina zodra hij terug op de
  voorgrond komt; tot dan krijgen zijn verzoeken de statische pagina, zonder Worker.
- ⚠️ **Oude deployments blijven bestaan.** Elke vroegere build staat nog op zijn eigen adres
  (`<hash>.roekoe.pages.dev`), mét zijn Worker en mét de koppeling aan de live `roekoe-db`. Enkel het
  productieadres toont de pauzepagina. Wie zo'n oud adres opent, start daar de motor. Wil de eigenaar dat
  helemaal uitsluiten: in het Cloudflare-dashboard (Workers & Pages → roekoe → Deployments) de oude deployments
  verwijderen. Dat kan niet vanuit een cloudsessie.

> Een commit op de productiebranch die **begint met `[CF-Pages-Skip]`** laat Cloudflare niet bouwen. Gebruik dat
> voor elke wijziging zolang het spel gepauzeerd is.

## Waar alles staat

De volledige spelstand is de commit **vóór** de pauzecommit: **`a85cbf8`** ("context.md: The Last Flight en
startduiven (d8e1740) live"). Daar staan de code, de echte `context.md`, `spelregels.md` en `context-archief.md`.
Lezen zonder iets terug te zetten:

    git show a85cbf8:context.md

Live code vóór de pauze = prod `d8e1740` (The Last Flight). Dev = de sessiebranch `ccr-943f9dad-ye8tgq`, die ook
gepauzeerd is. Demo-dev (`claude/demo-hokinrichting`) staat al sinds 6 nov op pauze.

## Het spel terugzetten

⚠️ **Eerst beslissen: wat met de gemiste dagen?** De wereldklok is afgeleid uit tijdstempels. Gaat de motor weer
draaien, dan haalt `tickDailyCare` de gemiste dagovergangen in, één per verzoek en tot
`DAILY_CARE_MAX_CATCHUP_DAYS` (30) dagen: voer, honger, vaste onkosten, sponsors, schuld, en per gerolde speelweek
ook veroudering en sterfte. Wil de eigenaar dat niet, zet dan in dezelfde push een migratie **v78** (gegate op
`dataVersion === 77`) die `world.lastDailyTick` op middernacht Brussel van vandaag zet en `world.dailyCareCursor`
leeg maakt. `runDataMigrations` draait als eerste in `advanceRealtime`, dus vóór de inhaalslag. De kalender blijft
stil tot iemand `World.scheduleEndedAt` weghaalt (`ensureFlightsScheduled`); ook dat is een keuze van de eigenaar.

Draai daarna álle commits sinds `a85cbf8` terug (de pauzecommit en de documentatie erna). De bovenste commit van
die push mag **geen** `[CF-Pages-Skip]` hebben, anders bouwt Cloudflare het spel niet:

    git fetch origin claude/roekoe-game-website-jwa0vo
    git checkout claude/roekoe-game-website-jwa0vo
    git reset --hard origin/claude/roekoe-game-website-jwa0vo
    git revert --no-commit a85cbf8..HEAD
    # eventueel hier de migratie v78 toevoegen (zie hierboven), dan verifiëren zoals in §7 van de oude context.md
    git commit -m "Spel terug aan: pauze teruggedraaid"
    git push origin claude/roekoe-game-website-jwa0vo

Zet daarna de sessiebranch op dezelfde stand en werk `context.md` bij (de live-hash, en wat de pauze kostte).
