/**
 * RegularLogSubmitter — turning "Log now" into a row, in the right book.
 *
 * This was two functions inside RegularsScreen.js. That is where the worst bug
 * of the Spaces port lived, and it is not a coincidence: a `.js` file full of
 * JSX cannot be imported by a node test, so the rule it encoded — *which book
 * does this log belong to* — was the one rule in the whole feature that no test
 * could reach. A mutation confirmed it: reverting the fix left all 126
 * assertions green.
 *
 * The rule itself is the interesting part, because "shared" turns out to mean
 * two unrelated things:
 *
 *   1. An item of MINE, attached to an account somebody shared WITH me. It
 *      carries `sharedOwnerId`, and `AccountRef.fromRecord` finds it.
 *   2. An item of the OWNER's, seen from inside THEIR space. It carries
 *      nothing at all — in their own book it is unremarkable.
 *
 * The old code tested only (1), so (2) fell through to a local push: an expense
 * carrying the owner's accountId and categoryId landed in the member's own
 * ledger, attached to no account they have, rendering as "Uncategorised", never
 * reaching the owner, and reporting "Logged" on the way out.
 *
 * So the destination is asked of SpaceGuard, which knows which book is on
 * screen, and only then of the record.
 */
import { AccountRef } from './AccountRef.js';
import { IdGenerator } from './IdGenerator.js';
import { DateService } from './DateService.js';
import { RATES } from './FxRates.js';

export class RegularLogSubmitter {
  #store; #sync; #fx; #guard;

  /**
   * @param {object} deps
   * @param {object} deps.store
   * @param {object} deps.sync    SyncService — contributions + the share list
   * @param {object} deps.fx      CurrencyService
   * @param {object} [deps.guard] SpaceGuard. Absent means "home", so the class
   *   stays usable from a context that has no spaces at all.
   */
  constructor({ store, sync, fx, guard = null }) {
    this.#store = store;
    this.#sync  = sync;
    this.#fx    = fx;
    this.#guard = guard;
  }

  /**
   * Which book this log belongs to.
   * @param {object} item
   * @returns {{ok: true, ownerId: string|null}|{ok: false, message: string}}
   */
  destinationFor(item) {
    const verdict = this.#guard
      ? this.#guard.routeLogRegular(item)
      : { ok: true, contribution: null };
    if (!verdict.ok) return { ok: false, message: verdict.message };

    const ref = AccountRef.fromRecord(item);
    return {
      ok: true,
      // Space first, record second — see the class comment for why the record
      // alone is not enough.
      ownerId: verdict.contribution?.ownerId || (ref.isShared ? ref.ownerId : null),
    };
  }

  /**
   * The transaction a single log writes.
   *
   * A log destined for someone else's book is denominated for THEIR reporting:
   * `refAmount` converts to the owner's home currency, matching what the
   * transaction form and the web app both do for a contribution. Getting this
   * wrong does not fail loudly, it quietly mis-states the owner's totals.
   *
   * @param {object} item
   * @param {string} [date]
   * @param {string|null} [ownerId]  destination, from `destinationFor`
   * @returns {object}
   */
  build(item, date = DateService.todayIso(), ownerId = null) {
    const s   = this.#store.getState();
    const ref = AccountRef.fromRecord(item);
    const currency = item.currency || s.user.homeCurrency;
    const share = ownerId ? this.#sync?.shareByOwner?.(ownerId) : null;
    const base  = share ? (share.homeCurrency || s.user.homeCurrency) : s.user.homeCurrency;
    const amount = item.defaultAmount || 0;

    return {
      id: IdGenerator.generate('tx'),
      regularItemId: item.id,
      accountId: ref.accountId || s.accounts[0]?.id,
      date, hijriDate: null,
      amount, unitAmount: amount, qty: 1,
      currency,
      exchangeRate: (RATES[currency] || 1) / (RATES[base] || 1),
      refAmount: this.#fx.convert(amount, currency, base),
      description: item.name,
      payee: item.name, note: '', type: 'expense',
      categoryId: item.categoryId || null, splits: null,
      paymentType: 'cash', recordState: 'cleared', tags: [],
      createdAt: new Date().toISOString(),
      // Only set on a contribution — the owner's authorisation check and the
      // member's own delete rights both key off it.
      addedBy: ownerId ? (this.#sync?.currentUser?.email || null) : undefined,
    };
  }

  /**
   * Log the item.
   * @param {object} item
   * @param {string} [date]
   * @returns {Promise<{ok: boolean, shared: boolean, reason?: string}>}
   */
  async submit(item, date) {
    const dest = this.destinationFor(item);
    if (!dest.ok) return { ok: false, shared: true, reason: dest.message };

    const tx = this.build(item, date, dest.ownerId);

    if (!dest.ownerId) {
      this.#store.getState().transactions.push(tx);
      this.#store.flush();
      return { ok: true, shared: false };
    }

    const share = this.#sync?.shareByOwner?.(dest.ownerId);
    if (!share?._ownerId) return { ok: false, shared: true, reason: 'Shared account not found' };
    try {
      await this.#sync.submitContribution(share._ownerId, tx);
      // The owner's client applies contributions asynchronously, so one refresh
      // often lands before it has been picked up.
      this.#sync.scheduleSharesRefresh?.(3000);
      this.#sync.scheduleSharesRefresh?.(8000);
      return { ok: true, shared: true };
    } catch (e) {
      return { ok: false, shared: true, reason: String(e?.message || e) };
    }
  }
}
