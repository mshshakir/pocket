/**
 * AccountsView — Grid of account cards grouped by account-group,
 * plus "shared with me" cards from family sharing.
 */
import { BaseView } from './BaseView.js';

export class AccountsView extends BaseView {
  constructor() {
    super();
  }

  render() {
    const { state, homeCurrency: home } = this;
    if (!Array.isArray(state.accountGroups))           state.accountGroups = [];
    if (!Array.isArray(state.user.collapsedAccountGroups)) state.user.collapsedAccountGroups = [];

    const collapsed    = new Set(state.user.collapsedAccountGroups);
    const groupSections = state.accountGroups.map((g) => ({
      id: g.id, name: g.name, color: g.color,
      accs: state.accounts.filter((a) => a.groupId === g.id),
    }));
    const validGroupIds = new Set(state.accountGroups.map((g) => g.id));
    const ungroupedAccs = state.accounts.filter((a) => !a.groupId || !validGroupIds.has(a.groupId));
    const sections = [
      ...groupSections,
      ungroupedAccs.length ? { id: '__none__', name: 'Ungrouped', color: '#9ca3af', accs: ungroupedAccs } : null,
    ].filter(Boolean);

    const sharedOutIds = new Set(
      (state.family || []).flatMap((m) => (m.permissions || []).map((p) => p.accountId)),
    );

    const anyExpanded  = sections.some((s) => !collapsed.has(s.id));
    const anyCollapsed = sections.some((s) =>  collapsed.has(s.id));

    return `
      <div class="flex items-center justify-between mb-6 gap-2">
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Accounts</h1>
        <div class="flex items-center gap-2">
          ${sections.length > 1 ? `
            ${anyExpanded  ? `<button class="btn btn-ghost text-sm" onclick="window.__app.collapseAllAccountGroups()" title="Collapse all groups"><i data-lucide="chevrons-down-up" style="width:14px;height:14px"></i><span class="hidden md:inline ml-1">Collapse all</span></button>` : ''}
            ${anyCollapsed ? `<button class="btn btn-ghost text-sm" onclick="window.__app.expandAllAccountGroups()" title="Expand all groups"><i data-lucide="chevrons-up-down" style="width:14px;height:14px"></i><span class="hidden md:inline ml-1">Expand all</span></button>` : ''}
          ` : ''}
          <button class="btn btn-primary" onclick="window.__app.openModal('account')">
            <i data-lucide="plus"></i> New account
          </button>
        </div>
      </div>

      ${state.accounts.length === 0
        ? `<div class="card p-10 text-center">${this.emptyState('No accounts', 'Add your first account to start tracking.')}</div>`
        : sections.map((sec) => `
            <div class="mb-6">
              ${this.#sectionHeader(sec, collapsed, home)}
              ${collapsed.has(sec.id) ? '' : `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  ${sec.accs.map((a) => this.#accountCard(a, home, sharedOutIds)).join('')}
                </div>`}
            </div>`).join('')}

      ${this.#sharedCards(state, home)}
    `;
  }

  // ── Private ──────────────────────────────────────────────────────────

  #accountCard(a, home, sharedOutIds) {
    const txCount = this.state.transactions.filter(
      (t) => t.accountId === a.id || (Array.isArray(t.splits) && t.splits.some((s) => (s.accountId || t.accountId) === a.id)),
    ).length;
    const isSharedOut = sharedOutIds.has(a.id);

    return `
      <div class="card p-5 relative overflow-hidden ${a.archived ? 'opacity-60' : ''} hover:shadow-md transition-shadow cursor-pointer"
           onclick="window.__app.openAccountDetail('${a.id}')">
        <div class="absolute -right-8 -top-8 w-32 h-32 rounded-full pointer-events-none" style="background:${a.color}22"></div>
        <div class="flex items-start gap-3 relative">
          <div class="icon-pill" style="background:${a.color};color:white">
            <i data-lucide="${a.icon || 'wallet'}"></i>
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <div class="font-semibold">${this.escapeHtml(a.name)}</div>
              ${a.archived ? '<span class="chip">Archived</span>' : ''}
              ${isSharedOut ? `<span title="Shared with family" style="display:inline-flex;align-items:center;gap:2px;font-size:.6rem;background:#818cf822;color:#818cf8;border-radius:6px;padding:1px 5px"><i data-lucide="users" style="width:10px;height:10px"></i> Shared</span>` : ''}
            </div>
            <div class="text-xs text-zinc-500 capitalize">${a.type} · ${a.currency} · ${txCount} transaction${txCount === 1 ? '' : 's'}</div>
          </div>
          <button class="btn btn-ghost"
                  onclick="event.stopPropagation();window.__app.openModal('account',{id:'${a.id}'})"
                  title="Edit account">
            <i data-lucide="pencil"></i>
          </button>
        </div>
        <div class="mt-5 relative">
          <div class="text-xs text-zinc-500">Balance</div>
          <div class="text-2xl font-semibold ${a.balance < 0 ? 'text-rose-500' : ''}">${this.formatMoney(a.balance, a.currency)}</div>
          ${a.currency !== home ? `<div class="text-xs text-zinc-500">${this.formatMoney(this.convert(a.balance, a.currency, home), home)} in ${home}</div>` : ''}
        </div>
        <div class="mt-3 text-xs text-zinc-400 relative flex items-center gap-1">
          <i data-lucide="arrow-right" style="width:11px;height:11px;display:inline"></i> View transactions
        </div>
      </div>`;
  }

  #sectionHeader(sec, collapsed, home) {
    const isCollapsed = collapsed.has(sec.id);
    const totalHome   = sec.accs.reduce((s, a) => s + this.convert(a.balance, a.currency, home), 0);
    return `
      <div class="flex items-center gap-2 mb-2 px-1">
        <button type="button"
                onclick="window.__app.toggleAccountGroupCollapse('${sec.id}')"
                class="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 -my-1 p-1"
                title="${isCollapsed ? 'Expand' : 'Collapse'} group">
          <i data-lucide="${isCollapsed ? 'chevron-right' : 'chevron-down'}" style="width:15px;height:15px;display:inline"></i>
        </button>
        <span class="inline-block rounded-full" style="background:${sec.color};width:8px;height:8px"></span>
        <span class="text-xs uppercase tracking-wider text-zinc-500">${this.escapeHtml(sec.name)}</span>
        <span class="chip" style="font-size:.65rem">${sec.accs.length}</span>
        <div class="flex-1"></div>
        <span class="text-xs text-zinc-500">${this.formatMoney(totalHome, home)}</span>
        ${sec.id !== '__none__' ? `
          <button class="text-xs text-zinc-400 hover:text-rose-500 ml-1 p-1"
                  onclick="window.__app.deleteAccountGroup('${sec.id}')"
                  title="Delete group">
            <i data-lucide="trash-2" style="width:12px;height:12px"></i>
          </button>` : ''}
      </div>`;
  }

  #sharedCards(state, home) {
    const sharedData = state._sharedData || [];
    const cards = sharedData.flatMap((share, si) =>
      (share.accounts || []).map((a) => {
        const perm      = (share.permission || {})[a.id] || 'view';
        const txCount   = (share.transactions || []).filter((t) => t.accountId === a.id).length;
        const permLabel = this.#accessLabel(perm);
        return `
          <div class="card p-5 relative overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
               style="border-color:#818cf822"
               onclick="window.__app.openAccountDetail('${a.id}')">
            <div class="absolute -right-8 -top-8 w-32 h-32 rounded-full pointer-events-none" style="background:${a.color || '#818cf8'}22"></div>
            <div class="flex items-start gap-3 relative">
              <div class="icon-pill" style="background:${a.color || '#818cf8'};color:white">
                <i data-lucide="${a.icon || 'wallet'}"></i>
              </div>
              <div class="flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <div class="font-semibold">${this.escapeHtml(a.name)}</div>
                  <span class="chip" style="background:#818cf822;color:#818cf8;font-size:.6rem">${permLabel}</span>
                </div>
                <div class="text-xs text-zinc-500 capitalize">${a.type} · ${a.currency} · ${txCount} transaction${txCount === 1 ? '' : 's'}</div>
                <div class="text-xs text-zinc-400 mt-0.5">Shared by ${this.escapeHtml(share.sharedBy || 'Family')}</div>
              </div>
            </div>
            <div class="mt-5 relative">
              <div class="text-xs text-zinc-500">Balance</div>
              <div class="text-2xl font-semibold ${a.balance < 0 ? 'text-rose-500' : ''}">${this.formatMoney(a.balance, a.currency)}</div>
              ${a.currency !== home ? `<div class="text-xs text-zinc-500">${this.formatMoney(this.convert(a.balance, a.currency, home), home)} in ${home}</div>` : ''}
            </div>
            <div class="mt-3 text-xs text-zinc-400 relative flex items-center gap-1">
              <i data-lucide="arrow-right" style="width:11px;height:11px;display:inline"></i> View transactions
            </div>
          </div>`;
      }),
    );

    if (!cards.length) return '';
    return `
      <div class="mb-6">
        <div class="flex items-center gap-2 mb-3 px-1">
          <i data-lucide="users" style="width:14px;height:14px;color:#818cf8"></i>
          <span class="text-xs uppercase tracking-wider text-zinc-500">Shared with me</span>
          <span class="chip" style="font-size:.65rem">${cards.length}</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${cards.join('')}
        </div>
      </div>`;
  }

  #accessLabel(perm) {
    const MAP = { owner: 'Owner', full: 'Full access', edit: 'Can edit', view: 'View only' };
    return MAP[perm] || perm;
  }
}
