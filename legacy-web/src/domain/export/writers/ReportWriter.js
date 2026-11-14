/**
 * ReportWriter — turns a ReportTable into a file. One subclass per format;
 * all of them lay out the same model, so the files match the preview.
 */
import { CellText } from '../CellText.js';

export class ReportWriter {
  cells;

  constructor({ cells = new CellText() } = {}) {
    this.cells = cells;
  }

  /** File extension, e.g. "pdf". */
  get extension() {
    throw new Error('extension not implemented');
  }

  /**
   * @param {import('../ReportTable.js').ReportTable} table
   * @param {import('../ExportFormat.js').ExportFormat} format
   * @returns {Promise<Blob>}
   */
  async write(_table, _format) {
    throw new Error('write() not implemented');
  }

  /** "Generated 14 Nov 2026, 14:05 · Pocket". */
  static generatedLine(now = new Date()) {
    return `Generated ${now.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · Pocket`;
  }
}
