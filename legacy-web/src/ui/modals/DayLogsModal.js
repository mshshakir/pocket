/**
 * DayLogsModal — Shows and allows entry of regular-item logs for a calendar day.
 *
 * An item whose default account was shared by a family member logs into THAT
 * user's book, so its entries never reach `state.transactions`. Reading through
 * RegularLogService merges both books, which is what stops such an entry from
 * vanishing the moment it is saved.
 *
 * Pay-later items (milk, newspaper) aren't logged here: their day is worked
 * out from the usual pattern (DeliveryPlan), so this only changes the days
 * that were different — and not once the vendor has been paid for them.
 */
import { DeliveryPlan } from '../../domain/services/DeliveryPlan.js';
import { Html }         from '../../core/Html.js';
import { DateService }  from '../../domain/services/DateService.js';

export class DayLogsModal {
  #store;
  #hijriService;
  #currencyService;
  #regularLogs;
  #dues;

  constructor({ store, hijriService, currencyService, regularLogService, vendorDues = null }) {
    this.#dues = vendorDues;
    this.#store = store;
    this.#hijriService = hijriService;
    this.#currencyService = currencyService;
    this.#regularLogs = regularLogService || null;
  }

  render({ date, flash = null } = {}) {
    if (!date) return '<div class="p-5 text-sm text-zinc-500">No date specified.</div>';
    const s = this.#store.getState();
    const all = s.regularItems || [];
    const ctx = window.__app?.deliveryContext?.() ?? { items: all.filter((i) => i.payLater === true), canChange: () => true };
    const deliveries = ctx.items;
    const items = all.filter((i) => i.payLater !== true);
    const logs = this.#regularLogs
      ? this.#regularLogs.onDate(date)
      : (s.transactions || []).filter(t => t.regularItemId && t.date === date);
    const billsHtml = this.#bills(date, s);
    const hijriStr = (() => {
      if (!s.user?.showHijri) return '';   // Hijri off in Settings
      try { return this.#hijriService.format(date); } catch { return ''; }
    })();

    const logRows = logs.map(log => {
      const item = all.find(i => i.id === log.regularItemId);
      const cur = log.currency || s.user.homeCurrency;
      const qty = log.qty ?? 1;
      const unitAmt = log.unitAmount != null ? log.unitAmount : log.amount;
      const sharedTag = log._shared
        ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700
                       dark:bg-indigo-500/15 dark:text-indigo-300">shared</span>`
        : '';
      return `
        <div class="flex items-center justify-between p-3 card mb-2">
          <div>
            <div class="text-sm font-medium flex items-center gap-1.5">
              ${this.#esc(item?.name || 'Item')}${sharedTag}
            </div>
            <div class="text-xs text-zinc-500">Qty ${qty} × ${this.#currencyService.formatMoney(unitAmt, cur)}</div>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-semibold text-sm">${this.#currencyService.formatMoney(log.amount, cur)}</span>
            <button class="btn btn-ghost p-1 text-red-500"
              onclick="window.__app.deleteRegularLog('${this.#esc(log.id)}','${this.#esc(date)}')">
              <i data-lucide="trash-2" style="width:16px;height:16px"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    const itemOptions = items.map(it => {
      const price = it.defaultAmount ?? 0;
      const itCur = it.currency || s.user.homeCurrency;
      const priceDisplay = this.#currencyService.fromMinor(price, itCur);
      return `<option value="${this.#esc(it.id)}" data-price="${priceDisplay}" data-currency="${this.#esc(itCur)}">${this.#esc(it.name)}</option>`;
    }).join('');

    return `
      <div class="p-5" style="min-width:320px;max-width:480px">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="font-semibold">${this.#esc(date)}</div>
            ${hijriStr ? `<div class="text-xs text-zinc-500">${this.#esc(hijriStr)}</div>` : ''}
          </div>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        ${billsHtml}
        ${deliveries.length ? this.#deliveries(deliveries, date, s, ctx, flash) : ''}

        ${logs.length > 0
          ? `<div class="mb-4">${deliveries.length ? '<div class="text-sm font-semibold mb-2">Entries</div>' : ''}${logRows}</div>`
          : deliveries.length || billsHtml ? '' : `<p class="text-sm text-zinc-500 mb-4">No entries for this day.</p>`}

        ${items.length > 0 ? `
        <div class="text-sm font-semibold mb-3">Add entry</div>
        <form onsubmit="window.__app.submitRegularLog(event,'${this.#esc(date)}')">
          <label class="block text-xs font-medium mb-1 text-zinc-500">Item</label>
          <select id="dayLogItem" name="itemId" class="select mb-3"
            onchange="window.__app.prefillRegularLog(this)" required>
            <option value="">— select —</option>
            ${itemOptions}
          </select>
          <div class="flex gap-2 mb-3">
            <div class="flex-1">
              <label class="block text-xs font-medium mb-1 text-zinc-500">Qty</label>
              <input type="number" name="qty" id="dayLogQty" class="input"
                value="1" min="1" step="1" oninput="window.__app.updateRegularLogTotal()">
            </div>
            <div class="flex-1">
              <label class="block text-xs font-medium mb-1 text-zinc-500">Unit price</label>
              <input type="number" name="unitPrice" id="dayLogUnit" class="input"
                placeholder="0.00" min="0" step="any" oninput="window.__app.updateRegularLogTotal()">
            </div>
          </div>
          <label class="block text-xs font-medium mb-1 text-zinc-500">Total</label>
          <input type="number" name="total" id="dayLogTotal" class="input mb-4"
            placeholder="0.00" step="any" readonly>
          <button class="btn btn-primary w-full" type="submit">Add entry</button>
        </form>` : deliveries.length || billsHtml ? '' : `<p class="text-sm text-zinc-500 mt-2">Nothing set up yet — add a delivery or a shortcut under Regulars → Add.</p>`}
      </div>`;
  }

  /** Each pay-later item on this day: what came, with − / + and back-to-usual. */
  /** Bills falling on this day: paid (green) or still to pay (red), with Pay. */
  #bills(date, s) {
    const svc = window.__app?.bills;
    if (!svc) return '';
    const list = svc.occurrences(date, date, DateService.todayIso(), s).filter((o) => o.status !== 'skipped');
    if (!list.length) return '';
    const word = { paid: 'Paid', overdue: 'Not paid yet', due: 'Due today', upcoming: 'Coming up' };
    const rows = list.map((o) => {
      const t = o.template;
      const open = o.status === 'overdue' || o.status === 'due';
      return `
        <div class="flex items-center justify-between gap-2 p-3 card mb-2">
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">${this.#esc(t.payee || 'Bill')}</div>
            <div class="text-xs text-zinc-500">${this.#currencyService.formatMoney(o.amount, o.currency || s.user.homeCurrency)}${t.askFirst ? (o.status === 'paid' ? '' : ' · last time') : ''}</div>
          </div>
          <span class="bill-state ${o.status}">${word[o.status]}</span>
          ${open ? `<button type="button" class="btn btn-primary btn-sm" onclick="window.__app.openModal('payBill',{templateId:'${Html.js(t.id)}',date:'${date}'})">Pay</button>` : ''}
        </div>`;
    }).join('');
    return `
      <div class="mb-4">
        <div class="text-sm font-semibold mb-2">Bills</div>
        ${rows}
      </div>`;
  }

  /** "Delivered ✓" (tap to take back) or "Mark as delivered"; nothing on a day with none or ahead. */
  /**
   * Under each delivery: "Delivered · not paid yet" (Undo), "Not delivered ·
   * not counted" (Undo), or, when nobody has said yet, two buttons.
   */
  #confirmLine(item, plan, date, qty, paid, ctx) {
    if (date > DateService.todayIso() || plan.stateOn(date) === 'before') return '';
    const can = ctx.canChange(item);
    const id = Html.escape(item.id);
    const back = `{reopen:{name:'dayLogs',opts:{date:'${date}'}}}`;
    if (qty <= 0) {
      if (!plan.changedOn(date)) return '';
      return `
      <div class="delivery-confirm skipped">
        <span>Not delivered · not counted</span>
        ${can ? `<button type="button" onclick="window.__app.resetDelivery('${id}','${date}')">Undo</button>` : ''}
      </div>`;
    }
    const on = plan.confirmedOn(date);
    if (on || paid) {
      return `
      <div class="delivery-confirm ${paid ? 'paid' : 'owed'}">
        <span>${paid ? (on ? 'Delivered · paid' : 'Paid') : 'Delivered · not paid yet'}</span>
        ${can && on ? `<button type="button" onclick="window.__app.confirmDelivery('${id}','${date}',false,${back})">Undo</button>` : ''}
      </div>`;
    }
    return `
      <div class="delivery-confirm unconfirmed">
        <span>Did it come?</span>
        ${can ? `<span class="flex gap-3">
          <button type="button" onclick="window.__app.confirmDelivery('${id}','${date}',true,${back})">✓ Delivered</button>
          <button type="button" onclick="window.__app.notDelivered('${id}','${date}',true)">✗ Not delivered</button>
        </span>` : ''}
      </div>`;
  }

  #deliveries(list, date, s, ctx, flash) {
    const rows = list.map((item) => {
      const plan = new DeliveryPlan(item);
      const state = plan.stateOn(date);
      const qty = plan.qtyOn(date);
      const paid = this.#dues?.isPaid(item, date) ?? false;
      // A paid day of your own item can still change (after a confirmation, as an adjustment on the next bill).
      const locked = !ctx.canChange(item) || (paid && !!ctx.ownerId);
      const adj = (item.adjustments || []).find((a) => a.date === date && !a.settledIn);
      const id = Html.escape(item.id);
      const cost = qty ? this.#currencyService.formatMoney(Math.round(qty * plan.priceOn(date)), item.currency || s.user.homeCurrency) : '';
      const label = state === 'before' ? 'Not counted yet'
        : state === 'paused' ? 'Paused'
        : state === 'changed' ? (qty ? `Changed · usual ${plan.qtyLabel(plan.usualOn(date))}` : 'None today')
        : state === 'off' ? 'Not a delivery day' : 'Usual';
      const color = Html.color(item.color);
      return `
        <div class="delivery-row ${state === 'changed' ? 'is-changed' : ''} ${flash === item.id ? 'delivery-flash' : ''}">
          <span class="icon-pill" style="background:${color}22;color:${color};width:30px;height:30px">
            <i data-lucide="${Html.icon(item.icon)}" style="width:15px;height:15px"></i>
          </span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${Html.escape(item.name)}</div>
            <div class="text-xs text-zinc-500">${label}${cost ? ` · ${cost}` : ''}${paid ? ' · paid' : ''}${adj ? ` · ${adj.now > adj.was ? '+' : '−'}${this.#currencyService.formatMoney(Math.abs(Math.round((adj.now - adj.was) * adj.unit)), item.currency || s.user.homeCurrency)} next bill` : ''}</div>
          </div>
          ${locked || state === 'before' ? `<span class="delivery-qty">${qty ? Html.escape(plan.qtyLabel(qty)) : '—'}</span>` : `
          <div class="delivery-step">
            <button type="button" aria-label="Less" onclick="window.__app.stepDelivery('${id}','${date}',-1)" ${qty <= 0 ? 'disabled' : ''}><i data-lucide="minus"></i></button>
            <span class="delivery-qty">${qty ? Html.escape(plan.qtyLabel(qty)) : '0'}</span>
            <button type="button" aria-label="More" onclick="window.__app.stepDelivery('${id}','${date}',1)"><i data-lucide="plus"></i></button>
          </div>`}
        </div>
        ${this.#confirmLine(item, plan, date, qty, paid, ctx)}
        ${!locked && state === 'changed' ? `<div class="delivery-reset"><button type="button" onclick="window.__app.resetDelivery('${id}','${date}')">Back to usual</button></div>` : ''}`;
    }).join('');
    return `
      <div class="mb-4">
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm font-semibold">Deliveries</div>
          ${ctx.ownerId ? '' : `<button type="button" class="text-xs text-zinc-500 underline" onclick="window.__app.closeModal();window.__app.setCalTab('dues')">See dues</button>`}
        </div>
        ${rows}
        <div class="text-[11px] text-zinc-500 mt-1">Filled in from the usual — change only what was different.</div>
      </div>`;
  }

  #esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
}
