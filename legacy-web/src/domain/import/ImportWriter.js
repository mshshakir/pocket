/**
 * ImportWriter — saves an ImportDraft into the book, and takes it out again
 * ("Undo this import").
 *
 * Everything written carries the import's id (`importId`, kept in each row's
 * `extra` on the server), and the book keeps a short record of each import in
 * `state.imports` (synced as top-level book data). Undo removes the entries
 * and budgets with that id, then the accounts and categories the import made
 * that nothing else uses. Nothing of the person's own is touched.
 */
import { IdGenerator } from '../services/IdGenerator.js';
import { RATES } from '../services/FxRates.js';
import { BudgetService } from '../services/BudgetService.js';
import { ACCOUNT_TYPE_ICONS } from '../../data/constants.js';

export class ImportWriter {
  static #TYPE_WORDS = Object.freeze({
    card: ['credit', 'card', 'visa', 'mastercard', 'amex', 'rupay'],
    cash: ['cash', 'wallet', 'paytm', 'phonepe', 'gpay', 'google pay', 'upi', 'petty'],
    savings: ['savings', 'saving', 'fd', 'deposit', 'emergency'],
  });

  #state;
  #fx;
  #hijri;
  #look;

  /**
   * @param {object} deps
   * @param {object} deps.state  the book (mutated)
   * @param {object} deps.fx     CurrencyService (toMinor, convert)
   * @param {object} deps.hijri  HijriCalendarService (toHijri)
   * @param {(name: string, type: string) => {icon: string, color: string}} deps.look  a new category's icon and colour
   */
  constructor({ state, fx, hijri, look }) {
    this.#state = state;
    this.#fx = fx;
    this.#hijri = hijri;
    this.#look = look;
  }

  /**
   * @param {import('./ImportDraft.js').ImportDraft} draft
   * @param {{file: string, now?: string}} info
   * @returns {{id: string, entries: number, budgets: number, accounts: number, categories: number}}
   */
  write(draft, { file, now = new Date().toISOString() }) {
    const s = this.#state;
    s.accounts ??= []; s.categories ??= []; s.transactions ??= []; s.budgets ??= [];
    const id = IdGenerator.generate('imp');
    const made = { accounts: 0, categories: 0 };
    const accountId = (name) => this.#accountFor(name, id, made);
    const categoryId = (main, sub, type) => this.#categoryFor(main, sub, type, id, made);

    let entries = 0;
    for (const e of draft.entries) {
      const from = accountId(e.account);
      if (e.type === 'transfer') {
        const to = accountId(e.to);
        const outId = IdGenerator.generate('tx'), inId = IdGenerator.generate('tx');
        s.transactions.push(this.#tx(e, from, null, id, now, { id: outId, transferPairId: inId, transferDir: 'out' }));
        s.transactions.push(this.#tx(e, to, null, id, now, { id: inId, transferPairId: outId, transferDir: 'in' }));
      } else {
        s.transactions.push(this.#tx(e, from, categoryId(e.main, e.sub, e.type), id, now, {}));
      }
      entries++;
    }

    let budgets = 0;
    for (const b of draft.budgets) {
      const cat = categoryId(b.main, b.sub, 'expense');
      if (!cat) continue;
      s.budgets.push({
        id: IdGenerator.generate('bg'), categoryIds: [cat], categoryId: cat,
        amount: this.#fx.toMinor(b.amount, b.currency), currency: b.currency,
        ...BudgetService.periodFields({ period: b.period === 'month' ? 'gregorian' : b.period }),
        alerts: true, importId: id,
      });
      budgets++;
    }

    s.imports = [...(Array.isArray(s.imports) ? s.imports : []), {
      id, at: now, file: String(file || '').slice(0, 120), entries, budgets, accounts: made.accounts, categories: made.categories,
    }];
    return { id, entries, budgets, accounts: made.accounts, categories: made.categories };
  }

  /**
   * Takes an import out of the book.
   * @returns {{entries: number, budgets: number, accounts: number, categories: number}|null} null when unknown
   */
  undo(importId) {
    const s = this.#state;
    const rec = (s.imports || []).find((r) => r.id === importId);
    if (!rec) return null;
    const mine = (x) => x?.importId === importId;
    const before = (s.transactions || []).length;
    s.transactions = (s.transactions || []).filter((t) => !mine(t));
    const entryRows = before - s.transactions.length;
    const budgetsBefore = (s.budgets || []).length;
    s.budgets = (s.budgets || []).filter((b) => !mine(b));

    const usedAcc = new Set(s.transactions.map((t) => t.accountId));
    const accBefore = s.accounts.length;
    s.accounts = s.accounts.filter((a) => !mine(a) || usedAcc.has(a.id));

    const usedCat = new Set([
      ...s.transactions.map((t) => t.categoryId),
      ...s.transactions.flatMap((t) => (t.splits || []).map((x) => x.categoryId)),
      ...(s.budgets || []).flatMap((b) => b.categoryIds || [b.categoryId]),
    ]);
    const catBefore = s.categories.length;
    // Subcategories first, so a main made by the import goes once its subs have.
    s.categories = s.categories.filter((c) => !(mine(c) && c.parentId && !usedCat.has(c.id)));
    const parents = new Set(s.categories.map((c) => c.parentId).filter(Boolean));
    s.categories = s.categories.filter((c) => !(mine(c) && !c.parentId && !usedCat.has(c.id) && !parents.has(c.id)));

    s.imports = s.imports.filter((r) => r.id !== importId);
    return {
      entries: rec.entries ?? entryRows,
      budgets: budgetsBefore - s.budgets.length,
      accounts: accBefore - s.accounts.length,
      categories: catBefore - s.categories.length,
    };
  }

  // ── rows ─────────────────────────────────────────────────────────────

  #tx(e, accountId, categoryId, importId, now, extra) {
    const home = this.#state.user?.homeCurrency || e.currency;
    const minor = this.#fx.toMinor(e.amount, e.currency);
    return {
      id: IdGenerator.generate('tx'), accountId, categoryId, amount: minor, currency: e.currency,
      exchangeRate: (RATES[e.currency] || 1) / (RATES[home] || 1),
      refAmount: this.#fx.convert(minor, e.currency, home),
      payee: e.payee || '', note: e.note || '', date: e.date, hijriDate: this.#hijri.toHijri(e.date),
      recordState: 'cleared', type: e.type, transferPairId: null, tags: [], splits: null,
      createdAt: now, addedBy: null, importId,
      ...extra,
    };
  }

  #accountFor(name, importId, made) {
    const s = this.#state;
    const norm = String(name || '').trim().toLowerCase();
    const have = s.accounts.find((a) => !a.archived && a.name.trim().toLowerCase() === norm)
      || s.accounts.find((a) => a.name.trim().toLowerCase() === norm);
    if (have) return have.id;
    const type = ImportWriter.accountType(name);
    const acc = {
      id: IdGenerator.generate('acc'), name: String(name).trim().slice(0, 60), type,
      currency: s.user?.homeCurrency || 'INR', openingBalance: 0, balance: 0,
      color: this.#look(name, 'expense').color, icon: ACCOUNT_TYPE_ICONS[type] || 'wallet',
      archived: false, groupId: null, importId,
    };
    s.accounts.push(acc);
    made.accounts++;
    return acc.id;
  }

  #categoryFor(main, sub, type, importId, made) {
    if (!main) return null;
    const s = this.#state;
    const norm = (x) => String(x || '').trim().toLowerCase();
    let parent = s.categories.find((c) => !c.parentId && norm(c.name) === norm(main) && c.type === type)
      || s.categories.find((c) => !c.parentId && norm(c.name) === norm(main));
    if (!parent) {
      parent = { id: IdGenerator.generate('cat'), name: main, type, parentId: null, budgetLimit: null, ...this.#look(main, type), importId };
      s.categories.push(parent);
      made.categories++;
    }
    if (!sub) return parent.id;
    let child = s.categories.find((c) => c.parentId === parent.id && norm(c.name) === norm(sub));
    if (!child) {
      child = { id: IdGenerator.generate('cat'), name: sub, type: parent.type, parentId: parent.id, budgetLimit: null, ...this.#look(sub, parent.type), importId };
      s.categories.push(child);
      made.categories++;
    }
    return child.id;
  }

  /** bank, card, cash or savings from an account's name. */
  static accountType(name) {
    const n = String(name || '').toLowerCase();
    for (const [type, words] of Object.entries(ImportWriter.#TYPE_WORDS)) {
      if (words.some((w) => n.includes(w))) return type;
    }
    return 'bank';
  }
}
