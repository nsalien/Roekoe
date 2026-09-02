/** Single pigeon: full stats, pedigree and training controls. */

import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { PigeonAvatar } from '../components/PigeonAvatar';
import { BreedBadge, Money, PigeonStats, SexBadge, Spinner, formatFlightTime, useToast } from '../components/ui';
import type { AncestorNode, FamilyTree, Pigeon, RaceHistoryRow } from '../types';
import { Pedigree } from '../components/Pedigree';

interface PigeonDetail {
  pigeon: Pigeon;
  sire: Pigeon | null;
  dam: Pigeon | null;
  mine: boolean;
  pedigree: AncestorNode | null;
  family: FamilyTree | null;
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
  const [confirmPart, setConfirmPart] = useState<null | 'release' | 'restaurant'>(null);

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

  // Get rid of a pigeon for good: release it (no money) or sell it to the soup
  // restaurant (fixed sum, morale hit on the rest). The bird is gone afterwards,
  // so navigate back to the loft instead of reloading this (now-missing) page.
  async function partWays(kind: 'release' | 'restaurant') {
    setBusy(true);
    try {
      await api(`/pigeons/${p.id}/${kind}`, { method: 'POST' });
      toast.show(kind === 'release' ? 'Duif vrijgelaten 🕊️' : 'Verkocht aan het restaurant 🍲', 'ok');
      await refresh();
      nav('/hok');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
      setBusy(false);
    }
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
                <BreedBadge breed={p.breed} />
                {p.quirk && (
                  <span
                    className="badge"
                    style={{ background: 'rgba(168,85,247,0.16)', color: '#a855f7' }}
                    title={p.quirk.description}
                  >
                    {p.quirk.emoji} {p.quirk.name}
                  </span>
                )}
                {p.forSale && <span className="badge sale">te koop · <Money value={p.price ?? 0} /></span>}
                {p.forSale && p.minBid != null && (
                  <span className="badge" title="Kopers mogen vanaf dit bedrag een bod doen dat jij aanvaardt of weigert">
                    bieden vanaf <Money value={p.minBid} />
                  </span>
                )}
                {p.ailment && (
                  <span className="badge" style={{ background: p.ailment.kind === 'ziekte' ? 'var(--bad-soft)' : 'var(--gold-soft)', color: p.ailment.kind === 'ziekte' ? 'var(--bad)' : 'var(--gold)' }}>
                    {p.ailment.kind === 'ziekte' ? '🤒' : '🩹'} {p.ailment.name}
                  </span>
                )}
                {p.inInfirmary && <span className="badge" style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)' }}>🏥 in ziekenboeg</span>}
                {p.away && (
                  <span
                    className="badge"
                    title="Ze is op haar laatste vlucht de weg kwijtgeraakt. Duiven vinden hun weg terug — ze komt vanzelf thuis, maar uitgeput."
                    style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}
                  >
                    🧭 nog niet thuis{p.awayUntil ? ` · terug rond ${formatFlightTime(p.awayUntil)}` : ''}
                  </span>
                )}
                {p.coached && <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>🎯 coach</span>}
                {(p.titles ?? []).map((t, i) => (
                  <span
                    key={`${t.kind}-${t.season}-${i}`}
                    className="badge"
                    title={`Gewonnen na seizoen ${t.season} met ${t.value} criteriumpunten. Deze titel blijft bij de duif, ook als ze verkocht wordt.`}
                    style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}
                  >
                    {t.icon} {t.label}
                  </span>
                ))}
                {p.revealed && p.formLabel && (
                  <span
                    className="badge"
                    title={
                      `Vluchtvorm ${p.flightForm} — energie en gezondheid samen, de laagste van de twee telt dubbel,` +
                      ' en een recente vlucht is er al van afgetrokken.' +
                      ' Hoe lager, hoe groter de kans op een blessure door overbelasting.'
                    }
                    style={
                      p.formLabel === 'fris'
                        ? { background: 'var(--good-soft)', color: 'var(--good)' }
                        : p.formLabel === 'matig'
                          ? { background: 'var(--gold-soft)', color: 'var(--gold)' }
                          : { background: 'var(--bad-soft)', color: 'var(--bad)' }
                    }
                  >
                    {p.formLabel === 'fris' ? '🟢' : p.formLabel === 'matig' ? '🟡' : '🔴'} vorm {p.flightForm}
                  </span>
                )}
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                {Math.floor(p.ageWeeks / 52) > 0 ? `${Math.floor(p.ageWeeks / 52)}j ` : ''}{p.ageWeeks % 52} wk oud ·
                {p.canRace ? ' klaar om te vliegen' : ' nog niet vluchtklaar'}
              </p>
              <div className="faint">Geschatte waarde <Money value={p.value} /> · eigenaar {p.ownerName}</div>
            </div>
          </div>

          <hr className="sep" />
          {/* An admin sees every bird's attributes (the Duif-inspector links here);
              flag it so it is clear this view is not what other players get. */}
          {p.revealed && !mine && state?.isAdmin && (
            <p className="faint" style={{ margin: '0 0 8px', fontSize: '0.8rem' }}>
              🛠️ Je ziet deze eigenschappen als <strong>beheerder</strong> — gewone spelers zien enkel ★ talent.
            </p>
          )}
          {p.revealed ? (
            <PigeonStats pigeon={p} />
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              🔒 Eigenschappen van andermans duiven zijn verborgen — enkel ★ talent {p.talent} is gekend.
              Kijk naar de <Link to="/ranglijst">ranglijst</Link> of haar vluchtresultaten.
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
              <p className="muted" style={{ marginBottom: 4 }}>
                ~+1 per beurt · <strong>1× per week</strong> per eigenschap · tot <strong>80</strong>.
              </p>
              <p className="faint" style={{ margin: 0, fontSize: '0.82rem' }}>
                <Link to="/wiki#genen">Meer over training &amp; plafonds →</Link>
              </p>
              <div className="stack" style={{ marginTop: 8 }}>
                {([
                  ['speed', 'snelheid'],
                  ['endurance', 'conditie'],
                  ['orientation', 'oriëntatie'],
                ] as const).map(([attr, label]) => {
                  const until = p.trainAvailableAt[attr];
                  const info = p.training?.[attr];
                  const cur = p[attr] ?? 0;
                  const atCap = info ? cur >= info.cap : false;
                  const Label = label.charAt(0).toUpperCase() + label.slice(1);
                  return (
                    <button
                      key={attr}
                      className="btn"
                      disabled={busy || !!until || atCap}
                      title={
                        until
                          ? `Deze week al getraind — opnieuw vanaf ${formatFlightTime(until)}`
                          : atCap
                            ? `Op het handmatige plafond (${info?.cap}) — verder via vluchten (tot 90) en coach`
                            : undefined
                      }
                      onClick={() => train(attr)}
                    >
                      {until
                        ? `🔒 ${Label} — weer vanaf ${formatFlightTime(until)}`
                        : atCap
                          ? `🔒 ${Label} — plafond ${info?.cap} bereikt`
                          : <>Train {label} · <Money value={info?.cost ?? 0} /></>}
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
                  Ook al staat {p.name} niet te koop. Je bod blijft staan tot {p.ownerName} antwoordt — intrekken kan
                  via de <strong>Markt</strong>.
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
                  {/* Keep this to the two things that decide the click: what it costs
                      per day and what THIS bird gains. The mechanics live in the wiki. */}
                  <div className="faint" style={{ fontSize: '0.85rem' }}>
                    Traint deze duif elke dag richting haar genetische plafond — de enige weg <strong>boven 90</strong>.
                    {state?.economy && <> <Money value={state.economy.coachSalary} />/dag, geen instapkost.</>}
                  </div>
                  {p.revealed && p.coachGain && (() => {
                    const cg = p.coachGain;
                    const any = cg.speed > 0 || cg.endurance > 0 || cg.orientation > 0;
                    return any ? (
                      <div className="notice" style={{ margin: '8px 0 0', fontSize: '0.82rem', lineHeight: 1.5 }}>
                        <strong>Voor {p.name}, per dag:</strong> snelheid <strong>+{cg.speed.toFixed(2)}</strong> · conditie{' '}
                        <strong>+{cg.endurance.toFixed(2)}</strong> · oriëntatie <strong>+{cg.orientation.toFixed(2)}</strong> ·
                        ervaring <strong>+{(cg.experience ?? 0).toFixed(2)}</strong>
                      </div>
                    ) : (
                      <div className="notice" style={{ margin: '8px 0 0', fontSize: '0.82rem', lineHeight: 1.5 }}>
                        Voor {p.name} heeft een coach <strong>geen effect meer</strong> — alle drie de vaardigheden zitten op hun cap.
                      </div>
                    );
                  })()}
                  <div className="faint" style={{ fontSize: '0.82rem', marginTop: 6 }}>
                    <Link to="/wiki#coach">Meer info over de privécoach →</Link>
                  </div>
                </div>
                {p.coached ? (
                  <button className="btn ghost sm" style={{ flexShrink: 0 }} disabled={busy} onClick={() => setCoach(false)}>Ontslaan</button>
                ) : (
                  <button className="btn accent sm" style={{ flexShrink: 0 }} disabled={busy} onClick={() => setCoach(true)}>Inhuren</button>
                )}
              </div>

              <hr className="sep" />

              {/* Rustkuur — elke duif mag, maar elke duif maar één keer per week */}
              {(() => {
                const full = (p.form ?? 0) >= 100 && (p.health ?? 0) >= 100;
                const lockedUntil = !p.onCure ? p.restCureAvailableAt : null;
                const locked = !!lockedUntil;
                return (
                  <div className="row" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>🛌 Rustkuur</strong>
                      <div className="faint" style={{ fontSize: '0.85rem' }}>
                        {p.onCure
                          ? <>Deze duif rust en kan niet vliegen tot <strong>{formatFlightTime(p.cureUntil ?? '')}</strong>. Daarna krijgt ze er energie én gezondheid bij.</>
                          : locked
                            ? <>{p.name} had deze week al een rustkuur. Elke duif kan er <strong>één per week</strong> — de volgende kan vanaf <strong>{formatFlightTime(lockedUntil!)}</strong>.</>
                            : state?.economy
                              ? <><strong>Twee dagen</strong> rust voor <Money value={state.economy.restCureCost} /> → +{state.economy.restCureEnergy} energie en +{state.economy.restCureHealth} gezondheid. Max. 1× per duif per week.</>
                              : 'Twee dagen rust die energie en gezondheid oplevert, maar geld kost. Eén per duif per week.'}
                      </div>
                      {!p.onCure && !locked && (
                        <div className="faint" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                          <Link to="/wiki#energie">Meer over rust &amp; herstel →</Link>
                        </div>
                      )}
                    </div>
                    {p.onCure ? (
                      <span className="badge" style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)', flexShrink: 0 }}>🛌 op rustkuur</span>
                    ) : (
                      <button
                        className="btn sm"
                        style={{ flexShrink: 0 }}
                        disabled={busy || full || p.racing || locked}
                        title={full ? 'Al vol energie en gezondheid' : p.racing ? 'Schrijf ze eerst uit voor haar vlucht' : locked ? 'Deze duif had deze week al een rustkuur' : 'Start een rustkuur'}
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
            <h2>Familie</h2>
            <div className="grid cols-2">
              <PedigreeBox label="Vader (doffer)" pigeon={sire} />
              <PedigreeBox label="Moeder (duivin)" pigeon={dam} />
            </div>
            {/* The parents above are the birds you can act on right now; the tree
                is the history, so it stays folded until asked for. */}
            <Pedigree root={data.pedigree} family={data.family} mineId={mine ? p.ownerId : undefined} />
          </div>

          {mine && (
            <div className="card" style={{ borderColor: 'var(--bad)' }}>
              <h2>⚠️ Afscheid nemen</h2>
              {p.racing ? (
                <p className="muted" style={{ margin: 0 }}>
                  🏁 {p.name} staat ingeschreven voor een vlucht. Schrijf haar eerst uit voor je afscheid kan nemen.
                </p>
              ) : (
                <>
                  {/* Vrijlaten — no money */}
                  <div className="row" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>🕊️ Vrijlaten</strong>
                      <div className="faint" style={{ fontSize: '0.85rem' }}>
                        {p.name} verdwijnt uit je hok. <strong>Geen geld</strong>, geen bijwerkingen.
                      </div>
                    </div>
                    {confirmPart === 'release' ? (
                      <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                        <button className="btn danger sm" disabled={busy} onClick={() => partWays('release')}>Zeker?</button>
                        <button className="btn ghost sm" disabled={busy} onClick={() => setConfirmPart(null)}>×</button>
                      </div>
                    ) : (
                      <button className="btn ghost sm" style={{ flexShrink: 0 }} disabled={busy} onClick={() => setConfirmPart('release')}>Vrijlaten</button>
                    )}
                  </div>

                  <hr className="sep" />

                  {/* Verkoop aan het duivenrestaurant — fixed sum, morale hit */}
                  <div className="row" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>🍲 Verkoop aan {state?.economy?.restaurantName ?? 'het duivenrestaurant'}</strong>
                      <div className="faint" style={{ fontSize: '0.85rem' }}>
                        {state?.economy ? (
                          <>
                            Vast <Money value={state.economy.restaurantPayout} />, maar elke andere duif verliest{' '}
                            {state.economy.restaurantMoraleMin}–{state.economy.restaurantMoraleMax} energie (moraalklap).
                          </>
                        ) : (
                          <>Levert een klein vast bedrag op, maar drukt de moraal van je hele hok.</>
                        )}{' '}
                        <Link to="/wiki#afscheid">Meer info →</Link>
                      </div>
                    </div>
                    {confirmPart === 'restaurant' ? (
                      <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                        <button className="btn danger sm" disabled={busy} onClick={() => partWays('restaurant')}>Zeker?</button>
                        <button className="btn ghost sm" disabled={busy} onClick={() => setConfirmPart(null)}>×</button>
                      </div>
                    ) : (
                      <button className="btn sm" style={{ flexShrink: 0 }} disabled={busy} onClick={() => setConfirmPart('restaurant')}>
                        Verkoop{state?.economy && <> <Money value={state.economy.restaurantPayout} /></>}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

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

