/**
 * LedgerEntries — a book's transactions as flat rows a report can filter,
 * group and total:
 *
 *   • a split transaction gives one row per slice (its own category, account
 *     and amount), so a category or account filter counts exactly its share
 *   • a transfer gives ONE row (from → to), not one per leg
 *
 * Every row carries its amount in its own currency and in the home currency
 * (converted the same way the Reports screen converts), and its signed home
 * amount: income +, expense −, transfers 0 (they move money, they don't earn
 * or spend it).
 */
import { CurrencyService } from '../services/CurrencyService.js';
import { HijriCalendarService } from '../services/HijriCalendarService.js';
import { ReimbursementService } from '../services/ReimbursementService.js';

export class LedgerEntries {
  #state;
  #fx;
  #hijri;
  #accounts;
  #categories;
  #reimb;

  /**
   * @param {object} state  a book (or a shared space's projection of one)
   * @param {{fx?: CurrencyService, hijri?: HijriCalendarService}} [deps]
   */
  constructor(state, { fx = new CurrencyService(), hijri = new HijriCalendarService() } = {}) {
    this.#state = state;
    this.#fx = fx;
    this.#hijri = hijri;
    this.#accounts = new Map((state.accounts || []).map((a) => [a.id, a]));
    this.#categories = new Map((state.categories || []).map((c) => [c.id, c]));
    this.#reimb = new ReimbursementService(state);
  }

  get homeCurrency() {
    return this.#state.user?.homeCurrency || this.#state.homeCurrency || 'USD';
  }

  /** @returns {object[]} rows, oldest first */
  all() {
    const txs = this.#state.transactions || [];
    const byId = new Map(txs.map((t) => [t.id, t]));
    const rows = [];
    for (const t of txs) {
      if (!t?.date) continue;
      if (t.type === 'transfer') {
        const pair = t.transferPairId ? byId.get(t.transferPairId) : null;
        // One row per transfer, from its outgoing leg (or the only leg we can see).
        if (pair && t.transferDir === 'in') continue;
        if (pair && !t.transferDir && pair.transferDir === 'out') continue;
        rows.push(this.#transferRow(t, pair));
        continue;
      }
      const slices = Array.isArray(t.splits) && t.splits.length
        ? t.splits.map((s) => ({ accountId: s.accountId || t.accountId, categoryId: s.categoryId || null, amount: Number(s.amount) || 0 }))
        : [{ accountId: t.accountId, categoryId: t.categoryId || null, amount: Number(t.amount) || 0 }];
      slices.forEach((s, i) => rows.push(this.#row(t, s, slices.length > 1 ? i + 1 : 0)));
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  }

  /** "Travel / Taxi" for a sub-category, "Travel" for a main one. */
  categoryPath(id) {
    const c = this.#categories.get(id);
    if (!c) return '';
    const parent = c.parentId ? this.#categories.get(c.parentId) : null;
    return parent ? `${parent.name} / ${c.name}` : c.name;
  }

  /** The main category of a category (itself when it has no parent). */
  mainCategory(id) {
    const c = this.#categories.get(id);
    if (!c) return null;
    return (c.parentId && this.#categories.get(c.parentId)) || c;
  }

  account(id) {
    return this.#accounts.get(id) || null;
  }

  #row(t, slice, part) {
    const home = this.homeCurrency;
    const homeAmount = this.#fx.convert(slice.amount, t.currency, home);
    const sign = t.type === 'income' ? 1 : t.type === 'expense' ? -1 : 0;
    return {
      id: part ? `${t.id}#${part}` : t.id,
      txId: t.id,
      order: part,
      date: t.date,
      hijri: this.#hijriLabel(t),
      type: t.type,
      accountId: slice.accountId,
      accountName: this.account(slice.accountId)?.name || '',
      toAccountId: null,
      categoryId: slice.categoryId,
      categoryPath: this.categoryPath(slice.categoryId) || (t.type === 'income' || t.type === 'expense' ? 'Uncategorised' : ''),
      payee: t.payee || '',
      note: t.note || '',
      paymentType: t.paymentType || '',
      amount: slice.amount,
      currency: t.currency,
      homeAmount,
      signedHome: sign * homeAmount,
      addedBy: t.addedBy || '',
      split: part > 0,
      source: LedgerEntries.sourceOf(t),
      ...this.#counting(t, homeAmount),
    };
  }

  /**
   * How a row counts towards income and spending totals (CountedEntries):
   * loans, repayments and paybacks count nothing; a paid-back expense counts
   * what the user bore. Also the reimbursement columns.
   */
  #counting(t, homeAmount) {
    const full = Number(t.amount) || 0;
    const sign = t.type === 'income' ? 1 : t.type === 'expense' ? -1 : 0;
    const out = { countedHome: homeAmount, reimbBy: '', paidBackHome: null, reimbPct: null, kind: '' };
    if (ReimbursementService.isDebtEntry(t)) {
      out.countedHome = 0; out.kind = 'Loan';
    } else if (ReimbursementService.isPayment(t)) {
      const extra = t.reimbExtraAs === 'income' ? Math.min(Number(t.reimbExtra) || 0, full) : 0;
      out.countedHome = full ? Math.round(homeAmount * (extra / full)) : 0;
      out.reimbBy = t.reimbBy || '';
      out.kind = 'Paid back';
    } else if (ReimbursementService.isTracked(t)) {
      const st = this.#reimb.status(t);
      const f = full ? st.paid / full : 0;
      out.countedHome = Math.round(homeAmount * (1 - f));
      out.reimbBy = st.payer;
      out.paidBackHome = Math.round(homeAmount * f);
      out.reimbPct = st.pct / 100;
    }
    out.countedSigned = sign * out.countedHome;
    return out;
  }

  /**
   * Where an entry came from: 'Bill' (a repeat, or a payment of one),
   * 'Delivery payment' (paying a vendor for delivered days), 'Shortcut', or ''.
   */
  static sourceOf(t) {
    if (t.settles) return 'Delivery payment';
    if (t.recurring || t.recurringSourceId) return 'Bill';
    if (t.regularItemId) return 'Shortcut';
    return '';
  }

  #transferRow(t, pair) {
    const out = t.transferDir === 'in' && pair ? pair : t;
    const into = out === t ? pair : t;
    const from = this.account(out.accountId);
    const to = into ? this.account(into.accountId) : null;
    return {
      id: out.id,
      txId: out.id,
      order: 0,
      date: out.date,
      hijri: this.#hijriLabel(out),
      type: 'transfer',
      accountId: out.accountId,
      accountName: `${from?.name || '—'} → ${to?.name || '—'}`,
      fromAccountId: out.accountId,
      toAccountId: into?.accountId || null,
      categoryId: null,
      categoryPath: '',
      payee: out.payee && out.payee !== 'Transfer' ? out.payee : '',
      note: out.note || into?.note || '',
      paymentType: out.paymentType || 'transfer',
      amount: Number(out.amount) || 0,
      currency: out.currency,
      receivedAmount: into ? Number(into.amount) || 0 : null,
      receivedCurrency: into?.currency || null,
      homeAmount: this.#fx.convert(Number(out.amount) || 0, out.currency, this.homeCurrency),
      signedHome: 0,
      countedHome: 0,
      countedSigned: 0,
      reimbBy: '',
      paidBackHome: null,
      reimbPct: null,
      kind: '',
      addedBy: out.addedBy || '',
      split: false,
    };
  }

  #hijriLabel(t) {
    const h = t.hijriDate && typeof t.hijriDate === 'object' ? t.hijriDate : this.#hijri.toHijri(t.date);
    if (!h) return { year: 0, month: 0, day: 0, label: '' };
    const name = this.#hijri.monthsShort[h.month] || '';
    return { year: h.year, month: h.month, day: h.day, label: `${h.day} ${name} ${h.year}` };
  }
}
