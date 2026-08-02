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
      Onder <strong>Duiven</strong> vind je drie ranglijsten: <strong>snelste</strong> pieksnelheid,
      <strong> meeste podiums</strong> en <strong>meeste vooruitgang</strong> dit seizoen. De top 3 van elke lijst
      winnen de Gouden, Zilveren en Bronzen Vleugel (€1000 / €750 / €500 voor de eigenaar).
    </>
  ),
};
const PRIZES_STEP: Step = {
  route: '/prestaties', selector: '[data-tour="season-prizes"]',
  title: '🎖️ Je seizoensprijzen',
  body: 'Al je gewonnen Roekoes en Vleugels worden hier bewaard — met de tellingen goud/zilver/brons en een erelijst per seizoen.',
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
  const vw = typeof window !== 'undefined' ? window.innerWidth : 360;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 640;
  const popW = Math.min(340, vw - 24);
  let popStyle: CSSProperties;
  if (rect) {
    const left = clamp(rect.left + rect.width / 2 - popW / 2, 12, vw - popW - 12);
    const spaceBelow = vh - rect.bottom;
    if (spaceBelow > 210) {
      popStyle = { left, top: rect.bottom + 12 };
    } else {
      popStyle = { left, bottom: vh - rect.top + 12 };
    }
  } else {
    popStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
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
          maxHeight: 'calc(100vh - 24px)', overflowY: 'auto',
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
