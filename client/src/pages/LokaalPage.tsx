/**
 * HET LOKAAL — de vrije chat van alle spelers.
 *
 * Eén scherm, zoals een berichtenapp: bovenaan de oudste berichten, onderaan de
 * nieuwste en het tekstvak. Je eigen berichten staan rechts, die van de anderen
 * links met de hoknaam erboven.
 *
 * Kosten (zie §8 in context.md): de pagina pollt elke `pollSeconds` zolang ze
 * zichtbaar is, en elke poll vraagt enkel wat er sinds de vorige veranderde
 * (`?since=`). De server beantwoordt dat zonder de wereld te laden, dus een
 * open chat kost zo goed als geen leesbudget. Een verborgen tabblad pollt niet.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useGame } from '../game/GameContext';
import { useVisiblePoll } from '../game/useVisiblePoll';
import { markLokaalSeen } from '../game/lokaalSeen';
import { gifSrc } from '../game/gif';
import { Spinner, useToast } from '../components/ui';
import type { LokaalMessage, LokaalResponse } from '../types';

const TZ = 'Europe/Brussels';
/** Opeenvolgende berichten van dezelfde speler binnen dit venster delen één naam. */
const GROUP_MS = 5 * 60 * 1000;
/** Binnen zoveel pixels van de bodem telt als "je leest mee" → automatisch meescrollen. */
const NEAR_BOTTOM_PX = 90;

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-BE', { timeZone: TZ });
}

function dayLabel(iso: string, nowMs: number): string {
  const k = dayKey(iso);
  if (k === dayKey(new Date(nowMs).toISOString())) return 'Vandaag';
  if (k === dayKey(new Date(nowMs - 86400000).toISOString())) return 'Gisteren';
  const long = new Date(iso).toLocaleDateString('nl-BE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
  return long.charAt(0).toUpperCase() + long.slice(1);
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-BE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

/** Chronologisch, ontdubbeld op id (een poll kijkt bewust wat terug in de tijd). */
function merge(list: LokaalMessage[], extra: LokaalMessage[], deleted: string[] = []): LokaalMessage[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of extra) byId.set(m.id, m);
  for (const id of deleted) byId.delete(id);
  return [...byId.values()]
    .filter((m) => !m.deletedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Telefoon/tablet: daar is Enter een nieuwe regel en verstuur je met de knop. */
const coarsePointer = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export function LokaalPage() {
  const { user } = useAuth();
  const { state } = useGame();
  const toast = useToast();

  const [messages, setMessages] = useState<LokaalMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [limits, setLimits] = useState({ bodyMax: 500, pollSeconds: 15 });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gifOpen, setGifOpen] = useState(false);

  const cursor = useRef<string | null>(null);
  const polling = useRef(false);
  /** De lijst zoals ze nu op het scherm staat, voor de poll (die buiten de render loopt). */
  const listRef = useRef<LokaalMessage[] | null>(null);
  listRef.current = messages;
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Wat er na de volgende render met de scrollpositie moet gebeuren. */
  const scrollIntent = useRef<{ kind: 'bottom' } | { kind: 'keep'; fromBottom: number } | null>(null);

  const me = user?.id ?? '';
  const isAdmin = !!state?.isAdmin;
  // Namen waarop een bericht "aan jou" leest: je hoknaam en je login.
  const myNames = useMemo(
    () => [state?.loft?.name, user?.username].filter((n): n is string => !!n && n.trim().length >= 3).map((n) => n.toLowerCase()),
    [state?.loft?.name, user?.username],
  );

  const nearBottom = () => {
    const el = feedRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  // --- Laden -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    api<LokaalResponse>('/lokaal')
      .then((res) => {
        if (cancelled) return;
        cursor.current = res.now;
        markLokaalSeen(me, res.now);
        if (res.limits) setLimits(res.limits);
        setHasMore(!!res.hasMore);
        scrollIntent.current = { kind: 'bottom' };
        setMessages(merge([], res.messages));
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : 'Laden mislukt'));
    return () => { cancelled = true; };
  }, [me]);

  const poll = useCallback(async () => {
    if (!cursor.current || polling.current) return;
    polling.current = true;
    try {
      const res = await api<LokaalResponse>(`/lokaal?since=${encodeURIComponent(cursor.current)}`);
      cursor.current = res.now;
      markLokaalSeen(me, res.now);
      const deleted = res.deleted ?? [];
      if (res.messages.length === 0 && deleted.length === 0) return;
      // Een poll kijkt bewust wat terug in de tijd, dus tel enkel wat écht nieuw is.
      const known = new Set((listRef.current ?? []).map((m) => m.id));
      const freshFromOthers = res.messages.filter((m) => !known.has(m.id) && m.userId !== me).length;
      if (nearBottom()) scrollIntent.current = { kind: 'bottom' };
      else if (freshFromOthers > 0) setUnreadBelow((n) => n + freshFromOthers);
      setMessages((prev) => merge(prev ?? [], res.messages, deleted));
    } catch {
      // Een gemiste poll is geen ramp: de volgende kijkt vanaf dezelfde cursor.
    } finally {
      polling.current = false;
    }
  }, [me]);

  useVisiblePoll(poll, limits.pollSeconds * 1000, messages !== null);

  // Scrollpositie na elke wijziging van de lijst: naar onder, of op dezelfde
  // plek blijven als er bovenaan oudere berichten bijkwamen.
  useLayoutEffect(() => {
    const el = feedRef.current;
    const intent = scrollIntent.current;
    if (!el || !intent) return;
    scrollIntent.current = null;
    if (intent.kind === 'bottom') el.scrollTop = el.scrollHeight;
    else el.scrollTop = el.scrollHeight - intent.fromBottom;
  }, [messages]);

  async function loadOlder() {
    if (!messages || messages.length === 0) return;
    const el = feedRef.current;
    setLoadingOlder(true);
    try {
      const res = await api<LokaalResponse>(`/lokaal?before=${encodeURIComponent(messages[0].createdAt)}`);
      if (el) scrollIntent.current = { kind: 'keep', fromBottom: el.scrollHeight - el.scrollTop };
      setHasMore(!!res.hasMore);
      setMessages((prev) => merge(prev ?? [], res.messages));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Laden mislukt', 'err');
    } finally {
      setLoadingOlder(false);
    }
  }

  // --- Schrijven ---------------------------------------------------------
  /** `gif` = send this GIF link instead of what is in the text box. */
  async function send(e?: FormEvent, gif?: string) {
    e?.preventDefault();
    const body = (gif ?? text).trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await api<{ message: LokaalMessage }>('/lokaal', { method: 'POST', body: { body } });
      if (gif) setGifOpen(false);
      else setText('');
      scrollIntent.current = { kind: 'bottom' };
      setUnreadBelow(0);
      setMessages((prev) => merge(prev ?? [], [res.message]));
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Versturen mislukt', 'err');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !coarsePointer && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  // Het tekstvak groeit mee met wat je typt, tot een handvol regels.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  async function remove(msg: LokaalMessage) {
    if (!window.confirm('Dit bericht weghalen? Dat kan je niet ongedaan maken.')) return;
    try {
      await api(`/lokaal/${msg.id}/delete`, { method: 'POST' });
      setSelected(null);
      setMessages((prev) => merge(prev ?? [], [], [msg.id]));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Weghalen mislukt', 'err');
    }
  }

  function jumpDown() {
    const el = feedRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setUnreadBelow(0);
  }

  // --- Weergave ------------------------------------------------------------
  if (loadError) {
    return (
      <div className="card" style={{ borderColor: 'var(--bad)' }}>
        Het Lokaal kon niet geladen worden: {loadError}
      </div>
    );
  }

  const nowMs = Date.now();
  const left = limits.bodyMax - text.trim().length;

  return (
    <div className="lokaal" data-tour="lokaal">
      <div className="page-head">
        <div>
          <h1>🍻 Het Lokaal</h1>
          <p className="muted" style={{ margin: 0 }}>
            Het café van de duivenmelkers — hier praat je vrij met alle spelers.{' '}
            <Link to="/wiki#lokaal" className="faint">Meer info →</Link>
          </p>
        </div>
      </div>

      <div className="card lokaal-card">
        <div
          className="lokaal-feed"
          ref={feedRef}
          onScroll={() => { if (unreadBelow > 0 && nearBottom()) setUnreadBelow(0); }}
        >
          {messages === null && <Spinner />}

          {messages !== null && hasMore && (
            <div className="lokaal-older">
              <button className="btn ghost sm" onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? 'Bezig…' : '⬆ Oudere berichten'}
              </button>
            </div>
          )}

          {messages !== null && messages.length === 0 && (
            <div className="lokaal-empty">
              <div style={{ fontSize: '2.2rem' }}>🍺</div>
              <strong>Nog stil in het lokaal…</strong>
              <div className="faint">Trap de babbel af — iedereen leest mee.</div>
            </div>
          )}

          {messages?.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            const sameRun =
              !newDay && prev.userId === m.userId && prev.authorName === m.authorName &&
              Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_MS;
            const mine = !!m.userId && m.userId === me;
            const lower = m.body.toLowerCase();
            const atMe = !mine && myNames.some((n) => lower.includes(n));
            const deletable = isAdmin || mine;
            const isSel = selected === m.id;
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="lokaal-day"><span>{dayLabel(m.createdAt, nowMs)}</span></div>
                )}
                <div className={`lokaal-msg${mine ? ' mine' : ''}${sameRun ? ' cont' : ''}`}>
                  {!mine && !sameRun && <div className="lokaal-who">{m.authorName}</div>}
                  <div
                    className={`lokaal-bubble${atMe ? ' at-me' : ''}${deletable ? ' tappable' : ''}`}
                    onClick={deletable ? () => setSelected(isSel ? null : m.id) : undefined}
                    title={deletable ? 'Tik voor opties' : undefined}
                  >
                    {gifSrc(m.body) ? (
                      <img className="lokaal-gif" src={gifSrc(m.body)!} alt="GIF" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="lokaal-text">{m.body}</span>
                    )}
                    <span className="lokaal-time">{clock(m.createdAt)}</span>
                  </div>
                  {isSel && (
                    <div className="lokaal-actions">
                      <button className="btn ghost sm" onClick={() => remove(m)}>🗑️ Weghalen</button>
                      <button className="btn ghost sm" onClick={() => setSelected(null)}>Annuleren</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {unreadBelow > 0 && (
          <button className="lokaal-jump" onClick={jumpDown}>
            ↓ {unreadBelow} {unreadBelow === 1 ? 'nieuw bericht' : 'nieuwe berichten'}
          </button>
        )}

        {gifOpen && <GifPicker disabled={sending} onPick={(url) => void send(undefined, url)} onClose={() => setGifOpen(false)} />}
        <form className="lokaal-compose" onSubmit={send}>
          <button
            type="button"
            className={`btn ghost lokaal-gifbtn${gifOpen ? ' active' : ''}`}
            onClick={() => setGifOpen((o) => !o)}
            aria-label="GIF sturen"
            title="GIF sturen"
          >
            GIF
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={limits.bodyMax}
            placeholder="Schrijf een bericht…"
            enterKeyHint={coarsePointer ? 'enter' : 'send'}
            aria-label="Bericht"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="btn" type="submit" disabled={sending || text.trim().length === 0} aria-label="Versturen">
            {sending ? '…' : 'Verstuur'}
          </button>
        </form>
        {left < 60 && (
          <div className="faint lokaal-count">{left} tekens over</div>
        )}
      </div>
    </div>
  );
}

interface GifHit { url: string; preview: string | null; title: string }

/**
 * Het GIF-venster boven het tekstvak. Zoekt via de server (Giphy, met de sleutel
 * van de beheerder); zonder sleutel blijft enkel de uitleg over: plak een link
 * van giphy.com of tenor.com in het tekstvak, dat wordt vanzelf een GIF. Leeg
 * zoekveld = wat nu populair is.
 */
function GifPicker({ onPick, onClose, disabled }: { onPick: (url: string) => void; onClose: () => void; disabled: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<GifHit[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Wacht tot er even niet meer getypt wordt: één zoekopdracht per pauze.
    const t = setTimeout(async () => {
      try {
        const res = await api<{ enabled: boolean; gifs: GifHit[]; error?: string }>(`/lokaal/gifs?q=${encodeURIComponent(q.trim())}`);
        if (cancelled) return;
        setEnabled(res.enabled);
        setHits(res.gifs);
        setError(res.error ?? null);
      } catch {
        if (!cancelled) setError('Zoeken lukte niet');
      }
    }, q ? 400 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  return (
    <div className="lokaal-gifpanel">
      <div className="row" style={{ gap: 6 }}>
        {enabled && (
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Zoek een GIF…"
            aria-label="Zoek een GIF"
            style={{ flex: 1, minWidth: 0 }}
          />
        )}
        <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Sluiten">✕</button>
      </div>
      {!enabled ? (
        <p className="faint" style={{ margin: '6px 0 0', fontSize: '0.85rem' }}>
          Plak een link van <strong>giphy.com</strong> of <strong>tenor.com</strong> in het tekstvak en verstuur — die
          verschijnt als GIF.
        </p>
      ) : (
        <>
          {error && <p className="faint" style={{ margin: '6px 0 0' }}>{error}</p>}
          {hits === null ? (
            <Spinner />
          ) : hits.length === 0 ? (
            <p className="faint" style={{ margin: '6px 0 0' }}>Niets gevonden.</p>
          ) : (
            <div className="lokaal-gifgrid">
              {hits.map((g) => (
                <button key={g.url} type="button" disabled={disabled} onClick={() => onPick(g.url)} title={g.title || 'GIF'}>
                  <img src={g.preview ?? g.url} alt={g.title || 'GIF'} loading="lazy" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          )}
          <div className="faint" style={{ fontSize: '0.7rem', marginTop: 4, textAlign: 'right' }}>via GIPHY</div>
        </>
      )}
    </div>
  );
}
