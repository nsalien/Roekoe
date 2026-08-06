/** Single pigeon: full stats, pedigree and training controls. */

import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { PigeonAvatar } from '../components/PigeonAvatar';
import { Money, PigeonStats, SexBadge, Spinner, formatFlightTime, useToast } from '../components/ui';
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
  const [offerAmount, setOfferAmount] = useState(0);

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

  function startRestCure() {
    return run(() => api(`/pigeons/${p.id}/restcure`, { method: 'POST' }), 'Rustkuur gestart 🛌');
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
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ marginBottom: 6, overflowWrap: 'anywhere' }}>{p.name}</h1>
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
          {p.revealed ? (
            <PigeonStats pigeon={p} />
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              🔒 De precieze eigenschappen van andermans duiven zijn niet zichtbaar. Enkel de
              algemene score (★ talent {p.talent}) is gekend. Bekijk de <Link to="/ranglijst">ranglijst</Link>{' '}
              of specifieke vluchtresultaten om een idee te vormen voor je een bod doet.
            </p>
          )}
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

          {mine && !p.ailment && !p.inInfirmary && p.onCure && (
            <div className="card">
              <h2>Training</h2>
              <p className="muted">
                🛌 Deze duif is op rustkuur. Ze kan niets doen (geen vluchten, geen training) tot de kuur voorbij is.
              </p>
            </div>
          )}

          {mine && !p.ailment && !p.inInfirmary && !p.onCure && p.racing && (
            <div className="card">
              <h2>Training</h2>
              <p className="muted">
                🏁 Deze duif is ingeschreven voor een vlucht. Trainen kan pas weer als ze thuis is.
              </p>
            </div>
          )}

          {mine && !p.ailment && !p.inInfirmary && !p.onCure && !p.racing && (
            <div className="card">
              <h2>Training</h2>
              <p className="muted">
                {state?.economy && <>Kost <Money value={state.economy.trainCost} /> en wat energie, </>}geeft een kleine blijvende verbetering.
                Elke eigenschap kan <strong>1× per week</strong> getraind worden.
              </p>
              <div className="stack" style={{ marginTop: 8 }}>
                {([
                  ['speed', 'snelheid'],
                  ['endurance', 'conditie'],
                  ['orientation', 'oriëntatie'],
                ] as const).map(([attr, label]) => {
                  const until = p.trainAvailableAt[attr];
                  return (
                    <button
                      key={attr}
                      className="btn"
                      disabled={busy || !!until}
                      title={until ? `Deze week al getraind — opnieuw vanaf ${formatFlightTime(until)}` : undefined}
                      onClick={() => train(attr)}
                    >
                      {until ? `🔒 ${label.charAt(0).toUpperCase() + label.slice(1)} — weer vanaf ${formatFlightTime(until)}` : `Train ${label}`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!mine && !p.ownerIsBot && (() => {
            const myOffer = (state?.offers?.sent ?? []).find((o) => o.pigeonId === p.id);
            return (
              <div className="card">
                <h2>🤝 Bied op deze duif</h2>
                <p className="faint" style={{ fontSize: '0.85rem', marginTop: 0 }}>
                  Je kan {p.ownerName} een bod doen, ook al staat {p.name} niet te koop. Het bod blijft geldig tot
                  {' '}{p.ownerName} het aanvaardt of weigert; je kan het altijd intrekken via de <strong>Markt</strong>.
                </p>
                {myOffer ? (
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <span className="notice" style={{ margin: 0 }}>
                      Je hebt een lopend bod van <strong><Money value={myOffer.amount} /></strong> — wacht op antwoord.
                    </span>
                    <button className="btn ghost sm" disabled={busy}
                      onClick={() => run(() => api(`/offers/${myOffer.id}/withdraw`, { method: 'POST' }), 'Bod ingetrokken')}>
                      Trek in
                    </button>
                  </div>
                ) : (
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <input
                      type="number"
                      min={1}
                      value={offerAmount || ''}
                      placeholder="bedrag"
                      onChange={(e) => setOfferAmount(Number(e.target.value))}
                      style={{ maxWidth: 140 }}
                    />
                    <button className="btn accent" disabled={busy || !(offerAmount > 0) || offerAmount > (state?.loft?.money ?? 0)}
                      onClick={() => run(() => api(`/pigeons/${p.id}/offer`, { method: 'POST', body: { amount: offerAmount } }), 'Bod uitgebracht! 🤝').then(() => setOfferAmount(0))}>
                      Bied <Money value={offerAmount || 0} />
                    </button>
                    <span className="faint" style={{ alignSelf: 'center' }}>je kassa: <Money value={state?.loft?.money ?? 0} /></span>
                  </div>
                )}
              </div>
            );
          })()}

          {mine && (
            <div className="card">
              <h2>Ontwikkeling</h2>

              {/* Private coach */}
              <div className="row" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>🎯 Privécoach</strong>
                  <div className="faint" style={{ fontSize: '0.85rem' }}>
                    Traint deze duif élke dag in snelheid, conditie én oriëntatie (tot 100) plus ervaring — puur om beter te racen, niet voor libido.
                    {state?.economy && (
                      <> Geen instapkost — enkel <Money value={state.economy.coachSalary} />/dag zolang de coach aan het werk is.</>
                    )}
                  </div>
                  {state?.economy && p.revealed && (() => {
                    const eco = state.economy;
                    const gain = (attr: number | null) =>
                      Math.round(eco.coachMaxDailyGain * Math.max(0, (eco.coachAttributeCap - (attr ?? 0)) / eco.coachAttributeCap) * 100) / 100;
                    const gs = gain(p.speed);
                    const ge = gain(p.endurance);
                    const go = gain(p.orientation);
                    return (
                      <div className="notice" style={{ margin: '8px 0 0', fontSize: '0.82rem', lineHeight: 1.5 }}>
                        <strong>Voor {p.name} nu:</strong> per dag ± snelheid <strong>+{gs.toFixed(2)}</strong>, conditie{' '}
                        <strong>+{ge.toFixed(2)}</strong>, oriëntatie <strong>+{go.toFixed(2)}</strong>, ervaring{' '}
                        <strong>+{eco.coachExpDailyGain.toFixed(2)}</strong>.
                        <br />
                        De winst wordt <strong>kleiner naarmate een eigenschap richting 100 gaat</strong>: een jonge/zwakke
                        duif ontwikkelt snel, een sterke duif verfijnt traag. Zo blijft een uitgetrainde duif een echte prestatie.
                      </div>
                    );
                  })()}
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

              {/* Rustkuur — max. één per hok per week */}
              {(() => {
                const lockedUntil = !p.onCure ? state?.loft?.restCureAvailableAt ?? null : null;
                const weeklyLock = !!lockedUntil;
                return (
                  <div className="row" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>🛌 Rustkuur</strong>
                      <div className="faint" style={{ fontSize: '0.85rem' }}>
                        {p.onCure
                          ? <>Deze duif rust en kan niet vliegen tot <strong>{formatFlightTime(p.cureUntil ?? '')}</strong>. Daarna krijgt ze er energie bij.</>
                          : weeklyLock
                            ? <>Je gebruikte je rustkuur van deze week al. Er kan er <strong>maar één per week</strong> — de volgende vanaf <strong>{formatFlightTime(lockedUntil!)}</strong>.</>
                            : state?.economy
                              ? <>Een dag verplicht rusten voor <Money value={state.economy.restCureCost} />: daarna +{state.economy.restCureEnergy} energie. Ze kan tijdens de kuur niet vliegen. <strong>Max. één duif per week.</strong></>
                              : 'Een dag rust die energie oplevert, maar geld kost. Max. één per week.'}
                      </div>
                    </div>
                    {p.onCure ? (
                      <span className="badge" style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)', flexShrink: 0 }}>🛌 op rustkuur</span>
                    ) : (
                      <button
                        className="btn sm"
                        style={{ flexShrink: 0 }}
                        disabled={busy || (p.form ?? 0) >= 100 || p.racing || weeklyLock}
                        title={(p.form ?? 0) >= 100 ? 'Al vol energie' : p.racing ? 'Schrijf ze eerst uit voor haar vlucht' : weeklyLock ? 'Je rustkuur van deze week is op' : 'Start een rustkuur'}
                        onClick={() => startRestCure()}
                      >
                        Start rustkuur
                      </button>
                    )}
                  </div>
                );
              })()}

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
