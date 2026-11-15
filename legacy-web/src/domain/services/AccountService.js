/**
 * AccountService — Account CRUD and DERIVED balance management.
 *
 * Balances are no longer mutated incrementally. `account.balance` is a derived
 * cache equal to `openingBalance + ledger impact of all transactions`. The
 * Store recomputes it through recompute() at every persist (the single
 * persistence choke point), so balances are always a pure function of the
 * ledger — eliminating the apply/revert drift bugs (orphaned transfer legs on
 * delete, transfer-edit corruption, sticky NaN balances).
 *
 * All balance math lives in LedgerMath (the single source of truth).
 * No DOM access.
 */
import { ACCOUNT_TYPES } from '../../data/constants.js';
import { Store }           from '../../core/Store.js';
import { IdGenerator }     from './IdGenerator.js';
import { CurrencyService } from './CurrencyService.js';
import { LedgerMath }      from './LedgerMath.js';

export class AccountService {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;

  /**
   * @param {object} [deps]
   * @param {Store} [deps.store]
   * @param {CurrencyService} [deps.fx]
   */
  constructor({ store = Store.getInstance(), fx = new CurrencyService() } = {}) {
    this.#store = store;
    this.#fx    = fx;
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /** @param {string} id @returns {object|undefined} */
  find(id) {
    return this.#store.getState().accounts.find((a) => a.id === id);
  }

  /** @returns {object[]} all non-archived accounts */
  active() {
    return this.#store.getState().accounts.filter((a) => !a.archived);
  }

  /**
   * The account a new entry form should start on.
   *
   * `user.defaultAccountId` is only a preference, never a guarantee: the
   * account it names can be deleted or archived long after it was chosen. Both
   * cases fall through to the first usable account rather than leaving a form
   * bound to an id that no longer resolves — a `<select>` with no matching
   * option silently reports whichever entry happens to sit first anyway.
   * @returns {string|undefined}
   */
  defaultId() {
    const state = this.#store.getState();
    const preferred = state.user?.defaultAccountId;
    if (preferred && state.accounts.some((a) => a.id === preferred && !a.archived)) return preferred;
    return (this.active()[0] || state.accounts[0])?.id;
  }

  /**
   * Total balance of all non-archived accounts in the user's home currency.
   * Reads the derived `balance` cache (kept fresh by recompute()), so this is
   * O(accounts), not O(accounts × transactions).
   * @returns {number} minor units
   */
  totalBalanceInHome() {
    const state = this.#store.getState();
    return state.accounts
      .filter((a) => AccountService.inTotals(a))
      .reduce((sum, a) => sum + this.#fx.convert(a.balance ?? 0, a.currency, state.user.homeCurrency), 0);
  }

  /**
   * Whether an account counts in totals (Dashboard balance, group totals,
   * net worth, "You owe"): not archived, and not set to "Leave out of totals".
   * @param {object} account
   */
  static inTotals(account) {
    return !!account && !account.archived && !account.excludeFromTotals;
  }

  /** The default icon for an account type (Bank → landmark, Card → credit-card…). */
  static typeIcon(type) {
    return ACCOUNT_TYPES.find((t) => t.id === type)?.icon || 'wallet';
  }

  /**
   * Accounts below the low-balance floor their owner set: [{ account, balance, floor }].
   * Archived accounts and cards (which use a limit instead) are left out.
   */
  lowAccounts() {
    return this.#store.getState().accounts
      .filter((a) => !a.archived && a.type !== 'card' && Number(a.lowBalance) > 0)
      .map((a) => ({ account: a, balance: Math.round(a.balance ?? 0), floor: Math.round(a.lowBalance) }))
      .filter((x) => x.balance < x.floor);
  }

  /**
   * Put `ids` in this order, inside the slots they already hold in the list:
   * accounts not named keep their places. So reordering one group never
   * shuffles another. Pure.
   * @param {object[]} accounts
   * @param {string[]} ids
   * @returns {object[]} a new list
   */
  static reorderWithin(accounts, ids) {
    const wanted = ids.filter((id) => accounts.some((a) => a.id === id));
    const set    = new Set(wanted);
    const byId   = new Map(accounts.map((a) => [a.id, a]));
    const queue  = wanted.map((id) => byId.get(id));
    return accounts.map((a) => (set.has(a.id) ? queue.shift() : a));
  }

  /**
   * Reorder accounts (see reorderWithin) and save. Each account's place is
   * stamped as `sortOrder` so the change syncs: the server keeps the order of
   * the items it is sent, and an unchanged item isn't sent.
   * @param {string[]} ids
   * @returns {boolean} whether anything moved
   */
  reorder(ids) {
    const state = this.#store.getState();
    const next  = AccountService.reorderWithin(state.accounts, ids);
    if (next.every((a, i) => a === state.accounts[i])) return false;
    state.accounts.splice(0, state.accounts.length, ...next); // same array: others may hold it
    next.forEach((a, i) => { a.sortOrder = i + 1; });
    this.#store.flush();
    return true;
  }

  // ── Derived balance ──────────────────────────────────────────────────

  /**
   * On-demand derived balance for a single account.
   * @param {object} account
   * @returns {number} minor units in the account's currency
   */
  balanceOf(account) {
    if (!account) return 0;
    const opening = Number(account.openingBalance ?? 0) || 0;
    return Math.round(opening + LedgerMath.ledgerSum(account, this.#store.getState().transactions, this.#fx));
  }

  /**
   * Recompute and write the derived `balance` cache for every account in a
   * single pass. Invoked by the Store on every persist; safe to call anytime.
   */
  recompute() {
    const state = this.#store.getState();
    if (!Array.isArray(state.accounts) || !Array.isArray(state.transactions)) return;
    // Freeze each row's account-currency impact at the current rate (once), so
    // derived balances stay stable when the live FX table is later refreshed.
    LedgerMath.stampAccountAmounts(state.transactions, state.accounts, this.#fx);
    const balances = LedgerMath.balances(state.accounts, state.transactions, this.#fx);
    for (const a of state.accounts) a.balance = balances.get(a.id) ?? 0;
  }

  /**
   * Ledger impact of a transaction list on one account (its currency).
   * Retained for callers (e.g. reconcile); delegates to LedgerMath.
   * @param {object} account
   * @param {object[]} transactions
   * @returns {number} minor units
   */
  ledgerSum(account, transactions) {
    return LedgerMath.ledgerSum(account, transactions, this.#fx);
  }

  // ── Mutations ────────────────────────────────────────────────────────

  /**
   * Create a new account. Opening balances are recorded by the caller as a
   * ledger transaction, so openingBalance defaults to 0.
   * @param {object} data
   * @returns {object}
   */
  create(data) {
    const account = {
      id:             IdGenerator.generate('acc'),
      name:           data.name,
      type:           data.type     || 'bank',
      currency:       data.currency || 'USD',
      openingBalance: Number(data.openingBalance ?? 0) || 0,
      balance:        Number(data.openingBalance ?? 0) || 0,
      color:          data.color    || '#0ea5e9',
      icon:           data.icon     || AccountService.typeIcon(data.type || 'bank'),
      archived:       false,
      groupId:        data.groupId  || null,
    };
    this.#store.getState().accounts.push(account);
    this.#store.flush();
    return account;
  }

  /** @param {string} id @param {object} changes @returns {object|null} */
  update(id, changes) {
    const account = this.find(id);
    if (!account) return null;
    const currencyChanged = 'currency' in changes && changes.currency !== account.currency;
    Object.assign(account, changes);
    if (currencyChanged) {
      // Frozen per-row impacts were captured in the OLD account currency; clear
      // them for every row touching this account so recompute() re-freezes them
      // in the new currency on the persist below.
      for (const t of this.#store.getState().transactions) {
        if (t.accountId === id) delete t.acctMinor;
        if (Array.isArray(t.splits)) {
          for (const sp of t.splits) if ((sp.accountId || t.accountId) === id) delete sp.acctMinor;
        }
      }
    }
    this.#store.flush();
    return account;
  }

  /** @param {string} id @param {boolean} [archived=true] */
  archive(id, archived = true) {
    this.update(id, { archived });
  }

  /**
   * Delete an account: remove fully-owned transactions, strip dangling split
   * legs from shared ones, then drop the account. Balances of surviving
   * accounts (transfer counter-legs, multi-account splits) self-correct because
   * the Store recomputes them from the remaining ledger on persist.
   * @param {string} id
   */
  delete(id) {
    const state = this.#store.getState();
    state.transactions = state.transactions
      // Drop transactions that belong solely to this account.
      .filter((t) =>
        t.accountId !== id ||
        (Array.isArray(t.splits) && t.splits.some((s) => (s.accountId || t.accountId) !== id)),
      )
      // Strip any split legs that pointed at the deleted account.
      .map((t) =>
        Array.isArray(t.splits)
          ? { ...t, splits: t.splits.filter((s) => (s.accountId || t.accountId) !== id) }
          : t,
      );
    state.accounts = state.accounts.filter((a) => a.id !== id);
    // Drop the Settings preference if it pointed here, so it can't linger as a
    // dangling id in the saved (and uploaded) state.
    if (state.user?.defaultAccountId === id) state.user.defaultAccountId = '';
    this.#store.flush();
  }
}
