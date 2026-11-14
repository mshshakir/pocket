/**
 * CellText — how a ReportTable cell is written out: as display text (PDF,
 * preview) or as a plain value (CSV, Excel numbers and dates).
 */
import { CurrencyService } from '../services/CurrencyService.js';

export class CellText {
  #fx;
  #dateFmt;

  constructor({ fx = new CurrencyService() } = {}) {
    this.#fx = fx;
    this.#dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** The currency of a money cell. */
  currency(col, row) {
    return (col.currencyKey && row[col.currencyKey]) || col.currency || 'USD';
  }

  /** Major units of a money cell (e.g. 1798.5 for ₹1,798.50). */
  major(col, row) {
    if (CellText.isLabel(col, row)) return null;
    const v = row[col.key];
    return v == null || v === '' ? null : this.#fx.fromMinor(Number(v), this.currency(col, row));
  }

  /** Decimal places of a money cell's currency (0 for JPY, 3 for KWD …). */
  digits(col, row) {
    return this.#fx.minorDigits(this.currency(col, row));
  }

  /** Whether this cell holds a row label (e.g. "Subtotal · 4") rather than a value. */
  /** Money, counts and percentages: right-aligned, never wrapped. */
  static isNumeric(col) {
    return col.kind === 'money' || col.kind === 'count' || col.kind === 'percent';
  }

  /** Short fixed-format values (dates, Hijri dates) that read badly split over two lines. */
  static keepsOneLine(col) {
    return col.kind === 'date' || Boolean(col.nowrap);
  }

  static isLabel(col, row) {
    return row._labelKey === col.key;
  }

  /** Display text: money with its symbol, dates spelled out, percentages. */
  text(col, row) {
    if (CellText.isLabel(col, row)) return row._label;
    const v = row[col.key];
    if (v == null || v === '') return '';
    switch (col.kind) {
      case 'money':   return this.#fx.formatMoney(Number(v), this.currency(col, row));
      case 'date':    return this.#dateFmt.format(new Date(`${v}T12:00:00`));
      case 'percent': return `${(Number(v) * 100).toFixed(1)}%`;
      case 'count':   return Number(v).toLocaleString();
      default:        return String(v);
    }
  }

  /** Plain value for CSV: numbers without symbols or grouping, ISO dates. */
  plain(col, row) {
    if (CellText.isLabel(col, row)) return row._label;
    const v = row[col.key];
    if (v == null || v === '') return '';
    switch (col.kind) {
      case 'money':   return this.major(col, row).toFixed(this.digits(col, row));
      case 'percent': return (Number(v) * 100).toFixed(1);
      default:        return String(v);
    }
  }
}
