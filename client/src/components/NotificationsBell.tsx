/**
 * Notification bell + dropdown inbox. Shows an unread badge (from game state)
 * and, when opened, fetches the user's notifications, renders them and marks
 * them read. Used in the top bar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useGame } from '../game/GameContext';
import type { AppNotification, NotificationsResponse } from '../types';

const ICON: Record<AppNotification['kind'], string> = {
  result: '🏁',
  improve: '📈',
  info: 'ℹ️',
  health: '🏥',
  badge: '🎖️',
};

/** Short "x min geleden" style relative time. */
function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'net';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min geleden`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} u geleden`;
  const d = Math.floor(h / 24);
  return `${d} d geleden`;
}

export function NotificationsBell() {
  const { state, refresh } = useGame();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const unread = state?.unreadNotifications ?? 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<NotificationsResponse>('/notifications');
      setItems(res.notifications);
    } catch {
      /* silent — the bell just stays empty */
    } finally {
      setLoading(false);
    }
  }, []);

  // Open the panel: load the list, then mark everything read so the badge clears.
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      await load();
      if (unread > 0) {
        try {
          const res = await api<NotificationsResponse>('/notifications/read', { method: 'POST', body: {} });
          setItems(res.notifications);
          await refresh();
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button className="bell-btn" onClick={toggle} aria-label="Meldingen" title="Meldingen">
        🔔
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel">
          <div className="bell-panel-head">Meldingen</div>
          <div className="bell-list">
            {loading && items.length === 0 && <div className="bell-empty">Laden…</div>}
            {!loading && items.length === 0 && (
              <div className="bell-empty">Nog geen meldingen. Schrijf een duif in voor een vlucht!</div>
            )}
            {items.map((n) => {
              const body = (
                <>
                  <div className="bell-item-top">
                    <span className="bell-item-ico">{ICON[n.kind]}</span>
                    <span className="bell-item-title">{n.title}</span>
                    <span className="bell-item-time">{ago(n.createdAt)}</span>
                  </div>
                  <div className="bell-item-body">{n.body}</div>
                </>
              );
              return n.flightId ? (
                <Link
                  key={n.id}
                  to={`/vluchten/${n.flightId}`}
                  className={`bell-item ${n.read ? '' : 'unread'}`}
                  onClick={() => setOpen(false)}
                >
                  {body}
                </Link>
              ) : (
                <div key={n.id} className={`bell-item ${n.read ? '' : 'unread'}`}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
