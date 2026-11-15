/**
 * DemoMode — the app opened with the sample book, for looking around.
 *
 * app.html?demo           opens the sample on the Dashboard
 * app.html?demo=budgets   opens it on a screen (any menu page, or bills,
 *                         deliveries, shortcuts, habits)
 *
 * In demo mode nothing is read from or written to this device's saved book:
 * the Repository keeps the book in memory only (a fresh sample on every
 * load), cloud sync never starts, and sign-in leaves the demo for the real
 * app. So a returning user's own book can't be touched or replaced.
 */
export class DemoMode {
  /** Screens a link can open: menu pages, plus tabs inside two of them. */
  static #TABS = Object.freeze({
    bills: ['calendar', 'bills'], deliveries: ['calendar', 'deliveries'], shortcuts: ['calendar', 'shortcuts'],
    calendar: ['calendar', 'grid'], habits: ['reports', 'habits'], reports: ['reports', 'overview'],
  });
  static #PAGES = Object.freeze(['dashboard', 'transactions', 'accounts', 'budgets', 'debts', 'investments', 'categories']);

  /** @type {Map<string, string>} */ static #memory = new Map();

  static get active() {
    try { return new URLSearchParams(globalThis.location?.search || '').has('demo'); } catch (_) { return false; }
  }

  /** The screen the link asked for: { page, tab? } or null. */
  static get start() {
    let want = '';
    try { want = (new URLSearchParams(globalThis.location?.search || '').get('demo') || '').toLowerCase().trim(); } catch (_) { /* none */ }
    if (DemoMode.#TABS[want]) return { page: DemoMode.#TABS[want][0], tab: DemoMode.#TABS[want][1] };
    return DemoMode.#PAGES.includes(want) ? { page: want, tab: null } : null;
  }

  /**
   * A localStorage stand-in that forgets everything when the page closes —
   * what Repository uses in demo mode.
   */
  static get storage() {
    const m = DemoMode.#memory;
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => { m.delete(k); },
    };
  }

  /** The real app (leaving the demo), optionally with a hash such as #signin. */
  static exitUrl(hash = '') {
    const path = globalThis.location?.pathname || 'app.html';
    return `${path}${hash}`;
  }

  /** The strip shown above every page in the demo. */
  static bannerHtml() {
    return `
      <div class="demo-banner mb-4 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3"
           style="background:linear-gradient(90deg,#10b98118,#0ea5e918);border:1px solid #10b98140">
        <i data-lucide="sparkles" style="width:18px;height:18px;color:#10b981"></i>
        <div class="flex-1 min-w-[12rem] text-sm">
          <b>You're looking at sample data.</b>
          <span class="text-zinc-500">Tap around — nothing you change here is saved.</span>
        </div>
        <a class="btn btn-primary btn-sm" href="${DemoMode.exitUrl('#signin')}">Start my own book</a>
      </div>`;
  }
}
