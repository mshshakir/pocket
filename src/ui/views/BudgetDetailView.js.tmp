/**
 * BudgetDetailView — Drill-in for a single budget.
 *
 * Shows the budget header (target categories, period, progress), an optional
 * per-category split when the budget spans more than one category, and the list
 * of transactions counting toward it this period.
 *
 * All spend/aggregation is delegated to BudgetService — this view only renders.
 */
import { BaseView }               from './BaseView.js';
import { BudgetService }          from '../../domain/services/BudgetService.js';
import { HijriCalendarService }   from '../../domain/services/HijriCalendarService.js';
import { TransactionRowRenderer } from './TransactionRowRenderer.js';

export class BudgetDetailView extends BaseView {
  /** @type {BudgetService} */          #budgets;
  /** @type {HijriCalendarService} */   #hijri;
  /** @type {TransactionRowRenderer} */ #rowRenderer;
  /** @type {string|null} */            #budgetId = null;

  constructor() {
    super();
    this.#budgets     = new BudgetService();
    this.#hijri       = new HijriCalendarService();
    this.#rowRenderer = new TransactionRowRenderer();
  }

  setBudget(id) { this.#budgetId = id; }
  get budgetId() { return this.#budgetId; }

  render() {
    if (!this.#budgetId) return '';
    const state = this.state;
    const b     = state.budgets.find((x) => x.id === this.#budgetId);
    if (!b) return `<div class="p-6 text-zinc-400">Budget not found.</div>`;

    const targetIds = this.#budgets.targetCategoryIds(b);
    const cats      = targetIds.map((id) => state.categories.find((c) => c.id === id)).filter(Boolean);
    const spent     = this.#budgets.currentSpend(b);
    const eff       = this.#budgets.effectiveLimit(b);
    const limit     = eff.limit;
    const pct       = limit === 0 ? 0 : Math.min(100, Math.round(100 * spent / limit));
    const color     = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#10b981';
    const split     = this.#budgets.spendByCategory(b);
    const txs       = this.#budgets.periodTransactions(b);

    const isHijri   = b.period === 'hijri';
    const now       = new Date();
    const todayH    = this.#hijri.toHijri(now);
    const periodLabel = isHijri
      ? `${this.#hijri.monthsLong[todayH.month]} ${todayH.year} H`
      : now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const title      = cats.length ? cats.map((c) => c.name).join(', ') : 'Budget';
    const firstColor = cats[0]?.color || '#10b981';
    const firstIcon  = cats[0]?.icon  || 'target';

    const dayGroups = {};
    txs.forEach((t) => { (dayGroups[t.date] = dayGroups[t.date] || []).push(t); });

    return `
      <div class="flex items-center gap-2 mb-4">
        <button class="btn btn-ghost" onclick="window.__app.navigate('budgets')" title="Back to Budgets">
          <i data-lucide="arrow-left"></i><span class="hidden md:inline ml-1">Budgets</span>
        </button>
        <div class="flex-1"></div>
        <button class="btn btn-outline" onclick="window.__app.openModal('budget',{id:'${b.id}'})">
          <i data-lucide="pencil"></i><span class="hidden md:inline ml-1">Edit</span>
        </button>
      </div>

      <div class="card p-5 mb-4">
        <div class="flex items-start gap-3">
          <div class="icon-pill" style="background:${firstColor}22;color:${firstColor};width:44px;height:44px">
            <i data-lucide="${firstIcon}" style="width:22px;height:22px"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xl font-semibold">${this.escapeHtml(title)}</div>
            <div class="text-xs text-zinc-500">
              <i data-lucide="${isHijri ? 'moon-star' : 'calendar'}" style="width:11px;height:11px;display:inline"></i>
              ${periodLabel}${b.rollover ? ' · rollover on' : ''}
            </div>
          </div>
        </div>

        <div class="mt-4">
          <div class="flex items-baseline justify-between">
            <div class="text-2xl font-semibold">${this.formatMoney(spent, b.currency)}</div>
            <div class="text-sm text-zinc-500">/ ${this.formatMoney(limit, b.currency)}${eff.rollover ? ` <span class="text-emerald-600">(+${this.formatMoney(eff.rollover, b.currency)})</span>` : ''}</div>
          </div>
          <div class="progress mt-2"><div style="width:${pct}%; background:${color}"></div></div>
          <div class="flex items-center justify-between mt-2 text-xs">
            <span class="text-zinc-500">${pct}% used</span>
            <span class="${spent >= limit ? 'text-rose-500' : 'text-emerald-500'}">
              ${spent >= limit
                ? `Over by ${this.formatMoney(spent - limit, b.currency)}`
                : `${this.formatMoney(limit - spent, b.currency)} left`}
            </span>
          </div>
        </div>

        ${split.length > 1 ? `
          <div class="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-1.5">
            <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1">By category</div>
            ${split.map((s) => `
              <div class="flex items-center justify-between text-sm">
                <span class="flex items-center gap-2 min-w-0">
                  <span class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${s.color}"></span>
                  <span class="truncate">${this.escapeHtml(s.name)}</span>
                </span>
                <span class="text-zinc-500 flex-shrink-0">${this.formatMoney(s.spend, b.currency)}</span>
              </div>`).join('')}
          </div>` : ''}
      </div>

      <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2 px-1">
        ${txs.length} transaction${txs.length === 1 ? '' : 's'} this period
      </div>
      ${txs.length === 0
        ? `<div class="card p-10 text-center">${this.emptyState('No spending yet', 'No transactions have counted toward this budget this period.')}</div>`
        : Object.keys(dayGroups).map((date) => `
            <div class="mb-2">
              <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1 px-1">${this.dateLabel(date)}</div>
              <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
                ${dayGroups[date].map((t) => this.#rowRenderer.render(t, { multiSelect: false, selectedIds: new Set() })).join('')}
              </div>
            </div>`).join('')}
    `;
  }
}
