/**
 * BudgetOutlook — money a budget has coming that isn't spent yet.
 *
 * Counted, for the budget's categories, inside its current window:
 *   • bills and repeating payments not paid yet (BillService.occurrences:
 *     upcoming, due today, or overdue) — at the last amount paid;
 *   • deliveries paid later: what is owed to the vendor so far, plus the
 *     usual deliveries for the rest of the window (VendorDues / DeliveryPlan).
 * Nothing here is spent yet; it only shows what is still to come, so the
 * card can say how much is really free.
 *
 * Works on whatever services it is given, so it can be tested on its own.
 */
export class BudgetOutlook {
  static #OPEN = new Set(['upcoming', 'due', 'overdue']);

  /** @type {object} */ #budgets;
  /** @type {object|null} */ #bills;
  /** @type {object|null} */ #dues;
  /** @type {{convert:(minor:number, from:string, to:string) => number}} */ #fx;

  /**
   * @param {object} deps
   * @param {{countedCategoryIds:Function, period:Function}} deps.budgets   BudgetService
   * @param {{occurrences:Function}|null} deps.bills                        BillService
   * @param {{items:Function, due:Function, plan:Function}|null} deps.vendorDues  VendorDues
   * @param {{convert:Function}} deps.fx                                    CurrencyService
   */
  constructor({ budgets, bills = null, vendorDues = null, fx }) {
    this.#budgets = budgets;
    this.#bills   = bills;
    this.#dues    = vendorDues;
    this.#fx      = fx;
  }

  /**
   * @param {object} budget
   * @param {string} [today]  YYYY-MM-DD
   * @returns {{total:number, items:{kind:'bill'|'delivery', name:string, date:string, amount:number}[]}}
   */
  stillDue(budget, today) {
    const period = this.#budgets.period(budget, today);
    if (period.status === 'ended') return { total: 0, items: [] };
    const ids   = this.#budgets.countedCategoryIds(budget);
    const items = [...this.#billsDue(budget, period, ids), ...this.#deliveriesDue(budget, period, ids)];
    return { total: items.reduce((s, i) => s + i.amount, 0), items: items.sort((a, b) => a.date.localeCompare(b.date)) };
  }

  // ── Private ─────────────────────────────────────────────────────────

  #billsDue(budget, period, ids) {
    if (!this.#bills) return [];
    const out = [];
    for (const o of this.#bills.occurrences(period.from, period.to, period.today)) {
      const t = o.template;
      if (!BudgetOutlook.#OPEN.has(o.status) || t.type !== 'expense') continue;
      const amount = this.#share(t, ids, o.amount);
      if (amount <= 0) continue;
      out.push({ kind: 'bill', name: BudgetOutlook.#name(t), date: o.date,
                 amount: Math.round(this.#fx.convert(amount, o.currency || t.currency, budget.currency)) });
    }
    return out;
  }

  /** The part of a bill that falls in the budget: all of it, or its split legs that do. */
  #share(t, ids, amount) {
    if (Array.isArray(t.splits) && t.splits.length) {
      const whole = t.splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const mine  = t.splits.filter((x) => ids.has(x.categoryId)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      return whole > 0 ? Math.round(amount * mine / whole) : 0;
    }
    return ids.has(t.categoryId) ? amount : 0;
  }

  #deliveriesDue(budget, period, ids) {
    if (!this.#dues) return [];
    const out = [];
    const tomorrow = period.today < period.from ? period.from : BudgetOutlook.#next(period.today);
    for (const item of this.#dues.items()) {
      if (!ids.has(item.categoryId)) continue;
      const owed = this.#dues.due(item, period.today)?.amount || 0;
      const rest = tomorrow <= period.to ? this.#dues.plan(item).totals(tomorrow, period.to).amount : 0;
      const amount = owed + rest;
      if (amount <= 0) continue;
      out.push({ kind: 'delivery', name: item.name || 'Delivery', date: period.today,
                 amount: Math.round(this.#fx.convert(amount, item.currency || budget.currency, budget.currency)) });
    }
    return out;
  }

  static #name(t) { return String(t.payee || t.description || '').trim() || 'Bill'; }

  static #next(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
}
