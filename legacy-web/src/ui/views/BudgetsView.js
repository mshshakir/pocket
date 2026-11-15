/**
 * BudgetsView — budget cards: month, Hijri month, week, year or set dates.
 * Each card shows spent, bills still to come and the pace (BudgetMeter).
 */
import { BaseView }          from './BaseView.js';
import { BudgetService }     from '../../domain/services/BudgetService.js';
import { DateService }          from '../../domain/services/DateService.js';
import { BudgetMeter }          from '../components/BudgetMeter.js';

export class BudgetsView extends BaseView {
  /** @type {BudgetService} */         #budgets;
  /** @type {BudgetMeter} */           #meter;

  constructor() {
    super();
    this.#budgets = new BudgetService();
    this.#meter   = new BudgetMeter({ money: (v, c) => this.formatMoney(v, c), escape: (x) => this.escapeHtml(x) });
  }

  render() {
    const state    = this.state;
    const todayIso = DateService.todayIso();

    return `
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Budgets${this.helpButton('budgets')}</h1>${this.helpHint('budgets')}
          <div class="text-xs text-zinc-500 mt-0.5">${this.inGuestSpace
             ? `Shared with you · spend counted ${this.escapeHtml(this.space?.scopeNote ? 'across all their accounts' : '')}`
             : 'By month, Hijri month, week, year or set dates'}</div>
        </div>
        ${this.inGuestSpace ? '' : `
        <button class="btn btn-primary" onclick="window.__app.openModal('budget')">
          <i data-lucide="plus"></i> New budget
        </button>`}
      </div>

      ${state.budgets.length === 0
        ? `<div class="card p-10 text-center">${this.inGuestSpace
             ? this.emptyState('No budgets shared with you', 'They haven\u2019t shared any budgets from this space.')
             : this.emptyState('No budgets yet', 'Set a monthly limit per category to stay on track.')}</div>`
        : `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${state.budgets.map((b) => this.#budgetCard(b, todayIso)).join('')}
          </div>`}
    `;
  }

  // ── Private ───────────────────────────────────────────────────────────

  #budgetCard(b, todayIso) {
    const targetIds = this.#budgets.targetCategoryIds(b);
    const cats      = targetIds.map((id) => this.state.categories.find((c) => c.id === id)).filter(Boolean);
    const firstCat  = cats[0];
    const period   = this.#budgets.period(b, todayIso);
    const spent    = this.spendFor(b, () => this.#budgets.currentSpend(b));
    const eff      = this.#budgets.effectiveLimit(b);
    const due      = this.dueFor(b, todayIso);
    const multi    = targetIds.length > 1;
    const hasSubs  = !multi && this.state.categories.some((c) => c.parentId === firstCat?.id);
    const title    = cats.length ? cats.map((c) => this.escapeHtml(c.name)).join(', ') : 'Category';
    const split    = multi ? this.#budgets.spendByCategory(b) : [];
    const periodLabel = `<span class="inline-flex items-center gap-1"><i data-lucide="${period.icon}" style="width:11px;height:11px"></i> ${this.escapeHtml(period.label)}</span>`;

    return `
      <div class="card p-5 cursor-pointer hover:shadow-md transition-shadow" onclick="window.__app.openBudgetDetail('${b.id}')">
        <div class="flex items-start gap-3">
          <div class="icon-pill" style="background:${(firstCat?.color) || '#10b981'}22;color:${(firstCat?.color) || '#10b981'}">
            <i data-lucide="${firstCat?.icon || (multi ? 'layers' : 'circle')}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <div class="font-semibold flex items-center gap-2 min-w-0">
                <span class="truncate">${title}</span>
                ${multi
                  ? `<span class="chip flex-shrink-0" style="font-size:.65rem">${cats.length} categories</span>`
                  : (hasSubs ? '<span class="chip flex-shrink-0" style="font-size:.65rem">incl. sub-categories</span>' : '')}
              </div>
              ${this.inGuestSpace ? '' : `
              <button class="btn btn-ghost flex-shrink-0" onclick="event.stopPropagation(); window.__app.shareBudget('${this.jsArg(b.id)}')" title="Share this budget">
                <i data-lucide="users"></i>
              </button>
              <button class="btn btn-ghost flex-shrink-0" onclick="event.stopPropagation(); window.__app.openModal('budget',{id:'${this.jsArg(b.id)}'})" title="Edit budget">
                <i data-lucide="pencil"></i>
              </button>`}
            </div>
            <div class="text-xs text-zinc-500">${periodLabel}${b.rollover ? ' · rollover on' : ''}</div>
          </div>
        </div>
        <div class="mt-4">
          ${this.#meter.render({ spent, limit: eff.limit, rollover: eff.rollover, currency: b.currency, period, due })}
          ${multi ? `
            <div class="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-1">
              ${split.map((s) => `
                <div class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-1.5 min-w-0">
                    <span class="inline-block w-2 h-2 rounded-full flex-shrink-0" style="background:${s.color}"></span>
                    <span class="truncate">${this.escapeHtml(s.name)}</span>
                  </span>
                  <span class="text-zinc-500 flex-shrink-0">${this.formatMoney(s.spend, b.currency)}</span>
                </div>`).join('')}
            </div>` : ''}
        </div>
      </div>`;
  }
}
