/** Mijn hok: all your pigeons with sorting and quick sell/withdraw actions. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { api } from '../api/client';
import { Money, Spinner, formatFlightTime, traitEntryHint, useToast } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { buildDaysTaken, canEnter, entryCost } from '../game/flightEntry';
import { PigeonCard } from '../components/PigeonCard';
import { LoftView } from '../components/LoftView';
import type { FeedRation, Flight, Loft, Pigeon } from '../types';

type SortKey = 'talent' | 'speed' | 'endurance' | 'orientation' | 'form' | 'ageWeeks';

export function LoftPage() {
  const { state, loading, refresh } = useGame();
  const toast = useToast();
  const [sort, setSort] = useState<SortKey>('talent');
  const [busy, setBusy] = useState(false);
  const [sellFor, setSellFor] = useState<string | null>(null);
  const [price, setPrice] = useState(0);
  // "Bieden vanaf" is optioneel: leeg = enkel koop-nu, zoals vroeger.
  const [minBid, setMinBid] = useState<string>('');
  const { user } = useAuth();

  // The flight calendar, so each bird can be entered from here (the same rules
  // as the Vluchten page: game/flightEntry.ts). Fetched once on arrival and
  // after an entry — not polled, this page is not a live view.
  const [flights, setFlights] = useState<{ scheduled: Flight[]; all: Flight[] } | null>(null);
  const loadFlights = useCallback(async () => {
    try {
      const res = await api<{ scheduled: Flight[]; live: Flight[]; completed: Flight[] }>('/flights');
      setFlights({ scheduled: res.scheduled, all: [...res.scheduled, ...res.live, ...res.completed] });
    } catch { /* the page works without it; the entry picker just stays hidden */ }
  }, []);
  useEffect(() => { loadFlights(); }, [loadFlights]);
  const daysTaken = useMemo(() => buildDaysTaken(flights?.all ?? [], user?.id), [flights, user]);

  if (loading || !state) return <Spinner />;
  const pigeons = [...state.pigeons].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
  const traitIdx = pigeons.findIndex((p) => p.trait);

  async function act(fn: () => Promise<unknown>, ok?: string, reloadFlights = false) {
    setBusy(true);
    try {
      await fn();
      await Promise.all([refresh(), reloadFlights ? loadFlights() : null]);
      if (ok) toast.show(ok, 'ok');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  function beginSell(p: Pigeon) {
    setSellFor(p.id);
    setPrice(p.value);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Mijn hok</h1>
          <p className="muted">
            {state.loft?.pigeonCount} duiven · capaciteit {state.loft?.capacity} ·{' '}
            <Link to="/inrichting">🧰 uitbreiden, stro, inrichting &amp; vaccins →</Link>
          </p>
        </div>
        <label className="row" style={{ gap: 8, marginBottom: 0 }}>
          <span className="faint">Sorteer</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ width: 'auto' }}>
            <option value="talent">Talent</option>
            <option value="speed">Snelheid</option>
            <option value="endurance">Conditie</option>
            <option value="orientation">Oriëntatie</option>
            <option value="form">Energie</option>
            <option value="ageWeeks">Leeftijd</option>
          </select>
        </label>
      </div>

      {state.loft && (
        <LoftView
          loft={state.loft}
          pigeons={state.pigeons}
          busy={busy}
          onAssignCompartment={(id) => act(() => api(`/pigeons/${id}/compartment`, { method: 'POST', body: { on: true } }))}
        />
      )}

      <div className="grid pigeons">
        {pigeons.map((p, idx) => (
          <PigeonCard
            key={p.id}
            pigeon={p}
            to={`/duif/${p.id}`}
            // "pigeon" = the first card (main tour); "trait" = the first bird with a
            // kenmerk, or the first card when there is none (seizoen 3 news run).
            tourId={[idx === 0 ? 'pigeon' : '', idx === Math.max(0, traitIdx) ? 'trait' : ''].filter(Boolean).join(' ') || undefined}
          >
            {/* Per-pigeon feeding + private compartment */}
            <div className="row" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <select
                value={p.ration}
                disabled={busy}
                data-tour={idx === 0 ? 'ration' : undefined}
                title="Voerschema van deze duif"
                onChange={(e) => act(() => api(`/pigeons/${p.id}/ration`, { method: 'POST', body: { ration: e.target.value } }))}
                style={{ flex: 1, minWidth: 90, width: 'auto', ...((state.loft?.food[p.ration] ?? 0) <= 0 ? { borderColor: 'var(--bad)', color: 'var(--bad)' } : {}) }}
              >
                {(Object.keys(state.feedRations) as FeedRation[]).map((k) => {
                  const kg = state.loft?.food[k] ?? 0;
                  return (
                    <option key={k} value={k}>
                      {kg <= 0 ? '⚠️' : '🍽'} {state.feedRations[k].label} ({Math.round(kg)} kg)
                    </option>
                  );
                })}
              </select>
              {(state.loft?.food[p.ration] ?? 0) <= 0 && (
                <span className="faint" style={{ color: 'var(--bad)', fontSize: '0.78rem', width: '100%' }}>
                  ⚠️ Geen voorraad {state.feedRations[p.ration].label.toLowerCase()} — koop bij op het dashboard.
                </span>
              )}
              {!p.inInfirmary ? (
                <button
                  className={`btn sm ${p.compartment ? 'accent' : 'ghost'}`}
                  data-tour={idx === 0 ? 'compartment' : undefined}
                  disabled={busy || (!p.compartment && (state.loft?.compartmentsUsed ?? 0) >= (state.loft?.compartments ?? 0))}
                  title={p.compartment ? 'Zit in een apart hok' : 'Zit samen met de anderen'}
                  onClick={() => act(() => api(`/pigeons/${p.id}/compartment`, { method: 'POST', body: { on: !p.compartment } }))}
                >
                  🧱 {p.compartment ? 'Apart' : 'Samen'}
                </button>
              ) : (
                <span
                  className="badge"
                  title="Deze duif rust in de ziekenboeg; haar hokplek (apart/samen) geldt zolang niet."
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)', alignSelf: 'center' }}
                >
                  🏥 Ziekenboeg
                </span>
              )}
            </div>
            {flights && (
              <PigeonFlightEntry
                pigeon={p}
                flights={flights.scheduled}
                daysTaken={daysTaken}
                userId={user?.id}
                busy={busy}
                onEnter={(flightId) =>
                  act(() => api(`/flights/${flightId}/enter`, { method: 'POST', body: { pigeonId: p.id } }), 'Ingeschreven!', true)}
                onWithdraw={(flightId) =>
                  act(() => api(`/flights/${flightId}/withdraw`, { method: 'POST', body: { pigeonId: p.id } }), 'Uitgeschreven', true)}
              />
            )}
            {sellFor === p.id ? (
              <div className="stack" style={{ gap: 6 }}>
                <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <span className="faint sm" style={{ minWidth: 92 }}>Marktprijs</span>
                  <input
                    type="number"
                    value={price}
                    min={1}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    style={{ maxWidth: 110 }}
                  />
                </label>
                <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <span className="faint sm" style={{ minWidth: 92 }}>Bieden vanaf</span>
                  <input
                    type="number"
                    value={minBid}
                    min={1}
                    placeholder="optioneel"
                    onChange={(e) => setMinBid(e.target.value)}
                    style={{ maxWidth: 110 }}
                  />
                </label>
                <span className="faint sm">
                  Wie de marktprijs betaalt, koopt haar meteen. Vul je een ondergrens in, dan mogen anderen
                  vanaf dat bedrag een bod doen dat jij aanvaardt of weigert. Nooit onder 1/5 van haar waarde:
                  minstens <Money value={p.minPrice ?? 0} />.
                </span>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn sm"
                    disabled={busy || price <= 0 || price < (p.minPrice ?? 0) || (minBid !== '' && (Number(minBid) > price || Number(minBid) < (p.minPrice ?? 0)))}
                    onClick={() => act(() => api('/market/list', { method: 'POST', body: { pigeonId: p.id, price, minBid: minBid === '' ? null : Number(minBid) } }), 'Te koop gezet').then(() => { setSellFor(null); setMinBid(''); })}
                  >
                    Bevestig
                  </button>
                  <button className="btn ghost sm" onClick={() => { setSellFor(null); setMinBid(''); }}>Annuleer</button>
                </div>
                {minBid !== '' && Number(minBid) > price && (
                  <span className="notice err sm">De ondergrens mag niet boven je marktprijs liggen.</span>
                )}
                {(price < (p.minPrice ?? 0) || (minBid !== '' && Number(minBid) < (p.minPrice ?? 0))) && (
                  <span className="notice err sm">Onder 1/5 van haar waarde kan niet: minstens <Money value={p.minPrice ?? 0} />.</span>
                )}
              </div>
            ) : (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="faint stack" style={{ gap: 2 }}>
                  <span>Waarde <Money value={p.value} /></span>
                  {/* Prize money she has won for you, all flights together. */}
                  <span title="Totaal prijzengeld dat deze duif voor jou won, over al haar vluchten">
                    Opgebracht <Money value={p.earnings ?? 0} />
                  </span>
                </span>
                {p.forSale ? (
                  <button className="btn secondary sm" disabled={busy} onClick={() => act(() => api('/market/unlist', { method: 'POST', body: { pigeonId: p.id } }), 'Uit de verkoop')}>
                    Uit verkoop
                  </button>
                ) : (
                  <button className="btn ghost sm" disabled={busy} onClick={() => beginSell(p)}>Verkoop</button>
                )}
              </div>
            )}
          </PigeonCard>
        ))}
      </div>
    </div>
  );
}

/**
 * Enter ONE bird from her own card: the flights she can still go on (same rules
 * as the Vluchten page), with the kenmerk hint per flight, plus the flights she
 * is already booked on — so a player can match bird to flight without switching
 * pages. A relay entry here takes the next free leg; the running order is set
 * on the Vluchten page.
 */
function PigeonFlightEntry({
  pigeon, flights, daysTaken, userId, busy, onEnter, onWithdraw,
}: {
  pigeon: Pigeon;
  flights: Flight[];
  daysTaken: Map<string, Set<string>>;
  userId: string | undefined;
  busy: boolean;
  onEnter: (flightId: string) => void;
  onWithdraw: (flightId: string) => void;
}) {
  const [sel, setSel] = useState('');
  const booked = flights.filter((f) => f.entries.some((e) => e.pigeonId === pigeon.id));
  const open = flights.filter((f) => canEnter(pigeon, f, daysTaken, userId));
  if (booked.length === 0 && open.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 4, marginBottom: 6 }}>
      {booked.map((f) => (
        <div key={f.id} className="row faint" style={{ gap: 6, fontSize: '0.82rem', alignItems: 'center' }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            🏁 <Link to="/vluchten">{f.name}</Link> · {formatFlightTime(f.startAt)}
          </span>
          <button className="btn ghost sm" style={{ padding: '0 6px' }} disabled={busy} title="Uitschrijven" onClick={() => onWithdraw(f.id)}>
            ✕
          </button>
        </div>
      ))}
      {open.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ flex: 1, minWidth: 0 }} title="Inschrijven voor een vlucht">
            <option value="">🏁 Inschrijven voor…</option>
            {open.map((f) => {
              const cost = entryCost(f, userId);
              const hint = traitEntryHint(pigeon.trait, f.distanceKm);
              return (
                <option key={f.id} value={f.id}>
                  {formatFlightTime(f.startAt)} · {f.name} · {f.distanceKm} km · {cost > 0 ? `€${cost}` : 'gratis'}{hint ? ` ${hint}` : ''}
                </option>
              );
            })}
          </select>
          <button className="btn sm" disabled={busy || !sel} onClick={() => { onEnter(sel); setSel(''); }}>
            Inschrijven
          </button>
        </div>
      )}
    </div>
  );
}
