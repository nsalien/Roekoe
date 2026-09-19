/**
 * DE STEM — het ideeënbord.
 *
 * Elk seizoen komt er één nieuwe feature bij, en de spelers kiezen samen welke.
 * Eén scherm doet drie dingen: stemmen op een idee, eronder vragen stellen, en
 * zelf een idee toevoegen.
 *
 * De draad onder een idee wordt **pas opgehaald als je ze openklapt**. Dat is
 * geen luxe: reacties zijn de enige rijen hier die onbeperkt groeien, en het
 * bord zelf moet op één query per telling blijven (zie loadStemBoard in
 * core/d1.ts — gelezen rijen zijn het schaarse goed).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Spinner, useToast } from '../components/ui';
import type {
  StemBoard, StemComment, StemIdea, StemStatus, StemThread, StemVoterReport,
} from '../types';

const STATUS_STYLE: Record<StemStatus, { bg: string; color: string }> = {
  open: { bg: 'var(--brand-soft)', color: 'var(--brand-ink)' },
  gepland: { bg: 'var(--gold-soft)', color: 'var(--gold)' },
  uitgevoerd: { bg: 'var(--good-soft)', color: 'var(--good)' },
  afgewezen: { bg: 'var(--surface-2)', color: 'var(--text-soft)' },
};

/** "vandaag", "gisteren", anders een korte datum — precisie helpt hier niets. */
function dayLabel(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return '';
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return 'vandaag';
  if (days === 1) return 'gisteren';
  if (days < 7) return `${days} dagen geleden`;
  return new Date(d).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
}

export function StemPage() {
  const toast = useToast();
  const [board, setBoard] = useState<StemBoard | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setBoard(await api<StemBoard>('/stem'));
  }, []);
  useEffect(() => {
    load().catch((e) => toast.show(e instanceof Error ? e.message : 'Laden mislukt', 'err'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /**
   * Stemmen werkt optimistisch: de knop springt meteen om en de server stuurt de
   * echte stand terug. Zonder dat voelt een stem als een klik die niets doet —
   * de rondrit duurt op gsm makkelijk een halve seconde.
   */
  async function vote(idea: StemIdea) {
    if (!board) return;
    const before = board.ideas;
    setBoard({
      ...board,
      ideas: board.ideas.map((i) =>
        i.id === idea.id ? { ...i, voted: !i.voted, votes: i.votes + (i.voted ? -1 : 1) } : i,
      ),
    });
    try {
      const res = await api<{ voted: boolean; votes: number }>(`/stem/ideas/${idea.id}/vote`, { method: 'POST' });
      setBoard((b) =>
        b ? { ...b, ideas: b.ideas.map((i) => (i.id === idea.id ? { ...i, voted: res.voted, votes: res.votes } : i)) } : b,
      );
    } catch (e) {
      setBoard((b) => (b ? { ...b, ideas: before } : b));
      toast.show(e instanceof Error ? e.message : 'Stemmen mislukt', 'err');
    }
  }

  async function addIdea(title: string, body: string) {
    setBusy(true);
    try {
      const res = await api<{ ideas: StemIdea[] }>('/stem/ideas', { method: 'POST', body: { title, body } });
      setBoard((b) => (b ? { ...b, ideas: res.ideas } : b));
      setAdding(false);
      toast.show('Je idee staat op het bord 🗳️', 'ok');
      return true;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(idea: StemIdea, status: StemStatus) {
    try {
      const res = await api<{ ideas: StemIdea[] }>(`/admin/stem/ideas/${idea.id}/status`, {
        method: 'POST',
        body: { status },
      });
      setBoard((b) => (b ? { ...b, ideas: res.ideas } : b));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    }
  }

  if (!board) return <Spinner />;

  const open = board.ideas.filter((i) => i.status === 'open');

  return (
    <div>
      <div className="page-head" data-tour="stem">
        <div>
          <h1>🗳️ De Stem</h1>
          <p className="muted" style={{ marginBottom: 4 }}>
            Elk seizoen komt er één nieuwe feature bij. Stem op wat jij wil zien, stel je vragen eronder,
            of zet er je eigen idee bij.
          </p>
          <p className="faint" style={{ margin: 0, fontSize: '0.82rem' }}>
            <Link to="/wiki#stem">Hoe De Stem werkt →</Link>
          </p>
        </div>
        <button className="btn accent" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Sluiten' : '➕ Nieuw idee'}
        </button>
      </div>

      {adding && <IdeaForm limits={board.limits} busy={busy} onSubmit={addIdea} />}

      {board.isAdmin && <VotersPanel />}

      {open.length === 0 && (
        <div className="card muted">
          Er staat momenteel niets in stemming. Dien gerust het eerste idee in 🕊️
        </div>
      )}

      <div className="stack" style={{ gap: 14 }}>
        {board.ideas.map((idea) => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            statusLabels={board.statusLabels}
            isAdmin={board.isAdmin}
            commentMax={board.limits.commentMax}
            onVote={() => vote(idea)}
            onStatus={(s) => setStatus(idea, s)}
          />
        ))}
      </div>
    </div>
  );
}

function IdeaForm({
  limits, busy, onSubmit,
}: {
  limits: StemBoard['limits'];
  busy: boolean;
  onSubmit: (title: string, body: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  async function submit() {
    if (await onSubmit(title.trim(), body.trim())) {
      setTitle('');
      setBody('');
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
      <div className="field">
        <label htmlFor="stem-title">Titel</label>
        <input
          id="stem-title"
          value={title}
          maxLength={limits.titleMax}
          placeholder="Bv. Duiven kunnen een naamplaatje krijgen"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="stem-body">Leg het even uit</label>
        <textarea
          id="stem-body"
          value={body}
          rows={5}
          maxLength={limits.bodyMax}
          placeholder="Wat verandert er, voor wie, en waarom maakt het het spel leuker?"
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="faint" style={{ fontSize: '0.78rem', marginTop: 4 }}>
          {body.trim().length}/{limits.bodyMax} tekens · minstens {limits.bodyMin} ·
          {' '}max. {limits.maxIdeasPerDay} ideeën per dag
        </div>
      </div>
      <button className="btn accent" disabled={busy} onClick={submit}>
        {busy ? 'Bezig…' : 'Op het bord zetten'}
      </button>
    </div>
  );
}

function IdeaCard({
  idea, statusLabels, isAdmin, commentMax, onVote, onStatus,
}: {
  idea: StemIdea;
  statusLabels: Record<StemStatus, string>;
  isAdmin: boolean;
  commentMax: number;
  onVote: () => void;
  onStatus: (s: StemStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<StemThread | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const closed = idea.status === 'afgewezen' || idea.status === 'uitgevoerd';

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !thread) {
      try {
        setThread(await api<StemThread>(`/stem/ideas/${idea.id}`));
      } catch (e) {
        toast.show(e instanceof Error ? e.message : 'Laden mislukt', 'err');
        setOpen(false);
      }
    }
  }

  async function send() {
    setBusy(true);
    try {
      const res = await api<StemThread>(`/stem/ideas/${idea.id}/comments`, { method: 'POST', body: { body: text } });
      setThread(res);
      setText('');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Mislukt', 'err');
    } finally {
      setBusy(false);
    }
  }

  const style = STATUS_STYLE[idea.status];
  // Het aantal reacties komt van het bord; zodra de draad open is, is die verser.
  const commentCount = thread ? thread.comments.length : idea.comments;

  return (
    <div className="card" style={{ opacity: idea.status === 'afgewezen' ? 0.7 : 1 }}>
      <div className="row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        {/* De stemknop staat links en is het grootste element van de kaart —
            stemmen is waarvoor je hier bent. */}
        <button
          className={idea.voted ? 'btn' : 'btn secondary'}
          disabled={closed}
          onClick={onVote}
          title={
            closed
              ? 'Op dit idee kan niet meer gestemd worden'
              : idea.voted ? 'Je stem intrekken' : 'Stem op dit idee'
          }
          style={{
            flexShrink: 0, width: 62, padding: '8px 0', display: 'flex',
            flexDirection: 'column', gap: 0, lineHeight: 1.15,
          }}
        >
          <span style={{ fontSize: '1rem' }}>{idea.voted ? '✅' : '👍'}</span>
          <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>{idea.votes}</span>
        </button>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
            <strong style={{ fontSize: '1.02rem' }}>{idea.title}</strong>
            <span className="badge" style={{ background: style.bg, color: style.color }}>
              {statusLabels[idea.status]}
            </span>
          </div>
          <div className="faint" style={{ fontSize: '0.78rem', marginTop: 2 }}>
            {idea.authorName} · {dayLabel(idea.createdAt)}
            {idea.mine && ' · jouw idee'}
          </div>
          <p className="muted" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', fontSize: '0.92rem' }}>
            {idea.body}
          </p>

          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="btn ghost sm" onClick={toggle}>
              💬 {commentCount} {commentCount === 1 ? 'reactie' : 'reacties'} {open ? '▲' : '▼'}
            </button>
            {isAdmin && (
              <select
                value={idea.status}
                onChange={(e) => onStatus(e.target.value as StemStatus)}
                style={{ width: 'auto', fontSize: '0.83rem', padding: '5px 8px' }}
              >
                {(Object.keys(statusLabels) as StemStatus[]).map((s) => (
                  <option key={s} value={s}>{statusLabels[s]}</option>
                ))}
              </select>
            )}
          </div>

          {open && (
            <div className="stack" style={{ gap: 10, marginTop: 12 }}>
              {!thread && <Spinner />}
              {thread?.comments.map((cm) => <CommentRow key={cm.id} comment={cm} />)}
              {thread && thread.comments.length === 0 && (
                <div className="faint" style={{ fontSize: '0.85rem' }}>
                  Nog geen reacties. Stel gerust de eerste vraag.
                </div>
              )}
              {thread && (
                <div>
                  <textarea
                    rows={2}
                    value={text}
                    maxLength={commentMax}
                    placeholder="Een vraag of opmerking bij dit idee…"
                    onChange={(e) => setText(e.target.value)}
                  />
                  <button
                    className="btn sm"
                    style={{ marginTop: 6 }}
                    disabled={busy || text.trim().length === 0}
                    onClick={send}
                  >
                    {busy ? 'Bezig…' : 'Plaatsen'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CommentRow({ comment }: { comment: StemComment }) {
  return (
    <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10 }}>
      <div className="faint" style={{ fontSize: '0.76rem' }}>
        <strong style={{ color: 'var(--text-soft)' }}>{comment.authorName}</strong> · {dayLabel(comment.createdAt)}
      </div>
      <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{comment.body}</div>
    </div>
  );
}

/**
 * Beheerdersweergave: wie stemde op wat.
 *
 * Staat achter een knop en niet standaard open — het is de enige plek die één
 * rij per stem leest in plaats van één per idee, en de spelers zelf zien hier
 * niets van (de server weigert de route voor iedereen behalve de beheerder).
 *
 * Twee kanten van dezelfde data, want de beheerder heeft ze allebei nodig: "wie
 * steunt dit idee" (per idee) en "wie heeft er al iets gedaan" (per speler —
 * inclusief wie nog niets stemde).
 */
function VotersPanel() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<StemVoterReport | null>(null);
  const [tab, setTab] = useState<'idee' | 'speler'>('idee');

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !report) {
      try {
        setReport(await api<StemVoterReport>('/admin/stem/voters'));
      } catch (e) {
        toast.show(e instanceof Error ? e.message : 'Laden mislukt', 'err');
        setOpen(false);
      }
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div>
          <strong>🛠️ Wie stemde op wat</strong>
          <div className="faint" style={{ fontSize: '0.78rem' }}>Enkel jij ziet dit blok.</div>
        </div>
        <button className="btn ghost sm" onClick={toggle}>{open ? 'Verbergen ▲' : 'Tonen ▼'}</button>
      </div>

      {open && !report && <Spinner />}
      {open && report && (
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <div className="pill-tabs">
              <button className={tab === 'idee' ? 'active' : ''} onClick={() => setTab('idee')}>Per idee</button>
              <button className={tab === 'speler' ? 'active' : ''} onClick={() => setTab('speler')}>Per speler</button>
            </div>
            <span className="faint" style={{ fontSize: '0.8rem' }}>
              {report.voted} van de {report.players} spelers stemden
            </span>
          </div>

          {tab === 'idee' && (
            <div className="stack" style={{ gap: 10, marginTop: 12 }}>
              {report.perIdea.map((row) => (
                <div key={row.ideaId}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                    {row.title} <span className="faint">· {row.voters.length}</span>
                  </div>
                  <div className="faint" style={{ fontSize: '0.84rem' }}>
                    {row.voters.length === 0
                      ? 'nog niemand'
                      : row.voters.map((v) => v.name).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'speler' && (
            <div className="stack" style={{ gap: 10, marginTop: 12 }}>
              {report.perPlayer.map((p) => (
                <div key={p.userId}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                    {p.name} <span className="faint">· {p.ideas.length}</span>
                  </div>
                  <div className="faint" style={{ fontSize: '0.84rem' }}>
                    {p.ideas.length === 0
                      ? 'stemde nog niet'
                      : p.ideas.map((i) => i.title).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
