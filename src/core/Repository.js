/**
 * Repository — Persistence abstraction over localStorage.
 *
 * Isolates storage mechanics so they can be swapped (e.g. IndexedDB,
 * server-side) without touching any domain or UI code.
 */
export class Repository {
  static #STORAGE_KEY = 'pocket.v1';

  /**
   * Persist the entire application state snapshot.
   * @param {object} state
   */
  save(state) {
    try {
      localStorage.setItem(Repository.#STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error('[Repository] Failed to save state:', err);
    }
  }

  /**
   * Load persisted state or return null when nothing has been saved yet.
   * @returns {object|null}
   */
  load() {
    try {
      const raw = localStorage.getItem(Repository.#STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Wipe all persisted data (logout / reset).
   */
  clear() {
    localStorage.removeItem(Repository.#STORAGE_KEY);
  }
}
