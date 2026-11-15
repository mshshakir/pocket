/**
 * BudgetMeter — the amounts, bar and lines under a budget, shared by the
 * Budgets cards and a budget's own page.
 *
 * The bar has three parts: spent (solid), bills still to come (the same
 * colour, faded), and a thin mark where the plan says you should be today.
 * Under it: how much is used and left, what is still to come, and the pace
 * line with what can go out each day.
 */
import { BudgetPace }   from '../../domain/services/BudgetPace.js';
import { BudgetPeriod } from '../../domain/services/BudgetPeriod.js';

export class BudgetMeter {
  static RED = '#ef4444';
  static AMBER = '#f59e0b';
  static GREEN = '#10b981';

  /** @type {(minor:number, currency:string) => string} */ #money;
  /** @type {(s:string) => string} */ #esc;

  /**
   * @param {{money:(minor:number, currency:string) => string, escape:(s:string) => string}} deps
   */
  constructor({ money, escape }) {
    this.#money = money;
    this.#esc   = escape;
  }

  /**
   * @param {object} p
   * @param {number} p.spent
   * @param {number} p.limit
   * @param {number} [p.rollover]
   * @param {string} p.currency
   * @param {BudgetPeriod} p.period
   * @param {{total:number, items:object[]}} [p.due]
   * @param {boolean} [p.large]  the budget's own page: bigger amount, bills listed
   */
  render({ spent, limit, rollover = 0, currency, period, due = { total: 0, items: [] }, large = false }) {
    const pace  = new BudgetPace({ limit, spent, due: due.total, period });
    const color = this.color({ spent, limit, due: due.total, pace });
    const m     = (v) => this.#money(v, currency);
    const pct   = (v) => (limit > 0 ? Math.min(100, (100 * v) / limit) : 0);
    const usedPct  = limit === 0 ? 0 : Math.min(100, Math.round((100 * spent) / limit));
    const spentW   = pct(spent);
    const dueW     = Math.min(100 - spentW, pct(due.total));
    const marker   = pace.markerPct;

    return `
      <div class="flex items-baseline justify-between">
        <div class="${large ? 'text-2xl' : 'text-lg'} font-semibold">${m(spent)}</div>
        <div class="text-sm text-zinc-500">/ ${m(limit)}${rollover ? ` <span class="text-emerald-600">(+${m(rollover)})</span>` : ''}</div>
      </div>
      <div class="progress budget-bar mt-2" style="position:relative;display:flex">
        <div style="width:${spentW}%; background:${color}; border-radius:0"></div>
        ${dueW > 0 ? `<div class="budget-due" style="width:${dueW}%; background:${color}; opacity:.35; border-radius:0" title="Still to come"></div>` : ''}
        ${marker !== null ? `<span class="budget-pace-mark" title="Where you'd be if you spent evenly" style="position:absolute;top:-2px;bottom:-2px;left:calc(${marker}% - 1px);width:2px;background:currentColor;opacity:.55;border-radius:1px"></span>` : ''}
      </div>
      <div class="flex items-center justify-between mt-2 text-xs">
        <span class="text-zinc-500">${this.#timeLine(period, usedPct)}</span>
        <span class="${spent >= limit ? 'text-rose-500' : 'text-emerald-500'}">
          ${spent >= limit ? `Over by ${m(spent - limit)}` : `${m(limit - spent)} left`}
        </span>
      </div>
      ${due.total > 0 ? this.#dueLine(due, m, large) : ''}
      ${this.#paceLine(pace, period, m)}`;
  }

  /** Red once over; amber when close, when bills will take it over, or when spending runs ahead. */
  color({ spent, limit, due = 0, pace = null }) {
    if (limit > 0 && spent >= limit) return BudgetMeter.RED;
    const used = limit > 0 ? spent / limit : 0;
    if (used >= 0.8 || (limit > 0 && spent + due > limit) || pace?.state === 'ahead') return BudgetMeter.AMBER;
    return BudgetMeter.GREEN;
  }

  // ── Private ─────────────────────────────────────────────────────────

  #timeLine(period, usedPct) {
    if (period.status === 'upcoming') return `Starts ${BudgetPeriod.shortDate(period.from)}`;
    if (period.status === 'ended')    return `${usedPct}% used · ended ${BudgetPeriod.shortDate(period.to)}`;
    const left = period.daysAfterToday;
    const word = period.kind === 'hijri' ? 'Hijri day' : 'day';
    return `${usedPct}% used · ${left} ${word}${left === 1 ? '' : 's'} left`;
  }

  #dueLine(due, m, large) {
    const bills = due.items.filter((i) => i.kind === 'bill').length;
    const deliveries = due.items.length - bills;
    const what = [bills ? `${bills} bill${bills === 1 ? '' : 's'}` : '', deliveries ? `${deliveries === 1 ? 'a delivery' : `${deliveries} deliveries`}` : '']
      .filter(Boolean).join(' and ');
    const list = large ? `
      <div class="mt-1.5 space-y-1">
        ${due.items.map((i) => `
          <div class="flex items-center justify-between text-xs text-zinc-500">
            <span class="truncate">${this.#esc(i.name)}${i.kind === 'bill' ? ` · ${BudgetPeriod.shortDate(i.date)}` : ' · owed and coming'}</span>
            <span class="flex-shrink-0">${m(i.amount)}</span>
          </div>`).join('')}
      </div>` : '';
    return `
      <div class="budget-due-line mt-1.5 text-xs text-zinc-500 flex items-center gap-1.5">
        <span class="inline-block w-2.5 h-2 rounded-sm flex-shrink-0" style="background:currentColor;opacity:.35"></span>
        <span>${m(due.total)} still to come (${what})</span>
      </div>${list}`;
  }

  #paceLine(pace, period, m) {
    if (!pace.applies) return '';
    const days = period.remaining;
    const daily = days > 0 && pace.perDay > 0
      ? ` · about ${m(pace.perDay)} a day for ${days === 1 ? 'today' : `${days} days`}` : '';
    switch (pace.state) {
      case 'over':
        // Already over: the line above says by how much.
        return pace.overLimit ? '' : `<div class="budget-pace mt-1 text-xs text-rose-500">What's still to come takes it ${m(-pace.free)} over the limit</div>`;
      case 'ahead':
        return `<div class="budget-pace mt-1 text-xs text-amber-600">Spending faster than planned by ${m(pace.ahead)}${daily}</div>`;
      case 'behind':
        return `<div class="budget-pace mt-1 text-xs text-emerald-600">${m(-pace.ahead)} below plan so far${daily}</div>`;
      default:
        return `<div class="budget-pace mt-1 text-xs text-zinc-500">On track${daily}</div>`;
    }
  }
}
