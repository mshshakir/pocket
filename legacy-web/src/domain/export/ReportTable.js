/**
 * ReportTable — one report, ready to be written in any format.
 *
 * Every writer (PDF, Excel, CSV) and the on-screen preview read this same
 * model, so what the preview shows is what the file contains.
 *
 *   columns  [{ key, label, kind, align, weight, currency? , currencyKey? }]
 *            kind: 'text' | 'date' | 'money' | 'count' | 'percent'
 *            money values are minor units; their currency is the column's
 *            `currency`, or the row's `currencyKey` field when rows differ
 *   sections [{ label|null, rows: [row], subtotal: row|null }]
 *            a row is { [key]: value, _level?: 0|1 (indent), _strong?: bool }
 *   total    row|null — the grand total (shown on the last page)
 *   notes    [string] — e.g. "Income ₹… · Expense ₹… · Net ₹…"
 */
export class ReportTable {
  constructor({ title, subtitle = '', columns, sections, total = null, notes = [], fileStem = 'pocket-report' }) {
    this.title = title;
    this.subtitle = subtitle;
    this.columns = columns;
    this.sections = sections.filter((s) => s.rows.length || s.subtotal);
    this.total = total;
    this.notes = notes;
    this.fileStem = fileStem;
  }

  /** Number of data rows (not counting section headings, subtotals or the total). */
  get rowCount() {
    return this.sections.reduce((n, s) => n + s.rows.length, 0);
  }

  get isEmpty() {
    return this.rowCount === 0;
  }

  /** A file name like "pocket-transactions-2026-11-01-to-2026-11-14.pdf". */
  fileName(ext) {
    return `${this.fileStem}.${ext}`;
  }
}
