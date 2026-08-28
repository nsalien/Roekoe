/**
 * Interactive guided tour. Walks the player through the real pages: each step
 * navigates to the right screen, spotlights the relevant element and shows a
 * short explanation anchored to it. Steps that target nothing show a centered
 * card. Robust: if a target isn't found it falls back to a centered card so the
 * tour never gets stuck.
 *
 * Shown once per player (localStorage, same pattern as the infirmary intro) and
 * replayable from the profile.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface Step {
  route?: string; // navigate here first
  selector?: string; // element to spotlight (via [data-tour="..."])
  title: string;
  body: ReactNode;
}

// --- Season / ranking / prizes steps (shared by the full tour and the
//     one-time "what's new" run below). ---
const SEASON_STEP: Step = {
  route: '/ranglijst', selector: '[data-tour="season"]',
  title: '📅 Seizoenen',
  body: 'Een seizoen duurt 4 weken (in echte tijd). Hier lees je in welke week je zit en hoe lang het seizoen nog duurt. Op het einde volgt de prijsuitreiking en start alles opnieuw — de ranglijst gaat terug op nul.',
};
const ROEKOE_STEP: Step = {
  route: '/ranglijst', selector: '[data-tour="ranking"]',
  title: '🏆 Ranglijst & de Roekoe',
  body: 'De hokken worden gerangschikt op seizoenspunten. De top 3 winnen op het einde de Gouden, Zilveren en Bronzen Roekoe (€2000 / €1500 / €1000). Ook de bots dingen mee.',
};
const VLEUGEL_STEP: Step = {
  route: '/ranglijst', selector: '[data-tour="pigeon-ranks"]',
  title: '🪽 Duivenranglijsten & de Vleugel',
  body: (
    <>
      Onder <strong>Duiven</strong> vind je drie ranglijsten: <strong>hoogste gemiddelde snelheid</strong>,
      <strong> meeste podiums</strong> en <strong>meeste vooruitgang</strong> dit seizoen. De top 3 van elke lijst
      winnen de Gouden, Zilveren en Bronzen Vleugel (€1000 / €750 / €500 voor de eigenaar).
    </>
  ),
};
// Leeftijdscriterium — shared by the full tour and the one-time news run below.
const AGE_CUP_STEP: Step = {
  route: '/ranglijst', selector: '[data-tour="age-cup"]',
  title: '🏆 Leeftijdscriterium',
  body: (
    <>
      Een tweede competitie, enkel voor duiven: <strong>vier leeftijdsklassen</strong> met elk één eigen vlucht per
      week. Deze stand loopt <strong>drie seizoenen</strong> door.
      <br />
      <span className="faint" style={{ display: 'inline-block', marginTop: 4 }}>Alles erover: 📖 Wiki.</span>
    </>
  ),
};
const PRIZES_STEP: Step = {
  route: '/prestaties', selector: '[data-tour="season-prizes"]',
  title: '🎖️ Je seizoensprijzen',
  body: 'Al je gewonnen Roekoes en Vleugels worden hier bewaard — met de tellingen goud/zilver/brons en een erelijst per seizoen.',
};
// Breed (ras) intro — shared by the full tour and the one-time news run below.
const BREED_STEP: Step = {
  route: '/hok', selector: '[data-tour="pigeon"]',
  title: '🕊️ Rassen',
  body: (
    <>
      Elke duif heeft een <strong>ras</strong>: dat bepaalt haar <strong>foto</strong> (klik op een duif om
      naam + zeldzaamheid te zien). Het ras is <strong>puur cosmetisch</strong> — het verandert <strong>niets</strong> aan
      de eigenschappen of prestaties — maar een <strong>zeldzamer ras maakt de duif een beetje meer waard</strong>.
      Nieuwe duiven krijgen willekeurig een ras: meestal een gewoon (Algemeen ~75%), soms een Ongewoon (~21%),
      zelden een <strong>Zeldzaam</strong> (Meulemans, ~2%) of <strong>Legendarisch</strong> (Bonte / Golden Ace, ~1%).
      <br />
      <span style={{ display: 'inline-block', marginTop: 4 }}>
        <strong>Kweek</strong> je twee duiven van hetzelfde ras, dan houdt het jong dat ras; twee verschillende rassen
        geven een <strong>Gemengd</strong> jong.
      </span>
    </>
  ),
};

// Genetics (genen) intro — shared by the full tour and the one-time news run.
const GENE_STEP: Step = {
  route: '/hok', selector: '[data-tour="pigeon"]',
  title: '🧬 Genen: elke duif heeft haar eigen plafond',
  body: (
    <>
      Elke duif heeft <strong>aangeboren maxima</strong> voor snelheid, conditie en oriëntatie —{' '}
      <strong>geen enkele haalt ooit 100</strong>. Het{' '}
      <span style={{ color: 'var(--bad)', fontWeight: 700 }}>rode streepje</span> op elke statbalk toont waar déze duif
      capt; <strong>klik erop</strong> voor de exacte waarde.
      <br />
      <span style={{ display: 'inline-block', marginTop: 4 }}>
        Groeien gaat in <strong>drie trappen</strong>: zelf <strong>trainen tot 80</strong>,{' '}
        <strong>vluchten tot 90</strong>, en enkel een <strong>privécoach</strong> duwt nog boven 90 (tot haar gen-cap).
        Hoe hoger de genen, hoe <strong>meer een duif waard</strong> is — en ze <strong>erven door</strong> bij kweek.
        Oudere duiven <strong>zwakken na hun piek geleidelijk af</strong>.
      </span>
    </>
  ),
};

const STEPS: Step[] = [
  {
    route: '/',
    title: '🕊️ Welkom bij Roekoe!',
    body: 'Ik neem je in een dik minuutje mee langs de belangrijkste schermen en toon telkens waar je iets doet. Tik op Volgende — sluiten mag altijd.',
  },
  {
    route: '/hok', selector: '[data-tour="pigeon"]',
    title: '📊 Je duiven & hun eigenschappen',
    body: (
      <>
        <ul style={{ margin: '2px 0 0', paddingLeft: 18, lineHeight: 1.4 }}>
          <li><strong>Snelheid</strong> — sprint; telt op korte vluchten.</li>
          <li><strong>Conditie</strong> — houdt de snelheid vast op lange vluchten.</li>
          <li><strong>Oriëntatie</strong> — navigatie; telt op lange vluchten.</li>
          <li><strong>⚡ Energie</strong> — "fut": daalt door vluchten, stijgt door eten.</li>
          <li><strong>Gezondheid</strong> — laag = niet vluchtklaar.</li>
          <li><strong>❤️ Libido</strong> — kweekdrift.</li>
          <li><strong>Ervaring</strong> — groeit door te vliegen, maakt beter.</li>
        </ul>
        <div style={{ marginTop: 6 }}>De <strong>▲/▼</strong> tonen wat je keuzes per dag doen.</div>
      </>
    ),
  },
  GENE_STEP,
  BREED_STEP,
  {
    route: '/', selector: '[data-tour="feed"]',
    title: '🛒 Eerst: voer kopen',
    body: 'Op het Overzicht koop je voer per type (de waarden staan per dag). Zorg dat je genoeg in voorraad hebt — een lege voorraad betekent honger.',
  },
  {
    route: '/hok', selector: '[data-tour="ration"]',
    title: '🍽 Daarna: voer toewijzen',
    body: 'Kies hier per duif welk voertype ze krijgt. Is de voorraad van dat type op, dan lijdt ze honger — haar eigenschappen dalen en ze kan zelfs sterven.',
  },
  {
    route: '/hok', selector: '[data-tour="ration"]',
    title: '🥣 Welk voer wanneer?',
    body: (
      <ul style={{ margin: '2px 0 0', paddingLeft: 18, lineHeight: 1.4 }}>
        <li><strong>Normaal</strong> — goedkoop; de dagelijkse basis als je op je budget let.</li>
        <li><strong>Premium</strong> — de beste allrounder: energie + gezondheid én wat conditie.</li>
        <li><strong>Libido-mix</strong> — geef je als je die duif wil laten <strong>broeden</strong> (tilt het libido op).</li>
        <li><strong>Herstel</strong> — snelste energie; ideaal om een uitgeputte duif weer <strong>vluchtklaar</strong> te krijgen.</li>
      </ul>
    ),
  },
  {
    route: '/hok', selector: '[data-tour="compartment"]',
    title: '🧱 Apart hok',
    body: 'Met deze knop zet je een duif in een apart hok: beter energieherstel en minder kans op ziekte. Je koopt aparte hokken bij Uitbreidingen.',
  },
  {
    route: '/hok', selector: '[data-tour="upgrades"]',
    title: '🏠 Hok uitbreiden',
    body: 'Hier vergroot je je hokcapaciteit (meer duiven) en koop je aparte hokken. Een duif verkopen doe je met de knop onderaan elke duif.',
  },
  {
    route: '/', selector: '[data-tour="missions"]',
    title: '🎯 Dagopdrachten & dilemma’s',
    body: 'Elke dag 3 opdrachten voor geld + XP, met een streakbonus. En let op: af en toe verschijnt zomaar een dilemma-pop-up met een keuze en gevolgen.',
  },
  {
    route: '/vluchten', selector: '[data-tour="flights"]',
    title: '🏁 Vluchten, competitie & weddenschappen',
    body: 'Schrijf duiven in en volg ze live. Goede aankomsten geven punten + prijzengeld. Elke middag om 12u is er ook een gratis oefenvlucht: die kost amper energie en bouwt vooral conditie & oriëntatie op — ideaal voor futloze duiven. Tot 12u voor de start van een wedstrijd kan je een weddenschap plaatsen.',
  },
  {
    route: '/hok',
    title: '🛌 Rustkuur',
    body: 'Zit een duif zonder energie? Geef haar via haar duifpagina een betaalde rustkuur: één dag verplicht rusten voor €300, en daarna krijgt ze er +40 energie bij. Let op: maar één rustkuur per week (voor één duif).',
  },
  {
    route: '/markt', selector: '[data-tour="market"]',
    title: '🛒 Markt & veilingen',
    body: 'Koop duiven van anderen of bied op veilingen — elke zondag een topper, en soms goedkope opvangcentrum-duiven. Word je overboden, dan krijg je een melding.',
  },
  {
    route: '/markt', selector: '[data-tour="market-bid"]',
    title: '🕊️ Bied op andermans duiven',
    body: (
      <>
        Je kan nu ook een <strong>bod</strong> doen op een duif die <strong>niet te koop</strong> staat.
        Kies eerst een <strong>speler</strong>, dan een van zijn <strong>duiven</strong> en bepaal je <strong>bedrag</strong>.
        Van andermans duiven zie je enkel de <strong>algemene score (★ talent)</strong> — de precieze eigenschappen blijven
        geheim, dus vorm je een idee via de <strong>duivenranglijst</strong> of vluchtresultaten. Je bod blijft geldig tot de
        eigenaar het aanvaardt of weigert (je ziet dat bij de Markt, niet via de bel); je kan het altijd zelf intrekken.
      </>
    ),
  },
  {
    route: '/kweek', selector: '[data-tour="breed"]',
    title: '🥚 Kweken',
    body: 'Koppel een doffer + duivin (beide energie ≥ 20). Hoe hoger hun energie én libido, hoe sneller een jong komt. Zorg voor vrije plaats in je hok.',
  },
  {
    route: '/ziekenboeg', selector: '[data-tour="infirmary"]',
    title: '🏥 Ziekenboeg',
    body: 'Zet zieke of gekwetste duiven hier: geïsoleerd en sneller herstel. Huur een dokter (ziekte) of kinesist (kwetsuur) en zet medicatievoer aan.',
  },
  {
    route: '/sponsors', selector: '[data-tour="sponsors"]',
    title: '🤝 Sponsors',
    body: 'Presteer goed en bedrijven bieden zich aan: tekengeld, een weekbijdrage en een bonus per overwinning. Eén sponsor per categorie.',
  },
  SEASON_STEP,
  ROEKOE_STEP,
  VLEUGEL_STEP,
  AGE_CUP_STEP,
  {
    route: '/prestaties', selector: '[data-tour="prestige"]',
    title: '🎖️ Prestige',
    body: 'Verzamel badges en XP (levels) en bekijk je prijzenkast met medailles.',
  },
  PRIZES_STEP,
  {
    route: '/profiel', selector: '[data-tour="profile"]',
    title: '👤 Profiel',
    body: 'Hier pas je je hoknaam en thema (licht/donker) aan — en kan je deze rondleiding altijd opnieuw starten. Veel vliegplezier! 🕊️',
  },
];

/**
 * A short, one-time "what's new" run reusing the same spotlight mechanism as the
 * full tour. Shown once to every player when big features land; the same steps
 * are also part of the full tour (replayable from the profile).
 */
export const SEASON_NEWS_STEPS: Step[] = [
  {
    route: '/',
    title: '✨ Nieuw in Roekoe!',
    body: 'Er is wat veranderd: echte seizoenen, een vernieuwde ranglijst en nieuwe seizoenstrofeeën — de Roekoe en de Vleugel. Ik loods je er even door. Je kan deze rondleiding later altijd opnieuw starten via je profiel.',
  },
  SEASON_STEP,
  ROEKOE_STEP,
  VLEUGEL_STEP,
  PRIZES_STEP,
];

/**
 * One-time "what's new" run for the private-bids feature: bid on any player's
 * pigeon (also ones that aren't for sale) with hidden attributes.
 */
export const BID_NEWS_STEPS: Step[] = [
  {
    route: '/',
    title: '✨ Nieuw: bieden op andermans duiven',
    body: 'Je kan nu een bod uitbrengen op de duif van een andere speler — ook als die niet te koop staat. Even kort wat er verandert. Je kan deze rondleiding later altijd opnieuw starten via je profiel.',
  },
  {
    route: '/markt', selector: '[data-tour="market-bid"]',
    title: '🕊️ Zo doe je een bod',
    body: (
      <>
        Op de <strong>Markt</strong> kies je eerst een <strong>speler</strong>, dan een van zijn <strong>duiven</strong> en
        bepaal je je <strong>bedrag</strong>. Je bod blijft geldig tot de eigenaar het aanvaardt of weigert; je kan het
        altijd zelf intrekken. Ook op de duifpagina zelf staat een knop <strong>“Bied op deze duif”</strong>.
      </>
    ),
  },
  {
    route: '/markt', selector: '[data-tour="market-bid"]',
    title: '🔒 Je koopt (deels) blind',
    body: (
      <>
        Van andermans duiven zie je enkel de <strong>algemene score (★ talent)</strong> — de precieze snelheid, conditie,
        oriëntatie enz. blijven <strong>geheim</strong>. Je weet dus niet exact wat je koopt, maar je kan een idee vormen via
        de <strong>duivenranglijst</strong> en de <strong>resultaten van specifieke vluchten</strong>.
      </>
    ),
  },
  {
    route: '/markt', selector: '[data-tour="market"]',
    title: '🔔 Biedingen op jóuw duiven',
    body: 'Krijg je een bod, dan zie je dat bovenaan de Markt (met een teller bij het Markt-menu, los van de belmeldingen) en kies je zelf: aanvaarden of weigeren.',
  },
];

/**
 * One-time "what's new" run for pigeon breeds (rassen): every bird now has a
 * breed that sets its photo + rarity (cosmetic; rarer = a bit more valuable).
 */
export const BREED_NEWS_STEPS: Step[] = [
  {
    route: '/',
    title: '✨ Nieuw: duivenrassen!',
    body: 'Al je duiven hebben nu een echt ras — met een eigen foto en een zeldzaamheid. Even kort wat dat betekent. Je kan deze rondleiding later altijd opnieuw starten via je profiel.',
  },
  BREED_STEP,
  {
    route: '/hok', selector: '[data-tour="pigeon"]',
    title: '⭐ Zeldzaamheid & waarde',
    body: (
      <>
        Rassen gaan van <strong>Algemeen</strong> over <strong>Ongewoon</strong> en <strong>Zeldzaam</strong> tot
        <strong> Legendarisch</strong>. Hoe zeldzamer, hoe minder vaak zo'n duif voorkomt — en hoe wat
        <strong> duurder</strong> ze is (Ongewoon +8%, Zeldzaam +20%, Legendarisch +40%). <strong>Belangrijk:</strong> het
        ras verandert <strong>niets</strong> aan de snelheid, conditie of andere eigenschappen — het is puur voor de foto,
        de verzameldrang en de marktwaarde. De <strong>Golden Ace</strong> en de <strong>Bonte</strong> zijn de
        allerzeldzaamste (elk ~0,8% kans).
      </>
    ),
  },
];

/**
 * One-time "what's new" run for saying farewell to a pigeon: release it for
 * free, or sell it to the local pigeon-soup restaurant for a fixed sum (which
 * dents the whole loft's morale).
 */
export const FAREWELL_NEWS_STEPS: Step[] = [
  {
    route: '/',
    title: '✨ Nieuw: afscheid nemen van een duif',
    body: 'Je kan een duif waar je van af wil nu vrijlaten, óf verkopen aan het lokale duivenrestaurant. Even kort wat dat betekent. Je kan deze rondleiding later altijd opnieuw starten via je profiel.',
  },
  {
    route: '/hok', selector: '[data-tour="pigeon"]',
    title: '👋 Twee manieren om afscheid te nemen',
    body: (
      <>
        Klik een duif aan om haar pagina te openen — onderaan vind je <strong>“Afscheid nemen”</strong>:
        <br />
        <strong>🕊️ Vrijlaten</strong> — je bent van de duif af, maar krijgt er <strong>geen geld</strong> voor terug.
        <br />
        <strong>🍲 Verkopen aan Bistro De Laatste Vlucht</strong> — er wordt <strong>duivensoep</strong> van gemaakt en
        je krijgt een <strong>vast bedrag van €50</strong>.
      </>
    ),
  },
  {
    route: '/hok', selector: '[data-tour="pigeon"]',
    title: '💔 De soep drukt de moraal',
    body: (
      <>
        Een duif naar de soep sturen valt <strong>zwaar bij de rest van je hok</strong>: elke andere duif verliest
        <strong> 1 tot 5 energie</strong> (willekeurig per duif). Doe het dus liever niet vlak voor een belangrijke
        vlucht. Wil je enkel plaats maken zonder bijwerkingen, kies dan <strong>vrijlaten</strong>.
      </>
    ),
  },
];

/**
 * One-time "what's new" run for the GENETICS update: per-bird caps, the three
 * growth tiers, level-scaled training cost, and ageing. Uses a fresh localStorage
 * key (see Layout). Shown once, after the main tour, to existing players.
 */
export const GENES_NEWS_STEPS: Step[] = [
  {
    route: '/',
    title: '✨ Nieuw: genen, plafonds & veroudering',
    body: 'Duiven hebben nu aangeboren maxima per vaardigheid, groeien in drie trappen en verouderen echt. Even kort wat dat betekent — je kan deze rondleiding later altijd opnieuw starten via je profiel.',
  },
  GENE_STEP,
  {
    route: '/hok', selector: '[data-tour="pigeon"]',
    title: '💰 Trainen wordt duurder op hoog niveau',
    body: (
      <>
        Handmatig trainen kan nog steeds — maar <strong>enkel tot 80</strong>, en de <strong>kost stijgt
        exponentieel</strong> met het niveau (50→51 is spotgoedkoop, 79→80 een echte investering). Daarboven groeit een
        duif door te <strong>vliegen</strong> (tot 90) en met een <strong>privécoach</strong>. Die coach werkt op{' '}
        <strong>elk niveau</strong> richting de gen-cap (met kleiner wordende winst), en is de <strong>enige weg boven
        90</strong>.
      </>
    ),
  },
  {
    route: '/hok', selector: '[data-tour="pigeon"]',
    title: '📉 Duiven verouderen',
    body: (
      <>
        Na haar piek (rond ~4 duivenjaar) <strong>zwakt een duif geleidelijk af</strong> in snelheid, conditie en
        oriëntatie — bij de ene sneller dan de andere. Zet je toppers dus tijdig in, en <strong>kweek</strong> met je
        best gegende duiven: hoge plafonds <strong>erven door</strong> (en maken een duif <strong>meer waard</strong>).
      </>
    ),
  },
];

/** One-time announcement of the estafettevlucht (see Layout's news key). */
export const RELAY_NEWS_STEPS: Step[] = [
  {
    route: '/',
    title: '🔗 Nieuw: de estafettevlucht',
    body: 'De zaterdagwedstrijd wisselt vanaf nu week na week: de ene week de titanenwedstrijd, de andere week een gloednieuwe estafettevlucht. Even kort wat dat inhoudt — je kan deze rondleiding later altijd opnieuw starten via je profiel.',
  },
  {
    route: '/vluchten', selector: '[data-tour="flights"]',
    title: '🔗 Eén ploeg, drie duiven, ~900 km',
    body: (
      <>
        Je schrijft <strong>één ploeg van 3 duiven</strong> in. Ze vliegen de route in{' '}
        <strong>drie exact gelijke etappes</strong> van ± 300 km en lossen elkaar af op de wisselpunten — er is dus altijd
        maar <strong>één duif tegelijk</strong> in de lucht. Elke duif betaalt enkel de energie van haar eigen etappe.
        <br />
        <span style={{ display: 'inline-block', marginTop: 4 }}>
          Opgelet: <strong>geeft één duif er de brui aan, dan ligt de hele ploeg eruit</strong>.
        </span>
      </>
    ),
  },
  {
    route: '/vluchten', selector: '[data-tour="flights"]',
    title: '🌬️ Kies zelf wie welke etappe vliegt',
    body: (
      <>
        Bij elke etappe staat het <strong>weerbericht</strong>, dagen op voorhand. Omdat de etappes even lang zijn, is dát
        het enige wat je volgorde uitmaakt — zet je <strong>sterkste duif op de zwaarste etappe</strong>. Je mag wisselen
        tot de vlucht start.
        <br />
        <span style={{ display: 'inline-block', marginTop: 4 }}>
          Er valt enkel <strong>geld</strong> te winnen (€3000 voor de winnende ploeg, tot de 5e plaats), geen
          seizoenspunten — maar de snelheid van je duiven telt wél mee voor de duivenranglijsten.
        </span>
      </>
    ),
  },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function Tour({ onClose, steps = STEPS }: { onClose: () => void; steps?: Step[] }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];

  // Navigate to the step's page.
  useEffect(() => {
    if (step.route && loc.pathname !== step.route) nav(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Find + measure the target element (polling until it mounts after nav).
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    setRect(null);
    const sel = step.selector;
    if (!sel) return; // centered step
    function measure() {
      if (cancelled) return;
      const el = document.querySelector(sel!) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        window.setTimeout(() => { if (!cancelled) setRect(el.getBoundingClientRect()); }, 320);
      } else if (tries++ < 40) {
        window.setTimeout(measure, 120);
      } else {
        setRect(null); // give up → centered fallback
      }
    }
    const t = window.setTimeout(measure, 120);
    return () => { cancelled = true; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Keep the spotlight aligned on resize/scroll.
  useEffect(() => {
    const sel = step.selector;
    if (!sel) return;
    function update() {
      const el = document.querySelector(sel!) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    }
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  const first = i === 0;
  const last = i === steps.length - 1;

  // Tooltip placement: below the target if there's room, else above; centered
  // when there is no target.
  //
  // The card MUST also get a maxHeight that matches where it lands. It used to
  // carry a flat `calc(100vh - 24px)`, which is only right for a centered card:
  // anchored under a target it simply ran past the bottom of the screen, so the
  // Vorige/Volgende buttons sat off-screen and its own scrollbar could not reach
  // them. A step with a paragraph too many was then a dead end.
  const MARGIN = 12;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 360;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 640;
  const popW = Math.min(340, vw - 24);
  let popStyle: CSSProperties;
  if (rect) {
    const left = clamp(rect.left + rect.width / 2 - popW / 2, MARGIN, vw - popW - MARGIN);
    const below = vh - rect.bottom - MARGIN * 2;
    const above = rect.top - MARGIN * 2;
    if (Math.max(below, above) < 180) {
      // Target sits mid-screen on a short viewport: neither side can hold a
      // readable card, so centre it over the spotlight rather than clip it.
      popStyle = { left, top: '50%', transform: 'translateY(-50%)', maxHeight: vh - MARGIN * 2 };
    } else if (below >= above) {
      popStyle = { left, top: rect.bottom + MARGIN, maxHeight: below };
    } else {
      popStyle = { left, bottom: vh - rect.top + MARGIN, maxHeight: above };
    }
  } else {
    popStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', maxHeight: vh - MARGIN * 2 };
  }

  return (
    <>
      {rect ? (
        <>
          {/* Transparent click/scroll blocker so the highlighted element stays put. */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
          {/* Spotlight ring: the big box-shadow dims everything except the hole. */}
          <div
            style={{
              position: 'fixed',
              left: rect.left - 6, top: rect.top - 6,
              width: rect.width + 12, height: rect.height + 12,
              borderRadius: 12, border: '2px solid var(--brand)',
              boxShadow: '0 0 0 9999px rgba(8, 12, 22, 0.66)',
              zIndex: 91, pointerEvents: 'none', transition: 'all 0.2s ease',
            }}
          />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(8, 12, 22, 0.66)' }} />
      )}

      <div
        style={{
          position: 'fixed', width: popW, maxWidth: 'calc(100vw - 24px)', zIndex: 92,
          overflowY: 'auto', // maxHeight comes from popStyle: it depends on where the card lands
          overscrollBehavior: 'contain',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-lg)', padding: 16,
          ...popStyle,
        }}
      >
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span className="faint" style={{ fontSize: '0.78rem' }}>Rondleiding · {i + 1}/{steps.length}</span>
          <button className="btn ghost sm" onClick={onClose}>Sluiten ✕</button>
        </div>
        <h2 style={{ margin: '6px 0 5px', fontSize: '1.12rem' }}>{step.title}</h2>
        <div style={{ fontSize: '0.9rem', lineHeight: 1.45 }}>{step.body}</div>

        <div className="row" style={{ gap: 4, justifyContent: 'center', margin: '12px 0 10px', flexWrap: 'wrap' }}>
          {steps.map((_, idx) => (
            <span
              key={idx}
              onClick={() => setI(idx)}
              style={{
                width: 6, height: 6, borderRadius: 999, cursor: 'pointer',
                background: idx === i ? 'var(--brand)' : 'var(--surface-3)',
              }}
            />
          ))}
        </div>

        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <button className="btn ghost sm" disabled={first} onClick={() => setI((n) => n - 1)}>‹ Vorige</button>
          {last ? (
            <button className="btn accent sm" onClick={onClose}>Klaar! 🎉</button>
          ) : (
            <button className="btn accent sm" onClick={() => setI((n) => n + 1)}>Volgende ›</button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * One-time "what's new" run for the REST-CURE update: every bird may take a cure
 * (one a week each), it now restores gezondheid as well as energie, and it runs
 * two days instead of one. Uses a fresh localStorage key (see Layout).
 */
export const REST_CURE_NEWS_STEPS: Step[] = [
  {
    route: '/',
    title: '🛌 Nieuw: de rustkuur is vernieuwd',
    body: 'De rustkuur was vroeger beperkt tot één duif per hok per week. Dat is voorbij — en ze levert nu ook gezondheid op. Even kort wat er verandert. Je kan deze rondleiding later altijd opnieuw starten via je profiel.',
  },
  {
    route: '/hok', selector: '[data-tour="pigeon"]',
    title: '🛌 Elke duif mag op kuur',
    body: (
      <>
        Je kan voortaan <strong>al je duiven</strong> op rustkuur sturen, ook meerdere tegelijk — maar
        <strong> elke duif maar één keer per week</strong>. De prijs blijft <strong>€300</strong>.
        <br />
        <span style={{ display: 'inline-block', marginTop: 4 }}>
          Ze levert nu <strong>+40 energie én +15 gezondheid</strong> op, in plaats van enkel energie. Wel duurt
          een kuur voortaan <strong>2 dagen in plaats van 1</strong>, en zolang kan die duif niet vliegen,
          trainen of koppelen.
        </span>
      </>
    ),
  },
  {
    route: '/hok', selector: '[data-tour="pigeon"]',
    title: '💚 Waarom gezondheid er nu toe doet',
    body: (
      <>
        De kans dat een duif geblesseerd raakt of ziek wordt, hangt vanaf nu af van haar{' '}
        <strong>vluchtvorm</strong> — energie én gezondheid samen, waarbij de laagste van de twee dubbel telt.
        Je ziet ze als een <strong>🟢/🟡/🔴-stip</strong> op de duifpagina en bij het inschrijven.
        <br />
        <span style={{ display: 'inline-block', marginTop: 4 }}>
          Een rustkuur is dus de <strong>snelste weg terug naar groen</strong> voor een duif die je hard hebt
          gereden. Alle details staan in de <strong>📖 Wiki</strong>.
        </span>
      </>
    ),
  },
];

/**
 * The leeftijdscriterium: four age brackets, one race each per week, standings
 * that run for three seasons. Three steps — what it is, how you enter, and why
 * the horizon is longer than a season.
 */
export const AGE_CUP_NEWS_STEPS: Step[] = [
  {
    route: '/',
    title: '🏆 Nieuw: het leeftijdscriterium',
    body: 'Een tweede competitie, enkel voor duiven: vier leeftijdsklassen die elk hun eigen wekelijkse vlucht krijgen.',
  },
  {
    route: '/vluchten', selector: '[data-tour="flights"]',
    title: '🐣 Vier klassen, elk hun eigen vlucht',
    body: (
      <>
        Elke week vier extra vluchten om <strong>06:00</strong> — ma <strong>&lt; 1 j</strong>, wo{' '}
        <strong>1–2 j</strong>, do <strong>2–3 j</strong>, vr <strong>3 j +</strong> — met enkel duiven van die
        leeftijd. Inschrijven kost <strong>€20</strong>, zoveel duiven als je wil.
      </>
    ),
  },
  {
    route: '/ranglijst', selector: '[data-tour="age-cup"]',
    title: '⏳ De stand loopt drie seizoenen',
    body: (
      <>
        Daarna wint de top 3 van elke klasse geld én een <strong>titel op de duif</strong>. Geen seizoenspunten: je
        Roekoe-ranglijst beweegt er niet door.
        <br />
        <span className="faint" style={{ display: 'inline-block', marginTop: 4 }}>
          Klassen, prijzen en tactiek: 📖 Wiki → Leeftijdscriterium.
        </span>
      </>
    ),
  },
];
