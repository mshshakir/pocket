/**
 * AccountService — Account CRUD and balance management.
 *
 * All mutations are applied through Store so persistence and event
 * propagation happen automatically.  No DOM access.
 */
import { Store }          from '../../core/Store.js';
import { IdGenerator }    from './IdGenerator.js';
import { CurrencyService } from './CurrencyService.js';

export class AccountService {
  /** @type {Store} */       #store;
  /** @type {CurrencyService} */ #fx;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /**
   * Find an account by ID.
   * @param {string} id
   * @returns {object|undefined}
   */
  find(id) {
    return this.#store.getState().accounts.find((a) => a.id === id);
  }

  /**
   * All non-archived accounts.
   * @returns {object[]}
   */
  active() {
    return this.#store.getState().accounts.filter((a) => !a.archived);
  }

  /**
   * Total balance of all non-archived accounts in the user's home currency.
   * @returns {number} minor units
   */
  totalBalanceInHome() {
    const state = this.#store.getState();
    return state.accounts
      .filter((a) => !a.archived)
      .reduce(
        (sum, a) => sum + this.#fx.convert(a.balance, a.currency, state.user.homeCurrency),
        0,
      );
  }

  // ── Mutations ────────────────────────────────────────────────────────

  /**
   * Create a new account.
   * @param {object} data
   * @returns {object} the created account
   */
  create(data) {
    const account = {
      id:       IdGenerator.generate('acc'),
      name:     data.name,
      type:     data.type    || 'bank',
      currency: data.currency || 'USD',
      balance:  data.balance  || 0,
      color:    data.color    || '#0ea5e9',
      icon:     data.icon     || 'landmark',
      archived: false,
      groupId:  data.groupId  || null,
    };
    const { accounts } = this.#store.getState();
    accounts.push(account);
    this.#store.flush();
    return account;
  }

  /**
   * Update an existing account.
   * @param {string} id
   * @param {object} changes
   * @returns {object|null}
   */
  update(id, changes) {
    const account = this.find(id);
    if (!account) return null;
    Object.assign(account, changes);
    this.#store.flush();
    return account;
  }

  /**
   * Archive or unarchive an account.
   * @param {string} id
   * @param {boolean} [archived=true]
   */
  archive(id, archived = true) {
    this.update(id, { archived });
  }

  /**
   * Delete an account (and all its transactions).
   * @param {string} id
   */
  delete(id) {
    const state = this.#store.getState();
    state.accounts = state.accounts.filter((a) => a.id !== id);
    state.transactions = state.transactions.filter(
      (t) => t.accountId !== id &&
             !(Array.isArray(t.splits) && t.splits.every((s) => (s.accountId || t.accountId) === id)),
    );
    this.#store.flush();
  }

  // ── Ledger ──────────────────────────────────────────────────────────

  /**
   * Compute the sum of all transaction impacts on an account from the ledger.
   * This is what `account.balance` should equal when the ledger is clean.
   * Handles splits, transfers (using transferDir), and cross-currency conversions.
   *
   * @param {object}   account      Account object
   * @param {object[]} transactions Full transaction array
   * @returns {number} minor units in the account's currency
   */
  ledgerSum(account, transactions) {
    let sum = 0;
    for (const t of transactions) {
      const touches =
        t.accountId === account.id ||
        (Array.isArray(t.splits) && t.splits.some((s) => (s.accountId || t.accountId) === account.id));
      if (!touches) continue;

      if (Array.isArray(t.splits) && t.splits.length) {
        for (const s of t.splits) {
          if ((s.accountId || t.accountId) !== account.id) continue;
          const m = this.#fx.convert(s.amount, t.currency, account.currency);
          if (t.type === 'expense') sum -= m;
          else if (t.type === 'income') sum += m;
        }
      } else {
        const m = this.#fx.convert(t.amount, t.currency, account.currency);
        if (t.type === 'expense')      sum -= m;
        else if (t.type === 'income')  sum += m;
        else if (t.type === 'transfer') {
          if (t.transferDir === 'out') sum -= m;
          else if (t.transferDir === 'in') sum += m;
        }
      }
    }
    return Math.round(sum);
  }

  // ── Balance management ───────────────────────────────────────────────

  /**
   * Apply a transaction's effect to the relevant account balance(s).
   * Call this when inserting a new transaction.
   * @param {object} tx
   */
  applyBalances(tx) {
    const state = this.#store.getState();
    const acc   = this.find(tx.accountId);
    if (!acc) return;

    if (tx.type === 'transfer') {
      if (tx.transferDir === 'out') acc.balance -= tx.amount;
      else if (tx.transferDir === 'in') acc.balance += tx.amount;
    } else if (Array.isArray(tx.splits) && tx.splits.length) {
      for (const split of tx.splits) {
        const splitAcc = this.find(split.accountId || tx.accountId);
        if (!splitAcc) continue;
        const converted = this.#fx.convert(split.amount, tx.currency, splitAcc.currency);
        if (tx.type === 'expense') splitAcc.balance -= converted;
        else if (tx.type === 'income') splitAcc.balance += converted;
      }
    } else {
      const converted = this.#fx.convert(tx.amount, tx.currency, acc.currency);
      if (tx.type === 'expense') acc.balance -= converted;
      else if (tx.type === 'income') acc.balance += converted;
    }
    // Don't flush here — caller will flush after all changes
  }

  /**
   * Reverse a transaction's effect on account balances.
   * Call this before updating or deleting a transaction.
   * @param {object} tx
   */
  revertBalances(tx) {
    const acc = this.find(tx.accountId);
    if (!acc) return;

    if (tx.type === 'transfer') {
      if (tx.transferDir === 'out') acc.balance += tx.amount;
      else if (tx.transferDir === 'in') acc.balance -= tx.amount;
    } else if (Array.isArray(tx.splits) && tx.splits.length) {
      for (const split of tx.splits) {
        const splitAcc = this.find(split.accountId || tx.accountId);
        if (!splitAcc) continue;
        const converted = this.#fx.convert(split.amount, tx.currency, splitAcc.currency);
        if (tx.type === 'expense') splitAcc.balance += converted;
        else if (tx.type === 'income') splitAcc.balance -= converted;
      }
    } else {
      const converted = this.#fx.convert(tx.amount, tx.currency, acc.currency);
      if (tx.type === 'expense') acc.balance += converted;
      else if (tx.type === 'income') acc.balance -= converted;
    }
  }
}
