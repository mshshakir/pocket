/**
 * ParkedBooks — a book set aside on this device for the person it belongs to.
 *
 * When someone else signs in on a device that holds another person's book,
 * that book must not be shown to them — but it may hold work that exists
 * nowhere else (entries not yet synced, or a Free plan's book that lives only
 * on the device). So it is parked under its owner's id, out of sight, and
 * handed back the next time that person signs in here.
 */
import { KeyValueStore } from './KeyValueStore.js';

export class ParkedBooks {
  static PREFIX = 'pocket.v2.parked.';

  #store;

  /** @param {KeyValueStore} [store] */
  constructor(store = KeyValueStore.default()) {
    this.#store = store;
  }

  /**
   * @param {string} userId  whose book it is
   * @param {object} state   the book (persisted keys only)
   * @param {boolean} pending  it had edits the cloud had not received
   */
  park(userId, state, pending) {
    return this.#store.set(ParkedBooks.PREFIX + userId, { state, pending: !!pending, parkedAt: new Date().toISOString() });
  }

  /**
   * Hand back this person's parked book, if any, and forget it here.
   * @param {string} userId
   * @returns {Promise<{state: object, pending: boolean}|null>}
   */
  async take(userId) {
    const key = ParkedBooks.PREFIX + userId;
    const rec = await this.#store.get(key);
    if (!rec || typeof rec !== 'object' || !rec.state) return null;
    await this.#store.remove(key);
    return { state: rec.state, pending: rec.pending === true };
  }
}
