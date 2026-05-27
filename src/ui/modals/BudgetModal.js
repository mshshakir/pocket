/**
 * BudgetModal — New / edit budget form.
 * Supports Gregorian and Hijri monthly periods with rollover.
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { CURRENCIES }      from '../../data/constants.js';

export class BudgetModal {
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
      categoryId: state.categories.find((c) => c.type === 'expense')?.id,
      amount:     0,
      currency:   state.user.defaultCurrency || state.user.homeCurrency,
      period:     'gregorian',
      rollover:   false,
    };
    const amount  = editing ? this.#fx.fromMinor(b.amount, b.currency) : 0;
    const isHijri = b.period === 'hijri';

    return `
      <form onsubmit="window.__app.submitBudget(event,'${editing?.id || ''}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? 'Edit budget' : 'New budget'}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Category</label>
          <select class="select" name="categoryId">
            ${state.categories
              .filter((c) => c.type === 'expense')
              .map((c) => `<option value="${c.id}" ${b.categoryId===c.id?'selected':''}>${this.#esc(c.name)}</option>`)
              .join('')}
          </select>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500 mb-1 block">Period</label>
          <div class="grid grid-cols-2 gap-2">
            <label class="cursor-pointer">
              <input type="radio" name="period" value="gregorian" ${!isHijri?'checked':''} class="peer sr-only">
              <div class="btn btn-outline justify-center peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900 peer-checked:border-transparent w-full">
                <i data-lucide="calendar"></i> Gregorian month
              </div>
            </label>
            <label class="cursor-pointer">
              <input type="radio" name="period" value="hijri" ${isHijri?'checked':''} class="peer sr-only">
              <div class="btn btn-outline justify-center peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900 peer-checked:border-transparent w-full">
                <i data-lucide="moon-star"></i> Hijri month
              </div>
            </label>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Limit</label>
            <input class="input" name="amount" type="number" step="0.01" required value="${amount}">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Currency</label>
            <select class="select" name="currency">
              ${CURRENCIES.map((c) => `<option value="${c}" ${b.currency===c?'selected':''}>${this.#fx.label(c)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="mb-4">
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="rollover" ${b.rollover?'checked':''}>
            <span>Roll over unspent budget to next month</span>
          </label>
          <div class="text-xs text-zinc-500 mt-1">When enabled, any remaining amount carries forward as a bonus allowance.</div>
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
