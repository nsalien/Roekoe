/**
 * De bel waarmee de hokinrichting, het hokoverzicht, het zoekertje naar boven en
 * de besmetting per ziekte aangekondigd worden (migratie v61 in schedule.ts zet
 * hem in de inbox van élke echte speler). Eén bel voor alles, zodat de volgorde
 * in de inbox geen rol speelt; de tweede helft van de aankondiging is
 * INRICHTING_NEWS_STEPS in client/src/components/Tour.tsx. De tekst staat hier
 * en niet in de migratie, zodat de test hem kan lezen zonder de motor te draaien.
 */

import { INSURANCE, LURE, LURE_MAX_LEVEL, MARKET_BOOST, STUD, VACCINES, studFailedRefund } from '../config/gameConfig.js';

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
