/**
 * AccountShareSheet — "who can see this account?", asked from the account side.
 *
 *   Share · Joint Account                       ✕
 *   ────────────────────────────────────────────────
 *   ● Amina          Full access            ✓
 *   ● Yusuf          No access
 *   ＋ Invite someone
 *   Stop sharing with everyone
 *
 * Sharing was previously only reachable member-first (Family → member → tick
 * accounts). That answers "what should this person see?" — the opposite of
 * what you're asking when you're looking at one account. Both screens write the
 * same `state.family[].permissions` storage through FamilyShareService, so they
 * can never disagree.
 *
 * Revoking a member's LAST account also deletes their family_shares row via
 * SyncService.revokeMemberShare(), otherwise their device keeps serving the old
 * snapshot indefinitely (audit finding H8).
 */
import { OverlaySheet }      from './OverlaySheet.js';
import { Store }             from '../../core/Store.js';
import { FamilyShareService } from '../../domain/services/FamilyShareService.js';

export class AccountShareSheet extends OverlaySheet {
  /** @type {Store} */              #store;
  /** @type {FamilyShareService} */ #shares;
  /** @type {object} */             #sync;

  // ── Per-open session state ────────────────────────────────────────────
  #accountId = null;
  #memberId  = null;   // member whose level list is open
  #error     = '';
  #onClose   = null;

  /**
   * @param {object} deps
   * @param {Store}              [deps.store]
   * @param {FamilyShareService} deps.familyShareService
   * @param {object}             deps.syncService
   */
  constructor({ store, familyShareService, syncService }) {
    super({ id: 'accountShareSheetRoot' });
    this.#store  = store || Store.getInstance();
    this.#shares = familyShareService;
    this.#sync   = syncService;
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * @param {string} accountId
   * @param {object} [cfg]
   * @param {() => void} [cfg.onClose]
   */
  open(accountId, { onClose } = {}) {
    this.#accountId = accountId;
    this.#memberId  = null;
    this.#error     = '';
    this.#onClose   = typeof onClose === 'function' ? onClose : null;
    this.show();
  }

  /** @override */
  onClosed() {
    const cb = this.#onClose;
    this.#onClose = null;
    cb?.();
  }

  // ── Interaction ───────────────────────────────────────────────────────

  /** Expand the access-level choices for one member. @param {string} memberId */
  pick(memberId) {
    this.#memberId = this.#memberId === memberId ? null : memberId;
    this.#error    = '';
    this.render();
  }

  /**
   * Apply an access level. `access` of '' means revoke.
   * @param {string} memberId
   * @param {string} access
   */
  setAccess(memberId, access) {
    const level = access || null;
    const res   = this.#shares.setAccess(memberId, this.#accountId, level);
    if (!res.ok) { this.#error = res.reason; this.render(); return; }

    // Losing the last shared account is a full revocation — drop the cloud row
    // too, or their client keeps serving the snapshot it already has.
    if (res.wasLast && res.member?.email) {
      this.#sync?.revokeMemberShare?.(res.member.email);
    }
    this.#memberId = null;
    this.#error    = '';
    this.render();

    const name = res.member?.name || 'member';
    window.__app?.showToast?.(
      level ? `Shared with ${name}` : `Stopped sharing with ${name}`,
    );
  }

  /** Remove every member's access to this account. */
  unshareAll() {
    const affected = this.#shares.unshareAccount(this.#accountId);
    for (const { member, wasLast } of affected) {
      if (wasLast && member.email) this.#sync?.revokeMemberShare?.(member.email);
    }
    this.#error = '';
    this.render();
    if (affected.length) {
      window.__app?.showToast?.(`Stopped sharing with ${affected.length} member${affected.length === 1 ? '' : 's'}`);
    }
  }

  /** Hand off to the existing member modal to invite someone new. */
  invite() {
    this.close();
    window.__app?.openModal?.('familyMember', {});
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  /** @override */
  renderContent() {
    const account = (this.#store.getState().accounts || [])
      .find((a) => a.id === this.#accountId);
    if (!account) return this.#missing();

    const members = this.#shares.members();
    const shared  = this.#shares.sharedWith(this.#accountId);

    return `
      <div class="sheet-head">
        <div class="flex items-center gap-2">
          <span class="sheet-dot" style="background:${this.safeColor(account.color, '#818cf8')}"></span>
          <div class="flex-1 min-w-0">
            <div class="text-base font-semibold truncate">Share · ${this.esc(account.name)}</div>
            <div class="sheet-note">
              ${shared.length
                ? `Shared with ${shared.length} member${shared.length === 1 ? '' : 's'}`
                : 'Not shared with anyone yet'}
            </div>
          </div>
          <button type="button" class="btn btn-ghost px-2" aria-label="Close"
                  onclick="window.__app.accountShareSheet.close()">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
      <div class="sheet-body">
        ${this.#error ? `<div class="sheet-note text-rose-500 px-2 pb-1">${this.esc(this.#error)}</div>` : ''}
        ${members.length
          ? members.map((m) => this.#memberRow(m)).join('')
          : `<div class="sheet-empty">No family members yet — invite someone to start sharing.</div>`}
        <button type="button" class="sheet-row text-zinc-500 mt-1"
                onclick="window.__app.accountShareSheet.invite()">
          <i data-lucide="user-plus" style="width:15px;height:15px"></i>
          <span class="sheet-row-name">Invite someone</span>
        </button>
        ${shared.length ? `
          <button type="button" class="sheet-row text-rose-500 mt-1"
                  onclick="window.__app.accountShareSheet.unshareAll()">
            <i data-lucide="user-minus" style="width:15px;height:15px"></i>
            <span class="sheet-row-name">Stop sharing with everyone</span>
          </button>` : ''}
      </div>
      <div class="sheet-foot">
        <div class="sheet-note">Changes sync to their device right away</div>
        <div class="flex-1"></div>
        <button type="button" class="btn btn-primary"
                onclick="window.__app.accountShareSheet.close()">Done</button>
      </div>`;
  }

  /** One member row, expanding into the access-level choices when tapped. */
  #memberRow(m) {
    const access = this.#shares.accessFor(m.id, this.#accountId);
    const level  = FamilyShareService.levels.find((l) => l.id === access);
    const open   = this.#memberId === m.id;

    const header = `
      <button type="button" class="sheet-row ${access ? 'is-selected' : ''}"
              onclick="window.__app.accountShareSheet.pick('${this.js(m.id)}')">
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
      ...FamilyShareService.levels.map((l) => ({
        id: l.id, label: l.label, desc: l.desc, color: l.color, icon: l.icon,
      })),
      { id: '', label: 'No access', desc: 'Remove this account from their view', color: '#71717a', icon: 'ban' },
    ].map((l) => {
      const on = (access || '') === l.id;
      return `
        <button type="button" class="sheet-row ${on ? 'is-selected' : ''}" style="padding-left:2rem"
                onclick="window.__app.accountShareSheet.setAccess('${this.js(m.id)}','${this.js(l.id)}')">
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
          <div class="flex-1 text-base font-semibold">Share</div>
          <button type="button" class="btn btn-ghost px-2" aria-label="Close"
                  onclick="window.__app.accountShareSheet.close()">
            <i data-lucide="x"></i>
          </button>
        </div>
      </div>
      <div class="sheet-body"><div class="sheet-empty">That account no longer exists.</div></div>`;
  }
}
