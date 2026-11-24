/**
 * ImportMapping — the AI's reading of a file, checked before anything uses it.
 *
 * The AI only writes RULES (what each table is, which column is which, how to
 * tell money in from money out, which sheet category is which Pocket
 * category); ImportDraft applies them to every row. Anything the AI names that
 * isn't in the file (a column that doesn't exist, a table id it made up) is
 * dropped here, so a careless answer can't make rows up.
 *
 * Shape:
 *   {
 *     reply: string,
 *     tables: [{ id, kind: 'entries'|'transfers'|'budgets'|'skip', sameAs?: tableId,
 *       columns: { date, amount, debit, credit, type, category, subcategory, account, to,
 *                  payee, note, currency, period },          // header names
 *       types: { expense: [], income: [], transfer: [] },     // values of the type column
 *       sign: 'negative_expense'|'negative_income'|null,      // when there is no type column
 *       fixed: 'expense'|'income'|null,                       // every row is this
 *       dateOrder: 'DMY'|'MDY'|'YMD', account: string, period: 'month'|'week'|'year' }],
 *     categories: { "<value in the file>": [main, sub] },
 *     accounts:   { "<value in the file>": "<account name>" },
 *     rules:      [{ contains: "swiggy", category: [main, sub] }]
 *   }
 */
export class ImportMapping {
  static KINDS = Object.freeze(['entries', 'transfers', 'budgets', 'skip']);
  static COLUMNS = Object.freeze(['date', 'amount', 'debit', 'credit', 'type', 'category', 'subcategory', 'account', 'to', 'payee', 'note', 'currency', 'period']);

  /**
   * @param {string} text  the AI's answer (JSON, possibly wrapped in prose or a code fence)
   * @param {{id: string, columns: string[]}[]} tables  from TableFinder
   * @returns {object} a clean mapping
   * @throws {Error} when no JSON can be found
   */
  static parse(text, tables) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('The AI didn\'t return a plan. Please try again.');
    let raw;
    try { raw = JSON.parse(m[0]); } catch (_) { throw new Error('The AI\'s answer couldn\'t be read. Please try again.'); }
    return ImportMapping.clean(raw, tables);
  }

  /** Keeps only what makes sense for these tables. */
  static clean(raw, tables) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const byId = new Map(tables.map((t) => [t.id, t]));
    const given = new Map((Array.isArray(r.tables) ? r.tables : []).filter((t) => byId.has(t?.id)).map((t) => [t.id, t]));
    const out = {
      reply: ImportMapping.#str(r.reply, 400),
      tables: tables.map((t) => ImportMapping.#table(given.get(t.id), t, byId)),
      categories: {},
      accounts: {},
      rules: [],
    };
    for (const [k, v] of Object.entries(r.categories && typeof r.categories === 'object' ? r.categories : {})) {
      const pair = ImportMapping.#pair(v);
      if (pair && k.trim()) out.categories[k.trim()] = pair;
    }
    for (const [k, v] of Object.entries(r.accounts && typeof r.accounts === 'object' ? r.accounts : {})) {
      const name = ImportMapping.#str(v, 60);
      if (name && k.trim()) out.accounts[k.trim()] = name;
    }
    for (const rule of (Array.isArray(r.rules) ? r.rules : []).slice(0, 300)) {
      const contains = ImportMapping.#str(rule?.contains, 60).toLowerCase();
      const pair = ImportMapping.#pair(rule?.category);
      if (contains && pair) out.rules.push({ contains, category: pair });
    }
    return out;
  }

  static #table(g, t, byId) {
    const a = g && typeof g === 'object' ? g : {};
    const sameAs = typeof a.sameAs === 'string' && byId.has(a.sameAs) && a.sameAs !== t.id ? a.sameAs : null;
    const cols = sameAs ? byId.get(sameAs).columns : t.columns;
    const columns = {};
    for (const key of ImportMapping.COLUMNS) {
      const v = a.columns?.[key];
      if (typeof v === 'string' && cols.includes(v)) columns[key] = v;
    }
    const list = (x) => (Array.isArray(x) ? x : []).map((v) => String(v).trim().toLowerCase()).filter(Boolean).slice(0, 50);
    return {
      id: t.id,
      kind: ImportMapping.KINDS.includes(a.kind) ? a.kind : 'skip',
      sameAs,
      why: ImportMapping.#str(a.why, 200),
      columns,
      types: { expense: list(a.types?.expense), income: list(a.types?.income), transfer: list(a.types?.transfer) },
      sign: ['negative_expense', 'negative_income'].includes(a.sign) ? a.sign : null,
      fixed: ['expense', 'income'].includes(a.fixed) ? a.fixed : null,
      dateOrder: ['DMY', 'MDY', 'YMD'].includes(a.dateOrder) ? a.dateOrder : 'DMY',
      account: ImportMapping.#str(a.account, 60),
      period: ['month', 'week', 'year'].includes(a.period) ? a.period : 'month',
    };
  }

  static #pair(v) {
    if (!Array.isArray(v)) return null;
    const main = ImportMapping.#str(v[0], 40);
    return main ? [main, ImportMapping.#str(v[1], 40)] : null;
  }

  static #str(v, max) {
    return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  }
}
