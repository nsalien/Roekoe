/**
 * Inrichting: alles wat je aan je hok koopt, op één pagina, zodat Mijn hok
 * over de duiven blijft gaan. Uitbreidingen (capaciteit, aparte hokken),
 * hokhygiëne, de hokinrichting en vaccins voor het hele hok. De scout staat op
 * de Markt.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGame } from '../game/GameContext';
import { api } from '../api/client';
import { Money, Spinner, useToast } from '../components/ui';
import { InrichtingCard, VaccineCard } from '../components/Inrichting';
import type { Loft } from '../types';

export function InrichtingPage() {
  const { state, loading, refresh } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (loading || !state || !state.loft) return <Spinner />;

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (ok) toast.show(ok, 'ok');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  const loft = state.loft;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Inrichting</h1>
          <p className="muted">Uitbreidingen, hygiëne, inrichting en vaccins · <Link to="/hok">naar je duiven →</Link></p>
        </div>
      </div>
      <LoftUpgrades loft={loft} busy={busy} act={act} upkeepBands={state.economy.upkeepBands ?? []} />
      {loft.equipment && <HygieneCard loft={loft} busy={busy} act={act} />}
      {loft.equipment && state.inrichting && (
        <>
          <InrichtingCard loft={loft} cat={state.inrichting} busy={busy} act={act} />
          <VaccineCard loft={loft} pigeons={state.pigeons} cat={state.inrichting} busy={busy} act={act} />
        </>
      )}
    </div>
  );
}

/**
 * Hokhygiëne under the loft view: the meter, what it does now, fresh straw and
 * the hokpoetser. The rule itself (decay, the ×0,8, the floor) is in the wiki.
 */
function HygieneCard({
  loft,
  busy,
  act,
}: {
  loft: Loft;
  busy: boolean;
  act: (fn: () => Promise<unknown>, ok?: string) => void;
}) {
  const eq = loft.equipment!;
  const h = Math.round(eq.hygiene);
  const effect = eq.illnessMult < 1
    ? `Minder kans op ziekte (×${eq.illnessMult.toLocaleString('nl-BE')})`
    : 'Geen effect: onder 50 is het zoals altijd';
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong>🧹 Hokhygiëne</strong>
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{h}</strong>
      </div>
      <div className="faint" style={{ fontSize: '0.8rem' }}>
        {effect} · zakt vannacht ~{Math.round(eq.decayPerDay)}
        {eq.lastStrawAt ? '' : ' · nog nooit stro gestrooid'}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          className="btn sm"
          disabled={busy || h >= 100 || loft.money < eq.strawCost}
          onClick={() => act(() => api('/loft/straw', { method: 'POST' }), 'Vers stro gestrooid 🌾')}
        >
          🌾 Vers stro · <Money value={eq.strawCost} />
        </button>
        <button
          className={`btn sm ${eq.cleaner ? 'accent' : 'ghost'}`}
          disabled={busy}
          onClick={() => act(
            () => api('/loft/cleaner', { method: 'POST', body: { on: !eq.cleaner } }),
            eq.cleaner ? 'Hokpoetser ontslagen' : 'Hokpoetser aangenomen 🧹',
          )}
        >
          {eq.cleaner ? '🧹 Hokpoetser ontslaan' : '🧹 Hokpoetser aannemen'} · <Money value={eq.cleanerWage} />/dag
        </button>
      </div>
      <div className="faint" style={{ fontSize: '0.8rem', marginTop: 8 }}>
        <Link to="/wiki#hygiene">Meer info over hokhygiëne →</Link>
      </div>
    </div>
  );
}

function LoftUpgrades({
  loft,
  busy,
  act,
  upkeepBands,
}: {
  loft: Loft;
  busy: boolean;
  act: (fn: () => Promise<unknown>, ok?: string) => void;
  upkeepBands: { upTo: number; perPigeon: number }[];
}) {
  // Daily upkeep rate the NEXT bird would fall into (bands are ascending; the
  // last one also covers anything beyond it).
  const nextBirdRate = upkeepBands.length
    ? (upkeepBands.find((b) => loft.pigeonCount + 1 <= b.upTo) ?? upkeepBands[upkeepBands.length - 1]).perPigeon
    : null;
  // Both upgrades are irreversible, cost more than anything else a player buys,
  // and sit one stray tap away on a phone — so each one asks first. Bound to a
  // const so the narrowing survives into the click handler.
  const nextCap = loft.nextCapacity;
  const compartmentCost = loft.compartmentCost;
  const euro = (n: number) => `€${n.toLocaleString('nl-NL')}`;
  return (
    <div className="card" style={{ marginBottom: 18 }} data-tour="upgrades">
      <h2 style={{ marginTop: 0 }}>🏗️ Uitbreidingen</h2>
      <div className="grid cols-2">
        {/* Capacity */}
        <div>
          <strong>🏠 Hokcapaciteit</strong>
          <div className="faint" style={{ margin: '2px 0 8px' }}>
            Nu plaats voor <strong>{loft.capacity}</strong> duiven.
          </div>
          {nextCap ? (
            <button
              className="btn accent sm"
              disabled={busy || loft.money < nextCap.price}
              onClick={() => {
                // Name the recurring cost too: the price is the visible half of
                // this purchase, the higher daily upkeep is the half that bites later.
                if (!window.confirm(
                  `Ben je zeker dat je je hok wil uitbreiden naar ${nextCap.capacity} plaatsen voor ${euro(nextCap.price)}?\n\n`
                  + `Dat bedrag gaat er meteen af.`
                  + (nextBirdRate !== null ? ` Je volgende duif kost daarna €${nextBirdRate}/dag aan onderhoud.` : ''),
                )) return;
                act(() => api('/loft/capacity', { method: 'POST' }), 'Hok uitgebreid! 🏠');
              }}
            >
              Naar {nextCap.capacity} · <Money value={nextCap.price} />
            </button>
          ) : (
            <div className="faint">Maximale capaciteit bereikt.</div>
          )}
          {/* Upkeep rises per band. Keep it to the ONE number that matters here —
              what the next bird costs — and send the reader to the wiki for the
              full schedule, so a bigger loft is never a hidden recurring cost. */}
          {nextBirdRate !== null && (
            <div className="faint" style={{ marginTop: 8, fontSize: '0.8rem', lineHeight: 1.5 }}>
              Je volgende duif kost <strong>€{nextBirdRate}/dag</strong> aan onderhoud.{' '}
              <Link to="/wiki#hok">Hoe de schijven werken →</Link>
            </div>
          )}
        </div>

        {/* Compartments */}
        <div>
          <strong>🧱 Aparte hokken</strong>
          <div className="faint" style={{ margin: '2px 0 8px' }}>
            {loft.compartmentsUsed}/{loft.compartments} in gebruik. Kies per duif hieronder wie apart zit — beter energieherstel en minder ziekte.
          </div>
          {compartmentCost != null ? (
            <button
              className="btn sm"
              disabled={busy || loft.money < compartmentCost}
              onClick={() => {
                if (!window.confirm(
                  `Ben je zeker dat je een apart hok wil bijbouwen voor ${euro(compartmentCost)}?\n\n`
                  + `Dat bedrag gaat er meteen af, en elk volgend apart hok wordt duurder.`,
                )) return;
                act(() => api('/loft/compartment', { method: 'POST' }), 'Apart hok gebouwd! 🧱');
              }}
            >
              Bijbouwen · <Money value={compartmentCost} />
            </button>
          ) : (
            <div className="faint">Elke plaats heeft al een apart hok.</div>
          )}
        </div>
      </div>
    </div>
  );
}

