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
import { DateService }            from '../../domain/services/DateService.js';
import { BudgetMeter }            from '../components/BudgetMeter.js';
import { BudgetAdvisor }          from '../../domain/services/BudgetAdvisor.js';
import { TransactionRowRenderer } from './TransactionRowRenderer.js';

export class BudgetDetailView extends BaseView {
  /** @type {BudgetService} */          #budgets;
  /** @type {BudgetMeter} */            #meter;
  /** @type {BudgetAdvisor} */          #advisor;
  /** @type {TransactionRowRenderer} */ #rowRenderer;
  /** @type {string|null} */            #budgetId = null;

  constructor() {
    super();
    this.#budgets     = new BudgetService();
    this.#advisor     = new BudgetAdvisor(this.#budgets);
    this.#meter       = new BudgetMeter({ money: (v, c) => this.formatMoney(v, c), escape: (x) => this.escapeHtml(x) });
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
    const spent     = this.spendFor(b, () => this.#budgets.currentSpend(b));
    const eff       = this.#budgets.effectiveLimit(b);
    const split     = this.#budgets.spendByCategory(b);
    const txs       = this.#budgets.periodTransactions(b);
    const today     = DateService.todayIso();
    const period    = this.#budgets.period(b, today);
    const due       = this.dueFor(b, today);
    const periodLabel = period.kind === 'gregorian' ? `${period.label} ${period.from.slice(0, 4)}` : period.label;

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
              <i data-lucide="${period.icon}" style="width:11px;height:11px;display:inline"></i>
              ${this.escapeHtml(periodLabel)}${!b.rollover ? '' : b.rolloverOverspend ? ' · rollover on (incl. overspending)' : ' · rollover on'}
            </div>
          </div>
        </div>

        <div class="mt-4">
          ${this.#meter.render({ spent, limit: eff.limit, rollover: eff.rollover, currency: b.currency, period, due, large: true })}
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
        ${this.#byPerson(b)}
      </div>

      ${this.inGuestSpace ? '' : this.#history(b, today)}

      <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2 px-1">
        ${txs.length} transaction${txs.length === 1 ? '' : 's'} this period
      </div>
      ${this.inGuestSpace ? `
        <div class="text-[11px] text-zinc-500 mb-2 px-1">
          Only the rows on accounts shared with you are listed — the total above
          counts their spending on every account.
        </div>` : ''}
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

  // ── Private ───────────────────────────────────────────────────────────

  /** Who spent it, when more than one person entered spending this period. */
  #byPerson(b) {
    if (this.inGuestSpace) return '';
    const rows = this.#budgets.spendByPerson(b);
    if (rows.length < 2) return '';
    const me = (this.state._currentUserEmail || '').toLowerCase();
    const family = this.state.family || [];
    const name = (key) => {
      if (!key || key === me) return 'You';
      const f = family.find((x) => (x.email || '').toLowerCase() === key);
      return f?.name || key;
    };
    // Entries by the owner may or may not carry their email; show one "You".
    const merged = new Map();
    for (const r of rows) merged.set(name(r.key), (merged.get(name(r.key)) || 0) + r.spend);
    if (merged.size < 2) return '';
    return `
      <div class="budget-by-person mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-1.5">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1">By person</div>
        ${[...merged].sort((x, y) => y[1] - x[1]).map(([who, spend]) => `
          <div class="flex items-center justify-between text-sm">
            <span class="truncate">${this.escapeHtml(who)}</span>
            <span class="text-zinc-500 flex-shrink-0">${this.formatMoney(spend, b.currency)}</span>
          </div>`).join('')}
      </div>`;
  }

  /** The last six periods: spent against the limit, with a small bar each. */
  #history(b, today) {
    const rows = this.#advisor.history(b, 6, today);
    if (!rows.length || rows.every((r) => r.spent === 0)) return '';
    const avg = rows.reduce((s, r) => s + r.spent, 0) / rows.length;
    const over = rows.filter((r) => r.limit > 0 && r.spent > r.limit).length;
    return `
      <div class="card p-4 mb-4 budget-history">
        <div class="flex items-baseline justify-between mb-2">
          <div class="text-xs uppercase tracking-wider text-zinc-500">Before this</div>
          <div class="text-xs text-zinc-500">Average ${this.formatMoney(Math.round(avg), b.currency)}${over ? ` · over ${over} of ${rows.length}` : ''}</div>
        </div>
        <div class="space-y-2">
          ${rows.map((r) => {
            const pct = r.limit > 0 ? Math.min(100, Math.round((100 * r.spent) / r.limit)) : 0;
            const color = r.limit > 0 && r.spent > r.limit ? BudgetMeter.RED : pct >= 80 ? BudgetMeter.AMBER : BudgetMeter.GREEN;
            return `
            <div>
              <div class="flex items-center justify-between text-xs">
                <span class="text-zinc-600 dark:text-zinc-300">${this.escapeHtml(r.label)}</span>
                <span class="${r.spent > r.limit ? 'text-rose-500' : 'text-zinc-500'}">${this.formatMoney(r.spent, b.currency)} / ${this.formatMoney(r.limit, b.currency)}</span>
              </div>
              <div class="progress mt-1" style="height:4px"><div style="width:${pct}%; background:${color}"></div></div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }
}
