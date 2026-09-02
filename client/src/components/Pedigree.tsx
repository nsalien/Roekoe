/**
 * Stamboom: a pigeon's ancestors, collapsed by default.
 *
 * Deliberately SPARSE per box (see the tekstbudget rule): a name, whether she is
 * still alive, and — if she is — whose loft she sits in. That last bit is the
 * part players actually act on ("my champion's mother is in Jan's loft").
 * Everything else about an ancestor is one click away on her own page.
 *
 * A branch simply stops where the line dies out: a dead bird leaves no row, so
 * her own parents are unknowable (see core/game/pedigree.ts). Such a box is shown
 * greyed with a †, using the name remembered on the child.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AncestorNode } from '../types';

function Box({ node, mineId }: { node: AncestorNode | null; mineId?: string }) {
  if (!node) {
    return (
      <div className="faint" style={{ padding: '6px 8px', fontSize: '0.82rem', opacity: 0.6 }}>
        onbekend
      </div>
    );
  }
  const mine = !!mineId && node.ownerId === mineId;
  const inner = (
    <div className="row" style={{ gap: 8, alignItems: 'center', minWidth: 0 }}>
      {node.image ? (
        <img
          src={`/pigeon-images/${node.image}`}
          alt=""
          loading="lazy"
          style={{
            width: 30, height: 30, borderRadius: '50%', objectFit: 'contain', flexShrink: 0,
            background: 'var(--surface-2)', padding: 2,
            // A bird that is gone reads as history, not as stock.
            filter: node.alive ? undefined : 'grayscale(1)', opacity: node.alive ? 1 : 0.65,
          }}
        />
      ) : (
        <span style={{ width: 30, textAlign: 'center', flexShrink: 0 }}>{node.alive ? '🕊️' : '†'}</span>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '0.86rem', overflowWrap: 'anywhere' }}>
          {node.name}
          {node.quirk && <span title="Bijzonderheid" style={{ marginLeft: 4 }}>✨</span>}
        </div>
        <div className="faint" style={{ fontSize: '0.75rem' }}>
          {node.sex === 'doffer' ? '♂' : '♀'}
          {node.talent != null && ` · ★${node.talent}`}
          {node.alive ? (mine ? ' · jouw hok' : node.ownerName ? ` · ${node.ownerName}` : '') : ' · overleden'}
        </div>
      </div>
    </div>
  );

  const style: React.CSSProperties = {
    padding: '6px 8px',
    borderRadius: 8,
    background: 'var(--surface-2)',
    border: '1px solid var(--line, rgba(0,0,0,0.10))',
    minWidth: 0,
    display: 'block',
    textDecoration: 'none',
    color: 'inherit',
    opacity: node.alive ? 1 : 0.75,
  };

  // Only a bird that still exists has a page to open.
  return node.alive && node.id ? (
    <Link to={`/duif/${node.id}`} style={style}>{inner}</Link>
  ) : (
    <div style={style}>{inner}</div>
  );
}

/** One generation column, rendered recursively so depth is data-driven. */
function Branch({ node, mineId, depth }: { node: AncestorNode | null; mineId?: string; depth: number }) {
  if (depth === 0 || !node) return null;
  const hasParents = !!(node.sire || node.dam);
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
      <Box node={node} mineId={mineId} />
      {hasParents && (
        <div
          style={{
            display: 'grid', gap: 6, minWidth: 0,
            paddingLeft: 10, marginLeft: 4,
            borderLeft: '2px solid var(--line, rgba(0,0,0,0.12))',
          }}
        >
          <Branch node={node.sire} mineId={mineId} depth={depth - 1} />
          <Branch node={node.dam} mineId={mineId} depth={depth - 1} />
        </div>
      )}
    </div>
  );
}

/** Count the ancestors we actually know, so the toggle can say something useful. */
function countAncestors(node: AncestorNode | null): number {
  if (!node) return 0;
  return 1 + countAncestors(node.sire) + countAncestors(node.dam);
}

export function Pedigree({ root, mineId }: { root: AncestorNode | null; mineId?: string }) {
  const [open, setOpen] = useState(false);
  // `root` is the bird herself; her ancestors are what the tree is about.
  const known = countAncestors(root?.sire ?? null) + countAncestors(root?.dam ?? null);

  if (!root || known === 0) {
    return <p className="muted" style={{ marginTop: 8 }}>Afkomst onbekend (grondduif).</p>;
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        className="btn ghost sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ marginBottom: open ? 10 : 0 }}
      >
        {open ? '▾' : '▸'} Stamboom · {known} {known === 1 ? 'voorouder' : 'voorouders'}
      </button>
      {open && (
        <>
          <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
            <div>
              <div className="faint" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Vader (doffer)</div>
              <Branch node={root.sire} mineId={mineId} depth={3} />
            </div>
            <div>
              <div className="faint" style={{ fontSize: '0.75rem', marginBottom: 4 }}>Moeder (duivin)</div>
              <Branch node={root.dam} mineId={mineId} depth={3} />
            </div>
          </div>
          <p className="faint" style={{ fontSize: '0.78rem', marginTop: 10 }}>
            Een tak stopt bij een duif die er niet meer is — met haar verdween ook wie háár ouders waren.
          </p>
        </>
      )}
    </div>
  );
}
