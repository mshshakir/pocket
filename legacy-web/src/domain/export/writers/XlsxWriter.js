/**
 * XlsxWriter — the report as an Excel workbook (.xlsx).
 *
 * Amounts are real numbers with a number format (so they sum and sort),
 * dates are real dates, the header row stays frozen while scrolling, every
 * column gets a width that fits its content, and long text (notes) wraps
 * inside its column instead of spilling over the next one.
 */
import { ReportWriter } from './ReportWriter.js';
import { VendorLibrary } from '../VendorLibrary.js';

export class XlsxWriter extends ReportWriter {
  static #DARK = '#18181b';
  static #MUTED = '#f4f4f5';
  static #MAX_WIDTH = 48;

  get extension() { return 'xlsx'; }

  async write(table, format) {
    const writeXlsxFile = await VendorLibrary.excel();
    const { data, columns, headerIndex } = this.sheet(table);
    return writeXlsxFile(data, {
      sheet: XlsxWriter.#sheetName(table.title),
      columns,
      stickyRowsCount: headerIndex + 1,
      orientation: format.orientation === 'portrait' ? 'portrait' : 'landscape',
      fontFamily: 'Calibri',
      fontSize: 11,
    }).toBlob();
  }

  /** The sheet rows and column widths (exposed for tests). */
  sheet(table) {
    const cols = table.columns;
    const n = cols.length;
    const data = [];
    const span = (value, extra = {}) => [{ value, columnSpan: n, ...extra }, ...Array(n - 1).fill(null)];

    data.push(span(table.title, { fontWeight: 'bold', fontSize: 14 }));
    if (table.subtitle) data.push(span(table.subtitle, { textColor: '#52525b', wrap: true }));
    for (const note of table.notes) data.push(span(note, { textColor: '#52525b' }));
    data.push(span(ReportWriter.generatedLine(), { textColor: '#a1a1aa', fontSize: 9 }));
    data.push(span(''));

    const headerIndex = data.length;
    data.push(cols.map((c) => ({
      value: c.label, fontWeight: 'bold', textColor: '#ffffff', backgroundColor: XlsxWriter.#DARK,
      align: c.align === 'right' ? 'right' : 'left', alignVertical: 'center', height: 20,
    })));

    for (const s of table.sections) {
      if (s.label) data.push(span(s.label, { fontWeight: 'bold', backgroundColor: XlsxWriter.#MUTED }));
      for (const r of s.rows) data.push(cols.map((c, i) => this.#cell(c, r, i)));
      if (s.subtotal) data.push(cols.map((c, i) => this.#cell(c, s.subtotal, i, { topBorderStyle: 'thin', topBorderColor: '#d4d4d8' })));
    }
    if (table.total) {
      data.push(cols.map((c, i) => this.#cell(c, table.total, i, { backgroundColor: XlsxWriter.#MUTED, topBorderStyle: 'medium', topBorderColor: XlsxWriter.#DARK })));
    }

    return { data, columns: this.#widths(table), headerIndex };
  }

  #cell(col, row, index, extra = {}) {
    const base = { ...extra };
    if (row._strong) base.fontWeight = 'bold';
    if (row._level && index === 0) base.indent = 1;
    if (row._labelKey === col.key) return { value: row._label, ...base };

    const v = row[col.key];
    if (v == null || v === '') return { value: null, ...base };
    switch (col.kind) {
      case 'money': {
        const digits = this.cells.digits(col, row);
        return { value: this.cells.major(col, row), type: Number, format: digits ? `#,##0.${'0'.repeat(digits)}` : '#,##0', align: 'right', ...base };
      }
      case 'count':
        return { value: Number(v), type: Number, format: '#,##0', align: 'right', ...base };
      case 'percent':
        return { value: Number(v), type: Number, format: '0.0%', align: 'right', ...base };
      case 'date': {
        const [y, m, d] = String(v).split('-').map(Number);
        return { value: new Date(Date.UTC(y, m - 1, d)), type: Date, format: 'dd mmm yyyy', ...base };
      }
      default:
        return { value: String(v), type: String, wrap: col.weight >= 2, alignVertical: 'top', ...base };
    }
  }

  /** Column widths in characters: fit the longest value, within limits. */
  #widths(table) {
    return table.columns.map((c) => {
      let longest = c.label.length;
      const look = (row) => { longest = Math.max(longest, String(this.cells.text(c, row) ?? '').length + (row._level ? 2 : 0)); };
      for (const s of table.sections) {
        s.rows.forEach(look);
        if (s.subtotal) look(s.subtotal);
      }
      if (table.total) look(table.total);
      const cap = c.weight >= 2 ? XlsxWriter.#MAX_WIDTH : 32;
      return { width: Math.max(8, Math.min(cap, longest + 2)) };
    });
  }

  /** Excel sheet names: at most 31 characters, none of : \ / ? * [ ]. */
  static #sheetName(title) {
    return (title || 'Report').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Report';
  }
}
