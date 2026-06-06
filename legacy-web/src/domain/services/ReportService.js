/**
 * ReportService — Analytics, net-worth time series, report aggregations.
 *
 * Pure computation over the state snapshot.  No DOM, no mutations.
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from './CurrencyService.js';
import { TransactionService } from './TransactionService.js';
import { HijriCalendarService } from './HijriCalendarService.js';
import { DateService }         from './DateService.js';
import { LedgerMath }          from './LedgerMath.js';

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

  /** @param {string} iso @param {number|'all'|'month'} range @returns {boolean} */
  withinRange(iso, range) {
    if (range === 'all') return true;
    const d = new Date(iso + 'T12:00:00');
    // 'month' = current calendar month to date. Passing it as a numeric range
    // would coerce to NaN, making every comparison fail (#8).
    if (range === 'month') return d >= this.startOfMonth();
    const start = new Date();
    start.setDate(start.getDate() - Number(range));
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
      keys.push(DateService.toIso(d));
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
    const accounts = state.accounts;

    // Net worth at a point = Σ openingBalance + Σ (ledger impact so far),
    // all converted to home. Computed WITHOUT mutating any real balances — the
    // ledger is the source of truth, so we just accumulate forward.
    const openingTotal = accounts.reduce(
      (s, a) => s + this.#fx.convert(Number(a.openingBalance ?? 0) || 0, a.currency, home),
      0,
    );

    if (!state.transactions.length) {
      return [{ date: DateService.todayIso(), netWorth: Math.round(openingTotal) }];
    }

    const txsAsc = state.transactions
      .slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id));

    const byId = new Map(accounts.map((a) => [a.id, a]));
    // Home-currency delta of one transaction across all the accounts it touches.
    const homeDelta = (t) => {
      let d = 0;
      for (const c of LedgerMath.contributions(t)) {
        const acc = byId.get(c.accountId);
        if (!acc) continue;
        const m = Number.isFinite(c.minor) ? c.minor : 0;
        d += this.#fx.convert(m, c.currency, home);
      }
      return d;
    };

    const series  = [];
    let running   = openingTotal;
    let curDate   = null;

    for (const t of txsAsc) {
      if (curDate !== null && curDate !== t.date) {
        series.push({ date: curDate, netWorth: Math.round(running) });
      }
      curDate  = t.date;
      running += homeDelta(t);
    }
    if (curDate) series.push({ date: curDate, netWorth: Math.round(running) });

    const today = DateService.todayIso();
    if (!series.length || series[series.length - 1].date !== today) {
      series.push({ date: today, netWorth: Math.round(running) });
    }

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
}
