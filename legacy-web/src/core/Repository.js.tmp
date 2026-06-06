/**
 * Repository — Persistence abstraction over localStorage.
 *
 * Isolates storage mechanics so they can be swapped (e.g. IndexedDB,
 * server-side) without touching any domain or UI code.
 */
export class Repository {
  static #STORAGE_KEY = 'pocket.v1';
  static #BACKUP_KEY  = 'pocket.v1.corrupt';

  /** True if the last load() hit corrupt data (so callers can warn the user). */
  lastLoadCorrupted = false;

  /**
   * Persist the entire application state snapshot.
   * @param {object} state
   */
  save(state) {
    try {
      localStorage.setItem(Repository.#STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      console.error('[Repository] Failed to save state:', err);
      return false;
    }
  }

  /**
   * Load persisted state or return null when nothing has been saved yet.
   * @returns {object|null}
   */
  load() {
    this.lastLoadCorrupted = false;
    const raw = localStorage.getItem(Repository.#STORAGE_KEY);
    if (raw == null) return null; // 