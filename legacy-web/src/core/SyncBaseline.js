/**
 * SyncBaseline — this device's copy of the book as the cloud last had it.
 *
 * Comparing the current state with this copy tells the sync exactly which
 * items were changed here and not yet saved. Keeping it between visits (not
 * just in memory) is what makes that work across a reload or a crash: edits
 * made just before the tab closed are found again and replayed onto the
 * latest cloud copy instead of being lost or overwriting other devices'
 * changes.
 *
 * It also keeps the cursor the cloud gave with its last load, so the next
 * load asks only for what changed since (see BookDelta). A save leaves the
 * cursor as it is: the next load simply sends our own rows back too.
 *
 * Stored in IndexedDB (see UserRecord): the copy is as big as the book, and
 * localStorage — where the app's working copy already lives — can't hold
 * two of those for a large book.
 */
import { BookDiff } from './BookDiff.js';
import { UserRecord } from './UserRecord.js';

export class SyncBaseline {
  static KEY = 'pocket.v2.baseline';

  #record;

  /** @param {import('./KeyValueStore.js').KeyValueStore} [store] */
  constructor(store) {
    this.#record = new UserRecord(SyncBaseline.KEY, store);
  }

  /**
   * Load the stored copy for this user.
   * @returns {Promise<object|null>} the copy, or null when none
   */
  async load(userId) {
    await this.#record.load(userId);
    return this.state;
  }

  /** @returns {object|null} the copy the cloud last confirmed */
  get state() {
    return this.#record.fields?.state ?? null;
  }

  /** @returns {string|null} where the next load continues from (null → load everything) */
  get cursor() {
    return this.state ? (this.#record.fields?.cursor ?? null) : null;
  }

  /**
   * Record what the cloud now holds.
   * @param {object} state  already stripped of transient keys
   * @param {string|null} [cursor]  from a load; omitted after a save, keeping the current one
   */
  set(state, cursor = this.cursor) {
    return this.#record.save({ state: BookDiff.clone(state), cursor });
  }

  /** Forget it (sign-out). */
  clear() {
    return this.#record.clear();
  }

  /** Resolves once the copy is written out. */
  flushed() {
    return this.#record.flushed();
  }
}
