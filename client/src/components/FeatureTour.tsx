/**
 * One-time "what's new" announcement — a short sequence of centered cards shown
 * once per player (localStorage), separate from the main welcome Tour so it also
 * reaches players who already finished that tour. Same visual style as the Tour
 * popup, but centered and without page navigation/spotlight (robust: it never
 * depends on a specific element being on screen).
 */

import { useState, type ReactNode } from 'react';

export interface FeatureStep {
  title: string;
  body: ReactNode;
}

export function FeatureTour({ steps, onClose }: { steps: FeatureStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = steps[i];
  const first = i === 0;
  const last = i === steps.length - 1;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 360;
  const popW = Math.min(340, vw - 24);

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(8, 12, 22, 0.66)' }} />
      <div
        style={{
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: popW, maxWidth: 'calc(100vw - 24px)', zIndex: 92,
          maxHeight: 'calc(100vh - 24px)', overflowY: 'auto',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-lg)', padding: 16,
        }}
      >
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span className="faint" style={{ fontSize: '0.78rem' }}>Nieuw · {i + 1}/{steps.length}</span>
          <button className="btn ghost sm" onClick={onClose}>Sluiten ✕</button>
        </div>
        <h2 style={{ margin: '6px 0 5px', fontSize: '1.12rem' }}>{step.title}</h2>
        <div style={{ fontSize: '0.9rem', lineHeight: 1.45 }}>{step.body}</div>

        {steps.length > 1 && (
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
        )}

        <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginTop: steps.length > 1 ? 0 : 12 }}>
          <button className="btn ghost sm" disabled={first} onClick={() => setI((n) => n - 1)}>‹ Vorige</button>
          {last ? (
            <button className="btn accent sm" onClick={onClose}>Begrepen! 🎉</button>
          ) : (
            <button className="btn accent sm" onClick={() => setI((n) => n + 1)}>Volgende ›</button>
          )}
        </div>
      </div>
    </>
  );
}

/** The current "what's new" announcement: oefenvluchten + rustkuur. */
export const FEATURE_NEWS: FeatureStep[] = [
  {
    title: '🌤️ Nieuw: oefenvluchten',
    body: (
      <>
        Elke middag om <strong>12:00</strong> staat er een <strong>oefenvlucht</strong> op de kalender.
        Gratis inschrijven, lage energiekost, en er zijn geen punten of prijzen te verdienen.
        <div style={{ marginTop: 6 }}>
          <strong>Het voordeel:</strong> je duiven bouwen er vooral <strong>conditie en oriëntatie</strong> mee op —
          ideaal wanneer ze te weinig energie hebben voor een echte wedstrijd. Heeft een duif een
          <strong> privécoach</strong>, dan is de kans op winst (en de winst zelf) op conditie/oriëntatie groter.
          Ook snelheid kan, maar minder vaak.
        </div>
      </>
    ),
  },
  {
    title: '🛌 Nieuw: de rustkuur',
    body: (
      <>
        Zit een duif zonder fut? Geef haar op haar <strong>duifpagina</strong> een betaalde <strong>rustkuur</strong>.
        <div style={{ marginTop: 6 }}>
          Een kuur kost <strong>€300</strong> en duurt <strong>één dag</strong>. Tijdens de kuur rust de duif
          verplicht — ze kan dan <strong>niet vliegen</strong> — en daarna krijgt ze er in één keer
          <strong> +40 energie</strong> bij. Handig om snel iemand weer vluchtklaar te krijgen.
          Let op: <strong>maar één rustkuur per week</strong>, voor <strong>één</strong> duif.
        </div>
      </>
    ),
  },
];
