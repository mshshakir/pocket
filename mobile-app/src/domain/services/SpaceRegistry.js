/**
 * SpaceRegistry — which book the app is currently showing.
 *
 * The active space is SESSION state, not user data. Two reasons it must never
 * be written into `state.user`:
 *
 *  1. It would sync to the cloud, where it is meaningless — "I was looking at
 *     Abbas's space" is not a fact about your ledger, and it would follow you
 *     onto every other device.
 *  2. A share that is revoked while you are standing in it has to degrade to
 *     "you were dropped back to your own space", not to a persistent pointer
 *     at a book that no longer exists.
 *
 * `sessionStorage` gives the right lifetime: a reload keeps you where you were,
 * a new tab or a new day starts at home.
 */
import { Space } from './Space.js';

const STORAGE_KEY = 'pocket.v1.space';

/**
 * Where the active-space selection lives.
 *
 * The web app uses sessionStorage: a reload keeps you where you were, a new tab
 * starts at home. React Native has no such thing, and "a session" is murky when
 * an app can be backgrounded for days — so mobile injects an in-memory store,
 * which resets to home on a cold start. That is the same intent, and it means
 * this file stays a verbatim copy on both platforms.
 */
const defaultSessionStore = () => {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch (_) { /* access can throw in a sandboxed frame */ }
  const mem = new Map();
  return {
    getItem:    (k) => (mem.has(k) ? mem.get(k) : null),
    setItem:    (k, v) => { mem.set(k, v); },
    removeItem: (k) => { mem.delete(k); },
  };
};

export class SpaceRegistry {
  /** @type {import('../../core/Store.js').Store} */ #store;
  /** @type {object} */ #sync;
  /** @type {Function} */ #spaceFactory;

  /** @type {string|null} owner id of the active space, null = home */
  #activeId = null;

  /** @type {Set<Function>} */ #listeners = new Set();
  /** @type {{getItem:Function,setItem:Function,removeItem:Function}} */ #session;

  /**
   * Last resolved label of the active guest space.
   *
   * By the time a revocation is noticed the snapshot is already gone from
   * `sharedData`, so `sharedBy` can no longer be read — the message would
   * degrade to the generic "Shared with me removed your access", which tells
   * the user nothing. Remembering it while the space is live is what lets the
   * notice name the person.
   */
  #lastLabel = null;

  /**
   * @param {object} deps
   * @param {object} deps.store
   * @param {object} deps.sync          SyncService — read only, for `sharedData`
   * @param {Function} deps.spaceFactory  ({id, share, state}) => Space
   */
  constructor({ store, sync, spaceFactory, sessionStore = null }) {
    this.#store        = store;
    this.#sync         = sync;
    this.#spaceFactory = spaceFactory;
    this.#session      = sessionStore || defaultSessionStore();
    this.#activeId     = this.#readPersisted();
  }

  // ── Query ────────────────────────────────────────────────────────────

  /**
   * The id a snapshot is addressed by.
   *
   * Delegates to Space.keyFor rather than repeating the rule. This started as a
   * private copy here, and a mutation test proved the copy was the only live
   * one — Space.keyFor could be broken with every assertion still green, which
   * is precisely the drift two copies of a rule always end in.
   * @param {object} share
   * @returns {string}
   */
  #keyOf(share) {
    return Space.keyFor(share);
  }

  /** @returns {object[]} the shared snapshots currently available */
  #shares() {
    return this.#sync?.sharedData || [];
  }

  /**
   * Home first, then one guest space per owner sharing with you.
   * @returns {import('./Space.js').Space[]}
   */
  all() {
    const state = this.#store.getState();
    return [
      this.#spaceFactory({ id: null, share: null, state }),
      ...this.#shares().map((share) => this.#spaceFactory({ id: this.#keyOf(share), share, state })),
    ];
  }

  /**
   * The active space, falling back to home whenever the selected one is no
   * longer available. This is the ONLY place that fallback lives, so a revoked
   * share can never leave a view rendering against a snapshot that has gone.
   * @returns {import('./Space.js').Space}
   */
  active() {
    const state = this.#store.getState();
    if (this.#activeId === null) return this.#spaceFactory({ id: null, share: null, state });
    const share = this.#shares().find((s) => this.#keyOf(s) === this.#activeId);
    if (share) {
      const space = this.#spaceFactory({ id: this.#activeId, share, state });
      this.#lastLabel = space.label;
      return space;
    }
    {
      // Selected space has vanished. Reset quietly here; announcing it is the
      // caller's job (see reconcile()), because active() is called on every
      // render and must not toast on each one.
      this.#activeId = null;
      this.#persist();
      return this.#spaceFactory({ id: null, share: null, state });
    }
  }

  /** @returns {string|null} */
  get activeId() { return this.#activeId; }

  /** @returns {boolean} */
  get isHome() { return this.#activeId === null; }

  /** @returns {boolean} true when there is anything to switch between */
  get hasGuestSpaces() { return this.#shares().length > 0; }

  // ── Mutation ─────────────────────────────────────────────────────────

  /**
   * Switch spaces.
   * @param {string|null} spaceId  null (or an unknown id) selects home
   * @returns {boolean} true if the active space changed
   */
  activate(spaceId) {
    const next = spaceId && this.#shares().some((s) => this.#keyOf(s) === spaceId) ? spaceId : null;
    if (next === this.#activeId) return false;
    this.#activeId  = next;
    this.#lastLabel = next ? this.labelFor(next) : null;
    this.#persist();
    for (const cb of this.#listeners) {
      try { cb(this.active()); } catch (e) { console.error('[SpaceRegistry] listener failed:', e); }
    }
    return true;
  }

  /**
   * Re-check the active space after a pull, and report if it went away.
   *
   * Answers the "tell the user, don't silently relocate them" requirement: the
   * caller closes any open modal and shows the message. Returns null when
   * nothing changed, so the common path costs nothing.
   *
   * @returns {{lostLabel: string, reason: 'revoked'}|null}
   */
  reconcile() {
    if (this.#activeId === null) return null;
    if (this.#shares().some((s) => this.#keyOf(s) === this.#activeId)) return null;
    // Resolve the label BEFORE dropping the id, or the message has nothing to
    // name — the snapshot it came from is already gone.
    const label = this.#lastLabel || this.labelFor(this.#activeId);
    this.#activeId = null;
    this.#lastLabel = null;
    this.#persist();
    return { lostLabel: label, reason: 'revoked' };
  }

  /**
   * Display label for a space id, usable even after its snapshot has gone (the
   * member-side override outlives the share).
   * @param {string|null} spaceId
   * @returns {string}
   */
  labelFor(spaceId) {
    if (!spaceId) return this.#store.getState().user?.name || 'My money';
    const override = (this.#store.getState().user?.spaceLabels || {})[spaceId];
    if (override) return override;
    const share = this.#shares().find((s) => this.#keyOf(s) === spaceId);
    return share?.sharedBy || 'Shared with me';
  }

  /**
   * Set (or clear) the member-side name for a space.
   *
   * Stored in the member's OWN book, so it syncs normally and needs no server
   * change — and the owner's next push can't overwrite it.
   * @param {string} spaceId
   * @param {string} label  '' clears the override
   */
  setLabel(spaceId, label) {
    if (!spaceId) return;
    const state = this.#store.getState();
    if (!state.user.spaceLabels || typeof state.user.spaceLabels !== 'object') {
      state.user.spaceLabels = {};
    }
    const trimmed = (label || '').trim().slice(0, 60);
    if (trimmed) state.user.spaceLabels[spaceId] = trimmed;
    else delete state.user.spaceLabels[spaceId];
    this.#store.persist();
  }

  /** @param {Function} cb @returns {Function} unsubscribe */
  onChange(cb) {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  // ── Persistence (session-scoped) ─────────────────────────────────────

  #readPersisted() {
    try { return this.#session.getItem(STORAGE_KEY) || null; } catch (_) { return null; }
  }

  #persist() {
    try {
      if (this.#activeId) this.#session.setItem(STORAGE_KEY, this.#activeId);
      else this.#session.removeItem(STORAGE_KEY);
    } catch (_) { /* private mode — the selection just won't survive a reload */ }
  }
}
