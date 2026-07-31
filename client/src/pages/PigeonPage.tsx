/** Single pigeon: full stats, pedigree and training controls. */

import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { PigeonAvatar } from '../components/PigeonAvatar';
import { Money, SexBadge, Spinner, StatBar, formatFlightTime, useToast } from '../components/ui';
import type { Pigeon, RaceHistoryRow } from '../types';

interface PigeonDetail {
  pigeon: Pigeon;
  sire: Pigeon | null;
  dam: Pigeon | null;
  mine: boolean;
  history: RaceHistoryRow[];
}

export function PigeonPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { state, refresh } = useGame();
  const toast = useToast();
  const [data, setData] = useState<PigeonDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');

  async function load() {
    if (!id) return;
    try {
      setData(await api<PigeonDetail>(`/pigeons/${id}`));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Niet gevonden', 'err');
      nav('/hok');
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!data) return <Spinner />;
  const { pigeon: p, sire, dam, mine, history } = data;

  async function train(attr: 'speed' | 'endurance' | 'orientation') {
    setBusy(true);
    try {
      await api(`/pigeons/${p.id}/train`, { method: 'POST', body: { attr } });
      toast.show('Getraind! 💪', 'ok');
      await load();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function moveInfirmary(wantIn: boolean) {
    setBusy(true);
    try {
      await api(`/pigeons/${p.id}/infirmary`, { method: 'POST', body: { in: wantIn } });
      toast.show(wantIn ? 'Naar de ziekenboeg 🏥' : 'Terug naar het hok 🕊️', 'ok');
      await load();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.show(ok, 'ok');
      await load();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  function setCoach(on: boolean) {
    return run(() => api(`/pigeons/${p.id}/coach`, { method: 'POST', body: { on } }), on ? 'Coach ingehuurd! 🎯' : 'Coach ontslagen');
  }

  function setRation(ration: string) {
    return run(() => api(`/pigeons/${p.id}/ration`, { method: 'POST', body: { ration } }), 'Voer aangepast 🍽');
  }

  function setCompartment(on: boolean) {
    return run(() => api(`/pigeons/${p.id}/compartment`, { method: 'POST', body: { on } }), on ? 'In apart hok 🧱' : 'Terug bij de rest');
  }

  function rename() {
    const name = newName.trim();
    if (name.length < 2) return;
    return run(() => api(`/pigeons/${p.id}/rename`, { method: 'POST', body: { name } }), 'Hernoemd! ✏️').then(() => {
      setRenaming(false);
      setNewName('');
    });
  }

  return (
    <div>
      <Link to="/hok" className="faint">← terug naar hok</Link>
      <div className="grid cols-2" style={{ marginTop: 10 }}>
        <div className="card">
          <div className="row" style={{ gap: 14, alignItems: 'center' }}>
            <PigeonAvatar pigeon={p} size={120} />
            <div>
              <h1 style={{ marginBottom: 6 }}>{p.name}</h1>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <SexBadge sex={p.sex} />
                <span className="badge bot">★ talent {p.talent}</span>
                {p.forSale && <span className="badge sale">te koop · <Money value={p.price ?? 0} /></span>}
                {p.ailment && (
                  <span className="badge" style={{ background: p.ailment.kind === 'ziekte' ? 'var(--bad-soft)' : 'var(--gold-soft)', color: p.ailment.kind === 'ziekte' ? 'var(--bad)' : 'var(--gold)' }}>
                    {p.ailment.kind === 'ziekte' ? '🤒' : '🩹'} {p.ailment.name}
                  </span>
                )}
                {p.inInfirmary && <span className="badge" style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)' }}>🏥 in ziekenboeg</span>}
                {p.coached && <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>🎯 coach</span>}
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                {Math.floor(p.ageWeeks / 52) > 0 ? `${Math.floor(p.ageWeeks / 52)}j ` : ''}{p.ageWeeks % 52} wk oud ·
                {p.canRace ? ' klaar om te vliegen' : ' nog niet vluchtklaar'}
              </p>
              <div className="faint">Geschatte waarde <Money value={p.value} /> · eigenaar {p.ownerName}</div>
            </div>
          </div>

          <hr className="sep" />
          <StatBar label="Snelheid" value={p.speed} />
          <StatBar label="Conditie" value={p.endurance} />
          <StatBar label="Oriëntatie" value={p.orientation} />
          <StatBar label="⚡ Energie" value={p.form} variant="form" />
          <StatBar label="Gezondheid" value={p.health} variant="health" />
          <StatBar label="❤️ Libido" value={p.libido} />
          <StatBar label="Ervaring" value={p.experience} />
        </div>

        <div>
          {(p.ailment || p.inInfirmary) && (
            <div className="card" style={{ borderColor: p.ailment ? 'var(--bad)' : 'var(--brand)' }}>
              <h2>Gezondheid</h2>
              {p.ailment ? (
                <>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <span className="badge" style={{ background: p.ailment.kind === 'ziekte' ? 'var(--bad-soft)' : 'var(--gold-soft)', color: p.ailment.kind === 'ziekte' ? 'var(--bad)' : 'var(--gold)' }}>
                      {p.ailment.kind === 'ziekte' ? '🦠 Ziekte' : '🩹 Kwetsuur'}
                    </span>
                    <strong>{p.ailment.name}</strong>
                    <span className={`badge ${p.ailment.severity === 'ernstig' ? 'sev-ernstig' : p.ailment.severity === 'matig' ? 'sev-matig' : 'sev-licht'}`}>{p.ailment.severity}</span>
                  </div>
                  <p className="muted" style={{ marginTop: 8 }}>{p.ailment.description}</p>
                </>
              ) : (
                <p className="muted">Deze duif rust uit in de ziekenboeg en kan niet vliegen zolang ze daar zit.</p>
              )}
              {mine && (
                p.inInfirmary ? (
                  <button className="btn ghost block" disabled={busy} onClick={() => moveInfirmary(false)}>← Terug naar het hok</button>
                ) : (
                  <button className="btn accent block" disabled={busy} onClick={() => moveInfirmary(true)}>→ Naar de ziekenboeg</button>
                )
              )}
              {mine && p.ailment && !p.inInfirmary && (
                <p className="faint" style={{ margin: '8px 0 0', fontSize: '0.8rem' }}>
                  In de ziekenboeg herstelt ze sneller en besmet ze de rest van je hok niet.
                </p>
              )}
            </div>
          )}

          {mine && !p.ailment && !p.inInfirmary && p.racing && (
            <div className="card">
              <h2>Training</h2>
              <p className="muted">
                🏁 Deze duif is ingeschreven voor een vlucht. Trainen kan pas weer als ze thuis is.
              </p>
            </div>
          )}

          {mine && !p.ailment && !p.inInfirmary && !p.racing && (
            <div className="card">
              <h2>Training</h2>
              <p className="muted">
                {state?.economy && <>Kost <Money value={state.economy.trainCost} /> en wat energie, </>}geeft een kleine blijvende verbetering.
              </p>
              <div className="stack" style={{ marginTop: 8 }}>
                <button className="btn" disabled={busy} onClick={() => train('speed')}>Train snelheid</button>
                <button className="btn" disabled={busy} onClick={() => train('endurance')}>Train conditie</button>
                <button className="btn" disabled={busy} onClick={() => train('orientation')}>Train oriëntatie</button>
              </div>
            </div>
          )}

          {mine && (
            <div className="card">
              <h2>Ontwikkeling</h2>

              {/* Private coach */}
              <div className="row" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div>
                  <strong>🎯 Privécoach</strong>
                  <div className="faint" style={{ fontSize: '0.85rem' }}>
                    Begeleidt de duif dagelijks in snelheid, conditie én oriëntatie (tot 96) — puur om beter te racen, niet voor libido.
                    {state?.economy && (
                      <> Kost <Money value={state.economy.coachHireCost} /> + <Money value={state.economy.coachSalary} />/week.</>
                    )}
                  </div>
                </div>
                {p.coached ? (
                  <button className="btn ghost sm" style={{ flexShrink: 0 }} disabled={busy} onClick={() => setCoach(false)}>Ontslaan</button>
                ) : (
                  <button className="btn accent sm" style={{ flexShrink: 0 }} disabled={busy} onClick={() => setCoach(true)}>Inhuren</button>
                )}
              </div>

              <hr className="sep" />

              {/* Feeding + private compartment */}
              <div className="row" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>🍽 Voer & huisvesting</strong>
                  <div className="faint" style={{ fontSize: '0.85rem' }}>
                    Kies een eigen voerschema (vluchten vs. broeden) en of deze duif apart zit.
                  </div>
                </div>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {state?.feedRations && (
                  <select
                    value={p.ration}
                    disabled={busy}
                    onChange={(e) => setRation(e.target.value)}
                    style={{ flex: 1, minWidth: 120, width: 'auto', ...((state.loft?.food[p.ration] ?? 0) <= 0 ? { borderColor: 'var(--bad)', color: 'var(--bad)' } : {}) }}
                  >
                    {(Object.keys(state.feedRations) as (keyof typeof state.feedRations)[]).map((k) => {
                      const kg = state.loft?.food[k] ?? 0;
                      return (
                        <option key={k} value={k}>
                          {kg <= 0 ? '⚠️' : '🍽'} {state.feedRations[k].label} ({Math.round(kg)} kg)
                        </option>
                      );
                    })}
                  </select>
                )}
                <button
                  className={`btn sm ${p.compartment ? 'accent' : 'ghost'}`}
                  disabled={busy || (!p.compartment && (state?.loft ? state.loft.compartmentsUsed >= state.loft.compartments : true))}
                  title={p.compartment ? 'Zit in een apart hok' : 'Zit samen met de rest'}
                  onClick={() => setCompartment(!p.compartment)}
                >
                  🧱 {p.compartment ? 'Apart hok' : 'Samen'}
                </button>
              </div>
              {state?.feedRations && (state.loft?.food[p.ration] ?? 0) <= 0 && (
                <p className="faint" style={{ color: 'var(--bad)', fontSize: '0.82rem', margin: '6px 0 0' }}>
                  ⚠️ Je hebt geen voorraad {state.feedRations[p.ration].label.toLowerCase()} meer. Koop bij op het dashboard, anders krijgt deze duif niets.
                </p>
              )}

              <hr className="sep" />

              {/* Rename */}
              {renaming ? (
                <div className="row" style={{ gap: 8 }}>
                  <input
                    type="text"
                    value={newName}
                    maxLength={28}
                    placeholder="Nieuwe naam"
                    onChange={(e) => setNewName(e.target.value)}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button className="btn accent sm" disabled={busy || newName.trim().length < 2} onClick={rename}>Bevestig</button>
                  <button className="btn ghost sm" disabled={busy} onClick={() => setRenaming(false)}>×</button>
                </div>
              ) : (
                <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <strong>✏️ Hernoemen</strong>
                    <div className="faint" style={{ fontSize: '0.85rem' }}>
                      Geef je duif een nieuwe naam{state?.economy && <> voor <Money value={state.economy.renameCost} /></>}.
                    </div>
                  </div>
                  <button className="btn sm" style={{ flexShrink: 0 }} disabled={busy} onClick={() => { setNewName(p.name); setRenaming(true); }}>Hernoemen</button>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <h2>Afstamming</h2>
            <div className="grid cols-2">
              <PedigreeBox label="Vader (doffer)" pigeon={sire} />
              <PedigreeBox label="Moeder (duivin)" pigeon={dam} />
            </div>
            {!sire && !dam && <p className="muted" style={{ marginTop: 8 }}>Afkomst onbekend (grondduif).</p>}
          </div>

          <div className="card">
            <h2>Wedstrijdhistoriek</h2>
            {history.length === 0 ? (
              <p className="muted">Deze duif heeft nog geen vluchten gevlogen.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Vlucht</th>
                      <th>Route</th>
                      <th className="num">Plaats</th>
                      <th className="num">Ptn</th>
                      <th className="num">Prijs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.flightId} className={h.rank === 1 ? 'podium-1' : ''}>
                        <td>
                          <Link to={`/vluchten/${h.flightId}`} style={{ color: 'inherit' }}>
                            {h.name}
                          </Link>
                          <div className="faint">{formatFlightTime(h.startAt)}</div>
                        </td>
                        <td className="faint">{h.fromCity} → {h.toCity} · {h.distanceKm} km</td>
                        <td className="num">
                          {h.rank === 1 ? '🥇' : h.rank === 2 ? '🥈' : h.rank === 3 ? '🥉' : `${h.rank}e`}
                          <span className="faint"> / {h.total}</span>
                        </td>
                        <td className="num">{h.points}</td>
                        <td className="num">{h.prize > 0 ? <Money value={h.prize} /> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PedigreeBox({ label, pigeon }: { label: string; pigeon: Pigeon | null }) {
  return (
    <div className="card" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
      <div className="faint">{label}</div>
      {pigeon ? (
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <PigeonAvatar pigeon={pigeon} size={44} />
          <div>
            <strong>{pigeon.name}</strong>
            <div className="faint">★ {pigeon.talent}</div>
          </div>
        </div>
      ) : (
        <div className="muted" style={{ marginTop: 4 }}>—</div>
      )}
    </div>
  );
}
