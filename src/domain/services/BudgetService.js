/**
 * BudgetService — Budget CRUD, period spend calculation, rollover.
 *
 * No DOM, no side effects.  All state access via Store.
 */
import { Store }           from '../../core/Store.js';
import { IdGenerator }     from './IdGenerator.js';
import { CurrencyService } from './CurrencyService.js';
import { CategoryService } from './CategoryService.js';
import { HijriCalendarService } from './HijriCalendarService.js';

export class BudgetService {
  /** @type {Store} */               #store;
  /** @type {CurrencyService} */     #fx;
  /** @type {CategoryService} */     #cats;
  /** @type {HijriCalendarService} */ #hijri;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
    this.#cats  = new CategoryService();
    this.#hijri = new HijriCalendarService();
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /**
   * Current period spend for a budget (in the budget's currency).
   * @param {object} budget
   * @returns {number} minor units
   */
  currentSpend(budget) {
    const state      = this.#store.getState();
    const targetIds  = new Set(this.#cats.descendants(budget.categoryId));
    const todayH     = this.#hijri.toHijri(new Date());
    const now        = new Date();

    const matches = (t) => {
      if (t.type !== 'expense') return false;
      if (budget.period === 'hijri') {
        const h = this.#hijri.toHijri(t.date);
        return h.year === todayH.year && h.month === todayH.month;
      }
      const d = new Date(t.date + 'T12:00:00');
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    };

    let spend = 0;
    for (const t of state.transactions) {
      if (!matches(t)) continue;
      for (const slice of this.#categoryAmounts(t)) {
        if (targetIds.has(slice.categoryId)) {
          spend += this.#fx.convert(slice.amount, slice.currency, budget.currency);
        }
      }
    }
    return spend;
  }

  /**
   * Effective budget limit accounting for optional rollover from previous period.
   * @param {object} budget
   * @returns {{ limit: number, rollover: number }}
   */
  effectiveLimit(budget) {
    if (!budget.rollover) return { limit: budget.amount, rollover: 0 };

    const state     = this.#store.getState();
    const todayH    = this.#hijri.toHijri(new Date());
    const targetIds = new Set(this.#cats.descendants(budget.categoryId));
    const now       = new Date();

    const prevMatches = (t) => {
      if (t.type !== 'expense') return false;
      if (budget.period === 'hijri') {
        let pm = todayH.month - 1, py = todayH.year;
        if (pm < 0) { pm = 11; py -= 1; }
        const h = this.#hijri.toHijri(t.date);
        return h.year === py && h.month === pm;
      }
      const d  = new Date(t.date + 'T12:00:00');
      const pm = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const py = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      return d.getFullYear() === py && d.getMonth() === pm;
    };

    let prevSpent = 0;
    for (const t of state.transactions) {
      if (!prevMatches(t)) continue;
      for (const slice of this.#categoryAmounts(t)) {
        if (targetIds.has(slice.categoryId)) {
          prevSpent += this.#fx.convert(slice.amount, slice.currency, budget.currency);
        }
      }
    }

    const leftover = Math.max(0, budget.amount - prevSpent);
    return { limit: budget.amount + leftover, rollover: leftover };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  #categoryAmounts(tx) {
    if (Array.isArray(tx.splits) && tx.splits.length) {
      return tx.splits.map((s) => ({
        categoryId: s.categoryId || null,
        amount:     s.amount,
        currency:   tx.currency,
      }));
    }
    return [{ categoryId: tx.categoryId || null, amount: tx.amount, currency: tx.currency }];
  }

  // ── CRUD ─────────────────────────────────────────────────────────────

  /**
   * Create a budget.
   * @param {object} data
   * @returns {object}
   */
  create(data) {
    const budget = {
      id:         IdGenerator.generate('bg'),
      categoryId: data.categoryId,
      amount:     data.amount,
      currency:   data.currency,
      period:     data.period === 'hijri' ? 'hijri' : 'gregorian',
      rollover:   data.rollover || false,
    };
    this.#store.getState().budgets.push(budget);
    this.#store.flush();
    return budget;
  }

  /**
   * Update a budget.
   * @param {string} id
   * @param {object} changes
   */
  update(id, changes) {
    const budget = this.#store.getState().budgets.find((b) => b.id === id);
    if (!budget) return null;
    Object.assign(budget, changes);
    this.#store.flush();
    return budget;
  }

  /**
   * Delete a budget.
   * @param {string} id
   */
  delete(id) {
    const state = this.#store.getState();
    state.budgets = state.budgets.filter((b) => b.id !== id);
    this.#store.flush();
  }
}
