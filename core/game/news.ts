/**
 * De bel waarmee de hokinrichting, het hokoverzicht, het zoekertje naar boven en
 * de besmetting per ziekte aangekondigd worden (migratie v61 in schedule.ts zet
 * hem in de inbox van élke echte speler). Eén bel voor alles, zodat de volgorde
 * in de inbox geen rol speelt; de tweede helft van de aankondiging is
 * INRICHTING_NEWS_STEPS in client/src/components/Tour.tsx. De tekst staat hier
 * en niet in de migratie, zodat de test hem kan lezen zonder de motor te draaien.
 */

import { MARKET_BOOST } from '../config/gameConfig.js';

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
