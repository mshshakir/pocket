/**
 * BudgetAdvisor — looking back: past periods of a budget, and a limit to
 * suggest from what was usually spent.
 *
 *   history(budget, n)   the n periods before this one, newest first:
 *                        { from, to, label, spent, limit } (limit = the plain
 *                        amount; rollover isn't replayed)
 *   suggest(draft, n)    the average of the last n periods that had any
 *                        spending (looking back up to 12), rounded up to a
 *                        tidy figure; null when there's nothing to go on
 *
 * Set-dates budgets don't repeat, so they have no history; a suggestion for
 * one scales the usual daily spend (last 90 days) to its number of days.
 */
import { BudgetPeriod } from './BudgetPeriod.js';

export class BudgetAdvisor {
  /** @type {{spendBetween:Function, period:Function}} */ #budgets;

  /** @param {{spendBetween:Function, period:Function}} budgets  BudgetService */
  constructor(budgets) {
    this.#budgets = budgets;
  }

  /**
   * @param {object} budget
   * @param {number} [n]
   * @param {string} [today]
   */
  history(budget, n = 6, today) {
    const now = this.#budgets.period(budget, today);
    if (!now.repeats) return [];
    const out = [];
    let win = now.previous();
    for (let i = 0; i < n && win; i++) {
      const p = new BudgetPeriod(budget, { today: win.from });
      out.push({ from: win.from, to: win.to, label: BudgetAdvisor.#label(now.kind, p, win),
                 spent: this.#budgets.spendBetween(budget, win.from, win.to), limit: budget.amount });
      win = p.previous();
    }
    return out;
  }

  /**
   * @param {{categoryIds:string[], currency:string, period:string, startDate?:string, endDate?:string}} draft
   * @param {number} [n]
   * @param {string} [today]
   * @returns {{amount:number, basis:string}|null}  amount in minor units of draft.currency
   */
  suggest(draft, n = 3, today) {
    const budget = { ...draft, categoryIds: draft.categoryIds || [], amount: 0 };
    if (!budget.categoryIds.length) return null;
    const now = this.#budgets.period(budget, today);
    if (!now.repeats) {
      const end = BudgetPeriod.addDays(now.today, -1);
      const daily = this.#budgets.spendBetween(budget, BudgetPeriod.addDays(end, -89), end) / 90;
      if (daily <= 0) return null;
      return { amount: BudgetAdvisor.tidy(daily * now.days), basis: `about ${now.days} days at your usual daily spend` };
    }
    const past = this.history(budget, 12, today).filter((h) => h.spent > 0).slice(0, n);
    if (!past.length) return null;
    const avg = past.reduce((s, h) => s + h.spent, 0) / past.length;
    const unit = now.unit;
    return { amount: BudgetAdvisor.tidy(avg), basis: `your average over the last ${past.length} ${unit}${past.length === 1 ? '' : 's'}` };
  }

  /**
   * Round up to two significant figures in major units (₹4,630 → ₹4,700;
   * ₹123 → ₹130), so the suggestion reads like a budget, not a statistic.
   * @param {number} minor
   */
  static tidy(minor) {
    const major = minor / 100;
    if (major <= 0) return 0;
    const step = 10 ** Math.max(0, Math.floor(Math.log10(major)) - 1);
    return Math.ceil(major / step) * step * 100;
  }

  static #label(kind, p, win) {
    if (kind === 'gregorian') return `${p.label} ${win.from.slice(0, 4)}`;
    if (kind === 'hijri') return p.label;
    return p.label;
  }
}
