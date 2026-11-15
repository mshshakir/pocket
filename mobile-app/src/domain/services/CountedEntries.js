/**
 * CountedEntries — the transactions as income and spending should COUNT them.
 *
 * Balances follow the real entries (LedgerMath). Totals — the Dashboard, the
 * Transactions month totals, Reports, Budgets, Habits and exports — follow
 * this view instead:
 *
 *   • a loan given or taken, and its repayments (Debts), is neither income
 *     nor spending: the money is still yours, or still owed
 *   • a reimbursement payment is not income; only an extra the user chose
 *     to count as income is
 *   • an expense someone paid back counts only what the user bore: its
 *     amount less what came back, in the expense's own month and category
 *     (splits, the home-currency amount and the frozen account amount are
 *     reduced in the same proportion)
 *
 * Entries are never changed: a counted copy is returned when an amount
 * differs, carrying `_paidBack` (minor, own currency) for notes.
 */
import { ReimbursementService } from './ReimbursementService.js';

export class CountedEntries {
  /**
   * @param {object} state
   * @returns {object[]}  the counted transactions (same order)
   */
  static list(state) {
    const txs = state?.transactions || [];
    const r = new ReimbursementService(state);
    const out = [];
    for (const t of txs) {
      const c = CountedEntries.counted(t, r);
      if (c) out.push(c);
    }
    return out;
  }

  /** Counted copies by id (missing = counts as nothing). */
  static byId(state) {
    return new Map(CountedEntries.list(state).map((t) => [t.id, t]));
  }

  /**
   * How one entry counts, or null when it doesn't.
   * @param {object} t
   * @param {ReimbursementService} r
   */
  static counted(t, r) {
    if (!t) return null;
    if (ReimbursementService.isDebtEntry(t)) return null;
    if (ReimbursementService.isPayment(t)) {
      const extra = Number(t.reimbExtra) || 0;
      if (t.reimbExtraAs !== 'income' || extra <= 0) return null;
      return CountedEntries.scaled(t, Math.min(extra, Number(t.amount) || 0), 0);
    }
    if (ReimbursementService.isTracked(t)) {
      const paid = r.paidBack(t.id);
      if (paid > 0) {
        const full = Number(t.amount) || 0;
        return CountedEntries.scaled(t, Math.max(0, full - paid), Math.min(paid, full));
      }
    }
    return t;
  }

  /** A copy of `t` worth `amount` (own currency), parts reduced alike. */
  static scaled(t, amount, paidBack) {
    const full = Number(t.amount) || 0;
    const f = full > 0 ? amount / full : 0;
    const copy = { ...t, amount, _paidBack: paidBack };
    if (Number.isFinite(t.refAmount)) copy.refAmount = Math.round(t.refAmount * f);
    if (Number.isFinite(t.acctMinor)) copy.acctMinor = Math.round(t.acctMinor * f);
    if (Array.isArray(t.splits) && t.splits.length) {
      let given = 0;
      copy.splits = t.splits.map((s, i) => {
        const a = i === t.splits.length - 1 ? amount - given : Math.round((Number(s.amount) || 0) * f);
        given += a;
        return { ...s, amount: a, acctMinor: Number.isFinite(s.acctMinor) ? Math.round(s.acctMinor * f) : s.acctMinor };
      });
    }
    return copy;
  }
}
