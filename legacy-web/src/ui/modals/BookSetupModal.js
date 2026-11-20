import { CURRENCIES } from '../../data/constants.js';
import { StarterCategories } from '../../data/StarterCategories.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';
import { BookCleaner } from '../../domain/services/BookCleaner.js';
import { BookSetup } from '../../domain/services/BookSetup.js';
import { Html } from '../../core/Html.js';

/**
 * BookSetupModal — first sign-in: sets up the person's book with them
 * (owner, 20 Nov 2026). One question per screen, everything skippable:
 *
 *   currency    home currency
 *   sample      set up my own book, or keep the sample for now (only when the
 *               book still holds the sample)
 *   accounts    how many of each kind (bank, card, cash, wallet, savings)
 *   names       a name for each, and an optional starting balance
 *   life        a few taps about their life and income, and "anything else?"
 *   categories  the ready-made list (StarterCategories), ticked from those
 *               answers; untick, add your own; "anything else" adds AI
 *               suggestions (marked ✨) — free, within the daily allowance
 *   calendar    the Hijri calendar: install it or not (an add-on in Settings)
 *
 * Nothing is written until "Set up my book" (BookSetup). Keeping the sample,
 * or a book that already has the person's own entries, skips straight to the
 * calendar.
 *
 * Every control calls window.__app.setupAction(action, …args); act() changes
 * this modal's state and returns false when no re-draw is wanted (typing).
 */
export class BookSetupModal {
  static #LABELS = Object.freeze({
    currency: 'Currency', sample: 'Start', accounts: 'Accounts', names: 'Names',
    life: 'About you', categories: 'Categories', calendar: 'Calendar',
  });
  static #MAX_PER_KIND = 10;

  #store;
  #hooks;
  #hijri;
  /** @type {string[]} */ #steps = [];
  #index = 0;
  #counts = {};
  /** @type {{kind:string, name:string, balance:string}[]} */ #accounts = [];
  #life = new Set();
  #income = new Set();
  #notes = '';
  /** @type {ReturnType<typeof StarterCategories.plan>|null} */ #plan = null;
  #useHijri = null;
  #busy = '';
  #note = '';

  /**
   * @param {object} deps
   * @param {object} deps.store
   * @param {object} deps.hooks  { clearSample(), suggest(prompt) → Promise<string>, finish(plan) }
   */
  constructor({ store, hooks }) {
    this.#store = store;
    this.#hooks = hooks;
    this.#hijri = new HijriCalendarService();
  }

  /** Start again each time it opens. */
  onOpen() {
    const state = this.#store.getState();
    const sample = BookCleaner.hasSample(state);
    const fresh = BookSetup.isFresh(state);
    this.#steps = sample ? ['currency', 'sample', 'accounts', 'names', 'life', 'categories', 'calendar']
      : fresh ? ['currency', 'accounts', 'names', 'life', 'categories', 'calendar']
        : ['currency', 'calendar'];
    this.#index = 0;
    this.#counts = { bank: 1, card: 0, cash: 1, wallet: 0, savings: 0 };
    this.#accounts = [];
    this.#life = new Set();
    this.#income = new Set(['salary']);
    this.#notes = '';
    this.#plan = null;
    this.#useHijri = state.user?.showHijri ?? null;
    this.#busy = '';
    this.#note = '';
  }

  get step() { return this.#steps[this.#index]; }

  /** Moves on one step (kept for callers of the old onboarding). */
  advance() { this.#go(1); }

  render() {
    const body = {
      currency: () => this.#currency(), sample: () => this.#sample(), accounts: () => this.#accountsStep(),
      names: () => this.#names(), life: () => this.#lifeStep(), categories: () => this.#categories(), calendar: () => this.#calendar(),
    }[this.step] ?? (() => this.#currency());
    return `<div class="p-6 setup" style="min-width:300px;max-width:460px">${this.#indicator()}${body()}</div>`;
  }

  /**
   * One control was used. Returns false when the screen needn't be drawn
   * again (typing into a box), a Promise when it is working (AI suggestions).
   */
  act(action, a, b) {
    const state = this.#store.getState();
    switch (action) {
      case 'currency': state.user.homeCurrency = String(a); this.#store.persist(); return false;
      case 'next': return this.#next();
      case 'back': this.#go(-1); return true;
      case 'clean': this.#hooks.clearSample(); this.#go(1); return true;
      case 'keep': this.#steps = ['currency', 'sample', 'calendar']; this.#go(1); return true;
      case 'count': {
        const n = (this.#counts[a] || 0) + Number(b);
        this.#counts[a] = Math.max(0, Math.min(BookSetupModal.#MAX_PER_KIND, n));
        return true;
      }
      case 'name': if (this.#accounts[a]) this.#accounts[a].name = String(b); return false;
      case 'balance': if (this.#accounts[a]) this.#accounts[a].balance = String(b); return false;
      case 'life': BookSetupModal.#toggle(this.#life, a); return true;
      case 'income': BookSetupModal.#toggle(this.#income, a); return true;
      case 'notes': this.#notes = String(a).slice(0, 500); return false;
      case 'main': { const m = this.#plan?.[a]; if (m) m.on = !m.on; return true; }
      case 'sub': { const s = this.#plan?.[a]?.subs[b]; if (s) s.on = !s.on; return true; }
      case 'addsub': {
        const m = this.#plan?.[a];
        const name = String(b || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!m || !name || m.subs.some((s) => s.name.toLowerCase() === name.toLowerCase())) return true;
        m.subs.push({ name, on: true });
        m.on = true;
        return true;
      }
      case 'addmain': {
        const name = String(a || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!name || this.#plan?.some((m) => m.name.toLowerCase() === name.toLowerCase())) return true;
        this.#plan?.push({ key: `own${this.#plan.length}`, name, type: 'expense', icon: 'tag', color: '#737373', on: true, subs: [{ name: 'General', on: true }] });
        return true;
      }
      case 'hijri': this.#useHijri = !!a; return true;
      case 'finish': return this.#finish();
      default: return true;
    }
  }

  // ── moving between steps ──────────────────────────────────────────────

  #go(by) {
    this.#index = Math.max(0, Math.min(this.#steps.length - 1, this.#index + by));
    this.#note = '';
  }

  #next() {
    if (this.step === 'accounts') this.#makeAccountRows();
    if (this.step === 'life') return this.#buildPlan();
    this.#go(1);
    return true;
  }

  /** Rows for the names screen: as many per kind as counted, keeping what was typed. */
  #makeAccountRows() {
    const old = this.#accounts;
    const rows = [];
    for (const k of BookSetup.KINDS) {
      const had = old.filter((r) => r.kind === k.key);
      for (let i = 0; i < (this.#counts[k.key] || 0); i++) rows.push(had[i] ?? { kind: k.key, name: '', balance: '' });
    }
    this.#accounts = rows;
  }

  /** The ticked list from the answers, plus AI suggestions for "anything else". */
  async #buildPlan() {
    this.#plan = StarterCategories.plan([...this.#life, ...this.#income]);
    const notes = this.#notes.trim();
    if (notes) {
      this.#busy = 'Working out categories for you…';
      window.__app?.refreshSetup?.();
      try {
        const text = await this.#hooks.suggest(this.#prompt(notes));
        this.#addSuggestions(text);
      } catch (e) {
        this.#note = `Couldn't get suggestions (${e?.message || 'AI unavailable'}). Add your own below.`;
      }
      this.#busy = '';
    }
    this.#index++;
    return true;
  }

  #prompt(notes) {
    const list = this.#plan.map((m) => `${m.name} (${m.type === 'income' ? 'money received' : 'spending'}): ${m.subs.map((s) => s.name).join(', ')}`).join('\n');
    return `You help someone set up categories in Pocket, a money tracker. They wrote what else they spend on or receive money from.
Suggest at most 8 short subcategory names (1–3 words, Title Case) that are NOT already in the list, each under the best existing main category, or under a new main category only if none fits.
Reply with ONLY JSON: {"add":[{"main":"Food","sub":"Tiffin service","type":"expense"}]}

EXISTING:
${list}

THEY WROTE: ${notes}`;
  }

  #addSuggestions(text) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) return;
    let obj;
    try { obj = JSON.parse(m[0]); } catch (_) { return; }
    const clean = (s) => String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    for (const item of (Array.isArray(obj?.add) ? obj.add : []).slice(0, 8)) {
      const sub = clean(item?.sub), mainName = clean(item?.main);
      if (!sub || !mainName) continue;
      const type = item?.type === 'income' ? 'income' : 'expense';
      let main = this.#plan.find((x) => x.name.toLowerCase() === mainName.toLowerCase() && x.type === type);
      if (!main) {
        main = { key: `ai${this.#plan.length}`, name: mainName, type, icon: 'tag', color: '#737373', on: true, subs: [] };
        this.#plan.push(main);
      }
      if (main.subs.some((s) => s.name.toLowerCase() === sub.toLowerCase())) continue;
      main.subs.push({ name: sub, on: true, ai: true });
      main.on = true;
    }
  }

  #finish() {
    const plan = {
      hijri: !!this.#useHijri,
      accounts: this.#steps.includes('names') ? this.#accounts.map((r) => ({
        kind: r.kind, name: r.name || (BookSetup.KINDS.find((k) => k.key === r.kind)?.one ?? 'Account'),
        balance: Number(String(r.balance).replace(/,/g, '')) || 0,
      })) : [],
      categories: this.#steps.includes('categories') && this.#plan
        ? this.#plan.filter((m) => m.on && m.subs.some((s) => s.on))
          .map((m) => ({ name: m.name, type: m.type, icon: m.icon, color: m.color, subs: m.subs.filter((s) => s.on).map((s) => s.name) }))
        : [],
    };
    this.#hooks.finish(plan);
    return false;
  }

  // ── screens ───────────────────────────────────────────────────────────

  #indicator() {
    const n = this.#steps.length, i = this.#index;
    return `<div class="flex items-center justify-between mb-4 text-xs text-zinc-500">
      <span>${BookSetupModal.#LABELS[this.step] ?? ''}</span><span>Step ${i + 1} of ${n}</span></div>
      <div class="h-1 rounded-full bg-zinc-100 dark:bg-zinc-800 mb-5"><div class="h-1 rounded-full bg-zinc-900 dark:bg-white" style="width:${Math.round(((i + 1) / n) * 100)}%"></div></div>`;
  }

  #nav({ next = 'Next', back = true, action = 'next' } = {}) {
    return `<div class="flex gap-2 mt-5">
      ${back && this.#index > 0 ? `<button class="btn btn-outline" onclick="window.__app.setupAction('back')"><i data-lucide="arrow-left"></i></button>` : ''}
      <button class="btn btn-primary flex-1 justify-center setup-next" onclick="window.__app.setupAction('${action}')" ${this.#busy ? 'disabled' : ''}>${next} <i data-lucide="arrow-right"></i></button>
    </div>`;
  }

  #currency() {
    const cur = this.#store.getState().user?.homeCurrency || 'USD';
    const options = CURRENCIES.map((c) => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('');
    return `
      <div class="w-12 h-12 rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 grid place-items-center text-xl font-bold mb-4">P</div>
      <h2 class="text-xl font-semibold mb-1">Welcome to Pocket!</h2>
      <p class="text-sm text-zinc-500 mb-5">A few quick questions and your book is ready. Everything can be changed later.</p>
      <label class="block text-sm font-medium mb-1">Your currency</label>
      <select id="setupCurrency" class="select" onchange="window.__app.setupAction('currency', this.value)">${options}</select>
      ${this.#nav({ back: false })}`;
  }

  #sample() {
    return `
      <h2 class="text-xl font-semibold mb-1">Set up your own book?</h2>
      <p class="text-sm text-zinc-500 mb-5">Pocket opened with a sample household so you could see what it does. Set up your own accounts and categories now, or keep looking around the sample.</p>
      <button class="btn btn-primary w-full justify-center mb-2" onclick="window.__app.setupAction('clean')"><i data-lucide="sparkles"></i> Set up my own book</button>
      <button class="btn btn-outline w-full justify-center" onclick="window.__app.setupAction('keep')">Keep the sample for now</button>
      <div class="text-xs text-zinc-400 text-center mt-3">The sample can be removed any time in Settings → Data</div>`;
  }

  #accountsStep() {
    const rows = BookSetup.KINDS.map((k) => {
      const n = this.#counts[k.key] || 0;
      return `<div class="flex items-center gap-3 py-2">
        <span class="icon-pill" style="background:${k.color}22;color:${k.color};width:34px;height:34px"><i data-lucide="${k.icon}" style="width:16px;height:16px"></i></span>
        <div class="flex-1 text-sm font-medium">${k.label}</div>
        <button class="btn btn-outline px-3" onclick="window.__app.setupAction('count','${k.key}',-1)" ${n <= 0 ? 'disabled' : ''} aria-label="Fewer">−</button>
        <div class="w-6 text-center font-semibold setup-count" data-kind="${k.key}">${n}</div>
        <button class="btn btn-outline px-3" onclick="window.__app.setupAction('count','${k.key}',1)" ${n >= BookSetupModal.#MAX_PER_KIND ? 'disabled' : ''} aria-label="More">+</button>
      </div>`;
    }).join('');
    const total = Object.values(this.#counts).reduce((s, n) => s + n, 0);
    return `
      <h2 class="text-xl font-semibold mb-1">Where does your money sit?</h2>
      <p class="text-sm text-zinc-500 mb-3">How many of each do you have? You'll name them next.</p>
      <div class="divide-y divide-zinc-100 dark:divide-zinc-800">${rows}</div>
      ${this.#nav({ next: total ? 'Next' : 'Skip' })}`;
  }

  #names() {
    if (!this.#accounts.length) {
      return `<h2 class="text-xl font-semibold mb-1">No accounts for now</h2>
        <p class="text-sm text-zinc-500">You can add them any time from Accounts.</p>${this.#nav()}`;
    }
    const ccy = this.#store.getState().user?.homeCurrency || '';
    const seen = {};
    const rows = this.#accounts.map((r, i) => {
      const k = BookSetup.KINDS.find((x) => x.key === r.kind) || BookSetup.KINDS[0];
      seen[k.key] = (seen[k.key] || 0) + 1;
      const many = (this.#counts[k.key] || 0) > 1;
      return `<div class="mb-3">
        <label class="text-xs text-zinc-500">${k.one}${many ? ` ${seen[k.key]}` : ''}</label>
        <div class="flex gap-2">
          <input class="input flex-1 setup-name" maxlength="60" placeholder="${Html.escape(k.hint)}" value="${Html.escape(r.name)}"
                 oninput="window.__app.setupAction('name',${i},this.value)">
          <input class="input setup-balance" style="width:7.5rem" inputmode="decimal" placeholder="Balance ${Html.escape(ccy)}" value="${Html.escape(r.balance)}"
                 oninput="window.__app.setupAction('balance',${i},this.value)">
        </div>
      </div>`;
    }).join('');
    return `
      <h2 class="text-xl font-semibold mb-1">Name your accounts</h2>
      <p class="text-sm text-zinc-500 mb-4">The balance is optional — what's in it today${this.#counts.card ? ' (for a card you owe on, put a minus, e.g. -5000)' : ''}.</p>
      ${rows}
      ${this.#nav()}`;
  }

  #lifeStep() {
    const chips = (list, set, action) => list.map(([k, label]) =>
      `<button type="button" class="setup-chip ${set.has(k) ? 'on' : ''}" aria-pressed="${set.has(k)}" onclick="window.__app.setupAction('${action}','${k}')">${set.has(k) ? '✓ ' : ''}${Html.escape(label)}</button>`).join('');
    return `
      <h2 class="text-xl font-semibold mb-1">A little about you</h2>
      <p class="text-sm text-zinc-500 mb-3">Tap what applies — it decides which categories you start with.</p>
      <div class="text-xs font-medium text-zinc-500 mb-2">Your spending</div>
      <div class="flex flex-wrap gap-2 mb-4">${chips(StarterCategories.LIFE, this.#life, 'life')}</div>
      <div class="text-xs font-medium text-zinc-500 mb-2">Money comes from</div>
      <div class="flex flex-wrap gap-2 mb-4">${chips(StarterCategories.INCOME, this.#income, 'income')}</div>
      <label class="text-xs font-medium text-zinc-500">Anything else you spend on? (optional)</label>
      <textarea class="input mt-1 setup-notes" rows="2" maxlength="500" placeholder="e.g. tiffin service, my sister's tuition, a maid"
                oninput="window.__app.setupAction('notes',this.value)">${Html.escape(this.#notes)}</textarea>
      <div class="text-[11px] text-zinc-400 mt-1">If you write something, it's sent to Google's AI to suggest categories. Nothing else is sent.</div>
      ${this.#busy ? `<div class="text-sm text-zinc-500 mt-3 flex items-center gap-2"><i data-lucide="loader-circle" class="animate-spin"></i> ${this.#busy}</div>` : ''}
      ${this.#nav()}`;
  }

  #categories() {
    const plan = this.#plan || [];
    const block = (m, i) => `
      <div class="setup-main py-2 ${m.on ? '' : 'opacity-60'}">
        <label class="flex items-center gap-2 font-medium text-sm">
          <input type="checkbox" ${m.on ? 'checked' : ''} onchange="window.__app.setupAction('main',${i})">
          <i data-lucide="${Html.icon(m.icon)}" style="width:15px;height:15px;color:${Html.color(m.color)}"></i> ${Html.escape(m.name)}
        </label>
        ${m.on ? `<div class="flex flex-wrap gap-1.5 mt-2 ml-6">
          ${m.subs.map((s, j) => `<button type="button" class="setup-chip sm ${s.on ? 'on' : ''}" aria-pressed="${s.on}" onclick="window.__app.setupAction('sub',${i},${j})">${s.on ? '✓ ' : ''}${s.ai ? '✨ ' : ''}${Html.escape(s.name)}</button>`).join('')}
          <span class="inline-flex items-center gap-1">
            <input id="setupAdd${i}" class="input setup-add" style="width:8.5rem;padding:.25rem .5rem;font-size:.8rem" maxlength="40" placeholder="+ Add your own"
                   onkeydown="if(event.key==='Enter'){window.__app.setupAction('addsub',${i},this.value)}">
            <button type="button" class="btn btn-ghost btn-sm" onclick="window.__app.setupAction('addsub',${i},document.getElementById('setupAdd${i}').value)" aria-label="Add">+</button>
          </span>
        </div>` : ''}
      </div>`;
    const spending = plan.map((m, i) => (m.type === 'expense' ? block(m, i) : '')).join('');
    const income = plan.map((m, i) => (m.type === 'income' ? block(m, i) : '')).join('');
    const ticked = plan.filter((m) => m.on).reduce((n, m) => n + m.subs.filter((s) => s.on).length, 0);
    return `
      <h2 class="text-xl font-semibold mb-1">Your categories</h2>
      <p class="text-sm text-zinc-500 mb-2">Ticked from your answers. Untick what you don't need, or add your own. ${ticked} chosen.</p>
      ${this.#note ? `<div class="text-xs text-amber-600 mb-2">${Html.escape(this.#note)}</div>` : ''}
      <div class="divide-y divide-zinc-100 dark:divide-zinc-800 setup-list" style="max-height:52vh;overflow:auto">
        ${spending}
        <div class="pt-3 text-xs font-medium text-zinc-500">Money received</div>
        ${income}
        <div class="py-3 flex gap-2">
          <input id="setupAddMain" class="input flex-1" maxlength="40" placeholder="+ A main category of your own (e.g. Car)"
                 onkeydown="if(event.key==='Enter'){window.__app.setupAction('addmain',this.value)}">
          <button type="button" class="btn btn-outline" onclick="window.__app.setupAction('addmain',document.getElementById('setupAddMain').value)">Add</button>
        </div>
      </div>
      ${this.#nav()}`;
  }

  #calendar() {
    const u = this.#store.getState().user || {};
    const offset = u.hijriOffset ?? 0;
    const yes = this.#useHijri === true, no = this.#useHijri === false;
    const calibrate = yes ? `
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-3 mt-4 text-center">
        <div class="text-xs text-zinc-500 mb-1">Today shows as</div>
        <div class="font-semibold">${this.#hijri.format(new Date(), { long: true })}</div>
        <div class="flex items-center justify-center gap-3 mt-2">
          <button class="btn btn-outline px-3" onclick="window.__app.adjustHijriOffset(-1)" ${offset <= -7 ? 'disabled' : ''}>−1 day</button>
          <span class="text-sm">${offset > 0 ? '+' : ''}${offset}</span>
          <button class="btn btn-outline px-3" onclick="window.__app.adjustHijriOffset(1)" ${offset >= 7 ? 'disabled' : ''}>+1 day</button>
        </div>
        <div class="text-[11px] text-zinc-400 mt-1">Adjust if your local moon sighting differs.</div>
      </div>` : '';
    const counts = this.#steps.includes('names') ? `${this.#accounts.length} account${this.#accounts.length === 1 ? '' : 's'}` : '';
    return `
      <h2 class="text-xl font-semibold mb-1">Do you use the Hijri calendar?</h2>
      <p class="text-sm text-zinc-500 mb-4">Pocket can show Hijri dates and miqaats beside every date, and budget by Hijri month. It's an add-on you can install or remove any time in Settings → Add-ons.</p>
      <div class="grid grid-cols-2 gap-2">
        <button class="btn ${yes ? 'btn-primary' : 'btn-outline'} justify-center setup-hijri-yes" onclick="window.__app.setupAction('hijri',true)"><i data-lucide="moon-star"></i> Yes, install it</button>
        <button class="btn ${no ? 'btn-primary' : 'btn-outline'} justify-center setup-hijri-no" onclick="window.__app.setupAction('hijri',false)">No thanks</button>
      </div>
      ${calibrate}
      ${this.#nav({ next: this.#steps.includes('categories') ? 'Set up my book' : 'Done — open Pocket', action: 'finish' }).replace('<i data-lucide="arrow-right"></i>', '<i data-lucide="check"></i>')}
      ${counts ? `<div class="text-xs text-zinc-400 text-center mt-2">${counts} and your chosen categories will be added.</div>` : ''}`;
  }

  static #toggle(set, key) {
    if (set.has(key)) set.delete(key); else set.add(key);
  }
}
