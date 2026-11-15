/**
 * BudgetAlertStatus — the totals a budget sends to the server so Telegram
 * can alert at 80%, at 100%, and when spending runs faster than planned.
 *
 * Only totals and names leave the book — never entries:
 *   { key, from, to, label, name, currency, spent, limit, ahead, at }
 *     key     the period (from…to), so each alert goes once per period
 *     ahead   how far spending is ahead of an even spread (0 when it isn't)
 *     at      the day these figures were worked out
 * A budget with alerts switched off (budget.alerts === false), or whose
 * period isn't running, sends nothing (null).
 *
 * Stamped on budgets.extra.alertStatus when the book is saved (SyncService),
 * the way shared budgets carry sharedSpend. The 10-minute job
 * (telegram-summaries → BudgetAlertRunner) reads it.
 */
import { BudgetPace } from './BudgetPace.js';

export class BudgetAlertStatus {
  /**
   * @param {object} budget
   * @param {{budgets:object, categoryName:(id:string)=>string|null, today:string}} deps
   *   budgets: BudgetService (period, currentSpend, effectiveLimit, targetCategoryIds)
   * @returns {object|null}
   */
  static of(budget, { budgets, categoryName, today }) {
    if (!budget || budget.alerts === false) return null;
    const period = budgets.period(budget, today);
    if (period.status !== 'active') return null;
    const spent = Math.round(budgets.currentSpend(budget));
    const limit = Math.round(budgets.effectiveLimit(budget).limit);
    if (!(limit > 0)) return null;
    const pace = new BudgetPace({ limit, spent, period });
    return {
      key: `${period.from}…${period.to}`,
      from: period.from,
      to: period.to,
      label: period.label,
      name: BudgetAlertStatus.name(budgets.targetCategoryIds(budget).map(categoryName).filter(Boolean)),
      currency: budget.currency,
      spent,
      limit,
      ahead: pace.state === 'ahead' ? Math.round(pace.ahead) : 0,
      at: today,
    };
  }

  /** "Food", "Food, Home", "Food, Home +2" */
  static name(names) {
    if (!names.length) return 'Budget';
    return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }
}
