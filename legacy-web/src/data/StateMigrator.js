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
import { OwnerSpaceService } from '../domain/services/OwnerSpaceService.js';

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
      defaultAccountId: '', defaultPaymentType: 'card',
      customPaymentTypes: [], hiddenPaymentTypes: [],
      collapsedAccountGroups: [], collapsedCategories: [],
    }, state.user || {});
    if (typeof state.user.hijriOffset !== 'number') state.user.hijriOffset = 0;
    if (!state.user.defaultCurrency) state.user.defaultCurrency = state.user.homeCurrency;
    // Stored as a plain string so a payment type deleted later degrades to the
    // service's fallback rather than a crash. Same for defaultAccountId, which
    // may name an account that has since been deleted or archived.
    if (typeof state.user.defaultAccountId !== 'string') state.user.defaultAccountId = '';
    if (typeof state.user.defaultPaymentType !== 'string') state.user.defaultPaymentType = 'card';

    // ── collection defaults ────────────────────────────────────────────
    if (!Array.isArray(state.accounts))      state.accounts = [];
    if (!Array.isArray(state.transactions))  state.transactions = [];
    if (!Array.isArray(state.categories))    state.categories = [];
    if (!Array.isArray(state.budgets))       state.budgets = [];
    if (!Array.isArray(state.debts))         state.debts = [];
    if (!Array.isArray(state.regularItems))  state.regularItems = [];
    // A regular item on an account someone shared carries the owner alongside
    // the account id — AccountRef keeps the two apart. Back-filled so items
    // created before shared accounts were supported read cleanly.
    for (const it of state.regularItems) {
      if (typeof it.sharedOwnerId === 'undefined') it.sharedOwnerId = null;
    }
    if (!Array.isArray(state.accountGroups)) state.accountGroups = [];
    if (!Array.isArray(state.family))        state.family = [];
    if (!Array.isArray(state.spaces))        state.spaces = [];
    // Budget grants live beside account grants but in their own array — a
    // budget has no accountId to inherit from. Back-filled so a member record
    // written before per-budget sharing existed reads cleanly.
    for (const m of state.family) {
      if (!Array.isArray(m.budgetPermissions)) m.budgetPermissions = [];
    }
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

    // ── hijriDate snapshots: record which offset epoch they belong to ──
    // Snapshots written before offsets were tracked carry no `offset`. They
    // were produced with whatever the user's offset was at the time, which for
    // the overwhelmingly common case (an offset that never changed) is the
    // current one — so stamping that reproduces existing behaviour exactly
    // while giving BudgetService the epoch it needs. Guarded on `undefined`,
    // never on falsiness, so a legitimate offset of 0 is left alone.
    const currentOffset = Number(state.user?.hijriOffset) || 0;
    for (const t of state.transactions) {
      if (t.hijriDate && typeof t.hijriDate === 'object' && t.hijriDate.offset === undefined) {
        t.hijriDate.offset = currentOffset;
      }
    }

    // Build spaces from the member-first grants that predate them. Idempotent,
    // and it never widens access — see OwnerSpaceService.migrate().
    OwnerSpaceService.migrate(state);

    return state;
  }
}
