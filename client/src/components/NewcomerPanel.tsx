/**
 * The starter package panel (see NEWCOMER in core/config/gameConfig.ts).
 *
 * A new loft flies against birds that have been coached for weeks, so it gets a
 * leg-up for its first season. Two of those perks are POINTS the player has to
 * aim themselves, and this is where they aim them — deliberately a decision, not
 * an automatic buff.
 *
 * Text budget (context.md §0): this shows only what drives the choice right now.
 * The mechanics behind ervaring and the gene cap live in the wiki.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { useToast } from './ui';
import type { Pigeon } from '../types';

const ATTR_LABEL: Record<string, string> = {
  speed: 'Snelheid',
  endurance: 'Conditie',
  orientation: 'Oriëntatie',
};

export function NewcomerPanel() {
  const { state, refresh } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [expPigeon, setExpPigeon] = useState('');
  const [expAmount, setExpAmount] = useState(0);
  const [attrPigeon, setAttrPigeon] = useState('');
  const [attr, setAttr] = useState('speed');
  const [attrAmount, setAttrAmount] = useState(1);

  const n = state?.loft?.newcomer;
  if (!n) return null;

  const mine: Pigeon[] = state?.pigeons ?? [];
  const hasPoints = n.expPoints > 0 || n.attrPoints > 0;
  // Once the timed perks are over AND the wallet is empty there is nothing left
  // to say — the panel disappears instead of lingering as a museum piece.
  if (!n.active && !hasPoints) return null;

  // The ervaring allowance goes to ONE bird; once chosen, that's the only option.
  const expChoices = n.expPigeonId ? mine.filter((p) => p.id === n.expPigeonId) : mine;

  async function spend(path: string, body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await api(`/newcomer/${path}`, { method: 'POST', body });
      toast.show(done, 'ok');
      refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18, borderLeft: '3px solid var(--brand-strong)' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>🎁 Je starterspakket</h2>
        {n.active ? (
          <span className="badge">nog {n.daysLeft} {n.daysLeft === 1 ? 'dag' : 'dagen'}</span>
        ) : (
          <span className="badge sale">afgelopen</span>
        )}
      </div>

      {n.active && (
        <p className="muted" style={{ marginTop: 6 }}>
          Je eerste seizoen tegen melkers die al een tijd bezig zijn. Zolang dit loopt is je
          eerste privécoach <strong>gratis</strong> en verdien je <strong>dubbel</strong>
          {' '}prijzengeld én ranglijstpunten op wedstrijdvluchten.
        </p>
      )}
      {!n.active && hasPoints && (
        <p className="muted" style={{ marginTop: 6 }}>
          Je gratis coach en dubbele winst zijn afgelopen — je speelt nu op dezelfde voet als
          iedereen. Je overgebleven punten blijven wél geldig, dus geef ze gerust nog uit.
        </p>
      )}

      {/* Ervaring — all of it goes to one bird. */}
      {n.expPoints > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="stat-top">
            <span className="stat-label">🎓 Ervaringspunten</span>
            <span className="stat-val">{n.expPoints} over</span>
          </div>
          <p className="faint sm" style={{ margin: '2px 0 8px' }}>
            Ervaring is de grootste rem op een nieuw hok. Alles gaat naar <strong>één</strong> duif
            {n.expPigeonId ? ' — je koos er al een.' : ' — kies dus goed.'}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select value={expPigeon} onChange={(e) => setExpPigeon(e.target.value)} disabled={busy}>
              <option value="">Kies een duif…</option>
              {expChoices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · ervaring {p.experience ?? 0}
                </option>
              ))}
            </select>
            <input
              type="number" min={1} max={n.expPoints} value={expAmount || ''} disabled={busy}
              placeholder="aantal" style={{ width: 90 }}
              onChange={(e) => setExpAmount(Number(e.target.value))}
            />
            <button
              className="btn sm" disabled={busy || !expPigeon || expAmount < 1}
              onClick={() => spend('experience', { pigeonId: expPigeon, amount: expAmount }, `+${expAmount} ervaring toegekend 🎓`)}
            >
              Toekennen
            </button>
            <button
              className="btn ghost sm" disabled={busy || !expPigeon}
              onClick={() => spend('experience', { pigeonId: expPigeon, amount: n.expPoints }, `+${n.expPoints} ervaring toegekend 🎓`)}
            >
              Alles ({n.expPoints})
            </button>
          </div>
        </div>
      )}

      {/* Attribute points — spreadable across birds and skills. */}
      {n.attrPoints > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="stat-top">
            <span className="stat-label">💪 Eigenschapspunten</span>
            <span className="stat-val">{n.attrPoints} over</span>
          </div>
          <p className="faint sm" style={{ margin: '2px 0 8px' }}>
            Vrij te verdelen over je duiven en over snelheid, conditie en oriëntatie. Het
            genetisch plafond van een duif blijft gelden.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select value={attrPigeon} onChange={(e) => setAttrPigeon(e.target.value)} disabled={busy}>
              <option value="">Kies een duif…</option>
              {mine.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={attr} onChange={(e) => setAttr(e.target.value)} disabled={busy}>
              {Object.entries(ATTR_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <input
              type="number" min={1} max={n.attrPoints} value={attrAmount || ''} disabled={busy}
              style={{ width: 90 }}
              onChange={(e) => setAttrAmount(Number(e.target.value))}
            />
            <button
              className="btn sm" disabled={busy || !attrPigeon || attrAmount < 1}
              onClick={() => spend('attribute', { pigeonId: attrPigeon, attr, amount: attrAmount },
                `+${attrAmount} ${ATTR_LABEL[attr].toLowerCase()} toegekend 💪`)}
            >
              Toekennen
            </button>
          </div>
        </div>
      )}

      {n.active && n.expPoints === 0 && n.attrPoints === 0 && (
        <p className="faint sm" style={{ marginTop: 12 }}>
          Al je punten zijn verdeeld. Je gratis coach en dubbele winst lopen nog
          {' '}{n.daysLeft} {n.daysLeft === 1 ? 'dag' : 'dagen'}.
        </p>
      )}

      <p className="faint sm" style={{ marginTop: 12, marginBottom: 0 }}>
        <Link to="/wiki#starterspakket">Meer info over het starterspakket →</Link>
      </p>
    </div>
  );
}
