/**
 * Koppels op de pagina Kweek (⚠️ dev, nog niet live): duiven die naar elkaar toe
 * trekken, de koppels en wie nog aan het wennen is, en een nieuw koppel laten
 * wennen. Het nest zelf start je in de kaart ernaast. De regels staan in de wiki.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { InrichtingCatalogue, Loft, Pigeon } from '../types';

type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

const first = (name: string) => name.split(' ')[0];

export function CouplesCard({ loft, pigeons, cat, busy, act }: {
  loft: Loft; pigeons: Pigeon[]; cat: InrichtingCatalogue; busy: boolean; act: Act;
}) {
  const eq = loft.equipment!;
  const [dofferId, setDofferId] = useState('');
  const [duivinId, setDuivinId] = useState('');
  const [inBox, setInBox] = useState(false);
  const paired = new Set(eq.couples.flatMap((c) => [c.dofferId, c.duivinId]));
  const adult = (p: Pigeon) => p.ageWeeks >= 8 && !p.care?.quarantineUntil;
  const free = pigeons.filter((p) => !paired.has(p.id) && adult(p) && !p.away);
  const doffers = free.filter((p) => p.sex === 'doffer');
  const duivinnen = free.filter((p) => p.sex === 'duivin');
  const boxFree = eq.partnerhokken - eq.partnerhokInUse;
  const d = doffers.find((p) => p.id === dofferId);
  const h = duivinnen.find((p) => p.id === duivinId);
  const apart = [d, h].filter((p): p is Pigeon => !!p && (p.compartment || p.inInfirmary));
  const halfLibido = Math.round((1 - cat.couples.breakLibidoMult) * 100);
  const koppels = eq.couples.filter((c) => c.status === 'koppel');
  const wennen = eq.couples.filter((c) => c.status === 'wennen');

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>💑 Koppels</h2>

      {eq.attractions.map((a) => (
        <div key={`${a.dofferId}-${a.duivinId}`} className="notice" style={{ marginBottom: 8 }}>
          💕 <strong>{first(a.dofferName)}</strong> en <strong>{first(a.duivinName)}</strong> trekken naar elkaar toe.
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button className="btn sm" disabled={busy} onClick={() =>
              act(() => api('/couples/confirm', { method: 'POST', body: { dofferId: a.dofferId, duivinId: a.duivinId } }), `${first(a.dofferName)} en ${first(a.duivinName)} zijn een koppel 💑`)}>
              Koppel bevestigen
            </button>
            <button className="btn ghost sm" disabled={busy} onClick={() =>
              act(() => api('/couples/dismiss', { method: 'POST', body: { dofferId: a.dofferId, duivinId: a.duivinId } }))}>
              Negeren
            </button>
          </div>
        </div>
      ))}

      {koppels.length === 0 && wennen.length === 0 && <p className="muted" style={{ marginTop: 0 }}>Nog geen koppels.</p>}
      {koppels.map((c) => {
        const doffer = pigeons.find((p) => p.id === c.dofferId);
        const duivin = pigeons.find((p) => p.id === c.duivinId);
        const moveIn = () => {
          // Moving in costs them an apart hok, and ends a weduwschap: say so first.
          const apartNames = [doffer, duivin].filter((p) => p?.compartment).map((p) => first(p!.name));
          const widower = !!doffer?.care?.widow.on;
          if (apartNames.length > 0 || widower) {
            const parts = [
              apartNames.length > 0 ? `${apartNames.join(' en ')} ${apartNames.length === 1 ? 'verlaat het apart hok' : 'verlaten hun apart hok'}` : '',
              widower ? `het weduwschap van ${first(c.dofferName)} stopt` : '',
            ].filter(Boolean);
            if (!window.confirm(`${first(c.dofferName)} en ${first(c.duivinName)} in het partnerhok? ${parts.join(' en ')}.`)) return;
          }
          act(() => api('/couples/partnerhok', { method: 'POST', body: { pigeonId: c.dofferId, on: true } }), `${first(c.dofferName)} en ${first(c.duivinName)} wonen nu in het partnerhok 🏠`);
        };
        return (
          <div key={c.dofferId} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span>
              💑 <strong>{first(c.dofferName)}</strong> &amp; <strong>{first(c.duivinName)}</strong>
              {c.partnerhok && <span className="faint"> · in het partnerhok</span>}
            </span>
            <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {c.partnerhok ? (
                <button className="btn ghost sm" disabled={busy} onClick={() =>
                  act(() => api('/couples/partnerhok', { method: 'POST', body: { pigeonId: c.dofferId, on: false } }), 'Terug in het hoofdhok')}>
                  Uit partnerhok
                </button>
              ) : boxFree > 0 ? (
                <button className="btn ghost sm" disabled={busy} onClick={moveIn}>In partnerhok</button>
              ) : eq.partnerhokken === 0 ? (
                <Link to="/inrichting#hokken" className="faint" style={{ fontSize: '0.85rem' }}>partnerhok kopen →</Link>
              ) : (
                <span className="faint" style={{ fontSize: '0.85rem' }}>partnerhokken bezet</span>
              )}
              <button className="btn ghost sm" disabled={busy} onClick={() => {
                if (!window.confirm(`${first(c.dofferName)} en ${first(c.duivinName)} ontkoppelen? Beide verliezen ${halfLibido}% van hun libido.`)) return;
                act(() => api('/couples/unpair', { method: 'POST', body: { pigeonId: c.dofferId } }), 'Koppel ontbonden');
              }}>Ontkoppelen</button>
            </span>
          </div>
        );
      })}
      {wennen.map((c) => (
        <div key={c.dofferId} className="row" style={{ justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span>
            ⏳ {first(c.dofferName)} &amp; {first(c.duivinName)} wennen aan elkaar
            <span className="faint"> · dag {c.day}{c.maxDays ? ` van hoogstens ${c.maxDays}` : ''}{c.partnerhok ? ' · in het partnerhok' : ''}</span>
          </span>
          <button className="btn ghost sm" disabled={busy} onClick={() =>
            act(() => api('/couples/unpair', { method: 'POST', body: { pigeonId: c.dofferId } }), 'Wennen gestopt')}>Stoppen</button>
        </div>
      ))}

      <h3 style={{ marginBottom: 4 }}>Nieuw koppel laten wennen</h3>
      <p className="faint" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Ze moeten samen zitten: allebei in het hoofdhok, of samen in een partnerhok. Na enkele dagen aanvaarden ze elkaar — of
        weigeren ze. <Link to="/wiki#koppels">Meer info →</Link>
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select value={dofferId} onChange={(e) => setDofferId(e.target.value)} style={{ width: 'auto', maxWidth: '100%', minWidth: 0 }}>
          <option value="">— doffer —</option>
          {doffers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.compartment ? ' (apart)' : ''} · ❤{Math.round(p.libido ?? 0)}</option>)}
        </select>
        <select value={duivinId} onChange={(e) => setDuivinId(e.target.value)} style={{ width: 'auto', maxWidth: '100%', minWidth: 0 }}>
          <option value="">— duivin —</option>
          {duivinnen.map((p) => <option key={p.id} value={p.id}>{p.name}{p.compartment ? ' (apart)' : ''} · ❤{Math.round(p.libido ?? 0)}</option>)}
        </select>
      </div>
      <label className="row" style={{ gap: 6, marginTop: 8, opacity: boxFree > 0 ? 1 : 0.6 }}>
        <input type="checkbox" checked={inBox && boxFree > 0} disabled={boxFree <= 0} onChange={(e) => setInBox(e.target.checked)} style={{ width: 'auto' }} />
        <span>In het partnerhok <span className="faint">({boxFree > 0 ? `${boxFree} vrij` : <>geen vrij — <Link to="/inrichting#hokken">koop er een</Link></>})</span></span>
      </label>
      {apart.length > 0 && !(inBox && boxFree > 0) && (
        <p className="notice err" style={{ margin: '8px 0 0' }}>
          {apart.map((p) => first(p.name)).join(' en ')} {apart.length === 1 ? 'zit' : 'zitten'} niet in het hoofdhok. Haal ze uit het apart hok of
          de ziekenboeg, of gebruik een partnerhok.
        </p>
      )}
      <button className="btn sm" style={{ marginTop: 10 }} disabled={busy || !d || !h} onClick={() =>
        act(() => api('/couples/start', { method: 'POST', body: { dofferId, duivinId, partnerhok: inBox && boxFree > 0 } }), 'Ze wennen aan elkaar ⏳')
          .then(() => { setDofferId(''); setDuivinId(''); })}>
        Laten wennen
      </button>
    </div>
  );
}
