/**
 * DebtService — debt CRUD, repayments, and the audited delete / mark-paid
 * semantics from the web app (findings M7 and L6).
 *
 * A debt is a record plus linked ledger transactions:
 *   - the INITIAL transaction (`debtRole:'initial'`), booked to the account,
 *     income for borrowed money, expense for money lent out
 *   - zero or more PAYMENT transactions (`debtRole:'payment'`), the reverse
 *
 * Balances stay derived — this service only mutates the ledger + the debt row.
 */
import { Store }                from '../../core/Store.js';
import { CurrencyService }      from './CurrencyService.js';
import { HijriCalendarService } from './HijriCalendarService.js';
import { IdGenerator }          from './IdGenerator.js';
import { RATES }                from './FxRates.js';

export class DebtService {
  /** @type {Store} */ #store;
  /** @type {CurrencyService} */ #fx;
  /** @type {HijriCalendarService} */ #hijri;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
    this.#hijri = new HijriCalendarService();
  }

  /** @returns {object[]} */
  all() {
    const s = this.#store.getState();
    if (!Array.isArray(s.debts)) s.debts = [];
    return s.debts;
  }

  /**
   * Outstanding balance in the debt's currency (payments converted, never < 0).
   * @param {object} debt @returns {number} minor units
   */
  remaining(debt) {
    const txs = this.#store.getState().transactions.filter(
      (t) => t.debtId === debt.id && t.id !== debt.initialTxId);
    const paid = txs.reduce(
      (s, t) => s + this.#fx.convert(t.amount, t.currency || debt.currency, debt.currency), 0);
    return Math.max(0, debt.principal - paid);
  }

  /**
   * Create a debt and its initial ledger transaction.
   * @param {object} data { type:'borrowed'|'lent', counterparty, principal (major),
   *                        currency, accountId, dueDate?, note? }
   * @returns {{ok:true, debt:object}|{ok:false, reason:string}}
   */
  create(data) {
    const state = this.#store.getState();
    const currency = data.currency;
    const principal = this.#fx.toMinor(data.principal, currency);
    if (!(principal > 0)) return { ok: false, reason: 'Principal must be positive' };
    if (!data.counterparty?.trim()) return { ok: false, reason: 'Add a counterparty' };
    const acc = state.accounts.find((a) => a.id === data.accountId);
    if (!acc) return { ok: false, reason: 'Pick an account' };

    const isBorrowed = data.type === 'borrowed';
    const today = data.date || new Date().toISOString().slice(0, 10);
    const txId  = IdGenerator.generate('tx');
    const debtId = IdGenerator.generate('debt');

    state.transactions.push({
      id: txId, accountId: acc.id, categoryId: null,
      amount: principal, currency,
      exchangeRate: (RATES[currency] || 1) / (RATES[state.user.homeCurrency] || 1),
      refAmount: this.#fx.convert(principal, currency, state.user.homeCurrency),
      payee: data.counterparty.trim(), note: data.note || '',
      date: today, hijriDate: this.#hijri.toHijri(today),
      paymentType: 'transfer', recordState: 'cleared',
      type: isBorrowed ? 'income' : 'expense',
      transferPairId: null, splits: null, tags: ['debt'],
      debtId, debtRole: 'initial',
    });
    const debt = {
      id: debtId, type: data.type, counterparty: data.counterparty.trim(),
      principal, currency, accountId: acc.id, dueDate: data.dueDate || null,
      note: data.note || '', status: 'active', initialTxId: txId,
    };
    state.debts.push(debt);
    this.#store.flush();
    return { ok: true, debt };
  }

  /**
   * Record a repayment against a debt.
   * @param {object} debt @param {number} amountMajor @param {string} accountId
   * @returns {{ok:true, cleared:boolean}|{ok:false, reason:string}}
   */
  addPayment(debt, amountMajor, accountId, opts = {}) {
    const state = this.#store.getState();
    const minor = this.#fx.toMinor(amountMajor, debt.currency);
    if (!(minor > 0)) return { ok: false, reason: 'Enter an amount' };
    const acc = state.accounts.find((a) => a.id === accountId);
    if (!acc) return { ok: false, reason: 'Pick an account' };

    const isBorrowed = debt.type === 'borrowed';
    const date = (opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)) ? opts.date : new Date().toISOString().slice(0, 10);
    state.transactions.push({
      id: IdGenerator.generate('tx'), accountId, categoryId: null,
      amount: minor, currency: debt.currency,
      exchangeRate: (RATES[debt.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
      refAmount: this.#fx.convert(minor, debt.currency, state.user.homeCurrency),
      payee: debt.counterparty, note: opts.note || 'Repayment',
      date, hijriDate: this.#hijri.toHijri(date),
      paymentType: 'transfer', recordState: 'cleared',
      type: isBorrowed ? 'expense' : 'income',
      transferPairId: null, splits: null, tags: ['debt-payment'],
      debtId: debt.id, debtRole: 'payment',
    });
    const cleared = this.remaining(debt) <= 0;
    if (cleared) debt.status = 'paid';
    this.#store.flush();
    return { ok: true, cleared };
  }

  /**
   * Close a debt with an outstanding balance (audit L6 — three real cases).
   * @param {object} debt
   * @param {'paid'|'external'} how  'paid' logs a settlement; 'external' does not
   * @param {string} [accountId]  required when how === 'paid'
   * @returns {{ok:true}|{ok:false, reason:string}}
   */
  markPaid(debt, how, accountId) {
    const rem = this.remaining(debt);
    if (rem > 0 && how === 'paid') {
      const r = this.addPayment(debt, this.#fx.fromMinor(rem, debt.currency), accountId
        || debt.accountId || this.#store.getState().accounts[0]?.id);
      if (!r.ok) return r;
    }
    debt.status = 'paid';
    if (how === 'external') { debt.settledExternally = true; }
    this.#store.flush();
    return { ok: true };
  }

  /**
   * Delete a debt (audit M7).
   * @param {object} debt
   * @param {boolean} destroyTransactions  true → remove the whole ledger
   *   footprint (original + repayments); false → keep everything, just unlink
   * @returns {number} transactions affected
   */
  delete(debt, destroyTransactions) {
    const state = this.#store.getState();
    const linked = state.transactions.filter(
      (t) => t.debtId === debt.id || t.id === debt.initialTxId);
    if (destroyTransactions) {
      state.transactions = state.transactions.filter(
        (t) => t.debtId !== debt.id && t.id !== debt.initialTxId);
    } else {
      state.transactions.forEach((t) => {
        if (t.debtId === debt.id || t.id === debt.initialTxId) { t.debtId = null; t.debtRole = null; }
      });
    }
    state.debts = this.all().filter((d) => d.id !== debt.id);
    this.#store.flush();
    return linked.length;
  }
}
