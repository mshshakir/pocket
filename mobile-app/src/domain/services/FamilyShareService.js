/**
 * FamilyShareService — who can see or touch which account.
 *
 * Access is stored member-first: each `state.family[]` entry owns a
 * `permissions: [{ accountId, access }]` list. That shape is convenient when
 * editing a member, and awkward when the question is "who is this ACCOUNT
 * shared with?" — which is what the Share button on an account asks.
 *
 * This service answers both directions against the same storage, so the
 * account-first sheet and the member-first modal can never disagree.
 *
 * Access levels come from FAMILY_ACCESS_LEVELS: view < add < edit < full.
 * Absence of an entry means no access at all.
 */
import { Store }                 from '../../core/Store.js';
import { FAMILY_ACCESS_LEVELS }  from '../../data/constants.js';

/** Valid access ids, cheapest lookup for validation. */
const LEVELS = new Set(FAMILY_ACCESS_LEVELS.map((l) => l.id));

export class FamilyShareService {
  /** @type {Store} */ #store;

  constructor(store) {
    this.#store = store || Store.getInstance();
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /** @returns {object[]} every family member */
  members() {
    const state = this.#store.getState();
    if (!Array.isArray(state.family)) state.family = [];
    return state.family;
  }

  /** @returns {object[]} the level descriptors, for rendering choices */
  static get levels() { return FAMILY_ACCESS_LEVELS; }

  /**
   * The access a member currently holds on one account.
   * @param {string} memberId
   * @param {string} accountId
   * @returns {string|null} 'view'|'add'|'edit'|'full', or null for no access
   */
  accessFor(memberId, accountId) {
    const member = this.members().find((m) => m.id === memberId);
    return (member?.permissions || []).find((p) => p.accountId === accountId)?.access || null;
  }

  /**
   * Everyone this account is shared with.
   * @param {string} accountId
   * @returns {Array<{member:object, access:string}>}
   */
  sharedWith(accountId) {
    return this.members()
      .map((member) => ({ member, access: this.accessFor(member.id, accountId) }))
      .filter((row) => !!row.access);
  }

  /**
   * Account ids shared with at least one member — used to badge account cards.
   * @returns {Set<string>}
   */
  sharedAccountIds() {
    const out = new Set();
    for (const m of this.members()) {
      for (const p of (m.permissions || [])) if (p.access) out.add(p.accountId);
    }
    return out;
  }

  // ── Mutations ───────────────────────────────────────────────────────

  /**
   * Grant, change or revoke a member's access to one account.
   *
   * Passing `null` revokes. Revoking the member's LAST account is a full
   * revocation as far as the cloud is concerned — the caller is expected to
   * follow up with SyncService.revokeMemberShare() so the stale snapshot on the
   * member's device is dropped rather than left serving old data.
   *
   * @param {string}      memberId
   * @param {string}      accountId
   * @param {string|null} access
   * @returns {{ok:true, access:string|null, member:object, wasLast:boolean}|{ok:false, reason:string}}
   */
  setAccess(memberId, accountId, access) {
    const member = this.members().find((m) => m.id === memberId);
    if (!member)                       return { ok: false, reason: 'That member no longer exists' };
    if (access !== null && !LEVELS.has(access)) return { ok: false, reason: `Unknown access level "${access}"` };
    if (!this.#store.getState().accounts.some((a) => a.id === accountId)) {
      return { ok: false, reason: 'That account no longer exists' };
    }

    if (!Array.isArray(member.permissions)) member.permissions = [];
    const idx = member.permissions.findIndex((p) => p.accountId === accountId);

    if (access === null) {
      if (idx >= 0) member.permissions.splice(idx, 1);
    } else if (idx >= 0) {
      member.permissions[idx].access = access;
    } else {
      member.permissions.push({ accountId, access });
    }

    const wasLast = access === null && member.permissions.length === 0;
    this.#store.flush();
    return { ok: true, access, member, wasLast };
  }

  /**
   * Stop sharing an account with everyone.
   * @param {string} accountId
   * @returns {Array<{member:object, wasLast:boolean}>} members that were affected
   */
  unshareAccount(accountId) {
    const affected = [];
    for (const member of this.members()) {
      if (!(member.permissions || []).some((p) => p.accountId === accountId)) continue;
      member.permissions = member.permissions.filter((p) => p.accountId !== accountId);
      affected.push({ member, wasLast: member.permissions.length === 0 });
    }
    if (affected.length) this.#store.flush();
    return affected;
  }
}
