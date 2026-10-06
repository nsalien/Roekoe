/**
 * Het hokaanzicht bovenaan Mijn hok (hokinrichting — ⚠️ dev, nog niet live).
 *
 * One perch per place: capacity minus the private compartments gives the
 * zitbakjes in the main loft; each compartment is its own little hok with a
 * door; the ziekenboeg is an outbuilding with beds; the nest boxes hold the
 * breeding pairs. A bird that is not home keeps her place as a schim, with an
 * icon for where she is. Day and night follow the Brussels sun.
 *
 * Purely a view of the state Mijn hok already loads — no request of its own.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PigeonAvatar } from './PigeonAvatar';
import type { Loft, Pigeon } from '../types';

const BRUSSELS = { lat: 50.85, lon: 4.35 };
const SUNSET_ALTITUDE = -0.833; // centre of the sun at sunrise/sunset

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * The sun's altitude (degrees). Duplicated from core/game/traits.ts rather than
 * imported: core/ is server code (same choice as components/geo.ts).
 */
export function sunAltitudeDeg(lat: number, lon: number, atMs: number): number {
  const n = atMs / 86400000 + 2440587.5 - 2451545.0;
  const L = mod(280.46 + 0.9856474 * n, 360);
  const g = rad(mod(357.528 + 0.9856003 * n, 360));
  const lambda = rad(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const eps = rad(23.439 - 0.0000004 * n);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstDeg = mod(280.46061837 + 360.98564736629 * n, 360);
  const ha = rad(gmstDeg + lon) - ra;
  const phi = rad(lat);
  return deg(Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)));
}

function useIsNight(): boolean {
  const calc = () => sunAltitudeDeg(BRUSSELS.lat, BRUSSELS.lon, Date.now()) <= SUNSET_ALTITUDE;
  const [night, setNight] = useState(calc);
  useEffect(() => {
    const t = setInterval(() => setNight(calc()), 60_000);
    return () => clearInterval(t);
  }, []);
  return night;
}

/** Where a bird is when she is not on her perch, most telling first. */
export function awayStatus(p: Pigeon, nowMs: number = Date.now()): { icon: string; label: string } | null {
  if (p.away) return { icon: '🧭', label: 'de weg kwijt' };
  if (p.racing) return { icon: '✈️', label: 'onderweg' };
  if (p.inInfirmary) return { icon: '🏥', label: 'ziekenboeg' };
  if (p.breeding) return { icon: '🥚', label: 'op het nest' };
  if (p.cureUntil && Date.parse(p.cureUntil) > nowMs) return { icon: '💤', label: 'rustkuur' };
  return null;
}

/**
 * Who sits where. Compartment birds (not in the infirmary) fill the compartments;
 * everyone else has a perch in the main loft. Perches never number fewer than
 * the birds that need one (a loft can hold more birds than it has compartments
 * filled), so the count always adds up to the capacity.
 */
export function loftLayout(loft: Pick<Loft, 'capacity' | 'compartments'>, pigeons: Pigeon[]) {
  const inComp = pigeons.filter((p) => p.compartment && !p.inInfirmary).slice(0, loft.compartments);
  const compIds = new Set(inComp.map((p) => p.id));
  const main = pigeons.filter((p) => !compIds.has(p.id));
  const perchCount = Math.max(loft.capacity - loft.compartments, main.length);
  const perches: (Pigeon | null)[] = [...main, ...Array(Math.max(0, perchCount - main.length)).fill(null)];
  const comps: (Pigeon | null)[] = [...inComp, ...Array(Math.max(0, loft.compartments - inComp.length)).fill(null)];
  return { perches, comps };
}

function Bird({ p, size }: { p: Pigeon; size: number }) {
  if (p.breed?.image && !p.quirk) {
    return <img src={`/pigeon-images/${p.breed.image}`} alt="" loading="lazy" draggable={false} />;
  }
  return <PigeonAvatar pigeon={p} size={size} />;
}

function strawState(loft: Loft): 'fresh' | 'old' | 'none' {
  const eq = loft.equipment;
  if (!eq?.lastStrawAt) return 'none';
  return eq.hygiene >= 60 ? 'fresh' : 'old';
}

export function LoftView({
  loft,
  pigeons,
  busy,
  onAssignCompartment,
}: {
  loft: Loft;
  pigeons: Pigeon[];
  busy: boolean;
  onAssignCompartment: (pigeonId: string) => void;
}) {
  const navigate = useNavigate();
  const night = useIsNight();
  const nowMs = Date.now();
  const { perches, comps } = loftLayout(loft, pigeons);
  const byId = new Map(pigeons.map((p) => [p.id, p]));
  const nests = (loft.nests ?? [])
    .map((n) => ({ ...n, sire: byId.get(n.sireId), dam: byId.get(n.damId) }))
    .filter((n) => n.sire || n.dam);
  const nestBoxes = Math.max(2, nests.length);
  const patients = pigeons.filter((p) => p.inInfirmary);
  const beds = Math.max(loft.infirmaryCapacity, patients.length);
  const home = perches.filter((p) => p && !awayStatus(p, nowMs)).length + comps.filter((p) => p && !awayStatus(p, nowMs)).length;
  const canMoveIn = pigeons.filter((p) => !p.compartment && !p.inInfirmary && !p.away);

  const open = (p: Pigeon) => navigate(`/duif/${p.id}`);

  return (
    <figure className="lv" data-time={night ? 'night' : 'day'} data-straw={strawState(loft)} aria-label="Je hok in beeld">
      <div className="lv-orb" aria-hidden="true" />
      <div className="lv-cloud" aria-hidden="true" />
      <div className={`lv-stage${loft.infirmaryCapacity > 0 ? '' : ' solo'}`}>
        <div className="lv-bld">
          <div className="lv-roof" aria-hidden="true">
            <div className="lv-roof-shape" />
            <div className="lv-sign">{loft.name} · {loft.capacity} plaatsen</div>
          </div>
          <div className={`lv-facade${comps.length > 0 ? ' with-comps' : ''}`}>
            <div className="lv-room">
              <div className="lv-label"><span>Hoofdhok</span><span>{home} van {pigeons.length} thuis</span></div>
              <div className="lv-perches">
                {perches.map((p, i) => {
                  if (!p) {
                    return (
                      <button key={`free-${i}`} type="button" className="lv-perch empty" onClick={() => navigate('/markt')} title="Vrije plaats — naar de markt">
                        <span className="lv-box"><span className="lv-free">vrij</span></span>
                        <span className="lv-name">&nbsp;</span>
                      </button>
                    );
                  }
                  const st = awayStatus(p, nowMs);
                  return (
                    <button key={p.id} type="button" className={`lv-perch${st ? ' away' : ''}`} onClick={() => open(p)} title={st ? `${p.name} — ${st.label}` : p.name}>
                      <span className="lv-box">
                        <Bird p={p} size={40} />
                        {st && <span className="lv-chip" aria-label={st.label}>{st.icon}</span>}
                      </span>
                      <span className="lv-name">{p.name.split(' ')[0]}</span>
                      {st && <span className="lv-sub">{st.label}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="lv-label"><span>Nestbakken</span><span>{nests.length} van {nestBoxes} bezet</span></div>
              <div className="lv-nests">
                {Array.from({ length: nestBoxes }, (_, i) => {
                  const n = nests[i];
                  if (!n) {
                    return (
                      <button key={`nest-${i}`} type="button" className="lv-nest free" onClick={() => navigate('/kweek')} title="Vrije nestbak — naar de kweek">
                        <span className="lv-bowl" />
                        <span className="lv-cap">vrij</span>
                      </button>
                    );
                  }
                  return (
                    <button key={n.id} type="button" className="lv-nest" onClick={() => navigate('/kweek')} title="Broedend koppel — naar de kweek">
                      <span className="lv-pair">
                        {n.sire && <span className="flip"><Bird p={n.sire} size={34} /></span>}
                        {n.dam && <span><Bird p={n.dam} size={34} /></span>}
                      </span>
                      <span className="lv-bowl" />
                      <span className="lv-cap">{[n.sire?.name.split(' ')[0], n.dam?.name.split(' ')[0]].filter(Boolean).join(' & ')}</span>
                    </button>
                  );
                })}
              </div>
              <div className="lv-floor" aria-hidden="true" />
              <div className="lv-shade" aria-hidden="true" />
            </div>
            {comps.length > 0 && (
              <div className="lv-comps">
                {comps.map((p, i) => {
                  if (!p) {
                    return (
                      <div key={`comp-${i}`} className="lv-comp free">
                        <span className="lv-door" aria-hidden="true" />
                        <span className="lv-plate">Apart {i + 1}</span>
                        <span className="lv-free">vrij</span>
                        {canMoveIn.length > 0 && (
                          <select
                            aria-label={`Wie mag in apart hok ${i + 1}?`}
                            value=""
                            disabled={busy}
                            onChange={(e) => e.target.value && onAssignCompartment(e.target.value)}
                          >
                            <option value="">Kies een duif…</option>
                            {canMoveIn.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        )}
                        <span className="lv-shade" aria-hidden="true" />
                      </div>
                    );
                  }
                  const st = awayStatus(p, nowMs);
                  return (
                    <button key={p.id} type="button" className={`lv-comp${st ? ' away' : ''}`} onClick={() => open(p)} title={st ? `${p.name} — ${st.label}` : p.name}>
                      <span className="lv-door" aria-hidden="true" />
                      <span className="lv-plate">Apart {i + 1}</span>
                      <span className="lv-who">
                        <Bird p={p} size={56} />
                        {st && <span className="lv-chip" aria-label={st.label}>{st.icon}</span>}
                      </span>
                      <span className="lv-name">{p.name.split(' ')[0]}</span>
                      {st && <span className="lv-sub">{st.label}</span>}
                      <span className="lv-shade" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {loft.infirmaryCapacity > 0 && (
          <div className="lv-side">
            <div className="lv-boeg">
              <div className="lv-boeg-roof" aria-hidden="true" />
              <div className="lv-boeg-sign"><span className="lv-cross" aria-hidden="true" />Ziekenboeg · {loft.infirmaryCapacity} {loft.infirmaryCapacity === 1 ? 'bed' : 'bedden'}</div>
              <div className="lv-beds">
                {Array.from({ length: beds }, (_, i) => {
                  const p = patients[i];
                  if (!p) {
                    return (
                      <button key={`bed-${i}`} type="button" className="lv-bed free" onClick={() => navigate('/ziekenboeg')} title="Vrij bed — naar de ziekenboeg">
                        vrij bed
                      </button>
                    );
                  }
                  const healed = p.ailment ? Math.round((p.ailment.healed ?? 0) * 100) : 100;
                  return (
                    <button key={p.id} type="button" className="lv-bed" onClick={() => open(p)} title={p.ailment ? `${p.name} — ${p.ailment.name}` : p.name}>
                      <Bird p={p} size={40} />
                      <span className="lv-name">{p.name.split(' ')[0]}</span>
                      <span className="lv-heal" aria-label={`${healed}% hersteld`}><i style={{ width: `${healed}%` }} /></span>
                      <span className="lv-sub">{p.ailment ? p.ailment.name : 'rust'}</span>
                    </button>
                  );
                })}
              </div>
              {(loft.doctors > 0 || loft.physios > 0 || loft.medicatedFood) && (
                <div className="lv-staff">
                  {loft.doctors > 0 && <span>Dokter{loft.doctors > 1 ? ` ×${loft.doctors}` : ''}</span>}
                  {loft.physios > 0 && <span>Kinesist{loft.physios > 1 ? ` ×${loft.physios}` : ''}</span>}
                  {loft.medicatedFood && <span>Medicatievoer</span>}
                </div>
              )}
              <div className="lv-shade" aria-hidden="true" />
            </div>
          </div>
        )}
      </div>
      <div className="lv-ground">
        {loft.equipment?.cleaner && (
          <span className="lv-yard" title="De hokpoetser houdt het stro vers">
            <svg width="44" height="50" viewBox="0 0 52 58" aria-hidden="true"><circle cx="20" cy="9" r="6" fill="#c48d5a" /><path d="M12 18 Q20 14 28 18 L30 40 L10 40Z" fill="#2f7fbf" /><rect x="12" y="40" width="6" height="16" rx="2" fill="#2a1d12" /><rect x="22" y="40" width="6" height="16" rx="2" fill="#2a1d12" /><rect x="33" y="4" width="3" height="44" transform="rotate(14 34 26)" fill="#7a4e2c" /><path d="M30 46 L44 48 L46 57 L26 55Z" fill="#cf9f33" /><path d="M2 44 L14 44 L12 57 L4 57Z" fill="#8b96a3" /></svg>
            Hokpoetser
          </span>
        )}
        <span className="lv-yard">
          <svg width="44" height="44" viewBox="0 0 58 58" aria-hidden="true"><rect x="4" y="2" width="50" height="56" rx="3" fill="#7a4e2c" /><rect x="9" y="7" width="40" height="51" rx="2" fill="#a87244" /><path d="M9 19h40M9 32h40M9 45h40" stroke="#7a4e2c" strokeWidth="1.4" /><circle cx="42" cy="34" r="2.6" fill="#ffd77a" /></svg>
          Deur
        </span>
      </div>
    </figure>
  );
}
