/**
 * OwnerSpaceService — the spaces YOU share, as objects you compose.
 *
 * Sharing used to be member-first: open a person, tick the accounts they may
 * see. That answers "who have I added?" but never "what does Zahra see?", and
 * it makes every change N×M — add an account to the household and you edit
 * three member records, hoping you missed none.
 *
 * A space inverts it. You compose the thing once and put people in it:
 *
 *   state.spaces = [{
 *     id, name, accountIds: [...], budgetIds: [...],
 *     members: [{ memberId, access, budgetAccess }],
 *   }]
 *
 * ── Why permissions are DERIVED rather than replaced ──────────────────────
 *
 * `state.family[].permissions` is read by `#authoriseContribution` — the
 * owner's ONLY server-side check on what a member submits (audit H9). Every
 * other permission read is render-time, which a stale or hostile client never
 * runs. Reshaping that array to add a composition feature would put a
 * permission bug on the security boundary for no functional gain.
 *
 * So spaces own the *grouping*, and `#derive()` rewrites `permissions`,
 * `budgetPermissions` and `spaceName` from them after every change.
 * `#pushFamilyShares` and `#authoriseContribution` keep reading exactly what
 * they read before and never learn spaces exist.
 *
 * ── The one thing this cannot do yet ──────────────────────────────────────
 *
 * `family_shares` is keyed `(owner_id, member_email)`. Several people in ONE
 * space is fine — that is one row each. The SAME person in TWO of your spaces
 * is not: both writes target the same row and collapse. `addMember()` refuses
 * it explicitly rather than letting the second silently win. Lifting that needs
 * `space_id` in the primary key — see docs/OWNER-SPACES-DESIGN.md.
 */
import { Store }        from '../../core/Store.js';
import { IdGenerator }  from './IdGenerator.js';
import { FAMILY_ACCESS_LEVELS, FAMILY_BUDGET_ACCESS_LEVELS } from '../../data/constants.js';

const ACCOUNT_LEVELS = new Set(FAMILY_ACCESS_LEVELS.map((l) => l.id));
const BUDGET_LEVELS  = new Set(FAMILY_BUDGET_ACCESS_LEVELS.map((l) => l.id));

export class OwnerSpaceService {
  /** @type {Store} */ #store;

  /** @param {Store} [store] */
  constructor(store) {
    this.#store = store || Store.getInstance();
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /** @returns {object[]} every space you share, lazily initialised */
  spaces() {
    const state = this.#store.getState();
    if (!Array.isArray(state.spaces)) state.spaces = [];
    return state.spaces;
  }

  /** @param {string} spaceId @returns {object|undefined} */
  find(spaceId) {
    return this.spaces().find((s) => s.id === spaceId);
  }

  /**
   * The space a member belongs to, if any. At most one until the key change.
   * @param {string} memberId
   * @returns {object|null}
   */
  spaceForMember(memberId) {
    return this.spaces().find((s) => (s.members || []).some((m) => m.memberId === memberId)) || null;
  }

  /** @param {string} spaceId @returns {object[]} the member records in it */
  membersOf(spaceId) {
    const space = this.find(spaceId);
    if (!space) return [];
    const family = this.#store.getState().family || [];
    return (space.members || [])
      .map((m) => ({ ...m, member: family.find((f) => f.id === m.memberId) }))
      .filter((m) => m.member);
  }

  // ── Composition ─────────────────────────────────────────────────────

  /**
   * @param {string} name
   * @returns {{ok:true, space:object}|{ok:false, reason:string}}
   */
  create(name) {
    const trimmed = (name || '').trim().slice(0, 60);
    if (!trimmed) return { ok: false, reason: 'Give the space a name' };
    const space = {
      id: IdGenerator.generate('sp'),
      name: trimmed,
      accountIds: [],
      budgetIds:  [],
      members:    [],
    };
    this.spaces().push(space);
    this.#commit();
    return { ok: true, space };
  }

  /** @param {string} spaceId @param {string} name */
  rename(spaceId, name) {
    const space = this.find(spaceId);
    if (!space) return { ok: false, reason: 'That space no longer exists' };
    const trimmed = (name || '').trim().slice(0, 60);
    if (!trimmed) return { ok: false, reason: 'Give the space a name' };
    space.name = trimmed;
    this.#commit();
    return { ok: true };
  }

  /**
   * Delete a space. Everyone in it loses everything it held — the caller is
   * expected to follow up with `revokeMemberShare` for any member left with
   * nothing at all, or their device keeps serving the snapshot it already has.
   * @param {string} spaceId
   * @returns {{ok:true, orphaned:object[]}}
   */
  remove(spaceId) {
    const state = this.#store.getState();
    state.spaces = this.spaces().filter((s) => s.id !== spaceId);
    const orphaned = this.#commit();
    return { ok: true, orphaned };
  }

  /**
   * Put an account in a space, or take it out.
   * @param {string} spaceId @param {string} accountId @param {boolean} inSpace
   */
  setAccount(spaceId, accountId, inSpace) {
    const space = this.find(spaceId);
    if (!space) return { ok: false, reason: 'That space no longer exists' };

    if (inSpace) {
      const clash = this.#overlapConflict(space, 'accountIds', accountId);
      if (clash) return clash;
    }
    if (!Array.isArray(space.accountIds)) space.accountIds = [];
    const has = space.accountIds.includes(accountId);
    if (inSpace && !has) space.accountIds.push(accountId);
    if (!inSpace && has) space.accountIds = space.accountIds.filter((id) => id !== accountId);
    const orphaned = this.#commit();
    return { ok: true, orphaned };
  }

  /** @param {string} spaceId @param {string} budgetId @param {boolean} inSpace */
  setBudget(spaceId, budgetId, inSpace) {
    const space = this.find(spaceId);
    if (!space) return { ok: false, reason: 'That space no longer exists' };
    if (inSpace) {
      const clash = this.#overlapConflict(space, 'budgetIds', budgetId);
      if (clash) return clash;
    }
    if (!Array.isArray(space.budgetIds)) space.budgetIds = [];
    const has = space.budgetIds.includes(budgetId);
    if (inSpace && !has) space.budgetIds.push(budgetId);
    if (!inSpace && has) space.budgetIds = space.budgetIds.filter((id) => id !== budgetId);
    const orphaned = this.#commit();
    return { ok: true, orphaned };
  }

  // ── Membership ──────────────────────────────────────────────────────

  /**
   * Add someone to a space.
   *
   * @param {string} spaceId
   * @param {string} memberId
   * @param {string} [access='view']
   * @param {string} [budgetAccess='view']
   * @returns {{ok:true}|{ok:false, reason:string}}
   */
  addMember(spaceId, memberId, access = 'view', budgetAccess = 'view') {
    const space = this.find(spaceId);
    if (!space) return { ok: false, reason: 'That space no longer exists' };
    const member = (this.#store.getState().family || []).find((m) => m.id === memberId);
    if (!member) return { ok: false, reason: 'That member no longer exists' };
    if (!member.email) {
      return { ok: false, reason: `Add an email to ${member.name || 'them'} first — a share is delivered by email` };
    }
    if (!ACCOUNT_LEVELS.has(access))      return { ok: false, reason: `Unknown access level "${access}"` };
    if (!BUDGET_LEVELS.has(budgetAccess)) return { ok: false, reason: `Unknown budget level "${budgetAccess}"` };

    // One person, one space — see the class comment. Refusing loudly beats
    // letting the second push silently overwrite the first.
    const existing = this.spaceForMember(memberId);
    if (existing && existing.id !== spaceId) {
      return {
        ok: false,
        reason: `${member.name || 'They'} are already in "${existing.name}". Someone can only be in one space for now.`,
      };
    }

    // Adding a person can create the same overlap from the other direction:
    // they may already be in a space holding one of these items.
    for (const field of ['accountIds', 'budgetIds']) {
      for (const itemId of (space[field] || [])) {
        const probe = { id: space.id, name: space.name, members: [{ memberId }] };
        const clash = this.#overlapConflict(probe, field, itemId);
        if (clash) return clash;
      }
    }

    if (!Array.isArray(space.members)) space.members = [];
    const row = space.members.find((m) => m.memberId === memberId);
    if (row) { row.access = access; row.budgetAccess = budgetAccess; }
    else space.members.push({ memberId, access, budgetAccess });
    this.#commit();
    return { ok: true };
  }

  /**
   * @param {string} spaceId @param {string} memberId
   * @returns {{ok:true, orphaned:object[]}}
   */
  removeMember(spaceId, memberId) {
    const space = this.find(spaceId);
    if (!space) return { ok: false, reason: 'That space no longer exists' };
    space.members = (space.members || []).filter((m) => m.memberId !== memberId);
    const orphaned = this.#commit();
    return { ok: true, orphaned };
  }

  /**
   * Would putting `itemId` in `space` give one PERSON the same item twice?
   *
   * The ambiguity to prevent is per-member, not global. `#commit()` writes
   * `permissions` as the union across a member's spaces, so if ONE member is in
   * two spaces that both hold account A — at 'edit' in one and 'view' in the
   * other — the map keeps whichever loop iteration ran last.
   * `#authoriseContribution` reads that map, so it is a silent permission bug.
   *
   * An earlier version of this check forbade an item from being in two spaces
   * at all. That is far too strong and broke the most ordinary case there is:
   * sharing the joint account with two different people, who are in different
   * spaces. Two people holding the same account is normal; ONE person holding
   * it twice at different levels is the problem.
   *
   * @param {object} space
   * @param {'accountIds'|'budgetIds'} field
   * @param {string} itemId
   * @returns {{ok:false, reason:string}|null}
   */
  #overlapConflict(space, field, itemId) {
    const memberIds = new Set((space.members || []).map((m) => m.memberId));
    if (!memberIds.size) return null;
    for (const other of this.spaces()) {
      if (other.id === space.id) continue;
      if (!(other[field] || []).includes(itemId)) continue;
      const shared = (other.members || []).find((m) => memberIds.has(m.memberId));
      if (shared) {
        const name = (this.#store.getState().family || [])
          .find((f) => f.id === shared.memberId)?.name || 'Someone';
        const what = field === 'accountIds' ? 'account' : 'budget';
        return {
          ok: false,
          reason: `${name} is in "${other.name}", which already holds that ${what} — one person can't hold it at two levels`,
        };
      }
    }
    return null;
  }

  // ── Derivation ──────────────────────────────────────────────────────

  /**
   * Rewrite the member-first arrays from the spaces.
   *
   * This is the whole safety argument: `permissions` keeps exactly the shape
   * `#authoriseContribution` and `#pushFamilyShares` already read, so neither
   * has to change and neither can be broken by a composition bug.
   *
   * @returns {object[]} members left with nothing shared — the caller should
   *   `revokeMemberShare` each, or their device keeps a stale snapshot alive.
   */
  #commit() {
    const state  = this.#store.getState();
    const family = state.family || [];
    const before = new Map(family.map((m) => [m.id, ((m.permissions || []).length + (m.budgetPermissions || []).length) > 0]));

    for (const member of family) {
      member.permissions       = [];
      member.budgetPermissions = [];
      delete member.spaceName;
    }

    for (const space of this.spaces()) {
      for (const row of (space.members || [])) {
        const member = family.find((m) => m.id === row.memberId);
        if (!member) continue;
        // The name the member sees comes from the space they are in.
        member.spaceName = space.name;
        for (const accountId of (space.accountIds || [])) {
          member.permissions.push({ accountId, access: row.access });
        }
        for (const budgetId of (space.budgetIds || [])) {
          member.budgetPermissions.push({ budgetId, access: row.budgetAccess || 'view' });
        }
      }
    }

    const orphaned = family.filter((m) =>
      before.get(m.id) && !m.permissions.length && !m.budgetPermissions.length);

    this.#store.flush();
    return orphaned;
  }

  /**
   * Build spaces from the member-first grants that predate them.
   *
   * One space per member, which is exactly what the old model expressed — an
   * account set per person. Merging members who happen to share an identical
   * set would be tidier but guesses at intent, so it doesn't.
   *
   * Idempotent: does nothing once `state.spaces` is populated.
   * @param {object} state
   */
  static migrate(state) {
    if (!state || typeof state !== 'object') return;
    if (!Array.isArray(state.spaces)) state.spaces = [];
    if (state.spaces.length) return;

    for (const member of (state.family || [])) {
      const accountIds = [...new Set((member.permissions || []).map((p) => p.accountId).filter(Boolean))];
      const budgetIds  = [...new Set((member.budgetPermissions || []).map((p) => p.budgetId).filter(Boolean))];
      if (!accountIds.length && !budgetIds.length) continue;

      // Access varied per account in the old model; a space has one level per
      // member. Take the WEAKEST granted, so a migration can never silently
      // widen someone's access — the owner can raise it deliberately after.
      const order = ['view', 'add', 'edit', 'full'];
      const weakest = (list, key, fallback) => list
        .map((p) => p[key])
        .filter((a) => order.includes(a))
        .sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] || fallback;

      state.spaces.push({
        id: `sp_migrated_${member.id}`,
        name: member.spaceName || state.user?.name || 'Shared',
        accountIds,
        budgetIds,
        members: [{
          memberId: member.id,
          access:       weakest(member.permissions || [], 'access', 'view'),
          budgetAccess: weakest(member.budgetPermissions || [], 'access', 'view'),
        }],
      });
    }
  }
}
