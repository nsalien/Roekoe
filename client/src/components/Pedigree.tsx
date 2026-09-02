/**
 * Stamboom: a bird's whole family, folded away behind one button.
 *
 * Three sections, because a family is not one shape:
 *
 *  - **Voorouders** — a binary chart, generations as columns left→right. The
 *    connectors are pure CSS (see .ped-* in global.css) and that works ONLY
 *    because every cell in a column is an equal-height flex child: a parent's
 *    centre then lands exactly where its two children's half-brackets meet. So
 *    every slot is rendered, unknown ones as a faint dash — dropping one would
 *    shift the cells and bend the lines.
 *  - **Broers & zussen** — a plain grid. Siblings have no depth, only a degree.
 *  - **Nakomelingen** — a rail tree, grouped per partner. Offspring fan out
 *    arbitrarily (a bird can have six young), which the binary column chart
 *    cannot express; an indented rail can, at any width.
 *
 * Each box stays SPARSE on purpose (see the tekstbudget rule): a name, the
 * general score, and — if she is still alive — whose loft she sits in. That last
 * bit is the part players act on ("my champion's mother is in Jan's loft").
 *
 * ⚠️ The two directions truncate for OPPOSITE reasons, and both are honest:
 * upward, a dead bird leaves no row so her own parents are unknowable; downward,
 * a dead CHILD leaves no row so she and the grandchildren behind her cannot be
 * reached at all. Siblings and partners survive either death, because they are
 * read off a living row.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AncestorNode, DescendantNode, FamilyMember, FamilyTree, SiblingNode } from '../types';

/** Column headers of the ancestor chart, and — via its length — how deep it goes. */
const GEN_LABELS = ['Duif', 'Ouders', 'Grootouders', 'Overgrootouders'];

/** Portrait size per generation; the deepest column is name-only. */
const PIC = [34, 30, 24, 0];

/** Depth labels on the descendant side. */
const DOWN_LABELS = ['Kinderen', 'Kleinkinderen', 'Achterkleinkinderen'];

/**
 * Flatten the ancestors into fixed 2^g slot rows. Slot `i` of a generation has
 * its father at `2i` and its mother at `2i + 1` in the next one — the classic
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

/** The one box used everywhere, so the whole view reads as one family. */
function Box({
  node, pic = 30, mineId, extraClass = '', note, linkable = true,
}: {
  node: FamilyMember;
  pic?: number;
  mineId?: string;
  extraClass?: string;
  /** Replaces the loft line when the relationship matters more (e.g. "volle zus"). */
  note?: string;
  linkable?: boolean;
}) {
  const mine = !!mineId && node.ownerId === mineId;
  const where = !node.alive ? 'overleden' : mine ? 'jouw hok' : node.ownerName ?? '';
  const sub = [node.talent != null ? `★${node.talent}` : null, note ?? (where || null)]
    .filter(Boolean).join(' · ');
  const cls = ['ped-node', node.sex, node.alive ? '' : 'gone', extraClass].filter(Boolean).join(' ');

  const inner = (
    <>
      {pic > 0 && (node.image ? (
        <img
          className={`ped-pic${node.alive ? '' : ' gone'}`}
          src={`/pigeon-images/${node.image}`}
          alt="" loading="lazy" width={pic} height={pic}
          style={{ width: pic, height: pic }}
        />
      ) : (
        <span className="ped-glyph" style={{ width: pic }}>{node.alive ? '🕊️' : '†'}</span>
      ))}
      <div className="ped-body">
        <div className="ped-name">
          {/* The portrait slot already carries the †; only a box without one
              (the name-only column) has to say it in the name. */}
          {node.alive || pic > 0 ? '' : '† '}
          {node.name}
          {node.quirk && <span title="Bijzonderheid"> ✨</span>}
        </div>
        {sub && <div className="ped-sub">{sub}</div>}
      </div>
    </>
  );

  const title = `${node.name} · ${node.sex}${node.talent != null ? ` · ★${node.talent}` : ''}${where ? ` · ${where}` : ''}`;
  // Only a bird that still exists has a page to open.
  return node.alive && node.id && linkable
    ? <Link className={cls} to={`/duif/${node.id}`} title={title}>{inner}</Link>
    : <div className={cls} title={title}>{inner}</div>;
}

/** How a sibling is related, in the words a breeder uses. */
function siblingNote(s: SiblingNode): string {
  const word = s.sex === 'doffer' ? 'broer' : 'zus';
  if (s.full) return `volle ${word}`;
  return `half${word} · zelfde ${s.sharedSire ? 'vader' : 'moeder'}`;
}

/** The descendant side: a rail tree, so an arbitrary fan-out still reads. */
function Offspring({ nodes, mineId, depth = 0 }: { nodes: DescendantNode[]; mineId?: string; depth?: number }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="ped-tree">
      {nodes.map((n) => (
        <li key={n.id ?? n.name}>
          <Box
            node={n}
            pic={depth === 0 ? 30 : 24}
            mineId={mineId}
            note={n.partner && depth > 0 ? `uit ${n.partner.name}` : undefined}
          />
          <Offspring nodes={n.children} mineId={mineId} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

/** Count what we actually know, so the toggle can say something useful. */
const countAncestors = (n: AncestorNode | null): number =>
  n ? 1 + countAncestors(n.sire) + countAncestors(n.dam) : 0;
const countDescendants = (nodes: DescendantNode[]): number =>
  nodes.reduce((t, n) => t + 1 + countDescendants(n.children), 0);

export function Pedigree({
  root, family, mineId,
}: {
  root: AncestorNode | null;
  family: FamilyTree | null;
  mineId?: string;
}) {
  const [open, setOpen] = useState(false);
  // `root` is the bird herself; her ancestors are what the chart is about.
  const upward = countAncestors(root?.sire ?? null) + countAncestors(root?.dam ?? null);
  const siblings = family?.siblings ?? [];
  const kids = family?.children ?? [];
  const downward = countDescendants(kids);
  const total = upward + siblings.length + downward;
  const gens = useMemo(() => (root ? toGenerations(root) : []), [root]);

  if (total === 0) {
    return (
      <p className="muted" style={{ marginTop: 8 }}>
        Nog geen familie bekend — geen ouders, broers, zussen of jongen.
      </p>
    );
  }

  // Top-level young are grouped per partner: a clutch reads as a clutch.
  const byPartner = new Map<string, { partner: FamilyMember | null; young: DescendantNode[] }>();
  for (const k of kids) {
    const key = k.partner?.id ?? '—';
    const g = byPartner.get(key);
    if (g) g.young.push(k);
    else byPartner.set(key, { partner: k.partner, young: [k] });
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn secondary block" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        🌳 {open ? 'Verberg stamboom' : 'Toon volledige stamboom'} · {total} {total === 1 ? 'verwant' : 'verwanten'}
      </button>

      {open && (
        <div className="ped-panel" style={{ marginTop: 12 }}>
          {upward > 0 && (
            <div>
              <div className="ped-sec-head">Voorouders</div>
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
                          const hasKids = !!gens[gen + 1] && !!(gens[gen + 1][i * 2] || gens[gen + 1][i * 2 + 1]);
                          return (
                            <div className={`ped-cell ${side}${node ? '' : ' empty'}`} key={i}>
                              {node ? (
                                <Box
                                  node={node}
                                  pic={PIC[Math.min(gen, PIC.length - 1)]}
                                  mineId={mineId}
                                  extraClass={`${hasKids ? 'kids' : ''} ${gen === 0 ? 'self' : ''}`}
                                  note={gen >= PIC.length - 1 ? (node.sex === 'doffer' ? '♂' : '♀') : undefined}
                                  linkable={gen !== 0}
                                />
                              ) : (
                                <div className="ped-empty" title="onbekend" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <p className="ped-hint">← Sleep opzij voor de oudere generaties →</p>
            </div>
          )}

          {siblings.length > 0 && (
            <div>
              <div className="ped-sec-head">
                Broers &amp; zussen <span className="faint">· {siblings.length}</span>
              </div>
              <div className="ped-kin">
                {siblings.map((s) => (
                  <Box key={s.id ?? s.name} node={s} mineId={mineId} note={siblingNote(s)} />
                ))}
              </div>
            </div>
          )}

          {kids.length > 0 && (
            <div>
              <div className="ped-sec-head">
                Nakomelingen <span className="faint">· {downward}</span>
              </div>
              {[...byPartner.values()].map((g, i) => (
                <div key={g.partner?.id ?? `onbekend-${i}`} style={{ marginTop: i === 0 ? 0 : 10 }}>
                  <div className="ped-mate">
                    {g.partner ? (
                      <>
                        gekoppeld met{' '}
                        {g.partner.id
                          ? <Link to={`/duif/${g.partner.id}`}>{g.partner.name}</Link>
                          : <strong>{g.partner.name}</strong>}
                      </>
                    ) : (
                      'andere ouder onbekend'
                    )}
                  </div>
                  <Offspring nodes={g.young} mineId={mineId} />
                </div>
              ))}
              <p className="faint" style={{ fontSize: '0.76rem', margin: '8px 0 0' }}>
                {DOWN_LABELS.join(' → ')} — zover de lijn reikt.
              </p>
            </div>
          )}

          <div className="ped-legend">
            <span><i className="sw" style={{ background: 'var(--ped-sire)' }} />doffer ♂</span>
            <span><i className="sw" style={{ background: 'var(--ped-dam)' }} />duivin ♀</span>
            <span>† overleden</span>
            <span>✨ bijzonderheid</span>
          </div>
          <p className="faint" style={{ fontSize: '0.78rem', margin: 0 }}>
            Klik een duif die nog leeft om naar haar pagina te gaan. Een tak stopt bij een duif
            die er niet meer is — met haar verdwenen ook haar ouders en haar eigen jongen.
          </p>
        </div>
      )}
    </div>
  );
}
