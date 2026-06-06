/**
 * DayLogsModal — Shows and allows entry of regular-item logs for a calendar day.
 */
export class DayLogsModal {
  #store;
  #hijriService;
  #currencyService;

  constructor({ store, hijriService, currencyService }) {
    this.#store = store;
    this.#hijriService = hijriService;
    this.#currencyService = currencyService;
  }

  render({ date } = {}) {
    if (!date) return '<div class="p-5 text-sm text-zinc-500">No date specified.</div>';
    const s = this.#store.getState();
    const items = s.regularItems || [];
    const logs = (s.transactions || []).filter(t => t.regularItemId && t.date === date);
    const hijriStr = (() => {
      try { return this.#hijriService.format(date); } catch { return ''; }
    })();

    const logRows = logs.map(log => {
      const item = items.find(i => i.id === log.regularItemId);
      const cur = log.currency || s.user.homeCurrency;
      const qty = log.qty ?? 1;
      const unitAmt = log.unitAmount != null ? log.unitAmount : log.amount;
      return `
        <div class="flex items-center justify-between p-3 card mb-2">
          <div>
            <div class="text-sm font-medium">${this.#esc(item?.name || 'Item')}</div>
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

        ${logs.length > 0
          ? `<div class="mb-4">${logRows}</div>`
          : `<p class="text-sm text-zinc-500 mb-4">No entries for this day.</p>`}

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
        </form>` : `<p class="text-sm text-zinc-500 mt-2">No regular items configured yet.</p>`}
      </div>`;
  }

  #esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
}
