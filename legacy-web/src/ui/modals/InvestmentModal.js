/**
 * InvestmentModal — add gold, silver or shares you own (or are buying now), or edit one.
 *
 * New: what it is (gold / silver / shares), purity or company and code,
 * where it's kept, then either
 *   "I already own it" — how much, what you paid (optional), today's price, or
 *   "Just bought it"   — how much, price each, charges, pay from (a transfer).
 * Edit: name, what you already owned before using Pocket, remove.
 *
 * opts: { id?: string }
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { HoldingService }  from '../../domain/services/HoldingService.js';
import { DateService }     from '../../domain/services/DateService.js';
import { Html }            from '../../core/Html.js';

export class InvestmentModal {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
  }

  /** <option>s of a metal's purities. */
  static purityOptions(kind, selected = '') {
    return (HoldingService.KINDS[kind]?.purities || []).map((p) => `<option value="${p}" ${p === selected ? 'selected' : ''}>${p}</option>`).join('');
  }

  render(opts = {}) {
    const state = this.#store.getState();
    const h = opts.id ? (state.holdings || []).find((x) => x.id === opts.id) : null;
    return h ? this.#edit(h) : this.#create(state);
  }

  // ── Private ───────────────────────────────────────────────────────────

  #head(title) {
    return `<div class="flex items-center justify-between mb-4"><h3 class="text-lg font-semibold">${title}</h3>
      <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button></div>`;
  }

  #create(state) {
    const invest = state.accounts.filter((a) => a.type === 'invest' && !a.archived);
    const payFrom = state.accounts.filter((a) => a.type !== 'invest' && !a.archived);
    const home = state.user.homeCurrency || 'INR';
    const step = CurrencyService.stepFor(invest[0]?.currency || home);
    const today = DateService.todayIso();
    const kindCard = (k) => `
      <label class="cursor-pointer">
        <input type="radio" name="kind" value="${k}" ${k === 'gold' ? 'checked' : ''} class="peer sr-only" onchange="window.__app.onHoldingKindChange(this)">
        <span class="btn btn-outline w-full justify-center peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900"><i data-lucide="${HoldingService.KINDS[k].icon}"></i> ${HoldingService.KINDS[k].label}</span>
      </label>`;
    const how = (k, label) => `
      <label class="cursor-pointer">
        <input type="radio" name="how" value="${k}" ${k === 'own' ? 'checked' : ''} class="peer sr-only" onchange="window.__app.onHoldingHowChange(this)">
        <span class="btn btn-outline w-full justify-center text-sm peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900">${label}</span>
      </label>`;
    return `
      <form onsubmit="window.__app.submitInvestment(event,'')" class="p-5 investment-form">
        ${this.#head('Add an investment')}
        <div class="grid grid-cols-3 gap-2 mb-3">${kindCard('gold')}${kindCard('silver')}${kindCard('shares')}</div>
        <div class="grid grid-cols-2 gap-3 mb-3" data-kind-only="metal">
          <div>
            <label class="text-xs text-zinc-500">Purity</label>
            <select class="select" name="purity">${InvestmentModal.purityOptions('gold')}</select>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Name (optional)</label>
            <input class="input" name="name" placeholder="e.g. Wedding set">
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3 mb-3" data-kind-only="shares" style="display:none">
          <div class="col-span-2">
            <label class="text-xs text-zinc-500">Company</label>
            <input class="input" name="company" placeholder="e.g. Tata Consultancy Services">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Code (optional)</label>
            <input class="input" name="code" placeholder="e.g. TCS" style="text-transform:uppercase">
          </div>
        </div>
        <div class="mb-3">
          <label class="text-xs text-zinc-500">Kept in</label>
          <select class="select" name="accountId">
            ${invest.map((a) => `<option value="${Html.escape(a.id)}">${Html.escape(a.name)}</option>`).join('')}
            <option value="__new__" ${invest.length ? '' : 'selected'}>${invest.length ? '+ New account…' : 'Investments (made for you)'}</option>
          </select>
        </div>

        <div class="grid grid-cols-2 gap-2 mb-3">${how('own', 'I already own it')}${how('buy', 'Just bought it')}</div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500" data-qty-label>Grams</label>
            <input class="input" name="grams" type="number" min="0" step="0.001" required inputmode="decimal">
          </div>
          <div>
            <label class="text-xs text-zinc-500" data-how-label="own">Today's price / <span data-per>g</span></label>
            <label class="text-xs text-zinc-500" data-how-label="buy" style="display:none">Price paid / <span data-per>g</span></label>
            <input class="input" name="price" type="number" min="0" step="${step}" inputmode="decimal">
          </div>
        </div>
        <div data-how="own" class="mb-3">
          <label class="text-xs text-zinc-500">What you paid in all (optional)</label>
          <input class="input" name="paid" type="number" min="0" step="${step}" inputmode="decimal" placeholder="Leave empty to use today's price">
        </div>
        <div data-how="buy" class="mb-3" style="display:none">
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="text-xs text-zinc-500">Charges</label>
              <input class="input" name="charges" type="number" min="0" step="${step}" inputmode="decimal" placeholder="optional">
            </div>
            <div>
              <label class="text-xs text-zinc-500">Pay from</label>
              <select class="select" name="payFrom">
                ${payFrom.map((a) => `<option value="${Html.escape(a.id)}" ${a.id === state.user.defaultAccountId ? 'selected' : ''}>${Html.escape(a.name)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="text-xs text-zinc-500">Date</label>
              <input class="input" type="date" name="date" value="${today}">
            </div>
          </div>
          <div class="text-xs text-zinc-500 mt-1">Charges: brokerage, making charges or fees — added to what it cost you.</div>
        </div>

        <div class="mb-4">
          <label class="text-xs text-zinc-500">Tell me when the gain reaches (%)</label>
          <input class="input" name="gainPct" type="number" min="0" step="1" placeholder="e.g. 20 — optional">
        </div>

        <div class="flex items-center gap-2">
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
  }

  #edit(h) {
    const step = CurrencyService.stepFor(h.currency);
    const k = HoldingService.kindOf(h);
    const shares = h.kind === 'shares';
    return `
      <form onsubmit="window.__app.submitInvestment(event,'${Html.escape(h.id)}')" class="p-5 investment-form">
        ${this.#head(`Edit ${Html.escape(h.name)}`)}
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">${shares ? 'Company' : 'Name'}</label>
            <input class="input" name="name" value="${Html.escape(h.name)}" required>
          </div>
          <div>
            ${shares
              ? `<label class="text-xs text-zinc-500">Code (optional)</label><input class="input" name="code" value="${Html.escape(h.code || '')}" style="text-transform:uppercase">`
              : `<label class="text-xs text-zinc-500">Purity</label><select class="select" name="purity">${InvestmentModal.purityOptions(h.kind, h.purity)}</select>`}
          </div>
        </div>
        <div class="text-xs text-zinc-500 mb-1">Owned before you started using Pocket</div>
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">${k.qtyLabel}</label>
            <input class="input" name="openingQty" type="number" min="0" step="${shares ? '1' : '0.001'}" value="${Number(h.openingQty) || ''}">
          </div>
          <div>
            <label class="text-xs text-zinc-500">What you paid in all</label>
            <input class="input" name="openingCost" type="number" min="0" step="${step}" value="${h.openingCost ? this.#fx.fromMinor(h.openingCost, h.currency) : ''}">
          </div>
        </div>
        <div class="text-xs text-zinc-500 mb-3">Buying, selling${shares ? ' and dividends' : ''} are in History on the card; delete an entry there to undo it.</div>
        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.removeInvestment('${Html.escape(h.id)}')"><i data-lucide="trash-2"></i> Remove</button>
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
  }
}
