/** Small shared presentational helpers. */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { DailyCareProjection, Sex } from '../types';

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

/**
 * The positive per-day growth a pigeon's CURRENT care (voer, apart hok, coach)
 * is planned to give each attribute. Only gains are shown — feeding and housing
 * never hurt an attribute, so there is no "down" case. Renders nothing when the
 * selection yields no growth (e.g. no food in stock).
 */
export function DailyGains({ care }: { care: DailyCareProjection | null }) {
  if (!care) return null;
  const items = [
    { label: '⚡ Energie', v: care.deltas.form },
    { label: 'Conditie', v: care.deltas.endurance },
    { label: 'Snelheid', v: care.deltas.speed },
    { label: 'Oriëntatie', v: care.deltas.orientation },
    { label: 'Gezondheid', v: care.deltas.health },
    { label: '❤️ Libido', v: care.deltas.libido },
    { label: 'Ervaring', v: care.deltas.experience },
  ].filter((it) => it.v >= 0.05);
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="faint" style={{ fontSize: '0.74rem', marginBottom: 3 }}>📈 Groei per dag met deze keuze:</div>
      <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
        {items.map((it) => (
          <span
            key={it.label}
            className="badge"
            style={{ background: 'var(--good-soft, #e6f6ec)', color: 'var(--good, #2e9e5b)', fontSize: '0.72rem', fontWeight: 600 }}
          >
            {it.label} +{it.v.toFixed(1)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Dutch label for a flight tier (tolerates legacy 'club'/'national' values). */
export function tierLabel(type: string): string {
  switch (type) {
    case 'regional': return 'Regionaal';
    case 'national': return 'Nationaal';
    case 'international': return 'Internationaal';
    case 'club': return 'Club';
    default: return 'Nationaal';
  }
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
