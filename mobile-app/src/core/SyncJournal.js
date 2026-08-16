/**
 * SyncJournal — durable record of "local state holds edits the cloud has not
 * accepted yet". Mobile mirror of `legacy-web/src/core/SyncJournal.js`.
 *
 * MobileSyncService tracks that with an in-memory `#dirty` field, but a field
 * dies with the process — and on Android the OS reclaims a backgrounded app
 * without running any more JS. The sequence that loses a transaction is:
 *
 *   save → 1500ms push timer armed, #dirty = true
 *        → user backgrounds the app
 *        → Android kills the process; the timer never fires
 *   next launch → #cloudVersion is null and #dirty is false, so the
 *                 flush-before-pull guard cannot fire → replaceState() adopts
 *                 the stale cloud row over memory AND AsyncStorage.
 *
 * Persisting the marker lets a cold start answer the only question that
 * matters: is the cloud row a fair representation of what this device knows?
 *
 * `baseVersion` is the cloud version the edits were made ON TOP OF:
 *   row.version === baseVersion → nobody else wrote; local is strictly ahead
 *                                 and may be committed over the row.
 *   anything else               → another device wrote while this one was away;
 *                                 overwriting would destroy THEIR work, so the
 *                                 local copy is stashed instead.
 * Without it, "recover my unsynced edits" degrades into "last device to open
 * the app wins", which just relocates the data loss.
 *
 * Unlike the web copy, AsyncStorage is asynchronous. Writes are fire-and-forget
 * on a serialised chain: awaiting them on every save would put storage latency
 * in the path of every keystroke, and a marker that occasionally loses its last
 * update is still enormously better than no marker at all.
 */
export class SyncJournal {
  static #KEY = 'pocket.v1.pending';

  /** @type {object|null} AsyncStorage-compatible backend */
  static #storage = null;

  /** In-memory mirror, so read() is synchronous after prepare(). */
  static #cache = null;

  /** Serialises writes so two rapid marks can't land out of order. */
  #chain = Promise.resolve();

  /**
   * @param {object} storage  AsyncStorage (or any {getItem,setItem,removeItem})
   */
  static setBackend(storage) {
    SyncJournal.#storage = storage;
  }

  /**
   * Load the persisted marker into the cache. Must be awaited during boot,
   * BEFORE the first pull, or the cold-start check reads null and the recovery
   * never runs.
   * @returns {Promise<void>}
   */
  static async prepare() {
    try {
      const raw = await SyncJournal.#storage?.getItem(SyncJournal.#KEY);
      SyncJournal.#cache = raw ? JSON.parse(raw) : null;
    } catch (_) {
      SyncJournal.#cache = null;
    }
  }

  /**
   * Record that local state has edits not yet committed to the cloud.
   * @param {string} userId
   * @param {number|null} baseVersion  cloud version the edits were made against
   */
  mark(userId, baseVersion = null) {
    if (!userId) return;
    const prev  = SyncJournal.#cache;
    // Preserve the original timestamp across a burst of edits so `since`
    // measures how long work has been at risk, not time since the last tap.
    const since = prev?.userId === userId ? prev.since : new Date().toISOString();
    const rec   = { userId, since, baseVersion };
    SyncJournal.#cache = rec;
    this.#write(JSON.stringify(rec));
  }

  /** Record that local state matches the cloud. */
  clear() {
    SyncJournal.#cache = null;
    this.#chain = this.#chain
      .then(() => SyncJournal.#storage?.removeItem(SyncJournal.#KEY))
      .catch(() => {});
  }

  /** @returns {{userId: string, since: string, baseVersion: number|null}|null} */
  read() {
    return SyncJournal.#cache;
  }

  /** @param {string} userId @returns {boolean} */
  isPendingFor(userId) {
    if (!userId) return false;
    return SyncJournal.#cache?.userId === userId;
  }

  /**
   * Await any queued journal write. Called from the AppState background hook so
   * the marker is on disk before the OS is free to kill the process.
   * @returns {Promise<void>}
   */
  flush() {
    return this.#chain;
  }

  /** @param {string} json */
  #write(json) {
    this.#chain = this.#chain
      .then(() => SyncJournal.#storage?.setItem(SyncJournal.#KEY, json))
      .catch(() => { /* full disk — losing the marker must not break the save */ });
  }
}
