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
import { LedgerMath }     from './LedgerMath.js';
import { HijriCalendarService } from './HijriCalendarService.js';

export class TransactionService {
  /** @type {Store} */                 #store;
  /** @type {AccountService} */        #accounts;
  /** @type {CurrencyService} */       #fx;
  /** @type {HijriCalendarService} */ #hijri;

  constructor({
    store    = Store.getInstance(),
    accounts = new AccountService(),
    fx       = new CurrencyService(),
    hijri    = new HijriCalendarService(),
  } = {}) {
    this.#store    = store;
    this.#accounts = accounts;
    this.#fx       = fx;
    this.#hijri    = hijri;
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
    if (!account) return { dir: '', minorInAcc: 0 };
    // Delegate to the single ledger authority so the per-row figure shown in
    // account detail uses the SAME rate-frozen amount as the running balance
    // (previously this re-converted at the live rate and, for split rows, used
    // the whole tx amount rather than this account's share).
    const delta = LedgerMath.accountDelta(tx, account, this.#fx);
    return {
      dir:        delta < 0 ? '-' : delta > 0 ? '+' : '',
      minorInAcc: Math.abs(delta),
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
    // Sort a COPY (never reorder the caller's source-of-truth array) and treat a
    // missing date as '' so a malformed record can't throw on localeCompare.
    const out = arr.slice();
    const d   = (t) => t.date || '';

    switch (sortKey) {
      case 'date-asc':    return out.sort((a, b) => d(a).localeCompare(d(b)));
      case 'amount-desc': return out.sort((a, b) => amt(b) - amt(a));
      case 'amount-asc':  return out.sort((a, b) => amt(a) - amt(b));
      case 'payee-asc':   return out.sort((a, b) => (a.payee || '').localeCompare(b.payee || '') || d(b).localeCompare(d(a)));
      case 'payee-desc':  return out.sort((a, b) => (b.payee || '').localeCompare(a.payee || '') || d(b).localeCompare(d(a)));
      case 'date-desc':
      default:            return out.sort((a, b) => d(b).localeCompare(d(a)));
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
      // Optional rate-frozen account-currency amount (foreign-currency tx). When
      // absent, AccountService.recompute() freezes it at the live rate.
      acctMinor:      Number.isFinite(data.acctMinor) ? data.acctMinor : undefined,
      recurring:      data.recurring      || null,
      recurringSourceId: data.recurringSourceId || null,
      createdAt:      data.createdAt      || new Date().toISOString(),
      addedBy:        data.addedBy        || null,
    };

    state.transactions.push(tx);
    // Balances are derived: flush() triggers the Store's recompute hook.
    this.#store.flush();
    return tx;
  }

  // ── Update ───────────────────────────────────────────────────────────

  /**
   * Update an existing transaction. Balances are derived, so we only mutate the
   * ledger and flush. For transfers we ALSO mirror the relevant changes onto the
   * paired leg — otherwise editing one leg's amount/currency/date leaves the
   * counter-account out of balance.
   * @param {string} id
   * @param {object} changes
   * @returns {object|null}
   */
  update(id, changes) {
    const tx = this.find(id);
    if (!tx) return null;

    Object.assign(tx, changes);

    // Any change to amount/currency/account/splits invalidates the rate-frozen
    // account-currency impact (acctMinor); clear it so recompute() re-freezes at
    // the new values. Otherwise the derived balance would keep using the stale,
    // pre-edit figure.
    if (!('acctMinor' in changes) && ['amount', 'currency', 'accountId', 'splits'].some((k) => k in changes)) {
      delete tx.acctMinor;
      if (Array.isArray(tx.splits)) for (const sp of tx.splits) delete sp.acctMinor;
    }

    if (tx.type === 'transfer' && tx.transferPairId) {
      const pair = this.find(tx.transferPairId);
      if (pair) {
        // Mirror only the fields that must stay in sync across both legs;
        // never copy id/accountId/transferDir (those are leg-specific).
        const mirror = {};
        for (const k of ['amount', 'currency', 'date', 'note', 'payee', 'transferRate']) {
          if (k in changes) mirror[k] = changes[k];
        }
        Object.assign(pair, mirror);
        if ('amount' in changes || 'c