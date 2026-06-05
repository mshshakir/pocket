/**
 * TransactionService — Transaction CRUD, splits, filtering, sorting.
 *
 * Coordinates between AccountService (balance updates) and Store
 * (persistence).  No DOM.
 */
import { Store }          from '../../core/Store.js';
import { IdGenerator }    from './IdGenerator.js';
import { AccountService } from './AccountService.js';
import { CurrencyService } from './CurrencyService.js';
import { HijriCalendarService } from './HijriCalendarService.js';

export class TransactionService {
  /** @type {Store} */                 #store;
  /** @type {AccountService} */        #accounts;
  /** @type {CurrencyService} */       #fx;
  /** @type {HijriCalendarService} */ #hijri;

  constructor() {
    this.#store    = Store.getInstance();
    this.#accounts = new AccountService();
    this.#fx       = new CurrencyService();
    this.#hijri    = new HijriCalendarService();
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /**
   * Find a transaction by ID.
   * @param {string} id
   * @returns {object|undefined}
   */
  find(id) {
    return this.#store.getState().transactions.find((t) => t.id === id);
  }

  /**
   * Return category amounts for a transaction.
   * Non-split:  [{ categoryId, amount, currency }]
   * Split:      one entry per split row
   * @param {object} tx
   * @returns {{ categoryId: string|null, amount: number, currency: string }[]}
   */
  categoryAmounts(tx) {
    if (Array.isArray(tx.splits) && tx.splits.length) {
      return tx.splits.map((s) => ({
        categoryId: s.categoryId || null,
        amount:     s.amount,
        currency:   tx.currency,
      }));
    }
    return [{ categoryId: tx.categoryId || null, amount: tx.amount, currency: tx.currency }];
  }

  /**
   * Compute the directional impact of a transaction on a given account.
   * Used by the account-detail view to show the correct sign/amount.
   * @param {object} tx
   * @param {object} account
   * @returns {{ dir: '+'|'-'|'', minorInAcc: number }}
   */
  impactOnAccount(tx, account) {
    if (tx.type === 'transfer') {
      // Convert to the account's currency for every leg (B3) — the in-leg used
      // raw tx.amount, which only happened to be correct when its currency
      // matched the account's.
      const m = this.#fx.convert(tx.amount, tx.currency, account.currency);
      if (tx.transferDir === 'out') return { dir: '-', minorInAcc: m };
      if (tx.transferDir === 'in')  return { dir: '+', minorInAcc: m };
      return { dir: '', minorInAcc: m };
    }
    const converted = this.#fx.convert(tx.amount, tx.currency, account.currency);
    return {
      dir:        tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : '',
      minorInAcc: converted,
    };
  }

  // ── Sorting ──────────────────────────────────────────────────────────

  /**
   * Sort a transactions array in-place.
   * @param {object[]} arr
   * @param {'date-desc'|'date-asc'|'amount-desc'|'amount-asc'|'payee-asc'|'payee-desc'} sortKey
   * @param {Function} [amountFn]  (tx) => number override for amount comparison
   * @returns {object[]}
   */
  sort(arr, sortKey, amountFn) {
    const home = this.#store.getState().user.homeCurrency;
    const amt  = amountFn ?? ((t) => Math.abs(this.#fx.convert(t.amount, t.currency, home)));

    switch (sortKey) {
      case 'date-asc':    return arr.sort((a, b) => a.date.localeCompare(b.date));
      case 'amount-desc': return arr.sort((a, b) => amt(b) - amt(a));
      case 'amount-asc':  return arr.sort((a, b) => amt(a) - amt(b));
      case 'payee-asc':   return arr.sort((a, b) => (a.payee || '').localeCompare(b.payee || '') || b.date.localeCompare(a.date));
      case 'payee-desc':  return arr.sort((a, b) => (b.payee || '').localeCompare(a.payee || '') || b.date.localeCompare(a.date));
      case 'date-desc':
      default:            return arr.sort((a, b) => b.date.localeCompare(a.date));
    }
  }

  // ── Create ───────────────────────────────────────────────────────────

  /**
   * Create a new transaction (and update account balances).
   * @param {object} data
   * @returns {object}
   */
  create(data) {
    const state = this.#store.getState();
    const tx = {
      id:             IdGenerator.generate('tx'),
      accountId:      data.accountId,
      categoryId:     data.categoryId     || null,
      amount:         data.amount,
      currency:       data.currency,
      exchangeRate:   data.exchangeRate   || 1,
      refAmount:      data.refAmount      || data.amount,
      payee:          data.payee          || '',
      note:           data.note           || '',
      date:           data.date,
      // Snapshot the Hijri date at creation time using the user's current offset.
      // This value is immutable after save — BudgetService reads it instead of
      // recomputing, so future offset changes never affect past-transaction budgets.
      hijriDate:      this.#hijri.toHijri(data.date),
      paymentType:    data.paymentType    || 'card',
      recordState:    data.recordState    || 'cleared',
      type:           data.type,
      transferPairId: data.transferPairId || null,
      transferDir:    data.transferDir    || null,
      transferRate:   data.transferRate   || null,
      tags:           data.tags           || [],
      splits:         data.splits         || null,
      recurring:      data.recurring      || null,
      recurringSourceId: data.recurringSourceId || null,
      createdAt:      data.createdAt      || new Date().toISOString(),
      addedBy:        data.addedBy        || null,
    };

    state.transactions.push(tx);
    this.#accounts.applyBalances(tx);
    this.#store.flush();
    return tx;
  }

  // ── Update ───────────────────────────────────────────────────────────

  /**
   * Update an existing transaction.
   * Revertes old balances, applies new ones.
   * @param {string} id
   * @param {object} changes
   * @returns {object|null}
   */
  update(id, changes) {
    const tx = this.find(id);
    if (!tx) return null;

    this.#accounts.revertBalances(tx);
    Object.assign(tx, changes);
    this.#accounts.applyBalances(tx);
    this.#store.flush();
    return tx;
  }

  // ── Delete ───────────────────────────────────────────────────────────

  /**
   * Delete a transaction (and its transfer pair if applicable).
   * @param {string} id
   */
  delete(id) {
    const state = this.#store.getState();
    const tx    = this.find(id);
    if (!tx) return;

    this.#accounts.revertBalances(tx);

    if (tx.type === 'transfer' && tx.transferPairId) {
      const pair = this.find(tx.transferPairId);
      if (pair) {
        this.#accounts.revertBalances(pair);
        state.transactions = state.transactions.filter((t) => t.id !== pair.id);
      }
    }

    state.transactions = state.transactions.filter((t) => t.id !== id);
    this.#store.flush();
  }

  /**
   * Bulk-delete transactions by ID array.
   * @param {string[]} ids
   */
  bulkDelete(ids) {
    const idSet = new Set(ids);
    const state = this.#store.getState();
    const pairs = new Set();

    state.transactions.forEach((t) => {
      if (idSet.has(t.id)) {
        this.#accounts.revertBalances(t);
        if (t.type === 'transfer' && t.transferPairId) pairs.add(t.transferPairId);
      }
    });

    // Also revert + remove transfer pairs
    state.transactions.forEach((t) => {
      if (pairs.has(t.id) && !idSet.has(t.id)) {
        this.#accounts.revertBalances(t);
        idSet.add(t.id);
      }
    });

    state.transactions = state.transactions.filter((t) => !idSet.has(t.id));
    this.#store.flush();
  }
}
