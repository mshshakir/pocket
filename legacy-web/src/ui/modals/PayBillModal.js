/**
 * PayBillModal — record a due bill (a recurring entry marked "ask me") as paid:
 * the amount actually paid (last time's to start), from which account, on
 * which day. Or skip it this time.
 *
 * opts: { templateId: string, date: 'YYYY-MM-DD' }  (date = the occurrence)
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { DateService }     from '../../domain/services/DateService.js';
import { Html }            from '../../core/Html.js';

export class PayBillModal {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;
  /** @type {() => import('../../domain/services/BillService.js').BillService} */ #bills;

  constructor({ bills }) {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
    this.#bills = bills;
  }

  /** "3 Nov 2026". */
  static shortDate(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] || ''} ${y}`;
  }

  render(opts = {}) {
    const state = this.#store.getState();
    const t = (state.transactions || []).find((x) => x.id === opts.templateId);
    if (!t) return '<div class="p-5 text-sm text-zinc-500">Bill not found.</div>';
    const last = this.#bills().lastAmount(t);
    const id = Html.escape(t.id), date = Html.escape(opts.date);
    const name = t.payee || t.description || 'Bill';
    const accounts = (state.accounts || []).filter((a) => !a.archived)
      .map((a) => `<option value="${Html.escape(a.id)}" ${a.id === t.accountId ? 'selected' : ''}>${Html.escape(a.name)}</option>`).join('');
    return `
      <form class="p-5" style="min-width:300px;max-width:420px" onsubmit="window.__app.submitBill(event,'${id}','${date}')">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-lg font-semibold">${Html.escape(name)}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>
        <div class="text-xs text-zinc-500 mb-4">Due ${Html.escape(PayBillModal.shortDate(opts.date))} · last time ${this.#fx.formatMoney(last, t.currency)}</div>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Amount paid (${Html.escape(t.currency)})</label>
            <input class="input" type="number" name="amount" min="0" step="${CurrencyService.stepFor(t.currency)}" value="${this.#fx.fromMinor(last, t.currency)}" required autofocus>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Paid on</label>
            <input class="input" type="date" name="paidOn" value="${DateService.todayIso()}">
          </div>
        </div>
        <label class="text-xs text-zinc-500">From</label>
        <select class="select mb-4" name="accountId">${accounts}</select>
        <div class="flex gap-2">
          <button type="button" class="btn btn-outline" onclick="window.__app.skipBill('${id}','${date}')">Skip this time</button>
          <div class="flex-1"></div>
          <button class="btn btn-primary" type="submit"><i data-lucide="check"></i> Paid</button>
        </div>
      </form>`;
  }
}
