/**
 * One-time welcome tour. Shown once per player (remembered in localStorage,
 * per user + browser — same pattern as the infirmary intro), and replayable
 * from the profile. A concise run through everything that is easy to miss.
 */

import { useState, type ReactNode } from 'react';

interface Step {
  icon: string;
  title: string;
  body: ReactNode;
}

const STEPS: Step[] = [
  {
    icon: '🕊️',
    title: 'Welkom bij Roekoe!',
    body: (
      <>
        Je runt een duivenhok: <strong>verzorgen → trainen → vluchten → geld & punten
        verdienen → kopen/kweken/uitbreiden</strong>. Alles loopt in <strong>echte tijd</strong>,
        tegen je vrienden en enkele bots. Deze korte rondleiding toont alles wat je moet
        weten — je kan ze altijd sluiten en later opnieuw starten via je profiel.
      </>
    ),
  },
  {
    icon: '📊',
    title: 'Eigenschappen van je duiven',
    body: (
      <ul className="intro-list">
        <li><strong>Snelheid</strong> — telt vooral op korte vluchten.</li>
        <li><strong>Conditie</strong> — houdt de snelheid vast op lange vluchten; tilt gezondheid & libido op.</li>
        <li><strong>Oriëntatie</strong> — navigatie, telt zwaarder op lange vluchten.</li>
        <li><strong>⚡ Energie</strong> — "fut": daalt door vluchten, stijgt door eten & rust. Laag = slechte prestaties, meer ziekte.</li>
        <li><strong>Gezondheid</strong>, <strong>❤️ Libido</strong> (kweken) en <strong>Ervaring</strong> (groeit door te vliegen).</li>
      </ul>
    ),
  },
  {
    icon: '🍽',
    title: 'Eten kopen én per duif toewijzen',
    body: (
      <>
        Op het <strong>Overzicht</strong> koop je voer per type (Normaal, Premium,
        Libido-mix, Herstel) — de waarden staan per dag. <strong>Elke duif eet van háár
        eigen type:</strong> stel dat per duif in bij <strong>Mijn hok</strong> of op de
        duifpagina via de voerkeuze-lijst. In Mijn hok zie je bij elke eigenschap een
        <strong> ▲/▼ per dag</strong>: wat je keuze doet. ⚠️ Geen voorraad = <strong>honger</strong>:
        de eigenschappen dalen en de duif kan uiteindelijk sterven. Koop dus tijdig bij.
      </>
    ),
  },
  {
    icon: '🏁',
    title: 'Vluchten & competitie',
    body: (
      <>
        Elke dag zijn er twee vluchten (10u lang, 17u kort). Schrijf duiven in bij
        <strong> Vluchten</strong> (tegen inschrijfgeld) en volg ze <strong>live</strong>.
        Wie goed aankomt verdient <strong>punten</strong> (seizoensranking) en
        <strong> prijzengeld</strong>. Energie loopt geleidelijk leeg tijdens de race; te
        weinig energie = kans om <strong>niet thuis te raken (DNF)</strong>. Je kan een duif
        tijdens de race laten <strong>opgeven</strong> om haar krachten te sparen.
      </>
    ),
  },
  {
    icon: '🎲',
    title: 'Weddenschappen',
    body: (
      <>
        Op de vluchtpagina kan je — tot <strong>12u voor de start</strong> — inzetten op
        de uitkomst (winnaar, laatste, jouw top-3, en meer). <strong>Eén weddenschap per
        vlucht</strong>; de quotering komt uit een eerlijke simulatie van de race.
      </>
    ),
  },
  {
    icon: '🏥',
    title: 'Ziekte, kwetsuur & de ziekenboeg',
    body: (
      <>
        Duiven kunnen <strong>ziek</strong> worden of <strong>gekwetst</strong> raken
        (vooral na zware vluchten). Zet zo'n duif in de <strong>Ziekenboeg</strong>: daar
        is ze geïsoleerd en herstelt ze sneller. Huur een <strong>dokter</strong> (ziekte)
        of <strong>kinesist</strong> (kwetsuur) en zet <strong>medicatievoer</strong> aan
        voor beter herstel. Een <strong>apart hok</strong> verlaagt de kans op ziekte.
      </>
    ),
  },
  {
    icon: '🏠',
    title: 'Hok uitbreiden & aparte hokken',
    body: (
      <>
        Je start met plaats voor <strong>8 duiven</strong>. Bij <strong>Mijn hok →
        Uitbreidingen</strong> koop je meer capaciteit én <strong>aparte hokken</strong>.
        Wijs een duif een apart hok toe met de knop <strong>🧱 Apart / Samen</strong> bij
        die duif — dat geeft beter energieherstel en minder ziekte.
      </>
    ),
  },
  {
    icon: '🥚',
    title: 'Kweken — waarop letten',
    body: (
      <>
        Bij <strong>Kweek</strong> koppel je een doffer + een duivin (beide energie
        <strong> ≥ 20</strong>). Hoe hoger hun <strong>energie én libido</strong>, hoe
        sneller een jong uitkomt — het gebeurt in echte tijd, zonder vaste timer. Zorg voor
        <strong> vrije hokruimte</strong>: een jong komt alleen als er plaats is.
      </>
    ),
  },
  {
    icon: '🛒',
    title: 'Markt: kopen, verkopen & veilingen',
    body: (
      <>
        Op de <strong>Markt</strong> koop je duiven van andere spelers (vaste prijs) en
        zie je <strong>veilingen</strong>: elke zondag een topduif, en op willekeurige
        momenten <strong>opvangcentrum-duiven</strong> (goedkoop en matig, maar trainbaar!).
        Word je overboden, dan krijg je een <strong>melding</strong> om terug te bieden.
        Je eigen duiven verkoop je via <strong>Mijn hok → Verkoop</strong>.
      </>
    ),
  },
  {
    icon: '🎯',
    title: 'Dagopdrachten & dilemma’s',
    body: (
      <>
        Elke dag krijg je op het Overzicht drie <strong>dagopdrachten</strong> voor geld +
        XP, met een <strong>streakbonus</strong> als je blijft opdagen. En let op: af en toe
        verschijnt er zomaar een <strong>dilemma</strong> (pop-up) — een gladde koopman, een
        hittegolf, een kwakzalver… — met een keuze en echte gevolgen.
      </>
    ),
  },
  {
    icon: '🤝',
    title: 'Sponsors',
    body: (
      <>
        Presteer goed en bedrijven <strong>bieden zichzelf aan</strong> (melding +
        Sponsorpagina). Aanvaarden geeft <strong>tekengeld</strong>, een <strong>weekbijdrage</strong>
        en een <strong>bonus per overwinning</strong>. Je kan meerdere sponsors hebben, maar
        maar <strong>één per categorie</strong>.
      </>
    ),
  },
  {
    icon: '🎖️',
    title: 'Prestige & je profiel',
    body: (
      <>
        Bij <strong>Prestaties</strong> verzamel je <strong>badges</strong> en XP (levels)
        en staat je <strong>prijzenkast</strong> met medailles. In <strong>Profiel</strong>
        pas je je <strong>hoknaam</strong> aan, kies je een <strong>licht of donker thema</strong>,
        en kan je <strong>deze rondleiding opnieuw starten</strong>. Veel vliegplezier! 🕊️
      </>
    ),
  },
];

export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const first = i === 0;
  const last = i === STEPS.length - 1;

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span className="faint" style={{ fontSize: '0.8rem' }}>Rondleiding · {i + 1}/{STEPS.length}</span>
          <button className="btn ghost sm" onClick={onClose}>Sluiten ✕</button>
        </div>

        <h2 style={{ margin: '8px 0 6px' }}>{step.icon} {step.title}</h2>
        <div style={{ fontSize: '0.92rem', lineHeight: 1.5 }}>{step.body}</div>

        {/* Progress dots */}
        <div className="row" style={{ gap: 5, justifyContent: 'center', margin: '14px 0 12px', flexWrap: 'wrap' }}>
          {STEPS.map((_, idx) => (
            <span
              key={idx}
              onClick={() => setI(idx)}
              style={{
                width: 7, height: 7, borderRadius: 999, cursor: 'pointer',
                background: idx === i ? 'var(--brand)' : 'var(--surface-3)',
              }}
            />
          ))}
        </div>

        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <button className="btn ghost" disabled={first} onClick={() => setI((n) => n - 1)}>‹ Vorige</button>
          {last ? (
            <button className="btn accent" onClick={onClose}>Klaar! 🎉</button>
          ) : (
            <button className="btn accent" onClick={() => setI((n) => n + 1)}>Volgende ›</button>
          )}
        </div>
      </div>
    </div>
  );
}
