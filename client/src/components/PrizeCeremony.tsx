/**
 * De prijsuitreiking, als échte ceremonie.
 *
 * Aan het einde van een seizoen (en om de drie seizoenen ook het criterium) kan
 * één hok meerdere prijzen tegelijk winnen. Dat stond vroeger samengeperst in één
 * belmelding — een regel tekst voor iets waar je vier weken voor gevlogen hebt.
 * Nu krijgt elke prijs zijn eigen scherm: de beker groot in beeld, waarvoor je
 * hem won, en het prijzengeld dat mee omhoog telt.
 *
 * De melding blijft bestaan als het naslagwerk; dit is het feestje. Er is geen
 * serverstatus voor nodig: `loft.ceremony` draagt de prijzen van het laatst
 * afgelopen seizoen, en localStorage onthoudt welk seizoen je al gevierd hebt.
 */

import { useEffect, useState } from 'react';
import type { SeasonAward } from '../types';

const METAL = ['Gouden', 'Zilveren', 'Bronzen'];

/** Kleuren per plaats: goud, zilver, brons — licht → donker, voor het verloop. */
const FINISH = [
  { light: '#fde68a', mid: '#f5c026', dark: '#a16207', glow: 'rgba(245, 192, 38, 0.55)' },
  { light: '#f1f5f9', mid: '#cbd5e1', dark: '#64748b', glow: 'rgba(203, 213, 225, 0.5)' },
  { light: '#fcd9b6', mid: '#d08b4a', dark: '#7c4a1e', glow: 'rgba(208, 139, 74, 0.5)' },
];

const WING_LABEL: Record<string, string> = {
  speed: 'snelste duif',
  podium: 'meeste podiums',
  progress: 'meeste vooruitgang',
};
const AGE_LABEL: Record<string, string> = {
  u1: 'onder 1 jaar',
  y12: '1 tot 2 jaar',
  y23: '2 tot 3 jaar',
  o3: 'ouder dan 3 jaar',
};

/** De naam op de sokkel. */
function awardName(a: SeasonAward): string {
  const metal = METAL[a.rank - 1] ?? '';
  if (a.kind === 'roekoe') return `de ${metal} Roekoe`;
  if (a.kind === 'vleugel') return `de ${metal} Vleugel`;
  return `${metal} Criteriumduif`;
}

/** Eén regel: waarvoor je hem kreeg. */
function awardFor(a: SeasonAward): string {
  if (a.kind === 'roekoe') return `${a.value ?? 0} seizoenspunten`;
  if (a.kind === 'vleugel') return `${WING_LABEL[a.category ?? ''] ?? 'duivenranglijst'} — ${a.pigeonName ?? 'je duif'}`;
  return `${AGE_LABEL[a.ageCat ?? ''] ?? 'leeftijdsklasse'} — ${a.pigeonName ?? 'je duif'}`;
}

/**
 * De beker zelf. Drie vormen, want drie soorten prijs: een klassieke cup voor de
 * melkerranglijst, een vleugel voor de duivenranglijsten, en een medaille voor
 * het criterium. Getekend in SVG i.p.v. als afbeelding: scherp op elk scherm,
 * en het metaal is gewoon een verloop dat met de plaats meebeweegt.
 */
function Trophy({ kind, rank }: { kind: SeasonAward['kind']; rank: number }) {
  const c = FINISH[rank - 1] ?? FINISH[0];
  const id = `${kind}-${rank}`;
  return (
    <svg viewBox="0 0 120 120" width="150" height="150" role="img" aria-hidden className="ceremony-trophy">
      <defs>
        <linearGradient id={`metal-${id}`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor={c.light} />
          <stop offset="45%" stopColor={c.mid} />
          <stop offset="100%" stopColor={c.dark} />
        </linearGradient>
        <radialGradient id={`halo-${id}`} cx="50%" cy="45%" r="50%">
          <stop offset="0%" stopColor={c.glow} />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="56" r="52" fill={`url(#halo-${id})`} />
      {kind === 'roekoe' && (
        <g fill={`url(#metal-${id})`} stroke={c.dark} strokeWidth="1.5" strokeLinejoin="round">
          {/* cup + oren + voet */}
          <path d="M38 24h44v18a22 22 0 0 1-44 0z" />
          <path d="M38 28H29a9 9 0 0 0 0 18h3" fill="none" strokeWidth="4" />
          <path d="M82 28h9a9 9 0 0 1 0 18h-3" fill="none" strokeWidth="4" />
          <path d="M56 64h8v14h-8z" />
          <path d="M44 78h32l4 12H40z" />
          <path d="M36 90h48v8H36z" />
        </g>
      )}
      {kind === 'vleugel' && (
        <g fill={`url(#metal-${id})`} stroke={c.dark} strokeWidth="1.5" strokeLinejoin="round">
          {/* Gladde voorrand van wortel naar punt, en terug langs de achterrand
              met vier slagpennen — dát is wat een vleugel leesbaar maakt. */}
          <path
            d="M28 82C40 48 62 26 96 20
               Q92 42 80 46
               Q76 64 63 61
               Q58 76 45 73
               Q40 86 28 82Z"
          />
          {/* Pennenlijnen: alleen een suggestie, niet uittekenen. */}
          <path d="M40 70c10-14 24-27 42-36" fill="none" strokeWidth="1.1" opacity="0.5" />
          <path d="M35 77c11-16 27-31 47-41" fill="none" strokeWidth="1.1" opacity="0.35" />
          <path d="M38 92h44v8H38z" />
          <path d="M46 84h28v8H46z" />
        </g>
      )}
      {kind === 'criterium' && (
        <g fill={`url(#metal-${id})`} stroke={c.dark} strokeWidth="1.5" strokeLinejoin="round">
          {/* lint + medaille */}
          <path d="M44 14l12 30h8L52 14z" />
          <path d="M76 14L64 44h8l12-30z" />
          <circle cx="60" cy="72" r="26" />
          <circle cx="60" cy="72" r="19" fill="none" stroke={c.dark} strokeWidth="1.2" opacity="0.6" />
          <path
            d="M60 60l3.4 7 7.6 1-5.5 5.4 1.3 7.6-6.8-3.6-6.8 3.6 1.3-7.6L49 68l7.6-1z"
            stroke="none"
            fill={c.light}
            opacity="0.9"
          />
        </g>
      )}
    </svg>
  );
}

/** Telt het bedrag omhoog — een prijs mag je even zien binnenkomen. */
function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (to <= 0) { setN(0); return; }
    const start = performance.now();
    const dur = 900;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      // Snel op gang, zacht uitbollend.
      setN(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>€{n.toLocaleString('nl-BE')}</>;
}

export function PrizeCeremony({
  season, awards, onClose,
}: {
  season: number;
  awards: SeasonAward[];
  onClose: () => void;
}) {
  // Mooiste volgorde: eerst de Roekoe, dan de Vleugels, dan het criterium — en
  // binnen elke soort de hoogste plaats eerst, zodat het opbouwt naar je beste.
  const order = { roekoe: 0, vleugel: 1, criterium: 2 };
  const list = [...awards].sort(
    (a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.rank - b.rank,
  );
  const [i, setI] = useState(0);
  const a = list[i];
  if (!a) return null;

  const last = i === list.length - 1;
  const total = list.reduce((s, x) => s + x.reward, 0);

  return (
    <div className="modal-overlay ceremony-overlay">
      <div className="modal ceremony" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
        <div className="faint" style={{ fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Prijsuitreiking · seizoen {season}
        </div>

        {/* key = de prijs, zodat de animatie bij élke prijs opnieuw speelt */}
        <div key={`${a.kind}-${a.rank}-${i}`} className="ceremony-stage">
          <Trophy kind={a.kind} rank={a.rank} />
          {/* Geen medaille-emoji naast de titel: de getekende beker draagt de
              plaats al (goud/zilver/brons), en naast de criteriummedaille stond
              er anders een medaille náást een medaille. */}
          <h2 style={{ margin: '2px 0 2px', fontSize: '1.35rem' }}>{awardName(a)}</h2>
          <div className="muted" style={{ marginBottom: 10 }}>{awardFor(a)}</div>
          <div className="ceremony-money">
            <CountUp to={a.reward} />
          </div>
        </div>

        {list.length > 1 && (
          <div className="row" style={{ gap: 5, justifyContent: 'center', margin: '12px 0 4px' }}>
            {list.map((_, idx) => (
              <span
                key={idx}
                onClick={() => setI(idx)}
                style={{
                  width: 7, height: 7, borderRadius: 999, cursor: 'pointer',
                  background: idx === i ? 'var(--gold)' : 'var(--surface-3)',
                }}
              />
            ))}
          </div>
        )}

        <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 10 }}>
          {last ? (
            <button className="btn accent block" onClick={onClose}>
              {list.length > 1 ? `Proficiat! (€${total.toLocaleString('nl-BE')} in totaal)` : 'Proficiat!'}
            </button>
          ) : (
            <button className="btn accent block" onClick={() => setI((n) => n + 1)}>
              Volgende prijs ({i + 2}/{list.length}) →
            </button>
          )}
        </div>
        {!last && (
          <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={onClose}>Overslaan</button>
        )}
      </div>
    </div>
  );
}
