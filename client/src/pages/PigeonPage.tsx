/** Single pigeon: full stats, pedigree and training controls. */

import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { PigeonAvatar } from '../components/PigeonAvatar';
import { Money, SexBadge, Spinner, StatBar, useToast } from '../components/ui';
import type { Pigeon } from '../types';

interface PigeonDetail {
  pigeon: Pigeon;
  sire: Pigeon | null;
  dam: Pigeon | null;
  mine: boolean;
}

const TRAIN_COST = 120;

export function PigeonPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { refresh } = useGame();
  const toast = useToast();
  const [data, setData] = useState<PigeonDetail | null>(null);
  const [busy, setBusy] = useState(false);

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
  const { pigeon: p, sire, dam, mine } = data;

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

  return (
    <div>
      <Link to="/hok" className="faint">← terug naar hok</Link>
      <div className="grid cols-2" style={{ marginTop: 10 }}>
        <div className="card">
          <div className="row" style={{ gap: 14, alignItems: 'center' }}>
            <PigeonAvatar pigeon={p} size={120} />
            <div>
              <h1 style={{ marginBottom: 6 }}>{p.name}</h1>
              <div className="row" style={{ gap: 6 }}>
                <SexBadge sex={p.sex} />
                <span className="badge bot">★ talent {p.talent}</span>
                {p.forSale && <span className="badge sale">te koop · <Money value={p.price ?? 0} /></span>}
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
          <StatBar label="Uithoudingsvermogen" value={p.endurance} />
          <StatBar label="Oriëntatie" value={p.orientation} />
          <StatBar label="Conditie" value={p.form} variant="form" />
          <StatBar label="Gezondheid" value={p.health} variant="health" />
          <StatBar label="Ervaring" value={p.experience} />
        </div>

        <div>
          {mine && (
            <div className="card">
              <h2>💪 Training</h2>
              <p className="muted">
                Kost <Money value={TRAIN_COST} /> en wat conditie, geeft een kleine blijvende verbetering.
              </p>
              <div className="stack" style={{ marginTop: 8 }}>
                <button className="btn" disabled={busy} onClick={() => train('speed')}>Train snelheid</button>
                <button className="btn" disabled={busy} onClick={() => train('endurance')}>Train uithouding</button>
                <button className="btn" disabled={busy} onClick={() => train('orientation')}>Train oriëntatie</button>
              </div>
            </div>
          )}

          <div className="card">
            <h2>🧬 Afstamming</h2>
            <div className="grid cols-2">
              <PedigreeBox label="Vader (doffer)" pigeon={sire} />
              <PedigreeBox label="Moeder (duivin)" pigeon={dam} />
            </div>
            {!sire && !dam && <p className="muted" style={{ marginTop: 8 }}>Afkomst onbekend (grondduif).</p>}
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
