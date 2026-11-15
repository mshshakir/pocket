/**
 * ReimbursementModal — one payer's (or one claim's) expenses waiting to be
 * paid back, and the Paid back form.
 *
 *   • tick the items the money is for
 *   • amount received, the account it went into, the date
 *   • how to share it: Spread evenly (default) · Oldest first · Per item
 *   • "The rest won't be paid back" — closes what's left in the same save
 *     (one switch for the batch, or one per item with Per item)
 *   • paid more than owed → count the extra as income, or keep it as credit
 *
 * "Won't be paid back" closes the ticked items with no money in, and
 * "Use credit" applies credit kept from an earlier over-payment.
 *
 * opts: { key: string }  a ReimbursementService group key
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { ReimbursementService } from '../../domain/services/ReimbursementService.js';
import { DateService }     from '../../domain/services/DateService.js';
import { DeliveryPlan }    from '../../domain/services/DeliveryPlan.js';
import { Html }            from '../../core/Html.js';

export class ReimbursementModal {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
  }

  render(opts = {}) {
    const state = this.#store.getState();
    const svc = new ReimbursementService(state);
    const g = svc.group(opts.key);
    const close = `<button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()" aria-label="Close"><i data-lucide="x"></i></button>`;
    if (!g) {
      return `<div class="p-5"><div class="flex items-center justify-between mb-3"><h3 class="text-lg font-semibold">Reimbursements</h3>${close}</div>
        <p class="text-sm text-zinc-500">Nothing left to get back here.</p></div>`;
    }
    const cur = g.currency;
    const step = CurrencyService.stepFor(cur);
    const accounts = state.accounts.filter((a) => !a.archived && a.type !== 'invest');
    const defAcc = accounts.find((a) => a.currency === cur && a.id === state.user.defaultAccountId)
      || accounts.find((a) => a.currency === cur) || accounts[0];
    const cats = new Map((state.categories || []).map((c) => [c.id, c]));
    const key = Html.js(g.key);

    const item = (r) => {
      const t = r.tx;
      const cat = cats.get(t.categoryId);
      const title = t.payee || cat?.name || 'Expense';
      const back = r.paid > 0
        ? `${this.#fx.formatMoney(r.paid, t.currency)} of ${this.#fx.formatMoney(r.expected, t.currency)} back · ${r.pct}%`
        : `${this.#fx.formatMoney(r.expected, t.currency)} to get back`;
      return `
        <div class="reimb-item p-3" data-tx="${Html.escape(t.id)}" data-owed="${r.outstanding}" data-currency="${Html.escape(t.currency)}">
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" name="pick" value="${Html.escape(t.id)}" checked class="mt-1"
                   onchange="window.__app.updatePaybackPreview(this.form)">
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-medium truncate">${Html.escape(title)}${cat && t.payee ? ` <span class="text-zinc-400 font-normal">· ${Html.escape(cat.name)}</span>` : ''}</span>
              <span class="block text-xs text-zinc-500">${DeliveryPlan.shortDate(t.date)} · spent ${this.#fx.formatMoney(t.amount, t.currency)} · ${back}</span>
            </span>
            <span class="text-sm font-semibold whitespace-nowrap">${this.#fx.formatMoney(r.outstanding, t.currency)}</span>
          </label>
          <div data-per-item style="display:none" class="mt-2 pl-7 flex items-center gap-2 flex-wrap">
            <input class="input" style="width:8.5rem" type="number" min="0" step="${CurrencyService.stepFor(t.currency)}" inputmode="decimal"
                   name="part_${Html.escape(t.id)}" placeholder="Paid back"
                   oninput="window.__app.updatePaybackPreview(this.form)">
            <label class="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
              <input type="checkbox" name="close_${Html.escape(t.id)}"> The rest won't be paid back
            </label>
          </div>
          <div class="reimb-share text-xs text-emerald-600 mt-1 pl-7"></div>
        </div>`;
    };

    const mode = (k, label) => `
      <label class="cursor-pointer">
        <input type="radio" name="mode" value="${k}" ${k === 'spread' ? 'checked' : ''} class="peer sr-only"
               onchange="window.__app.updatePaybackPreview(this.form)">
        <span class="btn btn-outline w-full justify-center text-sm peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900">${label}</span>
      </label>`;

    const credit = g.credit > 0 ? `
        <div class="card-muted p-3 mb-3 flex items-center gap-2 text-sm">
          <i data-lucide="wallet" style="width:15px;height:15px"></i>
          <span class="flex-1">${this.#fx.formatMoney(g.credit, cur)} credit from ${Html.escape(g.payer)} (paid extra before)</span>
          <button type="button" class="btn btn-outline btn-sm" onclick="window.__app.useReimbCredit('${key}', this.form)">Use credit</button>
        </div>` : '';

    return `
      <form onsubmit="window.__app.submitPayback(event,'${key}')" class="p-5 reimb-form" data-currency="${Html.escape(cur)}">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-lg font-semibold">${Html.escape(g.label)}</h3>${close}
        </div>
        <div class="text-xs text-zinc-500 mb-3">${g.claim ? `${Html.escape(g.payer)}${g.claim.ref ? ` · ref ${Html.escape(g.claim.ref)}` : ''} · ` : ''}${this.#fx.formatMoney(g.outstanding, cur)} to get back · ${g.items.length} item${g.items.length === 1 ? '' : 's'}</div>
        ${credit}
        <div class="card divide-y divide-zinc-100 dark:divide-zinc-800 mb-4">${g.items.map(item).join('')}</div>

        <div class="text-sm font-medium mb-2">Paid back</div>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Amount received</label>
            <input class="input" name="amount" type="number" min="0" step="${step}" inputmode="decimal"
                   oninput="window.__app.updatePaybackPreview(this.form)" placeholder="0">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Date</label>
            <input class="input" type="date" name="date" value="${DateService.todayIso()}">
          </div>
        </div>
        <div class="mb-3">
          <label class="text-xs text-zinc-500">Money went into</label>
          <select class="select" name="accountId" onchange="window.__app.updatePaybackPreview(this.form)">
            ${accounts.map((a) => `<option value="${Html.escape(a.id)}" data-currency="${Html.escape(a.currency)}" ${a.id === defAcc?.id ? 'selected' : ''}>${Html.escape(a.name)} · ${Html.escape(a.currency)}</option>`).join('')}
          </select>
        </div>

        <div class="text-xs text-zinc-500 mb-1">Share it across the ticked items</div>
        <div class="grid grid-cols-3 gap-2 mb-3">${mode('spread', 'Spread evenly')}${mode('oldest', 'Oldest first')}${mode('items', 'Per item')}</div>

        <label data-batch-close class="flex items-center gap-2 text-sm mb-3 cursor-pointer">
          <input type="checkbox" name="closeRest"> The rest won't be paid back
        </label>

        <div data-extra style="display:none" class="card-muted p-3 mb-3 text-sm">
          <div class="mb-2 reimb-extra-text"></div>
          <label class="flex items-center gap-2 mb-1 cursor-pointer"><input type="radio" name="extraAs" value="keep" checked> Keep it for their next item</label>
          <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="extraAs" value="income"> Count it as income</label>
        </div>

        <div class="reimb-preview text-xs text-zinc-500 mb-4">Money paid back adds to your account but isn't income. The expense keeps its full amount; your spending counts only what wasn't paid back.</div>

        <div class="flex items-center gap-2 flex-wrap">
          <button type="button" class="btn btn-outline" onclick="window.__app.waiveReimbursement('${key}', this.form)" title="Nothing will come for the ticked items">Won't be paid back</button>
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Paid back</button>
        </div>
      </form>`;
  }

  onOpen() {
    setTimeout(() => window.__app?.updatePaybackPreview?.(document.querySelector('.reimb-form')), 0);
  }
}
