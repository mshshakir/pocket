/**
 * VendorDues — what is owed to each vendor for pay-later regular items.
 *
 * Deliveries are worked out by DeliveryPlan; they are not entries in the book.
 * Paying the vendor ("Settle") records ordinary expense entries, one per item,
 * each carrying `settles: { from, to, qty }` and the item's regularItemId. The
 * latest `settles.to` is where the next bill starts, so a payment can never be
 * counted twice and nothing is spent until it is actually paid.
 */
import { DeliveryPlan } from './DeliveryPlan.js';
import { DateService }  from './DateService.js';

export class VendorDues {
  /** @type {{getState: () => object}} */ #store;
  /** @type {{all: () => object[]}|null} */ #logs;

  /**
   * @param {object} deps
   * @param {{getState: () => object}} deps.store
   * @param {{all: () => object[]}} [deps.regularLogs]  every regular-item entry, both books
   */
  constructor({ store, regularLogs = null }) {
    this.#store = store;
    this.#logs = regularLogs;
  }

  /** Today as YYYY-MM-DD (local). */
  static today() { return DateService.toIso(new Date()); }

  /** Pay-later items in this book. */
  items() {
    return (this.#store.getState().regularItems || []).filter((i) => i.payLater === true);
  }

  plan(item) { return new DeliveryPlan(item); }

  /** Settlement entries for an item, newest first. */
  payments(itemId) {
    return this.#entries()
      .filter((t) => t.regularItemId === itemId && t.settles && DeliveryPlan.isIso(t.settles.to))
      .sort((a, b) => b.settles.to.localeCompare(a.settles.to) || String(b.date).localeCompare(String(a.date)));
  }

  /** The last day already paid for (null when nothing is). */
  paidTo(itemId) { return this.payments(itemId)[0]?.settles.to ?? null; }

  /** True when `iso` is covered by a payment, so it shouldn't be edited. */
  isPaid(item, iso) {
    const to = this.paidTo(item.id);
    return !!to && iso <= to;
  }

  /** First day not yet paid. */
  openFrom(item) {
    const plan = this.plan(item);
    const to = this.paidTo(item.id);
    const after = to ? DeliveryPlan.addDays(to, 1) : null;
    const start = plan.trackFrom || after || VendorDues.today();
    return after && after > start ? after : start;
  }

  /** What's owed for an item up to `upTo` (default today): DeliveryPlan totals, or null when nothing is open. */
  due(item, upTo = VendorDues.today()) {
    const from = this.openFrom(item);
    if (from > upTo) return null;
    return { item, plan: this.plan(item), ...this.plan(item).totals(from, upTo) };
  }

  /**
   * Everything owed, by vendor:
   * [{ vendor, currency, amount, lines: [{item, plan, from, to, qty, days, amount, lines}], lastPaid }]
   * Vendors with something due come first, largest first.
   */
  byVendor(upTo = VendorDues.today()) {
    const groups = new Map();
    for (const item of this.items()) {
      const plan = this.plan(item);
      const key = plan.vendor.toLowerCase();
      if (!groups.has(key)) groups.set(key, { vendor: plan.vendor, currency: item.currency, amount: 0, lines: [], lastPaid: null });
      const g = groups.get(key);
      const d = this.due(item, upTo);
      if (d) { g.lines.push(d); g.amount += d.amount; }
      else g.lines.push({ item, plan, from: null, to: null, qty: 0, days: 0, amount: 0, lines: [] });
      const last = this.payments(item.id)[0];
      if (last && (!g.lastPaid || String(last.date) > String(g.lastPaid.date))) g.lastPaid = last;
    }
    return [...groups.values()].sort((a, b) => b.amount - a.amount || a.vendor.localeCompare(b.vendor));
  }

  /** Total owed across all vendors, in each currency: { INR: 186000 }. */
  totalOwed(upTo = VendorDues.today()) {
    const out = {};
    for (const g of this.byVendor(upTo)) for (const l of g.lines) {
      const cur = l.item.currency || 'INR';
      out[cur] = (out[cur] || 0) + l.amount;
    }
    return out;
  }

  /**
   * A plain-text bill to send or check against the vendor's.
   * @param {object} group  one entry of byVendor()
   * @param {(minor: number, currency: string) => string} money
   */
  static statement(group, money) {
    const parts = [`${group.vendor}`];
    for (const l of group.lines) {
      if (!l.from) continue;
      const plan = l.plan;
      parts.push('', `${l.item.name} · ${DeliveryPlan.rangeLabel(l.from, l.to)}`);
      for (const d of l.lines) {
        if (d.qty === 0 && d.state === 'off') continue;
        const note = d.state === 'paused' ? ' (away)' : d.state === 'changed' && d.qty === 0 ? ' (none)' : d.state === 'changed' ? ' *' : '';
        parts.push(`${DeliveryPlan.shortDate(d.date)}  ${d.qty ? plan.qtyLabel(d.qty) : '—'}${d.qty ? `  ${money(d.amount, l.item.currency)}` : ''}${note}`);
      }
      parts.push(`${l.item.name}: ${plan.qtyLabel(l.qty)} on ${l.days} day${l.days === 1 ? '' : 's'} = ${money(l.amount, l.item.currency)}`);
    }
    parts.push('', `Total due: ${money(group.amount, group.currency)}`);
    if (group.lines.some((l) => l.lines?.some((d) => d.state === 'changed' && d.qty > 0))) parts.push('* different from the usual');
    return parts.join('\n');
  }

  #entries() {
    if (this.#logs) return this.#logs.all();
    return (this.#store.getState().transactions || []).filter((t) => t.regularItemId);
  }
}
