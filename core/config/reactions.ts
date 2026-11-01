/**
 * Vluchtreacties: de korte kreten die spelers tijdens een live vlucht in de
 * chatbox kunnen gooien — naar de vlucht in het algemeen, of recht naar een
 * andere melker.
 *
 * ## Twee assen, en waarom
 *
 * **Level bepaalt of je iets MAG zeggen, munten of je ervoor wil BETALEN.** Elke
 * gratis categorie gaat over jezelf of over de vlucht; zodra een boodschap zich
 * op een persoon richt staat er een level voor. Dat is de rem. De munten zijn
 * daarnaast maar een kleine tol: met een doorsnee kas van ~10.000 is 500 geen
 * echte drempel, en dat is bewust — de schaarste hoort in het level te zitten,
 * niet in de portemonnee.
 *
 * ## Vier ontgrendelroutes, zodat geen enkele categorie ooit dicht staat
 *
 * Een categorie die volledig achter een muur zit bestaat niet voor de speler: hij
 * ziet een slotje, weet niet wat erachter zit, en heeft dus geen reden om ernaar
 * toe te werken. Daarom heeft ELKE categorie vanaf level 1 iets bruikbaars:
 *
 *  1. `gift`      — zit in je hok vanaf de eerste dag. Bewust de meest absurde
 *                   regels, niet de venijnigste: ze tonen dát de categorie
 *                   bestaat.
 *  2. `milestone` — cadeau bij het bereiken van een level, zonder munten.
 *  3. `badge`     — hangt aan een badge in plaats van aan een level. Je verdient
 *                   de grap door het moment zelf te beleven: de diepvriesregel
 *                   komt vrij omdat er écht een duif van je is doodgegaan.
 *  4. winkel      — de rest: `minLevel` gehaald én `price` betaald.
 *
 * Routes 1-3 zijn AFGELEID uit level en badges, niet opgeslagen. Alleen aankopen
 * staan op de loft (`Loft.unlockedReactions`). Daardoor heeft een bestaande
 * speler zijn startgeschenk en mijlpalen meteen, zonder migratie.
 *
 * ## Kalibratie
 *
 * De ladder is geijkt op een gemiddelde speler van level 5-6 (≈850-1250 XP, zie
 * `levelForXp` in game/badges.ts). Een eerdere versie zette Zwart op level 14 —
 * de theoretische top van alle 64 badges samen. Dat was dode inhoud: gebouwd,
 * betaald, nooit gezien. Nu ligt Sneer nét onder het gemiddelde (5), Scherp op
 * ~1,5× (7) en Zwart op ~2,5× (9): aspirationeel maar haalbaar.
 *
 * ⚠️ Wie de levels hier verschuift moet `levelForXp` erbij nemen — de XP-afstand
 * tussen level 7 en 9 is groter dan die tussen 1 en 5.
 */

/** De kolommen van de kiezer. Volgorde = tabvolgorde in de UI. */
export const REACTION_CATS = [
  { id: 'juich', label: 'Aanmoedigen', icon: '🎉' },
  { id: 'baal', label: 'Balen', icon: '😖' },
  { id: 'wvl', label: 'West-Vlaams', icon: '🥔' },
  { id: 'excuus', label: 'Excuses', icon: '🤷' },
  { id: 'sportief', label: 'Sportief', icon: '🤝' },
  { id: 'complot', label: 'Complot', icon: '🕵️' },
  { id: 'sneer', label: 'Sneer', icon: '😏' },
  { id: 'scherp', label: 'Scherp', icon: '🔪' },
  { id: 'zwart', label: 'Zwart', icon: '🖤' },
] as const;

export type ReactionCat = (typeof REACTION_CATS)[number]['id'];

export interface ReactionTemplate {
  id: string;
  text: string;
  cat: ReactionCat;
  /** `vlucht` = naar iedereen; `speler` = gericht (en dus ook een melding). */
  channel: 'vlucht' | 'speler';
  /** Level nodig om dit in de winkel te mogen kopen (of gratis te krijgen). */
  minLevel: number;
  /** Muntprijs. 0 = geen aankoop nodig zodra `minLevel` gehaald is. */
  price: number;
  /** In het startpakket: beschikbaar vanaf dag één, wat de rest ook zegt. */
  gift?: boolean;
  /** Cadeau bij het bereiken van dit level, zonder munten. */
  milestone?: number;
  /** Badge-sleutel (zie game/badges.ts) die dit gratis ontgrendelt. */
  badge?: string;
}

/** De muntprijzen per betaalde categorie, zodat de winkel één bron heeft. */
export const REACTION_PRICES = { sneer: 100, scherp: 250, zwart: 500 } as const;

/**
 * Hoeveel reacties er van één speler in één vlucht bewaard blijven, en hoe snel
 * hij opnieuw mag posten.
 *
 * `keep` is bewust klein: de chat rijdt mee op de flight-rij (zie
 * `Flight.chat`), en die rij wordt op elke live-poll uitgelezen. Vijftig korte
 * regels is ~4 kB — te verwaarlozen naast `sim`, maar het mag niet groeien.
 *
 * `collapseSeconds` vouwt een herhaalde template van dezelfde speler samen tot
 * `×3` in plaats van drie regels. Zonder dat vult één enthousiaste speler in
 * zijn eentje het hele venster en duwt hij iedereen eruit.
 */
export const FLIGHT_CHAT = {
  keep: 50,
  cooldownSeconds: 20,
  collapseSeconds: 60,
  /**
   * Het grootste deel van de box dat één speler tegelijk mag vullen.
   *
   * ⚠️ Bewust een AANDEEL en geen teller per vlucht. Een teller ("hoogstens 25
   * berichten") zou moeten meten hoeveel iemand VERSTUURDE, en dat staat
   * nergens: de box bewaart alleen de laatste `keep` regels, dus zodra er
   * getrimd wordt zakt zo'n telling vanzelf en mag dezelfde speler weer. Dit
   * meet wat we werkelijk willen voorkomen — dat één melker de tribune bezet —
   * en dat is precies wél af te lezen aan wat er staat.
   */
  maxShareOfBox: 0.4,
} as const;

/** Level waarop een categorie in de winkel verschijnt. */
const LVL = { free: 1, wvl: 2, complot: 3, sneer: 5, scherp: 7, zwart: 9 } as const;

/**
 * De catalogus.
 *
 * ⚠️ `id` is een opslagsleutel: hij staat in `Loft.unlockedReactions` en in elke
 * bewaarde chatregel. Hernoem er nooit één — een gekochte reactie zou dan
 * verdwijnen uit het hok dat ervoor betaald heeft. Tekst aanpassen mag wel; die
 * wordt bij het posten bevroren op de regel zelf.
 */
export const REACTIONS: ReactionTemplate[] = [
  // --- Gratis, naar de vlucht (level 1) -------------------------------------
  { id: 'j_allez', text: 'Allez hop!', cat: 'juich', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'j_komkom', text: 'Kom, kom, kom…', cat: 'juich', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'j_vliegen', text: 'Vliegen!', cat: 'juich', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'j_gekunt', text: 'Ge kunt het!', cat: 'juich', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'j_doetgoed', text: "Dat doet 'em goed", cat: 'juich', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'j_chapeau', text: 'Chapeau.', cat: 'juich', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'j_verdiend', text: 'Verdiend.', cat: 'juich', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'j_klasse', text: 'Klasse.', cat: 'juich', channel: 'vlucht', minLevel: LVL.free, price: 0 },

  { id: 'b_schanduleus', text: 'Schanduleus!', cat: 'baal', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'b_omgekocht', text: 'Omgekochte boel!', cat: 'baal', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'b_onterecht', text: 'Onterecht!', cat: 'baal', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'b_kijkniet', text: 'Ik kijk niet meer.', cat: 'baal', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'b_tikker', text: 'Miljaar mijnen tikker.', cat: 'baal', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'b_nagelbijten', text: 'Nagelbijten.', cat: 'baal', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'b_amai', text: 'Amai.', cat: 'baal', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'b_zweet', text: 'Ik zweet.', cat: 'baal', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'b_pech', text: 'Dikke pech.', cat: 'baal', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'b_wind', text: "Da's de wind, hè.", cat: 'baal', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'b_volgende', text: 'Volgende keer beter.', cat: 'baal', channel: 'vlucht', minLevel: LVL.free, price: 0 },

  // --- Gratis, naar een speler (level 1) ------------------------------------
  { id: 's_goedgedaan', text: 'Goe gedaan, hè.', cat: 'sportief', channel: 'speler', minLevel: LVL.free, price: 0 },
  { id: 's_proficiat', text: 'Proficiat met uw duif.', cat: 'sportief', channel: 'speler', minLevel: LVL.free, price: 0 },
  { id: 's_respect', text: 'Respect.', cat: 'sportief', channel: 'speler', minLevel: LVL.free, price: 0 },
  { id: 's_straf', text: "Da's straf van u.", cat: 'sportief', channel: 'speler', minLevel: LVL.free, price: 0 },
  { id: 's_pakuk', text: 'Volgende keer pak ik u.', cat: 'sportief', channel: 'speler', minLevel: LVL.free, price: 0 },
  { id: 's_geluk', text: 'Ge hebt geluk gehad.', cat: 'sportief', channel: 'speler', minLevel: LVL.free, price: 0 },
  { id: 's_goedgevlogen', text: 'Goed gevlogen.', cat: 'sportief', channel: 'speler', minLevel: LVL.free, price: 0 },

  // --- Excuses: gratis, en over jezelf. Geen moderatie nodig, ooit. ---------
  { id: 'e_kweek', text: "'t Zit in de kweek.", cat: 'excuus', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'e_voer', text: "Da's het voer.", cat: 'excuus', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'e_getraind', text: "'k Heb ze te veel getraind.", cat: 'excuus', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'e_mand', text: 'De mand was slecht geladen.', cat: 'excuus', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'e_altijdwind', text: "'t Was de wind. Altijd de wind.", cat: 'excuus', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'e_mijnschuld', text: "Da's mijn schuld.", cat: 'excuus', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'e_verkoopalles', text: 'Ik verkoop alles.', cat: 'excuus', channel: 'vlucht', minLevel: LVL.free, price: 0 },
  { id: 'e_stoppen', text: 'Ik ga stoppen met melken.', cat: 'excuus', channel: 'vlucht', minLevel: LVL.free, price: 0 },

  // --- West-Vlaams (level 2, gratis) ---------------------------------------
  { id: 'w_mohow', text: 'Mo how zeh!', cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_kiek', text: 'Kiek e kier!', cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_awelmerci', text: 'Awel merci.', cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_oeioei', text: 'Oeioeioei.', cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_miljaarde', text: 'Miljaardedju!', cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_vandadde', text: "'t Es were van dadde.", cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_wukesda', text: 'Wuk es da nu?', cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_vliegtdeure', text: 'Vliegt deure!', cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_zedoet', text: "Ze doet 't! Ze doet 't!", cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_komwere', text: 'Kom were, sloeber.', cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_gedoan', text: "'k Peis da 't gedoan es.", cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_nerappe', text: "Da's ne rappe, zunne!", cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_nondedju', text: 'Nondedju toch.', cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },
  { id: 'w_mijnoren', text: 'Amai mijn oren.', cat: 'wvl', channel: 'vlucht', minLevel: LVL.wvl, price: 0 },

  // --- Complot (level 3, gratis): over de vlucht, niet over een persoon -----
  { id: 'c_windomgekocht', text: 'De wind is omgekocht.', cat: 'complot', channel: 'vlucht', minLevel: LVL.complot, price: 0 },
  { id: 'c_doorgestoken', text: 'Dees is doorgestoken kaart.', cat: 'complot', channel: 'vlucht', minLevel: LVL.complot, price: 0 },
  { id: 'c_tegenwind', text: 'Tegenwind op bestelling.', cat: 'complot', channel: 'vlucht', minLevel: LVL.complot, price: 0 },
  { id: 'c_juryslaapt', text: 'De jury slaapt. Zoals altijd.', cat: 'complot', channel: 'vlucht', minLevel: LVL.complot, price: 0 },
  { id: 'c_gesponsordpech', text: 'Deze vlucht is gesponsord door de pech.', cat: 'complot', channel: 'vlucht', minLevel: LVL.complot, price: 0 },
  // Badge-route: wie een weddenschap wint, mag over voorspellingen spotten.
  { id: 'c_droom', text: 'Ik heb de uitslag al gezien. In een droom. Het was slecht.', cat: 'complot', channel: 'vlucht', minLevel: LVL.complot, price: 0, badge: 'bet_win_1' },

  // --- Sneer (level 5, 100 munten) -----------------------------------------
  { id: 'n_schoonmoeder', text: 'Uw duif vliegt gelijk mijn schoonmoeder wandelt.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_steenveren', text: 'Is dat een duif of een steen met veren?', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_hokruikt', text: 'Uw hok ruikt naar verlies.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_trainen', text: 'Trainen is ook een optie, hè.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_postbode', text: 'Zijt gij melker of postbode?', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_wandeling', text: "Da's geen vlucht, da's een wandeling.", cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_frieten', text: 'Uw duif is gestopt voor frieten.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_wiki', text: 'Zoude gij de wiki niet eens lezen jong', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_niksknnen', text: 'Ge zijt goed bezig. Voor iemand die niks kan.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_meeuw', text: 'Uw duif heeft de weg gevraagd aan een meeuw.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_medelijden', text: 'Ik heb medelijden. Echt.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_sponsorkijkt', text: 'Uw sponsor kijkt mee, hè.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  // West-Vlaamse sneren, zelfde prijs en level.
  { id: 'n_wvl_traag', text: 'Ge zij te traag, jong.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_wvl_proficiat', text: 'Awel, proficiat zeker.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_wvl_sloeber', text: 'Uw duuf es ne sloeber.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_wvl_bakstien', text: 'Ze vliegt lik ne bakstien.', cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },
  { id: 'n_wvl_anbeginnen', text: "Ge moet er were an beginn'n.", cat: 'sneer', channel: 'speler', minLevel: LVL.sneer, price: REACTION_PRICES.sneer },

  // --- Scherp (level 7, 250 munten) ----------------------------------------
  // Startgeschenk: de meest absurde van de reeks, niet de venijnigste.
  { id: 'p_liften', text: 'Ik heb uw duif zien liften.', cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp, gift: true },
  { id: 'p_wachtkamer', text: "Uw hok is geen hok, da's een wachtkamer.", cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp, milestone: 3 },
  { id: 'p_stamboom', text: 'Uw stamboom is een waarschuwing.', cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp, milestone: 7 },
  // Badge-route: wie zelf een duif aan de sperwer verloor, mag over de kat spotten.
  { id: 'p_kat', text: 'Uw duiven zijn zo slecht dat zelfs de kat ze laat passeren.', cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp, badge: 'rip_sperwer' },
  { id: 'p_vluchtelingen', text: 'Die van u zijn geen raceduiven, dat zijn vluchtelingen zonder bestemming.', cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp },
  { id: 'p_midlife', text: 'Uw duiven hebben geen oriëntatie, die hebben een midlifecrisis.', cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp },
  { id: 'p_solliciteren', text: 'Ik heb uw duif zien solliciteren bij een ander hok.', cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp },
  { id: 'p_traagste', text: 'Uw beste duif is uw traagste probleem.', cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp },
  { id: 'p_liegniet', text: "Ik zou 'volgende keer beter' zeggen, maar ik lieg niet graag.", cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp },
  { id: 'p_misdaad', text: 'Uw kweek is een misdaad tegen de soort.', cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp },
  { id: 'p_zoalsverwacht', text: 'Ge hebt niet gefaald. Ge hebt gepresteerd zoals verwacht.', cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp },
  { id: 'p_beteropties', text: 'Uw duivin heeft betere opties overwogen.', cat: 'scherp', channel: 'speler', minLevel: LVL.scherp, price: REACTION_PRICES.scherp },

  // --- Zwart (level 9, 500 munten) -----------------------------------------
  { id: 'z_aardappel', text: "Zet er een aardappel bij, da's ook eten.", cat: 'zwart', channel: 'speler', minLevel: LVL.zwart, price: REACTION_PRICES.zwart, gift: true },
  { id: 'z_menu', text: 'Ik heb uw duif op het menu zien staan.', cat: 'zwart', channel: 'speler', minLevel: LVL.zwart, price: REACTION_PRICES.zwart, milestone: 5 },
  { id: 'z_overleefd', text: 'Uw duif heeft de vlucht overleefd. Helaas.', cat: 'zwart', channel: 'speler', minLevel: LVL.zwart, price: REACTION_PRICES.zwart, milestone: 9 },
  // Badge-routes: je verdient de grap door het moment zelf te beleven.
  { id: 'z_vlucht', text: 'Uw duif vliegt niet naar huis. Ze vlucht van u.', cat: 'zwart', channel: 'speler', minLevel: LVL.zwart, price: REACTION_PRICES.zwart, badge: 'galgenhumor' },
  { id: 'z_diepvries', text: 'Ik heb een plaatsje vrij in de diepvries.', cat: 'zwart', channel: 'speler', minLevel: LVL.zwart, price: REACTION_PRICES.zwart, badge: 'vredig' },
  // De scherpste twee blijven volledig achter level 9 + 500 munten.
  { id: 'z_bistro', text: 'Nog eentje voor de bistro. Vijftig munten, hè.', cat: 'zwart', channel: 'speler', minLevel: LVL.zwart, price: REACTION_PRICES.zwart },
  { id: 'z_hospice', text: "Uw hok is geen hok, da's een hospice.", cat: 'zwart', channel: 'speler', minLevel: LVL.zwart, price: REACTION_PRICES.zwart },
];

export const REACTION_MAP = new Map(REACTIONS.map((r) => [r.id, r]));

/**
 * Reacties die vrijkwamen doordat de speler van `before` naar `after` steeg.
 *
 * Een BEREIK en niet één level: XP komt soms in een klap binnen (een badge van
 * 100 op een bijna volle balk), en een sprong van twee levels mag de mijlpaal
 * ertussen niet stilzwijgend opslokken.
 *
 * Voedt de level-up-melding — "je hebt er iets bij" is een veel betere reden om
 * dat bericht te lezen dan het levelnummer op zich.
 */
export function reactionsUnlockedByLevels(before: number, after: number): ReactionTemplate[] {
  if (after <= before) return [];
  const gained = (lvl: number | undefined) => lvl != null && lvl > before && lvl <= after;
  return REACTIONS.filter(
    (t) => gained(t.milestone) || (t.price === 0 && !t.badge && !t.gift && gained(t.minLevel)),
  );
}

/** Reacties die een net verdiende badge cadeau doet, om dezelfde reden. */
export function reactionsUnlockedByBadge(badgeKey: string): ReactionTemplate[] {
  return REACTIONS.filter((t) => t.badge === badgeKey);
}
