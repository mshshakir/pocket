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

  /**
   * The last day already paid for (null when nothing is). For an item of this
   * book it's the latest payment entry — so deleting a payment reopens its
   * days. For an item seen in someone else's space (whose payments this book
   * doesn't hold) it's the item's own record, which every payment updates.
   */
  paidTo(item) {
    const id = typeof item === 'string' ? item : item?.id;
    const it = typeof item === 'string' ? this.items().find((i) => i.id === item) : item;
    if (this.#isOwn(id)) return this.payments(id)[0]?.settles.to ?? null;
    return DeliveryPlan.isIso(it?.paidTo) ? it.paidTo : null;
  }

  /**
   * Brings this book's items in line with their payments: "paid up to" (which
   * Telegram and family members read) and adjustments whose payment was
   * deleted, which go back on the next bill. Returns true when anything changed.
   *
   * An item on a family member's account has its payments in their book,
   * which may not have loaded yet: its "paid up to" only moves back when the
   * payment is undone here (`removed` names the entries just deleted).
   * @param {Set<string>} [removed]
   */
  reconcile(removed = new Set()) {
    const ids = new Set(this.#entries().map((t) => t.id).filter((id) => !removed.has(id)));
    let changed = false;
    for (const it of this.items()) {
      const to = this.payments(it.id).filter((t) => !removed.has(t.id))[0]?.settles.to ?? null;
      const lowering = (it.paidTo ?? '') > (to ?? '');
      if (lowering && it.sharedOwnerId && !this.payments(it.id).some((t) => removed.has(t.id))) continue;
      if ((it.paidTo ?? null) !== to) {
        if (to) it.paidTo = to; else delete it.paidTo;
        changed = true;
      }
      if ((it.adjustments || []).some((a) => a.settledIn && !ids.has(a.settledIn))) {
        it.adjustments = DeliveryPlan.unsettleAdjustments(it, (ref) => !ids.has(ref));
        changed = true;
      }
    }
    return changed;
  }

  /** The newest payment to a vendor: { date, to, entries } (the entries recorded together), or null. */
  lastPayment(vendor) {
    const mine = this.items().filter((i) => this.plan(i).vendor.toLowerCase() === String(vendor).toLowerCase());
    const all = mine.flatMap((i) => this.payments(i.id));
    if (!all.length) return null;
    const newest = all.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.settles.to.localeCompare(a.settles.to))[0];
    const entries = all.filter((t) => t.date === newest.date && t.settles.to === newest.settles.to);
    return { date: newest.date, to: newest.settles.to, entries, amount: entries.reduce((s, t) => s + (t.amount || 0), 0), currency: newest.currency };
  }

  #isOwn(itemId) {
    return (this.#store.getState().regularItems || []).some((i) => i.id === itemId);
  }

  /** True when `iso` is covered by a payment, so it shouldn't be edited. */
  isPaid(item, iso) {
    const to = this.paidTo(item);
    return !!to && iso <= to;
  }

  /** First day not yet paid. */
  openFrom(item) {
    const plan = this.plan(item);
    const to = this.paidTo(item);
    const after = to ? DeliveryPlan.addDays(to, 1) : null;
    const start = plan.trackFrom || after || VendorDues.today();
    return after && after > start ? after : start;
  }

  /**
   * What's owed for an item up to `upTo` (default today): the open days
   * (DeliveryPlan totals) plus adjustments for paid days changed since —
   * { item, plan, from, to, days, qty, amount, lines, adjustments } — or null
   * when there's neither.
   */
  due(item, upTo = VendorDues.today()) {
    const plan = this.plan(item);
    const adjustments = plan.openAdjustments();
    const adjust = adjustments.reduce((t, a) => t + a.amount, 0);
    const from = this.openFrom(item);
    if (from > upTo) {
      if (!adjustments.length) return null;
      const to = this.paidTo(item) ?? upTo;
      return { item, plan, from: to, to, days: 0, qty: 0, amount: adjust, lines: [], adjustments };
    }
    const t = plan.totals(from, upTo);
    return { item, plan, ...t, amount: t.amount + adjust, adjustments };
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
      parts.push('', `${l.item.name}${l.lines.length ? ` · ${DeliveryPlan.rangeLabel(l.from, l.to)}` : ''}`);
      for (const d of l.lines) {
        if (d.qty === 0 && d.state === 'off') continue;
        const note = d.state === 'paused' ? ' (away)' : d.state === 'changed' && d.qty === 0 ? ' (none)' : d.state === 'changed' ? ' *' : '';
        parts.push(`${DeliveryPlan.shortDate(d.date)}  ${d.qty ? plan.qtyLabel(d.qty) : '—'}${d.qty ? `  ${money(d.amount, l.item.currency)}` : ''}${note}`);
      }
      for (const a of l.adjustments ?? []) {
        parts.push(`Adjustment ${DeliveryPlan.shortDate(a.date)}: ${a.now ? plan.qtyLabel(a.now) : 'none'} instead of ${a.was ? plan.qtyLabel(a.was) : 'none'} (paid)  ${a.amount < 0 ? '−' : '+'}${money(Math.abs(a.amount), l.item.currency)}`);
      }
      parts.push(`${l.item.name}: ${l.days ? `${plan.qtyLabel(l.qty)} on ${l.days} day${l.days === 1 ? '' : 's'}` : 'adjustments'} = ${money(l.amount, l.item.currency)}`);
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
