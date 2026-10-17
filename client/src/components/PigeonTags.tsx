/**
 * Tags op je duiven, on the pigeon's own page: the owner's private labels
 * ("sprint", "mid-fond", "lange-fond", …) — shown on Mijn hok and behind her name
 * when entering a flight. One line while closed; tap "aanpassen" for a text field
 * (comma-separated) with the tags you already use on your other birds as one-tap
 * suggestions, so "sprint" stays "sprint" and doesn't become "Sprint" on the next.
 * The rules (how many, how long, gone on a sale) are the server's — core/game/tags.ts.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import { TagBadges, useToast } from './ui';
import type { Pigeon } from '../types';

const split = (text: string) => text.split(',').map((t) => t.trim()).filter(Boolean);

export function PigeonTags({ pigeon, onSaved }: { pigeon: Pigeon; onSaved: () => Promise<void> | void }) {
  const { state, refresh } = useGame();
  const toast = useToast();
  const tags = pigeon.tags ?? [];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const max = state?.economy?.pigeonTagsMax ?? 3;
  const maxLength = state?.economy?.pigeonTagMaxLength ?? 20;

  // Tags already on your other birds, most used first — a tap adds one.
  const typed = new Set(split(text).map((t) => t.toLowerCase()));
  const counts = new Map<string, number>();
  for (const p of state?.pigeons ?? []) {
    for (const t of p.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const suggestions = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'nl'))
    .map(([t]) => t)
    .filter((t) => !typed.has(t.toLowerCase()))
    .slice(0, 8);
  const tooMany = split(text).length > max;

  function open() {
    setText(tags.join(', '));
    setEditing(true);
  }

  async function save(next: string) {
    setBusy(true);
    try {
      await api(`/pigeons/${pigeon.id}/tags`, { method: 'POST', body: { tags: next } });
      toast.show(split(next).length > 0 ? 'Tags bewaard 🏷️' : 'Tags gewist', 'ok');
      setEditing(false);
      await onSaved();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }} data-tour="pigeon-tags">
      {!editing ? (
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {tags.length > 0 ? <TagBadges tags={tags} /> : <span className="faint">🏷️ Nog geen tags</span>}
          <button className="btn ghost sm" disabled={busy} onClick={open}>
            {tags.length > 0 ? 'Tags aanpassen' : 'Tag toevoegen'}
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="bv. sprint, lange-fond"
            maxLength={max * (maxLength + 2)}
            autoFocus
            aria-label="Tags, gescheiden door een komma"
            onKeyDown={(e) => { if (e.key === 'Enter' && !tooMany) save(text); }}
          />
          {suggestions.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {suggestions.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="chip"
                  disabled={busy}
                  onClick={() => setText((cur) => [...split(cur), t].join(', '))}
                >
                  + {t}
                </button>
              ))}
            </div>
          )}
          <div className="faint" style={{ fontSize: '0.8rem' }}>
            Tot {max} tags, gescheiden door een komma. Enkel jij ziet ze; bij verkoop verdwijnen ze.{' '}
            <Link to="/wiki#tags">Meer info →</Link>
          </div>
          {tooMany && <div style={{ fontSize: '0.8rem', color: 'var(--bad)' }}>Hoogstens {max} tags per duif.</div>}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" disabled={busy || tooMany} onClick={() => save(text)}>Opslaan</button>
            {tags.length > 0 && (
              <button className="btn ghost sm" disabled={busy} onClick={() => save('')}>Wissen</button>
            )}
            <button className="btn ghost sm" disabled={busy} onClick={() => setEditing(false)}>Annuleer</button>
          </div>
        </div>
      )}
    </div>
  );
}
