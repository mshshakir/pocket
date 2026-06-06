/**
 * BudgetsView — Monthly budget tracking cards.
 * Supports both Gregorian-month and Hijri-month periods.
 */
import { BaseView }          from './BaseView.js';
import { BudgetService }     from '../../domain/services/BudgetService.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';
import { DateService }          from '../../domain/services/DateService.js';

export class BudgetsView extends BaseView {
  /** @type {BudgetService} */         #budgets;
  /** @type {HijriCalendarService} */  #hijri;

  constructor() {
    super();
    this.#budgets = new BudgetService();
    this.#hijri   = new HijriCalendarService();
  }

  render() {
    const state    = this.state;
    const todayIso = DateService.todayIso();
    const todayH   = this.#hijri.toHijri(todayIso);
    const now      = new Date();
    const eom      = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    return `
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Budgets</h1>
          <div class="text-xs text-zinc-500 mt-0.5">Gregorian-month or Hijri-month tracking</div>
        </div>
        <button class="btn btn-primary" onclick="window.__app.openModal('budget')">
          <i data-lucide="plus"></i> New budget
        </button>
      </div>

      ${state.budgets.length === 0
        ? `<div class="card p-10 text-center">${this.emptyState('No budgets yet', 'Set a monthly limit per category to stay on track.')}</div>`
        : `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${state.budgets.map((b) => this.#budgetCard(b, todayH, now, eom)).join('')}
          </div>`}
    `;
  }

  // ── Private ───────────────────────────────────────────────────────────

  #budgetCard(b, todayH, now, eom) {
    const targetIds = this.#budgets.targetCategoryIds(b);
    const cats      = targetIds.map((id) => this.state.categories.find((c) => c.id === id)).filter(Boolean);
    const firstCat  = cats[0];
    const isHijri  = b.period === 'hijri';
    const spent    = this.#budgets.currentSpend(b);
    const eff      = this.#budgets.effectiveLimit(b);
    const limit    = eff.limit;
    const pct      = limit === 0 ? 0 : Math.min(100, Math.round(100 * spent / limit));
    const color    = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#10b981';
    const daysLeft = isHijri
      ? (this.#hijri.daysInMonth(todayH.year, todayH.month) - todayH.day)
      : (eom.getDate() - now.getDate());
    const multi    = targetIds.length > 1;
    const hasSubs  = !multi && this.state.categories.some((c) => c.parentId === firstCat?.id);
    const title    = cats.length ? cats.map((c) => this.escapeHtml(c.name)).join(', ') : 'Category';
    const split    = multi ? this.#budgets.spendByCategory(b) : [];
    const periodLabel = isHijri
      ? `<span class="inline-flex items-center gap-1"><i data-lucide="moon-star" style="width:11px;height:11px"></i> ${this.#hijri.monthsShort[todayH.month]} ${todayH.year} H</span>`
      : `<span class="inline-flex items-center gap-1"><i data-lucide="calendar" style="width:11px;height:11px"></i> ${now.toLocaleDateString(undefined, {month:'long'})}</span>`;

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
              <button class="btn btn-ghost flex-shrink-0" onclick="event.stopPropagation(); window.__app.openModal('budget',{id:'${b.id}'})" title="Edit budget">
                <i data-lucide="pencil"></i>
              </button>
            </div>
            <div class="text-xs text-zinc-500">${periodLabel}${b.rollover ? ' · rollover on' : ''}</div>
          </div>
        </div>
        <div class="mt-4">
          <div class="flex items-baseline justify-between">
            <div class="text-lg font-semibold">${this.formatMoney(spent, b.currency)}</div>
            <div class="text-sm text-zinc-500">/ ${this.formatMoney(limit, b.currency)}${eff.rollover ? ` <span class="text-emerald-600">(+${this.formatMoney(eff.rollover, b.currency)})</span>` : ''}</div>
          </div>
          <div class="progress mt-2"><div style="width:${pct}%; background:${color}"></div></div>
          <div class="flex items-center justify-between mt-2 text-xs">
            <span class="text-zinc-500">${pct}% used · ${Math.max(0, daysLeft)} ${isHijri ? 'Hijri ' : ''}day${daysLeft === 1 ? '' : 's'} left</span>
            <span class="${spent >= limit ? 'text-rose-500' : 'text-emerald-500'}">
              ${spent >= limit
                ? `Over by ${this.formatMoney(spent - limit, b.currency)}`
                : `${this.formatMoney(limit - spent, b.currency)} left`}
            </span>
          </div>
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
