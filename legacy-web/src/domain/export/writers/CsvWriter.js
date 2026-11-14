/**
 * CsvWriter — the report as CSV: a title block, the header, then each
 * section (its heading, rows and subtotal) and the total. Numbers carry no
 * symbols or grouping so spreadsheets read them as numbers; dates are ISO.
 * Starts with a UTF-8 byte-order mark so Excel opens ₹ and accents correctly.
 */
import { ReportWriter } from './ReportWriter.js';

export class CsvWriter extends ReportWriter {
  get extension() { return 'csv'; }

  async write(table, _format) {
    return new Blob(['﻿' + this.text(table)], { type: 'text/csv;charset=utf-8' });
  }

  /** The CSV text (without the byte-order mark). */
  text(table) {
    const cols = table.columns;
    const lines = [];
    const line = (cells) => lines.push(cells.map(CsvWriter.#cell).join(','));
    const blank = () => lines.push('');

    line([table.title]);
    if (table.subtitle) line([table.subtitle]);
    for (const n of table.notes) line([n]);
    blank();
    line(cols.map((c) => c.label));
    for (const s of table.sections) {
      if (s.label) line([s.label]);
      for (const r of s.rows) line(cols.map((c, i) => this.#value(c, r, i)));
      if (s.subtotal) line(cols.map((c, i) => this.#value(c, s.subtotal, i)));
    }
    if (table.total) line(cols.map((c, i) => this.#value(c, table.total, i)));
    return lines.join('\r\n') + '\r\n';
  }

  /** A cell's value; a sub-category's name is indented under its main category. */
  #value(col, row, index) {
    const v = this.cells.plain(col, row);
    return row._level && index === 0 ? `  ${v}` : v;
  }

  static #cell(v) {
    const s = v == null ? '' : String(v);
    // Quote when needed; also neutralise a leading = + - @ so a spreadsheet
    // never runs a cell as a formula (CSV injection).
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }
}
