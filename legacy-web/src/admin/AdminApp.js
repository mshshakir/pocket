/**
 * AdminApp — admin.html: signs the admin in, checks they are an admin (the
 * database decides), shows the tabs, and routes clicks and form submits to
 * the tab on screen. Tabs are addressed by the URL hash (#users, #programme…).
 */
import { AdminApi } from './AdminApi.js';
import { Format } from './Format.js';
import { OverviewView } from './views/OverviewView.js';
import { UsersView } from './views/UsersView.js';
import { PaymentsView } from './views/PaymentsView.js';
import { PricingView } from './views/PricingView.js';
import { ProgrammeView } from './views/ProgrammeView.js';
import { AuditView } from './views/AuditView.js';

export class AdminApp {
  static #TABS = [
    ['overview', OverviewView, 'layout-dashboard'],
    ['users', UsersView, 'users'],
    ['payments', PaymentsView, 'receipt-indian-rupee'],
    ['pricing', PricingView, 'tags'],
    ['programme', ProgrammeView, 'sprout'],
    ['audit', AuditView, 'history'],
  ];

  #session;
  #api;
  #root;
  #views = new Map();
  #current = 'overview';
  #user = null;
  #busy = false;

  /**
   * @param {import('../web/PocketSession.js').PocketSession} session
   * @param {HTMLElement} root
   */
  constructor(session, root) {
    this.#session = session;
    this.#api = new AdminApi(session);
    this.#root = root;
    const host = { toast: (m, bad) => this.#toast(m, bad), refresh: () => this.#show(this.#current, true) };
    for (const [key, View] of AdminApp.#TABS) this.#views.set(key, new View(this.#api, host));
    root.addEventListener('click', (e) => this.#onClick(e));
    root.addEventListener('submit', (e) => this.#onSubmit(e));
    window.addEventListener('hashchange', () => this.#show(this.#hashTab()));
  }

  async start() {
    this.#user = await this.#session.user();
    if (!this.#user) return this.#gate('Sign in with your admin Google account.', true);
    const admin = await this.#api.isAdmin().catch(() => false);
    if (!admin) return this.#gate(`${Format.esc(this.#user.email)} isn't an admin.`, true, true);
    this.#shell();
    await this.#show(this.#hashTab());
  }

  #hashTab() {
    const key = window.location.hash.slice(1);
    return this.#views.has(key) ? key : 'overview';
  }

  // ── screens ─────────────────────────────────────────────────────────

  #gate(text, signIn, signedIn = false) {
    this.#root.innerHTML = `
      <div class="gate">
        <div class="logo">P</div>
        <h1>Pocket admin</h1>
        <p class="muted">${text}</p>
        ${signedIn ? '<button data-action="sign-out" class="btn btn-soft">Sign out</button>' : ''}
        ${signIn && !signedIn ? '<button data-action="sign-in" class="btn">Sign in with Google</button>' : ''}
      </div>`;
  }

  #shell() {
    const nav = AdminApp.#TABS.map(([key, , icon]) =>
      `<a href="#${key}" class="nav-item" data-tab="${key}"><i data-lucide="${icon}"></i><span>${this.#views.get(key).title}</span></a>`).join('');
    this.#root.innerHTML = `
      <aside class="side">
        <div class="brand"><div class="logo">P</div><div><div class="strong">Pocket</div><div class="sub">Admin</div></div></div>
        <nav>${nav}</nav>
        <div class="side-foot"><div class="sub">${Format.esc(this.#user.email)}</div>
          <button data-action="sign-out" class="link">Sign out</button> · <a href="app.html" class="link">Open app</a></div>
      </aside>
      <main class="main">
        <header class="top"><h1 id="viewTitle"></h1><button data-action="reload" class="btn btn-soft btn-sm"><i data-lucide="refresh-cw"></i> Refresh</button></header>
        <section id="view"></section>
      </main>
      <div id="toast" class="toast" hidden></div>`;
  }

  async #show(key, reload = false) {
    const view = this.#views.get(key);
    const first = this.#current !== key || reload || !view.loaded;
    this.#current = key;
    this.#root.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('on', a.dataset.tab === key));
    const title = this.#root.querySelector('#viewTitle');
    if (title) title.textContent = view.title;
    if (first) {
      this.#paint('<p class="muted">Loading…</p>');
      try {
        await view.load();
        view.loaded = true;
      } catch (e) {
        this.#paint(`<div class="notice bad">Couldn't load: ${Format.esc(e.message)}</div>`);
        return;
      }
    }
    this.#paint(view.html());
  }

  #paint(html) {
    const el = this.#root.querySelector('#view');
    if (!el) return;
    el.innerHTML = html;
    globalThis.lucide?.createIcons?.();
  }

  // ── events ──────────────────────────────────────────────────────────

  async #onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'FORM') return;
    const action = el.dataset.action;
    if (action === 'sign-in') return void this.#session.signIn().catch((err) => this.#toast(err.message, true));
    if (action === 'sign-out') { await this.#session.signOut(); window.location.reload(); return; }
    if (action === 'reload') return void this.#show(this.#current, true);
    if (el.tagName === 'A') e.preventDefault();
    await this.#act(action, el, null);
  }

  async #onSubmit(e) {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    await this.#act(form.dataset.form, form, new FormData(form));
  }

  async #act(action, el, form) {
    if (this.#busy) return;
    this.#busy = true;
    this.#root.classList.add('busy');
    try {
      const redraw = await this.#views.get(this.#current).act(action, el, form);
      if (redraw) this.#paint(this.#views.get(this.#current).html());
    } catch (err) {
      this.#toast(err?.message || 'That didn\'t work', true);
    } finally {
      this.#busy = false;
      this.#root.classList.remove('busy');
    }
  }

  #toast(message, bad = false) {
    const t = this.#root.querySelector('#toast');
    if (!t) return;
    t.textContent = message;
    t.className = `toast ${bad ? 'bad' : ''}`;
    t.hidden = false;
    clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3000);
  }

  #toastTimer = 0;
}
