/**
 * RegularItemModal — Create / edit a regular-purchase item.
 *
 * A "regular item" is a named recurring purchase (e.g. "Morning coffee")
 * that the user can quick-log from the Calendar view. Each log creates a
 * real transaction linked to the item via regularItemId.
 *
 * The default account may be one a family member has shared. That is stored as
 * accountId + sharedOwnerId (see AccountRef); logging such an item submits a
 * contribution to the OWNER's book instead of writing locally, so the default
 * category has to come from the owner's tree too.
 *
 * Fields: name, defaultAmount, currency, accountId, sharedOwnerId, categoryId,
 *         frequency, icon, color
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { CURRENCIES }      from '../../data/constants.js';
import { CategoryField }   from '../components/CategoryField.js';
import { AccountRef }      from '../../domain/services/AccountRef.js';

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
      sharedOwnerId: null,
      categoryId:    '',
      icon:          'coffee',
      color:         ITEM_COLORS[0],
    };

    const amountVal = editing
      ? this.#fx.fromMinor(editing.defaultAmount, editing.currency)
      : 0;

    // The <select> value encodes which book the account lives in, so submit can
    // tell a shared account apart from a local one with the same-shaped id.
    const accRef  = AccountRef.fromRecord(data);
    const accValue= accRef.toValue();

    // Shared accounts you can actually write to. A 'view' grant is read-only, so
    // offering it here would only produce a rejected contribution later.
    const shares  = (state._sharedData || []).filter((s) =>
      (s.accounts || []).some((a) => (s.permission || {})[a.id] !== 'view'));

    const sharedGroups = shares.map((share) => {
      const opts = (share.accounts || [])
        .filter((a) => (share.permission || {})[a.id] !== 'view')
        .map((a) => {
          const val = new AccountRef(a.id, share._ownerId).toValue();
          return `<option value="${this.#esc(val)}" ${accValue === val ? 'selected' : ''}>${this.#esc(a.name)}</option>`;
        }).join('');
      const who = share.sharedBy || 'Family';
      return opts ? `<optgroup label="Shared by ${this.#esc(who)}">${opts}</optgroup>` : '';
    }).join('');

    // A shared default account means the log lands in the owner's book, so the
    // default category must be one of THEIR categories — subcategories included.
    const ownerShare = accRef.isShared
      ? shares.find((s) => s._ownerId === accRef.ownerId)
      : null;
    const catList    = ownerShare ? (ownerShare.categories || []) : state.categories;

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
            <input class="input" name="defaultAmount" type="number" step="${CurrencyService.stepFor(data.currency)}" min="0"
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
          <select class="select" name="accountId"
                  onchange="window.__app.onRegularAccountChange(this.value)">
            <option value="">— None —</option>
            <optgroup label="My accounts">
              ${state.accounts.map((a) => `<option value="${this.#esc(a.id)}" ${accValue === a.id ? 'selected' : ''}>${this.#esc(a.name)}</option>`).join('')}
            </optgroup>
            ${sharedGroups}
          </select>
          <div class="text-[11px] text-zinc-500 mt-1" data-regular-shared-note
               style="${accRef.isShared ? '' : 'display:none'}">
            Entries logged from this item go to the owner's book for approval.
          </div>
        </div>

        <!-- Category -->
        <div class="mb-4">
          <label class="text-xs text-zinc-500">Default category</label>
          ${CategoryField.render({
            id:         'regularItemCategory',
            name:       'categoryId',
            value:      data.categoryId,
            type:       'expense',
            title:      accRef.isShared ? 'Choose a category from their book' : 'Default category',
            categories: catList,
            ownerId:    accRef.ownerId || '',
          })}
        </div>

        <!-- Frequency -->
        <div class="mb-4">
          <label class="text-xs text-zinc-500">Frequency</label>
          <select class="select" name="frequency">
            <option value="daily"   ${data.frequency === 'daily'   ? 'selected' : ''}>Daily</option>
            <option value="weekly"  ${data.frequency === 'weekly'  ? 'selected' : ''}>Weekly</option>
            <option value="monthly" ${(!data.frequency || data.frequency === 'monthly') ? 'selected' : ''}>Monthly</option>
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
