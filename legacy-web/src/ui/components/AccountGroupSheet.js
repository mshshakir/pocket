/**
 * AccountGroupSheet — manage account groups in one place.
 *
 *   Groups                                    ✕
 *   ─────────────────────────────────────────────
 *   ● Everyday            3 accounts    ✎  🗑  ›
 *   ● Savings             2 accounts    ✎  🗑  ›
 *   ＋ New group
 *   ⇄ Group by currency
 *
 * Tapping a group opens its member list, where accounts are ticked on and off
 * in bulk — previously the only way to move an account was to open the account
 * form and change one dropdown at a time.
 *
 * Extends OverlaySheet so it stacks above whatever is open and leaves the page
 * underneath intact.
 */
import { OverlaySheet } from './OverlaySheet.js';
import { Store }        from '../../core/Store.js';

export class AccountGroupSheet extends OverlaySheet {
  /** @type {Store} */ #store;
  /** @type {import('../../domain/services/AccountGroupService.js').AccountGroupService} */
  #groups;
  /** @type {import('../../domain/services/CurrencyService.js').CurrencyService} */
  #fx;

  // ── Per-open session state ────────────────────────────────────────────
  #groupId  = null;   // null → group list; otherwise the open group's members
  #editing  = null;   // group id being renamed
  #adding   = false;
  #error    = '';
  #onClose  = null;
  /** Working member selection while a group's tick-list is open. */
  #picked   = /** @type {Set<string>} */ (new Set());

  /**
   * @param {object} deps
   * @param {Store}  [deps.store]
   * @param {object} deps.accountGroupService
   * @param {object} deps.currencyService
   */
  constructor({ store, accountGroupService, currencyService }) {
    super({ id: 'accountGroupSheetRoot' });
    this.#store  = store || Store.getInstance();
    this.#groups = accountGroupService;
    this.#fx     = currencyService;
  }

  // ── Public API ────────────────────────────────────────────────────────

  /** @param {object} [cfg] @param {() => void} [cfg.onClose] */
  open({ onClose } = {}) {
    this.#groupId = null;
    this.#editing = null;
    this.#adding  = false;
    this.#error   = '';
    this.#picked  = new Set();
    this.#onClose = typeof onClose === 'function' ? onClose : null;
    this.show();
  }

  /** @override */
  onClosed() {
    const cb = this.#onClose;
    this.#onClose = null;
    cb?.();
  }

  // ── Navigation ────────────────────────────────────────────────────────

  /** Open a group's member tick-list. @param {string} id */
  openGroup(id) {
    this.#groupId = id;
    this.#editing = null;
    this.#adding  = false;
    this.#error   = '';
    this.#picked  = new Set(this.#groups.accountsIn(id).map((a) => a.id));
    this.render();
  }

  /** Back to the group list. */
  back() {
    this.#groupId = null;
    this.#editing = null;
    this.#adding  = false;
    this.#error   = '';
    this.render();
  }

  // ── Group CRUD ────────────────────────────────────────────────────────

  /** @param {string} id */
  edit(id) {
    this.#editing = id;
    this.#adding  = false;
    this.#error   = '';
    this.render();
    this.focusLater('[data-grp-input]');
  }

  startAdd() {
    this.#adding  = true;
    this.#editing = null;
    this.#error   = '';
    this.render();
    this.focusLater('[data-grp-input]');
  }

  cancel() {
    this.#editing = null;
    this.#adding  = false;
    this.#error   = '';
    this.render();
  }

  /** Commit the rename or the new group. */
  submit() {
    const value = this.find('[data-grp-input]')?.value || '';

    if (this.#editing) {
      const res = this.#groups.rename(this.#editing, value);
      if (!res.ok) { this.#error = res.reason; this.render(); this.focusLater('[data-grp-input]'); return; }
      this.#editing = null;
      this.#error   = '';
      this.render();
      return;
    }

    const res = this.#groups.create(value);
    if (!res.ok) { this.#error = res.reason; this.render(); this.focusLater('[data-grp-input]'); return; }
    this.#adding = false;
    this.#error  = '';
    // Drop straight into the new group so the obvious next step — choosing
    // which accounts belong to it — is one tap away.
    this.openGroup(res.group.id);
  }

  /** @param {string} id */
  remove(id) {
    const res = this.#groups.delete(id);
    this.#error = res.ok ? '' : res.reason;
    if (res.ok && this.#groupId === id) this.#groupId = null;
    this.render();
  }

  /** @param {KeyboardEvent} e */
  onKey(e) {
    if (e.key === 'Enter')  { e.preventDefault(); this.submit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancel(); }
  }

  // ── Bulk membership ───────────────────────────────────────────────────

  /** Tick / untick an account in the open group. @param {string} accountId */
  toggleAccount(accountId) {
    if (this.#picked.has(accountId)) this.#picked.delete(accountId);
    else                             this.#picked.add(accountId);
    this.render();
  }

  /** Tick every account currently listed. */
  pickAll() {
    for (const a of this.#store.getState().accounts) this.#picked.add(a.id);
    this.render();
  }

  /** Untick everything. */
  pickNone() {
    this.#picked.clear();
    this.render();
  }

  /** Apply the tick-list to the open group. */
  applyMembers() {
    if (!this.#groupId) return;
    const moved = this.#groups.setMembers(this.#groupId, [...this.#picked]);
    this.#error = '';
    this.back();
    if (moved) this.#toast(`${moved} account${moved === 1 ? '' : 's'} updated`);
  }

  // ── Group by currency ─────────────────────────────────────────────────

  /**
   * Replace the whole arrangement with one group per currency. Destructive to
   * any hand-made grouping, so it confirms first.
   */
  groupByCurrency() {
    const accounts = this.#store.getState().accounts || [];
    const distinct = new Set(accounts.map((a) => (a.currency || '').toUpperCase()).filter(Boolean));
    if (!distinct.size) { this.#error = 'No accounts to group'; this.render(); return; }

    const ok = window.confirm(
      `Regroup all ${accounts.length} account${accounts.length === 1 ? '' : 's'} into ` +
      `${distinct.size} currency group${distinct.size === 1 ? '' : 's'}?\n\n` +
      'This replaces your current grouping.',
    );
    if (!ok) return;

    const res = this.#groups.groupByCurrency();
    this.#error = '';
    this.render();
    this.#toast(`Grouped into ${res.groups} currenc${res.groups === 1 ? 'y' : 'ies'}`);
  }

  #toast(message) {
    window.__app?.showToast?.(message);
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  /** @override */
  renderContent() {
    return this.#groupId ? this.#membersView() : this.#listView();
  }

  #listView() {
    const groups    = this.#groups.all();
    const ungrouped = this.#groups.ungrouped();

    const rows = groups.map((g) => {
      if (this.#editing === g.id) return this.#inputRow(g.name);
      const n = this.#groups.accountsIn(g.id).length;
      return `
        <div class="sheet-row sheet-row-static">
          <span class="sheet-dot" style="background:${this.safeColor(g.color)}"></span>
          <button type="button" class="sheet-row-name text-left"
                  style="background:none;border:none;color:inherit;font:inherit;cursor:pointer"
                  onclick="window.__app.accountGroupSheet.openGroup('${this.js(g.id)}')">
            ${this.esc(g.name)}
          </button>
          <span class="sheet-row-meta">${n} account${n === 1 ? '' : 's'}</span>
          <button type="button" class="btn btn-ghost px-2" title="Rename"
                  onclick="window.__app.accountGroupSheet.edit('${this.js(g.id)}')">
            <i data-lucide="pencil" style="width:14px;height:14px"></i>
          </button>
          <button type="button" class="btn btn-ghost px-2 text-rose-500" title="Delete"
                  onclick="window.__app.accountGroupSheet.remove('${this.js(g.id)}')">
            <i data-lucide="trash-2" style="width:14px;height:14px"></i>
          </button>
          <i data-lucide="chevron-right" class="text-zinc-400" style="width:15px;height:15px"></i>
        </div>`;
    }).join('');

    const empty = groups.length ? '' :
      `<div class="sheet-empty">No groups yet — create one, or group by currency.</div>`;

    return `
      <div class="sheet-head">
        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <div class="text-base font-semibold">Account groups</div>
            <div class="sheet-note">Tap a group to choose which accounts belong to it</div>
          </div>
          <button type="button" class="btn btn-ghost px-2" aria-label="Close"
                  onclick="window.__app.accountGroupSheet.close()">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
      <div class="sheet-body">
        ${this.#error ? `<div class="sheet-note text-rose-500 px-2 pb-1">${this.esc(this.#error)}</div>` : ''}
        ${rows}${empty}
        ${this.#adding ? this.#inputRow('') : `
          <button type="button" class="sheet-row text-zinc-500 mt-1"
                  onclick="window.__app.accountGroupSheet.startAdd()">
            <i data-lucide="plus" style="width:15px;height:15px"></i>
            <span class="sheet-row-name">New group</span>
          </button>`}
        <button type="button" class="sheet-row text-zinc-500"
                onclick="window.__app.accountGroupSheet.groupByCurrency()">
          <i data-lucide="coins" style="width:15px;height:15px"></i>
          <span class="sheet-row-name">Group by currency</span>
          <span class="sheet-row-meta">replaces current grouping</span>
        </button>
        ${ungrouped.length ? `
          <div class="sheet-crumb px-1 mt-3">Ungrouped · ${ungrouped.length}</div>
          ${ungrouped.map((a) => `
            <div class="sheet-row sheet-row-static">
              <span class="sheet-dot" style="background:${this.safeColor(a.color, '#a1a1aa')}"></span>
              <span class="sheet-row-name">${this.esc(a.name)}</span>
              <span class="sheet-row-meta">${this.esc(a.currency)}</span>
            </div>`).join('')}` : ''}
      </div>
      <div class="sheet-foot">
        <div class="sheet-note">Deleting a group never deletes its accounts</div>
        <div class="flex-1"></div>
        <button type="button" class="btn btn-primary"
                onclick="window.__app.accountGroupSheet.close()">Done</button>
      </div>`;
  }

  #membersView() {
    const group    = this.#groups.find(this.#groupId);
    if (!group) { this.#groupId = null; return this.#listView(); }
    const accounts = this.#store.getState().accounts || [];

    const rows = accounts.map((a) => {
      const on    = this.#picked.has(a.id);
      const other = a.groupId && a.groupId !== this.#groupId
        ? this.#groups.find(a.groupId)?.name
        : null;
      return `
        <button type="button" class="sheet-row ${on ? 'is-selected' : ''}"
                onclick="window.__app.accountGroupSheet.toggleAccount('${this.js(a.id)}')">
          <span class="sheet-dot" style="background:${this.safeColor(a.color, '#a1a1aa')}"></span>
          <span class="sheet-row-name">
            ${this.esc(a.name)}
            ${other ? `<span class="sheet-row-meta"> · in ${this.esc(other)}</span>` : ''}
          </span>
          <span class="sheet-row-meta">${this.esc(a.currency)}</span>
          ${on
            ? `<i data-lucide="check" style="width:15px;height:15px" class="text-emerald-500"></i>`
            : `<span style="width:15px;height:15px;flex-shrink:0"></span>`}
        </button>`;
    }).join('') || `<div class="sheet-empty">No accounts yet.</div>`;

    return `
      <div class="sheet-head">
        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-ghost px-2" aria-label="Back"
                  onclick="window.__app.accountGroupSheet.back()">
            <i data-lucide="chevron-left"></i>
          </button>
          <div class="flex-1 min-w-0">
            <div class="text-base font-semibold truncate">${this.esc(group.name)}</div>
            <div class="sheet-note">Tick the accounts that belong here</div>
          </div>
          <button type="button" class="btn btn-ghost px-2" aria-label="Close"
                  onclick="window.__app.accountGroupSheet.close()">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
      <div class="sheet-body">${rows}</div>
      <div class="sheet-foot">
        <div class="text-xs text-zinc-500">${this.#picked.size} selected</div>
        <div class="flex-1"></div>
        <button type="button" class="btn btn-ghost" onclick="window.__app.accountGroupSheet.pickNone()">None</button>
        <button type="button" class="btn btn-ghost" onclick="window.__app.accountGroupSheet.pickAll()">All</button>
        <button type="button" class="btn btn-primary" onclick="window.__app.accountGroupSheet.applyMembers()">
          <i data-lucide="check"></i> Save
        </button>
      </div>`;
  }

  /** Shared rename / create input row. */
  #inputRow(value) {
    return `
      <div class="px-1 py-2">
        <div class="sheet-inline-form">
          <input class="input" data-grp-input autocomplete="off" placeholder="Group name"
                 value="${this.esc(value)}"
                 onkeydown="window.__app.accountGroupSheet.onKey(event)">
          <button type="button" class="btn btn-primary" onclick="window.__app.accountGroupSheet.submit()">Save</button>
          <button type="button" class="btn btn-ghost" onclick="window.__app.accountGroupSheet.cancel()">Cancel</button>
        </div>
      </div>`;
  }
}
