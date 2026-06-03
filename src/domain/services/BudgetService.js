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

  // ── Targeting ───────────────────────────────────────────────────────

  /**
   * The category IDs a budget targets. Backward-compatible: a legacy budget
   * carrying a single `categoryId` is treated as a one-element list.
   * @param {object} budget
   * @returns {string[]}
   */
  targetCategoryIds(budget) {
    if (Array.isArray(budget.categoryIds) && budget.categoryIds.length) return budget.categoryIds;
    return budget.categoryId ? [budget.categoryId] : [];
  }

  /** Every category that counts toward the budget = each target + its descendants. */
  #expandedIds(budget) {
    const set = new Set();
    for (const id of this.targetCategoryIds(budget)) {
      for (const d of this.#cats.descendants(id)) set.add(d);
    }
    return set;
  }

  /** True if an expense tx falls within the budget's current period. */
  #inCurrentPeriod(budget, t) {
    if (t.type !== 'expense') return false;
    if (budget.period === 'hijri') {
      const todayH = this.#hijri.toHijri(new Date());
      const h      = this.#hijri.toHijri(t.date);
      return h.year === todayH.year && h.month === todayH.month;
    }
    const now = new Date();
    const d   = new Date(t.date + 'T12:00:00');
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /**
   * Total current-period spend for a budget across all its target categories
   * (and their descendants), in the budget's currency.
   * @param {object} budget
   * @returns {number} minor units
   */
  currentSpend(budget) {
    const state = this.#store.getState();
    const ids   = this.#expandedIds(budget);
    let spend = 0;
    for (const t of state.transactions) {
      if (!this.#inCurrentPeriod(budget, t)) continue;
      for (const slice of this.#categoryAmounts(t)) {
        if (ids.has(slice.categoryId)) spend += this.#fx.convert(slice.amount, slice.currency, budget.currency);
      }
    }
    return spend;
  }

  /**
   * Per-target-category spend for the current period (budget currency). Each
   * entry covers that target category plus its descendants — powering the small
   * split shown under a budget's progress bar.
   * @param {object} budget
   * @returns {{ categoryId: string, name: string, color: string, icon: string, spend: number }[]}
   */
  spendByCategory(budget) {
    const state = this.#store.getState();
    return this.targetCategoryIds(budget).map((cid) => {
      const ids = new Set(this.#cats.descendants(cid));
      let spend = 0;
      for (const t of state.transactions) {
        if (!this.#inCurrentPeriod(budget, t)) continue;
        for (const slice of this.#categoryAmounts(t)) {
          if (ids.has(slice.categoryId)) spend += this.#fx.convert(slice.amount, slice.currency, budget.currency);
        }
      }
      const cat = this.#cats.find(cid);
      return { categoryId: cid, name: cat?.name || 'Category', color: cat?.color || '#a1a1aa', icon: cat?.icon || 'circle', spend };
    });
  }

  /**
   * All expense transactions counting toward the budget this period, newest
   * first — used by the budget detail view.
   * @param {object} budget
   * @returns {object[]}
   */
  periodTransactions(budget) {
    const state = this.#store.getState();
    const ids   = this.#expandedIds(budget);
    return state.transactions
      .filter((t) => this.#inCurrentPeriod(budget, t) &&
                     this.#categoryAmounts(t).some((s) => ids.has(s.categoryId)))
      .sort((a, b) => b.date.localeCompare(a.date));
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
    const ids       = this.#expandedIds(budget);
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
        if (ids.has(slice.categoryId)) {
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
    const ids = Array.isArray(data.categoryIds) && data.categoryIds.length
      ? data.categoryIds
      : (data.categoryId ? [data.categoryId] : []);
    const budget = {
      id:          IdGenerator.generate('bg'),
      categoryIds: ids,
      categoryId:  ids[0] ?? null,   // kept in sync for backward compatibility
      amount:      data.amount,
      currency:    data.currency,
      period:      data.period === 'hijri' ? 'hijri' : 'gregorian',
      rollover:    data.rollover || false,
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
