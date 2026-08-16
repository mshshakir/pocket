/**
 * Space — the book a view is currently reading and writing.
 *
 * Before this existed, an account someone shared with you was a *detour*: you
 * stayed inside your own book at all times and occasionally reached sideways
 * into somebody else's. Every form that could target a shared account had to
 * remember to re-point its own category source, and any that forgot silently
 * wrote a local category id into the owner's book, where it rendered as
 * "Uncategorised". That class of bug is what this replaces — the unit the app
 * switches on is a book, not an account.
 *
 * There are exactly two kinds:
 *
 *   HOME   — the signed-in user's own state. Fully writable through the
 *            services, as it always was.
 *   GUEST  — one entry of `_sharedData`, i.e. the snapshot an owner published
 *            for this member. Reads come straight out of the snapshot; writes
 *            do NOT go through the services, they become contributions.
 *
 * This is a READ MODEL and never mutates anything. `SpaceRegistry` owns which
 * one is active; the services and `SyncService` keep writing to real local
 * state, which is why `Store.getState()` must never be handed a projection.
 */
export class Space {
  /** @type {string|null} */ #id;
  /** @type {object|null} */ #share;
  /** @type {object} */      #state;

  /**
   * @param {object} deps
   * @param {string|null} deps.id     null for home, the owner's uuid for a guest space
   * @param {object|null} [deps.share] the `_sharedData` entry, guest spaces only
   * @param {object} deps.state       live local state (always the REAL state)
   */
  constructor({ id, share = null, state }) {
    this.#id    = id;
    this.#share = share;
    this.#state = state;
  }

  /** @param {object} state @returns {Space} */
  static home(state) {
    return new Space({ id: null, state });
  }

  /** @param {object} share @param {object} state @returns {Space} */
  static guest(share, state) {
    return new Space({ id: share._ownerId, share, state });
  }

  // ── Identity ─────────────────────────────────────────────────────────

  /** @returns {string|null} null for home, owner id for a guest space */
  get id() { return this.#id; }

  /** @returns {boolean} */
  get isHome() { return this.#id === null; }

  /**
   * Display name.
   *
   * `share.sharedBy` is the owner's own choice of name, published with every
   * snapshot. A member-side override in `user.spaceLabels` wins, so you can
   * call a space whatever makes sense to you without the owner's next push
   * overwriting it.
   * @returns {string}
   */
  get label() {
    if (this.isHome) return this.#state.user?.name || 'My money';
    const override = (this.#state.user?.spaceLabels || {})[this.#id];
    return override || this.#share?.sharedBy || 'Shared with me';
  }

  // ── Data ─────────────────────────────────────────────────────────────

  /** @returns {object[]} */
  get accounts() {
    return this.isHome ? (this.#state.accounts || []) : (this.#share?.accounts || []);
  }

  /**
   * In a guest space this is the OWNER's whole tree — which is the point. A
   * contribution lands in their book, so its categoryId has to be one of
   * theirs; a local id is meaningless there.
   * @returns {object[]}
   */
  get categories() {
    return this.isHome ? (this.#state.categories || []) : (this.#share?.categories || []);
  }

  /** @returns {object[]} */
  get transactions() {
    return this.isHome ? (this.#state.transactions || []) : (this.#share?.transactions || []);
  }

  /**
   * Budgets granted to you individually. Each carries `spent`, computed by the
   * OWNER at push time — recomputing it here would understate it, because you
   * only hold the transactions on accounts shared with you.
   * @returns {object[]}
   */
  get budgets() {
    return this.isHome ? (this.#state.budgets || []) : (this.#share?.budgets || []);
  }

  /** @returns {object[]} debts on accounts shared with you */
  get debts() {
    return this.isHome ? (this.#state.debts || []) : (this.#share?.debts || []);
  }

  /** @returns {object[]} regular items on accounts shared with you */
  get regularItems() {
    return this.isHome ? (this.#state.regularItems || []) : (this.#share?.regularItems || []);
  }

  /**
   * @param {string} budgetId
   * @returns {'owner'|'view'|'edit'|'full'|null}
   */
  budgetPermissionFor(budgetId) {
    if (this.isHome) return 'owner';
    return (this.#share?.budgetPermission || {})[budgetId] || null;
  }

  /**
   * True when this space shows a PARTIAL view of the owner's activity — which
   * is always, for a guest space. Reports and budget detail must say so: an
   * unlabelled figure computed from a subset reads as a total.
   * @returns {boolean}
   */
  get isPartialView() { return !this.isHome; }

  /** @returns {string} the caveat to print next to a derived figure */
  get scopeNote() {
    if (this.isHome) return '';
    const n = this.accounts.length;
    return `across the ${n} account${n === 1 ? '' : 's'} shared with you`;
  }

  /** @returns {string} the currency totals in this space convert to */
  get homeCurrency() {
    return this.isHome
      ? (this.#state.user?.homeCurrency || 'USD')
      : (this.#share?.homeCurrency || this.#state.user?.homeCurrency || 'USD');
  }

  /** @returns {object|null} the raw snapshot, for callers that need `_ownerId` */
  get share() { return this.#share; }

  // ── Permissions ──────────────────────────────────────────────────────

  /**
   * @param {string} accountId
   * @returns {'owner'|'view'|'add'|'edit'|'full'|null}
   */
  permissionFor(accountId) {
    if (this.isHome) return 'owner';
    return (this.#share?.permission || {})[accountId] || null;
  }

  /** @param {string} accountId @returns {boolean} */
  canAdd(accountId) {
    const p = this.permissionFor(accountId);
    return p === 'owner' || p === 'add' || p === 'edit' || p === 'full';
  }

  /** @param {string} accountId @returns {boolean} */
  canEdit(accountId) {
    const p = this.permissionFor(accountId);
    return p === 'owner' || p === 'edit' || p === 'full';
  }

  /** @param {string} accountId @returns {boolean} */
  canDelete(accountId) {
    const p = this.permissionFor(accountId);
    return p === 'owner' || p === 'full';
  }

  /** @returns {boolean} true when at least one account here accepts new rows */
  get canAddAnywhere() {
    return this.accounts.some((a) => this.canAdd(a.id));
  }

  // ── Projection ───────────────────────────────────────────────────────

  /**
   * A state-shaped object scoped to this space, for the view layer.
   *
   * Home returns the real state object unchanged — no copy, so nothing that
   * legitimately mutates through it breaks. A guest space returns a SHALLOW
   * copy with the three collections substituted: views must treat it as
   * read-only, or they would be writing into an object the next pull discards.
   *
   * `_space` rides along so a view can ask what it is looking at without
   * reaching for the registry.
   * @returns {object}
   */
  project() {
    if (this.isHome) return this.#state;
    return {
      ...this.#state,
      accounts:     this.accounts,
      categories:   this.categories,
      transactions: this.transactions,
      budgets:      this.budgets,
      debts:        this.debts,
      regularItems: this.regularItems,
      // Account groups are the owner's own filing system and are not shared.
      accountGroups: [],
      user: { ...this.#state.user, homeCurrency: this.homeCurrency },
      _space: this,
    };
  }
}
