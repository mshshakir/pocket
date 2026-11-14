/**
 * PdfWriter — the report as a PDF built with jsPDF-AutoTable, laid out so the
 * table never runs off the page or breaks badly:
 *
 *   • text columns share the width left over and wrap; amounts, dates and
 *     counts keep their natural width and never wrap
 *   • the column header repeats at the top of every page; a row is never
 *     split across two pages; the grand total sits on the last page
 *   • "Auto" orientation turns the page to landscape for wide reports, and
 *     the text gets smaller when there are many columns
 *   • Noto Sans is embedded, so ₹ and accented names print as typed
 *   • every page has the report title and "Page n of N"
 */
import { ReportWriter } from './ReportWriter.js';
import { VendorLibrary } from '../VendorLibrary.js';
import { CellText } from '../CellText.js';

export class PdfWriter extends ReportWriter {
  static #FONT = 'NotoSans';
  static #MARGIN = 36;              // pt (½ inch)
  static #INK = [9, 9, 11];
  static #MUTED_INK = [113, 113, 122];
  static #LINE = [228, 228, 231];
  static #HEAD = [24, 24, 27];
  static #BAND = [244, 244, 245];

  get extension() { return 'pdf'; }

  /** Portrait or landscape for this table and format. */
  static orientation(table, format) {
    if (format.orientation === 'portrait' || format.orientation === 'landscape') return format.orientation;
    const weight = table.columns.reduce((n, c) => n + (c.weight || 1), 0);
    return table.columns.length >= 7 || weight > 7.5 ? 'landscape' : 'portrait';
  }

  async write(table, format) {
    const [{ jsPDF, autoTable }, fonts] = await Promise.all([VendorLibrary.pdf(), VendorLibrary.fonts()]);
    const doc = new jsPDF({ orientation: PdfWriter.orientation(table, format), unit: 'pt', format: format.paper, compress: true });
    this.#registerFonts(doc, fonts);

    const M = PdfWriter.#MARGIN;
    const pageW = doc.internal.pageSize.getWidth();
    const width = pageW - 2 * M;
    const fontSize = table.columns.length >= 9 ? 7.5 : table.columns.length >= 7 ? 8 : 9;

    // ── Title block (first page) ──────────────────────────────────────────
    let y = M;
    doc.setFont(PdfWriter.#FONT, 'bold').setFontSize(16).setTextColor(...PdfWriter.#INK);
    for (const line of doc.splitTextToSize(table.title, width)) { doc.text(line, M, y + 12); y += 20; }
    doc.setFont(PdfWriter.#FONT, 'normal').setFontSize(9).setTextColor(...PdfWriter.#MUTED_INK);
    for (const text of [table.subtitle, ...table.notes].filter(Boolean)) {
      for (const line of doc.splitTextToSize(text, width)) { doc.text(line, M, y + 8); y += 12; }
    }
    y += 8;

    // ── Table ────────────────────────────────────────────────────────────
    const cols = table.columns;
    const body = [];
    for (const s of table.sections) {
      if (s.label) {
        body.push([{ content: s.label, colSpan: cols.length, styles: { fontStyle: 'bold', fillColor: PdfWriter.#BAND, textColor: PdfWriter.#INK } }]);
      }
      for (const r of s.rows) body.push(this.#row(cols, r));
      if (s.subtotal) body.push(this.#row(cols, s.subtotal, { lineWidth: { top: 0.75 }, lineColor: [161, 161, 170] }));
    }
    if (table.isEmpty) {
      body.push([{ content: 'No entries match these filters.', colSpan: cols.length, styles: { halign: 'center', textColor: PdfWriter.#MUTED_INK } }]);
    }

    const columnStyles = {};
    cols.forEach((c, i) => {
      const numeric = CellText.isNumeric(c);
      const oneLine = CellText.keepsOneLine(c);
      columnStyles[i] = {
        halign: c.align === 'right' || numeric ? 'right' : 'left',
        // Numbers and dates keep one line; text shares what is left and wraps.
        cellWidth: numeric || oneLine ? 'wrap' : 'auto',
        minCellWidth: numeric ? 48 : oneLine ? 56 : 40,
      };
    });

    autoTable(doc, {
      startY: y,
      margin: { top: M + 18, right: M, bottom: M + 14, left: M },
      tableWidth: width,
      head: [cols.map((c, i) => ({ content: c.label, styles: { halign: columnStyles[i].halign } }))],
      body,
      foot: table.total ? [this.#row(cols, table.total)] : undefined,
      showHead: 'everyPage',
      showFoot: 'lastPage',
      rowPageBreak: 'avoid',
      theme: 'grid',
      styles: {
        font: PdfWriter.#FONT, fontStyle: 'normal', fontSize, textColor: PdfWriter.#INK,
        cellPadding: { top: 4, right: 5, bottom: 4, left: 5 }, overflow: 'linebreak', valign: 'top',
        lineColor: PdfWriter.#LINE, lineWidth: 0.5,
      },
      headStyles: { font: PdfWriter.#FONT, fontStyle: 'bold', fillColor: PdfWriter.#HEAD, textColor: [255, 255, 255], valign: 'middle' },
      footStyles: { font: PdfWriter.#FONT, fontStyle: 'bold', fillColor: PdfWriter.#BAND, textColor: PdfWriter.#INK },
      columnStyles,
      didDrawPage: (data) => {
        // Running title on every page after the first.
        if (data.pageNumber > 1) {
          doc.setFont(PdfWriter.#FONT, 'normal').setFontSize(8).setTextColor(...PdfWriter.#MUTED_INK);
          doc.text(doc.splitTextToSize(table.title, width)[0], M, M);
        }
      },
    });

    // ── Footer: page numbers once the page count is known ────────────────
    const pages = doc.getNumberOfPages();
    const pageH = doc.internal.pageSize.getHeight();
    const generated = ReportWriter.generatedLine();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont(PdfWriter.#FONT, 'normal').setFontSize(8).setTextColor(...PdfWriter.#MUTED_INK);
      doc.text(generated, M, pageH - M / 2);
      doc.text(`Page ${p} of ${pages}`, pageW - M, pageH - M / 2, { align: 'right' });
    }
    return doc.output('blob');
  }

  #row(cols, row, extraStyles = {}) {
    return cols.map((c, i) => {
      const styles = { ...extraStyles };
      if (c.align === 'right' || CellText.isNumeric(c)) styles.halign = 'right';
      if (row._strong) styles.fontStyle = 'bold';
      if (row._level && i === 0) styles.cellPadding = { top: 4, right: 5, bottom: 4, left: 16 };
      if (row._level) styles.textColor = [63, 63, 70];
      return { content: this.cells.text(c, row), styles };
    });
  }

  #registerFonts(doc, fonts) {
    const [regular, semibold] = fonts;
    doc.addFileToVFS(regular.name, regular.base64);
    doc.addFont(regular.name, PdfWriter.#FONT, 'normal');
    doc.addFileToVFS(semibold.name, semibold.base64);
    doc.addFont(semibold.name, PdfWriter.#FONT, 'bold');
  }
}
