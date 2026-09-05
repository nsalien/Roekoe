/**
 * The keep-or-let-go screen for birds that arrived into a full loft.
 *
 * Two shapes, one screen: a hatched clutch, or a single bird an event handed the
 * player (the inheritance, a stray). The decision is identical, so `origin` only
 * swaps the copy — everything below it is shared.
 *
 * The birds are real already — they just aren't in the loft yet. Nothing happens
 * to them until the owner confirms, so this screen has to make two things obvious
 * at a glance: which bird is worth a perch (talent + gene ceilings, which is what
 * you are really betting on), and how to free a perch if you want to keep more
 * than fit.
 */

import { useState } from 'react';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { Money, useToast } from './ui';
import { PigeonAvatar } from './PigeonAvatar';
import type { BroodYoung, PendingNest } from '../types';

/** The three race skills with their gene ceiling, e.g. "⚡ 41 → cap 88". */
function GeneRow({ young }: { young: BroodYoung }) {
  const rows: [string, string, number, number | undefined][] = [
    ['⚡', 'snelheid', young.speed, young.genes?.speed],
    ['💪', 'conditie', young.endurance, young.genes?.endurance],
    ['🧭', 'oriëntatie', young.orientation, young.genes?.orientation],
  ];
  return (
    <div className="stack" style={{ gap: 2, fontSize: '0.82rem' }}>
      {rows.map(([icon, label, now, cap]) => (
        <div key={label} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <span className="faint">{icon} {label}</span>
          <span>
            {Math.round(now)}
            {cap !== undefined && <span className="faint"> · max {cap}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function NestChoice({
  nest,
  freeSpace,
  onDone,
}: {
  nest: PendingNest;
  /** Perches free right now — the ceiling on how many young can be kept. */
  freeSpace: number;
  onDone: () => Promise<void> | void;
}) {
  const { state, refresh } = useGame();
  const toast = useToast();
  const [keep, setKeep] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [makeRoom, setMakeRoom] = useState(false);
  const [partId, setPartId] = useState<string | null>(null);

  const releasing = nest.young.length - keep.length;
  const tooMany = keep.length > freeSpace;
  const isNest = nest.origin === 'nest';
  const one = nest.young.length === 1;
  // A gift is always a single bird, so "houd je haar?" reads better than a tally.
  const heading = isNest
    ? `🐣 Nest van ${nest.sire} × ${nest.dam}`
    : nest.origin === 'erfenis'
      ? '📜 Een duif uit de erfenis'
      : '🕊️ De verdwaalde duif';

  function toggle(id: string) {
    setConfirm(false);
    setKeep((k) => (k.includes(id) ? k.filter((x) => x !== id) : [...k, id]));
  }

  async function submit() {
    setBusy(true);
    try {
      await api(`/breeding/nest/${nest.id}`, { method: 'POST', body: { keep } });
      toast.show(
        keep.length === 0
          ? isNest
            ? 'Het nest is uitgevlogen — je hield geen enkel jong.'
            : 'Je liet haar gaan.'
          : isNest
            ? `${keep.length === 1 ? 'Eén jong' : `${keep.length} jongen`} in je hok! 🐣`
            : 'Ze staat in je hok! 🕊️',
        'ok',
      );
      await onDone();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  /** Free a perch the ordinary way: release an adult, or sell it for soup. */
  async function partWays(pigeonId: string, kind: 'release' | 'restaurant') {
    setBusy(true);
    try {
      await api(`/pigeons/${pigeonId}/${kind}`, { method: 'POST' });
      toast.show(kind === 'release' ? 'Duif vrijgelaten 🕊️' : 'Verkocht aan het restaurant 🍲', 'ok');
      setPartId(null);
      await onDone();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  // Birds that could give up their perch. `pigeonBusy` (engine.ts) refuses a bird
  // that is racing, breeding or still on its way home, so offering the button for
  // one of those would only produce a server error.
  const spare = (state?.pigeons ?? []).filter((p) => !p.racing && !p.breeding && !p.away);

  return (
    <div className="card" style={{ borderLeft: '4px solid var(--accent, #f59e0b)' }}>
      <h2 style={{ marginTop: 0 }}>{heading}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {isNest ? (
          <>
            {one ? 'Er is één jong' : `Er zijn ${nest.young.length} jongen`} geboren, maar je hok zat vol. Kies wie je
            houdt. Wie je niet kiest, <strong>vliegt weg</strong> — daar krijg je niets voor terug.
          </>
        ) : (
          <>
            Ze hoort bij je hok, maar er was geen plaats. Maak hieronder plaats — laat een duif vrij of verkoop er een
            aan het restaurant — en houd haar. Kies je haar niet, dan <strong>vliegt ze weg</strong> en krijg je er
            niets voor terug.
          </>
        )}
      </p>
      <p className={freeSpace === 0 ? 'muted' : 'faint'} style={{ marginTop: 0, fontSize: '0.85rem' }}>
        {freeSpace === 0
          ? `🏠 Geen enkele vrije plaats — maak eerst plaats als je ${isNest ? 'een jong' : 'haar'} wil houden.`
          : `🏠 Nog ${freeSpace} vrije ${freeSpace === 1 ? 'plaats' : 'plaatsen'} in je hok.`}
      </p>

      <div className="grid cols-2" style={{ gap: 10 }}>
        {nest.young.map((y) => {
          const chosen = keep.includes(y.id);
          return (
            <button
              key={y.id}
              type="button"
              onClick={() => toggle(y.id)}
              disabled={busy}
              className="card"
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                boxShadow: 'none',
                background: chosen ? 'var(--surface-2)' : 'transparent',
                border: `2px solid ${chosen ? 'var(--ok, #16a34a)' : 'var(--border, #e5e7eb)'}`,
              }}
            >
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <div className="row" style={{ gap: 8 }}>
                  <PigeonAvatar pigeon={y} size={44} />
                  <div>
                    <strong>{y.name}</strong>
                    <div className="faint" style={{ fontSize: '0.8rem' }}>
                      {y.sex === 'doffer' ? '♂ doffer' : '♀ duivin'} · ★{y.talent}
                      {y.breed?.name && <> · {y.breed.name}</>}
                    </div>
                  </div>
                </div>
                <span style={{ fontSize: '1.1rem' }}>{chosen ? '✅' : '⬜'}</span>
              </div>
              <GeneRow young={y} />
            </button>
          );
        })}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <span className="muted">
          {isNest ? (
            <>
              Je houdt <strong>{keep.length}</strong> van {nest.young.length}
              {releasing > 0 && <> · {releasing} {releasing === 1 ? 'vliegt' : 'vliegen'} weg</>}
            </>
          ) : keep.length > 0 ? (
            <>Je <strong>houdt</strong> haar</>
          ) : (
            <>Je laat haar <strong>gaan</strong></>
          )}
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm" disabled={busy} onClick={() => setMakeRoom((v) => !v)}>
            {makeRoom ? 'Verberg' : 'Maak plaats'}
          </button>
          {confirm ? (
            <button className="btn danger sm" disabled={busy || tooMany} onClick={submit}>
              Zeker?{' '}
              {releasing === 0 ? 'bevestig' : isNest ? `${releasing} ${releasing === 1 ? 'jong' : 'jongen'} weg` : 'ze vliegt weg'}
            </button>
          ) : (
            <button className="btn sm" disabled={busy || tooMany} onClick={() => setConfirm(true)}>
              Bevestig keuze
            </button>
          )}
        </div>
      </div>
      {tooMany && (
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
          Je koos er {keep.length}, maar er {freeSpace === 1 ? 'is' : 'zijn'} maar {freeSpace}{' '}
          {freeSpace === 1 ? 'plaats' : 'plaatsen'}. Maak plaats of kies er minder.
        </p>
      )}

      {makeRoom && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 12 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: '0.95rem' }}>Plaats maken</h3>
          <p className="faint" style={{ margin: '0 0 8px', fontSize: '0.82rem' }}>
            🕊️ Vrijlaten levert niets op. 🍲 Het restaurant betaalt{' '}
            {state?.economy && <Money value={state.economy.restaurantPayout} />}, maar elke andere duif verliest{' '}
            {state?.economy?.restaurantMoraleMin}–{state?.economy?.restaurantMoraleMax} energie.
          </p>
          {spare.length === 0 && <p className="muted">Geen enkele duif is vrij — ze vliegen of koppelen allemaal.</p>}
          <div className="stack" style={{ gap: 6 }}>
            {spare.map((p) => (
              <div key={p.id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <span>
                  {p.name} <span className="faint">★{p.talent} · {p.ageWeeks} wk</span>
                </span>
                {partId === p.id ? (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn danger sm" disabled={busy} onClick={() => partWays(p.id, 'release')}>
                      🕊️ Zeker?
                    </button>
                    <button className="btn danger sm" disabled={busy} onClick={() => partWays(p.id, 'restaurant')}>
                      🍲 Zeker?
                    </button>
                    <button className="btn ghost sm" disabled={busy} onClick={() => setPartId(null)}>
                      Annuleer
                    </button>
                  </div>
                ) : (
                  <button className="btn ghost sm" disabled={busy} onClick={() => setPartId(p.id)}>
                    Afscheid nemen
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
