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

  constructor() {
    if (Store.#instance) {
      throw new Error('Store is a singleton — use Store.getInstance()');
    }
    this.#repository = new Repository();
    this.#bus        = EventBus.getInstance();
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
   * Replace the entire state object (used by cloud sync after a remote pull).
   * @param {object} newState
   */
  replaceState(newState) {
    this.#state = newState;
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
