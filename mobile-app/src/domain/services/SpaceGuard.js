/**
 * SpaceGuard — the one place that answers "may I do this here, and to whose
 * book?".
 *
 * Spaces made `useAppState().state` mean something different depending on which
 * space is active: at home it is the member's own book, in a guest space it is
 * another person's snapshot. Reads re-point for free. Writes do not — every
 * screen was written when there was only one book, so each one happily takes an
 * id out of whatever state it was handed and passes it to a service that writes
 * to `store.getState()`. The result is a row in the member's own ledger
 * referencing an account and a category that exist only in the owner's, which
 * renders as "Uncategorised", belongs to no account, and is invisible to the
 * owner it was meant for. An audit found five reachable variants of that, none
 * of which raised an error.
 *
 * Scattering `if (inGuestSpace)` through the screens would fix those five and
 * catch none of the next five, because the rule would live in fifteen places
 * and a new screen starts with zero of them. So the policy lives here instead:
 * one object, no React, no DOM, fully exercisable from a node test — which is
 * the actual reason the bugs survived, since the policy used to live in JSX
 * that nothing could import.
 *
 * Every method returns a VERDICT rather than a boolean:
 *
 *     { ok: true,  ... }              go ahead, here is how
 *     { ok: false, message: '...' }   refuse, and here is what to tell the user
 *
 * The message is part of the answer on purpose. A guard that only says "no"
 * leaves each caller to invent its own wording, and the ones that had to invent
 * it invented "Transaction not found" — which reads, to someone standing in a
 * space they were invited into, as though their data had been lost.
 */
export class SpaceGuard {
  /** @type {import('./SpaceRegistry.js').SpaceRegistry} */ #spaces;
  /** @type {import('../../core/Store.js').Store} */        #store;
  /** @type {object} */                                     #sync;

  /**
   * @param {object} deps
   * @param {object} deps.spaces  SpaceRegistry
   * @param {object} deps.store   Store — the REAL local book, never a projection
   * @param {object} [deps.sync]  SyncService, for the signed-in email
   */
  constructor({ spaces, store, sync = null }) {
    this.#spaces = spaces;
    this.#store  = store;
    this.#sync   = sync;
  }

  // ── What we are looking at ───────────────────────────────────────────

  /** @returns {import('./Space.js').Space|null} */
  get space() { return this.#spaces?.active?.() ?? null; }

  /** @returns {boolean} true when the visible book belongs to someone else */
  get inGuest() {
    const s = this.space;
    return !!s && !s.isHome;
  }

  /** @returns {string} the active space's display name */
  get label() { return this.space?.label || 'your own space'; }

  /** @returns {string|null} whose book a contribution from here lands in */
  get ownerId() { return this.space?.ownerId ?? null; }

  /** @returns {string} lower-cased signed-in email, '' when signed out */
  get #myEmail() { return (this.#sync?.currentUser?.email || '').toLowerCase(); }

  // ── Personal scope ───────────────────────────────────────────────────

  /**
   * For anything that is a fact about the MEMBER rather than about the space:
   * their accounts, categories, budgets, debts, regular items, family list,
   * preferences, backups.
   *
   * These screens must never act while a guest space is selected, because the
   * ids on screen are the owner's. The web app spells the same rule as
   * `#HOME_ONLY_MODALS`; this is its mobile half.
   *
   * @param {string} what  a noun for the message, e.g. 'accounts'
   * @returns {{ok: boolean, message?: string}}
   */
  requireHome(what = 'that') {
    if (!this.inGuest) return { ok: true };
    return {
      ok: false,
      message: `You're in ${this.label}. Switch to your own space to change ${what}.`,
    };
  }

  // ── Transactions ─────────────────────────────────────────────────────

  /**
   * Where a NEW transaction should be written.
   *
   * At home: nowhere special, the local composer handles it. In a guest space
   * it is a CONTRIBUTION to the owner — decided here, before the form opens, so
   * the form comes up pointed at the right ledger rather than being corrected
   * afterwards by whichever field the user happens to touch first. That
   * after-the-fact correction is what produced the duplicate-row bug: an edit
   * of an existing row acquired contribution mode without carrying its id, so
   * submitting created a second copy in the owner's book.
   *
   * @returns {{ok: true, sharedMode: object|null}|{ok: false, message: string}}
   */
  routeNewTransaction() {
    const space = this.space;
    if (!space || space.isHome) return { ok: true, sharedMode: null };

    const target = space.accounts.find((a) => space.canAdd(a.id));
    if (!target) {
      return { ok: false, message: `You have view-only access to ${space.label}.` };
    }
    return {
      ok: true,
      sharedMode: { ownerId: space.ownerId, accountId: target.id },
    };
  }

  /**
   * Whether an existing row may be opened for editing here, and against which
   * book.
   *
   * Three cases, and the awkward one is the third:
   *
   *   home                     — a normal local edit.
   *   guest, owner's row       — a contribution edit, but only if it is the
   *                              member's own contribution or they hold `full`
   *                              on the account. Someone else's row is theirs.
   *   guest, member's own row  — refused. Reports and Dashboard still compute
   *                              from the local book, so they can offer a local
   *                              row while the space bar says otherwise; acting
   *                              on it would write to a book the screen is not
   *                              claiming to show.
   *
   * @param {string} txId
   * @returns {{ok: true, sharedMode: object|null}|{ok: false, message: string}}
   */
  routeEditTransaction(txId) {
    const space = this.space;
    if (!space || space.isHome) return { ok: true, sharedMode: null };

    const row = (space.transactions || []).find((t) => t.id === txId);
    if (!row) {
      return {
        ok: false,
        message: `That's in your own book, and you're viewing ${space.label}. Switch spaces to edit it.`,
      };
    }
    if (row.type === 'transfer') {
      return { ok: false, message: 'Transfers can only be edited by the account owner.' };
    }
    if (!this.#mayTouch(space, row)) {
      return { ok: false, message: this.#refusal(space, row, 'edit') };
    }
    return {
      ok: true,
      sharedMode: { ownerId: space.ownerId, accountId: row.accountId, editTxId: row.id },
    };
  }

  /**
   * Same question for a delete. Split from the edit route because the services
   * silently no-op on an unknown id: `TransactionService.delete` does
   * `if (!tx) return;`, so deleting an owner's row from a guest space closed
   * the screen and changed nothing, with no error and no row removed.
   *
   * @param {string} txId
   * @returns {{ok: true, contribution: {ownerId: string, txId: string}|null}
   *          |{ok: false, message: string}}
   */
  routeDeleteTransaction(txId) {
    const space = this.space;
    if (!space || space.isHome) return { ok: true, contribution: null };

    const row = (space.transactions || []).find((t) => t.id === txId);
    if (!row) {
      return {
        ok: false,
        message: `That's in your own book, and you're viewing ${space.label}. Switch spaces to delete it.`,
      };
    }
    if (!this.#mayTouch(space, row)) {
      return { ok: false, message: this.#refusal(space, row, 'delete') };
    }
    return { ok: true, contribution: { ownerId: space.ownerId, txId: row.id } };
  }

  /**
   * Logging a regular item — the path that actually corrupted data, because
   * nothing about it looked like sharing. In a guest space the item list is the
   * OWNER's, and their items carry no `sharedOwnerId` (it is their own book, so
   * why would they), which made the existing `AccountRef.isShared` check answer
   * "not shared" and fall through to a local push.
   *
   * @param {object} item  a regularItem as shown on screen
   * @returns {{ok: true, contribution: {ownerId: string}|null}
   *          |{ok: false, message: string}}
   */
  routeLogRegular(item) {
    const space = this.space;
    if (!space || space.isHome) return { ok: true, contribution: null };

    const accountId = item?.accountId;
    if (!accountId || !space.accounts.some((a) => a.id === accountId)) {
      return {
        ok: false,
        message: `That item belongs to your own book, and you're viewing ${space.label}.`,
      };
    }
    if (!space.canAdd(accountId)) {
      return { ok: false, message: `You have view-only access to that account in ${space.label}.` };
    }
    return { ok: true, contribution: { ownerId: space.ownerId } };
  }

  // ── Reporting ────────────────────────────────────────────────────────

  /**
   * A guest space holds only the accounts shared with the member, so anything
   * summed inside it is a subset presented as a total. Screens print this next
   * to the figure rather than letting it read as the owner's whole picture.
   * @returns {string} '' at home
   */
  get scopeNote() { return this.space?.scopeNote || ''; }

  // ── Internals ────────────────────────────────────────────────────────

  /**
   * `full` on the account means the whole account is yours to manage. Short of
   * that, a member may only touch rows they added themselves — matching
   * FamilyScreen's long-standing rule for the owner's own contribution list.
   * @param {import('./Space.js').Space} space
   * @param {object} row
   */
  #mayTouch(space, row) {
    if (space.canDelete(row.accountId)) return true;      // 'full' (or 'owner')
    const mine = (row.addedBy || '').toLowerCase();
    return !!mine && mine === this.#myEmail;
  }

  /** @returns {string} */
  #refusal(space, row, verb) {
    if (!space.canEdit(row.accountId)) {
      return `You have view-only access to that account in ${space.label}.`;
    }
    return `Only ${row.addedBy || 'whoever added it'} can ${verb} that entry.`;
  }
}
