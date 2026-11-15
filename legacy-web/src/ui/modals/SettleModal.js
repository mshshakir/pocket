/**
 * SettleModal — pay a vendor for pay-later regular items.
 *
 * Shows what's owed per item up to a chosen day (default today), lets the
 * amount be changed (vendors round), and records one expense per item from the
 * chosen account, each marking the days it covers (see VendorDues). Also offers
 * the bill as text to send or check against the vendor's.
 *
 * opts: { vendor: string, upTo?: 'YYYY-MM-DD' }
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { DeliveryPlan }    from '../../domain/services/DeliveryPlan.js';
import { VendorDues }      from '../../domain/services/VendorDues.js';
import { AccountRef }      from '../../domain/services/AccountRef.js';
import { Html }            from '../../core/Html.js';

export class SettleModal {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;
  /** @type {() => VendorDues} */ #dues;

  /** @param {{dues: () => VendorDues}} deps */
  constructor({ dues }) {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
    this.#dues  = dues;
  }

  render(opts = {}) {
    const upTo  = DeliveryPlan.isIso(opts.upTo) ? opts.upTo : VendorDues.today();
    const group = this.#dues().byVendor(upTo).find((g) => g.vendor.toLowerCase() === String(opts.vendor || '').toLowerCase());
    const close = `<button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>`;
    if (!group) return `<div class="p-5"><div class="flex justify-between items-center"><b>Nothing to pay</b>${close}</div></div>`;

    const open  = group.lines.filter((l) => l.from && (l.lines.length || l.adjustments?.length) && l.amount > 0);
    const first = open[0]?.item || group.lines[0].item;
    const vendorArg = Html.escape(JSON.stringify(group.vendor));
    const rows = open.map((l) => {
      const cur = l.item.currency || 'INR';
      return `
        <div class="settle-row">
          <div class="min-w-0">
            <div class="font-medium text-sm">${Html.escape(l.item.name)}</div>
            ${l.lines.length ? `<div class="text-xs text-zinc-500">${DeliveryPlan.rangeLabel(l.from, l.to)} · ${l.plan.qtyLabel(l.qty)} on ${l.days} day${l.days === 1 ? '' : 's'}</div>` : ''}
            ${(l.adjustments || []).map((a) => `<div class="text-[11px] text-amber-700 dark:text-amber-400">Adjustment ${DeliveryPlan.shortDate(a.date)}: ${a.amount < 0 ? '−' : '+'}${this.#fx.formatMoney(Math.abs(a.amount), cur)}</div>`).join('')}
          </div>
          <div class="settle-amount">
            <span class="text-xs text-zinc-500">${Html.escape(cur)}</span>
            <input class="input" type="number" min="0" step="${CurrencyService.stepFor(cur)}" name="amount_${Html.escape(l.item.id)}"
                   value="${this.#fx.fromMinor(l.amount, cur)}">
          </div>
        </div>`;
    }).join('');

    return `
      <form class="p-5" style="min-width:320px;max-width:480px" onsubmit="window.__app.submitSettle(event, ${vendorArg}, '${upTo}')">
        <div class="flex items-center justify-between mb-1">
          <h3 class="text-lg font-semibold">Pay ${Html.escape(group.vendor)}</h3>
          ${close}
        </div>
        <div class="text-xs text-zinc-500 mb-4">${group.lastPaid ? `Last paid ${this.#fx.formatMoney(group.lastPaid.amount, group.lastPaid.currency || group.currency)} on ${DeliveryPlan.shortDate(group.lastPaid.date, true)}` : 'First payment'}</div>

        <label class="text-xs text-zinc-500">Pay for deliveries up to</label>
        <input class="input mb-4" type="date" name="upTo" value="${upTo}" max="${VendorDues.today()}"
               onchange="window.__app.openModal('settle', { vendor: ${vendorArg}, upTo: this.value })">

        ${open.length ? rows : '<p class="text-sm text-zinc-500 mb-4">Nothing owed up to this day.</p>'}

        ${open.length ? `
        <div class="settle-total"><span>Total</span><b>${this.#fx.formatMoney(group.amount, group.currency || 'INR')}</b></div>

        <div class="grid grid-cols-2 gap-3 mt-4 mb-4">
          <div>
            <label class="text-xs text-zinc-500">Paid from</label>
            <select class="select" name="account">${this.#accounts(first)}</select>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Paid on</label>
            <input class="input" type="date" name="paidOn" value="${VendorDues.today()}">
          </div>
        </div>

        <div class="flex gap-2">
          <button type="button" class="btn btn-outline" onclick="window.__app.shareStatement(${vendorArg}, '${upTo}')">
            <i data-lucide="share-2"></i> Bill
          </button>
          <div class="flex-1"></div>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Record payment</button>
        </div>
        <div class="text-[11px] text-zinc-500 mt-3 leading-relaxed">Records ${open.length === 1 ? 'an expense' : `${open.length} expenses (one per item)`} in your book. Days up to ${DeliveryPlan.shortDate(upTo)} are then marked paid.</div>` : ''}
      </form>`;
  }

  /** Your accounts, plus shared ones you can add to; the item's own account first. */
  #accounts(item) {
    const state = this.#store.getState();
    const chosen = AccountRef.fromRecord(item).toValue();
    const own = (state.accounts || []).filter((a) => !a.archived)
      .map((a) => `<option value="${Html.escape(a.id)}" ${chosen === a.id ? 'selected' : ''}>${Html.escape(a.name)}</option>`).join('');
    const shared = (state._sharedData || []).map((share) => {
      const opts = (share.accounts || []).filter((a) => (share.permission || {})[a.id] !== 'view').map((a) => {
        const v = new AccountRef(a.id, share._ownerId).toValue();
        return `<option value="${Html.escape(v)}" ${chosen === v ? 'selected' : ''}>${Html.escape(a.name)}</option>`;
      }).join('');
      return opts ? `<optgroup label="Shared by ${Html.escape(share.sharedBy || 'Family')}">${opts}</optgroup>` : '';
    }).join('');
    return `<optgroup label="My accounts">${own}</optgroup>${shared}`;
  }
}
