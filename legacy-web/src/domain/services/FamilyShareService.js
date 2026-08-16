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
import { FAMILY_ACCESS_LEVELS, FAMILY_BUDGET_ACCESS_LEVELS } from '../../data/constants.js';

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

  /** @returns {object[]} budget level descriptors — a shorter, different ladder */
  static get budgetLevels() { return FAMILY_BUDGET_ACCESS_LEVELS; }

  // ── Budget grants ───────────────────────────────────────────────────
  //
  // Budgets are shared ONE AT A TIME, like accounts, because a budget has no
  // accountId to inherit from: its shape is { categoryId | categoryIds[],
  // amount, currency, period, rollover }. That left only "all of the owner's
  // budgets" or "none", and neither is right.
  //
  // They live in their own `budgetPermissions` array rather than being folded
  // into `permissions`. The design doc originally proposed generalising the
  // entry to { kind, id, access }; on implementation that turned out to be the
  // worse trade. `permissions` is read by #authoriseContribution — the owner's
  // ONLY server-side enforcement point (audit H9) — and reshaping it to add a
  // read-only feature puts a permission bug on the security boundary for no
  // functional gain. A separate array leaves that path untouched.

  /**
   * @param {string} memberId
   * @param {string} budgetId
   * @returns {string|null} 'view'|'edit'|'full', or null for no access
   */
  budgetAccessFor(memberId, budgetId) {
    const member = this.members().find((m) => m.id === memberId);
    return (member?.budgetPermissions || []).find((p) => p.budgetId === budgetId)?.access || null;
  }

  /**
   * @param {string} budgetId
   * @returns {Array<{member:object, access:string}>}
   */
  budgetSharedWith(budgetId) {
    return this.members()
      .map((member) => ({ member, access: this.budgetAccessFor(member.id, budgetId) }))
      .filter((row) => !!row.access);
  }

  /** @returns {Set<string>} budget ids shared with at least one member */
  sharedBudgetIds() {
    const out = new Set();
    for (const m of this.members()) {
      for (const p of (m.budgetPermissions || [])) if (p.access) out.add(p.budgetId);
    }
    return out;
  }

  /**
   * True when this member has nothing shared with them at all — no accounts
   * AND no budgets. Only then is their cloud share row a lie that should be
   * revoked; a budget-only member still needs a space to stand in.
   * @param {object} member
   * @returns {boolean}
   */
  static hasNothingShared(member) {
    return !(member?.permissions || []).length && !(member?.budgetPermissions || []).length;
  }

  /**
   * Grant, change or revoke a member's access to one budget.
   * @param {string} memberId
   * @param {string} budgetId
   * @param {string|null} access  null revokes
   * @returns {{ok:true, access:string|null, member:object, wasLast:boolean}|{ok:false, reason:string}}
   */
  setBudgetAccess(memberId, budgetId, access) {
    const member = this.members().find((m) => m.id === memberId);
    if (!member) return { ok: false, reason: 'That member no longer exists' };
    const levels = new Set(FAMILY_BUDGET_ACCESS_LEVELS.map((l) => l.id));
    if (access !== null && !levels.has(access)) {
      return { ok: false, reason: `Unknown access level "${access}"` };
    }
    if (!this.#store.getState().budgets?.some((b) => b.id === budgetId)) {
      return { ok: false, reason: 'That budget no longer exists' };
    }

    if (!Array.isArray(member.budgetPermissions)) member.budgetPermissions = [];
    const idx = member.budgetPermissions.findIndex((p) => p.budgetId === budgetId);

    if (access === null) {
      if (idx >= 0) member.budgetPermissions.splice(idx, 1);
    } else if (idx >= 0) {
      member.budgetPermissions[idx].access = access;
    } else {
      member.budgetPermissions.push({ budgetId, access });
    }

    const wasLast = access === null && FamilyShareService.hasNothingShared(member);
    this.#store.flush();
    return { ok: true, access, member, wasLast };
  }

  /**
   * Stop sharing a budget with everyone — used when it is deleted.
   * @param {string} budgetId
   * @returns {Array<{member:object, wasLast:boolean}>}
   */
  unshareBudget(budgetId) {
    const affected = [];
    for (const member of this.members()) {
      if (!(member.budgetPermissions || []).some((p) => p.budgetId === budgetId)) continue;
      member.budgetPermissions = member.budgetPermissions.filter((p) => p.budgetId !== budgetId);
      affected.push({ member, wasLast: FamilyShareService.hasNothingShared(member) });
    }
    if (affected.length) this.#store.flush();
    return affected;
  }

  /**
   * Name the space this member sees.
   *
   * Stored on the member because there is exactly one space per (owner,
   * member) pair today — the family_shares primary key. Multiple named spaces
   * per owner is a larger change; see docs/OWNER-SPACES-DESIGN.md.
   * @param {string} memberId
   * @param {string} name  '' clears it, falling back to the owner's own name
   * @returns {{ok:boolean, reason?:string}}
   */
  setSpaceName(memberId, name) {
    const member = this.members().find((m) => m.id === memberId);
    if (!member) return { ok: false, reason: 'That member no longer exists' };
    const trimmed = (name || '').trim().slice(0, 60);
    if (trimmed) member.spaceName = trimmed;
    else delete member.spaceName;
    this.#store.flush();
    return { ok: true };
  }

  /**
   * What this member sees the space called.
   * @param {object} member
   * @returns {string}
   */
  spaceNameFor(member) {
    return member?.spaceName || this.#store.getState().user?.name || 'My money';
  }

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

    // "Last" means nothing is shared with them AT ALL — a member who still
    // holds a budget grant keeps their space, and revoking their cloud row
    // would strand it.
    const wasLast = access === null && FamilyShareService.hasNothingShared(member);
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
      affected.push({ member, wasLast: FamilyShareService.hasNothingShared(member) });
    }
    if (affected.length) this.#store.flush();
    return affected;
  }
}
