/**
 * ImportDraft — every row of the file as it would land in Pocket, from the
 * tables (TableFinder) and the AI's rules (ImportMapping). Nothing is written
 * here: this is what the preview shows and what ImportWriter saves.
 *
 * A row Pocket can't read with confidence is never guessed: it goes to
 * `attention` (no amount, impossible date, can't tell money in from out, a
 * transfer with one side missing) until the person fixes or skips it.
 * Entries already in the book (same date, account, type and amount) are left
 * out and counted as duplicates.
 */
import { CellValue } from './CellValue.js';

export class ImportDraft {
  /** @type {object[]} */ entries = [];
  /** @type {object[]} */ budgets = [];
  /** @type {object[]} */ attention = [];
  /** @type {{table: string, n: number, text: string}[]} */ skipped = [];
  duplicates = 0;
  /** @type {{name: string, existing: boolean}[]} */ accounts = [];
  /** @type {{main: string, sub: string, type: string, existing: boolean}[]} */ categories = [];

  #book;
  #mapping;
  #fixes;
  #home;

  /**
   * @param {object} p
   * @param {object[]} p.tables    TableFinder tables
   * @param {object}   p.mapping   ImportMapping
   * @param {object}   p.book      the book state (read only)
   * @param {Object<string, object>} [p.fixes]  attention key → {skip}|{amount}|{type}|{date}|{account}
   */
  constructor({ tables, mapping, book, fixes = {} }) {
    this.#book = book;
    this.#mapping = mapping;
    this.#fixes = fixes;
    this.#home = book.user?.homeCurrency || 'INR';
    const byId = new Map(tables.map((t) => [t.id, t]));
    for (const rule of mapping.tables) {
      const t = byId.get(rule.id);
      if (!t || rule.kind === 'skip') continue;
      const source = rule.sameAs ? byId.get(rule.sameAs) : t;
      const effective = rule.sameAs ? { ...(mapping.tables.find((x) => x.id === rule.sameAs) || rule), id: rule.id, kind: rule.kind } : rule;
      const rows = rule.sameAs ? [t.head, ...t.rows] : t.rows;
      for (const row of rows) this.#row(effective, source.columns, row);
      for (const s of t.skipped) this.skipped.push({ table: t.id, n: s.n, text: s.text });
    }
    this.#markDuplicates();
    this.#collectNames();
  }

  /** Counts for the preview. */
  get counts() {
    const n = (type) => this.entries.filter((e) => e.type === type).length;
    return {
      expenses: n('expense'), incomes: n('income'), transfers: n('transfer'), budgets: this.budgets.length,
      attention: this.attention.length, duplicates: this.duplicates, skipped: this.skipped.length,
      uncategorised: this.entries.filter((e) => e.type !== 'transfer' && !e.main).length,
    };
  }

  /** Details / payees with no category, most frequent first (for the AI and the preview). */
  uncategorisedTop(limit = 30) {
    const freq = new Map();
    for (const e of this.entries) {
      if (e.type === 'transfer' || e.main) continue;
      const k = (e.payee || e.note || '').trim();
      if (k) freq.set(k, (freq.get(k) || 0) + 1);
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }

  // ── one row ──────────────────────────────────────────────────────────

  #cell(columns, row, key, rule) {
    const name = rule.columns[key];
    if (!name) return '';
    const i = columns.indexOf(name);
    return i < 0 ? '' : String(row.cells[i] ?? '').trim();
  }

  #row(rule, columns, row) {
    const key = `${rule.id}:${row.n}`;
    const fix = this.#fixes[key] || {};
    if (fix.skip) return;
    const get = (k) => this.#cell(columns, row, k, rule);
    const base = { key, table: rule.id, n: row.n, text: row.cells.filter(Boolean).join(' · ').slice(0, 120) };
    if (rule.kind === 'budgets') return this.#budget(rule, get, base);

    const date = fix.date || CellValue.date(get('date'), rule.dateOrder);
    const money = this.#money(rule, get, fix);
    const payee = rule.kind === 'transfers' ? '' : get('payee');
    const note = get('note');
    const currency = (get('currency') || '').toUpperCase().match(/^[A-Z]{3}$/)?.[0] || this.#home;

    // A line with nothing that looks like an entry is ignored, not flagged.
    if (!get('date') && !money.value && !payee && !note) return;
    if (!date) return this.#flag(base, 'date', get('date') ? `“${get('date')}” isn't a real date.` : 'No date in this row.');
    if (!money.value) return this.#flag(base, 'amount', 'No amount in this row.');
    if (!money.type) return this.#flag(base, 'type', 'Can\'t tell if this is money in or out.', { payee, note, date, value: money.value });

    const account = this.#account(fix.account || get('account') || rule.account);
    if (money.type === 'transfer') {
      const to = this.#account(fix.to || get('to'));
      if (!account || !to || account === to) return this.#flag(base, 'account', 'A transfer needs both a from and a to account.');
      this.entries.push({ ...base, type: 'transfer', date, amount: money.value, currency, account, to, payee: '', note: note || payee });
      return;
    }
    const [main, sub] = this.#category(rule, get, payee, note, money.type);
    this.entries.push({ ...base, type: money.type, date, amount: money.value, currency, account: account || this.#defaultAccount(), main, sub, payee, note });
  }

  /** The amount (major units, positive) and the kind of entry; a fix typed by the person wins. */
  #money(rule, get, fix) {
    let value = 0, type = rule.kind === 'transfers' ? 'transfer' : null;
    if (rule.columns.debit || rule.columns.credit) {
      const d = CellValue.amount(get('debit')), c = CellValue.amount(get('credit'));
      if (d?.value) { value = d.value; type ??= 'expense'; } else if (c?.value) { value = c.value; type ??= 'income'; }
    } else {
      const a = CellValue.amount(get('amount'));
      value = a?.value || 0;
      if (!type && rule.columns.type) {
        const t = get('type').toLowerCase();
        if (rule.types.transfer.includes(t)) type = 'transfer';
        else if (rule.types.expense.includes(t)) type = 'expense';
        else if (rule.types.income.includes(t)) type = 'income';
      }
      if (!type && a?.mark) type = a.mark === 'dr' ? 'expense' : 'income';
      if (!type && a && rule.sign) type = (a.sign < 0) === (rule.sign === 'negative_expense') ? 'expense' : 'income';
      if (!type && rule.fixed) type = rule.fixed;
    }
    if (fix.amount != null) value = CellValue.amount(String(fix.amount))?.value || 0;
    if (fix.type) type = fix.type;
    return { value, type };
  }

  #budget(rule, get, base) {
    const a = CellValue.amount(get('amount'));
    const label = this.#categoryKey(get('category'), get('subcategory'));
    if (!label) return;
    if (!a?.value) return this.#flag(base, 'amount', 'This budget has no amount.');
    const cat = get('category');
    const byMain = cat && this.#mapping.categories[cat];
    const [main, sub] = this.#mapping.categories[label] || (byMain ? [byMain[0], byMain[1] || get('subcategory')] : this.#existingPair(label));
    const p = get('period').toLowerCase();
    const period = /week/.test(p) ? 'week' : /year|annual/.test(p) ? 'year' : /month/.test(p) ? 'month' : rule.period;
    this.budgets.push({ ...base, main, sub, amount: a.value, currency: this.#home, period });
  }

  #flag(base, problem, why, extra = {}) {
    this.attention.push({ ...base, problem, why, ...extra });
  }

  // ── names ────────────────────────────────────────────────────────────

  #categoryKey(cat, sub) {
    return cat && sub ? `${cat} › ${sub}` : (cat || sub || '');
  }

  #category(rule, get, payee, note, type) {
    const cat = get('category'), sub = get('subcategory');
    const key = this.#categoryKey(cat, sub);
    if (key) {
      const pair = this.#mapping.categories[key];
      if (pair) return pair;
      const byMain = cat && this.#mapping.categories[cat];
      if (byMain) return [byMain[0], byMain[1] || sub];
      return this.#existingPair(key);
    }
    const hay = `${payee} ${note}`.toLowerCase();
    const hit = this.#mapping.rules.find((r) => hay.includes(r.contains));
    return hit ? hit.category : ['', ''];
  }

  /** "Food › Groceries" or "Food" read as a Pocket main / sub pair. */
  #existingPair(key) {
    const [m, s] = key.split(' › ');
    return [m.trim(), (s || '').trim()];
  }

  #account(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    return this.#mapping.accounts[v] || v;
  }

  #defaultAccount() {
    const acc = (this.#book.accounts || []);
    const def = acc.find((a) => a.id === this.#book.user?.defaultAccountId && !a.archived) || acc.find((a) => !a.archived);
    return def?.name || 'Cash';
  }

  // ── book comparison ──────────────────────────────────────────────────

  #markDuplicates() {
    const norm = (s) => String(s || '').trim().toLowerCase();
    const factor = (c) => (['JPY', 'KRW'].includes(c) ? 1 : ['KWD', 'BHD', 'OMR'].includes(c) ? 1000 : 100);
    const accName = new Map((this.#book.accounts || []).map((a) => [a.id, norm(a.name)]));
    const have = new Set((this.#book.transactions || [])
      .filter((t) => t.type === 'expense' || t.type === 'income' || (t.type === 'transfer' && t.transferDir === 'out'))
      .map((t) => `${t.date}|${accName.get(t.accountId)}|${t.type}|${t.amount}`));
    const kept = [];
    for (const e of this.entries) {
      const k = `${e.date}|${norm(e.account)}|${e.type}|${Math.round(e.amount * factor(e.currency))}`;
      if (have.has(k)) this.duplicates++;
      else kept.push(e);
    }
    this.entries = kept;
  }

  #collectNames() {
    const norm = (s) => String(s || '').trim().toLowerCase();
    const accounts = new Set((this.#book.accounts || []).filter((a) => !a.archived).map((a) => norm(a.name)));
    const seenA = new Map();
    for (const e of this.entries) for (const n of [e.account, e.to].filter(Boolean)) {
      if (!seenA.has(norm(n))) seenA.set(norm(n), { name: n, existing: accounts.has(norm(n)) });
    }
    this.accounts = [...seenA.values()];

    const cats = this.#book.categories || [];
    const mainOf = (name, type) => cats.find((c) => !c.parentId && norm(c.name) === norm(name) && (!type || c.type === type));
    const seenC = new Map();
    const add = (main, sub, type) => {
      if (!main) return;
      const k = `${norm(main)}|${norm(sub)}|${type}`;
      if (seenC.has(k)) return;
      const m = mainOf(main, type) || mainOf(main);
      const existing = !!m && (!sub || cats.some((c) => c.parentId === m.id && norm(c.name) === norm(sub)));
      seenC.set(k, { main, sub, type, existing });
    };
    for (const e of this.entries) if (e.type !== 'transfer') add(e.main, e.sub, e.type);
    for (const b of this.budgets) add(b.main, b.sub, 'expense');
    this.categories = [...seenC.values()];
  }
}
