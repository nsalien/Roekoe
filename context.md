# Roekoe — Dev gepauzeerd (sinds 11 okt 2026)

Deze branch (`claude/demo-hokinrichting`, **Dev**) staat **op pauze** op vraag van de eigenaar,
zodat hij niets van Cloudflare verbruikt. Cloudflare bouwt er enkel een statische pauzepagina
van, zonder `functions/`: geen Worker, geen D1, geen demo.

## Waar alles staat
De volledige Dev-stand is de commit **vóór** de pauzecommit: **`bc8c415`** ("Markt: zoekertje
naar boven — €50, 12 uur bovenaan tot iemand anders boost"). Daar staan de code, de echte
`context.md` (§0b: alles over de dev-features, met de schema-waarschuwingen) en `spelregels.md`.
Lezen zonder iets terug te zetten:

    git show bc8c415:context.md

## Dev terugzetten (precies zoals hij was)

    git fetch origin claude/demo-hokinrichting
    git checkout claude/demo-hokinrichting
    git reset --hard origin/claude/demo-hokinrichting
    git revert --no-edit HEAD        # HEAD = de pauzecommit
    git push origin claude/demo-hokinrichting

Cloudflare bouwt de demo-preview opnieuw. Het demohok staat nog in de browser van de eigenaar
(localStorage op het preview-adres) en is er meteen terug. Haal daarna de pauzemelding uit
`context.md` op prod, in een commit die begint met `[CF-Pages-Skip]` (dan bouwt productie niet).

## Dev naar productie
Zie **"⏸️ Dev gepauzeerd"** bovenaan `context.md` op prod (`claude/roekoe-game-website-jwa0vo`).
