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
    if (raw == null) return null; // genuinely empty → seeding fresh is correct

    try {
      return JSON.parse(raw);
    } catch (err) {
      // Corrupt payload: DON'T silently discard. Preserve the raw value under a
      // backup key for manual recovery and flag the corruption so the caller can
      // warn the user instead of overwriting good cloud data with seed state.
      console.error('[Repository] Corrupt persisted state — backed up to', Repository.#BACKUP_KEY, err);
      try { localStorage.setItem(Repository.#BACKUP_KEY, raw); } catch (_) {}
      this.lastLoadCorrupted = true;
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
