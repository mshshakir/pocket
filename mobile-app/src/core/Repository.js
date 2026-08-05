/**
 * Repository — persistence adapter for React Native (AsyncStorage).
 *
 * The web Repository sits on localStorage, which is synchronous, and the whole
 * domain layer (Store, services, migrator) is built around that synchronous
 * contract. AsyncStorage is asynchronous, so this adapter keeps the SAME
 * synchronous API the domain expects and hides the asynchrony at the edges:
 *
 *   boot  → await Repository.prepare()  (one async read, before Store.init)
 *   load  → returns the prepared snapshot, synchronously
 *   save  → updates an in-memory cache synchronously, then writes through to
 *           AsyncStorage in the background (serialised, last-write-wins)
 *
 * This means the domain files copied from legacy-web run UNCHANGED — the same
 * audited code, not a re-implementation that could drift.
 *
 * The storage backend is INJECTED (setBackend) rather than imported, so the
 * whole domain graph stays importable under plain node — which is where the
 * regression tests run. The app wires AsyncStorage in at boot (AppContext).
 */
export class Repository {
  static #STORAGE_KEY = 'pocket.v1';
  static #CORRUPT_KEY = 'pocket.v1.corrupt';

  /** @type {{getItem:Function,setItem:Function,removeItem:Function}|null} */
  static #backend = null;

  /**
   * Provide the async key-value backend (AsyncStorage in the app, an in-memory
   * stub in tests). Must be called before prepare().
   * @param {{getItem:Function,setItem:Function,removeItem:Function}} backend
   */
  static setBackend(backend) {
    Repository.#backend = backend;
  }

  static get #storage() {
    if (!Repository.#backend) {
      throw new Error('Repository.setBackend() must be called before use');
    }
    return Repository.#backend;
  }

  /** Snapshot loaded by prepare(); null when nothing was stored. */
  static #prepared = null;
  static #preparedDone = false;

  /** @type {boolean} true when the last load found unreadable data */
  lastLoadCorrupted = false;

  /** Serialises background writes so an older write can't land after a newer one. */
  #writeChain = Promise.resolve();

  /**
   * Read persisted state once, before the Store boots. Must be awaited at app
   * start; load() throws if it wasn't, because silently starting from seed
   * would look exactly like data loss.
   * @returns {Promise<void>}
   */
  static async prepare() {
    try {
      const raw = await Repository.#storage.getItem(Repository.#STORAGE_KEY);
      Repository.#prepared = raw;
    } catch (err) {
      console.error('[Repository] prepare failed:', err);
      Repository.#prepared = null;
    }
    Repository.#preparedDone = true;
  }

  /**
   * Keys the app hangs on state at render time but which are NOT the user's
   * data — `_sharedData` is a full copy of other users' shared snapshots.
   * Same rule as the web Repository (audit finding M9).
   * @param {object} state
   * @returns {object}
   */
  static stripTransient(state) {
    const out = {};
    for (const k of Object.keys(state)) if (!k.startsWith('_')) out[k] = state[k];
    return out;
  }

  /**
   * @returns {object|null} the persisted state, or null for a fresh install
   */
  load() {
    if (!Repository.#preparedDone) {
      throw new Error('Repository.prepare() must be awaited before Store.init()');
    }
    const raw = Repository.#prepared;
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      console.error('[Repository] Corrupt state — keeping a backup:', err);
      this.lastLoadCorrupted = true;
      // Keep the unreadable payload for manual recovery, mirroring the web app.
      this.#writeChain = this.#writeChain.then(() =>
        Repository.#storage.setItem(Repository.#CORRUPT_KEY, raw).catch(() => {}),
      );
      return null;
    }
  }

  /**
   * Persist state. Synchronous success from the caller's point of view; the
   * actual AsyncStorage write happens in the background. A failed background
   * write is logged — the in-memory state is still authoritative and the next
   * save retries the full snapshot, so nothing is partially written.
   * @param {object} state
   * @returns {boolean}
   */
  save(state) {
    let json;
    try {
      json = JSON.stringify(Repository.stripTransient(state));
    } catch (err) {
      console.error('[Repository] Failed to serialise state:', err);
      return false;
    }
    Repository.#prepared = json; // keep load() coherent within the session
    this.#writeChain = this.#writeChain.then(() =>
      Repository.#storage.setItem(Repository.#STORAGE_KEY, json).catch((err) => {
        console.error('[Repository] Background save failed:', err);
      }),
    );
    return true;
  }

  /** Remove persisted state (sign-out wipe). */
  clear() {
    Repository.#prepared = null;
    this.#writeChain = this.#writeChain.then(() =>
      Repository.#storage.removeItem(Repository.#STORAGE_KEY).catch(() => {}),
    );
  }

  /**
   * Await all queued background writes — call before the app is backgrounded
   * if you need a hard guarantee the snapshot is on disk.
   * @returns {Promise<void>}
   */
  flushWrites() {
    return this.#writeChain;
  }
}
