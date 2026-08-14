/** Small shared presentational helpers. */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Pigeon, Sex } from '../types';

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

/** Fill colour for a "threshold" stat: green > 70, orange 30–70, red < 30. */
function thresholdColor(value: number): string {
  if (value > 70) return 'var(--good)';
  if (value >= 30) return 'var(--warn)';
  return 'var(--bad)';
}

export function StatBar({
  label,
  value,
  max = 100,
  variant,
  perDay,
  threshold,
  cap,
}: {
  label: string;
  value: number;
  max?: number;
  variant?: 'form' | 'health';
  /** Planned change per day from the pigeon's current care. Positive shows a
   *  green ▲, negative (hunger) a red ▼. Undefined/≈0 shows nothing. */
  perDay?: number;
  /** Colour the bar by value: green > 70, orange 30–70, red < 30 (used for
   *  Energie and Gezondheid, where the level is a health signal). */
  threshold?: boolean;
  /** Genetic ceiling for this skill: draws a clickable red marker on the bar
   *  showing where the bird will cap. Click it to reveal the exact value. */
  cap?: number | null;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const d = perDay ?? 0;
  const show = Math.abs(d) >= 0.05;
  const up = d > 0;
  const [showCap, setShowCap] = useState(false);
  const hasCap = typeof cap === 'number' && cap > 0 && cap < max;
  const capPct = hasCap ? Math.max(0, Math.min(100, (cap! / max) * 100)) : 0;
  return (
    <div className="stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span style={{ display: 'inline-flex', gap: 5, alignItems: 'baseline' }}>
          {show && (
            <span
              title="Verwachte verandering per dag met de huidige verzorging"
              style={{ fontSize: '0.68rem', fontWeight: 700, color: up ? 'var(--good, #2e9e5b)' : 'var(--bad)' }}
            >
              {up ? '▲' : '▼'}{up ? '+' : ''}{d.toFixed(1)}
            </span>
          )}
          <span className="stat-val">{Math.round(value)}</span>
        </span>
      </div>
      {hasCap ? (
        // The cap marker + readout live OUTSIDE `.bar` (which has overflow:hidden
        // and colours its `> span` children as the fill) so the red line stays a
        // thin line and the popped-up value isn't clipped.
        <div style={{ position: 'relative' }}>
          <div className={`bar ${threshold ? '' : (variant ?? '')}`}>
            <span style={{ width: `${pct}%`, ...(threshold ? { background: thresholdColor(value) } : {}) }} />
          </div>
          <button
            type="button"
            aria-label={`Genetisch maximum: ${cap} — klik voor de waarde`}
            title="Genetisch maximum — klik voor de waarde"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowCap((s) => !s); }}
            style={{
              position: 'absolute', top: '50%', left: `${capPct}%`,
              transform: 'translate(-50%, -50%)', width: 3, height: 14, padding: 0,
              border: 'none', background: 'var(--bad)', borderRadius: 1,
              cursor: 'pointer', zIndex: 2,
            }}
          />
          {showCap && (
            <span
              style={{
                position: 'absolute', bottom: 'calc(100% + 5px)', left: `${capPct}%`,
                transform: 'translateX(-50%)', background: 'var(--bad)', color: '#fff',
                fontSize: '0.72rem', fontWeight: 700, lineHeight: 1.3, padding: '2px 7px',
                borderRadius: 5, whiteSpace: 'nowrap', zIndex: 5,
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              }}
            >
              cap {cap}
            </span>
          )}
        </div>
      ) : (
        <div className={`bar ${threshold ? '' : (variant ?? '')}`}>
          <span style={{ width: `${pct}%`, ...(threshold ? { background: thresholdColor(value) } : {}) }} />
        </div>
      )}
    </div>
  );
}

/**
 * The full attribute panel for a pigeon, in ONE consistent layout used
 * everywhere a bird's stats are shown: Energie full-width on top (threshold
 * colour), then Gezondheid + Libido, Snelheid + Conditie, Oriëntatie + Ervaring
 * in pairs. `showPerDay` adds the ▲/▼ per-day care hints (loft overview only).
 */
export function PigeonStats({ pigeon, showPerDay }: { pigeon: Pigeon; showPerDay?: boolean }) {
  const dc = showPerDay ? pigeon.dailyCare?.deltas : undefined;
  return (
    <div className="stat-stack">
      <StatBar label="⚡ Energie" value={pigeon.form ?? 0} threshold perDay={dc?.form} />
      <div className="stat-pair">
        <StatBar label="Gezondheid" value={pigeon.health ?? 0} threshold perDay={dc?.health} />
        <StatBar label="Libido" value={pigeon.libido ?? 0} perDay={dc?.libido} />
      </div>
      <div className="stat-pair">
        <StatBar label="Snelheid" value={pigeon.speed ?? 0} perDay={dc?.speed} cap={pigeon.genes?.speed} />
        <StatBar label="Conditie" value={pigeon.endurance ?? 0} perDay={dc?.endurance} cap={pigeon.genes?.endurance} />
      </div>
      <div className="stat-pair">
        <StatBar label="Oriëntatie" value={pigeon.orientation ?? 0} perDay={dc?.orientation} cap={pigeon.genes?.orientation} />
        <StatBar label="Ervaring" value={pigeon.experience ?? 0} perDay={dc?.experience} />
      </div>
    </div>
  );
}

/** The bird's breed (ras) as a coloured chip — rarer breeds pop more. Public
 *  information, so it shows even for a bird whose attributes are withheld. */
export function BreedBadge({ breed }: { breed: Pigeon['breed'] }) {
  const style: Record<string, { bg: string; fg: string }> = {
    legendarisch: { bg: 'var(--gold-soft)', fg: 'var(--gold)' },
    zeldzaam: { bg: 'rgba(168,85,247,0.16)', fg: '#a855f7' },
    ongewoon: { bg: 'var(--brand-soft)', fg: 'var(--brand-ink)' },
    algemeen: { bg: 'var(--surface-2)', fg: 'var(--ink-soft, inherit)' },
    gemengd: { bg: 'var(--surface-2)', fg: 'var(--ink-soft, inherit)' },
  };
  const s = style[breed.rarity] ?? style.algemeen;
  return (
    <span className="badge" style={{ background: s.bg, color: s.fg }} title={`Ras: ${breed.name} · ${breed.rarityLabel}`}>
      🕊️ {breed.name} · {breed.rarityLabel}
    </span>
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

/** Short "nog X dagen/uur" until an ISO instant (or "binnenkort" once passed). */
export function timeUntil(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'binnenkort';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days >= 1) return `nog ${days} dag${days === 1 ? '' : 'en'}`;
  if (hours >= 1) return `nog ${hours} uur`;
  return 'nog minder dan een uur';
}

/**
 * The next play-week boundary. A season is 4 play-weeks of 7 real days each; the
 * current week runs from `seasonStartedAt + (seasonWeek-1)·7d` to `+ seasonWeek·7d`
 * (mirrors season.ts: `seasonWeek = floor((now-start)/WEEK_MS)+1`). At week 4 the
 * next boundary is the season rollover (a brand-new season, week 1).
 */
export function nextPlayWeek(seasonStartedAt: string, seasonWeek: number, seasonWeeks = 4) {
  const WEEK_MS = 7 * 86400000;
  const at = new Date(Date.parse(seasonStartedAt) + seasonWeek * WEEK_MS).toISOString();
  const isNewSeason = seasonWeek >= seasonWeeks;
  const weekNum = isNewSeason ? 1 : seasonWeek + 1;
  return { at, weekNum, isNewSeason };
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
