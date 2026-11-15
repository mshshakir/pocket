/**
 * BudgetModal — New / edit budget form.
 * Periods: month, Hijri month, week, year, or set dates (no rollover there).
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { CURRENCIES }      from '../../data/constants.js';
import { CategoryField }    from '../components/CategoryField.js';
import { BudgetPeriod }     from '../../domain/services/BudgetPeriod.js';
import { DateService }      from '../../domain/services/DateService.js';

export class BudgetModal {
  static #PERIODS = Object.freeze([
    ['gregorian', 'calendar',       'Month'],
    ['hijri',     'moon-star',      'Hijri month'],
    ['week',      'calendar-days',  'Week'],
    ['year',      'calendar-range', 'Year'],
    ['range',     'calendar-clock', 'Set dates'],
  ]);

  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
  }

  render(opts = {}) {
    const { id } = opts;
    const state   = this.#store.getState();
    const editing = id ? state.budgets.find((b) => b.id === id) : null;
    const b       = editing || {
      categoryIds: [],
      amount:     0,
      currency:   state.user.defaultCurrency || state.user.homeCurrency,
      period:     'gregorian',
      rollover:   false,
    };
    const amount  = editing ? this.#fx.fromMinor(b.amount, b.currency) : 0;
    const kind    = BudgetPeriod.KINDS.includes(b.period) ? b.period : 'gregorian';
    const today   = DateService.todayIso();
    const start   = b.startDate || today;
    const end     = b.endDate || BudgetPeriod.addDays(today, 6);
    // Backward-compatible: a legacy budget may carry a single categoryId.
    const selectedIds = Array.isArray(b.categoryIds) && b.categoryIds.length
      ? b.categoryIds
      : (b.categoryId ? [b.categoryId] : []);

    return `
      <form onsubmit="window.__app.submitBudget(event,'${editing?.id || ''}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? 'Edit budget' : 'New budget'}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500 mb-1 block">Categories</label>
          ${CategoryField.render({
            id:          'budgetCategories',
            name:        'categoryIds',
            value:       selectedIds,
            mode:        'multi',
            type:        'expense',
            title:       'Budget categories',
            placeholder: '— Pick categories —',
            categories:  state.categories,
          })}
          <div class="text-xs text-zinc-500 mt-1">Pick "Whole group" on a parent to budget it including all sub-categories, or drill in and tick specific sub-categories — e.g. just two of them.</div>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500 mb-1 block">Period</label>
          <div class="grid grid-cols-3 gap-2" id="budgetPeriods"
               onchange="const k=this.querySelector('input[name=period]:checked')?.value; document.getElementById('budgetRange').classList.toggle('hidden', k!=='range'); document.getElementById('budgetRollover').classList.toggle('hidden', k==='range');">
            ${BudgetModal.#PERIODS.map(([value, icon, label]) => `
            <label class="cursor-pointer">
              <input type="radio" name="period" value="${value}" ${kind === value ? 'checked' : ''} class="peer sr-only">
              <div class="btn btn-outline justify-center peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900 peer-checked:border-transparent w-full text-sm">
                <i data-lucide="${icon}"></i> ${label}
              </div>
            </label>`).join('')}
          </div>
          <div class="text-xs text-zinc-500 mt-1">A week runs Monday to Sunday. Use set dates for a trip, a wedding or a few special days.</div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3 ${kind === 'range' ? '' : 'hidden'}" id="budgetRange">
          <div>
            <label class="text-xs text-zinc-500">From</label>
            <input class="input" name="startDate" type="date" value="${this.#esc(start)}">
          </div>
          <div>
            <label class="text-xs text-zinc-500">To</label>
            <input class="input" name="endDate" type="date" value="${this.#esc(end)}">
          </div>
        </div>

        <div id="budgetSuggest" class="text-xs text-zinc-500 -mt-1 mb-2 hidden"></div>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div class="flex items-center justify-between">
              <label class="text-xs text-zinc-500">Limit</label>
              <button type="button" class="text-xs text-emerald-600 underline underline-offset-2" onclick="window.__app.suggestBudgetLimit(this.form)">Suggest</button>
            </div>
            <input class="input" name="amount" type="number" step="${CurrencyService.stepFor(b.currency)}" required value="${amount}">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Currency</label>
            <select class="select" name="currency">
              ${CURRENCIES.map((c) => `<option value="${c}" ${b.currency===c?'selected':''}>${this.#fx.label(c)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="mb-4 ${kind === 'range' ? 'hidden' : ''}" id="budgetRollover">
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="rollover" ${b.rollover?'checked':''}
                   onchange="document.getElementById('budgetRolloverMore').classList.toggle('hidden', !this.checked)">
            <span>Roll over what's left to the next period</span>
          </label>
          <div class="text-xs text-zinc-500 mt-1">What you don't spend is added to the next month, week or year.</div>
          <div id="budgetRolloverMore" class="mt-2 pl-6 space-y-2 ${b.rollover ? '' : 'hidden'}">
            <label class="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" name="rolloverOverspend" class="mt-0.5" ${b.rolloverOverspend ? 'checked' : ''}>
              <span>Carry overspending too<span class="block text-xs text-zinc-500">If you go over, the extra is taken off the next period.</span></span>
            </label>
            <div>
              <label class="text-xs text-zinc-500">Carry over at most (optional)</label>
              <input class="input" name="rolloverCap" type="number" min="0" step="${CurrencyService.stepFor(b.currency)}"
                     placeholder="No limit" value="${b.rolloverCap ? this.#fx.fromMinor(b.rolloverCap, b.currency) : ''}">
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          ${editing ? `<button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.deleteBudget('${editing.id}')"><i data-lucide="trash-2"></i> Delete</button>` : ''}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
  }

  #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
