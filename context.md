# Roekoe — Dev gepauzeerd (sinds 6 nov 2026, vierde keer)

Deze branch staat **op pauze** op vraag van de eigenaar ("Zet dev terug inactief"). Cloudflare bouwt er één
statische pauzepagina van (`pauze/index.html`, via `npm run build` → `pauze/build.mjs`), **zonder `functions/`**: geen
Worker, geen D1, geen demo, en zolang niemand pusht ook geen builds. Productie en haar databank zijn **niet** aangeraakt.
Zelfde werkwijze als de vorige pauzes (11 okt `b21060f`, 12 okt `dea321f`, 14 okt `2ea049c`, 25 okt `098be3d`).

Gepauzeerd zijn **beide** dev-branches, die op dezelfde commit staan:
`claude/demo-hokinrichting` (preview `claude-demo-hokinrichting.roekoe.pages.dev`) en
`ccr-9f062ea2-reeikx` (preview `ccr-9f062ea2-reeikx.roekoe.pages.dev`).

> Een commit op deze branch die **begint met `[CF-Pages-Skip]`** laat Cloudflare niet bouwen.
> Gebruik dat voor elke wijziging zolang Dev gepauzeerd is.

> ⚠️ Oudere previews blijven bij Cloudflare op hun eigen adres (`<hash>.roekoe.pages.dev`) staan, mét hun
> Worker. Enkel het branch-adres toont de pauzepagina; wie een oud hash-adres opent, start daar nog een demo.

## Waar alles staat
De volledige Dev-stand is de commit **vóór** de pauzecommit: **`fd2638e`** ("context.md: volwassen-feestje (d09fc52)
live"). Daar staan de code, de echte `context.md` (§0 en §0b: elke dev-feature met zijn valkuilen) en `spelregels.md`.
Lezen zonder iets terug te zetten:

    git show fd2638e:context.md

## Wat er live staat (productie, `claude/roekoe-game-website-jwa0vo`, laatste commit `6799a41`)
Alles van Dev **behalve** wat hieronder onder *Enkel op Dev* staat. Recent (31 okt – 4 nov):
- `c644026` — de gewone erfenis voor De Vluchtige Vleugel (migratie v71).
- `f93d91f` — een verouderd scherm herlaadt zichzelf (`/version.json`).
- `39dd03f` — **de bank** (lenen tot 10 dagen inkomsten; inkomstenverleden via een schemastap; bel v72) en het
  **gsm-menu in rijen van 7**; `16e2738` — de duidelijkere bankbel (v73).
- `8369ff5` — de **rustkuur kost €150** per duif (bel v74).
- `d09fc52` — het **volwassen-feestje** (een duif die in je hok 8 weken wordt), zonder bel.
Prod staat op **dataVersion 74**; een volgende migratie op prod is **v75**.

## Enkel op Dev (nog niet live)
- **Marktwaarde v2** en de **demomodus**.
- **Voorstel prijsregel (24 okt):** élke duif die thuis raakt krijgt het geld van haar plaats, de seizoenspunten
  blijven voor de beste 3 per hok; hogere leagueprijzen per vlucht. Bel op dev = **v75** (wacht op v74). ⚠️ Gaat dit
  live: v75 is op prod het eerstvolgende vrije nummer, tenzij prod intussen verder is.
- **Voorstel coachprijs (25 okt):** de scoreschijf + 3 % per 10 ervaring (max 30 %) + 10 % per duivenjaar (max 20 %).
- ⚠️ Schema: op Dev staat `trades.quality` (v2) onder de kop "ENKEL OP DEV" in `core/d1.ts`, na prod's lijst.

## Dev terugzetten (precies zoals hij was)
Draai álle commits sinds `fd2638e` terug (de pauzecommit en eventuele documentatie erna). De laatste revert heeft dan
geen skip-vlag, dus Cloudflare bouwt de demo opnieuw. Doe het op beide branches (ze delen dezelfde commits, dus één
revert pushen naar allebei volstaat):

    git fetch origin claude/demo-hokinrichting
    git checkout claude/demo-hokinrichting
    git reset --hard origin/claude/demo-hokinrichting
    git revert --no-edit fd2638e..HEAD
    git push origin claude/demo-hokinrichting
    git push origin HEAD:ccr-9f062ea2-reeikx

Is prod intussen verder gegaan, herstart dan zoals op 1 nov: vanaf prod, met precies de dev-only stukken erbovenop
(`git diff 6799a41 fd2638e | git apply -3` — `fd2638e` is prod `6799a41` + de dev-only stukken), als samenvoegcommit
bovenop de pauzecommits (geen force-push) — zie `git show fd2638e:context.md`, §0b *Dev herstart op 1 nov*.
