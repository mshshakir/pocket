/**
 * ShareCache — the books shared with this user, as the server last sent
 * them, kept between visits with the cursor to continue from.
 *
 * With it, opening the app asks only for what changed in the shared books
 * since the last visit (see ShareDelta) instead of downloading them again.
 * If the copy no longer matches the server — an account was shared or
 * unshared meanwhile — ShareDelta rejects it and the shares load in full.
 */
import { UserRecord } from './UserRecord.js';

export class ShareCache {
  static KEY = 'pocket.v2.shares';

  #record;

  /** @param {import('./KeyValueStore.js').KeyValueStore} [store] */
  constructor(store) {
    this.#record = new UserRecord(ShareCache.KEY, store);
  }

  /** @returns {Promise<{shares: object[], cursor: string|null}|null>} */
  async load(userId) {
    const f = await this.#record.load(userId);
    return Array.isArray(f?.shares) && f.cursor ? { shares: f.shares, cursor: f.cursor } : null;
  }

  /**
   * @param {object[]} shares  as merged; the caller must not mutate them afterwards
   * @param {string|null} cursor
   */
  save(shares, cursor) {
    return this.#record.save({ shares, cursor });
  }

  clear() {
    return this.#record.clear();
  }

  flushed() {
    return this.#record.flushed();
  }
}
