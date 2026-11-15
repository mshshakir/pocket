/**
 * AccountModal — New / edit account form.
 * Handles balance adjustments, account groups (including inline group creation),
 * and archive toggling.
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { CURRENCIES, ACCOUNT_TYPES } from '../../data/constants.js';
import { AccountService } from '../../domain/services/AccountService.js';

/** Icons to choose from; each type's default is among them. */
const ACCOUNT_ICONS = ['wallet', 'landmark', 'credit-card', 'vault', 'trending-up', 'briefcase', 'smartphone', 'home', 'car', 'gift'];

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
    const icon = editing && a.icon ? a.icon : AccountService.typeIcon(a.type);
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
            <select class="select" name="type" onchange="window.__app.onAccountTypeChange(this)">
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
            <input class="input" name="balance" type="number" step="${CurrencyService.stepFor(a.currency)}" value="${balanceDisplay}">
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
          <label class="text-xs text-zinc-500">Icon</label>
          <div class="grid grid-cols-10 gap-1.5 mt-1 acc-icons">
            ${ACCOUNT_ICONS.map((ic) => `
              <label class="cursor-pointer">
                <input type="radio" name="icon" value="${ic}" ${icon === ic ? 'checked' : ''} class="peer sr-only">
                <span class="icon-pill bg-zinc-100 dark:bg-zinc-800 peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900" style="width:30px;height:30px">
                  <i data-lucide="${ic}" style="width:15px;height:15px"></i>
                </span>
              </label>`).join('')}
          </div>
        </div>

        <div id="accCardFields" class="card-muted p-3 mb-3" ${a.type === 'card' ? '' : 'style="display:none"'}>
          <div class="text-sm font-medium mb-2 flex items-center gap-1.5"><i data-lucide="credit-card" style="width:14px;height:14px"></i> Credit card</div>
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="text-xs text-zinc-500">Limit</label>
              <input class="input" name="creditLimit" type="number" min="0" step="${CurrencyService.stepFor(a.currency)}" value="${a.creditLimit ? this.#fx.fromMinor(a.creditLimit, a.currency) : ''}" placeholder="optional">
            </div>
            <div>
              <label class="text-xs text-zinc-500">Statement day</label>
              ${this.#daySelect('statementDay', a.statementDay)}
            </div>
            <div>
              <label class="text-xs text-zinc-500">Due day</label>
              ${this.#daySelect('dueDay', a.dueDay)}
            </div>
          </div>
          <div class="text-xs text-zinc-500 mt-2">The statement day is when the bank closes each bill; the due day is when it must be paid. Pocket works out each bill from your entries. For the balance, enter what you owe as a minus amount (e.g. −12000).</div>
        </div>

        <div id="accLowField" class="mb-3" ${a.type === 'card' ? 'style="display:none"' : ''}>
          <label class="text-xs text-zinc-500">Warn me when the balance drops below</label>
          <input class="input" name="lowBalance" type="number" min="0" step="${CurrencyService.stepFor(a.currency)}" value="${a.lowBalance ? this.#fx.fromMinor(a.lowBalance, a.currency) : ''}" placeholder="optional, e.g. 5000">
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

        <div class="mb-4 space-y-2">
          <label class="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="excludeFromTotals" class="mt-0.5" ${a.excludeFromTotals ? 'checked' : ''}>
            <span>Leave out of totals<span class="block text-xs text-zinc-500">For a business or investment account: kept out of your total balance, net worth and “You owe”. Its entries still show in reports.</span></span>
          </label>
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="archived" id="archChk" ${a.archived?'checked':''}>
            <span>Archived</span>
          </label>
        </div>

        <div class="flex items-center gap-2">
          ${editing ? `<button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.deleteAccount('${editing.id}')"><i data-lucide="trash-2"></i> Delete</button>` : ''}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
  }

  /** Day of month 1–31, or blank. */
  #daySelect(name, value) {
    const v = Number(value) || 0;
    return `<select class="select" name="${name}"><option value="">—</option>${
      Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${v === d ? 'selected' : ''}>${d}</option>`).join('')
    }</select>`;
  }

  #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
