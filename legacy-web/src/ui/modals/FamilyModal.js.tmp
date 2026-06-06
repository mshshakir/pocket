/**
 * FamilyModal — Add / edit a family member.
 *
 * Renders an avatar colour picker, name/email/initials fields, and a
 * per-account access-level panel.  Per-open permission state is stored
 * in the instance so the Application class can read it on submit.
 */
import { Store }               from '../../core/Store.js';
import { MEMBER_COLORS, FAMILY_ACCESS_LEVELS, ACCOUNT_TYPE_ICONS } from '../../data/constants.js';

export class FamilyModal {
  /** @type {Store} */ #store;

  /** Accumulated permissions while the modal is open.
   *  accountId → access-level string ('view' | 'add' | 'edit' | 'full') */
  #pendingPerms = {};

  constructor() {
    this.#store = Store.getInstance();
  }

  /** Called by Modal.open() before injecting HTML into the card. */
  onOpen(opts /*, _card */) {
    this.#pendingPerms = {};
    const state   = this.#store.getState();
    const member  = opts?.id ? state.family?.find((m) => m.id === opts.id) : null;
    if (member && Array.isArray(member.permissions)) {
      member.permissions.forEach((p) => {
        this.#pendingPerms[p.accountId] = p.access;
      });
    }
  }

  /** Returns a snapshot of the current permission map so app.js can read it. */
  getPendingPerms() {
    return { ...this.#pendingPerms };
  }

  /** Set a single account permission (called live as user clicks radio buttons). */
  setPendingPerm(accountId, level) {
    this.#pendingPerms[accountId] = level;
  }

  /** Remove a permission entry when the toggle is turned off. */
  removePendingPerm(accountId) {
    delete this.#pendingPerms[accountId];
  }

  /**
   * Visually highlight the selected level label for an account and update
   * the matching radio input's checked state.
   * Call this from app.js after setPendingPerm() to keep the UI in sync.
   */
  highlightPermLevel(accountId, level) {
    const container = document.getElementById(`accLevels_${accountId}`);
    if (!container) return;
    container.querySelectorAll('.perm-lvl-label').forEach((lbl) => {
      const isSelected = lbl.dataset.lvl === level;
      const color      = lbl.dataset.color || '#e4e4e7';
      lbl.style.color       = isSelected ? color : '';
      lbl.style.borderColor = isSelected ? color : '#e4e4e7';
      const radio = lbl.querySelector('input[type="radio"]');
      if (radio) radio.checked = isSelected;
    });
  }

  render(opts = {}) {
    const { id } = opts;
    const state   = this.#store.getState();
    const editing = id ? state.family?.find((m) => m.id === id) : null;
    const m       = editing || {
      name:        '',
      email:       '',
      color:       MEMBER_COLORS[(state.family?.length || 0) % MEMBER_COLORS.length],
      initials:    '',
      permissions: [],
    };
    const accounts = (state.accounts || []).filter((a) => !a.archived);

    const permMap = {};
    (m.permissions || []).forEach((p) => { permMap[p.accountId] = p.access; });

    return `
      <div class="p-5">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-lg font-semibold">${editing ? 'Edit member' : 'Add family member'}</h3>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <form id="familyMemberForm"
              onsubmit="window.__app.submitFamilyMember(event,'${editing?.id || ''}')">

          <!-- Avatar colour row -->
          <div class="flex items-center gap-3 mb-4">
            <div id="memberAvatar"
                 class="w-12 h-12 rounded-full grid place-items-center text-white font-bold text-lg flex-shrink-0"
                 style="background:${m.color}">
              ${m.initials || (m.name ? m.name.slice(0, 2).toUpperCase() : '?')}
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${MEMBER_COLORS.map((c) => `
                <button type="button"
                        onclick="window.__app.pickMemberColor('${c}')"
                        class="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                        style="background:${c};border-color:${m.color === c ? '#09090b' : 'transparent'}"
                        data-color="${c}"></button>
              `).join('')}
            </div>
          </div>
          <input type="hidden" name="color" id="memberColorInput" value="${m.color}">

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="text-xs text-zinc-500">Name *</label>
              <input class="input" name="name" required
                     value="${this.#esc(m.name)}"
                     placeholder="e.g. Sara"
                     oninput="const av=document.getElementById('memberAvatar'); av.textContent=this.value.slice(0,2).toUpperCase()||'?'">
            </div>
            <div>
              <label class="text-xs text-zinc-500">Initials</label>
              <input class="input" name="initials" maxlength="2"
                     value="${this.#esc(m.initials || '')}" placeholder="Auto">
            </div>
          </div>

          <div class="mb-4">
            <label class="text-xs text-zinc-500">Email (optional)</label>
            <input class="input" name="email" type="email"
                   value="${this.#esc(m.email || '')}" placeholder="sara@example.com">
          </div>

          <!-- Account permissions -->
          <div class="mb-1">
            <div class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Account access</div>
            ${accounts.length === 0
              ? `<div class="text-xs text-zinc-400 italic">No accounts found.</div>`
              : `<div class="space-y-2" id="accountPermsList">
                   ${accounts.map((acc) => this.#accountPermRow(acc, permMap)).join('')}
                 </div>`}
          </div>

          <div class="flex items-center gap-2 mt-5">
            ${editing ? `
              <button type="button" class="btn btn-outline text-rose-500"
                      onclick="window.__app.deleteFamilyMember('${editing.id}')">
                <i data-lucide="trash-2"></i> Remove
              </button>` : ''}
            <div class="flex-1"></div>
            <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">
              <i data-lucide="check"></i> Save
            </button>
          </div>
        </form>
      </div>`;
  }

  // ── Private ──────────────────────────────────────────────────────────

  #accountPermRow(acc, permMap) {
    const current   = permMap[acc.id] || '';
    const typeIcon  = ACCOUNT_TYPE_ICONS[acc.type] || 'wallet';
    const accColor  = acc.color || '#e4e4e7';
    const iconColor = acc.color || '#71717a';

    return `
      <div class="card-muted p-3 rounded-xl">
        <div class="flex items-center gap-2 mb-2">
          <div class="icon-pill w-7 h-7 rounded-lg flex-shrink-0"
               style="background:${accColor}22;color:${iconColor}">
            <i data-lucide="${typeIcon}" style="width:13px;height:13px"></i>
          </div>
          <div class="flex-1">
            <div class="text-sm font-medium">${this.#esc(acc.name)}</div>
            <div class="text-xs text-zinc-500">${acc.currency}</div>
          </div>
          <!-- Toggle switch -->
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" class="sr-only peer" id="accToggle_${acc.id}"
                   ${current ? 'checked' : ''}
                   onchange="window.__app.toggleAccountPerm('${acc.id}', this.checked)">
            <div class="w-9 h-5 bg-zinc-200 dark:bg-zinc-700 rounded-full peer
                        peer-checked:bg-zinc-900 dark:peer-checked:bg-white transition-colors"></div>
            <div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white dark:bg-zinc-900 rounded-full shadow
                        transition-transform peer-checked:translate-x-4"></div>
          </label>
        </div>

        <!-- Access level picker (visible when toggled on) -->
        <div id="accLevels_${acc.id}" class="${current ? '' : 'hidden'}">
          <div class="grid grid-cols-2 gap-1.5">
            ${FAMILY_ACCESS_LEVELS.map((lvl) => {
              const sel = current === lvl.id;
              return `
              <label class="perm-lvl-label flex items-start gap-2 p-2 rounded-lg cursor-pointer border transition-colors
                            hover:bg-zinc-50 dark:hover:bg-zinc-800"
                     data-acc="${acc.id}" data-lvl="${lvl.id}" data-color="${lvl.color}"
                     style="${sel ? `color:${lvl.color};border-color:${lvl.color}` : 'border-color:#e4e4e7'}"
                     onclick="window.__app.updatePermLevel('${acc.id}', '${lvl.id}')">
                <input type="radio" name="perm_${acc.id}" value="${lvl.id}"
                       class="sr-only"
                       ${sel ? 'checked' : ''}>
                <i data-lucide="${lvl.icon}"
                   style="width:13px;height:13px;margin-top:2px;flex-shrink:0;color:${lvl.color}"></i>
                <div>
                  <div class="text-xs font-medium">${lvl.label}</div>
                  <div class="text-xs text-zinc-500 leading-tight">${lvl.desc}</div>
                </div>
              </label>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  }

  #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
