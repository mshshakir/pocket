/**
 * BudgetShareSheet — choose who can see a budget, and at what level.
 *
 * The budget-first mirror of AccountShareSheet. It exists because a budget
 * cannot inherit sharing from an account the way debts and regular items do:
 * its shape is `{ categoryId | categoryIds[], amount, currency, period,
 * rollover }` — there is no `accountId` anywhere on it. Without per-budget
 * grants the only options were "share all of the owner's budgets" or "share
 * none", and neither is a real answer.
 *
 * Two things differ from the account sheet, both deliberate:
 *
 *  · The ladder is FAMILY_BUDGET_ACCESS_LEVELS (view / edit / full), not the
 *    account one. Reusing the account levels would offer "Can add — View + add
 *    new transactions" on a budget, which means nothing.
 *
 *  · Sharing a budget publishes its SPEND, computed across every one of the
 *    owner's accounts — including ones the member cannot see. That is not a
 *    leak, it is the point: a budget without its real spend is not worth
 *    sharing. But the owner should know, so the sheet says so plainly.
 */
import { Store }               from '../../core/Store.js';
import { OverlaySheet }        from './OverlaySheet.js';
import { FamilyShareService }  from '../../domain/services/FamilyShareService.js';

export class BudgetShareSheet extends OverlaySheet {
  /** @type {Store} */              #store;
  /** @type {FamilyShareService} */ #shares;
  /** @type {object} */             #sync;

  #budgetId = null;
  #memberId = null;   // member whose level list is expanded
  #error    = '';

  /**
   * @param {object} deps
   * @param {Store}              [deps.store]
   * @param {FamilyShareService} deps.familyShareService
   * @param {object}             deps.syncService
   */
  constructor({ store, familyShareService, syncService }) {
    super({ id: 'budgetShareSheetRoot' });
    this.#store  = store || Store.getInstance();
    this.#shares = familyShareService;
    this.#sync   = syncService;
  }

  // ── Public API ────────────────────────────────────────────────────────

  /** @param {string} budgetId */
  open(budgetId) {
    this.#budgetId = budgetId;
    this.#memberId = null;
    this.#error    = '';
    this.render();
    this.show();
  }

  /** @param {string} memberId */
  pick(memberId) {
    this.#memberId = this.#memberId === memberId ? null : memberId;
    this.#error    = '';
    this.render();
  }

  /**
   * Apply an access level. `access` of '' revokes.
   * @param {string} memberId
   * @param {string} access
   */
  setAccess(memberId, access) {
    const level = access || null;
    const res   = this.#shares.setBudgetAccess(memberId, this.#budgetId, level);
    if (!res.ok) { this.#error = res.reason; this.render(); return; }

    // `wasLast` means nothing is shared with them AT ALL — not merely that this
    // budget is gone. A member who still holds an account grant keeps their
    // space, and dropping their cloud row here would strand it.
    if (res.wasLast && res.member?.email) {
      this.#sync?.revokeMemberShare?.(res.member.email);
    }
    this.#memberId = null;
    this.#error    = '';
    this.render();

    const name = res.member?.name || 'member';
    window.__app?.showToast?.(
      level ? `Budget shared with ${name}` : `Stopped sharing with ${name}`,
    );
  }

  /** Stop sharing this budget with everyone. */
  unshareAll() {
    const affected = this.#shares.unshareBudget(this.#budgetId);
    for (const { member, wasLast } of affected) {
      if (wasLast && member.email) this.#sync?.revokeMemberShare?.(member.email);
    }
    this.#memberId = null;
    this.render();
    window.__app?.showToast?.('Stopped sharing this budget');
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  /** @override */
  renderContent() {
    const state  = this.#store.getState();
    const budget = (state.budgets || []).find((b) => b.id === this.#budgetId);
    if (!budget) return this.#missing();

    const members = this.#shares.members();
    const shared  = this.#shares.budgetSharedWith(this.#budgetId);
    const name    = this.#budgetName(budget, state);

    return `
      <div class="sheet-head">
        <div class="flex items-center gap-2">
          <span class="sheet-dot" style="background:#8b5cf6"></span>
          <div class="flex-1 min-w-0">
            <div class="text-base font-semibold truncate">Share budget · ${this.esc(name)}</div>
            <div class="sheet-note">
              ${shared.length
                ? `Shared with ${shared.length} member${shared.length === 1 ? '' : 's'}`
                : 'Not shared with anyone yet'}
            </div>
          </div>
          <button type="button" class="btn btn-ghost px-2" aria-label="Close"
                  onclick="window.__app.budgetShareSheet.close()">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
      <div class="sheet-body">
        ${this.#error ? `<div class="sheet-note text-rose-500 px-2 pb-1">${this.esc(this.#error)}</div>` : ''}
        <div class="sheet-note px-2 pb-2">
          They'll see how much of this budget is spent, counted across
          <strong>all</strong> your accounts — not only the ones you've shared.
        </div>
        ${members.length
          ? members.map((m) => this.#memberRow(m)).join('')
          : `<div class="sheet-empty">No family members yet — invite someone to start sharing.</div>`}
        ${shared.length ? `
          <button type="button" class="sheet-row text-rose-500 mt-1"
                  onclick="window.__app.budgetShareSheet.unshareAll()">
            <i data-lucide="user-minus" style="width:15px;height:15px"></i>
            <span class="sheet-row-name">Stop sharing with everyone</span>
          </button>` : ''}
      </div>
      <div class="sheet-foot">
        <div class="sheet-note">Changes sync to their device right away</div>
        <div class="flex-1"></div>
        <button type="button" class="btn btn-primary"
                onclick="window.__app.budgetShareSheet.close()">Done</button>
      </div>`;
  }

  /** A budget has no name of its own — it is known by its categories. */
  #budgetName(budget, state) {
    if (budget.name) return budget.name;
    const ids = Array.isArray(budget.categoryIds) && budget.categoryIds.length
      ? budget.categoryIds
      : (budget.categoryId ? [budget.categoryId] : []);
    const names = ids
      .map((id) => (state.categories || []).find((c) => c.id === id)?.name)
      .filter(Boolean);
    if (!names.length) return 'Budget';
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  }

  #memberRow(m) {
    const access = this.#shares.budgetAccessFor(m.id, this.#budgetId);
    const level  = FamilyShareService.budgetLevels.find((l) => l.id === access);
    const open   = this.#memberId === m.id;

    const header = `
      <button type="button" class="sheet-row ${access ? 'is-selected' : ''}"
              onclick="window.__app.budgetShareSheet.pick('${this.js(m.id)}')">
        <span class="sheet-dot" style="background:${this.safeColor(m.color, '#a1a1aa')}"></span>
        <span class="sheet-row-name">
          ${this.esc(m.name || m.email || 'Member')}
          ${m.email ? `<span class="sheet-row-meta"> · ${this.esc(m.email)}</span>` : ''}
        </span>
        <span class="sheet-row-meta" ${level ? `style="color:${this.safeColor(level.color)}"` : ''}>
          ${level ? this.esc(level.label) : 'No access'}
        </span>
        <i data-lucide="${open ? 'chevron-down' : 'chevron-right'}" class="text-zinc-400"
           style="width:15px;height:15px"></i>
      </button>`;

    if (!open) return header;

    const choices = [
      ...FamilyShareService.budgetLevels.map((l) => ({
        id: l.id, label: l.label, desc: l.desc, color: l.color, icon: l.icon,
      })),
      { id: '', label: 'No access', desc: 'Remove this budget from their view', color: '#71717a', icon: 'ban' },
    ].map((l) => {
      const on = (access || '') === l.id;
      return `
        <button type="button" class="sheet-row ${on ? 'is-selected' : ''}" style="padding-left:2rem"
                onclick="window.__app.budgetShareSheet.setAccess('${this.js(m.id)}','${this.js(l.id)}')">
          <i data-lucide="${this.safeIcon(l.icon)}" style="width:14px;height:14px;color:${this.safeColor(l.color)}"></i>
          <span class="sheet-row-name">
            ${this.esc(l.label)}
            <span class="sheet-row-meta"> · ${this.esc(l.desc)}</span>
          </span>
          ${on ? `<i data-lucide="check" style="width:15px;height:15px" class="text-emerald-500"></i>` : ''}
        </button>`;
    }).join('');

    const noEmail = !m.email
      ? `<div class="sheet-note text-amber-600 px-3 pb-1">
           Add an email to this member so the share can reach their device.
         </div>`
      : '';

    return header + noEmail + choices;
  }

  #missing() {
    return `
      <div class="sheet-head">
        <div class="flex items-center gap-2">
          <div class="flex-1 text-base font-semibold">Share budget</div>
          <button type="button" class="btn btn-ghost px-2" aria-label="Close"
                  onclick="window.__app.budgetShareSheet.close()">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
      <div class="sheet-body"><div class="sheet-empty">That budget no longer exists.</div></div>`;
  }
}
