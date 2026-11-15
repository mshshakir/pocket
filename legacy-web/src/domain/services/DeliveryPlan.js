/**
 * DeliveryPlan — what a pay-later regular item (milk, newspaper, a maid's
 * visit) is expected to bring on each day, and what that costs.
 *
 * Nothing is logged day by day. The item carries:
 *   payLater   true for items paid to a vendor later (otherwise this class has nothing to say)
 *   usualQty   how many on a usual day (e.g. 1)
 *   usualDays  weekdays it comes, 0 = Sunday … 6 = Saturday (all seven when missing)
 *   trackFrom  first day counted (YYYY-MM-DD)
 *   marks      { 'YYYY-MM-DD': qty }  days that were different (0 = didn't come)
 *   pauses     [{ from, to }]          away, nothing comes
 *   prices     [{ from, unit }]        price per unit from a date (minor units); else defaultAmount
 *   unit       label for one unit ("L", "packet"), optional
 *   vendor     who is paid ("Doodhwala"), the item's name when empty
 *   adjustments [{ date, was, now, unit, settledIn }]  a day changed after it was
 *              paid: (now − was) × unit goes on the next bill; settledIn is the
 *              payment entry that included it (null until then)
 *
 * Dates are plain 'YYYY-MM-DD' strings handled in UTC, so no time zone can
 * move a delivery to the next day. Every method is a pure read; the static
 * `with…` helpers return new values to store on the item.
 */
export class DeliveryPlan {
  static ALL_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
  static DAY_NAMES = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

  /** @type {object} */ #item;

  /** @param {object} item  a regular item */
  constructor(item) {
    this.#item = item || {};
  }

  // ── what the item says ──────────────────────────────────────────────

  get item()      { return this.#item; }
  get isTracked() { return this.#item.payLater === true; }
  get vendor()    { return String(this.#item.vendor || '').trim() || this.#item.name || 'Vendor'; }
  get unit()      { return String(this.#item.unit || '').trim(); }
  get usualQty()  { const q = Number(this.#item.usualQty); return Number.isFinite(q) && q >= 0 ? q : 1; }
  get trackFrom() { return DeliveryPlan.isIso(this.#item.trackFrom) ? this.#item.trackFrom : null; }

  get usualDays() {
    const d = Array.isArray(this.#item.usualDays) ? this.#item.usualDays.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6) : null;
    return d && d.length ? [...new Set(d)].sort() : [...DeliveryPlan.ALL_DAYS];
  }

  /** "Every day", "Mon–Sat", "Mon, Wed, Fri". */
  get daysLabel() {
    const d = this.usualDays;
    if (d.length === 7) return 'Every day';
    if (d.join() === '1,2,3,4,5,6') return 'Mon–Sat';
    if (d.join() === '1,2,3,4,5') return 'Mon–Fri';
    return d.map((x) => DeliveryPlan.DAY_NAMES[x]).join(', ');
  }

  /** "2 L", "1 packet", "3". */
  qtyLabel(qty) {
    const n = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
    return this.unit ? `${n} ${this.unit}` : n;
  }

  // ── one day ─────────────────────────────────────────────────────────

  /** How many on a usual `iso` (0 before tracking starts or on a day off). */
  usualOn(iso) {
    if (!this.isTracked || !DeliveryPlan.isIso(iso)) return 0;
    if (this.trackFrom && iso < this.trackFrom) return 0;
    return this.usualDays.includes(DeliveryPlan.weekday(iso)) ? this.usualQty : 0;
  }

  pausedOn(iso) {
    return (Array.isArray(this.#item.pauses) ? this.#item.pauses : [])
      .some((p) => DeliveryPlan.isIso(p?.from) && DeliveryPlan.isIso(p?.to) && iso >= p.from && iso <= p.to);
  }

  /** True when the day was marked different from the usual. */
  changedOn(iso) {
    const m = this.#item.marks;
    return !!m && Object.prototype.hasOwnProperty.call(m, iso);
  }

  /** What came on `iso`: a marked quantity, else 0 when paused, else the usual. */
  qtyOn(iso) {
    if (!this.isTracked || (this.trackFrom && iso < this.trackFrom)) return 0;
    if (this.changedOn(iso)) return Math.max(0, Number(this.#item.marks[iso]) || 0);
    if (this.pausedOn(iso)) return 0;
    return this.usualOn(iso);
  }

  /** Price of one unit on `iso`, in minor units. */
  priceOn(iso) {
    const list = DeliveryPlan.#sortedPrices(this.#item.prices);
    let price = null;
    for (const p of list) { if (p.from <= iso) price = p.unit; }
    if (price == null) price = list.length ? list[0].unit : Number(this.#item.defaultAmount) || 0;
    return price;
  }

  /** 'usual' | 'changed' | 'paused' | 'off' (not a delivery day) | 'before' (tracking hadn't started). */
  stateOn(iso) {
    if (this.trackFrom && iso < this.trackFrom) return 'before';
    if (this.changedOn(iso)) return 'changed';
    if (this.pausedOn(iso)) return 'paused';
    return this.usualOn(iso) > 0 ? 'usual' : 'off';
  }

  // ── a period ────────────────────────────────────────────────────────

  /**
   * Every day from `from` to `to` (inclusive) with what came and its cost.
   * @returns {{date: string, qty: number, unit: number, amount: number, state: string}[]}
   */
  lines(from, to) {
    if (!DeliveryPlan.isIso(from) || !DeliveryPlan.isIso(to) || from > to) return [];
    const out = [];
    for (let iso = from; iso <= to; iso = DeliveryPlan.addDays(iso, 1)) {
      const qty = this.qtyOn(iso);
      const unit = this.priceOn(iso);
      out.push({ date: iso, qty, unit, amount: Math.round(qty * unit), state: this.stateOn(iso) });
      if (out.length > 1500) break; // a runaway range (bad dates) never freezes the app
    }
    return out;
  }

  /** Totals for a period: { from, to, days (with a delivery), qty, amount, lines }. */
  totals(from, to) {
    const lines = this.lines(from, to);
    return {
      from, to, lines,
      days:   lines.filter((l) => l.qty > 0).length,
      qty:    Math.round(lines.reduce((s, l) => s + l.qty, 0) * 100) / 100,
      amount: lines.reduce((s, l) => s + l.amount, 0),
    };
  }

  // ── changes to store on the item ────────────────────────────────────

  /** New `marks` with `iso` set to `qty`; marking the usual again just clears the mark. */
  static withMark(item, iso, qty) {
    const marks = { ...(item?.marks || {}) };
    const plan = new DeliveryPlan({ ...item, marks: {} });
    const plain = plan.pausedOn(iso) ? 0 : plan.usualOn(iso);
    const q = Math.max(0, Math.round((Number(qty) || 0) * 100) / 100);
    if (q === plain) delete marks[iso]; else marks[iso] = q;
    return marks;
  }

  /** New `marks` without `iso` (back to the usual). */
  static withoutMark(item, iso) {
    const marks = { ...(item?.marks || {}) };
    delete marks[iso];
    return marks;
  }

  /** New `pauses` with [from, to] added (overlapping or touching pauses merge). */
  static withPause(item, from, to) {
    if (!DeliveryPlan.isIso(from) || !DeliveryPlan.isIso(to)) return item?.pauses || [];
    if (from > to) [from, to] = [to, from];
    const all = [...(Array.isArray(item?.pauses) ? item.pauses : []), { from, to }]
      .filter((p) => DeliveryPlan.isIso(p.from) && DeliveryPlan.isIso(p.to))
      .sort((a, b) => a.from.localeCompare(b.from));
    const merged = [];
    for (const p of all) {
      const last = merged[merged.length - 1];
      if (last && p.from <= DeliveryPlan.addDays(last.to, 1)) { if (p.to > last.to) last.to = p.to; }
      else merged.push({ ...p });
    }
    return merged;
  }

  /** New `pauses` without the one covering `iso`. */
  static withoutPause(item, iso) {
    return (Array.isArray(item?.pauses) ? item.pauses : []).filter((p) => !(iso >= p.from && iso <= p.to));
  }

  /**
   * New `prices` after the price changes to `unit` from `from`. The old price
   * is kept for the days before, so past days keep costing what they cost.
   */
  static withPrice(item, unit, from) {
    const old = Number(item?.defaultAmount) || 0;
    let list = DeliveryPlan.#sortedPrices(item?.prices);
    if (!list.length) list = [{ from: '2000-01-01', unit: old }];
    list = list.filter((p) => p.from < from);
    if (!list.length) list = [{ from: '2000-01-01', unit: old }].filter((p) => p.from < from);
    list.push({ from, unit: Math.max(0, Math.round(Number(unit) || 0)) });
    return list;
  }

  /**
   * New `adjustments` after a paid day changes from `was` to `now`. A day
   * changed twice before the next bill keeps what was paid for it; changing
   * it back to that removes the adjustment.
   */
  static withAdjustment(item, date, was, now, unit) {
    const list = (Array.isArray(item?.adjustments) ? item.adjustments : []).map((a) => ({ ...a }));
    const open = list.find((a) => a.date === date && !a.settledIn);
    const paidFor = open ? open.was : was;
    const rest = list.filter((a) => a !== open);
    if (now === paidFor) return rest;
    return [...rest, { date, was: paidFor, now, unit: open ? open.unit : unit, settledIn: null }]
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Adjustments still to go on a bill: [{ date, was, now, unit, amount }]. */
  openAdjustments() {
    return (Array.isArray(this.#item.adjustments) ? this.#item.adjustments : [])
      .filter((a) => a && !a.settledIn && DeliveryPlan.isIso(a.date))
      .map((a) => ({ ...a, amount: Math.round((Number(a.now) - Number(a.was)) * Number(a.unit)) }));
  }

  /** `adjustments` with the open ones marked as included in payment `ref` (the entry's id). */
  static settleAdjustments(item, ref) {
    return (Array.isArray(item?.adjustments) ? item.adjustments : []).map((a) => (a.settledIn ? a : { ...a, settledIn: ref }));
  }

  /** `adjustments` open again where their payment is no longer there. */
  static unsettleAdjustments(item, isGone) {
    return (Array.isArray(item?.adjustments) ? item.adjustments : []).map((a) => (a.settledIn && isGone(a.settledIn) ? { ...a, settledIn: null } : a));
  }

  /** `marks` with days before `iso` dropped (they're paid and nobody edits them). */
  static marksFrom(marks, iso) {
    return Object.fromEntries(Object.entries(marks || {}).filter(([d]) => d >= iso));
  }

  // ── dates ───────────────────────────────────────────────────────────

  static isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  static addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
  }

  static weekday(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  /** "3 Nov" / "3 Nov 2026". */
  static shortDate(iso, withYear = false) {
    const [y, m, d] = iso.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d} ${months[m - 1]}${withYear ? ` ${y}` : ''}`;
  }

  /** "1–15 Nov 2026", "28 Oct – 3 Nov 2026". */
  static rangeLabel(from, to) {
    if (from === to) return DeliveryPlan.shortDate(from, true);
    const [fy, fm] = from.split('-');
    const [ty, tm] = to.split('-');
    if (fy === ty && fm === tm) return `${Number(from.slice(8))}–${DeliveryPlan.shortDate(to, true)}`;
    return `${DeliveryPlan.shortDate(from, fy !== ty)} – ${DeliveryPlan.shortDate(to, true)}`;
  }

  static #sortedPrices(prices) {
    return (Array.isArray(prices) ? prices : [])
      .filter((p) => DeliveryPlan.isIso(p?.from) && Number.isFinite(Number(p?.unit)))
      .map((p) => ({ from: p.from, unit: Number(p.unit) }))
      .sort((a, b) => a.from.localeCompare(b.from));
  }
}
