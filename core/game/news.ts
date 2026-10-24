/**
 * De bel waarmee de hokinrichting, het hokoverzicht, het zoekertje naar boven en
 * de besmetting per ziekte aangekondigd worden (migratie v61 in schedule.ts zet
 * hem in de inbox van élke echte speler). Eén bel voor alles, zodat de volgorde
 * in de inbox geen rol speelt; de tweede helft van de aankondiging is
 * INRICHTING_NEWS_STEPS in client/src/components/Tour.tsx. De tekst staat hier
 * en niet in de migratie, zodat de test hem kan lezen zonder de motor te draaien.
 */

import { INSURANCE, LEAGUE, LEAGUES, LURE, LURE_MAX_LEVEL, MARKET_BOOST, PIGEON_TAGS, STUD, VACCINES, leagueAward, studFailedRefund } from '../config/gameConfig.js';

export const INRICHTING_NEWS = {
  title: '🧰 Nieuw: je hok inrichten, en meer',
  body: [
    'Er is heel wat nieuw voor je hok:',
    '• 🧰 Inrichting: een nieuwe pagina in het menu. Alles wat je aan je hok koopt staat daar samen, in vier blokken: '
      + 'plaatsen & hokken (hokcapaciteit en aparte hokken koop je nu hier), hygiëne (vers stro en een '
      + 'hokpoetser), vaccins & kuren, en uitrusting zoals dakventilatie, een buitenren of een weerstation. '
      + 'Niets kopen = het spel zoals je het kende.',
    '• 🛡️ Een verzekering per duif (op de pagina van de duif) en het vakblad (op de Markt).',
    '• 🕊️ Bovenaan Mijn hok staat een hokoverzicht: waar elke duif zit, wie in de ziekenboeg ligt en wie niet thuis is.',
    `• 📌 Op de Markt zet je je eigen zoekertje voor €${MARKET_BOOST.cost} ${MARKET_BOOST.hours} uur lang bovenaan, `
      + 'tot iemand anders het zijne naar boven haalt.',
    '• 🦠 Besmetting gaat nu per ziekte: een zieke hokgenoot geeft haar eigen ziekte door, en paramyxo slaat veel '
      + 'makkelijker over dan salmonella. Zet een zieke duif dus meteen in de ziekenboeg.',
    'Alles op een rij: Wiki → Nieuw: inrichting & meer.',
  ].join('\n'),
  /** Stabiel per speler: twee verzoeken die tegelijk migreren geven één bel. */
  id: (userId: string) => `ntf:news:inrichting:${userId}`,
} as const;

/**
 * De bel van SAMEN KWEKEN (migratie v62 in schedule.ts, voor élke echte speler).
 * De tweede helft van de aankondiging is studNewsSteps in client/src/components/Tour.tsx;
 * de uitleg staat in de wiki (#samen-kweken). Bedragen uit STUD, zodat bel en spel
 * niet uit elkaar kunnen lopen.
 */
export const STUD_NEWS = {
  title: '🤝 Nieuw: samen kweken met de duif van een andere speler',
  body: [
    'Je kan nu kweken met de duif van een andere speler. Je vindt het bij Kweek → Samen kweken:',
    '• Bied een gezonde duif aan en kies meteen of je de jongen wil of de vergoeding, en wat een partner minstens '
      + 'moet hebben (★, energie, libido).',
    '• Stel zelf een duif voor bij een aangeboden duif. Je ziet meteen de geschatte score van het jong en wat '
      + 'zo\'n jong waard is.',
    `• Jullie onderhandelen enkel over het bedrag. Bij een akkoord betaalt elk €${STUD.cost} en start het nest — `
      + 'zoals elk nest kan het even duren, en een jong is niet gegarandeerd.',
    '• Wie de jongen krijgt, betaalt de vergoeding pas als ze er zijn (een tweeling gaat naar dezelfde speler). '
      + `Blijft de worp leeg, dan krijgt elk €${studFailedRefund()} terug. Zit je hok vol, dan kies je zelf welke je houdt.`,
    '• Een duif die aangeboden of voorgesteld is, blijft thuis: je kan haar niet inschrijven voor een vlucht.',
    'Alles op een rij: Wiki → Samen kweken.',
  ].join('\n'),
  /** Stabiel per speler: twee verzoeken die tegelijk migreren geven één bel. */
  id: (userId: string) => `ntf:news:samenkweken:${userId}`,
} as const;

const NO_FLY_DAYS = Math.max(...Object.values(VACCINES).map((v) => v.noFlyDays));

/**
 * De bel die bij de aankondiging van 11 okt (v61) ontbrak: vaccins en kuren kan je
 * ook per duif geven, en een duif verzekeren doe je op haar eigen pagina. Ook via
 * migratie v62, met een eigen id zodat het een aparte bel is.
 */
export const CARE_NEWS = {
  title: '💉 Ook per duif: vaccins en een verzekering',
  body: [
    'Gisteren vergeten te melden: je hoeft niet altijd het hele hok te vaccineren. Op de pagina van elke duif '
      + '(tik op haar naam) staat de kaart "Verzorging & verzekering":',
    `• 💉 Geef één duif een vaccin of een kuur — bijvoorbeeld je beste duiven. Na een vaccin mag ze ${NO_FLY_DAYS} `
      + 'dagen niet vliegen; een kuur houdt haar niet aan de grond.',
    `• 🛡️ Verzeker een duif: sterft ze, dan krijg je ${Math.round(INSURANCE.payoutRate * 100)} % van haar marktwaarde. `
      + `De premie betaal je per dag (ze staat in je Dagbalans) en de dekking start na ${INSURANCE.waitingDays} dagen.`,
    'Wanneer de verzekering uitbetaalt en wat elk middel doet: Wiki → Hokinrichting, vaccins & diensten.',
  ].join('\n'),
  id: (userId: string) => `ntf:news:verzorgingperduif:${userId}`,
} as const;

/**
 * De bel van de DUIVENLOKKER (migratie v64 in schedule.ts, voor élke echte speler;
 * idee van De Stem, "Vrijgelate duifjes zoeken nieuw nest"). De tweede helft van de
 * aankondiging is lureNewsSteps in client/src/components/Tour.tsx; de uitleg met de
 * kansen staat in de wiki (#duivenlokker). Prijs en niveaus uit LURE.
 */
export const LURE_NEWS = {
  title: '🧲 Nieuw: de duivenlokker',
  body: [
    'Denk twee keer na voor je een duif vrijlaat: misschien vliegt ze naar het hok van een concurrent.',
    `• 🧲 Koop een duivenlokker bij Inrichting → Uitrusting (€${LURE.prices[0].toLocaleString('nl-BE')}) en waardeer hem `
      + `op tot niveau ${LURE_MAX_LEVEL}.`,
    '• Laat een andere speler een duif vrij, dan maakt elke lokker kans om haar te vangen. Hoe hoger het niveau, '
      + 'hoe groter de kans. Een duif belandt hoogstens bij één lokker, en ze kan altijd ook gewoon verdwijnen.',
    '• Vangt jouw lokker een duif, dan krijg je een bel en kies je bij Kweek of je haar houdt — zit je hok vol, '
      + 'maak dan eerst plaats. Laat je haar gaan, dan is ze voorgoed weg.',
    '• Laat je zelf een duif vrij, dan hoor je waar ze terechtkwam en wat de nieuwe eigenaar besliste.',
    '• Wil je zeker niet dat een concurrent haar krijgt? Het restaurant blijft altijd een optie. 🍲',
    'Alles op een rij: Wiki → Duivenlokker.',
  ].join('\n'),
  /** Stabiel per speler: twee verzoeken die tegelijk migreren geven één bel. */
  id: (userId: string) => `ntf:news:duivenlokker:${userId}`,
} as const;

/**
 * De bel van de TAGS OP JE DUIVEN (migratie v65 in schedule.ts, voor élke echte
 * speler). De tweede helft is tagNewsSteps in client/src/components/Tour.tsx; de
 * uitleg staat in de wiki (#tags). Aantal en lengte uit PIGEON_TAGS.
 */
export const TAGS_NEWS = {
  title: '🏷️ Nieuw: tags op je duiven',
  body: [
    'Geef je duiven je eigen labels, zoals "sprint", "mid-fond" of "lange-fond" — of wat je maar wil.',
    `• Op de pagina van een duif (tik op haar naam) zet je tot ${PIGEON_TAGS.max} tags, elk hoogstens `
      + `${PIGEON_TAGS.maxLength} tekens. Gratis.`,
    '• Je ziet ze bij het inschrijven op de Vluchten-pagina, achter de naam van elke duif die je kan inschrijven: '
      + 'zo kies je snel de juiste duif voor een korte sprint of een lange internationale vlucht.',
    '• Ze staan ook bij je duiven in Mijn hok.',
    '• Enkel jij ziet je tags. Verkoop je een duif (of verandert ze op een andere manier van eigenaar), dan verdwijnen ze.',
    'Meer uitleg: Wiki → Tags op je duiven.',
  ].join('\n'),
  /** Stabiel per speler: twee verzoeken die tegelijk migreren geven één bel. */
  id: (userId: string) => `ntf:news:tags:${userId}`,
} as const;

const WEEKDAY_NL = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const LEAGUE_AT = `${String(LEAGUE.hour).padStart(2, '0')}:${String(LEAGUE.minute).padStart(2, '0')}`;

/**
 * De bel van de LEAGUES (migratie v66 in schedule.ts, voor élke echte speler): het
 * leeftijdscriterium is weg, vier leagues per algemene score nemen zijn plaats in.
 * De tweede helft is leagueNewsSteps in client/src/components/Tour.tsx; de uitleg
 * staat in de wiki (#leagues). Dagen, bedragen en het minimum uit LEAGUE/LEAGUES.
 */
export const LEAGUE_NEWS = {
  title: '🏅 Nieuw: de leagues, in plaats van het criterium',
  body: [
    'Het leeftijdscriterium is weg. In de plaats komen vier leagues volgens de algemene score (★) van je duif: '
      + 'zo vliegt een zwakkere duif tegen haar gelijken en kan ook zij iets winnen.',
    `• ${LEAGUES.map((l) => `${l.icon} ${l.short} op ${WEEKDAY_NL[l.weekday]}`).join(' · ')}, telkens om ${LEAGUE_AT} — `
      + 'week om week een sprint of een grote fond.',
    `• Inschrijven kost €${LEAGUE.entryFee}. Je duif vliegt in de league van haar score op het moment dat je haar `
      + `inschrijft. Een league gaat pas door met minstens ${LEAGUE.minOwners} melkers en ${LEAGUE.minBirds} duiven.`,
    `• Prijzengeld per vlucht (hoe hoger de league, hoe meer) en medailles, maar geen seizoenspunten. Op het einde `
      + `van elk seizoen wint de top ${LEAGUE.awards.length} van elke league geld (tot €${leagueAward(LEAGUES[LEAGUES.length - 1].id, 1).toLocaleString('nl-BE')}), `
      + 'de top 3 ook een titel op de duif.',
    'De stand staat bij Ranglijst → Leagues. Alles op een rij: Wiki → Leagues.',
  ].join('\n'),
  /** Stabiel per speler: twee verzoeken die tegelijk migreren geven één bel. */
  id: (userId: string) => `ntf:news:leagues:${userId}`,
} as const;
