/**
 * InvestmentsView — what you own (gold and silver for now), what it cost,
 * what it's worth at the latest price, and gain alerts.
 *
 * Each holding sits in an Investment account (made for you the first time);
 * buying and selling are transfers, so balances and reports stay right.
 * See HoldingService for the numbers.
 */
import { BaseView }       from './BaseView.js';
import { HoldingService } from '../../domain/services/HoldingService.js';
import { DeliveryPlan }   from '../../domain/services/DeliveryPlan.js';
import { DateService }    from '../../domain/services/DateService.js';

export class InvestmentsView extends BaseView {
  /** A price older than this many days is flagged. */
  static STALE_DAYS = 3;

  render() {
    const svc = window.__app?.holdings;
    const list = svc?.list() ?? [];
    const guest = this.inGuestSpace;
    const head = `
      <div class="flex items-center justify-between mb-6 gap-2">
        <div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Investments${this.helpButton('investments')}</h1>${this.helpHint('investments')}
          <div class="text-xs text-zinc-500 mt-0.5">Gold and silver, valued at the latest price</div>
        </div>
        ${guest ? '' : `<button class="btn btn-primary inv-add" onclick="window.__app.openModal('investment')"><i data-lucide="plus"></i> Add</button>`}
      </div>`;
    if (guest) return head + `<div class="card p-10 text-center">${this.emptyState('Not shared', 'Investments are kept in your own space.')}</div>`;
    if (!list.length) {
      return head + `<div class="card p-10 text-center">${this.emptyState('No investments yet', 'Add the gold or silver you own, or buy some. Pocket keeps the grams, what you paid, and what it’s worth today.')}</div>`;
    }

    const t = svc.totals();
    const alerts = svc.alerts();
    return `
      ${head}
      <div class="card p-5 mb-4 inv-summary">
        <div class="text-xs text-zinc-500">Worth now</div>
        <div class="text-3xl font-semibold">${this.formatMoney(t.worth, t.home)}</div>
        <div class="text-sm mt-1">
          <span class="text-zinc-500">Invested ${this.formatMoney(t.cost, t.home)} ·</span>
          <span class="${t.gain >= 0 ? 'text-emerald-600' : 'text-rose-500'} font-medium">${t.gain >= 0 ? '+' : '−'}${this.formatMoney(Math.abs(t.gain), t.home)}${t.gainPct !== null ? ` (${t.gainPct >= 0 ? '+' : ''}${t.gainPct}%)` : ''}</span>
          ${t.realised ? `<span class="text-zinc-500"> · from sales ${t.realised >= 0 ? '+' : '−'}${this.formatMoney(Math.abs(t.realised), t.home)}</span>` : ''}
        </div>
      </div>

      ${alerts.map(({ h, st }) => `
        <div class="card-muted p-3 mb-4 inv-alert flex items-center gap-3" style="border-color:#34d399">
          <i data-lucide="trending-up" class="text-emerald-600"></i>
          <div class="flex-1 text-sm"><b>${this.escapeHtml(h.name)}</b> is up ${st.gainPct}% — worth ${this.formatMoney(st.worth, h.currency)} on ${this.formatMoney(st.cost, h.currency)} invested.</div>
          <button class="btn btn-ghost btn-sm" onclick="window.__app.ackInvestmentAlert('${this.jsArg(h.id)}')">Got it</button>
        </div>`).join('')}

      ${Object.entries(HoldingService.KINDS).map(([kind, k]) => {
        const items = list.filter((h) => h.kind === kind);
        if (!items.length) return '';
        return `
          <div class="mb-6 inv-group" data-kind="${kind}">
            <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">${k.label}</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${items.map((h) => this.#card(h, svc)).join('')}</div>
          </div>`;
      }).join('')}`;
  }

  // ── Private ───────────────────────────────────────────────────────────

  #card(h, svc) {
    const st  = svc.stats(h);
    const cur = h.currency;
    const acc = this.state.accounts.find((a) => a.id === h.accountId);
    const today = DateService.todayIso();
    const age = st.priceDate ? Math.round((Date.parse(today) - Date.parse(st.priceDate)) / 86400000) : null;
    const stale = age === null || age > InvestmentsView.STALE_DAYS;
    const grams = (g) => `${Number(g).toLocaleString('en-IN', { maximumFractionDigits: 3 })} g`;
    const tone = st.gain >= 0 ? 'text-emerald-600' : 'text-rose-500';
    const id = this.jsArg(h.id);
    const history = svc.entries(h.id);
    return `
      <div class="card p-4 inv-card" data-holding="${this.escapeHtml(h.id)}">
        <div class="flex items-start gap-3">
          <div class="icon-pill" style="background:${h.kind === 'silver' ? '#94a3b822' : '#f59e0b22'};color:${h.kind === 'silver' ? '#64748b' : '#d97706'}"><i data-lucide="${HoldingService.KINDS[h.kind]?.icon || 'gem'}"></i></div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold truncate">${this.escapeHtml(h.name)}</div>
            <div class="text-xs text-zinc-500">${grams(st.qty)} · ${this.escapeHtml(h.purity)}${acc ? ` · in ${this.escapeHtml(acc.name)}` : ''}</div>
          </div>
          <div class="text-right">
            <div class="font-semibold">${this.formatMoney(st.worth, cur)}</div>
            <div class="text-xs ${tone}">${st.gain >= 0 ? '+' : '−'}${this.formatMoney(Math.abs(st.gain), cur)}${st.gainPct !== null ? ` · ${st.gainPct >= 0 ? '+' : ''}${st.gainPct}%` : ''}</div>
          </div>
        </div>
        <div class="flex items-center gap-2 mt-3 text-xs">
          <span class="flex-1 ${stale ? 'text-amber-600' : 'text-zinc-500'} inv-price">
            ${st.price !== null ? `${this.formatMoney(st.price, cur)} / g · ${DeliveryPlan.shortDate(st.priceDate)}${stale ? ' · price may be old' : ''}` : 'No price yet'}
          </span>
          <span class="text-zinc-500">Avg cost ${this.formatMoney(st.avgCost, cur)} / g</span>
        </div>
        ${st.target !== null ? `<div class="text-xs text-zinc-500 mt-1 inv-target"><i data-lucide="bell" style="width:11px;height:11px;display:inline"></i> Alert at ${this.formatMoney(st.target, cur)} / g${h.alert?.gainPct ? ` (+${h.alert.gainPct}%)` : ''}${st.reached ? ' · <span class="text-emerald-600">reached</span>' : ''}</div>` : ''}
        <div class="grid grid-cols-3 gap-2 mt-3">
          <button class="btn btn-outline btn-sm justify-center" onclick="window.__app.openModal('trade',{id:'${id}',mode:'buy'})"><i data-lucide="plus"></i> Buy</button>
          <button class="btn btn-outline btn-sm justify-center" ${st.qty > 0 ? '' : 'disabled'} onclick="window.__app.openModal('trade',{id:'${id}',mode:'sell'})"><i data-lucide="minus"></i> Sell</button>
          <button class="btn btn-outline btn-sm justify-center" onclick="window.__app.openModal('holdingPrice',{id:'${id}'})"><i data-lucide="tag"></i> Price</button>
        </div>
        <details class="mt-3 text-xs">
          <summary class="cursor-pointer text-zinc-500">History${history.length ? ` · ${history.length}` : ''}</summary>
          <div class="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
            ${Number(h.openingQty) > 0 ? `<div class="py-1.5 flex justify-between"><span>Already owned · ${grams(h.openingQty)}</span><span>${this.formatMoney(h.openingCost || 0, cur)}</span></div>` : ''}
            ${history.map((t) => `
              <div class="py-1.5 flex items-center gap-2">
                <span class="flex-1">${DeliveryPlan.shortDate(t.date)} · ${Number(t.qty) > 0 ? 'Bought' : 'Sold'} ${grams(Math.abs(t.qty))} @ ${this.formatMoney(t.unitPrice || 0, cur)}</span>
                <span>${this.formatMoney(t.amount, t.currency || cur)}</span>
                <button class="text-zinc-400 hover:text-rose-500" title="Delete" onclick="window.__app.deleteTx('${this.jsArg(t.id)}')"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>
              </div>`).join('')}
            <div class="py-1.5"><button class="underline text-zinc-500" onclick="window.__app.openModal('investment',{id:'${id}'})">Edit or remove</button></div>
          </div>
        </details>
      </div>`;
  }
}
