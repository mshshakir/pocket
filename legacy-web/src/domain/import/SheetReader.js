/**
 * SheetReader — turns a file the person picked into plain grids of text, one
 * per sheet, for Import with AI (owner, 24 Nov 2026).
 *
 *   .csv / .tsv / .txt   one sheet (CsvGrid)
 *   .xlsx                every tab (XlsxReader)
 *
 * Nothing here talks to the AI: it only reads the file on the device.
 */
import { CsvGrid } from './CsvGrid.js';
import { XlsxReader } from './XlsxReader.js';

export class SheetReadError extends Error {}

export class SheetReader {
  /** Largest file read (bytes). */
  static MAX_BYTES = 15 * 1024 * 1024;

  /**
   * @param {{name: string, size?: number, text: () => Promise<string>, arrayBuffer: () => Promise<ArrayBuffer>}} file
   * @returns {Promise<{name: string, sheets: {name: string, grid: string[][]}[]}>}
   * @throws {SheetReadError} with a sentence for the person
   */
  static async read(file) {
    const name = String(file?.name || 'file');
    if ((file?.size || 0) > SheetReader.MAX_BYTES) throw new SheetReadError('That file is too large. Try a smaller export (under 15 MB).');
    const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xlsm') {
      const sheets = await new XlsxReader(new Uint8Array(await file.arrayBuffer())).read();
      return { name, sheets: sheets.filter((s) => s.grid.length) };
    }
    if (ext === 'xls') throw new SheetReadError('Old Excel files (.xls) can\'t be read. Open it in Excel or Google Sheets and save as .xlsx or .csv.');
    if (ext === 'pdf') throw new SheetReadError('Statement PDFs are coming soon. For now, please use a CSV or Excel file.');
    if (ext && !['csv', 'tsv', 'txt'].includes(ext)) throw new SheetReadError('Please choose a CSV or Excel (.xlsx) file.');
    const grid = CsvGrid.parse(await file.text());
    return { name, sheets: grid.length ? [{ name: 'Sheet1', grid }] : [] };
  }
}
