/**
 * CardCycle — how a credit card stands this month, worked out from what's
 * been entered (not from the bank).
 *
 * A card account may carry (all optional):
 *   creditLimit   minor units, in the account's currency
 *   statementDay  1–31  the day the bank closes each bill
 *   dueDay        1–31  the day the bill must be paid
 * Days past a month's end fall on its last day (31 → 30 Apr, 28/29 Feb).
 *
 * From the card's balance (negative = owed) and its entries:
 *   owed        what's owed on the card right now
 *   bill        what was owed when the last statement closed
 *   paid        money into the card since that statement (payments, refunds)
 *   billLeft    bill − paid, never below 0
 *   unbilled    spending since the statement (goes on the next bill)
 *   dueDate     the due day after the last statement
 *   status      'none' (no statement day) · 'clear' (no bill) · 'paid' ·
 *               'overdue' · 'soon' (due within SOON days) · 'open'
 *   available   limit − owed (null without a limit)
 *
 * Pure: no Store, no DOM. Interest, fees and minimum due are left out on
 * purpose — banks differ; they go in as ordinary entries.
 */
import { LedgerMath } from './LedgerMath.js';

export class CardCycle {
  /** Days before the due date when a bill counts as "due soon". */
  static SOON = 5;

  /** @param {object} account */
  static isCard(account) { return account?.type === 'card'; }

  /**
   * @param {object} account
   * @param {number} balance  the account's balance now (minor units; negative = owed)
   * @param {object[]} transactions
   * @param {string} today  YYYY-MM-DD
   * @param {import('./CurrencyService.js').CurrencyService} fx
   */
  static of(account, balance, transactions, today, fx) {
    const owed      = Math.max(0, -Math.round(balance || 0));
    const limit     = Number(account?.creditLimit) > 0 ? Math.round(account.creditLimit) : null;
    const available = limit === null ? null : limit - owed;
    const usedPct   = limit ? Math.min(100, Math.round((100 * owed) / limit)) : null;
    const base = { owed, limit, available, usedPct, currency: account?.currency };

    const sDay = CardCycle.#day(account?.statementDay);
    if (!sDay) return { ...base, status: 'none' };

    const statement = CardCycle.lastOn(sDay, today);
    const dDay      = CardCycle.#day(account?.dueDay);
    const dueDate   = dDay ? CardCycle.nextAfter(dDay, statement) : null;

    let after = 0, paid = 0, unbilled = 0;
    for (const tx of transactions || []) {
      if (!tx?.date || tx.date <= statement) continue;
      const d = LedgerMath.accountDelta(tx, account, fx);
      if (!d) continue;
      after += d;
      if (d > 0) paid += d; else unbilled -= d;
    }
    const bill     = Math.max(0, -Math.round((balance || 0) - after));
    const billLeft = Math.max(0, bill - Math.round(paid));
    const status = !bill ? 'clear'
      : !billLeft ? 'paid'
      : dueDate && today > dueDate ? 'overdue'
      : dueDate && CardCycle.#daysBetween(today, dueDate) <= CardCycle.SOON ? 'soon'
      : 'open';
    return { ...base, statement, dueDate, bill, paid: Math.round(paid), billLeft, unbilled: Math.round(unbilled), status };
  }

  /** The most recent date on or before `today` that falls on day `day`. */
  static lastOn(day, today) {
    const [y, m] = today.split('-').map(Number);
    const here = CardCycle.#on(y, m, day);
    if (here <= today) return here;
    return m === 1 ? CardCycle.#on(y - 1, 12, day) : CardCycle.#on(y, m - 1, day);
  }

  /** The first date strictly after `iso` that falls on day `day`. */
  static nextAfter(day, iso) {
    const [y, m] = iso.split('-').map(Number);
    const here = CardCycle.#on(y, m, day);
    if (here > iso) return here;
    return m === 12 ? CardCycle.#on(y + 1, 1, day) : CardCycle.#on(y, m + 1, day);
  }

  /** Whole days from a to b (b later → positive). */
  static daysUntil(a, b) { return CardCycle.#daysBetween(a, b); }

  // ── Private ──────────────────────────────────────────────────────────

  static #day(v) {
    const n = Math.round(Number(v));
    return n >= 1 && n <= 31 ? n : 0;
  }

  /** YYYY-MM-DD for day `day` of a month, clamped to the month's length. */
  static #on(y, m, day) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = Math.min(day, last);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  static #daysBetween(a, b) {
    return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  }
}
