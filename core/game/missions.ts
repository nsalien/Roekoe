/**
 * Daily missions + login streak. Each day a player gets three small tasks that
 * reward money + XP, and keeping a daily streak gives a growing bonus. Progress
 * is bumped from the same events that drive badges.
 */

import type { Database, DailyMission, Loft } from '../schema.js';
import { newId } from '../store.js';
import { grantXp } from './badges.js';
import { makeEvent } from './events.js';
import { hashString, seededRng } from './util.js';

const TZ = 'Europe/Brussels';
function dayKey(ms: number): string {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return dtf.format(new Date(ms)); // yyyy-mm-dd
}

export type MissionEvent =
  | 'enter' | 'win' | 'podium' | 'buyfood' | 'market' | 'train' | 'care'
  | 'bet' | 'brood' | 'apart';

interface Template {
  key: string;
  event: MissionEvent;
  label: string;
  target: number;
  money: number;
  xp: number;
}

const TEMPLATES: Template[] = [
  { key: 'enter', event: 'enter', label: 'Schrijf 2 duiven in voor een vlucht', target: 2, money: 60, xp: 15 },
  { key: 'win', event: 'win', label: 'Win een vlucht', target: 1, money: 120, xp: 30 },
  { key: 'podium', event: 'podium', label: 'Behaal een podiumplaats', target: 1, money: 60, xp: 15 },
  { key: 'buyfood', event: 'buyfood', label: 'Koop voer bij', target: 1, money: 30, xp: 10 },
  { key: 'market', event: 'market', label: 'Koop of verkoop een duif op de markt', target: 1, money: 50, xp: 15 },
  { key: 'train', event: 'train', label: 'Train een duif', target: 1, money: 40, xp: 10 },
  { key: 'care', event: 'care', label: 'Zet een duif in de ziekenboeg', target: 1, money: 40, xp: 15 },
  { key: 'bet', event: 'bet', label: 'Plaats een weddenschap op een vlucht', target: 1, money: 40, xp: 10 },
  { key: 'brood', event: 'brood', label: 'Start een kweekkoppel', target: 1, money: 50, xp: 15 },
  { key: 'apart', event: 'apart', label: 'Zet een duif in een apart hok', target: 1, money: 30, xp: 10 },
];
const TEMPLATE_MAP = new Map(TEMPLATES.map((t) => [t.key, t]));

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Refresh a single loft's missions if the day has rolled over. Also updates the
 * streak and, now and then, hands out a dilemma. Returns true if anything
 * changed (so the caller can persist).
 */
export function refreshDailyMissions(db: Database, loft: Loft, nowMs: number): boolean {
  if (loft.isBot) return false;
  const today = dayKey(nowMs);
  if (loft.missionsDay === today) return false;

  const yesterday = dayKey(nowMs - 86400000);
  loft.streak = loft.missionsDay === yesterday ? (loft.streak ?? 0) + 1 : 1;

  const rng = seededRng(hashString(loft.userId + today));
  const chosen = shuffle(TEMPLATES, rng).slice(0, 3);
  loft.missions = chosen.map<DailyMission>((t) => ({
    key: t.key, label: t.label, target: t.target, progress: 0,
    rewardMoney: t.money, rewardXp: t.xp, done: false,
  }));
  loft.missionsDay = today;

  const bonus = Math.min(120, 10 + loft.streak * 5);
  loft.money += bonus;
  grantXp(db, loft, 5);
  db.notifications.push({
    id: newId('ntf'), userId: loft.userId, kind: 'info',
    title: `🎯 Nieuwe dagopdrachten — dag ${loft.streak} op rij`,
    body: `Voltooi ze voor extra geld en XP. Streakbonus vandaag: €${bonus}.`,
    flightId: null, createdAt: new Date().toISOString(), read: false,
  });

  // ~1 in 3 days: a dilemma to spice things up (only if none pending).
  if (!loft.pendingEvent && rng() < 0.34) {
    loft.pendingEvent = makeEvent(db, loft, db.world.currentWeek);
  }
  return true;
}

/** Bump progress on any active mission matching this event type. */
export function progressMissions(db: Database, loft: Loft | undefined, event: MissionEvent, n = 1): void {
  if (!loft || loft.isBot || !loft.missions) return;
  for (const m of loft.missions) {
    if (m.done) continue;
    const t = TEMPLATE_MAP.get(m.key);
    if (!t || t.event !== event) continue;
    m.progress = Math.min(m.target, m.progress + n);
    if (m.progress >= m.target) {
      m.done = true;
      loft.money += m.rewardMoney;
      grantXp(db, loft, m.rewardXp);
      db.notifications.push({
        id: newId('ntf'), userId: loft.userId, kind: 'info',
        title: `✅ Opdracht voltooid: ${m.label}`,
        body: `+€${m.rewardMoney} en +${m.rewardXp} XP.`,
        flightId: null, createdAt: new Date().toISOString(), read: false,
      });
    }
  }
}
