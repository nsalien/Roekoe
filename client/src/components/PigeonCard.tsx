/** A pigeon summary card: avatar, key attributes and an optional action area. */

import { Link } from 'react-router-dom';
import type { Pigeon } from '../types';
import { PigeonAvatar } from './PigeonAvatar';
import { BreedBadge, PigeonStats, SexBadge } from './ui';

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
  showBreed,
  avatarSize = 76,
  showcase,
  tourId,
}: {
  pigeon: Pigeon;
  to?: string;
  children?: React.ReactNode;
  showOwner?: boolean;
  /** Show the breed (ras) chip — worth it wherever the bird is on offer. */
  showBreed?: boolean;
  avatarSize?: number;
  /** Draw the photo big, in a rounded square instead of a small round crop. */
  showcase?: boolean;
  tourId?: string;
}) {
  const inner = (
    <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 12 }}>
      <div style={{ flex: '0 0 auto' }}>
        <PigeonAvatar pigeon={pigeon} size={avatarSize} shape={showcase ? 'showcase' : 'circle'} />
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
          {pigeon.ailment && (
            <span className={`badge ${pigeon.ailment.severity === 'ernstig' ? 'sev-ernstig' : pigeon.ailment.severity === 'matig' ? 'sev-matig' : 'sev-licht'}`}>
              {pigeon.ailment.kind === 'ziekte' ? '🤒' : '🩹'} {pigeon.ailment.name}
            </span>
          )}
          {pigeon.inInfirmary && <span className="badge" style={{ background: 'var(--brand-soft)', color: 'var(--brand-ink)' }}>🏥</span>}
      {pigeon.away && (
        <span className="badge" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }} title="Nog niet thuis van haar laatste vlucht — ze komt vanzelf terug.">
          🧭 nog niet thuis
        </span>
      )}
          {pigeon.coached && <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>🎯</span>}
          {pigeon.compartment && <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-soft)' }}>🧱</span>}
          {pigeon.racing && <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-soft)' }}>🏁</span>}
          {pigeon.breeding && <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-soft)' }}>🥚</span>}
        </div>
        {showOwner && <div className="faint" style={{ marginBottom: 6 }}>🏠 {pigeon.ownerName}</div>}
      </div>
    </div>
  );

  return (
    <div className="card" data-tour={tourId}>
      {to ? (
        <Link to={to} style={{ color: 'inherit' }}>
          {inner}
        </Link>
      ) : (
        inner
      )}

      {showBreed && <div style={{ marginTop: 8 }}><BreedBadge breed={pigeon.breed} /></div>}

      {pigeon.revealed ? (
        <div style={{ marginTop: 6 }}>
          <PigeonStats pigeon={pigeon} showPerDay />
        </div>
      ) : (
        <div className="faint" style={{ marginTop: 8, fontSize: '0.85rem', lineHeight: 1.4 }}>
          🔒 Eigenschappen verborgen — enkel ★ {pigeon.talent} is gekend.
        </div>
      )}

      {children && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}
