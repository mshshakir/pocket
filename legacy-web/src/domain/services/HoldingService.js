/**
 * HoldingService — investments you own inside an Investment account: gold and
 * silver (counted in grams) and shares (counted in shares).
 *
 *   state.holdings = [{
 *     id, accountId, name, kind: 'gold'|'silver'|'shares',
 *     purity?: '24k'|'22k'|'18k'|'999'|'925'   (metals),  code?: 'TCS'   (shares),
 *     unit: 'g'|'shares', currency,
 *     openingQty, openingCost,          // "I already own this": no money moved
 *     prices: [{ date, price }],        // per gram / per share, oldest first
 *     alert: { gainPct?, targetPrice?, ackTarget? },
 *     note?, archived?
 *   }]
 * Synced with the book as top-level data (bookExtra), no migration.
 *
 * Buying and selling are ordinary transfers. The leg on the investment
 * account carries   holdingId · qty (+ buy, − sell) · unitPrice. Charges
 * (brokerage, making) are in the amount: a buy costs qty × price + charges,
 * a sale brings in qty × price − charges. Deleting the transfer undoes it.
 * Dividends are income entries carrying holdingId (and no qty).
 *
 * Worth and gain (average-cost method):
 *   qty        opening grams + Σ qty on tagged entries
 *   cost       what the grams still held cost (average cost)
 *   worth      qty × latest price
 *   gain       worth − cost  (and gainPct)
 *   realised   Σ (sale proceeds − average cost of the grams sold)
 *   ledgerNet  what tagged entries did to the account balance (buys +, sales −)
 * An investment account is worth   balance + Σ (worth − ledgerNet)
 * — the cash in it plus its holdings at today's price.
 *
 * Pure apart from the state object it is given; no DOM.
 */
import { LedgerMath } from './LedgerMath.js';

export class HoldingService {
  /** Metals and their purities, in the order offered. */
  static KINDS = Object.freeze({
    gold:   { label: 'Gold',   icon: 'gem',        unit: 'g',      per: 'g',     qtyLabel: 'Grams',  purities: ['24k', '22k', '18k'] },
    silver: { label: 'Silver', icon: 'circle',     unit: 'g',      per: 'g',     qtyLabel: 'Grams',  purities: ['999', '925'] },
    shares: { label: 'Shares', icon: 'briefcase',  unit: 'shares', per: 'share', qtyLabel: 'Shares', purities: [] },
  });

  /** @param {object} h  @returns {object} its kind's settings */
  static kindOf(h) { return HoldingService.KINDS[h?.kind] || HoldingService.KINDS.gold; }

  /** "12.5 g" · "40 shares" */
  static qtyText(h, q) {
    const n = Number(q).toLocaleString('en-IN', { maximumFractionDigits: 3 });
    return HoldingService.kindOf(h).unit === 'g' ? `${n} g` : `${n} ${Number(q) === 1 ? 'share' : 'shares'}`;
  }

  /** Most prices kept per holding (oldest dropped). */
  static MAX_PRICES = 400;

  /** @type {() => object} */ #state;
  /** @type {object} */ #fx;

  /**
   * @param {{state: () => object, fx: {convertStrict: Function, convert: Function}}} deps
   */
  constructor({ state, fx }) {
    this.#state = state;
    this.#fx = fx;
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /** All holdings not archived. */
  list() { return (this.#state().holdings || []).filter((h) => !h.archived); }

  /** @param {string} id */
  find(id) { return (this.#state().holdings || []).find((h) => h.id === id); }

  /** The entries (transfer legs with a quantity) that bought or sold a holding, oldest first. */
  entries(id) {
    return (this.#state().transactions || [])
      .filter((t) => t.holdingId === id && t.type === 'transfer' && t.qty != null && Number.isFinite(Number(t.qty)) && Number(t.qty) !== 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }

  /** Dividends received on a holding (income entries carrying its id), its currency. */
  dividends(id) {
    return Math.round((this.#state().transactions || [])
      .filter((t) => t.holdingId === id && t.type === 'income')
      .reduce((s, t) => s + (Number(t.amount) || 0), 0));
  }

  /** Dividend entries of a holding, oldest first. */
  dividendEntries(id) {
    return (this.#state().transactions || [])
      .filter((t) => t.holdingId === id && t.type === 'income')
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  /** The latest price per unit, or null: { date, price }. */
  static latestPrice(h) {
    const p = Array.isArray(h?.prices) ? h.prices : [];
    return p.length ? p[p.length - 1] : null;
  }

  /**
   * Where a holding stands.
   * @param {object} h
   * @returns {{qty:number, cost:number, avgCost:number, price:number|null, priceDate:string|null,
   *   worth:number, gain:number, gainPct:number|null, realised:number, ledgerNet:number,
   *   target:number|null, reached:boolean, alertNew:boolean}}
   *   money in minor units of the holding's currency; qty in grams
   */
  stats(h) {
    const account = (this.#state().accounts || []).find((a) => a.id === h.accountId);
    let qty  = Number(h.openingQty) || 0;
    let cost = Math.round(Number(h.openingCost) || 0);
    let realised = 0, ledgerNet = 0;
    for (const t of this.entries(h.id)) {
      const q = Number(t.qty);
      const money = Math.abs(Math.round(Number(t.amount) || 0));
      if (account) ledgerNet += LedgerMath.accountDelta(t, account, this.#fx);
      if (q > 0) { qty += q; cost += money; }
      else if (q < 0) {
        const sold = Math.min(-q, qty);
        const avg  = qty > 0 ? cost / qty : 0;
        const costOut = Math.round(avg * sold);
        realised += money - costOut;
        cost -= costOut; qty -= sold;
      }
    }
    qty = HoldingService.#grams(qty);
    if (qty <= 0) { qty = 0; cost = 0; }
    const last  = HoldingService.latestPrice(h);
    const price = last ? Number(last.price) : null;
    const worth = price === null ? cost : Math.round(qty * price);
    const gain  = worth - cost;
    const avgCost = qty > 0 ? Math.round(cost / qty) : 0;
    const target = HoldingService.targetPrice(h, avgCost);
    const reached = target !== null && price !== null && qty > 0 && price >= target;
    return {
      qty, cost, avgCost, price, priceDate: last?.date ?? null, worth, gain, dividends: this.dividends(h.id),
      gainPct: cost > 0 ? Math.round((1000 * gain) / cost) / 10 : null,
      realised: Math.round(realised), ledgerNet: Math.round(ledgerNet),
      target, reached, alertNew: reached && h.alert?.ackTarget !== target,
    };
  }

  /**
   * The price per gram the alert waits for: from a gain % on the average cost,
   * or a set target price. null when no alert is set.
   */
  static targetPrice(h, avgCost) {
    const a = h?.alert || {};
    if (Number(a.targetPrice) > 0) return Math.round(a.targetPrice);
    if (Number(a.gainPct) > 0 && avgCost > 0) return Math.round(avgCost * (1 + Number(a.gainPct) / 100));
    return null;
  }

  /**
   * How much an investment account's holdings add to (or take from) its
   * balance at today's prices: Σ (worth − ledgerNet). Minor units of the
   * account's currency.
   */
  adjustmentFor(accountId) {
    return this.list().filter((h) => h.accountId === accountId)
      .reduce((s, h) => { const st = this.stats(h); return s + (st.worth - st.ledgerNet); }, 0);
  }

  /** Totals across all holdings, in the home currency. */
  totals() {
    const home = this.#state().user?.homeCurrency || 'INR';
    let worth = 0, cost = 0, realised = 0;
    for (const h of this.list()) {
      const st = this.stats(h);
      worth += this.#fx.convert(st.worth, h.currency, home);
      cost += this.#fx.convert(st.cost, h.currency, home);
      realised += this.#fx.convert(st.realised, h.currency, home);
    }
    return { home, worth: Math.round(worth), cost: Math.round(cost), gain: Math.round(worth - cost),
      gainPct: cost > 0 ? Math.round((1000 * (worth - cost)) / cost) / 10 : null, realised: Math.round(realised) };
  }

  /** Holdings whose gain alert has gone off and hasn't been dismissed. */
  alerts() {
    return this.list().map((h) => ({ h, st: this.stats(h) })).filter(({ st }) => st.alertNew);
  }

  // ── Changes (on the state; the caller saves) ───────────────────────

  /**
   * @param {{accountId:string, name?:string, kind:string, purity:string, currency:string,
   *   openingQty?:number, openingCost?:number, price?:number, date:string, gainPct?:number, note?:string}} d
   * @param {string} id
   * @returns {object} the holding
   */
  create(d, id) {
    const state = this.#state();
    if (!Array.isArray(state.holdings)) state.holdings = [];
    const kind = HoldingService.KINDS[d.kind] ? d.kind : 'gold';
    const k = HoldingService.KINDS[kind];
    const code = kind === 'shares' ? String(d.code || '').trim().toUpperCase() : '';
    const h = {
      id, accountId: d.accountId, kind,
      ...(k.purities.length ? { purity: d.purity || k.purities[0] } : {}),
      ...(code ? { code } : {}),
      name: (d.name || '').trim() || HoldingService.defaultName(kind, d.purity, code), unit: k.unit, currency: d.currency,
      openingQty: Number(d.openingQty) > 0 ? HoldingService.#grams(d.openingQty) : 0,
      openingCost: Number(d.openingCost) > 0 ? Math.round(d.openingCost) : 0,
      prices: Number(d.price) > 0 ? [{ date: d.date, price: Math.round(d.price) }] : [],
      alert: Number(d.gainPct) > 0 ? { gainPct: Number(d.gainPct) } : {},
      note: d.note || '',
    };
    state.holdings.push(h);
    return h;
  }

  /** Add (or replace that day's) price per gram. */
  setPrice(h, date, price) {
    const p = Array.isArray(h.prices) ? h.prices.filter((x) => x.date !== date) : [];
    p.push({ date, price: Math.round(price) });
    p.sort((a, b) => a.date.localeCompare(b.date));
    h.prices = p.slice(-HoldingService.MAX_PRICES);
  }

  /** Set the gain alert: a % on cost, or a target price per gram (minor). */
  setAlert(h, { gainPct = null, targetPrice = null } = {}) {
    h.alert = {
      ...(Number(gainPct) > 0 ? { gainPct: Number(gainPct) } : {}),
      ...(Number(targetPrice) > 0 ? { targetPrice: Math.round(targetPrice) } : {}),
    };
  }

  /** Dismiss the alert that went off (it goes off again for a new target). */
  ackAlert(h) {
    const st = this.stats(h);
    h.alert = { ...(h.alert || {}), ackTarget: st.target };
  }

  /** e.g. "24k gold", "999 silver", "TCS shares". */
  static defaultName(kind, purity, code = '') {
    if (kind === 'shares') return code ? `${code} shares` : 'Shares';
    return `${purity || HoldingService.KINDS[kind]?.purities[0] || ''} ${kind === 'silver' ? 'silver' : 'gold'}`.trim();
  }

  /** Grams to 3 places (milligrams), so 0.1 + 0.2 stays 0.3. */
  static #grams(v) { return Math.round(Number(v) * 1000) / 1000; }
}
