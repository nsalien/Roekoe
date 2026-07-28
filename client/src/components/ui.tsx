/** Small shared presentational helpers. */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Sex } from '../types';

export function Money({ value }: { value: number }) {
  return (
    <span className="money">
      <span className="coin">◎</span> {value.toLocaleString('nl-NL')}
    </span>
  );
}

export function SexBadge({ sex }: { sex: Sex }) {
  return (
    <span className={`badge sex-${sex}`}>{sex === 'doffer' ? '♂ doffer' : '♀ duivin'}</span>
  );
}

export function Spinner() {
  return <div className="spinner" aria-label="Laden" />;
}

export function StatBar({
  label,
  value,
  max = 100,
  variant,
}: {
  label: string;
  value: number;
  max?: number;
  variant?: 'form' | 'health';
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-val">{Math.round(value)}</span>
      </div>
      <div className={`bar ${variant ?? ''}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Format seconds as h:mm:ss for flight times. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}u ${m.toString().padStart(2, '0')}m`
    : `${m}m ${s.toString().padStart(2, '0')}s`;
}

const TZ = 'Europe/Brussels';

/** A friendly local date+time for a flight, e.g. "vandaag 17:00" or "wo 30 jul 11:00". */
export function formatFlightTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('nl-BE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const dayKey = (x: Date) => x.toLocaleDateString('nl-BE', { timeZone: TZ });
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getTime() + 86400000));
  const yday = dayKey(new Date(now.getTime() - 86400000));
  const dk = dayKey(d);
  let label: string;
  if (dk === today) label = 'vandaag';
  else if (dk === tomorrow) label = 'morgen';
  else if (dk === yday) label = 'gisteren';
  else label = d.toLocaleDateString('nl-BE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  return `${label} ${time}`;
}

/** Countdown text until an ISO timestamp, e.g. "over 1u 23m" or "gestart". */
export function countdownTo(iso: string, nowMs: number = Date.now()): string {
  const diff = Date.parse(iso) - nowMs;
  if (diff <= 0) return 'gestart';
  const s = Math.floor(diff / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `over ${h}u ${m}m`;
  if (m > 0) return `over ${m}m ${sec}s`;
  return `over ${sec}s`;
}

/* --- Toast system --------------------------------------------------------- */
interface ToastValue {
  show: (message: string, kind?: 'ok' | 'err') => void;
}
const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: 'ok' | 'err' } | null>(null);

  const show = useCallback((message: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 2600);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.message}</div>}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast buiten ToastProvider');
  return ctx;
}
