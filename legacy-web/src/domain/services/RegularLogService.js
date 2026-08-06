/**
 * RegularLogService — every regular-item log the user can see, wherever it lives.
 *
 * A log for a locally-owned account is an ordinary row in `state.transactions`.
 * A log for an account a family member shared is submitted into the OWNER's
 * book, so it never appears locally — it comes back in that owner's share
 * snapshot (`state._sharedData[].transactions`). Without merging the two, an
 * entry logged against a shared account would vanish the moment it was saved.
 *
 * Shared rows are tagged so the UI can treat them correctly:
 *   _shared  true
 *   _ownerId the owner whose book holds the row (for delete/edit routing)
 *
 * Only logs whose `regularItemId` matches one of the user's OWN regular items
 * are pulled out of a snapshot — the owner's own regular purchases are their
 * business, not something to surface in this user's calendar.
 */
import { Store } from '../../core/Store.js';

export class RegularLogService {
  /** @type {Store} */ #store;

  /** @param {object} [deps] @param {Store} [deps.store] */
  constructor({ store } = {}) {
    this.#store = store || Store.getInstance();
  }

  /**
   * Every visible regular-item log — local rows first, then contributions.
   * @returns {object[]}
   */
  all() {
    const state = this.#store.getState();
    const local = (state.transactions || []).filter((t) => t.regularItemId);

    const mine  = new Set((state.regularItems || []).map((i) => i.id));
    if (!mine.size) return local;

    const shared = (state._sharedData || []).flatMap((share) =>
      (share.transactions || [])
        .filter((t) => t.regularItemId && mine.has(t.regularItemId))
        .map((t) => ({ ...t, _shared: true, _ownerId: share._ownerId })),
    );

    return local.concat(shared);
  }

  /**
   * Logs on one ISO date.
   * @param {string} iso
   * @returns {object[]}
   */
  onDate(iso) {
    return this.all().filter((t) => t.date === iso);
  }

  /**
   * Logs whose date falls in [startIso, endIso] — ISO dates compare correctly
   * as strings, which is what the calendar's week/month tallies rely on.
   * @param {string} startIso
   * @param {string} endIso
   * @returns {object[]}
   */
  inRange(startIso, endIso) {
    return this.all().filter((t) => t.date >= startIso && t.date <= endIso);
  }

  /**
   * Resolve a single log by id, so a delete knows whether to remove a local row
   * or submit a delete-contribution to the owner.
   * @param {string} logId
   * @returns {object|undefined}
   */
  find(logId) {
    return this.all().find((t) => t.id === logId);
  }
}
