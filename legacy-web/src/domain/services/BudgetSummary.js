/**
 * BudgetSummary — the line at the top of Budgets.
 *
 *   monthly   budgets by month (Gregorian or Hijri): their limits and spend
 *             added up in the home currency
 *   unbudgeted  this calendar month's spending in categories that no budget
 *             covers (any period), with the biggest few categories
 *   rank()    how urgent a budget is, for sorting the cards:
 *             0 over the limit · 1 bills still to come take it over ·
 *             2 spending faster than planned · 3 the rest (most used first) ·
 *             4 not started · 5 ended
 */
import { CountedEntries } from './CountedEntries.js';

export class BudgetSummary {
  /** @type {object} */ #budgets;
  /** @type {{convert:Function}} */ #fx;
  /** @type {{find:Function, descendants:Function}} */ #cats;

  /**
   * @param {{budgets:object, fx:{convert:Function}, categories:{find:Function}}} deps
   *   budgets: BudgetService (countedCategoryIds, slices, currentSpend, effectiveLimit, period)
   */
  constructor({ budgets, fx, categories }) {
    this.#budgets = budgets;
    this.#fx      = fx;
    this.#cats    = categories;
  }

  /**
   * @param {object} state
   * @param {{today:string, home:string, spentOf?:(b:object)=>number}} opts
   * @returns {{monthly:{count:number, limit:number, spent:number}, unbudgeted:{total:number, top:{name:string, amount:number}[]}}}
   */
  month(state, { today, home, spentOf = (b) => this.#budgets.currentSpend(b) }) {
    const monthly = { count: 0, limit: 0, spent: 0 };
    for (const b of state.budgets || []) {
      if (b.period !== 'gregorian' && b.period !== 'hijri') continue;
      monthly.count++;
      monthly.limit += this.#fx.convert(this.#budgets.effectiveLimit(b).limit, b.currency, home);
      monthly.spent += this.#fx.convert(spentOf(b), b.currency, home);
    }

    const covered = new Set();
    for (const b of state.budgets || []) for (const id of this.#budgets.countedCategoryIds(b)) covered.add(id);
    const ym = today.slice(0, 7);
    const by = new Map();
    for (const t of CountedEntries.list(state)) {
      if (t.type !== 'expense' || !t.date || t.date.slice(0, 7) !== ym) continue;
      for (const s of this.#budgets.slices(t)) {
        if (s.categoryId && covered.has(s.categoryId)) continue;
        const top = this.#topOf(s.categoryId);
        by.set(top, (by.get(top) || 0) + this.#fx.convert(s.amount, s.currency, home));
      }
    }
    const list = [...by].map(([id, amount]) => ({ name: id ? (this.#cats.find(id)?.name || 'Other') : 'No category', amount }))
      .filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
    return { monthly, unbudgeted: { total: list.reduce((s, x) => s + x.amount, 0), top: list.slice(0, 3) } };
  }

  /**
   * @param {{spent:number, limit:number, due:number, period:{status:string}, paceState:string}} c
   * @returns {number}
   */
  static rank({ spent, limit, due, period, paceState }) {
    if (period.status === 'ended') return 5;
    if (period.status === 'upcoming') return 4;
    if (limit > 0 && spent >= limit) return 0;
    if (limit > 0 && spent + due > limit) return 1;
    if (paceState === 'ahead') return 2;
    return 3;
  }

  /** The main category an id sits under (itself when it is one). */
  #topOf(id) {
    let c = id ? this.#cats.find(id) : null;
    for (let i = 0; c?.parentId && i < 5; i++) c = this.#cats.find(c.parentId) || null;
    return c?.id || id || null;
  }
}
