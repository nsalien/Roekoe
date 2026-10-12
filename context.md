# Roekoe — Dev gepauzeerd (sinds 12 okt 2026, tweede keer)

Deze branch staat **op pauze** op vraag van de eigenaar ("zet de demo terug inactief zoals vorige
keer"), zodat Dev niets van Cloudflare verbruikt. Cloudflare bouwt er één statische pauzepagina van
(`pauze/index.html`, via `npm run build` → `pauze/build.mjs`), **zonder `functions/`**: geen Worker,
geen D1, geen demo, en zolang niemand pusht ook geen builds. Productie en haar databank zijn **niet**
aangeraakt. Zelfde werkwijze als de eerste pauze (11 okt, commit `b21060f`).

Gepauzeerd zijn **beide** dev-branches, die op dezelfde commit staan:
`claude/demo-hokinrichting` (preview `claude-demo-hokinrichting.roekoe.pages.dev`) en
`claude/breeding-other-player-pigeons-7314iz` (preview `claude-breeding-other-player.roekoe.pages.dev`).

> Een commit op deze branch die **begint met `[CF-Pages-Skip]`** laat Cloudflare niet bouwen.
> Gebruik dat voor elke wijziging zolang Dev gepauzeerd is.

## Waar alles staat
De volledige Dev-stand is de commit **vóór** de pauzecommit: **`7d7b40b`** ("Demo: geen bot-aanbod
meer in de seed (DEMO_VERSION 8)"). Daar staan de code, de echte `context.md` (§0b: elke dev-feature
met zijn valkuilen) en `spelregels.md`. Lezen zonder iets terug te zetten:

    git show 7d7b40b:context.md

**Gewijzigd tijdens de pauze (12 okt):** de bots doen niet meer mee met samen kweken (eigenaar: "ze
gaan de duiven voor te lage prijs laten gaan") — `bc65e0b` (feature, migratie **v63** met een
rechtzettingsbel) en `7d7b40b` (demo). Daarvoor ging Dev in `e102b9b` even terug naar `6be40c3`; die
drie commits en deze pauzecommit gingen in één push, met `[CF-Pages-Skip]` op de laatste, dus
Cloudflare bouwde niets. Deze pauzecommit is boom voor boom gelijk aan de eerste (`dea321f`), op dit
bestand na.

## Wat er live staat (productie, `claude/roekoe-game-website-jwa0vo`)
Alles van Dev **behalve Marktwaarde v2** (eigenaar 11 okt: "nog niet") **en de demomodus** (geen
spelersfeature):
- 11 okt (`4a0c3ad`): hokoverzicht, Inrichting (hygiëne, vaccins & kuren, uitrusting, verzekering,
  vakblad, weerstation), zoekertje naar boven, besmetting per ziekte; aankondiging v61.
- 12 okt (`ffb04b7`, docs `617d648`): **Samen kweken** (kweken met de duif van een andere speler, met
  de bots erbij) + de aankondiging v62 (bel over samen kweken en bel over vaccins en verzekering per
  duif, rondleiding, wiki #nieuw).
- **Nog niet live:** de bots uit samen kweken halen (`bc65e0b`, v63). Naar prod enkel als de eigenaar
  het vraagt; tot dan bieden de bots op prod nog duiven aan.

**Op Dev en nergens anders:** Marktwaarde v2 en de demomodus. ⚠️ Schema: prod heeft de drie
samen-kweken-stappen direct na `pigeons.boosted_at`; op Dev zit `trades.quality` (v2) ertussen.
Gaat v2 live, dan komt `trades.quality` **achteraan prod's lijst**.

## Dev terugzetten (precies zoals hij was)
Draai álle commits sinds `7d7b40b` terug (de pauzecommit en eventuele documentatie erna). De laatste
revert heeft dan geen skip-vlag, dus Cloudflare bouwt de demo opnieuw. Doe het op beide branches
(ze delen dezelfde commits, dus één revert pushen naar allebei volstaat):

    git fetch origin claude/demo-hokinrichting
    git checkout claude/demo-hokinrichting
    git reset --hard origin/claude/demo-hokinrichting
    git revert --no-edit 7d7b40b..HEAD
    git push origin claude/demo-hokinrichting
    git push origin HEAD:claude/breeding-other-player-pigeons-7314iz

Het demohok van de eigenaar staat nog in de browser (localStorage op het preview-adres) en is er
meteen terug. Na de revert is dit bestand weer de volledige `context.md`.

**Nieuwe ontwikkeling** terwijl Dev gepauzeerd is: eerst Dev terugzetten, tenzij de eigenaar iets
anders zegt.
