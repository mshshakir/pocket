/**
 * ReportExporter — builds the report for the current filter and format,
 * writes it in the chosen file type and hands it to the browser to save.
 */
import { ReportBuilder } from './ReportBuilder.js';
import { PdfWriter } from './writers/PdfWriter.js';
import { XlsxWriter } from './writers/XlsxWriter.js';
import { CsvWriter } from './writers/CsvWriter.js';

export class ReportExporter {
  static FILE_TYPES = Object.freeze([
    ['pdf', 'PDF', 'file-text'],
    ['xlsx', 'Excel', 'sheet'],
    ['csv', 'CSV', 'file-spreadsheet'],
  ]);

  static #WRITERS = { pdf: PdfWriter, xlsx: XlsxWriter, csv: CsvWriter };

  /**
   * @param {object} state
   * @param {import('./ExportFilter.js').ExportFilter} filter
   * @param {import('./ExportFormat.js').ExportFormat} format
   * @param {'pdf'|'xlsx'|'csv'} type
   * @returns {Promise<{blob: Blob, fileName: string, rows: number}>}
   */
  static async make(state, filter, format, type) {
    const Writer = ReportExporter.#WRITERS[type];
    if (!Writer) throw new Error(`Unknown file type: ${type}`);
    const table = ReportBuilder.build(state, filter, format);
    const writer = new Writer();
    const blob = await writer.write(table, format);
    return { blob, fileName: table.fileName(writer.extension), rows: table.rowCount };
  }

  /** Save a file through the browser. */
  static download(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName, rel: 'noopener' });
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
}
