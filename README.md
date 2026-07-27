# 🕊️ Roekoe

Een online **duivenmelker-managementspel** voor een groepje vrienden — geïnspireerd
op het originele Roekoe. Verzorg je duiven, train ze, koop en verkoop op de markt,
kweek nieuwe kampioenen en schrijf ze in voor de wekelijkse vluchten. Bots vliegen
mee als tegenstanders zodat het veld altijd gevuld is.

De kernloop: **verzorgen → trainen → inschrijven voor vluchten → punten & geld
verdienen → kopen/kweken/uitbreiden → herhalen.**

## Wat zit erin

- **Login per speler** (JWT), met een uitnodigingscode zodat alleen je vrienden
  kunnen registreren. De eerste speler wordt automatisch beheerder.
- **Duiven** met eigenschappen (snelheid, uithoudingsvermogen, oriëntatie) plus
  dynamische conditie, gezondheid en ervaring. Leeftijd volgt een prestatiecurve.
- **Verzorging**: voerschema kiezen, voer bijkopen, wekelijkse conditie-opbouw en
  onderhoudskosten.
- **Vluchten**: club- en nationale vluchten op verschillende afstanden. De afstand
  bepaalt welke eigenschappen zwaar wegen (sprint = snelheid, fond = uithouding +
  oriëntatie). Weer en geluk zorgen voor spanning.
- **Markt**: koop van de NPC-duivenmarkt of van andere spelers; zet je eigen
  duiven te koop.
- **Kweek**: koppel een doffer en een duivin; de jongen erven het gemiddelde van
  de ouders met wat variatie.
- **Ranglijst**: seizoenspunten voor alle hokken (spelers + bots), met
  seizoensreset.
- **Bots**: computertegenstanders die elke week voeren, inschrijven en trainen.

## Architectuur

Een monorepo met twee delen, bewust gescheiden zodat je onderdelen los kunt
uitbreiden:

```
Roekoe/
├── server/        Node + Express + TypeScript — de gezaghebbende spel-engine
│   └── src/
│       ├── config/gameConfig.ts   ← alle instelbare getallen (de "knoppen")
│       ├── db/                     ← JSON-datalaag (makkelijk te vervangen door SQLite)
│       ├── auth/                   ← wachtwoorden + JWT
│       ├── game/                   ← pigeon, flight, breeding, economy, bots, engine
│       └── routes/                 ← REST-API + presenters (DTO's)
└── client/        React + Vite + TypeScript — de grafische web-app
    └── src/
        ├── pages/                  ← Login, Overzicht, Hok, Duif, Markt, Kweek, Vluchten, Ranglijst
        ├── components/             ← o.a. de SVG-duif, statbalken, kaarten, layout
        ├── game/ + auth/           ← gedeelde React-context (spelstatus, ingelogde speler)
        └── api/                    ← dunne fetch-client
```

Alle spellogica staat op de **server** (één bron van waarheid); de client is puur
presentatie. Nieuwe functies voeg je meestal toe in `server/src/game/` +
`gameConfig.ts` en een bijbehorende pagina in `client/src/pages/`.

## Lokaal draaien

Vereist Node 20+.

```bash
# 1. Dependencies installeren (server + client)
npm run install:all

# 2. Server-config
cp server/.env.example server/.env
#   Zet in server/.env een eigen JWT_SECRET en een INVITE_CODE voor je vrienden.

# 3. In twee terminals:
npm run dev:server     # API op http://localhost:4000
npm run dev:client     # client op http://localhost:5173 (proxyt /api naar de server)
```

Open http://localhost:5173 en registreer de eerste speler — die wordt beheerder.

### Als één geheel draaien (productie)

De server serveert de gebouwde client automatisch als `client/dist` bestaat:

```bash
npm run build          # bouwt de client naar client/dist
npm start              # server draait de API én de web-app op http://localhost:4000
```

## Zo speel je

1. **Registreer** een hok (eerste speler = beheerder).
2. **Verzorg** je duiven op *Overzicht*: kies een voerschema en koop voer bij.
3. **Schrijf in** voor vluchten onder *Vluchten → Gepland*.
4. De **beheerder** klikt bovenaan op *Volgende week*: alle vluchten worden
   gevlogen, duiven gevoerd, jongen geboren en de markt ververst.
5. Bekijk de **uitslagen**, verdien geld en punten, en bouw je hok uit via
   *Markt* en *Kweek*.

## Instellingen (`server/.env`)

| Variabele     | Betekenis                                                        |
| ------------- | ---------------------------------------------------------------- |
| `PORT`        | Poort van de API-server (standaard 4000).                        |
| `JWT_SECRET`  | Geheime sleutel voor sessietokens — **verander deze**.           |
| `INVITE_CODE` | Code die vrienden nodig hebben om te registreren (leeg = open).  |
| `ADMIN_USERS` | Komma-gescheiden gebruikersnamen met beheerdersrechten.          |
| `DATA_DIR`    | Map waar de JSON-database wordt bewaard (standaard `./data`).    |

## Balans aanpassen

Bijna alles is instelbaar in **`server/src/config/gameConfig.ts`**: startgeld,
voerprijzen, de vluchtkalender, prijzengeld, punten, hoe afstand de eigenschappen
weegt, kweekinstellingen, de leeftijdscurve en het aantal bots.

## Ideeën voor later

Personeel aannemen, hokken bouwen/uitbreiden, een weersvoorspelling vóór de vlucht,
rayons/regio's, een echte database (SQLite/Postgres — vervang alleen `server/src/db/store.ts`),
duiven-pensioen en een stamboom-overzicht.
