/**
 * FamilyView — Family sharing management.
 *
 * Shows outgoing shares (accounts shared by the user) and incoming shares
 * (accounts others have shared with the user).  Each family member card
 * displays the accounts shared with that member and their access level.
 */
import { BaseView } from './BaseView.js';

/** Icon mapping for account types — mirrors the original accountIcon() helper. */
const ACCOUNT_TYPE_ICONS = {
  cash:    'wallet',
  bank:    'landmark',
  card:    'credit-card',
  savings: 'landmark',
  invest:  'trending-up',
};

/** Access-level metadata — mirrors accessLevel() in the original. */
const ACCESS_LEVELS = {
  owner: { label: 'Owner',       icon: 'shield',       color: '#8b5cf6' },
  full:  { label: 'Full access', icon: 'shield-check',  color: '#10b981' },
  edit:  { label: 'Can edit',    icon: 'pencil',        color: '#3b82f6' },
  view:  { label: 'View only',   icon: 'eye',           color: '#f59e0b' },
};

export class FamilyView extends BaseView {
  constructor() {
    super();
  }

  render() {
    const state   = this.state;
    const members  = state.family || [];
    const accounts = state.accounts.filter((a) => !a.archived);

    return `
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-xl font-semibold">Family Sharing</h2>
          <p class="text-sm text-zinc-500 mt-0.5">Share specific accounts with family members and control their access level.</p>
        </div>
        <button class="btn btn-primary" onclick="window.__app.openModal('familyMember',{})">
          <i data-lucide="user-plus"></i> Add member
        </button>
      </div>

      ${members.length === 0 ? this.#emptyMembersCard() : this.#membersGrid(members, accounts)}

      ${this.#inboundSection(state)}
    `;
  }

  // ── Private ───────────────────────────────────────────────────────────

  #emptyMembersCard() {
    return `
      <div class="card flex flex-col items-center justify-center py-16 text-center gap-3">
        <div class="icon-pill w-14 h-14" style="background:#8b5cf622;color:#8b5cf6;border-radius:16px">
          <i data-lucide="users" style="width:28px;height:28px"></i>
        </div>
        <div class="font-medium">No family members yet</div>
        <div class="text-sm text-zinc-500 max-w-xs">Add a family member and choose which accounts they can see — with exactly the access level you want.</div>
        <button class="btn btn-primary mt-2" onclick="window.__app.openModal('familyMember',{})">
          <i data-lucide="user-plus"></i> Add member
        </button>
      </div>`;
  }

  #membersGrid(members, accounts) {
    return `
      <div class="grid gap-4 sm:grid-cols-2">
        ${members.map((m) => this.#memberCard(m, accounts)).join('')}
      </div>

      <div class="card-muted p-4 mt-6 flex gap-3 items-start">
        <i data-lucide="info" class="text-zinc-400 flex-shrink-0 mt-0.5" style="width:16px;height:16px"></i>
        <div class="text-xs text-zinc-500">
          Use the <strong>Share</strong> button to sync access with each member. Changes to permissions and transactions are reflected automatically once shared.
        </div>
      </div>`;
  }

  #memberCard(m, accounts) {
    const perms          = Array.isArray(m.permissions) ? m.permissions : [];
    const sharedAccounts = perms.map((p) => {
      const acc = accounts.find((a) => a.id === p.accountId);
      if (!acc) return null;
      const lvl = ACCESS_LEVELS[p.access] || ACCESS_LEVELS.view;
      return { acc, lvl };
    }).filter(Boolean);

    const initial = m.initials || m.name.slice(0, 2).toUpperCase();

    return `
      <div class="card p-4">
        <div class="flex items-start gap-3 mb-4">
          <div class="w-10 h-10 rounded-full flex-shrink-0 grid place-items-center text-white font-semibold text-sm"
               style="background:${m.color || '#8b5cf6'}">${this.escapeHtml(initial)}</div>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate">${this.escapeHtml(m.name)}</div>
            ${m.email ? `<div class="text-xs text-zinc-500 truncate">${this.escapeHtml(m.email)}</div>` : ''}
          </div>
          <button class="btn btn-ghost" onclick="window.__app.openModal('familyMember',{id:'${m.id}'})" title="Edit">
            <i data-lucide="pencil" style="width:15px;height:15px"></i>
          </button>
        </div>

        ${sharedAccounts.length === 0
          ? `<div class="text-xs text-zinc-400 italic">No accounts shared yet</div>`
          : `<div class="space-y-2">
               ${sharedAccounts.map(({ acc, lvl }) => `
                 <div class="flex items-center gap-2">
                   <div class="icon-pill w-7 h-7 rounded-lg flex-shrink-0"
                        style="background:${acc.color || '#e4e4e7'}22;color:${acc.color || '#71717a'}">
                     <i data-lucide="${ACCOUNT_TYPE_ICONS[acc.type] || 'wallet'}" style="width:13px;height:13px"></i>
                   </div>
                   <div class="flex-1 min-w-0">
                     <div class="text-sm truncate">${this.escapeHtml(acc.name)}</div>
                     <div class="text-xs text-zinc-500">${acc.currency}</div>
                   </div>
                   <span class="chip text-xs" style="background:${lvl.color}18;color:${lvl.color}">
                     <i data-lucide="${lvl.icon}" style="width:10px;height:10px;display:inline"></i> ${lvl.label}
                   </span>
                 </div>`).join('')}
             </div>`}

        <div class="flex gap-2 mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
          <button class="btn btn-outline flex-1 justify-center text-xs text-rose-500"
                  onclick="window.__app.deleteFamilyMember('${m.id}')">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i> Remove
          </button>
        </div>
      </div>`;
  }

  #inboundSection(state) {
    const sharedData = state._sharedData || [];
    if (!sharedData.length) return '';

    const cards = sharedData.map((share, shareIndex) => {
      const sharedAccs = (share.accounts || []).map((a) => {
        const perm = (share.permission || {})[a.id] || 'view';
        const lvl  = ACCESS_LEVELS[perm] || ACCESS_LEVELS.view;
        return { a, lvl };
      });
      if (!sharedAccs.length) return '';

      const initial = (share.sharedBy || '?').slice(0, 2).toUpperCase();
      return `
        <div class="card p-4">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-8 h-8 rounded-full grid place-items-center text-white font-semibold text-xs flex-shrink-0"
                 style="background:#818cf8">${this.escapeHtml(initial)}</div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">${this.escapeHtml(share.sharedBy || 'Family member')}</div>
              <div class="text-xs text-zinc-500">Sharing ${sharedAccs.length} account${sharedAccs.length > 1 ? 's' : ''} with you</div>
            </div>
          </div>
          <div class="space-y-2">
            ${sharedAccs.map(({ a, lvl }) => `
              <div class="flex items-center gap-2 cursor-pointer hover:opacity-80"
                   onclick="window.__app.openAccountDetail('${a.id}',{shareIndex:${shareIndex}})">
                <div class="icon-pill w-7 h-7 rounded-lg flex-shrink-0"
                     style="background:${a.color || '#818cf8'}22;color:${a.color || '#818cf8'}">
                  <i data-lucide="${a.icon || 'wallet'}" style="width:13px;height:13px"></i>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm truncate font-medium">${this.escapeHtml(a.name)}</div>
                  <div class="text-xs text-zinc-500">${a.currency} · ${this.formatMoney(a.balance, a.currency)}</div>
                </div>
                <span class="chip text-xs" style="background:${lvl.color}18;color:${lvl.color}">
                  <i data-lucide="${lvl.icon}" style="width:10px;height:10px;display:inline"></i> ${lvl.label}
                </span>
              </div>`).join('')}
          </div>
        </div>`;
    }).filter(Boolean).join('');

    if (!cards) return '';

    return `
      <div class="mt-8">
        <div class="flex items-center gap-2 mb-3">
          <i data-lucide="users" style="width:15px;height:15px;color:#818cf8"></i>
          <h3 class="text-sm font-semibold uppercase tracking-wider text-zinc-500">Shared with me</h3>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">${cards}</div>
      </div>`;
  }
}
