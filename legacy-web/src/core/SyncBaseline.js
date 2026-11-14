/**
 * SyncBaseline — this device's copy of the book as the cloud last had it.
 *
 * Comparing the current state with this copy tells the sync exactly which
 * items were changed here and not yet saved. Keeping it in localStorage (not
 * just memory) is what makes that work across a reload or a crash: edits made
 * just before the tab closed are found again and replayed onto the latest
 * cloud copy instead of being lost or overwriting other devices' changes.
 */
import { BookDiff } from './BookDiff.js';

export class SyncBaseline {
  static #KEY = 'pocket.v2.baseline';

  #userId = null;
  #state = null;

  /** Load the stored copy for this user (null when none). */
  load(userId) {
    this.#userId = userId;
    this.#state = null;
    try {
      const raw = localStorage.getItem(SyncBaseline.#KEY);
      const rec = raw ? JSON.parse(raw) : null;
      if (rec?.userId === userId) this.#state = rec.state ?? null;
    } catch (_) { /* unreadable → treated as none */ }
    return this.#state;
  }

  /** @returns {object|null} the copy the cloud last confirmed */
  get state() {
    return this.#state;
  }

  /**
   * Record what the cloud now holds.
   * @param {object} state  already stripped of transient keys
   */
  set(state) {
    this.#state = BookDiff.clone(state);
    try {
      localStorage.setItem(SyncBaseline.#KEY, JSON.stringify({ userId: this.#userId, state: this.#state }));
    } catch (_) {
      // Quota or private mode: the in-memory copy still covers this session.
    }
  }

  /** Forget it (sign-out). */
  clear() {
    this.#state = null;
    this.#userId = null;
    try { localStorage.removeItem(SyncBaseline.#KEY); } catch (_) {}
  }
}
