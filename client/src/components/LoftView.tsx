/**
 * Het hokoverzicht bovenaan Mijn hok (hokinrichting — ⚠️ dev, nog niet live).
 *
 * A plain-text summary of where every bird is: the main loft, the private
 * compartments, the nest boxes, the ziekenboeg and who is not home. Purely a
 * view of the state Mijn hok already loads — no request of its own.
 */

import { Link } from 'react-router-dom';
import type { Loft, Pigeon } from '../types';

/** Where a bird is when she is not on her perch, most telling first. */
export function awayStatus(p: Pigeon, nowMs: number = Date.now()): { icon: string; label: string } | null {
  if (p.away) return { icon: '🧭', label: 'de weg kwijt' };
  if (p.racing) return { icon: '✈️', label: 'onderweg' };
  if (p.inInfirmary) return { icon: '🏥', label: 'ziekenboeg' };
  if (p.breeding) return { icon: '🥚', label: 'op het nest' };
  if (p.cureUntil && Date.parse(p.cureUntil) > nowMs) return { icon: '💤', label: 'rustkuur' };
  if (p.care?.quarantineUntil) return { icon: '📦', label: 'quarantaine' };
  return null;
}

const firstName = (p: Pigeon) => p.name.split(' ')[0];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap', padding: '5px 0', borderTop: '1px solid var(--border)' }}>
      <span className="faint" style={{ minWidth: 110 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );
}

export function LoftView({
  loft,
  pigeons,
  busy,
  onAssignCompartment,
}: {
  loft: Loft;
  pigeons: Pigeon[];
  busy: boolean;
  onAssignCompartment: (pigeonId: string) => void;
}) {
  const nowMs = Date.now();
  const byId = new Map(pigeons.map((p) => [p.id, p]));
  const inComp = pigeons.filter((p) => p.compartment && !p.inInfirmary).slice(0, loft.compartments);
  const free = Math.max(0, loft.capacity - pigeons.length);
  const away = pigeons.map((p) => ({ p, st: awayStatus(p, nowMs) })).filter((x) => x.st);
  const home = pigeons.length - away.length;
  const patients = pigeons.filter((p) => p.inInfirmary);
  const nests = (loft.nests ?? [])
    .map((n) => [byId.get(n.sireId), byId.get(n.damId)].filter(Boolean) as Pigeon[])
    .filter((pair) => pair.length > 0);
  const canMoveIn = pigeons.filter((p) => !p.compartment && !p.inInfirmary && !p.away);
  const freeComps = loft.compartments - inComp.length;
  const couples = loft.equipment?.couples ?? [];
  const widowerIds = new Set(pigeons.filter((p) => p.care?.widow.on).map((p) => p.id));
  const insured = pigeons.filter((p) => p.care?.insurance).length;
  const vaccinated = pigeons.filter((p) => (p.care?.vaccines.length ?? 0) > 0).length;

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2 style={{ marginTop: 0 }}>🏠 Hokoverzicht</h2>
      <Row label="Plaatsen">
        {pigeons.length} van {loft.capacity} bezet · {home} thuis
        {free > 0 && <> · <Link to="/markt">{free} vrij →</Link></>}
      </Row>
      {loft.compartments > 0 && (
        <Row label="Aparte hokken">
          {inComp.length > 0
            ? inComp.map((p, i) => (
                <span key={p.id}>{i > 0 && ', '}<Link to={`/duif/${p.id}`}>{firstName(p)}</Link></span>
              ))
            : 'niemand'}
          {freeComps > 0 && <span className="faint"> · {freeComps} vrij</span>}
          {freeComps > 0 && canMoveIn.length > 0 && (
            <select
              aria-label="Wie mag in een apart hok?"
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && onAssignCompartment(e.target.value)}
              style={{ width: 'auto', marginLeft: 8, fontSize: '0.85rem', padding: '2px 6px' }}
            >
              <option value="">Zet apart…</option>
              {canMoveIn.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </Row>
      )}
      <Row label="Nest">
        {nests.length > 0
          ? nests.map((pair, i) => (
              <span key={i}>{i > 0 && ' · '}🥚 {pair.map(firstName).join(' & ')}</span>
            ))
          : <Link to="/kweek">geen koppel →</Link>}
      </Row>
      <Row label="Ziekenboeg">
        {patients.length} van {loft.infirmaryCapacity} bedden
        {patients.map((p) => (
          <span key={p.id}>
            {' · '}<Link to={`/duif/${p.id}`}>{firstName(p)}</Link>
            {p.ailment && <span className="faint"> ({p.ailment.name}, {Math.round((p.ailment.healed ?? 0) * 100)}% hersteld)</span>}
          </span>
        ))}
      </Row>
      {couples.length > 0 && (
        <Row label="Koppels">
          {couples.map((c, i) => (
            <span key={c.dofferId}>
              {i > 0 && ' · '}{c.status === 'koppel' ? '💑' : '⏳'} {c.dofferName.split(' ')[0]} &amp; {c.duivinName.split(' ')[0]}
              {c.status === 'wennen' && <span className="faint"> wennen</span>}
              {widowerIds.has(c.dofferId) && <span title="weduwschap"> ❤️</span>}
            </span>
          ))}
        </Row>
      )}
      {(insured > 0 || vaccinated > 0) && (
        <Row label="Bescherming">
          {vaccinated > 0 && <>💉 {vaccinated} {vaccinated === 1 ? 'duif' : 'duiven'} ingeënt of gekuurd</>}
          {vaccinated > 0 && insured > 0 && ' · '}
          {insured > 0 && <>🛡️ {insured} verzekerd</>}
        </Row>
      )}
      {away.length > 0 && (
        <Row label="Niet thuis">
          {away.map(({ p, st }, i) => (
            <span key={p.id}>{i > 0 && ' · '}{st!.icon} <Link to={`/duif/${p.id}`}>{firstName(p)}</Link> <span className="faint">{st!.label}</span></span>
          ))}
        </Row>
      )}
    </div>
  );
}
