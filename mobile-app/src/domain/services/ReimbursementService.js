/**
 * ReimbursementService — money someone pays you back for an expense
 * (a company, an insurer, family or a friend).
 *
 * How it's stored:
 *
 *   • the EXPENSE carries
 *       reimbBy        who pays back ("Company", "Star Health")
 *       reimbExpected  how much back, in the expense's currency (minor units)
 *       reimbClosed    true once nothing more is expected (the rest won't come)
 *       claimId        optional — groups several expenses (state.claims)
 *
 *   • each PAYMENT is a separate entry: type 'income' (so the account balance
 *     goes up) tagged 'reimbursement', with
 *       reimbBy, claimId
 *       reimbAlloc     [{ txId, amount, pay }] — `amount` is in the expense's
 *                      currency, `pay` in the payment's own currency
 *       reimbExtra     money paid over what was owed (payment currency)
 *       reimbExtraAs   'income' — count the extra as income
 *                      'keep'   — keep it as credit for this payer's next item
 *
 * A payment is never income (CountedEntries leaves it out); only an extra
 * marked 'income' is. The expense itself is never changed: it keeps its full
 * amount for reference and spending counts it net of what came back.
 *
 * Pure: reads a state snapshot, never writes it. Building the entries is
 * done by the caller (Application) from the plans returned here.
 */
export class ReimbursementService {
  static TAG = 'reimbursement';

  /** @type {object} */ #state;
  /** @type {Map<string, {amount:number, last:string|null, dates:string[]}>|null} */ #paid = null;

  /** @param {object} state */
  constructor(state) {
    this.#state = state || {};
  }

  // ── What an entry is ────────────────────────────────────────────────

  /** A payback entry (money in from the payer). */
  static isPayment(t) {
    return !!t && Array.isArray(t.tags) && t.tags.includes(ReimbursementService.TAG);
  }

  /** A loan given or taken, or a repayment of one (Debts). */
  static isDebtEntry(t) {
    if (!t) return false;
    if (t.debtRole) return true;
    return Array.isArray(t.tags) && (t.tags.includes('debt') || t.tags.includes('debt-payment'));
  }

  /** An expense someone will pay back. */
  static isTracked(t) {
    return !!t && t.type === 'expense' && !!String(t.reimbBy || '').trim();
  }

  /** The amount expected back (defaults to the whole expense). */
  static expected(t) {
    const full = Number(t?.amount) || 0;
    const e = Number(t?.reimbExpected);
    return Number.isFinite(e) && e > 0 ? Math.min(e, full) : full;
  }

  // ── Per expense ─────────────────────────────────────────────────────

  /** Paid back so far for an expense, in its own currency (minor). */
  paidBack(txId) {
    return this.#paidMap().get(txId)?.amount || 0;
  }

  /**
   * Everything about one tracked expense.
   * @returns {{expected:number, paid:number, outstanding:number, closed:boolean,
   *            settled:boolean, pct:number, last:string|null, payer:string, claimId:string|null}}
   */
  status(t) {
    const expected = ReimbursementService.expected(t);
    const p = this.#paidMap().get(t.id);
    const paid = Math.min(p?.amount || 0, Number(t.amount) || 0);
    const closed = t.reimbClosed === true;
    const outstanding = closed ? 0 : Math.max(0, expected - paid);
    const base = expected || 1;
    return {
      expected,
      paid,
      outstanding,
      closed,
      settled: outstanding === 0,
      // What came back, as a share of what was expected (never of what's missing).
      pct: Math.round(Math.min(1, paid / base) * 100),
      last: p?.last || null,
      payer: String(t.reimbBy || '').trim(),
      claimId: t.claimId || null,
    };
  }

  /** Expenses still waiting to be paid back. */
  outstanding() {
    return (this.#state.transactions || [])
      .filter((t) => ReimbursementService.isTracked(t))
      .map((t) => ({ tx: t, ...this.status(t) }))
      .filter((r) => r.outstanding > 0)
      .sort((a, b) => a.tx.date.localeCompare(b.tx.date));
  }

  /** Every tracked expense (open or settled). */
  tracked() {
    return (this.#state.transactions || [])
      .filter((t) => ReimbursementService.isTracked(t))
      .map((t) => ({ tx: t, ...this.status(t) }));
  }

  /** Names used before, most used first — for the payer suggestions. */
  payers() {
    const n = new Map();
    for (const t of this.#state.transactions || []) {
      const p = String(t.reimbBy || '').trim();
      if (p) n.set(p, (n.get(p) || 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }

  /** The claim with this id, or null. */
  claim(id) {
    return (this.#state.claims || []).find((c) => c.id === id) || null;
  }

  // ── Groups (the Reimbursements section) ─────────────────────────────

  /** The group key of a tracked expense: its claim, else its payer. */
  static groupKey(t) {
    return t.claimId ? `claim:${t.claimId}` : `payer:${String(t.reimbBy || '').trim().toLowerCase()}`;
  }

  /**
   * Open items grouped by claim (when they have one) or payer.
   * @returns {{key, label, payer, claim, items, outstanding, expected, paid, currency, credit}[]}
   */
  groups() {
    const map = new Map();
    for (const r of this.outstanding()) {
      const key = ReimbursementService.groupKey(r.tx);
      if (!map.has(key)) {
        const claim = r.claimId ? this.claim(r.claimId) : null;
        map.set(key, {
          key,
          payer: r.payer,
          claim,
          label: claim ? claim.name : r.payer,
          items: [],
          outstanding: 0,
          expected: 0,
          paid: 0,
          currency: r.tx.currency,
          mixed: false,
        });
      }
      const g = map.get(key);
      g.items.push(r);
      if (r.tx.currency !== g.currency) g.mixed = true;
      g.outstanding += r.outstanding;
      g.expected += r.expected;
      g.paid += r.paid;
    }
    for (const g of map.values()) g.credit = this.credit(g.payer);
    return [...map.values()].sort((a, b) => a.items[0].tx.date.localeCompare(b.items[0].tx.date));
  }

  /** A group by key — open items only. */
  group(key) {
    return this.groups().find((g) => g.key === key) || null;
  }

  // ── Credit (extra kept for the next item) ───────────────────────────

  /**
   * Payments from this payer whose extra was kept, with what's left of it.
   * @returns {{tx:object, left:number}[]}  left in the payment's currency
   */
  creditEntries(payer) {
    const p = String(payer || '').trim().toLowerCase();
    return (this.#state.transactions || [])
      .filter((t) => ReimbursementService.isPayment(t) && t.reimbExtraAs === 'keep'
        && String(t.reimbBy || '').trim().toLowerCase() === p)
      .map((t) => {
        const used = (t.reimbAlloc || []).reduce((n, a) => n + (Number(a.pay) || 0), 0);
        return { tx: t, left: Math.max(0, (Number(t.amount) || 0) - used) };
      })
      .filter((c) => c.left > 0)
      .sort((a, b) => a.tx.date.localeCompare(b.tx.date));
  }

  /** Total credit kept for a payer (in the first credit entry's currency). */
  credit(payer) {
    return this.creditEntries(payer).reduce((n, c) => n + c.left, 0);
  }

  // ── Sharing a payment across items ──────────────────────────────────

  /**
   * Split `total` across items.
   *
   *   spread  — each item gets the same share of what it's owed (pro-rata)
   *   oldest  — fills the oldest item first, then the next
   *   items   — `perItem[txId]` is typed by the user
   *
   * Amounts are in one currency (the caller converts). The last item absorbs
   * rounding so the parts add up exactly to what was shared.
   *
   * @param {{id:string, outstanding:number}[]} items  in date order
   * @param {number} total
   * @param {'spread'|'oldest'|'items'} mode
   * @param {Object<string, number>} [perItem]
   * @returns {{ parts: {txId:string, amount:number}[], used:number, extra:number }}
   */
  static allocate(items, total, mode = 'spread', perItem = {}) {
    const want = Math.max(0, Math.round(Number(total) || 0));
    const owed = items.reduce((n, i) => n + Math.max(0, i.outstanding), 0);
    const parts = [];

    if (mode === 'items') {
      let used = 0;
      for (const i of items) {
        const a = Math.max(0, Math.min(i.outstanding, Math.round(Number(perItem[i.id]) || 0)));
        if (a > 0) { parts.push({ txId: i.id, amount: a }); used += a; }
      }
      return { parts, used, extra: Math.max(0, want - used) };
    }

    const share = Math.min(want, owed);
    if (mode === 'oldest') {
      let left = share;
      for (const i of items) {
        if (left <= 0) break;
        const a = Math.min(left, i.outstanding);
        if (a > 0) { parts.push({ txId: i.id, amount: a }); left -= a; }
      }
    } else {
      let given = 0;
      const open = items.filter((i) => i.outstanding > 0);
      open.forEach((i, k) => {
        const a = k === open.length - 1
          ? share - given
          : Math.floor((share * i.outstanding) / (owed || 1));
        const capped = Math.max(0, Math.min(a, i.outstanding));
        if (capped > 0) { parts.push({ txId: i.id, amount: capped }); given += capped; }
      });
      // Rounding can leave a unit or two when the last item was capped.
      let rest = share - given;
      for (const p of parts) {
        if (rest <= 0) break;
        const i = open.find((o) => o.id === p.txId);
        const room = i.outstanding - p.amount;
        const add = Math.min(room, rest);
        p.amount += add; rest -= add;
      }
    }
    const used = parts.reduce((n, p) => n + p.amount, 0);
    return { parts, used, extra: Math.max(0, want - used) };
  }

  // ── Internals ───────────────────────────────────────────────────────

  #paidMap() {
    if (this.#paid) return this.#paid;
    const m = new Map();
    for (const t of this.#state.transactions || []) {
      if (!ReimbursementService.isPayment(t)) continue;
      for (const a of t.reimbAlloc || []) {
        if (!a || !a.txId) continue;
        const cur = m.get(a.txId) || { amount: 0, last: null, dates: [] };
        cur.amount += Math.max(0, Number(a.amount) || 0);
        const d = a.date || t.date;
        if (!cur.last || d > cur.last) cur.last = d;
        cur.dates.push(d);
        m.set(a.txId, cur);
      }
    }
    this.#paid = m;
    return m;
  }
}
