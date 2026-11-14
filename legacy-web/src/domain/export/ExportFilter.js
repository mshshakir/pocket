/**
 * ExportFilter — which entries a report covers: a period, and optionally
 * some accounts, categories (sub-categories included), entry types, payment
 * methods and a text search.
 *
 * Filters are kept apart from the report's layout (ExportFormat), so changing
 * what is included never changes how the file is laid out.
 */
import { DateService } from '../services/DateService.js';

export class ExportFilter {
  /** Period presets, in the order the export sheet offers them. */
  static PERIODS = Object.freeze([
    ['this-month', 'This month'],
    ['last-month', 'Last month'],
    ['30', 'Last 30 days'],
    ['90', 'Last 90 days'],
    ['this-year', 'This year'],
    ['last-year', 'Last year'],
    ['all', 'All time'],
    ['custom', 'Custom dates'],
  ]);

  static TYPES = Object.freeze([['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']]);

  /** @param {object} [raw]  a saved filter (unknown or bad fields fall back to defaults) */
  constructor(raw = {}) {
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
    const iso  = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
    this.period       = ExportFilter.PERIODS.some(([k]) => k === raw.period) ? raw.period : 'this-month';
    this.from         = iso(raw.from);
    this.to           = iso(raw.to);
    this.accountIds   = list(raw.accountIds);
    this.categoryIds  = list(raw.categoryIds);
    this.types        = list(raw.types).filter((t) => ExportFilter.TYPES.some(([k]) => k === t));
    this.paymentTypes = list(raw.paymentTypes);
    this.search       = typeof raw.search === 'string' ? raw.search.slice(0, 100) : '';
  }

  /** A copy with one field changed. */
  with(field, value) {
    return new ExportFilter({ ...this.toJSON(), [field]: value });
  }

  /** A copy with `value` added to or removed from a list field. */
  toggle(field, value) {
    const cur = Array.isArray(this[field]) ? this[field] : [];
    return this.with(field, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
  }

  toJSON() {
    return {
      period: this.period, from: this.from, to: this.to,
      accountIds: [...this.accountIds], categoryIds: [...this.categoryIds],
      types: [...this.types], paymentTypes: [...this.paymentTypes], search: this.search,
    };
  }

  /**
   * The first and last day covered (inclusive), as YYYY-MM-DD; null means open.
   * @param {Date} [today]
   * @returns {{from: string|null, to: string|null}}
   */
  range(today = new Date()) {
    const iso = (d) => DateService.toIso(d);
    const y = today.getFullYear();
    const m = today.getMonth();
    switch (this.period) {
      case 'this-month': return { from: iso(new Date(y, m, 1)), to: iso(today) };
      case 'last-month': return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
      case 'this-year':  return { from: iso(new Date(y, 0, 1)), to: iso(today) };
      case 'last-year':  return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) };
      case 'all':        return { from: null, to: null };
      case 'custom': {
        const [a, b] = [this.from || null, this.to || null];
        return a && b && a > b ? { from: b, to: a } : { from: a, to: b };
      }
      default: {
        const start = new Date(today);
        start.setDate(start.getDate() - (Number(this.period) - 1));
        return { from: iso(start), to: iso(today) };
      }
    }
  }

  /** How many filters beyond the period are set. */
  get activeCount() {
    return (this.accountIds.length ? 1 : 0) + (this.categoryIds.length ? 1 : 0)
      + (this.types.length ? 1 : 0) + (this.paymentTypes.length ? 1 : 0) + (this.search.trim() ? 1 : 0);
  }

  /**
   * A test for one ledger entry (see LedgerEntries).
   * @param {object[]} categories  the book's categories, to include sub-categories
   * @returns {(entry: object) => boolean}
   */
  matcher(categories, today = new Date()) {
    const { from, to } = this.range(today);
    const accounts = new Set(this.accountIds);
    const types    = new Set(this.types);
    const payments = new Set(this.paymentTypes);
    const cats     = this.categoryIds.length ? ExportFilter.#withDescendants(this.categoryIds, categories) : null;
    const needle   = this.search.trim().toLowerCase();
    return (e) => {
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      if (accounts.size && !accounts.has(e.accountId) && !(e.toAccountId && accounts.has(e.toAccountId))) return false;
      if (types.size && !types.has(e.type)) return false;
      if (payments.size && !payments.has(e.paymentType)) return false;
      if (cats && !cats.has(e.categoryId)) return false;
      if (needle && ![e.payee, e.note, e.categoryPath, e.accountName].some((s) => (s || '').toLowerCase().includes(needle))) {
        return false;
      }
      return true;
    };
  }

  static #withDescendants(ids, categories) {
    const children = new Map();
    for (const c of categories || []) {
      if (!children.has(c.parentId)) children.set(c.parentId, []);
      children.get(c.parentId).push(c.id);
    }
    const out = new Set();
    const stack = [...ids];
    while (stack.length) {
      const id = stack.pop();
      if (out.has(id)) continue;
      out.add(id);
      stack.push(...(children.get(id) || []));
    }
    return out;
  }
}
