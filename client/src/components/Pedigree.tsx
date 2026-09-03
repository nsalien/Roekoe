/**
 * Stamboom: ONE diagram for a bird's whole family, folded behind one button.
 *
 * Shape is an hourglass, read left to right:
 *
 *   Overgrootouders · Grootouders · Ouders │ DEZE GENERATIE │ Kinderen · Kleinkinderen
 *                                          │ broers/zussen  │
 *                                          │ de duif zelf   │
 *                                          │ partners       │
 *
 * ⚠️ The connectors are NOT drawn with CSS parity tricks any more. That only ever
 * worked for a binary tree (everyone has exactly two parents) and a clutch fans
 * out arbitrarily wide. Instead `buildLayout` lays every column out as
 * equal-height cells and emits LINK GROUPS — {left cells, right cells} — whose
 * positions are computed here as PERCENTAGES of the column height and written
 * inline. One mechanism covers two-parents-to-one-child, one-parent-to-six-young
 * and a whole sibship hanging off one couple.
 *
 * The one invariant that mechanism rests on: every cell WITHIN a column is the
 * same height (`flex: 1 1 0`). Columns may differ from each other. Break that and
 * every line in the diagram points somewhere else.
 *
 * ⚠️ Both directions truncate, for OPPOSITE reasons, and both are honest: upward
 * a dead bird leaves no row so her own parents are unknowable; downward a dead
 * CHILD leaves no row, so she and the grandchildren behind her cannot be reached
 * at all. Siblings and partners survive either death — they are read off a
 * living row (see core/game/pedigree.ts).
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PigeonAvatar } from './PigeonAvatar';
import type { AncestorNode, DescendantNode, FamilyMember, FamilyTree, SiblingNode } from '../types';

/** How deep the ancestor side goes, oldest label first. */
const UP_LABELS = ['Overgrootouders', 'Grootouders', 'Ouders'];
const DOWN_LABELS = ['Kinderen', 'Kleinkinderen', 'Achterkleinkinderen'];

export interface Cell {
  key: string;
  node: FamilyMember | null;
  note?: string;
  /** Portrait size; 0 renders a name-only box. */
  pic: number;
  self?: boolean;
}
export interface Column { label: string; cells: Cell[]; tall: boolean; }
/** Cells on the left of a gap that connect to cells on its right. */
export interface LinkGroup { left: number[]; right: number[] }
export interface Layout { columns: Column[]; gaps: LinkGroup[][] }

/** Flatten the ancestors into fixed 2^g slot rows (classic pedigree numbering). */
function toGenerations(root: AncestorNode): (AncestorNode | null)[][] {
  const gens: (AncestorNode | null)[][] = [[root]];
  for (let g = 1; g <= UP_LABELS.length; g++) {
    const next: (AncestorNode | null)[] = [];
    for (const n of gens[g - 1]) next.push(n?.sire ?? null, n?.dam ?? null);
    gens.push(next);
  }
  // A generation nobody knows anything about is noise, not information.
  while (gens.length > 1 && gens[gens.length - 1].every((n) => !n)) gens.pop();
  return gens;
}

/**
 * Turn the family into columns plus the links between them.
 *
 * ⚠️ The subject sits DEAD CENTRE of her own column, padded with blank cells if
 * the siblings above and the partners below are uneven. That is not cosmetic:
 * her parents' bracket meets at the vertical middle of the gap, so if she drifts
 * off centre the line from her parents lands next to her instead of on her.
 */
export function buildLayout(root: AncestorNode, family: FamilyTree | null): Layout {
  const columns: Column[] = [];
  const gaps: LinkGroup[][] = [];

  // --- Ancestors, oldest column first --------------------------------------
  const gens = toGenerations(root); // gens[0] = the bird, gens[1] = parents, …
  const upper = gens.slice(1).reverse(); // e.g. [great-grandparents, grandparents, parents]
  upper.forEach((slots, i) => {
    // `upper` is reversed, so the label list has to be read from the back too.
    const label = UP_LABELS[UP_LABELS.length - upper.length + i] ?? '';
    columns.push({
      label,
      tall: i === upper.length - 1, // the parents column carries the biggest boxes
      cells: slots.map((n, j) => ({
        key: `up${i}-${j}`,
        node: n,
        // Ook de verste kolom krijgt haar portret: de vraag was "steeds de
        // correcte foto, als die gekend is". Een 22 px-avatar is korter dan de
        // twee tekstregels ernaast, dus de celhoogte beweegt er niet door.
        pic: i === upper.length - 1 ? 30 : i === upper.length - 2 ? 24 : 22,
        note: i <= upper.length - 3 ? (n?.sex === 'doffer' ? '♂' : '♀') : undefined,
      })),
    });
    // Between two ancestor columns: right slot k descends from left slots 2k, 2k+1.
    if (i > 0) {
      const groups: LinkGroup[] = [];
      const right = columns[columns.length - 1].cells;
      right.forEach((_, k) => {
        const left = [k * 2, k * 2 + 1].filter((s) => upper[i - 1][s]);
        if (left.length && right[k].node) groups.push({ left, right: [k] });
      });
      gaps.push(groups);
    }
  });

  // --- The subject's own generation: siblings, herself, partners ------------
  const siblings = family?.siblings ?? [];
  const partners = family?.partners ?? [];
  const above = siblings;
  const below = partners;
  const arm = Math.max(above.length, below.length);
  const blank = (k: string): Cell => ({ key: k, node: null, pic: 0 });
  const cells: Cell[] = [
    ...Array.from({ length: arm - above.length }, (_, i) => blank(`pad-a${i}`)),
    ...above.map((s, i) => ({ key: `sib${i}`, node: s as FamilyMember, pic: 30, note: siblingNote(s) })),
    { key: 'self', node: root, pic: 34, self: true },
    ...below.map((p, i) => ({ key: `mate${i}`, node: p, pic: 30, note: 'partner' })),
    ...Array.from({ length: arm - below.length }, (_, i) => blank(`pad-b${i}`)),
  ];
  const selfIndex = arm; // dead centre of 2·arm + 1 cells
  columns.push({ label: 'Deze duif', tall: true, cells });

  // Parents → the whole sibship (the subject and everyone sharing a parent).
  if (upper.length > 0) {
    const parentSlots = [0, 1].filter((s) => upper[upper.length - 1][s]);
    const kin = cells.map((c, i) => (c.node && !c.key.startsWith('mate') ? i : -1)).filter((i) => i >= 0);
    gaps.push(parentSlots.length ? [{ left: parentSlots, right: kin }] : []);
  }

  // --- Descendants ---------------------------------------------------------
  // Young are ordered per partner so one clutch stays contiguous, which keeps
  // its bracket a single unbroken span instead of a comb.
  const kids = [...(family?.children ?? [])].sort((a, b) =>
    (a.partner?.id ?? '').localeCompare(b.partner?.id ?? ''));

  if (kids.length > 0) {
    // From the subject AND the matching partner box, so both parents show a line.
    const groups: LinkGroup[] = [];
    const byMate = new Map<string, number[]>();
    kids.forEach((k, i) => {
      const key = k.partner?.id ?? '—';
      byMate.set(key, [...(byMate.get(key) ?? []), i]);
    });
    for (const [key, idxs] of byMate) {
      const mateAt = below.findIndex((p) => (p.id ?? '') === key);
      const left = mateAt >= 0 ? [selfIndex, selfIndex + 1 + mateAt] : [selfIndex];
      groups.push({ left, right: idxs });
    }
    gaps.push(groups);
    columns.push({
      label: DOWN_LABELS[0],
      tall: true,
      cells: kids.map((k, i) => ({ key: `d0-${i}`, node: k, pic: 30 })),
    });

    // Deeper levels: each parent fans to a contiguous run of its own young.
    let level = kids;
    for (let d = 1; d < DOWN_LABELS.length; d++) {
      const next: DescendantNode[] = [];
      const groups2: LinkGroup[] = [];
      level.forEach((n, i) => {
        if (!n.children.length) return;
        const start = next.length;
        next.push(...n.children);
        groups2.push({ left: [i], right: n.children.map((_, j) => start + j) });
      });
      if (!next.length) break;
      gaps.push(groups2);
      columns.push({
        label: DOWN_LABELS[d],
        tall: false,
        cells: next.map((k, i) => ({
          key: `d${d}-${i}`,
          node: k,
          pic: 24,
          note: k.partner ? `uit ${k.partner.name}` : undefined,
        })),
      });
      level = next;
    }
  }

  return { columns, gaps };
}

/** How a sibling is related, in the words a breeder uses. */
function siblingNote(s: SiblingNode): string {
  const word = s.sex === 'doffer' ? 'broer' : 'zus';
  return s.full ? `volle ${word}` : `half${word} · zelfde ${s.sharedSire ? 'vader' : 'moeder'}`;
}

/** Centre of cell `i` in a column of `n`, as a percentage of the column height. */
export const centre = (i: number, n: number) => ((i + 0.5) / n) * 100;

/** The one box used everywhere, so the whole diagram reads as one family. */
function Box({ cell, mineId }: { cell: Cell; mineId?: string }) {
  const node = cell.node!;
  const mine = !!mineId && node.ownerId === mineId;
  const where = !node.alive ? 'overleden' : mine ? 'jouw hok' : node.ownerName ?? '';
  const sub = [node.talent != null ? `★${node.talent}` : null, cell.note ?? (where || null)]
    .filter(Boolean).join(' · ');
  const cls = ['ped-node', node.sex, node.alive ? '' : 'gone', cell.self ? 'self' : '']
    .filter(Boolean).join(' ');
  const pic = cell.pic;

  const inner = (
    <>
      {/* ⚠️ Dezelfde `PigeonAvatar` als de rest van het spel, en niet een eigen
          <img> op de bestandsnaam. Die tweede weg negeerde de regel dat een duif
          met een AFWIJKING de getekende duif krijgt in plaats van haar rasfoto —
          geen enkele stockfoto heeft drie vleugels — en toonde dus stilletjes de
          verkeerde duif. Eén component, één antwoord op "welke foto hoort hier". */}
      {pic > 0 && (node.breed || node.id ? (
        <div className={node.alive ? undefined : 'ped-pic gone'} style={{ display: 'flex', flexShrink: 0 }}>
          <PigeonAvatar
            pigeon={{
              id: node.id ?? node.name,
              sex: node.sex,
              talent: node.talent ?? 0,
              breed: node.breed ?? undefined,
              quirk: node.quirk,
            }}
            size={pic}
          />
        </div>
      ) : (
        // Geen ras én geen rij meer: we weten enkel nog haar naam.
        <span className="ped-glyph" style={{ width: pic }}>{node.alive ? '🕊️' : '†'}</span>
      ))}
      <div className="ped-body">
        <div className="ped-name">
          {/* A box with a portrait already shows the †; a name-only one must say it. */}
          {node.alive || pic > 0 ? '' : '† '}
          {node.name}
          {node.quirk && <span title="Bijzonderheid"> ✨</span>}
        </div>
        {sub && <div className="ped-sub">{sub}</div>}
      </div>
    </>
  );

  const title = `${node.name} · ${node.sex}${node.talent != null ? ` · ★${node.talent}` : ''}${where ? ` · ${where}` : ''}`;
  // Only a bird that still exists has a page to open; the subject is already here.
  return node.alive && node.id && !cell.self
    ? <Link className={cls} to={`/duif/${node.id}`} title={title}>{inner}</Link>
    : <div className={cls} title={title}>{inner}</div>;
}

/** One gap's worth of connectors, positioned purely in percentages. */
function Gap({ groups, nLeft, nRight }: { groups: LinkGroup[]; nLeft: number; nRight: number }) {
  return (
    <div className="ped-gap">
      <div className="ped-gen-head" aria-hidden>&nbsp;</div>
      <div className="ped-gap-area">
        {groups.map((g, gi) => {
          const lc = g.left.map((i) => centre(i, nLeft));
          const rc = g.right.map((i) => centre(i, nRight));
          const all = [...lc, ...rc];
          const top = Math.min(...all);
          const bottom = Math.max(...all);
          // Two clutches from one bird share the subject's stub, so nudge each
          // bundle sideways — otherwise they draw straight over each other.
          const shift = groups.length > 1 ? (gi - (groups.length - 1) / 2) * 5 : 0;
          const busX = `calc(50% - 1px + ${shift}px)`;
          return (
            <div key={gi}>
              <i className="ped-bus" style={{ left: busX, top: `${top}%`, height: `${bottom - top}%` }} />
              {lc.map((y, i) => (
                <i key={`l${i}`} className="ped-tick"
                  style={{ left: 0, width: `calc(50% + ${shift}px)`, top: `calc(${y}% - 1px)` }} />
              ))}
              {rc.map((y, i) => (
                <i key={`r${i}`} className="ped-tick"
                  style={{ left: `calc(50% + ${shift}px)`, right: 0, top: `calc(${y}% - 1px)` }} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  const upward = countAncestors(root?.sire ?? null) + countAncestors(root?.dam ?? null);
  const siblings = family?.siblings ?? [];
  const partners = family?.partners ?? [];
  const downward = countDescendants(family?.children ?? []);
  const total = upward + siblings.length + partners.length + downward;
  const layout = useMemo(() => (root ? buildLayout(root, family) : null), [root, family]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const selfCol = useRef<HTMLDivElement | null>(null);

  // ⚠️ Het diagram is breder dan een gsm en de duif staat in het MIDDEN, dus
  // zonder dit opent het op de overgrootouders en lijkt haar eigen tak te
  // ontbreken. Gemeten op 390 px: de kolom "Deze duif" begon volledig buiten
  // beeld. Bewust via scrollLeft en niet via scrollIntoView — dat laatste
  // versleept ook de pagina zelf.
  useEffect(() => {
    if (!open) return;
    const s = scroller.current;
    const t = selfCol.current;
    if (!s || !t) return;
    const delta = t.getBoundingClientRect().left - s.getBoundingClientRect().left;
    s.scrollLeft += delta - Math.max(0, (s.clientWidth - t.offsetWidth) / 2);
  }, [open]);

  if (!root || total === 0) {
    return (
      <p className="muted" style={{ marginTop: 8 }}>
        Nog geen familie bekend — geen ouders, broers, zussen of jongen.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn secondary block" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        🌳 {open ? 'Verberg stamboom' : 'Toon volledige stamboom'} · {total} {total === 1 ? 'verwant' : 'verwanten'}
      </button>

      {open && layout && (
        <div className="ped-panel" style={{ marginTop: 12 }}>
          <div className="ped-scroll" ref={scroller}>
            <div className="ped-chart">
              {layout.columns.map((col, ci) => (
                <Fragment key={col.label + ci}>
                  {ci > 0 && (
                    <Gap
                      groups={layout.gaps[ci - 1] ?? []}
                      nLeft={layout.columns[ci - 1].cells.length}
                      nRight={col.cells.length}
                    />
                  )}
                  <div
                    className={`ped-gen${col.tall ? ' tall' : ''}${col.label === 'Deze duif' ? ' wide' : ''}`}
                    ref={col.label === 'Deze duif' ? selfCol : undefined}
                  >
                    <div className="ped-gen-head">{col.label}</div>
                    <div className="ped-col">
                      {col.cells.map((cell) => (
                        <div className="ped-cell" key={cell.key}>
                          {cell.node
                            ? <Box cell={cell} mineId={mineId} />
                            : <div className="ped-empty" title="onbekend" />}
                        </div>
                      ))}
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>

          <p className="ped-hint">← Sleep opzij voor de rest van de familie →</p>

          <div className="ped-legend">
            <span><i className="sw" style={{ background: 'var(--ped-sire)' }} />doffer ♂</span>
            <span><i className="sw" style={{ background: 'var(--ped-dam)' }} />duivin ♀</span>
            <span>† overleden</span>
            <span>✨ bijzonderheid</span>
          </div>
          <p className="faint" style={{ fontSize: '0.78rem', margin: 0 }}>
            Broers, zussen en partners staan in dezelfde kolom als de duif zelf. Klik een duif
            die nog leeft om naar haar pagina te gaan. Een tak stopt bij een duif die er niet
            meer is — met haar verdwenen ook haar ouders en haar eigen jongen.
          </p>
        </div>
      )}
    </div>
  );
}
