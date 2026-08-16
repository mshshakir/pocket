/**
 * SpaceComposerSheet — build a space and put people in it.
 *
 * The account-first and member-first sheets both answer a narrow question:
 * "who can see this account?" and "what can this person see?". Neither lets you
 * say "here is the household — these accounts, this budget, these three
 * people", which is how anyone actually thinks about shared money.
 *
 * Composition writes through OwnerSpaceService, which re-derives the
 * member-first `permissions` arrays that `#pushFamilyShares` and
 * `#authoriseContribution` read. Nothing downstream learns spaces exist.
 *
 * One limit is surfaced rather than hidden: `family_shares` is keyed
 * `(owner_id, member_email)`, so a person can be in only ONE of your spaces.
 * Adding them to a second is refused with the reason, not silently ignored.
 */
import { Store }              from '../../core/Store.js';
import { OverlaySheet }       from './OverlaySheet.js';
import { FamilyShareService } from '../../domain/services/FamilyShareService.js';

export class SpaceComposerSheet extends OverlaySheet {
  /** @type {Store} */ #store;
  /** @type {object} */ #spaces;
  /** @type {object} */ #sync;

  #spaceId = null;
  #error   = '';
  #tab     = 'accounts';   // 'accounts' | 'budgets' | 'people'

  /**
   * @param {object} deps
   * @param {Store}  [deps.store]
   * @param {object} deps.ownerSpaceService
   * @param {object} deps.syncService
   */
  constructor({ store, ownerSpaceService, syncService }) {
    super({ id: 'spaceComposerRoot' });
    this.#store  = store || Store.getInstance();
    this.#spaces = ownerSpaceService;
    this.#sync   = syncService;
  }

  /** @param {string} spaceId */
  open(spaceId) {
    this.#spaceId = spaceId;
    this.#error   = '';
    this.#tab     = 'accounts';
    this.render();
    this.show();
  }

  /** @param {string} tab */
  setTab(tab) { this.#tab = tab; this.#error = ''; this.render(); }

  // ── Mutations ────────────────────────────────────────────────────────

  toggleAccount(accountId, on) {
    this.#apply(this.#spaces.setAccount(this.#spaceId, accountId, on));
  }

  toggleBudget(budgetId, on) {
    this.#apply(this.#spaces.setBudget(this.#spaceId, budgetId, on));
  }

  addMember(memberId) {
    this.#apply(this.#spaces.addMember(this.#spaceId, memberId, 'view', 'view'));
  }

  removeMember(memberId) {
    this.#apply(this.#spaces.removeMember(this.#spaceId, memberId));
  }

  setMemberAccess(memberId, access) {
    const row = (this.#spaces.find(this.#spaceId)?.members || [])
      .find((m) => m.memberId === memberId);
    this.#apply(this.#spaces.addMember(this.#spaceId, memberId, access, row?.budgetAccess || 'view'));
  }

  setMemberBudgetAccess(memberId, budgetAccess) {
    const row = (this.#spaces.find(this.#spaceId)?.members || [])
      .find((m) => m.memberId === memberId);
    this.#apply(this.#spaces.addMember(this.#spaceId, memberId, row?.access || 'view', budgetAccess));
  }

  renameSpace() {
    const space = this.#spaces.find(this.#spaceId);
    const next = prompt('Name this space', space?.name || '');
    if (next === null) return;
    this.#apply(this.#spaces.rename(this.#spaceId, next));
  }

  deleteSpace() {
    const space = this.#spaces.find(this.#spaceId);
    if (!confirm(`Delete "${space?.name || 'this space'}"? Everyone in it loses access to everything it holds.`)) return;
    const res = this.#spaces.remove(this.#spaceId);
    this.#revokeOrphans(res.orphaned);
    this.close();
    window.__app?.refreshAfterSpaceChange?.();
  }

  /**
   * @param {{ok:boolean, reason?:string, orphaned?:object[]}} res
   */
  #apply(res) {
    if (!res?.ok) { this.#error = res?.reason || 'That did not work'; this.render(); return; }
    this.#error = '';
    this.#revokeOrphans(res.orphaned);
    this.render();
    window.__app?.refreshAfterSpaceChange?.();
  }

  /**
   * A member left with nothing keeps serving the snapshot their device already
   * holds unless the cloud row is dropped too.
   * @param {object[]} [orphaned]
   */
  #revokeOrphans(orphaned) {
    for (const m of (orphaned || [])) {
      if (m.email) this.#sync?.revokeMemberShare?.(m.email);
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────

  renderContent() {
    const space = this.#spaces.find(this.#spaceId);
    if (!space) return this.#missing();
    const state = this.#store.getState();

    const tab = (id, label, n) => `
      <button type="button" class="btn ${this.#tab === id ? 'btn-primary' : 'btn-outline'} justify-center flex-1"
              onclick="window.__app.spaceComposer.setTab('${id}')">
        ${this.esc(label)}${n ? ` · ${n}` : ''}
      </button>`;

    return `
      <div class="sheet-head">
        <div class="flex items-center gap-2">
          <span class="sheet-dot" style="background:#8b5cf6"></span>
          <div class="flex-1 min-w-0">
            <div class="text-base font-semibold truncate">${this.esc(space.name)}</div>
            <div class="sheet-note">What the people in this space can see</div>
          </div>
          <button type="button" class="btn btn-ghost px-2" title="Rename"
                  onclick="window.__app.spaceComposer.renameSpace()">
            <i data-lucide="pencil" style="width:14px;height:14px"></i>
          </button>
          <button type="button" class="btn btn-ghost px-2" aria-label="Close"
                  onclick="window.__app.spaceComposer.close()">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div class="flex gap-2 mt-2">
          ${tab('accounts', 'Accounts', (space.accountIds || []).length)}
          ${tab('budgets',  'Budgets',  (space.budgetIds  || []).length)}
          ${tab('people',   'People',   (space.members    || []).length)}
        </div>
      </div>
      <div class="sheet-body">
        ${this.#error ? `<div class="sheet-note text-rose-500 px-2 pb-1">${this.esc(this.#error)}</div>` : ''}
        ${this.#tab === 'accounts' ? this.#accountsTab(space, state)
          : this.#tab === 'budgets' ? this.#budgetsTab(space, state)
          : this.#peopleTab(space, state)}
      </div>
      <div class="sheet-foot">
        <button type="button" class="btn btn-ghost text-rose-500"
                onclick="window.__app.spaceComposer.deleteSpace()">Delete space</button>
        <div class="flex-1"></div>
        <button type="button" class="btn btn-primary"
                onclick="window.__app.spaceComposer.close()">Done</button>
      </div>`;
  }

  #accountsTab(space, state) {
    const inSpace = new Set(space.accountIds || []);
    const rows = (state.accounts || []).filter((a) => !a.archived).map((a) => `
      <button type="button" class="sheet-row ${inSpace.has(a.id) ? 'is-selected' : ''}"
              onclick="window.__app.spaceComposer.toggleAccount('${this.js(a.id)}',${!inSpace.has(a.id)})">
        <span class="sheet-dot" style="background:${this.safeColor(a.color, '#71717a')}"></span>
        <span class="sheet-row-name">${this.esc(a.name)}
          <span class="sheet-row-meta"> · ${this.esc(a.currency)}</span>
        </span>
        ${inSpace.has(a.id) ? '<i data-lucide="check" style="width:15px;height:15px" class="text-emerald-500"></i>' : ''}
      </button>`).join('');
    return rows || '<div class="sheet-empty">No accounts yet.</div>';
  }

  #budgetsTab(space, state) {
    const inSpace = new Set(space.budgetIds || []);
    const rows = (state.budgets || []).map((b) => `
      <button type="button" class="sheet-row ${inSpace.has(b.id) ? 'is-selected' : ''}"
              onclick="window.__app.spaceComposer.toggleBudget('${this.js(b.id)}',${!inSpace.has(b.id)})">
        <span class="sheet-dot" style="background:#8b5cf6"></span>
        <span class="sheet-row-name">${this.esc(this.#budgetLabel(b, state))}
          <span class="sheet-row-meta"> · ${this.esc(b.currency)}</span>
        </span>
        ${inSpace.has(b.id) ? '<i data-lucide="check" style="width:15px;height:15px" class="text-emerald-500"></i>' : ''}
      </button>`).join('');
    return (rows || '<div class="sheet-empty">No budgets yet.</div>')
      + `<div class="sheet-note px-2 pt-2">
           Sharing a budget also shows how much of it is spent, counted across
           <strong>all</strong> your accounts — not only the ones in this space.
         </div>`;
  }

  #peopleTab(space, state) {
    const inSpace = new Map((space.members || []).map((m) => [m.memberId, m]));
    const family  = state.family || [];

    const memberRows = family.map((m) => {
      const row = inSpace.get(m.id);
      const elsewhere = !row && this.#spaces.spaceForMember(m.id);
      if (!row) {
        return `
          <button type="button" class="sheet-row" ${elsewhere ? 'disabled style="opacity:.5"' : ''}
                  onclick="window.__app.spaceComposer.addMember('${this.js(m.id)}')">
            <span class="sheet-dot" style="background:${this.safeColor(m.color, '#a1a1aa')}"></span>
            <span class="sheet-row-name">${this.esc(m.name || m.email || 'Member')}
              <span class="sheet-row-meta"> · ${elsewhere ? `already in ${this.esc(elsewhere.name)}` : 'tap to add'}</span>
            </span>
          </button>`;
      }
      const level = (name, id, current, setter) => `
        <button type="button" class="btn ${current === id ? 'btn-primary' : 'btn-outline'} text-xs"
                onclick="window.__app.spaceComposer.${setter}('${this.js(m.id)}','${id}')">${this.esc(name)}</button>`;

      return `
        <div class="p-2 rounded-xl" style="background:#8b5cf60d">
          <div class="flex items-center gap-2">
            <span class="sheet-dot" style="background:${this.safeColor(m.color, '#a1a1aa')}"></span>
            <span class="flex-1 text-sm font-medium truncate">${this.esc(m.name || m.email || 'Member')}</span>
            <button type="button" class="btn btn-ghost text-rose-500 text-xs"
                    onclick="window.__app.spaceComposer.removeMember('${this.js(m.id)}')">Remove</button>
          </div>
          <div class="text-xs text-zinc-500 mt-1">Transactions</div>
          <div class="flex gap-1 flex-wrap mt-1">
            ${FamilyShareService.levels.map((l) =>
              level(l.label, l.id, row.access, 'setMemberAccess')).join('')}
          </div>
          ${(space.budgetIds || []).length ? `
            <div class="text-xs text-zinc-500 mt-2">Budgets</div>
            <div class="flex gap-1 flex-wrap mt-1">
              ${FamilyShareService.budgetLevels.map((l) =>
                level(l.label, l.id, row.budgetAccess || 'view', 'setMemberBudgetAccess')).join('')}
            </div>` : ''}
        </div>`;
    }).join('');

    return (family.length ? memberRows : '<div class="sheet-empty">No family members yet.</div>')
      + `<div class="sheet-note px-2 pt-2">
           Someone can be in only one space for now — a second would overwrite the first.
         </div>`;
  }

  #budgetLabel(b, state) {
    if (b.name) return b.name;
    const ids = Array.isArray(b.categoryIds) && b.categoryIds.length
      ? b.categoryIds : (b.categoryId ? [b.categoryId] : []);
    const names = ids.map((id) => (state.categories || []).find((c) => c.id === id)?.name).filter(Boolean);
    if (!names.length) return 'Budget';
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  }

  #missing() {
    return `
      <div class="sheet-head">
        <div class="flex items-center gap-2">
          <div class="flex-1 text-base font-semibold">Space</div>
          <button type="button" class="btn btn-ghost px-2" aria-label="Close"
                  onclick="window.__app.spaceComposer.close()"><i data-lucide="x"></i></button>
        </div>
      </div>
      <div class="sheet-body"><div class="sheet-empty">That space no longer exists.</div></div>`;
  }
}
