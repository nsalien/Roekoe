/**
 * Het hokoverzicht bovenaan Mijn hok (hokinrichting — ⚠️ dev, nog niet live).
 *
 * A plain-text summary of where every bird is: the main loft, the private
 * compartments, the nest boxes, the ziekenboeg and who is not home. One bird
 * or koppel per line, always by full name. Purely a view of the state Mijn hok
 * already loads — no request of its own.
 */

import { Link } from 'react-router-dom';
import type { Loft, Pigeon } from '../types';

/**
 * Why a bird is not home, or null when she is. Only three things take her out
 * of the loft: she is in the air, in the ziekenboeg, or lost on the way back.
 * On the nest, on a rustkuur, in quarantaine or entered for a later race: home.
 */
export function awayStatus(p: Pigeon): { icon: string; label: string } | null {
  if (p.away) return { icon: '🧭', label: 'de weg kwijt' };
  if (p.flying) return { icon: '✈️', label: 'vliegt' };
  if (p.inInfirmary) return { icon: '🏥', label: 'ziekenboeg' };
  return null;
}

/** How a patient is doing: the ailment and how far she has healed. */
function recovery(p: Pigeon): string {
  const a = p.ailment;
  if (!a) return 'rust';
  const pct = `${Math.round((a.healed ?? 0) * 100)}% hersteld`;
  return `${a.name}, ${pct}${p.treated ? '' : ' · wacht op verzorging'}`;
}

function Name({ id, name }: { id: string; name: string }) {
  return <Link to={`/duif/${id}`}>{name}</Link>;
}

/**
 * One bird or koppel per line. The icon hangs in front, so a long name that
 * wraps on a phone stays visibly one entry; the faint note moves to the next
 * line as a whole when it does not fit behind the name.
 */
function Line({ icon, note, children }: { icon?: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      {icon && <span style={{ flex: 'none' }}>{icon}</span>}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, minWidth: 0 }}>
        <span style={{ minWidth: 0 }}>{children}</span>
        {note && <span className="faint">{note}</span>}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'nowrap', padding: '6px 0', borderTop: '1px solid var(--border)' }}>
      <span className="faint" style={{ flex: '0 0 104px' }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 3, overflowWrap: 'anywhere' }}>{children}</div>
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
  const byId = new Map(pigeons.map((p) => [p.id, p]));
  const inComp = pigeons.filter((p) => p.compartment && !p.inInfirmary).slice(0, loft.compartments);
  const free = Math.max(0, loft.capacity - pigeons.length);
  const away = pigeons.flatMap((p) => {
    const st = awayStatus(p);
    return st ? [{ p, st }] : [];
  });
  const home = pigeons.length - away.length;
  const patients = pigeons.filter((p) => p.inInfirmary);
  const beds = loft.infirmaryCapacity;
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
        <div>
          {pigeons.length} van {loft.capacity} bezet
          {free > 0 && <> · <Link to="/markt">{free} vrij →</Link></>}
        </div>
        <div>{home} thuis</div>
      </Row>
      {loft.compartments > 0 && (
        <Row label="Aparte hokken">
          {inComp.map((p) => (
            <div key={p.id}><Name id={p.id} name={p.name} /></div>
          ))}
          {freeComps > 0 && (
            <div className="row" style={{ gap: 8 }}>
              <span className="faint">{freeComps} vrij</span>
              {canMoveIn.length > 0 && (
                <select
                  aria-label="Wie mag in een apart hok?"
                  value=""
                  disabled={busy}
                  onChange={(e) => e.target.value && onAssignCompartment(e.target.value)}
                  style={{ width: 'auto', maxWidth: '100%', minWidth: 0, fontSize: '0.85rem', padding: '2px 6px' }}
                >
                  <option value="">Zet apart…</option>
                  {canMoveIn.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </div>
          )}
        </Row>
      )}
      <Row label="Nest">
        {nests.length > 0
          ? nests.map((pair, i) => (
              <Line key={i} icon="🥚">
                {pair.map((p, j) => <span key={p.id}>{j > 0 && ' & '}<Name id={p.id} name={p.name} /></span>)}
              </Line>
            ))
          : <div><span className="faint">leeg · </span><Link to="/kweek">naar de kweek →</Link></div>}
      </Row>
      <Row label="Ziekenboeg">
        <div>{patients.length} van {beds === 1 ? '1 bed' : `de ${beds} bedden`} bezet</div>
        {patients.map((p) => (
          <Line key={p.id} icon={!p.ailment ? '🏥' : p.ailment.kind === 'kwetsuur' ? '🩹' : '🦠'} note={recovery(p)}>
            <Name id={p.id} name={p.name} />
          </Line>
        ))}
      </Row>
      {couples.length > 0 && (
        <Row label="Koppels">
          {couples.map((c) => (
            <Line
              key={c.dofferId}
              icon={c.status === 'koppel' ? '💑' : '⏳'}
              note={[
                c.status === 'wennen' && `wennen, dag ${c.day}${c.partnerhok ? ' · partnerhok' : ''}`,
                (widowerIds.has(c.dofferId) || widowerIds.has(c.duivinId)) && '❤️ weduwschap',
              ].filter(Boolean).join(' · ') || undefined}
            >
              <Name id={c.dofferId} name={c.dofferName} /> &amp; <Name id={c.duivinId} name={c.duivinName} />
            </Line>
          ))}
        </Row>
      )}
      {(insured > 0 || vaccinated > 0) && (
        <Row label="Bescherming">
          {vaccinated > 0 && <Line icon="💉">{vaccinated} {vaccinated === 1 ? 'duif' : 'duiven'} ingeënt of gekuurd</Line>}
          {insured > 0 && <Line icon="🛡️">{insured} verzekerd</Line>}
        </Row>
      )}
      {away.length > 0 && (
        <Row label="Niet thuis">
          {away.map(({ p, st }) => (
            <Line key={p.id} icon={st.icon} note={st.label}>
              <Name id={p.id} name={p.name} />
            </Line>
          ))}
        </Row>
      )}
    </div>
  );
}
