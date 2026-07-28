/** A pigeon summary card: avatar, key attributes and an optional action area. */

import { Link } from 'react-router-dom';
import type { Pigeon } from '../types';
import { PigeonAvatar } from './PigeonAvatar';
import { SexBadge, StatBar } from './ui';

function ageLabel(weeks: number): string {
  const years = Math.floor(weeks / 52);
  const rem = weeks % 52;
  if (years <= 0) return `${weeks} wk`;
  return `${years}j ${rem}wk`;
}

export function PigeonCard({
  pigeon,
  to,
  children,
  showOwner,
}: {
  pigeon: Pigeon;
  to?: string;
  children?: React.ReactNode;
  showOwner?: boolean;
}) {
  const inner = (
    <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 12 }}>
      <div style={{ flex: '0 0 auto' }}>
        <PigeonAvatar pigeon={pigeon} size={76} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
          <strong style={{ fontSize: '1.02rem' }}>{pigeon.name}</strong>
          <span className="faint">{ageLabel(pigeon.ageWeeks)}</span>
        </div>
        <div className="row" style={{ gap: 6, margin: '4px 0 8px' }}>
          <SexBadge sex={pigeon.sex} />
          <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-soft)' }}>
            ★ {pigeon.talent}
          </span>
          {pigeon.forSale && <span className="badge sale">te koop</span>}
        </div>
        {showOwner && <div className="faint" style={{ marginBottom: 6 }}>🏠 {pigeon.ownerName}</div>}
      </div>
    </div>
  );

  return (
    <div className="card">
      {to ? (
        <Link to={to} style={{ color: 'inherit' }}>
          {inner}
        </Link>
      ) : (
        inner
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px 12px', marginTop: 6 }}>
        <StatBar label="Snelheid" value={pigeon.speed} />
        <StatBar label="Uithouding" value={pigeon.endurance} />
        <StatBar label="Oriëntatie" value={pigeon.orientation} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', marginTop: 2 }}>
        <StatBar label="Conditie" value={pigeon.form} variant="form" />
        <StatBar label="Gezondh." value={pigeon.health} variant="health" />
      </div>

      {children && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}
