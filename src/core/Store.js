/**
 * Store — Singleton observable state container.
 *
 * All state mutations go through Store so changes can be observed and
 * persisted atomically.  Domain services mutate via getState() + setState();
 * views subscribe via EventBus('state:changed').
 *
 * Architecture notes:
 *  - Store owns the single source of truth for in-memory state.
 *  - Repository handles localStorage; Store delegates to it on every mutation.
 *  - EventBus carries change notifications to the UI layer.
 */
import { EventBus } from './EventBus.js';
import { Repository } from './Repository.js';

export class Store {
  /** @type {Store|null} */
  static #instance = null;

  /** @type {object} */
  #state;

  /** @type {Repository} */
  #repository;

  /** @type {EventBus} */
  #bus;

  /** Guards against repeating the storage-failure toast on every save. */
  #saveWarned = false;

  /**
   * Optional hook run immediately before every persist. Used to recompute
   * derived data (account balances) so the stored/emitted state is always a
   * pure function of the ledger. Injected by the Application root to avoid the
   * core layer depending on a domain service.
   * @type {(() => void)|null}
   */
  #derive = null;

  /** Monotonic revision counter, bumped on every persist (cache-key friendly). */
  #revision = 0;

  constructor() {
    if (Store.#instance) {
      throw new Error('Store is a singleton — use Store.getInstance()');
    }
    this.#repository = new Repository();
    this.#bus        = EventBus.getInstance();
  }

  /**
   * Register the derive hook (e.g. () => accountService.recompute()).
   * @param {() => void} fn
   */
  setDeriveHook(fn) {
    this.#derive = fn;
  }

  /** @returns {number} current state revision */
  get revision() {
    return this.#revision;
  }

  /** @returns {boolean} true if the last load() encountered corrupt data */
  get repositoryCorrupted() {
    return !!this.#repository.lastLoadCorrupted;
  }

  /** @returns {Store} */
  static getInstance() {
    if (!Store.#instance) {
      Store.#instance = new Store();
    }
    return Store.#instance;
  }

  // ── Initialisation ──────────────────────────────────────────────────

  /**
   * Boot the store: load persisted state or fall back to the seed factory.
   * @param {Function} seedFactory - () => object  called when no persisted data exists
   * @param {Function} migrateDefaults - (state) => void  back-fills new fields
   */
  init(seedFactory, migrateDefaults = () => {}) {
    const persisted = this.#repository.load();
    this.#state = persisted ?? seedFactory();
    migrateDefaults(this.#state);
    return this;
  }

  // ── State access ────────────────────────────────────────────────────

  /**
   * Return a reference to the current state.
   * Callers should treat this as read-only; all mutations go through setState().
   * @returns {object}
   */
  getState() {
    return this.#state;
  }

  /**
   * Apply a mutation to state, persist it, and notify subscribers.
   *
   * Accepts either a plain partial object (shallow-merged) or an updater
   * function that receives the current state and returns a partial update.
   *
   * @param {object|Function} updaterOrPartial
   * @param {object} [options]
   * @param {boolean} [options.silent=false] - skip event emission (batch mode)
   */
  setState(updaterOrPartial, { silent = false } = {}) {
    const patch =
      typeof updaterOrPartial === 'function'
        ? updaterOrPartial(this.#state)
        : updaterOrPartial;

    Object.assign(this.#state, patch);
    this.#persistState();

    if (!silent) {
      this.#bus.emit('state:changed', this.#state);
    }
  }

  /**
   * Replace the entire state (used by cloud sync after a remote pull).
   * Runs the supplied migration FIRST so a cloud snapshot from an older schema
   * is brought current before any view or service touches it.
   *
   * The replacement is applied IN PLACE (keys cleared, then copied) so the state
   * object's identity is preserved. Async callers that captured a getState()
   * reference before an await (e.g. SyncService.#pullMemberContributions) keep
   * pointing at the live object, instead of silently mutating an orphaned
   * snapshot whose writes never persist.
   * @param {object} newState
   * @param {(state: object) => void} [migrate]  schema back-fill
   */
  replaceState(newState, migrate = () => {}) {
    migrate(newState);
    for (const k of Object.keys(this.#state)) {
      if (!(k in newState)) delete this.#state[k];
    }
    Object.assign(this.#state, newState);
    this.#persistState();
    this.#bus.emit('state:changed', this.#state);
  }

  /**
   * Force-save the current state (e.g. after cloud sync has applied in-place
   * mutations to nested arrays without going through setState).
   */
  persist() {
    this.#persistState();
  }

  /**
   * Persist + notify (useful after bulk in-place mutations like CSV import).
   */
  flush() {
    this.#persistState();
    this.#bus.emit('state:changed', this.#state);
  }

  /**
   * Reset to seed data (hard reset / sign-out wipe).
   * @param {Function} seedFactory
   * @param {Function} migrateDefaults
   */
  reset(seedFactory, migrateDefaults) {
    this.#repository.clear();
    this.#state = seedFactory();
    migrateDefaults(this.#state);
    this.#persistState();
    this.#bus.emit('state:changed', this.#state);
  }

  /**
   * Persist via the Repository and surface a one-time warning if the write
   * fails (e.g. localStorage quota exceeded), so a silent save failure can't go
   * unnoticed and let a later cloud push overwrite good data with stale state (I6).
   * @returns {boolean} success
   */
  #persistState() {
    // Recompute derived data (balances) so the saved + emitted state is always
    // consistent with the ledger, regardless of how callers mutated it.
    try { this.#derive?.(); } catch (e) { console.error('[Store] derive hook failed:', e); }
    this.#revision++;
    const ok = this.#repository.save(this.#state);
    if (!ok && !this.#saveWarned) {
      this.#saveWarned = true;
      this.#bus.emit('toast', { message: 'Could not save locally — device storage may be full' });
    } else if (ok) {
      this.#saveWarned = false;
    }
    return ok;
  }
}
