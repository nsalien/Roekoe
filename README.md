# 🕊️ Roekoe

Een online **duivenmelker-managementspel** voor een groepje vrienden — geïnspireerd
op het originele Roekoe. Verzorg je duiven, train ze, koop en verkoop op de markt,
kweek nieuwe kampioenen en schrijf ze in voor de wekelijkse vluchten. Bots vliegen
mee als tegenstanders zodat het veld altijd gevuld is.

De kernloop: **verzorgen → trainen → inschrijven voor vluchten → punten & geld
verdienen → kopen/kweken/uitbreiden → herhalen.**

Gebouwd om **volledig op Cloudflare** te draaien: een statische React-client op
Cloudflare Pages, met de API als Pages Functions (Workers) en een Cloudflare
**D1**-database. Geen server die altijd aan hoeft te staan.

## Wat zit erin

- **Login per speler** (JWT via Web Crypto), met een uitnodigingscode zodat alleen
  je vrienden kunnen registreren. De eerste speler wordt automatisch beheerder.
- **Duiven** met eigenschappen (snelheid, uithoudingsvermogen, oriëntatie) plus
  dynamische conditie, gezondheid en ervaring, en een leeftijdscurve.
- **Verzorging**: voerschema kiezen, voer bijkopen, wekelijkse conditie-opbouw en
  onderhoudskosten.
- **Vluchten**: club- en nationale vluchten op verschillende afstanden. De afstand
  bepaalt welke eigenschappen zwaar wegen (sprint = snelheid, fond = uithouding +
  oriëntatie). Weer en geluk zorgen voor spanning.
- **Markt**: koop van de NPC-duivenmarkt of van andere spelers; zet je eigen duiven
  te koop.
- **Kweek**: koppel een doffer en een duivin; de jongen erven het gemiddelde van de
  ouders met wat variatie.
- **Ranglijst**: seizoenspunten voor alle hokken (spelers + bots), met seizoensreset.
- **Bots**: computertegenstanders die elke week voeren, inschrijven en trainen.

## Architectuur

```
Roekoe/
├── client/            React + Vite + TypeScript — de grafische web-app (→ statisch)
│   └── src/ pages, components, api, auth, game-context, styles
├── core/              Runtime-neutrale spelkern (draait op de Workers-runtime)
│   ├── config/gameConfig.ts   ← alle instelbare getallen (de "knoppen")
│   ├── schema.ts              ← datamodel (entiteiten)
│   ├── store.ts               ← Store-interface + in-memory basis
│   ├── d1.ts                  ← D1-implementatie (laadt wereld, schrijft alleen wijzigingen)
│   ├── auth.ts                ← wachtwoord-hashing + JWT via Web Crypto
│   ├── presenters.ts          ← DTO's voor de client
│   └── game/                  ← pigeon, flight, breeding, economy, bots, engine
├── functions/
│   └── api/[[path]].ts        ← de hele API als één Hono-app (Cloudflare Pages Function)
├── migrations/0001_init.sql   ← D1-schema
└── wrangler.toml              ← Pages + D1 configuratie
```

De **spelregels** staan één keer, in `core/` (gedeeld door de API). De API-laag in
`functions/` is dun: elk verzoek laadt de wereld uit D1, draait de engine en schrijft
de gewijzigde rijen terug. Nieuwe functies voeg je meestal toe in `core/game/` +
`core/config/gameConfig.ts`, een endpoint in `functions/api/[[path]].ts`, en een
pagina in `client/src/pages/`.

> Omdat de wereld klein is (~10 spelers + bots) laadt elk verzoek de hele wereld en
> schrijft alleen de gewijzigde rijen terug. Twee spelers die tegelijk iets aan
> verschillende duiven/hokken doen, overschrijven elkaar dus niet. Wordt het ooit
> groter, dan is `core/d1.ts` de enige plek om slimmer te persisteren.

## Lokaal draaien

Vereist Node 20+.

```bash
# 1. Dependencies (root = Functions/Worker, plus de client)
npm run install:all

# 2. Lokale geheimen
cp .dev.vars.example .dev.vars      # zet een JWT_SECRET; INVITE_CODE mag leeg voor testen

# 3. Lokale D1-database aanmaken (schema toepassen)
npm run db:migrate:local

# 4. Alles samen draaien (bouwt de client + serveert API + lokale D1)
npm run dev                          # http://localhost:8788
```

Open http://localhost:8788 en registreer de eerste speler — die wordt beheerder.

Voor snelle client-iteratie met live herladen: `npm run dev:client` (Vite op :5173,
proxyt `/api` naar :8788). Houd daarnaast `npm run dev` aan voor de API.

## Online zetten op Cloudflare Pages (jouw domein)

Eenmalig, met de Wrangler-CLI (`npx wrangler login` eerst):

```bash
# 1. Maak de D1-database en zet het database_id in wrangler.toml
npx wrangler d1 create roekoe-db
#    -> kopieer het database_id naar wrangler.toml onder [[d1_databases]]

# 2. Pas het schema toe op de echte database
npm run db:migrate

# 3. Zet je JWT-geheim (niet in git!)
npx wrangler pages secret put JWT_SECRET
#    Pas eventueel INVITE_CODE / ADMIN_USERS aan in wrangler.toml ([vars]).

# 4. Bouw + deploy
npm run deploy
```

Daarna in het Cloudflare-dashboard: **Workers & Pages → jouw project → Custom
domains** en koppel je eigen domein.

Je kunt het ook via het dashboard koppelen aan deze GitHub-repo (build command
`npm run build`, output `client/dist`); voeg dan de D1-binding en de `JWT_SECRET`
in de projectinstellingen toe.

## Zo speel je

1. **Registreer** een hok (eerste speler = beheerder).
2. **Verzorg** je duiven op *Overzicht*: kies een voerschema en koop voer bij.
3. **Schrijf in** voor vluchten onder *Vluchten → Gepland*.
4. De **beheerder** klikt bovenaan op *Volgende week*: alle vluchten worden gevlogen,
   duiven gevoerd, jongen geboren en de markt ververst.
5. Bekijk de **uitslagen**, verdien geld en punten, en bouw je hok uit via *Markt* en
   *Kweek*.

## Instellingen

| Variabele     | Waar | Betekenis                                                    |
| ------------- | ---- | ------------------------------------------------------------ |
| `JWT_SECRET`  | secret | Sleutel voor sessietokens — **zet als secret**, niet in git. |
| `INVITE_CODE` | `wrangler.toml [vars]` / `.dev.vars` | Code die vrienden nodig hebben om te registreren (leeg = open). |
| `ADMIN_USERS` | `wrangler.toml [vars]` | Komma-gescheiden gebruikersnamen met beheerdersrechten.      |

## Balans aanpassen

Bijna alles is instelbaar in **`core/config/gameConfig.ts`**: startgeld, voerprijzen,
de vluchtkalender, prijzengeld, punten, hoe afstand de eigenschappen weegt,
kweekinstellingen, de leeftijdscurve en het aantal bots.

## Ideeën voor later

Personeel aannemen, hokken bouwen/uitbreiden, een weersvoorspelling vóór de vlucht,
rayons/regio's, duiven-pensioen en een uitgebreider stamboom-overzicht. Voor strikte
consistentie bij veel gelijktijdige spelers kan de wereldstaat later naar een Durable
Object (Workers betaald) verhuizen.
