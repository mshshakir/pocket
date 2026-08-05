/**
 * AccountGroupService — CRUD and membership for account groups.
 *
 * A group is a flat label on accounts: `account.groupId` points at
 * `state.accountGroups[].id`, and an account with no (or a dangling) groupId
 * renders under "Ungrouped". Nothing else in the app depends on grouping, so
 * every operation here is safe to undo by regrouping.
 *
 * Group logic used to live inline in app.js (create-on-save inside
 * submitAccount, delete inside deleteAccountGroup) with no rename and no bulk
 * assignment. Collecting it here gives the manage sheet one place to call and
 * keeps the rules — unique names, orphan handling — in a single spot.
 */
import { Store }           from '../../core/Store.js';
import { IdGenerator }     from './IdGenerator.js';
import { CategoryService } from './CategoryService.js';

export class AccountGroupService {
  /** @type {Store} */ #store;

  constructor(store) {
    this.#store = store || Store.getInstance();
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /** @returns {object[]} all groups, in stored order */
  all() {
    const state = this.#store.getState();
    if (!Array.isArray(state.accountGroups)) state.accountGroups = [];
    return state.accountGroups;
  }

  /** @param {string} id @returns {object|undefined} */
  find(id) {
    return this.all().find((g) => g.id === id);
  }

  /**
   * Accounts belonging to a group.
   * @param {string} id
   * @returns {object[]}
   */
  accountsIn(id) {
    return this.#store.getState().accounts.filter((a) => a.groupId === id);
  }

  /**
   * Accounts with no group, or whose group no longer exists.
   * @returns {object[]}
   */
  ungrouped() {
    const valid = new Set(this.all().map((g) => g.id));
    return this.#store.getState().accounts.filter((a) => !a.groupId || !valid.has(a.groupId));
  }

  // ── Mutations ───────────────────────────────────────────────────────

  /**
   * Create a group. Re-uses an existing group when the name matches
   * case-insensitively, so "create" is idempotent from the user's point of view.
   *
   * @param {string} name
   * @param {object} [opts]
   * @param {string} [opts.color]
   * @returns {{ok:true, group:object, created:boolean}|{ok:false, reason:string}}
   */
  create(name, { color } = {}) {
    const clean = (name || '').trim();
    if (!clean) return { ok: false, reason: 'Enter a group name' };

    const existing = this.all().find((g) => g.name.toLowerCase() === clean.toLowerCase());
    if (existing) return { ok: true, group: existing, created: false };

    const group = {
      id:    IdGenerator.generate('grp'),
      name:  clean,
      color: color || CategoryService.colorForName(clean),
    };
    this.all().push(group);
    this.#store.flush();
    return { ok: true, group, created: true };
  }

  /**
   * Rename a group in place — accounts reference it by id, so nothing else
   * needs updating.
   * @param {string} id
   * @param {string} name
   * @returns {{ok:true, group:object}|{ok:false, reason:string}}
   */
  rename(id, name) {
    const clean = (name || '').trim();
    if (!clean) return { ok: false, reason: 'Enter a group name' };

    const group = this.find(id);
    if (!group) return { ok: false, reason: 'That group no longer exists' };

    const clash = this.all().find(
      (g) => g.id !== id && g.name.toLowerCase() === clean.toLowerCase(),
    );
    if (clash) return { ok: false, reason: `"${clash.name}" already exists` };

    group.name = clean;
    this.#store.flush();
    return { ok: true, group };
  }

  /**
   * Delete a group. Its accounts are un-grouped, never deleted.
   * @param {string} id
   * @returns {{ok:true, orphaned:number}|{ok:false, reason:string}}
   */
  delete(id) {
    const state = this.#store.getState();
    if (!this.find(id)) return { ok: false, reason: 'That group no longer exists' };

    let orphaned = 0;
    for (const a of state.accounts) {
      if (a.groupId === id) { a.groupId = null; orphaned++; }
    }
    state.accountGroups = this.all().filter((g) => g.id !== id);
    this.#store.flush();
    return { ok: true, orphaned };
  }

  /**
   * Move a set of accounts into a group (or out of every group when groupId is
   * null). This is the bulk-assign the UI needs — assigning one at a time
   * through the account form was the only way before.
   *
   * @param {string[]}      accountIds
   * @param {string|null}   groupId
   * @returns {number} how many accounts changed
   */
  assign(accountIds, groupId) {
    const ids = new Set((accountIds || []).filter(Boolean));
    if (!ids.size) return 0;
    if (groupId && !this.find(groupId)) return 0;

    let moved = 0;
    for (const a of this.#store.getState().accounts) {
      if (!ids.has(a.id)) continue;
      const next = groupId || null;
      if ((a.groupId || null) !== next) { a.groupId = next; moved++; }
    }
    if (moved) this.#store.flush();
    return moved;
  }

  /**
   * Set a group's exact membership: every listed account joins, and any account
   * currently in the group but not listed is un-grouped. Used by the manage
   * sheet's tick-list, where unticking must mean "remove from this group".
   *
   * @param {string}   groupId
   * @param {string[]} accountIds
   * @returns {number} how many accounts changed
   */
  setMembers(groupId, accountIds) {
    if (!this.find(groupId)) return 0;
    const want = new Set((accountIds || []).filter(Boolean));

    let changed = 0;
    for (const a of this.#store.getState().accounts) {
      const shouldBeIn = want.has(a.id);
      const isIn       = a.groupId === groupId;
      if (shouldBeIn && !isIn)      { a.groupId = groupId; changed++; }
      else if (!shouldBeIn && isIn) { a.groupId = null;    changed++; }
    }
    if (changed) this.#store.flush();
    return changed;
  }

  /**
   * Replace the current grouping with one group per currency.
   *
   * This REASSIGNS every account, so it discards any hand-made arrangement —
   * callers must confirm with the user first. Groups that end up empty
   * afterwards are removed, so repeated runs don't accumulate debris.
   *
   * @returns {{groups:number, accounts:number, removed:number}}
   */
  groupByCurrency() {
    const state = this.#store.getState();
    if (!Array.isArray(state.accountGroups)) state.accountGroups = [];

    const byCurrency = new Map(); // currency → group
    let assigned = 0;

    for (const a of state.accounts) {
      const ccy = (a.currency || '').toUpperCase() || 'UNKNOWN';
      if (!byCurrency.has(ccy)) {
        // Re-use a same-named group if one already exists, so running this
        // twice doesn't create "USD" alongside a second "USD".
        const existing = state.accountGroups.find((g) => g.name.toLowerCase() === ccy.toLowerCase());
        byCurrency.set(ccy, existing || {
          id:    IdGenerator.generate('grp'),
          name:  ccy,
          color: CategoryService.colorForName(ccy),
        });
        if (!existing) state.accountGroups.push(byCurrency.get(ccy));
      }
      const target = byCurrency.get(ccy).id;
      if (a.groupId !== target) { a.groupId = target; assigned++; }
    }

    // Drop groups nothing points at any more.
    const used = new Set(state.accounts.map((a) => a.groupId).filter(Boolean));
    const before = state.accountGroups.length;
    state.accountGroups = state.accountGroups.filter((g) => used.has(g.id));

    this.#store.flush();
    return {
      groups:   byCurrency.size,
      accounts: assigned,
      removed:  before - state.accountGroups.length,
    };
  }
}
