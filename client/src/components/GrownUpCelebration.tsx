/**
 * Een duif in je hok wordt 8 weken: ze is volwassen en mag vliegen (live sinds 4 nov).
 *
 * Eigenaar, 4 nov: "zorg voor een leuke animatie die de speler te zien krijgt per
 * duif die volwassen wordt … Nu gebeurt dit gewoon stil." The engine notes the
 * moment (`pigeon.grownUpAt`, core/game/grownup.ts); Layout feeds every own bird
 * that has not been celebrated on this device yet, and this shows them one at a
 * time: the chick that grows into the bird, a VLIEGKLAAR stamp, feathers and sparks.
 * Everything is CSS (global.css, "Volwassen"), and with reduced motion only the
 * final picture remains.
 */

import { useNavigate } from 'react-router-dom';
import { PigeonAvatar } from './PigeonAvatar';
import type { Pigeon } from '../types';

/** Fixed positions so a re-render never reshuffles the confetti. */
const FEATHERS = [8, 22, 35, 48, 61, 74, 87, 15, 55, 80];
const SPARKS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return { dx: Math.round(Math.cos(a) * 95), dy: Math.round(Math.sin(a) * 70) };
});

export function GrownUpCelebration({ birds, onSeen }: { birds: Pigeon[]; onSeen: (id: string) => void }) {
  const navigate = useNavigate();
  const bird = birds[0];
  if (!bird) return null;
  const she = bird.sex !== 'doffer';
  const more = birds.length - 1;

  return (
    <div className="modal-overlay grown-overlay" role="dialog" aria-modal="true" aria-label={`${bird.name} is volwassen`}>
      {/* A new key per bird restarts every animation for the next one in line. */}
      <div className="modal grown" key={bird.id}>
        <div className="grown-sky" aria-hidden="true">
          {FEATHERS.map((x, i) => (
            <span key={`f${i}`} className="grown-feather" style={{ left: `${x}%`, animationDelay: `${1.3 + (i % 5) * 0.45}s`, animationDuration: `${3.2 + (i % 3) * 0.7}s` }}>
              🪶
            </span>
          ))}
          {SPARKS.map((s, i) => (
            <span key={`s${i}`} className="grown-spark" style={{ ['--dx' as string]: `${s.dx}px`, ['--dy' as string]: `${s.dy}px` }} />
          ))}
          <span className="grown-chick">🐣</span>
          <div className="grown-bird">
            <div className="grown-bird-grow">
              <div className="grown-bird-hop">
                <PigeonAvatar pigeon={bird} size={112} />
              </div>
            </div>
          </div>
          <span className="grown-stamp">Vliegklaar</span>
        </div>

        <div className="grown-text">
          <h2 style={{ margin: '4px 0 6px' }}>🎉 {bird.name} is volwassen!</h2>
          <p className="muted" style={{ margin: '0 0 6px' }}>
            {she ? 'Ze' : 'Hij'} is <strong>8 weken</strong> oud en mag vanaf nu meevliegen in wedstrijden.
          </p>
          <p className="faint" style={{ margin: '0 0 14px', fontSize: '0.85rem' }}>
            ★{bird.talent} · ⚡ energie {Math.round(bird.form ?? 0)}
          </p>
          <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn accent"
              onClick={() => {
                onSeen(bird.id);
                navigate('/vluchten');
              }}
            >
              🏁 Schrijf {she ? 'haar' : 'hem'} in
            </button>
            <button className="btn ghost" onClick={() => onSeen(bird.id)}>
              {more > 0 ? `Volgende (nog ${more})` : 'Hoera!'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
