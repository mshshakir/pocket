/**
 * BookSetup — turns the answers from the setup screens into a book
 * (owner, 20 Nov 2026): the accounts the person named, the categories they
 * kept ticked, and whether the Hijri calendar is installed.
 *
 * Accounts are added as the app adds them (AccountService shape); a starting
 * balance becomes an "Opening balance" entry tagged `opening-balance`, exactly
 * as the account form records one.
 *
 * Categories: in a book with nothing of the person's own in it yet (only
 * sample records, or nothing), the chosen list REPLACES whatever categories
 * aren't in use, so a fresh book holds exactly what was ticked. Otherwise the
 * ticked ones are only added; nothing of theirs is removed.
 */
import { IdGenerator } from './IdGenerator.js';
import { RATES } from './FxRates.js';
import { BookCleaner } from './BookCleaner.js';

export class BookSetup {
  /** Account types offered in setup, in the app's ACCOUNT_TYPES ids. */
  static KINDS = Object.freeze([
    { key: 'bank',    type: 'bank',    label: 'Bank accounts', one: 'Bank',        icon: 'landmark',    color: '#3b82f6', hint: 'e.g. HDFC Savings' },
    { key: 'card',    type: 'card',    label: 'Credit cards',  one: 'Credit card', icon: 'credit-card', color: '#ef4444', hint: 'e.g. Amex' },
    { key: 'cash',    type: 'cash',    label: 'Cash',          one: 'Cash',        icon: 'wallet',      color: '#10b981', hint: 'e.g. Cash' },
    { key: 'wallet',  type: 'cash',    label: 'Wallets / UPI', one: 'Wallet',      icon: 'smartphone',  color: '#14b8a6', hint: 'e.g. Paytm' },
    { key: 'savings', type: 'savings', label: 'Savings',       one: 'Savings',     icon: 'vault',       color: '#8b5cf6', hint: 'e.g. Emergency savings' },
  ]);

  #state;
  #fx;
  #hijri;
  #today;

  /**
   * @param {object} deps
   * @param {object} deps.state  the real book state (mutated)
   * @param {object} deps.fx     CurrencyService (convert)
   * @param {object} deps.hijri  HijriCalendarService (toHijri)
   * @param {string} deps.today  YYYY-MM-DD
   */
  constructor({ state, fx, hijri, today }) {
    this.#state = state;
    this.#fx = fx;
    this.#hijri = hijri;
    this.#today = today;
  }

  /**
   * @param {object} plan
   * @param {{kind:string, name:string, balance?:number}[]} plan.accounts  balance in MAJOR units
   * @param {{name:string, type:string, icon:string, color:string, subs:string[]}[]} plan.categories  ticked mains with ticked subs
   * @param {boolean} plan.hijri  install the Hijri calendar
   * @returns {{accounts:number, categories:number}}
   */
  apply({ accounts = [], categories = [], hijri = false }) {
    const s = this.#state;
    s.accounts ??= []; s.categories ??= []; s.transactions ??= [];
    const fresh = BookSetup.isFresh(s);
    const madeAccounts = this.#addAccounts(accounts);
    const madeCategories = this.#setCategories(categories, fresh);
    s.user.showHijri = !!hijri;
    if (!hijri) s.user.calendarMode = 'gregorian';
    else if (!s.user.calendarMode || s.user.calendarMode === 'gregorian') s.user.calendarMode = 'both';
    if (madeAccounts.length && (!s.user.defaultAccountId || !s.accounts.some((a) => a.id === s.user.defaultAccountId && !a.archived))) {
      s.user.defaultAccountId = (madeAccounts.find((a) => a.type === 'bank') || madeAccounts[0]).id;
    }
    return { accounts: madeAccounts.length, categories: madeCategories };
  }

  /** Nothing of the person's own yet: only sample records, or none. */
  static isFresh(state) {
    const own = (list) => (list || []).some((x) => !BookCleaner.isSample(x));
    return !own(state.transactions);
  }

  #addAccounts(list) {
    const s = this.#state;
    const home = s.user.homeCurrency || 'INR';
    const taken = new Set(s.accounts.filter((a) => !a.archived).map((a) => a.name.trim().toLowerCase()));
    const made = [];
    for (const a of list) {
      const kind = BookSetup.KINDS.find((k) => k.key === a.kind) || BookSetup.KINDS[0];
      let name = String(a.name || '').replace(/\s+/g, ' ').trim().slice(0, 60) || kind.one;
      // Two left blank ("Bank", "Bank") become "Bank 1", "Bank 2".
      if (taken.has(name.toLowerCase())) {
        let n = 2;
        while (taken.has(`${name} ${n}`.toLowerCase())) n++;
        name = `${name} ${n}`;
      }
      taken.add(name.toLowerCase());
      const account = {
        id: IdGenerator.generate('acc'), name, type: kind.type, currency: home,
        openingBalance: 0, balance: 0, color: kind.color, icon: kind.icon, archived: false, groupId: null,
      };
      s.accounts.push(account);
      made.push(account);
      const minor = Math.round((Number(a.balance) || 0) * this.#fx.minorFactor(home));
      if (minor !== 0) {
        s.transactions.push({
          id: IdGenerator.generate('tx'), accountId: account.id, categoryId: null,
          amount: Math.abs(minor), currency: home,
          exchangeRate: (RATES[home] || 1) / (RATES[home] || 1), refAmount: Math.abs(minor),
          payee: 'Opening balance', note: '',
          date: this.#today, hijriDate: this.#hijri.toHijri(this.#today),
          paymentType: 'cash', recordState: 'cleared',
          type: minor > 0 ? 'income' : 'expense',
          transferPairId: null, splits: null, tags: ['opening-balance'],
        });
      }
    }
    return made;
  }

  /** @returns {number} how many categories were added */
  #setCategories(mains, fresh) {
    const s = this.#state;
    if (!mains.length) return 0;
    if (fresh) {
      // Keep only categories something still points at (sample entries are gone or
      // will be removed with the sample); the chosen list takes their place.
      const used = new Set();
      for (const t of s.transactions) {
        if (t.categoryId) used.add(t.categoryId);
        for (const p of t.splits || []) if (p.categoryId) used.add(p.categoryId);
      }
      for (const b of s.budgets || []) { if (b.categoryId) used.add(b.categoryId); for (const id of b.categoryIds || []) used.add(id); }
      for (const r of s.regularItems || []) if (r.categoryId) used.add(r.categoryId);
      const keep = s.categories.filter((c) => used.has(c.id) || s.categories.some((x) => x.parentId === c.id && used.has(x.id)) || c.type === 'transfer');
      s.categories.splice(0, s.categories.length, ...keep);
    }
    let added = 0;
    const key = (n) => String(n).trim().toLowerCase();
    for (const m of mains) {
      let main = s.categories.find((c) => !c.parentId && c.type === m.type && key(c.name) === key(m.name));
      if (!main) {
        main = { id: IdGenerator.generate('cat'), name: m.name, type: m.type, parentId: null, icon: m.icon || 'tag', color: m.color || '#737373', budgetLimit: null };
        s.categories.push(main);
        added++;
      }
      for (const subName of m.subs) {
        const name = String(subName).replace(/\s+/g, ' ').trim().slice(0, 40);
        if (!name) continue;
        if (s.categories.some((c) => c.parentId === main.id && key(c.name) === key(name))) continue;
        s.categories.push({ id: IdGenerator.generate('cat'), name, type: m.type, parentId: main.id, icon: main.icon, color: main.color, budgetLimit: null });
        added++;
      }
    }
    return added;
  }
}
