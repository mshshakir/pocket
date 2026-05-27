/**
 * RegularItemModal — Create / edit a regular-purchase item.
 *
 * A "regular item" is a named recurring purchase (e.g. "Morning coffee")
 * that the user can quick-log from the Calendar view. Each log creates a
 * real transaction linked to the item via regularItemId.
 *
 * Fields: name, defaultAmount, currency, accountId, categoryId, icon, color
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { CURRENCIES }      from '../../data/constants.js';

const ITEM_ICONS = [
  'coffee','shopping-basket','bus','dumbbell','utensils','heart-pulse',
  'book','music','film','gift','paw-print','baby','graduation-cap',
  'wifi','phone','home','car','plane','tag',
];

const ITEM_COLORS = [
  '#f97316','#3b82f6','#10b981','#8b5cf6','#ec4899',
  '#ef4444','#f59e0b','#06b6d4','#84cc16','#6366f1',
];

export class RegularItemModal {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
  }

  render(opts = {}) {
    const { id } = opts;
    const state   = this.#store.getState();
    const editing = id ? (state.regularItems || []).find((i) => i.id === id) : null;

    const home = state.user.homeCurrency || 'USD';
    const data  = editing ? { ...editing } : {
      name:          '',
      defaultAmount: 0,
      currency:      home,
      accountId:     state.accounts[0]?.id || '',
      categoryId:    '',
      icon:          'coffee',
      color:         ITEM_COLORS[0],
    };

    const amountVal = editing
      ? this.#fx.fromMinor(editing.defaultAmount, editing.currency)
      : 0;

    const expenseCats = state.categories.filter((c) => c.type === 'expense' || !c.type);

    return `
      <form id="regularItemForm"
            onsubmit="window.__app.submitRegularItem(event,'${editing?.id || ''}')"
            class="p-5" style="min-width:320px;max-width:480px">

        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? 'Edit item' : 'New regular item'}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <!-- Name -->
        <div class="mb-3">
          <label class="text-xs text-zinc-500">Name</label>
          <input class="input" name="name" required placeholder="e.g. Morning coffee"
                 value="${this.#esc(data.name)}" autofocus>
        </div>

        <!-- Amount + Currency -->
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Default amount</label>
            <input class="input" name="defaultAmount" type="number" step="0.01" min="0"
                   placeholder="0.00" value="${amountVal || ''}">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Currency</label>
            <select class="select" name="currency">
              ${CURRENCIES.map((c) => `<option value="${c}" ${data.currency === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Account -->
        <div class="mb-3">
          <label class="text-xs text-zinc-500">Default account</label>
          <select class="select" name="accountId">
            <option value="">— None —</option>
            ${state.accounts.map((a) => `<option value="${a.id}" ${data.accountId === a.id ? 'selected' : ''}>${this.#esc(a.name)}</option>`).join('')}
          </select>
        </div>

        <!-- Category -->
        <div class="mb-4">
          <label class="text-xs text-zinc-500">Default category</label>
          <select class="select" name="categoryId">
            <option value="">— Uncategorised —</option>
            ${expenseCats.map((c) => `<option value="${c.id}" ${data.categoryId === c.id ? 'selected' : ''}>${this.#esc(c.name)}</option>`).join('')}
          </select>
        </div>

        <!-- Icon -->
        <div class="mb-3">
          <label class="text-xs text-zinc-500 block mb-1">Icon</label>
          <div class="flex flex-wrap gap-2">
            ${ITEM_ICONS.map((ic) => `
              <label class="cursor-pointer">
                <input type="radio" name="icon" value="${ic}" class="sr-only" ${data.icon === ic ? 'checked' : ''}>
                <div class="w-9 h-9 rounded-xl grid place-items-center border-2 transition-colors
                            ${data.icon === ic ? 'border-zinc-900 dark:border-white bg-zinc-100 dark:bg-zinc-800' : 'border-transparent hover:border-zinc-300'}">
                  <i data-lucide="${ic}" style="width:16px;height:16px"></i>
                </div>
              </label>`).join('')}
          </div>
        </div>

        <!-- Color -->
        <div class="mb-5">
          <label class="text-xs text-zinc-500 block mb-1">Color</label>
          <div class="flex flex-wrap gap-2">
            ${ITEM_COLORS.map((col) => `
              <label class="cursor-pointer">
                <input type="radio" name="color" value="${col}" class="sr-only" ${data.color === col ? 'checked' : ''}>
                <div class="w-7 h-7 rounded-full border-2 transition-colors
                            ${data.color === col ? 'border-zinc-900 dark:border-white' : 'border-transparent'}"
                     style="background:${col}"></div>
              </label>`).join('')}
          </div>
        </div>

        <div class="flex items-center gap-2">
          ${editing ? `
            <button type="button" class="btn btn-outline text-rose-500"
                    onclick="window.__app.deleteRegularItem('${editing.id}')">
              <i data-lucide="trash-2"></i> Delete
            </button>` : ''}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i data-lucide="check"></i> Save
          </button>
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
