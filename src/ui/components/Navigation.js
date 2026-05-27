/**
 * Navigation — Renders and manages sidebar + bottom tab navigation.
 *
 * Reacts to 'route:changed' events from the Router so the active
 * state stays in sync without coupling to any view.
 *
 * Responsible for:
 *  - Sidebar (desktop) nav items
 *  - Bottom tab bar (mobile)
 *  - Auth pill (user info / sign-in button)
 *  - Sync status indicator
 */
import { EventBus }  from '../../core/EventBus.js';
import { Router }    from '../../core/Router.js';
import { NAV_ITEMS, MOBILE_TABS } from '../../data/constants.js';

export class Navigation {
  /** @type {HTMLElement|null} */ #sidebar    = null;
  /** @type {HTMLElement|null} */ #bottomNav  = null;
  /** @type {HTMLElement|null} */ #authPill   = null;
  /** @type {EventBus} */         #bus;
  /** @type {Router} */           #router;

  /** Callbacks set by Application so navigation can trigger actions */
  #onNavigate = null;
  #onAdd      = null;
  #onMore     = null;
  #onSettings = null;
  #onToggleTheme = null;
  #onSignIn   = null;
  #onSignOut  = null;

  constructor() {
    this.#bus    = EventBus.getInstance();
    this.#router = Router.getInstance();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Connect DOM elements and attach event listeners.
   * @param {object} callbacks
   */
  mount(callbacks = {}) {
    this.#sidebar   = document.getElementById('sidebarNav');
    this.#bottomNav = document.getElementById('bottomNav');
    this.#authPill  = document.getElementById('authPill');

    this.#onNavigate    = callbacks.onNavigate    || (() => {});
    this.#onAdd         = callbacks.onAdd         || (() => {});
    this.#onMore        = callbacks.onMore        || (() => {});
    this.#onSettings    = callbacks.onSettings    || (() => {});
    this.#onToggleTheme = callbacks.onToggleTheme || (() => {});
    this.#onSignIn      = callbacks.onSignIn      || (() => {});
    this.#onSignOut     = callbacks.onSignOut     || (() => {});

    // Re-render nav whenever the route changes
    this.#bus.on('route:changed', () => this.render());

    // Update auth pill when auth state changes
    this.#bus.on('sync:user',   ({ user })   => this.renderAuthPill(user));
    this.#bus.on('sync:status', ({ status }) => this.updateSyncIndicator(status));

    this.render();
    // Show sign-in button immediately — will be replaced once auth resolves
    this.renderAuthPill(null);
  }

  // ── Rendering ────────────────────────────────────────────────────────

  render() {
    const current = this.#router.current;
    if (this.#sidebar)  this.#sidebar.innerHTML  = this.#renderSidebar(current);
    if (this.#bottomNav) this.#bottomNav.innerHTML = this.#renderBottomTabs(current);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // Sub-routes that should light up a parent nav item
  static #ALIAS = { accountDetail: 'accounts' };

  #renderSidebar(current) {
    const active = Navigation.#ALIAS[current] ?? current;
    return NAV_ITEMS
      .map((n) => `
        <a class="nav-item ${active === n.id ? 'active' : ''}"
           onclick="window.__app.navigate('${n.id}')">
          <i data-lucide="${n.icon}"></i> ${n.label}
        </a>`)
      .join('');
  }

  #renderBottomTabs(current) {
    const active = Navigation.#ALIAS[current] ?? current;
    return MOBILE_TABS
      .map((n) => `
        <a class="tab-item ${active === n.id ? 'active' : ''}"
           onclick="window.__app.navigate('${n.id}')">
          <i data-lucide="${n.icon}" style="width:22px;height:22px"></i>
          <span>${n.label}</span>
        </a>`)
      .join('');
  }

  /**
   * Render the auth pill in the sidebar.
   * @param {object|null} user  Supabase user object, or null
   */
  renderAuthPill(user) {
    if (!this.#authPill) return;

    if (user) {
      const initial = (user.email?.[0] || '?').toUpperCase();
      this.#authPill.innerHTML = `
        <div class="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800">
          <div class="w-6 h-6 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 grid place-items-center text-xs font-bold flex-shrink-0">
            ${initial}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium truncate">${this.#esc(user.email || '')}</div>
            <div id="syncIndicator" class="flex items-center gap-1 mt-0.5"></div>
          </div>
          <button onclick="window.__app.signOut()" title="Sign out"
                  class="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            <i data-lucide="log-out" style="width:14px;height:14px"></i>
          </button>
        </div>`;
    } else {
      this.#authPill.innerHTML = `
        <button onclick="window.__app.openModal('auth')"
                class="nav-item w-full justify-center gap-2 border border-zinc-200 dark:border-zinc-800">
          <i data-lucide="cloud" style="width:15px;height:15px"></i>
          <span class="text-sm">Sign in / Sign up</span>
        </button>`;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  /**
   * Update the sync status badge inside the auth pill.
   * @param {'local'|'syncing'|'synced'|'error'} status
   */
  updateSyncIndicator(status) {
    const el = document.getElementById('syncIndicator');
    if (!el) return;
    const MAP = {
      local:   { icon: 'hard-drive',  color: '#71717a', label: 'Local only' },
      syncing: { icon: 'loader',      color: '#3b82f6', label: 'Syncing…'   },
      synced:  { icon: 'cloud-check', color: '#10b981', label: 'Synced'     },
      error:   { icon: 'cloud-off',   color: '#ef4444', label: 'Sync error' },
    };
    const s = MAP[status] || MAP.local;
    el.innerHTML = `
      <i data-lucide="${s.icon}" style="width:13px;height:13px;color:${s.color}"></i>
      <span style="color:${s.color};font-size:11px">${s.label}</span>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  #esc(s) {
    return (s || '').replace(/[&<>"']/g, (m) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
