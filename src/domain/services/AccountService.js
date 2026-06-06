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
   * Total balance of all non-archived accounts in the user's home currency.
   * Reads the derived `balance` cache (kept fresh by recompute()), so this is
   * O(accounts), not O(accounts × transactions).
   * @returns {number} minor units
   */
  totalBalanceInHome() {
    const state = this.#store.getState();
    return state.accounts
      .filter((a) => !a.archived)
      .reduce((sum, a) => sum + this.#fx.convert(a.balance ?? 0, a.currency, state.user.homeCurrency), 0);
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
      icon:           data.icon     || 'landmark',
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
    Object.assign(account, changes);
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
    this.#store.flush();
  }

  // ── Deprecated balance shims ─────────────────────────────────────────
  // Balances are derived and recomputed centrally on persist. These remain as
  // no-ops so existing call sites keep working without manual posting logic.

  /** @deprecated balances are derived — no-op. */
  applyBalances(_tx) {}
  /** @deprecated balances are derived — no-op. */
  revertBalances(_tx) {}
  /** @deprecated balances are derived — no-op. */
  revertTransferPair(_tx, _pair) {}
}
