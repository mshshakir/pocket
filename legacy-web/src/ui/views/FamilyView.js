/**
 * FamilyView — Family sharing management.
 *
 * Shows outgoing shares (accounts shared by the user) and incoming shares
 * (accounts others have shared with the user).  Each family member card
 * displays the accounts shared with that member and their access level.
 */
import { BaseView } from './BaseView.js';
import { FAMILY_ACCESS_LEVELS, FAMILY_BUDGET_ACCESS_LEVELS } from '../../data/constants.js';

/** Icon mapping for account types — mirrors the original accountIcon() helper. */
const ACCOUNT_TYPE_ICONS = {
  cash:    'wallet',
  bank:    'landmark',
  card:    'credit-card',
  savings: 'landmark',
  invest:  'trending-up',
};

/**
 * Access-level metadata, derived from the single source of truth.
 *
 * This used to be a hand-maintained copy that had drifted: it omitted `add`
 * entirely, so a member granted "Can add" fell through the lookup and was
 * displayed as "View only" — the owner was told they had given LESS access than
 * they had. Its colours for `edit` and `view` were also swapped relative to the
 * constant.
 */
const ACCESS_LEVELS = {
  owner: { label: 'Owner', icon: 'shield', color: '#8b5cf6' },
  ...Object.fromEntries(FAMILY_ACCESS_LEVELS.map((l) => [l.id, l])),
};

/** Budget grants use their own shorter ladder. */
const BUDGET_LEVELS = Object.fromEntries(FAMILY_BUDGET_ACCESS_LEVELS.map((l) => [l.id, l]));

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

  /**
   * One outbound space — what this member actually sees.
   *
   * Previously a "member card": a person plus a list of account checkboxes.
   * That answered "who have I added?" but never "what does Zahra see?", which
   * is the question you ask when you are about to change something. It now
   * shows the space by its name, with every account AND budget in it.
   */
  #memberCard(m, accounts) {
    const state          = this.state;
    const perms          = Array.isArray(m.permissions) ? m.permissions : [];
    const sharedAccounts = perms.map((p) => {
      const acc = accounts.find((a) => a.id === p.accountId);
      if (!acc) return null;
      const lvl = ACCESS_LEVELS[p.access] || ACCESS_LEVELS.view;
      return { acc, lvl };
    }).filter(Boolean);

    const budgetPerms  = Array.isArray(m.budgetPermissions) ? m.budgetPermissions : [];
    const sharedBudgets = budgetPerms.map((p) => {
      const b = (state.budgets || []).find((x) => x.id === p.budgetId);
      if (!b) return null;
      return { b, lvl: BUDGET_LEVELS[p.access] || BUDGET_LEVELS.view };
    }).filter(Boolean);

    const initial = (m.initials || (m.name || m.email || '?').slice(0, 2)).toUpperCase();
    // The name THIS member sees. Falls back to the owner's own name, which is
    // what every space was called before it could be named.
    const spaceName = m.spaceName || state.user?.name || 'My money';

    return `
      <div class="card p-4">
        <div class="flex items-start gap-3 mb-4">
          <div class="w-10 h-10 rounded-full flex-shrink-0 grid place-items-center text-white font-semibold text-sm"
               style="background:${this.safeColor(m.color, '#8b5cf6')}">${this.escapeHtml(initial)}</div>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate flex items-center gap-1.5">
              ${this.escapeHtml(spaceName)}
              <button class="btn btn-ghost px-1" title="Rename this space"
                      onclick="window.__app.renameSharedSpace('${this.jsArg(m.id)}')">
                <i data-lucide="pencil" style="width:12px;height:12px"></i>
              </button>
            </div>
            <div class="text-xs text-zinc-500 truncate">
              ${this.escapeHtml(m.name)}${m.email ? ` · ${this.escapeHtml(m.email)}` : ''}
            </div>
            ${m.spaceName ? '' : `<div class="text-[11px] text-zinc-400 mt-0.5">
              They see this as your name — rename it to say what it holds
            </div>`}
          </div>
          <button class="btn btn-ghost" onclick="window.__app.openModal('familyMember',{id:'${this.jsArg(m.id)}'})" title="Edit member">
            <i data-lucide="user-cog" style="width:15px;height:15px"></i>
          </button>
        </div>

        ${sharedAccounts.length === 0 && sharedBudgets.length === 0
          ? `<div class="text-xs text-zinc-400 italic">Nothing shared yet — they see an empty space</div>`
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
                   <span class="chip text-xs" style="background:${this.safeColor(lvl.color)}18;color:${this.safeColor(lvl.color)}">
                     <i data-lucide="${this.safeIcon(lvl.icon)}" style="width:10px;height:10px;display:inline"></i> ${this.escapeHtml(lvl.label)}
                   </span>
                 </div>`).join('')}
               ${sharedBudgets.map(({ b, lvl }) => `
                 <div class="flex items-center gap-2">
                   <div class="icon-pill w-7 h-7 rounded-lg flex-shrink-0"
                        style="background:#8b5cf622;color:#8b5cf6">
                     <i data-lucide="target" style="width:13px;height:13px"></i>
                   </div>
                   <div class="flex-1 min-w-0">
                     <div class="text-sm truncate">${this.escapeHtml(this.#budgetLabel(b))}</div>
                     <div class="text-xs text-zinc-500">Budget · ${this.escapeHtml(b.currency)}</div>
                   </div>
                   <span class="chip text-xs" style="background:${this.safeColor(lvl.color)}18;color:${this.safeColor(lvl.color)}">
                     <i data-lucide="${this.safeIcon(lvl.icon)}" style="width:10px;height:10px;display:inline"></i> ${this.escapeHtml(lvl.label)}
                   </span>
                 </div>`).join('')}
             </div>`}

        <div class="flex gap-2 mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
          <button class="btn btn-outline flex-1 justify-center text-xs text-rose-500"
                  onclick="window.__app.deleteFamilyMember('${this.jsArg(m.id)}')">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i> Remove
          </button>
        </div>
      </div>`;
  }

  /** A budget has no name of its own — it is known by its categories. */
  #budgetLabel(b) {
    if (b.name) return b.name;
    const ids = Array.isArray(b.categoryIds) && b.categoryIds.length
      ? b.categoryIds : (b.categoryId ? [b.categoryId] : []);
    const names = ids
      .map((id) => (this.state.categories || []).find((c) => c.id === id)?.name)
      .filter(Boolean);
    if (!names.length) return 'Budget';
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
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
                   onclick="window.__app.openAccountDetail('${this.jsArg(a.id)}',{shareIndex:${Number(shareIndex) || 0}})">
                <div class="icon-pill w-7 h-7 rounded-lg flex-shrink-0"
                     style="background:${this.safeColor(a.color, '#818cf8')}22;color:${this.safeColor(a.color, '#818cf8')}">
                  <i data-lucide="${this.safeIcon(a.icon, 'wallet')}" style="width:13px;height:13px"></i>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm truncate font-medium">${this.escapeHtml(a.name)}</div>
                  <div class="text-xs text-zinc-500">${this.escapeHtml(a.currency)} · ${this.formatMoney(a.balance, a.currency)}</div>
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
