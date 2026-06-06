/**
 * StateMigrator — single, idempotent forward-migration for persisted state.
 *
 * Runs on EVERY state entry point (local load, cloud pull, sign-out reset) so
 * older snapshots are always brought up to the current schema before any view
 * or service touches them. Previously this back-fill lived only in
 * SyncService.#migrateDefaults and was NOT applied on cloud pull
 * (replaceState), so long-standing synced users could load a snapshot missing
 * newer arrays and crash on render.
 *
 * It also performs the derived-balance migration: every account gains an
 * `openingBalance` such that `openingBalance + ledger(transactions) ===` the
 * balance that was previously stored. This keeps displayed balances identical
 * across the switch to derived balances.
 */
import { LedgerMath }      from '../domain/services/LedgerMath.js';
import { CurrencyService } from '../domain/services/CurrencyService.js';

export class StateMigrator {
  /**
   * Mutate `state` in place, back-filling any missing fields. Safe to run
   * repeatedly.
   * @param {object} state
   * @param {CurrencyService} [fx]
   * @returns {object} the same state object
   */
  static migrate(state, fx = new CurrencyService()) {
    if (!state || typeof state !== 'object') return state;

    // ── user defaults ──────────────────────────────────────────────────
    state.user = Object.assign({
      homeCurrency: 'USD', defaultCurrency: 'USD', theme: 'system',
      showHijri: true, calendarMode: 'both', dateFormat: 'auto',
      geminiApiKey: '', supabaseUrl: '', supabaseKey: '',
      hijriOffset: 0,
      customPaymentTypes: [], collapsedAccountGroups: [], collapsedCategories: [],
    }, state.user || {});
    if (typeof state.user.hijriOffset !== 'number') state.user.hijriOffset = 0;
    if (!state.user.defaultCurrency) state.user.defaultCurrency = state.user.homeCurrency;

    // ── collection defaults ────────────────────────────────────────────
    if (!Array.isArray(state.accounts))      state.accounts = [];
    if (!Array.isArray(state.transactions))  state.transactions = [];
    if (!Array.isArray(state.categories))    state.categories = [];
    if (!Array.isArray(state.budgets))       state.budgets = [];
    if (!Array.isArray(state.debts))         state.debts = [];
    if (!Array.isArray(state.regularItems))  state.regularItems = [];
    if (!Array.isArray(state.accountGroups)) state.accountGroups = [];
    if (!Array.isArray(state.family))        state.family = [];
    if (!state.merchantCategories || typeof state.merchantCategories !== 'object') {
      state.merchantCategories = {};
    }

    // ── derived-balance migration ──────────────────────────────────────
    // For any account that predates openingBalance, choose an opening figure
    // that reproduces its previously-stored balance under the derived model.
    for (const acc of state.accounts) {
      if (acc.openingBalance === undefined || acc.openingBalance === null) {
        const stored = Number(acc.balance);
        const ledger = LedgerMath.ledgerSum(acc, state.transactions, fx);
        acc.openingBalance = Number.isFinite(stored) ? Math.round(stored - ledger) : 0;
      }
    }

    return state;
  }
}
