/**
 * ReportBuilder — picks the report the format asks for and builds its table.
 */
import { LedgerEntries } from './LedgerEntries.js';
import { TransactionsReport } from './reports/TransactionsReport.js';
import { CategoryReport } from './reports/CategoryReport.js';
import { MonthsReport } from './reports/MonthsReport.js';
import { AccountsReport } from './reports/AccountsReport.js';

export class ReportBuilder {
  static #REPORTS = {
    transactions: TransactionsReport,
    categories: CategoryReport,
    months: MonthsReport,
    accounts: AccountsReport,
  };

  /**
   * @param {object} state   the book (or a shared space's projection)
   * @param {import('./ExportFilter.js').ExportFilter} filter
   * @param {import('./ExportFormat.js').ExportFormat} format
   * @param {Date} [today]
   * @returns {import('./ReportTable.js').ReportTable}
   */
  static build(state, filter, format, today = new Date()) {
    const Report = ReportBuilder.#REPORTS[format.report] || TransactionsReport;
    return new Report({ ledger: new LedgerEntries(state), filter, format, state, today }).build();
  }
}
