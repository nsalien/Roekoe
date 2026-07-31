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
    body: 'Schrijf duiven in (2 vluchten per dag) en volg ze live. Goede aankomsten geven punten + prijzengeld. Tot 12u voor de start kan je hier ook een weddenschap plaatsen.',
  },
  {
    route: '/markt', selector: '[data-tour="market"]',
    title: '🛒 Markt & veilingen',
    body: 'Koop duiven van anderen of bied op veilingen — elke zondag een topper, en soms goedkope opvangcentrum-duiven. Word je overboden, dan krijg je een melding.',
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
  {
    route: '/prestaties', selector: '[data-tour="prestige"]',
    title: '🎖️ Prestige',
    body: 'Verzamel badges en XP (levels) en bekijk je prijzenkast met medailles.',
  },
  {
    route: '/profiel', selector: '[data-tour="profile"]',
    title: '👤 Profiel',
    body: 'Hier pas je je hoknaam en thema (licht/donker) aan — en kan je deze rondleiding altijd opnieuw starten. Veel vliegplezier! 🕊️',
  },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function Tour({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];

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
  const last = i === STEPS.length - 1;

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
          <span className="faint" style={{ fontSize: '0.78rem' }}>Rondleiding · {i + 1}/{STEPS.length}</span>
          <button className="btn ghost sm" onClick={onClose}>Sluiten ✕</button>
        </div>
        <h2 style={{ margin: '6px 0 5px', fontSize: '1.12rem' }}>{step.title}</h2>
        <div style={{ fontSize: '0.9rem', lineHeight: 1.45 }}>{step.body}</div>

        <div className="row" style={{ gap: 4, justifyContent: 'center', margin: '12px 0 10px', flexWrap: 'wrap' }}>
          {STEPS.map((_, idx) => (
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
