/**
 * TradeModal — buy more of a holding, or sell some.
 * Grams × price per gram = the amount; it's saved as a transfer between
 * the account you pick and the holding's investment account, with the
 * grams on the investment-account leg (see HoldingService).
 *
 * opts: { id: string, mode: 'buy'|'sell' }
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
    const sell = opts.mode === 'sell';
    const st = svc.stats(h);
    const others = state.accounts.filter((a) => a.id !== h.accountId && a.type !== 'invest' && !a.archived);
    const price = st.price !== null ? this.#fx.fromMinor(st.price, h.currency) : '';
    const step = CurrencyService.stepFor(h.currency);
    return `
      <form onsubmit="window.__app.submitTrade(event,'${Html.escape(h.id)}','${sell ? 'sell' : 'buy'}')" class="p-5 trade-form">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-lg font-semibold">${sell ? 'Sell' : 'Buy'} ${Html.escape(h.name)}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>
        <div class="text-xs text-zinc-500 mb-3">You hold ${Number(st.qty).toLocaleString('en-IN', { maximumFractionDigits: 3 })} g · average cost ${this.#fx.formatMoney(st.avgCost, h.currency)} / g</div>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Grams</label>
            <input class="input" name="grams" type="number" min="0.001" step="0.001" ${sell ? `max="${st.qty}"` : ''} required inputmode="decimal" autofocus
                   oninput="window.__app.updateTradeTotal(this.form)">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Price / g</label>
            <input class="input" name="price" type="number" min="0" step="${step}" required inputmode="decimal" value="${price}"
                   oninput="window.__app.updateTradeTotal(this.form)">
          </div>
        </div>
        <div class="text-sm mb-3 trade-total" data-currency="${Html.escape(h.currency)}"></div>
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label class="text-xs text-zinc-500">${sell ? 'Money goes to' : 'Pay from'}</label>
            <select class="select" name="other">
              ${others.map((a) => `<option value="${Html.escape(a.id)}" ${a.id === state.user.defaultAccountId ? 'selected' : ''}>${Html.escape(a.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Date</label>
            <input class="input" type="date" name="date" value="${DateService.todayIso()}">
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm mb-4"><input type="checkbox" name="setPrice" checked> Also use this as today’s price</label>
        <div class="flex items-center gap-2">
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> ${sell ? 'Sell' : 'Buy'}</button>
        </div>
      </form>`;
  }
}
