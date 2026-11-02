/**
 * DE BANK — lenen, met een limiet op je inkomsten (live sinds 2 nov).
 *
 * De Stem, "Lenen bij de bank" (spelleiding 19 sep): "Spelers kunnen vrij een
 * bedrag lenen bij de bank, met een limiet op hoeveel je open kan hebben staan.
 * Je betaalt dagelijks af, met rente." Eigenaar, 1 nov: "Let op, lenen kost
 * geld. Het toegelaten bedrag … moet rekening houden met wat een speler
 * gemiddeld aan inkomsten heeft."
 *
 * Three pieces, all on one JSON column of the loft row (`Loft.bank`):
 *
 *   1. INCOME. `earn` / `noteIncome` keep the income of the last days, one bucket
 *      per local day. Income is what a loft EARNS by playing: prize money (every
 *      flight, the leagues, titan, estafette), its sponsors (daily stipend,
 *      podium bonus, signing bonus), season and league prizes, and the daily
 *      missions. NOT a sale (that is capital, not income — counting it would let a
 *      player borrow against selling his own birds), a refund, a bet, an event.
 *   2. THE LIMIT. `BANK.limitDays` × the average over the last
 *      `BANK.incomeWindowDays` FULL days (today is not in it yet, so the limit
 *      only moves at midnight and not halfway through a race), capped at
 *      `BANK.maxLimit`. It caps what is still OPEN at the bank — interest
 *      included — not what you borrowed once.
 *   3. THE LOANS. A free amount, for one of `BANK.terms`; paid back in equal
 *      instalments at every local midnight (`tickLoans`, from tickDailyCare —
 *      next to the running costs, before the debt check), spread so that it is
 *      paid off after exactly the term (`instalment`). Interest is flat and
 *      known up front: you pay `loanTotal` back, also when you settle early.
 *
 * ⚠️ An instalment is charged whether or not the kassa can carry it. That is the
 * point ("wie te veel leent, zit vast aan een dagelijkse afbetaling bovenop zijn
 * onkosten"): an empty kassa goes into the red and the ordinary debt route takes
 * over (game/debt.ts). For the same reason the bank lends nothing to a loft that
 * is already in the red.
 *
 * Bots neither borrow nor keep income: their loft rows stay untouched (the '' in
 * loftRow keeps their column-narrowed UPDATE skipping `bank`).
 */
import type { BankLoan, Database, Loft, LoftBank } from '../schema.js';
import { BANK, TIMEZONE, loanDaily, loanTotal } from '../config/gameConfig.js';
import { newId } from '../store.js';
import { dateTimeFormat } from './util.js';

/** Local calendar day number (days since the epoch, in TIMEZONE) — same as schedule.localDayNumber. */
export function bankDay(atMs: number): number {
  const dtf = dateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(atMs))) map[p.type] = p.value;
  return Math.round(Date.UTC(+map.year, +map.month - 1, +map.day) / 86400000);
}

function bankOf(loft: Loft): LoftBank {
  if (!loft.bank) loft.bank = { loans: [], income: [], incomeDay: 0 };
  return loft.bank;
}

/**
 * Count `amount` as income of `loft` on the day of `atMs`. Bots and nothing
 * (≤ 0) are ignored. Buckets for days that passed without income are filled
 * with 0; older than the window are dropped.
 */
export function noteIncome(loft: Loft, amount: number, atMs: number): void {
  if (loft.isBot || !(amount > 0)) return;
  const bank = bankOf(loft);
  const day = bankDay(atMs);
  const keep = BANK.incomeWindowDays + 1; // today + the full days that count
  if (!bank.income.length || !bank.incomeDay) {
    bank.income = [0];
    bank.incomeDay = day;
  } else if (day > bank.incomeDay) {
    const gap = Math.min(keep, day - bank.incomeDay);
    bank.income = [...new Array(gap).fill(0), ...bank.income];
    bank.incomeDay = day;
  }
  // A late credit for a day already rolled past (a delayed tick): book it on its
  // own day if that is still in the window, never on today's.
  const idx = bank.incomeDay - day;
  if (idx < 0 || idx >= keep) return;
  bank.income[idx] = Math.round(((bank.income[idx] ?? 0) + amount) * 100) / 100;
  bank.income = bank.income.slice(0, keep);
}

/** Put `amount` in the kassa AND count it as income (see the list at the top). */
export function earn(loft: Loft, amount: number, atMs: number): void {
  loft.money += amount;
  noteIncome(loft, amount, atMs);
}

/** Average daily income over the last BANK.incomeWindowDays FULL days (today excluded). */
export function averageIncome(loft: Loft, nowMs: number): number {
  const bank = loft.bank;
  if (!bank?.income.length) return 0;
  const today = bankDay(nowMs);
  let sum = 0;
  for (let i = 0; i < bank.income.length; i++) {
    const ago = today - (bank.incomeDay - i); // 0 = today, 1 = yesterday, …
    if (ago >= 1 && ago <= BANK.incomeWindowDays) sum += bank.income[i] ?? 0;
  }
  return Math.round(sum / BANK.incomeWindowDays);
}

/** What `loft` may have open at the bank (interest included). */
export function bankLimit(loft: Loft, nowMs: number): number {
  if (loft.isBot) return 0;
  const raw = averageIncome(loft, nowMs) * BANK.limitDays;
  return Math.min(BANK.maxLimit, Math.floor(raw / BANK.step) * BANK.step);
}

/** Everything still to pay back, over all loans. */
export function bankOwed(loft: Loft): number {
  return (loft.bank?.loans ?? []).reduce((s, l) => s + l.owed, 0);
}

/** Tonight's instalment of one loan: what is left, spread evenly over the instalments left. */
export function instalment(loan: BankLoan): number {
  return Math.min(loan.owed, Math.ceil(loan.owed / Math.max(1, loan.left)));
}

/** What the loans take at the next midnight, together (the Dagbalans line). */
export function loansDueTonight(loft: Loft): number {
  return (loft.bank?.loans ?? []).reduce((s, l) => s + instalment(l), 0);
}

/** The largest principal for `days` whose total still fits in what is left of the limit. */
export function maxPrincipal(loft: Loft, days: number, nowMs: number): number {
  const room = bankLimit(loft, nowMs) - bankOwed(loft);
  const term = BANK.terms.find((t) => t.days === days);
  if (!term || room <= 0) return 0;
  let p = Math.floor((room * 100) / (100 + Math.round(term.interest * 100)) / BANK.step) * BANK.step;
  while (p > 0 && loanTotal(p, days) > room) p -= BANK.step; // the total rounds UP
  return p >= BANK.minLoan ? p : 0;
}

/** Why `loft` cannot borrow right now, or null. */
export function borrowBlock(loft: Loft, nowMs: number): string | null {
  if (loft.isBot) return 'De bank leent niet aan computermelkers.';
  if (loft.money < 0) return 'Je staat in het rood: de bank leent je niets tot je kassa weer op nul of hoger staat.';
  if ((loft.bank?.loans.length ?? 0) >= BANK.maxLoans) return `Je hebt al ${BANK.maxLoans} leningen lopen. Los er eerst een af.`;
  if (bankLimit(loft, nowMs) <= 0) return `Je had de voorbije ${BANK.incomeWindowDays} dagen geen inkomsten, dus de bank leent je (nog) niets.`;
  if (BANK.terms.every((t) => maxPrincipal(loft, t.days, nowMs) <= 0)) return 'Je zit aan je limiet: de bank leent je pas weer als je meer afbetaald hebt.';
  return null;
}

/** Take a loan of `amount` over `days`. Returns the toast, or an error starting with '!'. */
export function borrow(db: Database, userId: string, amount: number, days: number, nowMs: number): string {
  const loft = db.lofts.find((l) => l.userId === userId);
  if (!loft) return '!Hok niet gevonden.';
  const blocked = borrowBlock(loft, nowMs);
  if (blocked) return `!${blocked}`;
  const term = BANK.terms.find((t) => t.days === days);
  if (!term) return '!Kies een looptijd.';
  if (!Number.isInteger(amount) || amount < BANK.minLoan || amount % BANK.step !== 0) {
    return `!Leen een bedrag vanaf €${BANK.minLoan}, in stappen van €${BANK.step}.`;
  }
  const max = maxPrincipal(loft, days, nowMs);
  if (amount > max) return `!Over ${days} dagen kan je hoogstens €${max.toLocaleString('nl-BE')} lenen.`;
  const total = loanTotal(amount, days);
  const loan: BankLoan = {
    id: newId('loan'), principal: amount, total, owed: total, daily: loanDaily(total, days), days, left: days,
    at: new Date(nowMs).toISOString(),
  };
  bankOf(loft).loans.push(loan);
  loft.money += amount; // a loan is not income
  return `🏦 €${amount.toLocaleString('nl-BE')} geleend. Vanaf vannacht betaal je ${days} dagen €${loan.daily.toLocaleString('nl-BE')} per dag terug (samen €${total.toLocaleString('nl-BE')}).`;
}

/** Pay off one loan in full, now. What is still owed, interest included. */
export function settleLoan(db: Database, userId: string, loanId: string): string {
  const loft = db.lofts.find((l) => l.userId === userId);
  const loan = loft?.bank?.loans.find((l) => l.id === loanId);
  if (!loft || !loan) return '!Lening niet gevonden.';
  if (loft.money < loan.owed) return `!Je hebt €${loan.owed.toLocaleString('nl-BE')} nodig om deze lening af te lossen.`;
  loft.money -= loan.owed;
  loft.bank!.loans = loft.bank!.loans.filter((l) => l.id !== loanId);
  return `🏦 Lening afgelost: €${loan.owed.toLocaleString('nl-BE')} betaald.`;
}

/**
 * One midnight of instalments for `loft` (tickDailyCare, before the debt check).
 * A loan taken AFTER that midnight (a delayed tick) is not charged for it. A loan
 * paid off is removed, with one bell (stable id: two concurrent ticks write the
 * same row). Returns what was charged.
 */
export function tickLoans(
  db: Database, loft: Loft, dayMidnight: number,
  notify: (db: Database, userId: string, title: string, body: string, id: string) => void,
): number {
  const loans = loft.bank?.loans;
  if (!loans?.length) return 0;
  let paid = 0;
  for (const loan of loans) {
    if (!(Date.parse(loan.at) < dayMidnight)) continue;
    const pay = instalment(loan);
    loft.money -= pay;
    loan.owed -= pay;
    loan.left = Math.max(0, loan.left - 1);
    paid += pay;
    if (loan.owed <= 0) {
      notify(
        db, loft.userId, '🏦 Lening afbetaald',
        `Je lening van €${loan.principal.toLocaleString('nl-BE')} is volledig terugbetaald (samen €${loan.total.toLocaleString('nl-BE')}).`,
        `ntf:bank:done:${loan.id}`,
      );
    }
  }
  loft.bank!.loans = loans.filter((l) => l.owed > 0);
  return paid;
}

/** Days of instalments a loan still has. */
export function loanDaysLeft(loan: BankLoan): number {
  return loan.owed > 0 ? Math.max(1, loan.left) : 0;
}

/** The /bank view for the owner of `loft`. */
export function bankView(loft: Loft, nowMs: number) {
  const limit = bankLimit(loft, nowMs);
  const owed = bankOwed(loft);
  return {
    averageIncome: averageIncome(loft, nowMs),
    incomeWindowDays: BANK.incomeWindowDays,
    limitDays: BANK.limitDays,
    maxLimit: BANK.maxLimit,
    limit,
    owed,
    room: Math.max(0, limit - owed),
    dueTonight: loansDueTonight(loft),
    minLoan: BANK.minLoan,
    step: BANK.step,
    maxLoans: BANK.maxLoans,
    blocked: borrowBlock(loft, nowMs),
    terms: BANK.terms.map((t) => ({ days: t.days, interest: t.interest, max: maxPrincipal(loft, t.days, nowMs) })),
    loans: (loft.bank?.loans ?? []).map((l) => ({
      id: l.id, principal: l.principal, total: l.total, owed: l.owed, daily: l.daily, days: l.days, at: l.at,
      daysLeft: loanDaysLeft(l), tonight: instalment(l),
    })),
  };
}
