/**
 * ExportFormat — how a report is laid out: which report, which columns (and
 * in what order), grouping, calendar, page orientation and size, title and
 * totals.
 *
 * Saved with the user's settings and kept apart from ExportFilter, so a
 * layout the user set up stays exactly as it is whatever they filter by.
 */
export class ExportFormat {
  static REPORTS = Object.freeze([
    ['transactions', 'Transactions'],
    ['categories', 'By category'],
    ['months', 'By month'],
    ['accounts', 'By account'],
  ]);

  /** Columns the transactions report can show, in their default order. */
  static TX_COLUMNS = Object.freeze([
    ['date', 'Date'],
    ['hijri', 'Hijri date'],
    ['type', 'Type'],
    ['account', 'Account'],
    ['category', 'Category'],
    ['payee', 'Payee'],
    ['note', 'Note'],
    ['payment', 'Payment'],
    ['original', 'Original amount'],
    ['amount', 'Amount'],
    ['addedBy', 'Added by'],
  ]);

  static DEFAULT_TX_COLUMNS = Object.freeze(['date', 'account', 'category', 'note', 'payment', 'amount']);

  static GROUPS = Object.freeze([
    ['none', 'No grouping'],
    ['day', 'Day'],
    ['month', 'Month'],
    ['category', 'Category'],
    ['account', 'Account'],
  ]);

  static ORIENTATIONS = Object.freeze([['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']]);
  static PAPERS = Object.freeze([['a4', 'A4'], ['letter', 'Letter']]);
  static CALENDARS = Object.freeze([['gregorian', 'Gregorian'], ['hijri', 'Hijri']]);

  constructor(raw = {}) {
    const pick = (list, v, d) => (list.some(([k]) => k === v) ? v : d);
    const known = new Set(ExportFormat.TX_COLUMNS.map(([k]) => k));
    const cols = Array.isArray(raw.columns) ? [...new Set(raw.columns.filter((c) => known.has(c)))] : [];
    this.report      = pick(ExportFormat.REPORTS, raw.report, 'transactions');
    this.columns     = cols.length ? cols : [...ExportFormat.DEFAULT_TX_COLUMNS];
    this.groupBy     = pick(ExportFormat.GROUPS, raw.groupBy, 'none');
    this.calendar    = pick(ExportFormat.CALENDARS, raw.calendar, 'gregorian');
    this.orientation = pick(ExportFormat.ORIENTATIONS, raw.orientation, 'auto');
    this.paper       = pick(ExportFormat.PAPERS, raw.paper, 'a4');
    this.showTotals  = raw.showTotals !== false;
    this.title       = typeof raw.title === 'string' ? raw.title.slice(0, 80) : '';
  }

  with(field, value) {
    return new ExportFormat({ ...this.toJSON(), [field]: value });
  }

  /** Show or hide a column; a newly shown one goes back to its usual place. */
  toggleColumn(key) {
    if (this.columns.includes(key)) {
      return this.columns.length > 1 ? this.with('columns', this.columns.filter((c) => c !== key)) : this;
    }
    const order = ExportFormat.TX_COLUMNS.map(([k]) => k);
    const next = [...this.columns, key].sort((a, b) => {
      const ia = this.columns.indexOf(a), ib = this.columns.indexOf(b);
      // Keep the user's order for columns already shown; slot the new one by the default order.
      if (ia >= 0 && ib >= 0) return ia - ib;
      return order.indexOf(a) - order.indexOf(b);
    });
    return this.with('columns', next);
  }

  /** Move a shown column one place left (-1) or right (+1). */
  moveColumn(key, step) {
    const cols = [...this.columns];
    const i = cols.indexOf(key);
    const j = i + step;
    if (i < 0 || j < 0 || j >= cols.length) return this;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    return this.with('columns', cols);
  }

  toJSON() {
    return {
      report: this.report, columns: [...this.columns], groupBy: this.groupBy, calendar: this.calendar,
      orientation: this.orientation, paper: this.paper, showTotals: this.showTotals, title: this.title,
    };
  }

  static label(list, key) {
    return list.find(([k]) => k === key)?.[1] ?? key;
  }
}
