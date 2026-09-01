/** Vluchten: upcoming races (with route + start time), live races and results. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { useVisiblePoll } from '../game/useVisiblePoll';
import { Money, Spinner, countdownTo, formatDuration, formatFlightDay, formatFlightDayShort, formatFlightTime, tierLabel, useToast } from '../components/ui';
import type { BetKind, BetPreview, BetView, Flight, FlightEntrant } from '../types';

/** A ticking clock so countdowns update every second. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * The three families the calendar can be filtered by — the same split the rules
 * use: only `competition` feeds the melkerranglijst (§15.2 spelregels), the
 * criterium has its own standing (§2.10) and the rest is prize money only.
 *
 * Oefenvluchten sit with titan/estafette rather than in a fourth bucket: they
 * share the property a player filters on here — no seizoenspunten.
 */
type FlightFamily = 'competition' | 'special' | 'cup';

const FAMILIES: { id: FlightFamily | 'all'; label: string }[] = [
  { id: 'all', label: 'Alles' },
  { id: 'competition', label: '\ud83c\udfc1 Competitie' },
  { id: 'special', label: '\ud83c\udfc6 Buiten competitie' },
  { id: 'cup', label: '\ud83c\udf82 Criterium' },
];

function flightFamily(f: Flight): FlightFamily {
  if (f.ageCat) return 'cup';
  if (f.relay || f.titan || f.practice) return 'special';
  return 'competition';
}

/** The calendar day a flight belongs to — the very key the one-race-per-day rule
 *  uses server-side (`flightDay` in core/game/flight.ts), so the grouping here and
 *  the "already booked that day" check can never disagree. */
const flightDay = (f: Flight) => f.startAt.slice(0, 10);

export function FlightsPage() {
  const { user } = useAuth();
  const { state, refresh } = useGame();
  const toast = useToast();
  const now = useNow();
  const [scheduled, setScheduled] = useState<Flight[]>([]);
  const [live, setLive] = useState<Flight[]>([]);
  const [completed, setCompleted] = useState<Flight[]>([]);
  const [tab, setTab] = useState<'scheduled' | 'results'>('scheduled');
  const [busy, setBusy] = useState(false);
  // Calendar filters. The kalender mixes three formats over four or five days,
  // which reads as one long chronological wall; these two rows let a player look
  // at one day, or at one kind of race, without losing the overview.
  const [family, setFamily] = useState<FlightFamily | 'all'>('all');
  const [day, setDay] = useState<string>('all');

  const [bets, setBets] = useState<BetView[]>([]);

  const load = useCallback(async () => {
    const res = await api<{ scheduled: Flight[]; live: Flight[]; completed: Flight[] }>('/flights');
    setScheduled(res.scheduled);
    setLive(res.live);
    setCompleted(res.completed);
  }, []);
  const loadBets = useCallback(async () => {
    const res = await api<{ bets: BetView[] }>('/bets');
    setBets(res.bets);
  }, []);
  useEffect(() => {
    load();
    loadBets();
  }, [load, loadBets, state?.world.currentWeek]);

  // Reload periodically so flights flip to live / completed without a manual
  // refresh. Kept deliberately slow — see the note in LiveFlightPage: every poll
  // costs ~350 D1 rows and the daily read budget is the binding limit. A tab
  // left open in the background polls not at all.
  useVisiblePoll(() => load(), 90000);

  // One race per bird per day (the hard rule, see enterFlight). A bird's day is
  // spent the moment it is on ANY flight of that day — scheduled, live, or long
  // since flown — so we map each of our birds to the days it is already booked
  // on. Flights that were called off don't count: nobody flew those.
  const daysTaken = useMemo(() => {
    const map = new Map<string, Set<string>>(); // pigeonId → days (YYYY-MM-DD)
    for (const f of [...scheduled, ...live, ...completed]) {
      if (f.cancelled) continue;
      const day = f.startAt.slice(0, 10);
      for (const e of f.entries) {
        if (e.ownerId !== user?.id) continue;
        let days = map.get(e.pigeonId);
        if (!days) map.set(e.pigeonId, (days = new Set<string>()));
        days.add(day);
      }
    }
    return map;
  }, [scheduled, live, completed, user]);

  // Flights the player already has an open bet on (max one bet per flight).
  const betFlights = useMemo(() => {
    const set = new Set<string>();
    for (const b of bets) if (b.status === 'open') set.add(b.flightId);
    return set;
  }, [bets]);

  const familyCounts = useMemo(() => {
    const c: Record<FlightFamily | 'all', number> = { all: scheduled.length, competition: 0, special: 0, cup: 0 };
    for (const f of scheduled) c[flightFamily(f)]++;
    return c;
  }, [scheduled]);

  const byFamily = useMemo(
    () => scheduled.filter((f) => family === 'all' || flightFamily(f) === family),
    [scheduled, family],
  );

  // The day chips follow the type filter, so the selected day can disappear from
  // under the player (pick "vrijdag", then switch to Criterium). Fall back to all
  // days rather than showing an empty calendar with a day still highlighted.
  const dayKeys = useMemo(() => {
    const seen = new Map<string, string>(); // day → the ISO start of its first flight
    for (const f of byFamily) if (!seen.has(flightDay(f))) seen.set(flightDay(f), f.startAt);
    return [...seen].map(([key, startAt]) => ({ key, startAt }));
  }, [byFamily]);
  useEffect(() => {
    if (day !== 'all' && !dayKeys.some((d) => d.key === day)) setDay('all');
  }, [dayKeys, day]);

  /** The shown flights, grouped per calendar day. `scheduled` already arrives
   *  chronologically from the server, so one pass is enough. */
  const dayGroups = useMemo(() => {
    const out: { day: string; flights: Flight[] }[] = [];
    for (const f of byFamily) {
      if (day !== 'all' && flightDay(f) !== day) continue;
      const key = flightDay(f);
      const last = out[out.length - 1];
      if (last && last.day === key) last.flights.push(f);
      else out.push({ day: key, flights: [f] });
    }
    return out;
  }, [byFamily, day]);

  // Exactly one tour anchor, on whatever card is at the top of the page.
  const tourFlightId = live[0]?.id ?? dayGroups[0]?.flights[0]?.id;

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      await refresh();
      if (ok) toast.show(ok, 'ok');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <Spinner />;

  return (
    <div>
      <div className="page-head">
        <h1>Vluchten</h1>
        <div className="pill-tabs">
          <button className={tab === 'scheduled' ? 'active' : ''} onClick={() => setTab('scheduled')}>Kalender</button>
          <button className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}>Uitslagen</button>
        </div>
      </div>

      {tab === 'scheduled' && (
        <div className="stack">
          {bets.filter((b) => b.status === 'open').length > 0 && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>🎲 Jouw lopende weddenschappen</h2>
              <div className="stack" style={{ gap: 6 }}>
                {bets.filter((b) => b.status === 'open').map((b) => (
                  <div key={b.id} className="row" style={{ justifyContent: 'space-between', gap: 8, fontSize: '0.9rem' }}>
                    <span>{betLabel(b)} <span className="faint">· {b.flightName}</span></span>
                    <span className="faint">inzet <Money value={b.stake} /> · bij winst <strong><Money value={b.potentialWin} /></strong></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live races first, and deliberately OUTSIDE the filters below: a race
              that is running right now is never something you want hidden because
              you happened to be looking at Friday. */}
          {live.length > 0 && (
            <div className="day-head">
              <h3>🔴 Nu bezig</h3>
              <span className="faint">{live.length} vlucht{live.length === 1 ? '' : 'en'} onderweg</span>
            </div>
          )}
          {live.map((f) => (
            <div key={f.id} className="card" style={{ borderColor: 'var(--accent)' }} data-tour={f.id === tourFlightId ? 'flights' : undefined}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="badge" style={{ background: 'var(--accent)', color: '#fff' }}>🔴 LIVE</span>
                    <strong>{f.name}</strong>
                  </div>
                  <div className="faint">{f.fromCity} → {f.toCity} · {f.distanceKm} km · {f.entryCount} duiven</div>
                </div>
                <Link to={`/vluchten/${f.id}`} className="btn accent">Bekijk live →</Link>
              </div>
            </div>
          ))}

          {scheduled.length > 0 && (
            <div className="stack" style={{ gap: 6, marginTop: live.length > 0 ? 8 : 0 }}>
              <div className="chip-row">
                {FAMILIES.map((t) => (
                  <button
                    key={t.id}
                    className={`chip ${family === t.id ? 'active' : ''}`}
                    onClick={() => setFamily(t.id)}
                  >
                    {t.label}<span className="n">{familyCounts[t.id]}</span>
                  </button>
                ))}
              </div>
              {dayKeys.length > 1 && (
                <div className="chip-row">
                  <button className={`chip ${day === 'all' ? 'active' : ''}`} onClick={() => setDay('all')}>Alle dagen</button>
                  {dayKeys.map((d) => (
                    <button key={d.key} className={`chip ${day === d.key ? 'active' : ''}`} onClick={() => setDay(d.key)}>
                      {formatFlightDayShort(d.startAt, now)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {dayGroups.length === 0 && (scheduled.length > 0 || live.length === 0) && (
            <div className="card muted">
              {scheduled.length === 0
                ? 'Geen vluchten gepland. Kom straks terug!'
                : 'Geen vluchten in deze selectie. Kies een andere soort of dag.'}
            </div>
          )}

          {dayGroups.map((g) => {
            const enteredHere = g.flights.filter((f) => f.entries.some((e) => e.ownerId === user?.id)).length;
            return (
              <div key={g.day} className="stack">
                <div className="day-head">
                  <h3>{formatFlightDay(g.flights[0].startAt, now)}</h3>
                  <span className="faint">
                    {g.flights.length} vlucht{g.flights.length === 1 ? '' : 'en'}
                    {enteredHere > 0 && <> · {enteredHere}× ingeschreven</>}
                  </span>
                </div>
                {g.flights.map((f) => {
                  const myEntries = f.entries.filter((e) => e.ownerId === user?.id);
                  const dayKey = flightDay(f);
                  // Birds the day rule alone keeps out of the picker — worth one line,
                  // otherwise a bird just silently disappears from the list. Birds on
                  // THIS flight are not "blocked": they are exactly where you put them.
                  const onThisFlight = new Set(myEntries.map((e) => e.pigeonId));
                  const dayBlocked = state.pigeons.filter(
                    (p) => p.canRace && !p.breeding && !onThisFlight.has(p.id) && daysTaken.get(p.id)?.has(dayKey),
                  ).length;
                  const available = state.pigeons.filter(
                    (p) =>
                      p.canRace && !p.racing && !daysTaken.get(p.id)?.has(dayKey) && !p.breeding && (p.form ?? 0) >= 1 &&
                      // A leeftijdscriterium takes one age bracket only. The server refuses
                      // the rest anyway; hiding them here keeps the picker honest instead of
                      // offering a bird that is guaranteed to bounce.
                      (!f.ageCat || p.ageCat === f.ageCat),
                  );
                  return (
                    <div key={f.id} className="card" data-tour={f.id === tourFlightId ? 'flights' : undefined}>
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div className="row" style={{ gap: 8 }}>
                            <h2 style={{ margin: 0 }}>{f.name}</h2>
                            {f.relay
                              ? <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>🔗 Estafettevlucht</span>
                              : f.titan
                                ? <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>🏆 Titanenwedstrijd</span>
                                : f.practice
                                  ? <span className="badge" style={{ background: 'var(--surface-2)' }}>🌤️ Oefenvlucht</span>
                                  : f.ageCat
                                    ? <>
                                        <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
                                          {f.ageCatIcon} Criterium {f.ageCatShort}
                                        </span>
                                        <span className="badge" style={{ background: 'var(--surface-2)' }}>
                                          {f.cupSprint ? '🏁 Sprint' : '🛰️ Grote fond'}
                                        </span>
                                      </>
                                    : <span className={`badge ${f.type}`}>{tierLabel(f.type)}</span>}
                          </div>
                          <div className="faint" style={{ marginTop: 2 }}>
                            🕊️ {f.fromCity} → {f.toCity} · {f.distanceKm} km
                            {f.relay && <> ({f.teamSize} × {f.legKm} km)</>}
                            {' · '}
                            {f.practice ? 'gratis' : <>inschrijfgeld <Money value={f.entryFee} /></>}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 800 }}>{formatFlightTime(f.startAt)}</div>
                          <div className="faint">{countdownTo(f.startAt, now)}</div>
                        </div>
                      </div>

                      {myEntries.length > 0 && (
                        <div className="row" style={{ gap: 6, marginTop: 10 }}>
                          {myEntries.map((e) => {
                            const p = state.pigeons.find((x) => x.id === e.pigeonId);
                            return (
                              <span key={e.pigeonId} className="badge" style={{ background: 'var(--surface-2)' }}>
                                🕊️ {p?.name ?? 'duif'}
                                <button
                                  className="btn ghost sm"
                                  style={{ padding: '0 6px', marginLeft: 4 }}
                                  disabled={busy}
                                  onClick={() => act(() => api(`/flights/${f.id}/withdraw`, { method: 'POST', body: { pigeonId: e.pigeonId } }))}
                                >
                                  ✕
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {f.relay && (
                        <RelayPlan
                          flight={f}
                          myPigeonNames={new Map(state.pigeons.map((p) => [p.id, p.name]))}
                          myUserId={user?.id}
                          busy={busy}
                          onReorder={(ids) =>
                            act(() => api(`/flights/${f.id}/relay-order`, { method: 'POST', body: { pigeonIds: ids } }))
                          }
                        />
                      )}

                      <hr className="sep" />
                      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        {f.relay && myEntries.length >= (f.teamSize ?? 3) ? (
                          <span className="faint">🔗 Je ploeg is compleet ({f.teamSize} duiven). Wissel hierboven de volgorde tot de start.</span>
                        ) : f.titan && myEntries.length >= 1 ? (
                          <span className="faint">🏆 Je hebt je duif voor de titanenwedstrijd ingeschreven (max. één per hok).</span>
                        ) : f.ageCat && available.length === 0 ? (
                          <span className="faint">
                            {f.ageCatIcon} Je hebt op dit moment geen vluchtklare duif {f.ageCatLabel?.toLowerCase()}.
                          </span>
                        ) : (
                          <EnterControl
                            disabled={busy}
                            options={available.map((p) => ({
                              id: p.id,
                              // Energie AND vluchtvorm: the tank on its own says nothing about
                              // the injury risk (that is energie + gezondheid, minus the rest
                              // deduction for a recent race). `flightForm` is the value AFTER
                              // that deduction, so it is shown on its own — naming the
                              // deduction next to it only raised the question of whether it
                              // still had to come off.
                              label:
                                `${p.formLabel === 'fris' ? '🟢' : p.formLabel === 'matig' ? '🟡' : '🔴'} ${p.name} ` +
                                `(★${p.talent} · energie ${Math.round(p.form ?? 0)} · vorm ${p.flightForm ?? '?'})`,
                            }))}
                            onEnter={(pigeonId) => act(() => api(`/flights/${f.id}/enter`, { method: 'POST', body: { pigeonId } }), 'Ingeschreven!')}
                          />
                        )}
                        <span className="faint" style={{ flexShrink: 0 }}>
                          {f.relay
                            ? `${(f.teams ?? []).filter((t) => t.complete).length} ploegen ingeschreven`
                            : `${f.entryCount} ingeschreven`}
                        </span>
                      </div>

                      {dayBlocked > 0 && (
                        <p className="faint" style={{ marginTop: 8, marginBottom: 0 }}>
                          🗓️ {dayBlocked === 1 ? 'Eén duif staat' : `${dayBlocked} duiven staan`} die dag al op een
                          andere vlucht — een duif vliegt <strong>maar één vlucht per dag</strong>.{' '}
                          <Link to="/wiki#een-per-dag">Meer info →</Link>
                        </p>
                      )}

                      {/* One line with the rules that change what you DO here; the full
                          format (prizes, ranking rules, tactics) lives in the wiki. */}
                      {f.relay && (
                        <p className="faint" style={{ marginTop: 10, marginBottom: 0 }}>
                          🔗 Ploeg van <strong>{f.teamSize} duiven</strong>, elk {f.legKm} km — één weg = hele ploeg weg. Enkel
                          prijzengeld (top 5), geen punten. <Link to="/wiki#estafette">Meer over de estafettevlucht →</Link>
                        </p>
                      )}
                      {f.titan && (
                        <p className="faint" style={{ marginTop: 10, marginBottom: 0 }}>
                          🏆 <strong>Eén duif per hok</strong>, enkel prijzengeld (top 3), geen punten. De enige vlucht vandaag.{' '}
                          <Link to="/wiki#titan">Meer over de titanenwedstrijd →</Link>
                        </p>
                      )}
                      {f.practice && (
                        <p className="faint" style={{ marginTop: 10, marginBottom: 0 }}>
                          🌤️ Korte training: lage energiekost, gratis, geen punten of prijzen — en geen risico.
                        </p>
                      )}
                      {f.ageCat && (
                        <p className="faint" style={{ marginTop: 10, marginBottom: 0 }}>
                          {f.ageCatIcon} Enkel duiven <strong>{f.ageCatLabel?.toLowerCase()}</strong>. Tot €{f.cupPrizes?.places[0]},
                          geen seizoenspunten. <Link to="/wiki#criterium">Meer over het criterium →</Link>
                        </p>
                      )}
                      {!f.practice && !f.titan && !f.relay && !f.ageCat && (() => {
                        const opensAt = Date.parse(f.startAt) - state.economy.betWindowHours * 3600000;
                        if (betFlights.has(f.id)) {
                          return (
                            <p className="notice" style={{ marginTop: 10, marginBottom: 0 }}>
                              🎲 Je hebt al een weddenschap lopen op deze vlucht.
                            </p>
                          );
                        }
                        if (f.bettingOpen) {
                          return <BetPanel flight={f} meId={user?.id} onPlaced={() => { loadBets(); refresh(); }} />;
                        }
                        if (now < opensAt) {
                          return (
                            <p className="faint" style={{ marginTop: 10, marginBottom: 0 }}>
                              🎲 Weddenschappen openen over <strong>{countdownTo(new Date(opensAt).toISOString(), now)}</strong>.
                            </p>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'results' && (
        <div className="stack">
          {bets.filter((b) => b.status !== 'open').length > 0 && (
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <h2 style={{ margin: 0 }}>🎲 Afgeronde weddenschappen</h2>
                <span className="faint">laatste 24 uur</span>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {bets.filter((b) => b.status !== 'open').map((b) => (
                  <div key={b.id} className="row" style={{ justifyContent: 'space-between', gap: 8, fontSize: '0.9rem' }}>
                    <span>{betLabel(b)} <span className="faint">· {b.flightName}</span></span>
                    <span className={b.status === 'won' ? 'good' : b.status === 'lost' ? 'bad' : 'faint'}>
                      {b.status === 'won' ? <>gewonnen +<Money value={b.potentialWin} /></> : b.status === 'lost' ? <>verloren −<Money value={b.stake} /></> : 'vervallen'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {completed.length === 0 && <div className="card muted">Nog geen uitslagen.</div>}
          {completed.map((f) => (
            <FlightResultCard key={f.id} flight={f} meId={user?.id} />
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_LABELS: Record<BetKind, string> = {
  win: 'Wint de vlucht',
  last: 'Eindigt allerlaatste',
  own_top3: 'Eigen duif in top 3',
  top3: 'Duif in top 3',
  mine_wins: 'Een van mijn duiven wint',
  head2head: 'Komt eerder thuis dan…',
};

function betLabel(b: BetView): string {
  if (b.kind === 'mine_wins') return 'Een van je duiven wint';
  if (b.kind === 'head2head') return `${b.pigeonName} > ${b.rivalName}`;
  const tail = b.kind === 'win' ? 'wint' : b.kind === 'last' ? 'laatste' : 'top 3';
  return `${b.pigeonName} ${tail}`;
}

function BetPanel({ flight, meId, onPlaced }: { flight: Flight; meId?: string; onPlaced: () => void }) {
  const toast = useToast();
  const { state } = useGame();
  const minStake = state?.economy.betMinStake ?? 10;
  const maxStake = state?.economy.betMaxStake ?? 500;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<BetKind>('win');
  const [pigeonId, setPigeonId] = useState('');
  const [rivalId, setRivalId] = useState('');
  const [stake, setStake] = useState(Math.max(50, minStake));
  const [preview, setPreview] = useState<BetPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const clampStake = (v: number) => Math.min(maxStake, Math.max(minStake, Math.round(v) || minStake));

  // The named entrant list is fetched only when the panel opens.
  //
  // It used to ride along on `/flights`, which every open tab polls every 90 s.
  // Naming another loft's bird forces the server to load the whole pigeon table,
  // so that one convenience put practically the entire population into the read
  // budget of the most-polled route in the game. Here it costs one full load per
  // opened panel — a handful a day. See core/presenters.ts::flightEntrantsDTO.
  const [entrants, setEntrants] = useState<FlightEntrant[] | null>(null);
  const [entrantsError, setEntrantsError] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEntrantsError(false);
    api<{ entrants: FlightEntrant[] }>(`/flights/${flight.id}/entrants`)
      .then((r) => { if (!cancelled) setEntrants(r.entrants); })
      .catch(() => { if (!cancelled) setEntrantsError(true); });
    return () => { cancelled = true; };
  }, [open, flight.id]);

  const loaded = entrants ?? [];
  const mine = loaded.filter((e) => e.ownerId === meId);
  const targets = kind === 'own_top3' ? mine : loaded;
  const needsTarget = kind !== 'mine_wins';
  const needsRival = kind === 'head2head';

  // Keep target valid for the chosen kind — also once the entrants land.
  useEffect(() => {
    if (!needsTarget) return;
    if (!targets.some((t) => t.pigeonId === pigeonId)) setPigeonId(targets[0]?.pigeonId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, flight.id, entrants]);

  // Live odds preview.
  //
  // Deliberately NOT dependent on `stake`: the probability and the ratio depend
  // only on the flight and the birds, and the potential win is just stake × ratio
  // (computed below). Refetching per keystroke fired a fresh Monte-Carlo on the
  // server for a number that never changed — the single easiest way to blow the
  // 10 ms CPU budget on a big flight.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (needsTarget && !pigeonId) { setPreview(null); return; }
      if (needsRival && (!rivalId || rivalId === pigeonId)) { setPreview(null); return; }
      try {
        const p = await api<BetPreview>('/bets/preview', {
          method: 'POST',
          body: { flightId: flight.id, kind, pigeonId: needsTarget ? pigeonId : null, rivalId: needsRival ? rivalId : null, stake: 0 },
        });
        if (!cancelled) setPreview(p);
      } catch {
        if (!cancelled) setPreview(null);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [kind, pigeonId, rivalId, flight.id, needsTarget, needsRival]);

  async function confirm() {
    setBusy(true);
    try {
      await api('/bets', {
        method: 'POST',
        body: { flightId: flight.id, kind, pigeonId: needsTarget ? pigeonId : null, rivalId: needsRival ? rivalId : null, stake: clampStake(stake) },
      });
      toast.show('Weddenschap geplaatst! 🎲', 'ok');
      setOpen(false);
      onPlaced();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>🎲 Weddenschap plaatsen</button>
    );
  }

  const availableKinds: BetKind[] = ['win', 'top3', 'last', 'head2head', ...(mine.length > 0 ? (['own_top3', 'mine_wins'] as BetKind[]) : [])];

  // Nothing to choose from until the deelnemerslijst is in.
  if (entrants === null || entrantsError) {
    return (
      <div className="card" style={{ marginTop: 10, background: 'var(--surface-2)', boxShadow: 'none' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>🎲 Weddenschap</strong>
          <button className="btn ghost sm" onClick={() => setOpen(false)}>×</button>
        </div>
        <p className="faint" style={{ marginTop: 8 }}>
          {entrantsError ? 'De deelnemers konden niet geladen worden.' : 'Deelnemers laden…'}
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 10, background: 'var(--surface-2)', boxShadow: 'none' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>🎲 Weddenschap</strong>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>×</button>
      </div>

      <label style={{ marginTop: 8 }}>Type</label>
      <select value={kind} onChange={(e) => setKind(e.target.value as BetKind)} disabled={busy}>
        {availableKinds.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
      </select>

      {needsTarget && (
        <>
          <label style={{ marginTop: 8 }}>{kind === 'own_top3' ? 'Jouw duif' : 'Duif'}</label>
          <select value={pigeonId} onChange={(e) => setPigeonId(e.target.value)} disabled={busy}>
            {targets.map((t) => <option key={t.pigeonId} value={t.pigeonId}>{t.name} (★{t.talent} · {t.ownerName})</option>)}
          </select>
        </>
      )}
      {needsRival && (
        <>
          <label style={{ marginTop: 8 }}>Tegenstander</label>
          <select value={rivalId} onChange={(e) => setRivalId(e.target.value)} disabled={busy}>
            <option value="">— kies —</option>
            {loaded.filter((t) => t.pigeonId !== pigeonId).map((t) => <option key={t.pigeonId} value={t.pigeonId}>{t.name} ({t.ownerName})</option>)}
          </select>
        </>
      )}

      <label style={{ marginTop: 8 }}>Inzet <span className="faint">(€{minStake}–€{maxStake})</span></label>
      <input
        type="number"
        min={minStake}
        max={maxStake}
        value={stake}
        onChange={(e) => setStake(Number(e.target.value))}
        onBlur={() => setStake((s) => clampStake(s))}
        disabled={busy}
        style={{ maxWidth: 140 }}
      />

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
        <span className="faint">
          {preview
            ? <>Kans ~{Math.round(preview.prob * 100)}% · ratio <strong>{preview.ratio}×</strong> · winst{' '}
                <strong><Money value={Math.round(clampStake(stake) * preview.ratio)} /></strong></>
            : 'Kies je weddenschap…'}
        </span>
        <button className="btn accent sm" disabled={busy || !preview} onClick={confirm}>Bevestig</button>
      </div>
    </div>
  );
}

/**
 * The three legs of an estafettevlucht: where each one hands over, how the
 * weather is expected to be there, and which of your birds flies it. The legs
 * are equal in length, so the running order only matters because of that
 * weather — hence the up/down buttons, usable right up to the start.
 */
function RelayPlan({
  flight, myUserId, busy, onReorder,
}: {
  flight: Flight;
  myPigeonNames: Map<string, string>;
  myUserId?: string;
  busy: boolean;
  onReorder: (pigeonIds: string[]) => void;
}) {
  const legs = flight.legs ?? [];
  if (legs.length === 0) return null;
  const myTeam = (flight.teams ?? []).find((t) => t.ownerId === myUserId);
  const mine = myTeam?.legs ?? [];
  const canReorder = mine.length > 1 && flight.status === 'scheduled';

  function move(from: number, to: number) {
    if (to < 0 || to >= mine.length) return;
    const ids = mine.map((l) => l.pigeonId);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    onReorder(ids);
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: '0.9rem' }}>Etappes</strong>
        <span className="faint" style={{ fontSize: '0.85rem' }}>elk {flight.legKm} km</span>
      </div>
      <div className="stack" style={{ gap: 6, marginTop: 6 }}>
        {legs.map((leg, i) => {
          const bird = mine[i];
          return (
            <div
              key={leg.index}
              className="row"
              style={{
                justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
                background: 'var(--surface-2)', borderRadius: 8, padding: '6px 10px',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '0.9rem', overflowWrap: 'anywhere' }}>
                  <strong>{leg.index}.</strong> {leg.fromName} → {leg.toName}
                </div>
                <div className="faint" style={{ fontSize: '0.82rem' }}>
                  {leg.weather || 'weerbericht volgt'}
                </div>
              </div>
              <div className="row" style={{ gap: 4, flexShrink: 0, alignItems: 'center' }}>
                {bird ? (
                  <>
                    <span className="badge" style={{ background: 'var(--surface)' }}>🕊️ {bird.name}</span>
                    {canReorder && (
                      <>
                        <button className="btn ghost sm" style={{ padding: '0 6px' }} disabled={busy || i === 0} onClick={() => move(i, i - 1)}>▲</button>
                        <button className="btn ghost sm" style={{ padding: '0 6px' }} disabled={busy || i === mine.length - 1} onClick={() => move(i, i + 1)}>▼</button>
                      </>
                    )}
                  </>
                ) : (
                  <span className="faint" style={{ fontSize: '0.85rem' }}>nog geen duif</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {mine.length > 0 && mine.length < legs.length && (
        <p className="notice" style={{ marginTop: 8, marginBottom: 0 }}>
          Je ploeg is nog niet compleet — schrijf {legs.length - mine.length} duif
          {legs.length - mine.length === 1 ? '' : 'ven'} bij, anders start ze niet mee (je inschrijfgeld krijg je dan terug).
        </p>
      )}
    </div>
  );
}

function EnterControl({
  options,
  onEnter,
  disabled,
}: {
  options: { id: string; label: string }[];
  onEnter: (id: string) => void;
  disabled?: boolean;
}) {
  const [sel, setSel] = useState('');
  if (options.length === 0) return <span className="muted">Geen vluchtklare duiven beschikbaar.</span>;
  return (
    <div className="row enter-control" style={{ gap: 8, flex: 1, minWidth: 0 }}>
      <select
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        style={{ flex: 1, minWidth: 0, maxWidth: '100%' }}
      >
        <option value="">— kies een duif —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <button className="btn" disabled={disabled || !sel} onClick={() => { onEnter(sel); setSel(''); }} style={{ flexShrink: 0 }}>
        Inschrijven
      </button>
    </div>
  );
}

function FlightResultCard({ flight, meId }: { flight: Flight; meId?: string }) {
  const [open, setOpen] = useState(false);
  const top = flight.results.slice(0, 5);
  const maxV = Math.max(1, ...flight.results.map((r) => r.velocity));
  const cancelled = flight.results.length === 0;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <strong>{flight.name}</strong>
            <span className={`badge ${flight.type}`}>{tierLabel(flight.type)}</span>
          </div>
          <div className="faint">{formatFlightTime(flight.startAt)} · {flight.fromCity} → {flight.toCity} · {flight.weather}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {cancelled ? <span className="muted">afgelast</span> : (
            <>
              <div className="faint">winnaar</div>
              <strong>{flight.results.find((r) => r.finished)?.ownerName ?? 'niemand thuis'}</strong>
            </>
          )}
        </div>
      </div>

      {flight.recap && (
        <div className="recap" style={{ marginTop: 10 }}>
          <span className="recap-badge">📻 Verslag</span> {flight.recap}
        </div>
      )}

      {!cancelled && (
        <>
          <div style={{ marginTop: 12 }}>
            {top.map((r) => {
              const mine = r.ownerId === meId;
              return (
              <div key={r.pigeonId} className="stat" style={mine ? { background: 'var(--brand-soft)', borderRadius: 8, padding: '4px 8px' } : undefined}>
                <div className="stat-top">
                  <span className="stat-label">
                    {r.finished ? `${r.rank}.` : '—'} <strong>{r.pigeonName}</strong> <span className="faint">· {r.ownerName}</span>
                    {mine && <span className="badge club" style={{ marginLeft: 6 }}>jij</span>}
                  </span>
                  <span className="stat-val">{r.finished ? `${r.velocity} m/min` : '❌ niet thuis'}</span>
                </div>
                <div className="bar">
                  <span style={{ width: `${r.finished ? (r.velocity / maxV) * 100 : 0}%`, background: r.ownerId === meId ? 'linear-gradient(90deg,#f97316,#fdba74)' : undefined }} />
                </div>
              </div>
              );
            })}
          </div>

          {open && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data">
                <thead>
                  <tr><th>#</th><th>Duif</th><th>Hok</th><th className="num">Snelheid</th><th className="num">Tijd</th><th className="num">Prijs</th><th className="num">Ptn</th></tr>
                </thead>
                <tbody>
                  {flight.results.map((r) => (
                    <tr key={r.pigeonId} className={r.ownerId === meId ? 'me' : r.finished && r.rank === 1 ? 'podium-1' : ''}>
                      <td>{r.finished ? r.rank : '—'}</td><td>{r.pigeonName}</td><td>{r.ownerName}</td>
                      <td className="num">{r.finished ? r.velocity : '—'}</td><td className="num">{r.finished ? formatDuration(r.timeSeconds) : '❌ DNF'}</td>
                      <td className="num">{r.prize > 0 ? <Money value={r.prize} /> : r.finished && r.rewarded === false ? <span className="faint" title="Buiten de 3 beloonde duiven van dit hok">buiten de 3</span> : '—'}</td><td className="num">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setOpen((o) => !o)}>
            {open ? 'Verberg volledige uitslag' : 'Toon volledige uitslag'}
          </button>
        </>
      )}
    </div>
  );
}
