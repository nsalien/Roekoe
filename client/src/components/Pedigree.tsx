/**
 * Stamboom: a genealogy chart, folded away behind one button.
 *
 * Generations run left→right in columns — the bird herself, her parents, the
 * grandparents and the great-grandparents (PEDIGREE_GENERATIONS = 3 levels of
 * ancestors). The connectors are pure CSS (see .ped-* in global.css), which
 * works only because every cell in a column is an equal-height flex child: a
 * parent's centre then lands exactly where its two children's half-brackets
 * meet. So EVERY slot is rendered, unknown ones as a faint dash — dropping one
 * would shift the cells and bend the lines.
 *
 * Each box stays SPARSE on purpose (see the tekstbudget rule): a name, the
 * general score, and — if she is still alive — whose loft she sits in. That
 * last bit is the part players act on ("my champion's mother is in Jan's
 * loft"). Everything else is one click away on her own page.
 *
 * A branch simply stops where the line dies out: a dead bird leaves no row, so
 * her own parents are unknowable (see core/game/pedigree.ts). Such a box is
 * greyed with a †, using the name remembered on the child.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AncestorNode } from '../types';

/** Column headers, and — via its length — how deep the chart goes. */
const GEN_LABELS = ['Duif', 'Ouders', 'Grootouders', 'Overgrootouders'];

/** Portrait size per generation; the deepest column is name-only. */
const PIC = [34, 30, 24, 0];

/**
 * Flatten the tree into fixed 2^g slot rows. Slot `i` of a generation has its
 * father at `2i` and its mother at `2i + 1` in the next one — the classic
 * pedigree numbering, and what lets the CSS pair up cells by index parity.
 */
function toGenerations(root: AncestorNode): (AncestorNode | null)[][] {
  const gens: (AncestorNode | null)[][] = [[root]];
  for (let g = 1; g < GEN_LABELS.length; g++) {
    const next: (AncestorNode | null)[] = [];
    for (const n of gens[g - 1]) next.push(n?.sire ?? null, n?.dam ?? null);
    gens.push(next);
  }
  // A generation nobody knows anything about is noise, not information.
  while (gens.length > 2 && gens[gens.length - 1].every((n) => !n)) gens.pop();
  return gens;
}

function Node({
  node, gen, mineId, hasKids, isRoot,
}: {
  node: AncestorNode;
  gen: number;
  mineId?: string;
  hasKids: boolean;
  isRoot: boolean;
}) {
  const mine = !!mineId && node.ownerId === mineId;
  const pic = PIC[Math.min(gen, PIC.length - 1)];
  const where = !node.alive ? 'overleden' : mine ? 'jouw hok' : node.ownerName ?? '';
  const sub = [
    node.talent != null ? `★${node.talent}` : null,
    // The deepest column is too narrow for a loft name; the sex carries it there.
    gen >= PIC.length - 1 ? (node.sex === 'doffer' ? '♂' : '♀') : where || null,
  ].filter(Boolean).join(' · ');

  const cls = [
    'ped-node', node.sex, hasKids ? 'kids' : '', isRoot ? 'self' : '', node.alive ? '' : 'gone',
  ].filter(Boolean).join(' ');

  const inner = (
    <>
      {pic > 0 && (node.image ? (
        <img
          className={`ped-pic${node.alive ? '' : ' gone'}`}
          src={`/pigeon-images/${node.image}`}
          alt=""
          loading="lazy"
          width={pic}
          height={pic}
          style={{ width: pic, height: pic }}
        />
      ) : (
        <span className="ped-glyph" style={{ width: pic }}>{node.alive ? '🕊️' : '†'}</span>
      ))}
      <div className="ped-body">
        <div className="ped-name">
          {/* The portrait slot already carries the †; only the name-only column
              (deepest generation, pic === 0) has to say it in the name. */}
          {node.alive || pic > 0 ? '' : '† '}
          {node.name}
          {node.quirk && <span title="Bijzonderheid"> ✨</span>}
        </div>
        {sub && <div className="ped-sub">{sub}</div>}
      </div>
    </>
  );

  // Only a bird that still exists has a page to open.
  const title = `${node.name} · ${node.sex}${node.talent != null ? ` · ★${node.talent}` : ''}${where ? ` · ${where}` : ''}`;
  return node.alive && node.id && !isRoot ? (
    <Link className={cls} to={`/duif/${node.id}`} title={title}>{inner}</Link>
  ) : (
    <div className={cls} title={title}>{inner}</div>
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
  const gens = useMemo(() => (root ? toGenerations(root) : []), [root]);

  if (!root || known === 0) {
    return <p className="muted" style={{ marginTop: 8 }}>Afkomst onbekend (grondduif).</p>;
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button
        className="btn secondary block"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        🌳 {open ? 'Verberg stamboom' : 'Toon volledige stamboom'} · {known} {known === 1 ? 'voorouder' : 'voorouders'}
      </button>

      {open && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <div className="ped-scroll">
            <div className="ped-chart">
              {gens.map((slots, gen) => (
                <div className={`ped-gen g${gen}`} key={gen}>
                  <div className="ped-gen-head">{GEN_LABELS[gen]}</div>
                  <div className="ped-col">
                    {slots.map((node, i) => {
                      // Index parity is the pair: even = father (upper half),
                      // odd = mother (lower half). That drives the bracket.
                      const side = gen === 0 ? '' : i % 2 === 0 ? 'sire' : 'dam';
                      const kids = !!gens[gen + 1] && !!(gens[gen + 1][i * 2] || gens[gen + 1][i * 2 + 1]);
                      return (
                        <div className={`ped-cell ${side}${node ? '' : ' empty'}`} key={i}>
                          {node
                            ? <Node node={node} gen={gen} mineId={mineId} hasKids={kids} isRoot={gen === 0} />
                            : <div className="ped-empty" title="onbekend" />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="ped-hint">← Sleep opzij voor de oudere generaties →</p>

          <div className="ped-legend">
            <span><i className="sw" style={{ background: 'var(--ped-sire)' }} />doffer ♂</span>
            <span><i className="sw" style={{ background: 'var(--ped-dam)' }} />duivin ♀</span>
            <span>† overleden</span>
            <span>✨ bijzonderheid</span>
          </div>
          <p className="faint" style={{ fontSize: '0.78rem', margin: 0 }}>
            Klik een duif die nog leeft om naar haar pagina te gaan. Een tak stopt bij een duif
            die er niet meer is — met haar verdween ook wie háár ouders waren.
          </p>
        </div>
      )}
    </div>
  );
}
