/**
 * ReportService — Analytics, net-worth time series, report aggregations.
 *
 * Pure computation over the state snapshot.  No DOM, no mutations.
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from './CurrencyService.js';
import { TransactionService } from './TransactionService.js';
import { HijriCalendarService } from './HijriCalendarService.js';

export class ReportService {
  /** @type {Store} */               #store;
  /** @type {CurrencyService} */     #fx;
  /** @type {TransactionService} */  #txs;
  /** @type {HijriCalendarService} */ #hijri;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
    this.#txs   = new TransactionService();
    this.#hijri = new HijriCalendarService();
  }

  // ── Date helpers ─────────────────────────────────────────────────────

  /** @param {string} iso @param {number|'all'} days @returns {boolean} */
  withinRange(iso, days) {
    if (days === 'all') return true;
    const d     = new Date(iso + 'T12:00:00');
    const start = new Date();
    start.setDate(start.getDate() - Number(days));
    return d >= start;
  }

  /** @returns {Date} */
  startOfMonth(d = new Date()) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  // ── Aggregations ─────────────────────────────────────────────────────

  /**
   * Spending grouped by category over a date range.
   * @param {number|'all'} rangeDays
   * @returns {{ categoryId: string, amount: number }[]}  sorted desc
   */
  spendingByCategory(rangeDays) {
    const state  = this.#store.getState();
    const home   = state.user.homeCurrency;
    const byCat  = {};

    state.transactions
      .filter((t) => t.type === 'expense' && this.withinRange(t.date, rangeDays))
      .forEach((t) => {
        for (const slice of this.#txs.categoryAmounts(t)) {
          if (!slice.categoryId) continue;
          byCat[slice.categoryId] =
            (byCat[slice.categoryId] || 0) +
            this.#fx.convert(slice.amount, slice.currency, home);
        }
      });

    return Object.entries(byCat)
      .map(([categoryId, amount]) => ({ categoryId, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  /**
   * Daily expense totals (major units, home currency) for the last N days.
   * @param {number} days
   * @returns {{ date: string, amount: number }[]}
   */
  dailyExpenses(days) {
    const state  = this.#store.getState();
    const home   = state.user.homeCurrency;
    const keys   = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      keys.push(d.toISOString().slice(0, 10));
    }

    const totals = Object.fromEntries(keys.map((k) => [k, 0]));
    state.transactions
      .filter((t) => t.type === 'expense' && keys.includes(t.date))
      .forEach((t) => {
        totals[t.date] += this.#fx.fromMinor(
          this.#fx.convert(t.amount, t.currency, home),
          home,
        );
      });

    return keys.map((date) => ({ date, amount: totals[date] }));
  }

  /**
   * Top N expense transactions in a range, sorted by value desc.
   * @param {number} n
   * @param {number|'all'} rangeDays
   * @returns {{ tx: object, value: number }[]}
   */
  topTransactions(n, rangeDays) {
    const state = this.#store.getState();
    const home  = state.user.homeCurrency;
    return state.transactions
      .filter((t) => t.type === 'expense' && this.withinRange(t.date, rangeDays))
      .map((t) => ({ tx: t, value: this.#fx.convert(t.amount, t.currency, home) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, n);
  }

  /**
   * Net-worth time series in the user's home currency.
   * Strategy: snapshot balances, walk transactions in reverse to recover
   * starting balances, then walk forward emitting a point per unique date.
   * @returns {{ date: string, netWorth: number }[]}
   */
  netWorthSeries() {
    const state = this.#store.getState();
    const home  = state.user.homeCurrency;

    const totalNW = () =>
      state.accounts.reduce(
        (s, a) => s + this.#fx.convert(a.balance, a.currency, home),
        0,
      );

    if (!state.transactions.length) {
      return [{ date: new Date().toISOString().slice(0, 10), netWorth: totalNW() }];
    }

    // Snapshot current balances so we can restore them afterwards
    const snap = state.accounts.map((a) => ({ id: a.id, bal: a.balance }));

    const txsAsc = state.transactions
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    // Roll back every tx to get to the state before any transaction
    const accountSvc = { revertBalances: (t) => this.#revert(t, state) };
    for (let i = txsAsc.length - 1; i >= 0; i--) accountSvc.revertBalances(txsAsc[i]);

    const series  = [{ date: txsAsc[0].date, netWorth: totalNW() }];
    let curDate   = null;

    for (const t of txsAsc) {
      if (curDate !== null && curDate !== t.date) {
        series.push({ date: curDate, netWorth: totalNW() });
      }
      curDate = t.date;
      this.#apply(t, state);
    }
    if (curDate) series.push({ date: curDate, netWorth: totalNW() });

    const today = new Date().toISOString().slice(0, 10);
    if (series[series.length - 1].date !== today) {
      series.push({ date: today, netWorth: totalNW() });
    }

    // Restore balances
    snap.forEach(({ id, bal }) => {
      const a = state.accounts.find((x) => x.id === id);
      if (a) a.balance = bal;
    });

    return series;
  }

  /**
   * Spending grouped by Hijri month.
   * @param {number|'all'} rangeDays
   * @returns {{ year: number, month: number, amount: number }[]}
   */
  spendingByHijriMonth(rangeDays) {
    const state   = this.#store.getState();
    const home    = state.user.homeCurrency;
    const byMonth = {};

    state.transactions
      .filter((t) => t.type === 'expense' && this.withinRange(t.date, rangeDays))
      .forEach((t) => {
        const h = this.#hijri.toHijri(t.date);
        const k = `${h.year}-${h.month}`;
        byMonth[k] = (byMonth[k] || 0) + this.#fx.convert(t.amount, t.currency, home);
      });

    return Object.entries(byMonth)
      .map(([k, v]) => {
        const [y, m] = k.split('-').map(Number);
        return { year: y, month: m, amount: v };
      })
      .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
  }

  // ── Private balance helpers ──────────────────────────────────────────

  /** Apply transaction to account balances (in-place). */
  #apply(tx, state) {
    const acc = state.accounts.find((a) => a.id === tx.accountId);
    if (!acc) return;
    const conv = (amt, from) => this.#fx.convert(amt, from, acc.currency);
    if (tx.type === 'transfer') {
      if (tx.transferDir === 'out') acc.balance -= tx.amount;
      else if (tx.transferDir === 'in') acc.balance += tx.amount;
    } else if (Array.isArray(tx.splits) && tx.splits.length) {
      for (const s of tx.splits) {
        const sa = state.accounts.find((a) => a.id === (s.accountId || tx.accountId));
        if (!sa) continue;
        const c = this.#fx.convert(s.amount, tx.currency, sa.currency);
        if (tx.type === 'expense') sa.balance -= c;
        else if (tx.type === 'income') sa.balance += c;
      }
    } else {
      const c = conv(tx.amount, tx.currency);
      if (tx.type === 'expense') acc.balance -= c;
      else if (tx.type === 'income') acc.balance += c;
    }
  }

  /** Revert transaction from account balances (in-place). */
  #revert(tx, state) {
    const acc = state.accounts.find((a) => a.id === tx.accountId);
    if (!acc) return;
    if (tx.type === 'transfer') {
      if (tx.transferDir === 'out') acc.balance += tx.amount;
      else if (tx.transferDir === 'in') acc.balance -= tx.amount;
    } else if (Array.isArray(tx.splits) && tx.splits.length) {
      for (const s of tx.splits) {
        const sa = state.accounts.find((a) => a.id === (s.accountId || tx.accountId));
        if (!sa) continue;
        const c = this.#fx.convert(s.amount, tx.currency, sa.currency);
        if (tx.type === 'expense') sa.balance += c;
        else if (tx.type === 'income') sa.balance -= c;
      }
    } else {
      const c = this.#fx.convert(tx.amount, tx.currency, acc.currency);
      if (tx.type === 'expense') acc.balance += c;
      else if (tx.type === 'income') acc.balance -= c;
    }
  }
}
