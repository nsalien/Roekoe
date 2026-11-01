/**
 * De reactiekiezer: het paneel waarmee een speler tijdens een live vlucht een
 * korte kreet in de chatbox gooit.
 *
 * ## Waarom hij zo is opgebouwd
 *
 * De catalogus telt tientallen boodschappen en een doorsneespeler (level 5-6)
 * heeft er al gauw een kleine vijftig ontgrendeld. Door zo'n lijst scrollen om
 * "Amai." te vinden is geen doen, dus staan er drie dingen tussen de speler en
 * het raster:
 *
 *  1. **Recent bovenaan.** In de praktijk gebruikt iedereen dezelfde handvol.
 *     Die staan altijd op dezelfde plek, dus normaal gebruik is één tik. Bewaard
 *     per browser (localStorage) — het is een gemak, geen spelstand.
 *  2. **Tabs per categorie**, met alleen iconen: negen woorden naast elkaar past
 *     niet op een telefoon, negen emoji wel.
 *  3. **Zoeken pas boven de 20 ontgrendelde items.** Daaronder is het veld ruis.
 *
 * Vergrendelde boodschappen staan NIET tussen de bruikbare, maar onderaan achter
 * één regel per categorie. Elke categorie heeft van dag één iets bruikbaars (zie
 * de ontgrendelroutes in core/config/reactions.ts), dus er is nooit een dichte
 * tab — een slotje zonder inhoud erachter geeft een speler niets om naar toe te
 * werken.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useToast } from './ui';
import type { ChatTarget, ReactionView, ReactionsResponse } from '../types';

const RECENT_KEY = 'roekoe.reactions.recent';
const RECENT_MAX = 6;
/** Onder dit aantal ontgrendelde reacties is een zoekveld meer last dan hulp. */
const SEARCH_THRESHOLD = 20;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function pushRecent(id: string): string[] {
  const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Privémodus of geblokkeerde opslag — de kiezer werkt gewoon zonder.
  }
  return next;
}

export function ReactionPicker({
  flightId,
  onPosted,
}: {
  flightId: string;
  /** De verse chatregels die de server teruggaf, zodat de box meteen bijwerkt. */
  onPosted: (chat: unknown[]) => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<ReactionsResponse | null>(null);
  const [targets, setTargets] = useState<ChatTarget[]>([]);
  const [cat, setCat] = useState<string>('juich');
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [pending, setPending] = useState<ReactionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const loaded = useRef(false);

  // Pas ophalen als de speler het paneel echt opent: dit kost een volle
  // wereldload, en de live-pagina wordt uren opengehouden.
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    (async () => {
      try {
        const [r, t] = await Promise.all([
          api<ReactionsResponse>('/reactions'),
          api<{ targets: ChatTarget[] }>(`/flights/${flightId}/targets`),
        ]);
        setData(r);
        setTargets(t.targets);
      } catch (e) {
        toast.show(e instanceof Error ? e.message : 'Kon reacties niet laden', 'err');
        loaded.current = false;
      }
    })();
  }, [open, flightId, toast]);

  const owned = useMemo(() => data?.items.filter((i) => i.owned) ?? [], [data]);
  const byId = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i])), [data]);
  const showSearch = owned.length >= SEARCH_THRESHOLD;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle) return owned.filter((i) => i.text.toLowerCase().includes(needle));
    return owned.filter((i) => i.cat === cat);
  }, [owned, cat, q]);

  /** Vergrendelde items van de open tab, samengevat tot één regel. */
  const lockedHere = useMemo(
    () => (data?.items ?? []).filter((i) => !i.owned && i.cat === cat),
    [data, cat],
  );

  async function send(item: ReactionView, targetId?: string) {
    setBusy(true);
    try {
      const res = await api<{ chat: unknown[] }>(`/flights/${flightId}/react`, {
        method: 'POST',
        body: { templateId: item.id, targetId: targetId ?? null },
      });
      setRecent(pushRecent(item.id));
      setPending(null);
      onPosted(res.chat);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  function pick(item: ReactionView) {
    // Eerst de tekst, dán pas naar wie: de meeste boodschappen gaan naar de
    // vlucht, en die mogen geen tik extra kosten voor een keuze die er niet is.
    if (item.channel === 'speler') {
      if (targets.length === 0) {
        toast.show('Er doet niemand anders mee aan deze vlucht', 'err');
        return;
      }
      setPending(item);
      return;
    }
    send(item);
  }

  async function buy(item: ReactionView) {
    if (!window.confirm(`"${item.text}" ontgrendelen voor ${item.price} munten?`)) return;
    setBusy(true);
    try {
      const res = await api<ReactionsResponse>('/reactions/buy', { method: 'POST', body: { id: item.id } });
      setData(res);
      toast.show('Ontgrendeld 🔓', 'ok');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn sm" style={{ width: '100%' }} onClick={() => setOpen(true)}>
        💬 Reageren
      </button>
    );
  }

  return (
    <div className="reaction-picker">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>💬 Reageren</strong>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>sluiten</button>
      </div>

      {!data && <p className="muted" style={{ margin: '10px 0 0' }}>Laden…</p>}

      {data && (
        <>
          {/* Naar wie? Verschijnt alleen als de gekozen tekst gericht is. */}
          {pending && (
            <div className="reaction-target">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <span className="sm">“{pending.text}” — naar wie?</span>
                <button className="btn ghost sm" onClick={() => setPending(null)}>×</button>
              </div>
              <div className="reaction-chips" style={{ marginTop: 6 }}>
                {targets.map((t) => (
                  <button key={t.userId} className="btn sm" disabled={busy} onClick={() => send(pending, t.userId)}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {recent.length > 0 && !q && (
            <div className="reaction-recent">
              <span className="faint sm">recent</span>
              <div className="reaction-chips">
                {recent
                  .map((id) => byId.get(id))
                  .filter((i): i is ReactionView => !!i && i.owned)
                  .map((i) => (
                    <button key={i.id} className="reaction-chip" disabled={busy} onClick={() => pick(i)}>
                      {i.text}
                      {i.channel === 'speler' && <span className="faint"> →</span>}
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className="reaction-tabs">
            {data.cats.map((c) => {
              const n = owned.filter((i) => i.cat === c.id).length;
              return (
                <button
                  key={c.id}
                  className={`reaction-tab${cat === c.id && !q ? ' on' : ''}`}
                  title={`${c.label} (${n})`}
                  onClick={() => { setCat(c.id); setQ(''); }}
                >
                  {c.icon}
                </button>
              );
            })}
          </div>

          {showSearch && (
            <input
              className="reaction-search"
              placeholder="zoek een reactie…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}

          <div className="reaction-grid">
            {shown.map((i) => (
              <button key={i.id} className="reaction-chip" disabled={busy} onClick={() => pick(i)}>
                {i.text}
                {i.channel === 'speler' && <span className="faint"> →</span>}
              </button>
            ))}
            {shown.length === 0 && <p className="muted sm" style={{ gridColumn: '1 / -1' }}>Niets gevonden.</p>}
          </div>

          {/* De winkel: vergrendelde items van deze tab, buiten het raster. */}
          {!q && lockedHere.length > 0 && (
            <details className="reaction-locked">
              <summary>
                🔒 nog {lockedHere.length} in {data.cats.find((c) => c.id === cat)?.label}
                {' · '}
                <span className="faint">{lockedHere[0].lock}</span>
              </summary>
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                {/* Prijs op een EIGEN regel onder de tekst, niet ernaast. Deze
                    lijst mengt "Amai." met een zin van tien woorden; naast elkaar
                    danste de prijskolom dan per rij heen en weer en brak een lange
                    tekst over twee regels met de knop ergens in het midden. */}
                {lockedHere.map((i) => (
                  <div key={i.id} className="reaction-locked-item">
                    <span className="sm faint">{i.text}</span>
                    {i.price != null ? (
                      <button className="btn ghost sm" disabled={busy} onClick={() => buy(i)}>
                        {i.price} 🪙
                      </button>
                    ) : (
                      <span className="badge">{i.lock}</span>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          <p className="faint sm" style={{ margin: '8px 0 0' }}>
            Level {data.level} · {data.ownedCount} reacties · <span>{data.money} 🪙</span>
          </p>
        </>
      )}
    </div>
  );
}
