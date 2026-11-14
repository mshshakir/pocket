/**
 * Repository — Persistence abstraction over localStorage.
 *
 * Isolates storage mechanics so they can be swapped (e.g. IndexedDB,
 * server-side) without touching any domain or UI code.
 */
export class Repository {
  static #STORAGE_KEY = 'pocket.v1';
  static #BACKUP_KEY  = 'pocket.v1.corrupt';
  /**
   * Whose book is stored here (a user id), written with every save. Several
   * people can use one browser; without this, a book left on the device by one
   * person (e.g. re-saved by another open tab after they signed out) could be
   * shown to the next person who signs in. Nobody's yet (a guest) = absent.
   */
  static #OWNER_KEY   = 'pocket.v1.owner';
  static OWNER_KEY    = Repository.#OWNER_KEY;

  /** True if the last load() hit corrupt data (so callers can warn the user). */
  lastLoadCorrupted = false;

  /** Whose book this tab holds, saved alongside it. */
  #owner = null;

  /** @returns {string|null} the owner recorded on the device right now (any tab may have written it) */
  static storedOwner() {
    try { return localStorage.getItem(Repository.#OWNER_KEY) || null; } catch (_) { return null; }
  }

  /**
   * The book stored on the device right now, as any tab last saved it (not
   * necessarily what this tab holds in memory). Null when none or unreadable.
   * @returns {object|null}
   */
  static storedBook() {
    try {
      const raw = localStorage.getItem(Repository.#STORAGE_KEY);
      return raw == null ? null : JSON.parse(raw);
    } catch (_) { return null; }
  }

  get owner() { return this.#owner; }

  /** @param {string|null} userId */
  set owner(userId) { this.#owner = userId || null; }

  /**
   * Persist the entire application state snapshot.
   * @param {object} state
   */
  /**
   * Keys the app hangs on state at render time but which are NOT the user's
   * data: `_sharedData` is a full copy of every OTHER user's shared snapshot
   * (their accounts, matching transactions and ALL their categories). Writing
   * it here duplicated all of that into localStorage on every persist and
   * uploaded it on every push — the fastest route to a quota failure, after
   * which saves fail silently.
   * @param {object} state
   * @returns {object} a shallow copy without transient `_`-prefixed keys
   */
  static stripTransient(state) {
    const out = {};
    for (const k of Object.keys(state)) if (!k.startsWith('_')) out[k] = state[k];
    return out;
  }

  save(state) {
    try {
      localStorage.setItem(
        Repository.#STORAGE_KEY,
        JSON.stringify(Repository.stripTransient(state)),
      );
      if (this.#owner) localStorage.setItem(Repository.#OWNER_KEY, this.#owner);
      else localStorage.removeItem(Repository.#OWNER_KEY);
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
    this.#owner = Repository.storedOwner();

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
    try { localStorage.removeItem(Repository.#OWNER_KEY); } catch (_) { /* private mode */ }
    this.#owner = null;
  }
}
