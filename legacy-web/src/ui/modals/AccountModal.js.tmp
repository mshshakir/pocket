/**
 * AccountModal — New / edit account form.
 * Handles balance adjustments, account groups (including inline group creation),
 * and archive toggling.
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { CURRENCIES, ACCOUNT_TYPES } from '../../data/constants.js';

export class AccountModal {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
  }

  render(opts = {}) {
    const { id } = opts;
    const state   = this.#store.getState();
    const editing = id ? state.accounts.find((a) => a.id === id) : null;
    const a       = editing || {
      name: '', type: 'bank',
      currency: state.user.defaultCurrency || state.user.homeCurrency,
      balance: 0, color: '#0ea5e9', icon: 'landmark', archived: false,
    };
    const balanceDisplay = editing ? this.#fx.fromMinor(a.balance, a.currency) : 0;
    const groups = state.accountGroups || [];

    return `
      <form onsubmit="window.__app.submitAccount(event,'${editing?.id || ''}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? 'Edit account' : 'New account'}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Name</label>
          <input class="input" name="name" required value="${this.#esc(a.name)}" autofocus>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Type</label>
            <select class="select" name="type">
              ${ACCOUNT_TYPES.map((t) => `<option value="${t.id}" ${a.type===t.id?'selected':''}>${t.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Currency</label>
            <select class="select" name="currency">
              ${CURRENCIES.map((c) => `<option value="${c}" ${a.currency===c?'selected':''}>${this.#fx.label(c)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-1">
          <div>
            <label class="text-xs text-zinc-500">${editing ? 'Current balance' : 'Starting balance'}</label>
            <input class="input" name="balance" type="number" step="0.01" value="${balanceDisplay}">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Colour</label>
            <input class="input h-10 p-1" type="color" name="color" value="${a.color}">
          </div>
        </div>
        <div class="text-xs text-zinc-400 mb-3">
          <i data-lucide="info" style="width:11px;height:11px;display:inline"></i>
          ${editing
            ? 'Changing the balance writes a <b>Balance adjustment</b> transaction. Delete that entry to restore the previous balance.'
            : 'A non-zero starting balance is recorded as an <b>Opening balance</b> transaction in the ledger.'}
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Group</label>
          <select class="select" name="groupId" id="accGroupSelect"
                  onchange="window.__app.onAccGroupChange(this)">
            <option value="" ${!a.groupId?'selected':''}>(None)</option>
            ${groups.map((g) => `<option value="${g.id}" ${a.groupId===g.id?'selected':''}>${this.#esc(g.name)}</option>`).join('')}
            <option value="__new__">+ New group…</option>
          </select>
          <input class="input mt-2 hidden" name="newGroupName" id="accNewGroupName"
                 placeholder="New group name (e.g. Personal, Family, Business)">
        </div>

        <div class="flex items-center gap-2 mb-4">
          <input type="checkbox" name="archived" id="archChk" ${a.archived?'checked':''}>
          <label for="archChk" class="text-sm">Archived</label>
        </div>

        <div class="flex items-center gap-2">
          ${editing ? `<button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.deleteAccount('${editing.id}')"><i data-lucide="trash-2"></i> Delete</button>` : ''}
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
