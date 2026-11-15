/**
 * DeliveryDay — what a pay-later regular item (milk, newspaper) brings on a
 * day and what's owed, for the bot. The same rules as the app's DeliveryPlan
 * (legacy-web/src/domain/services/DeliveryPlan.js): the usual quantity on the
 * usual weekdays from trackFrom, a marked day wins, a pause brings nothing,
 * prices change from a date, and days up to paidTo are paid.
 */
export interface DeliveryItem {
  ownerId: string;
  id: string;
  name: string;
  accountId: string | null;
  categoryId?: string | null;
  currency: string | null;
  defaultAmount: number | null;
  payLater?: boolean;
  usualQty?: number;
  usualDays?: number[];
  unit?: string;
  vendor?: string;
  trackFrom?: string;
  marks?: Record<string, number>;
  pauses?: { from: string; to: string }[];
  prices?: { from: string; unit: number }[];
  paidTo?: string | null;
  adjustments?: { date: string; was: number; now: number; unit: number; settledIn: string | null }[];
  checkinTo?: 'all' | 'one' | 'group' | 'off';
  checkinEmail?: string | null;
  checkinMinute?: number;
  checkinTz?: string;
}

export interface DueTotals {
  from: string;
  to: string;
  qty: number;
  days: number;
  amount: number; // minor units, adjustments included
  adjust: number; // of which: changes to days already paid
}

export class DeliveryDay {
  static readonly #ISO = /^\d{4}-\d{2}-\d{2}$/;
  static readonly #MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  readonly #item: DeliveryItem;

  constructor(item: DeliveryItem) {
    this.#item = item;
  }

  get item(): DeliveryItem { return this.#item; }
  get vendor(): string { return String(this.#item.vendor || '').trim() || this.#item.name; }
  get unit(): string { return String(this.#item.unit || '').trim(); }
  get usualQty(): number { const q = Number(this.#item.usualQty); return Number.isFinite(q) && q >= 0 ? q : 1; }
  get trackFrom(): string | null { return DeliveryDay.isIso(this.#item.trackFrom) ? this.#item.trackFrom! : null; }
  get paidTo(): string | null { return DeliveryDay.isIso(this.#item.paidTo) ? this.#item.paidTo! : null; }
  get checkinMinute(): number { const m = Number(this.#item.checkinMinute); return Number.isInteger(m) && m >= 0 && m < 1440 ? m : 540; }

  get usualDays(): number[] {
    const d = Array.isArray(this.#item.usualDays) ? this.#item.usualDays.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6) : [];
    return d.length ? [...new Set(d)].sort() : [0, 1, 2, 3, 4, 5, 6];
  }

  qtyLabel(qty: number): string {
    const n = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
    return this.unit ? `${n} ${this.unit}` : n;
  }

  usualOn(iso: string): number {
    if (this.trackFrom && iso < this.trackFrom) return 0;
    return this.usualDays.includes(DeliveryDay.weekday(iso)) ? this.usualQty : 0;
  }

  pausedOn(iso: string): boolean {
    return (this.#item.pauses ?? []).some((p) => DeliveryDay.isIso(p?.from) && DeliveryDay.isIso(p?.to) && iso >= p.from && iso <= p.to);
  }

  changedOn(iso: string): boolean {
    return !!this.#item.marks && Object.prototype.hasOwnProperty.call(this.#item.marks, iso);
  }

  qtyOn(iso: string): number {
    if (this.trackFrom && iso < this.trackFrom) return 0;
    if (this.changedOn(iso)) return Math.max(0, Number(this.#item.marks![iso]) || 0);
    if (this.pausedOn(iso)) return 0;
    return this.usualOn(iso);
  }

  priceOn(iso: string): number {
    const list = (this.#item.prices ?? []).filter((p) => DeliveryDay.isIso(p?.from) && Number.isFinite(Number(p?.unit)))
      .map((p) => ({ from: p.from, unit: Number(p.unit) })).sort((a, b) => a.from.localeCompare(b.from));
    let price: number | null = null;
    for (const p of list) if (p.from <= iso) price = p.unit;
    if (price == null) price = list.length ? list[0].unit : Number(this.#item.defaultAmount) || 0;
    return price;
  }

  isPaid(iso: string): boolean { return !!this.paidTo && iso <= this.paidTo; }

  /** The quantity that marks `iso` as `qty`, or null when that's just the usual (clear the mark instead). */
  markFor(iso: string, qty: number): number | null {
    const plain = this.pausedOn(iso) ? 0 : this.usualOn(iso);
    const q = Math.max(0, Math.round(qty * 100) / 100);
    return q === plain ? null : q;
  }

  /** Changes to paid days still to go on a bill (minor units, + or −). */
  get openAdjustment(): number {
    return (this.#item.adjustments ?? []).filter((a) => a && !a.settledIn)
      .reduce((t, a) => t + Math.round((Number(a.now) - Number(a.was)) * Number(a.unit)), 0);
  }

  /** What's owed from the first unpaid day to `upTo`, with adjustments; null when there's nothing. */
  due(upTo: string): DueTotals | null {
    const after = this.paidTo ? DeliveryDay.addDays(this.paidTo, 1) : null;
    const start = this.trackFrom || after || upTo;
    const from = after && after > start ? after : start;
    const adjust = this.openAdjustment;
    if (from > upTo) {
      const hasAdj = (this.#item.adjustments ?? []).some((a) => a && !a.settledIn);
      return hasAdj ? { from: this.paidTo ?? upTo, to: this.paidTo ?? upTo, qty: 0, days: 0, amount: adjust, adjust } : null;
    }
    let qty = 0, days = 0, amount = 0;
    for (let iso = from, i = 0; iso <= upTo && i < 1500; iso = DeliveryDay.addDays(iso, 1), i++) {
      const q = this.qtyOn(iso);
      if (q > 0) days++;
      qty += q;
      amount += Math.round(q * this.priceOn(iso));
    }
    return { from, to: upTo, qty: Math.round(qty * 100) / 100, days, amount: amount + adjust, adjust };
  }

  static isIso(s: unknown): boolean { return typeof s === 'string' && DeliveryDay.#ISO.test(s); }

  static addDays(iso: string, n: number): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  static weekday(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  /** "Sun 15 Nov". */
  static dayLabel(iso: string): string {
    const [, m, d] = iso.split('-').map(Number);
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][DeliveryDay.weekday(iso)]} ${d} ${DeliveryDay.#MONTHS[m - 1]}`;
  }

  /** "1–15 Nov", "28 Oct – 3 Nov". */
  static rangeLabel(from: string, to: string): string {
    const [, fm, fd] = from.split('-').map(Number);
    const [, tm, td] = to.split('-').map(Number);
    if (from === to) return `${td} ${DeliveryDay.#MONTHS[tm - 1]}`;
    if (fm === tm) return `${fd}–${td} ${DeliveryDay.#MONTHS[tm - 1]}`;
    return `${fd} ${DeliveryDay.#MONTHS[fm - 1]} – ${td} ${DeliveryDay.#MONTHS[tm - 1]}`;
  }
}
