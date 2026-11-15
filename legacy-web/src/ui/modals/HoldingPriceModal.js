/**
 * HoldingPriceModal — today's price (per gram or per share), and the gain alert.
 * A price is not an entry: it only changes what the holding is worth
 * (and so net worth), never spending or account balances.
 *
 * opts: { id: string }
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { HoldingService }  from '../../domain/services/HoldingService.js';
import { DateService }     from '../../domain/services/DateService.js';
import { DeliveryPlan }    from '../../domain/services/DeliveryPlan.js';
import { Html }            from '../../core/Html.js';

export class HoldingPriceModal {
  /** @type {CurrencyService} */ #fx;
  /** @type {() => HoldingService} */ #holdings;

  /** @param {{holdings: () => HoldingService}} deps */
  constructor({ holdings }) {
    this.#fx = new CurrencyService();
    this.#holdings = holdings;
  }

  render(opts = {}) {
    const svc = this.#holdings();
    const h = svc?.find(opts.id);
    if (!h) return `<div class="p-5">Not found</div>`;
    const st = svc.stats(h);
    const step = CurrencyService.stepFor(h.currency);
    const recent = (h.prices || []).slice(-5).reverse();
    const usePct = !(Number(h.alert?.targetPrice) > 0);
    const per = HoldingService.kindOf(h).per;
    return `
      <form onsubmit="window.__app.submitHoldingPrice(event,'${Html.escape(h.id)}')" class="p-5 price-form">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-semibold">${Html.escape(h.name)} · price</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>
        <div class="grid grid-cols-2 gap-3 mb-2">
          <div>
            <label class="text-xs text-zinc-500">Price / ${per}</label>
            <input class="input" name="price" type="number" min="0" step="${step}" inputmode="decimal" autofocus
                   value="${st.price !== null ? this.#fx.fromMinor(st.price, h.currency) : ''}">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Date</label>
            <input class="input" type="date" name="date" value="${DateService.todayIso()}">
          </div>
        </div>
        ${recent.length ? `<div class="text-xs text-zinc-500 mb-4">Recent: ${recent.map((p) => `${this.#fx.formatMoney(p.price, h.currency)} (${DeliveryPlan.shortDate(p.date)})`).join(' · ')}</div>` : '<div class="mb-4"></div>'}

        <div class="card-muted p-3 mb-4">
          <div class="text-sm font-medium mb-2 flex items-center gap-1.5"><i data-lucide="bell" style="width:14px;height:14px"></i> Gain alert</div>
          <div class="grid grid-cols-2 gap-2 mb-2">
            <label class="flex items-center gap-2 text-sm"><input type="radio" name="alertBy" value="pct" ${usePct ? 'checked' : ''}> Gain %</label>
            <label class="flex items-center gap-2 text-sm"><input type="radio" name="alertBy" value="price" ${usePct ? '' : 'checked'}> Price / ${per}</label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <input class="input" name="gainPct" type="number" min="0" step="1" placeholder="e.g. 20" value="${Number(h.alert?.gainPct) || ''}">
            <input class="input" name="targetPrice" type="number" min="0" step="${step}" placeholder="target price" value="${h.alert?.targetPrice ? this.#fx.fromMinor(h.alert.targetPrice, h.currency) : ''}">
          </div>
          <div class="text-xs text-zinc-500 mt-2">${st.avgCost ? `Your average cost is ${this.#fx.formatMoney(st.avgCost, h.currency)} / ${per}. ` : ''}Leave both empty for no alert. It shows once when reached.</div>
        </div>

        <div class="flex items-center gap-2">
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
  }
}
