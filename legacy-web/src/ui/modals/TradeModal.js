/**
 * TradeModal — buy more of a holding, sell some, or record a dividend.
 * Quantity × price (+ charges on a buy, − charges on a sale) = the amount;
 * it's saved as a transfer between the account you pick and the holding's
 * investment account, with the quantity on the investment-account leg
 * (see HoldingService). A dividend is income into the account you pick.
 *
 * opts: { id: string, mode: 'buy'|'sell'|'dividend' }
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { HoldingService }  from '../../domain/services/HoldingService.js';
import { DateService }     from '../../domain/services/DateService.js';
import { Html }            from '../../core/Html.js';

export class TradeModal {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;
  /** @type {() => HoldingService} */ #holdings;

  /** @param {{holdings: () => HoldingService}} deps */
  constructor({ holdings }) {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
    this.#holdings = holdings;
  }

  render(opts = {}) {
    const state = this.#store.getState();
    const svc = this.#holdings();
    const h = svc?.find(opts.id);
    if (!h) return `<div class="p-5">Not found</div>`;
    const others = state.accounts.filter((a) => a.id !== h.accountId && a.type !== 'invest' && !a.archived);
    const accountOptions = others.map((a) => `<option value="${Html.escape(a.id)}" ${a.id === state.user.defaultAccountId ? 'selected' : ''}>${Html.escape(a.name)}</option>`).join('');
    const step = CurrencyService.stepFor(h.currency);
    const close = `<button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>`;
    const footer = (label) => `
        <div class="flex items-center gap-2">
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> ${label}</button>
        </div>`;

    if (opts.mode === 'dividend') {
      return `
      <form onsubmit="window.__app.submitTrade(event,'${Html.escape(h.id)}','dividend')" class="p-5 trade-form">
        <div class="flex items-center justify-between mb-3"><h3 class="text-lg font-semibold">Dividend · ${Html.escape(h.name)}</h3>${close}</div>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Amount received</label>
            <input class="input" name="amount" type="number" min="0" step="${step}" required inputmode="decimal" autofocus>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Date</label>
            <input class="input" type="date" name="date" value="${DateService.todayIso()}">
          </div>
        </div>
        <div class="mb-4">
          <label class="text-xs text-zinc-500">Money goes to</label>
          <select class="select" name="other">${accountOptions}</select>
        </div>
        <div class="text-xs text-zinc-500 mb-4">Saved as income (category Dividends) and shown on the card.</div>
        ${footer('Save')}
      </form>`;
    }

    const sell = opts.mode === 'sell';
    const st = svc.stats(h);
    const k = HoldingService.kindOf(h);
    const shares = h.kind === 'shares';
    const price = st.price !== null ? this.#fx.fromMinor(st.price, h.currency) : '';
    return `
      <form onsubmit="window.__app.submitTrade(event,'${Html.escape(h.id)}','${sell ? 'sell' : 'buy'}')" class="p-5 trade-form">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-lg font-semibold">${sell ? 'Sell' : 'Buy'} ${Html.escape(h.name)}</h3>${close}
        </div>
        <div class="text-xs text-zinc-500 mb-3">You hold ${HoldingService.qtyText(h, st.qty)} · average cost ${this.#fx.formatMoney(st.avgCost, h.currency)} / ${k.per}</div>
        <div class="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">${k.qtyLabel}</label>
            <input class="input" name="grams" type="number" min="${shares ? '1' : '0.001'}" step="${shares ? '1' : '0.001'}" ${sell ? `max="${st.qty}"` : ''} required inputmode="decimal" autofocus
                   oninput="window.__app.updateTradeTotal(this.form)">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Price / ${k.per}</label>
            <input class="input" name="price" type="number" min="0" step="${step}" required inputmode="decimal" value="${price}"
                   oninput="window.__app.updateTradeTotal(this.form)">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Charges</label>
            <input class="input" name="charges" type="number" min="0" step="${step}" inputmode="decimal" placeholder="optional"
                   oninput="window.__app.updateTradeTotal(this.form)">
          </div>
        </div>
        <div class="text-sm mb-3 trade-total" data-currency="${Html.escape(h.currency)}" data-unit="${k.unit}" data-sell="${sell ? '1' : ''}"></div>
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label class="text-xs text-zinc-500">${sell ? 'Money goes to' : 'Pay from'}</label>
            <select class="select" name="other">${accountOptions}</select>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Date</label>
            <input class="input" type="date" name="date" value="${DateService.todayIso()}">
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm mb-4"><input type="checkbox" name="setPrice" checked> Also use this as today’s price</label>
        ${footer(sell ? 'Sell' : 'Buy')}
      </form>`;
  }
}
