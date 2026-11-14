/**
 * UserRecord — one record kept between visits for the signed-in user, in a
 * KeyValueStore (IndexedDB where available).
 *
 * The record is `{ userId, …fields }`; a record saved for someone else is
 * ignored on load. The in-memory copy is always current — saving writes it
 * out in the background, in order — so callers never wait on storage.
 *
 * Records that used to live in localStorage under the same key are moved
 * over on first load and removed from localStorage, freeing its space.
 */
import { KeyValueStore, LocalStorageStore } from './KeyValueStore.js';

export class UserRecord {
  #key;
  #store;
  #userId = null;
  #fields = null;
  #writes = Promise.resolve();

  /**
   * @param {string} key
   * @param {KeyValueStore} [store]
   */
  constructor(key, store = KeyValueStore.default()) {
    this.#key = key;
    this.#store = store;
  }

  /**
   * Read this user's record.
   * @param {string} userId
   * @returns {Promise<object|null>} its fields, or null when none is stored
   */
  async load(userId) {
    this.#userId = userId;
    this.#fields = null;
    let rec = await this.#store.get(this.#key);
    if (rec === undefined && !(this.#store instanceof LocalStorageStore)) rec = await this.#moveFromLocalStorage();
    if (rec && typeof rec === 'object' && rec.userId === userId) {
      const { userId: _owner, ...fields } = rec;
      this.#fields = fields;
    }
    return this.#fields;
  }

  /** @returns {object|null} the fields as last loaded or saved */
  get fields() {
    return this.#fields;
  }

  /**
   * Replace the fields and write them out in the background.
   * @param {object} fields  plain data; the caller must not mutate it afterwards
   */
  save(fields) {
    this.#fields = fields;
    const rec = { userId: this.#userId, ...fields };
    this.#writes = this.#writes.then(() => this.#store.set(this.#key, rec)).catch(() => false);
    return this.#writes;
  }

  /** Forget the record, here and in storage (sign-out). */
  clear() {
    this.#fields = null;
    this.#userId = null;
    this.#writes = this.#writes.then(() => this.#store.remove(this.#key)).catch(() => {});
    return this.#writes;
  }

  /** Resolves once every write made so far has finished. */
  flushed() {
    return this.#writes;
  }

  async #moveFromLocalStorage() {
    const legacy = new LocalStorageStore();
    const rec = await legacy.get(this.#key);
    if (rec === undefined) return undefined;
    if (await this.#store.set(this.#key, rec)) await legacy.remove(this.#key);
    return rec;
  }
}
