/**
 * SyncBaseline — this device's copy of the book as the cloud last had it.
 *
 * Comparing the current state with this copy tells the sync exactly which
 * items were changed here and not yet saved. Keeping it in localStorage (not
 * just memory) is what makes that work across a reload or a crash: edits made
 * just before the tab closed are found again and replayed onto the latest
 * cloud copy instead of being lost or overwriting other devices' changes.
 *
 * It also keeps the cursor the cloud gave with its last load, so the next
 * load asks only for what changed since (see BookDelta). A save leaves the
 * cursor as it is: the next load simply sends our own rows back too.
 */
import { BookDiff } from './BookDiff.js';

export class SyncBaseline {
  static #KEY = 'pocket.v2.baseline';

  #userId = null;
  #state = null;
  #cursor = null;

  /** Load the stored copy for this user (null when none). */
  load(userId) {
    this.#userId = userId;
    this.#state = null;
    this.#cursor = null;
    try {
      const raw = localStorage.getItem(SyncBaseline.#KEY);
      const rec = raw ? JSON.parse(raw) : null;
      if (rec?.userId === userId) {
        this.#state = rec.state ?? null;
        this.#cursor = this.#state ? (rec.cursor ?? null) : null;
      }
    } catch (_) { /* unreadable → treated as none */ }
    return this.#state;
  }

  /** @returns {string|null} where the next load continues from (null → load everything) */
  get cursor() {
    return this.#cursor;
  }

  /** @returns {object|null} the copy the cloud last confirmed */
  get state() {
    return this.#state;
  }

  /**
   * Record what the cloud now holds.
   * @param {object} state  already stripped of transient keys
   * @param {string|null} [cursor]  from a load; omitted after a save, keeping the current one
   */
  set(state, cursor = this.#cursor) {
    this.#state = BookDiff.clone(state);
    this.#cursor = cursor;
    try {
      localStorage.setItem(SyncBaseline.#KEY,
        JSON.stringify({ userId: this.#userId, state: this.#state, cursor: this.#cursor }));
    } catch (_) {
      // Quota or private mode: the in-memory copy still covers this session.
    }
  }

  /** Forget it (sign-out). */
  clear() {
    this.#state = null;
    this.#cursor = null;
    this.#userId = null;
    try { localStorage.removeItem(SyncBaseline.#KEY); } catch (_) {}
  }
}
