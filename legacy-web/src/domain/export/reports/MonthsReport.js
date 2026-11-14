/**
 * MonthsReport — income, expense and net per month (Gregorian or Hijri, as
 * the format says), with the number of entries. Transfers are left out.
 */
import { BaseReport } from './BaseReport.js';
import { ReportTable } from '../ReportTable.js';

export class MonthsReport extends BaseReport {
  build() {
    const entries = this.entries().filter((e) => e.type === 'expense' || e.type === 'income');
    const columns = [
      { key: 'month', label: this.format.calendar === 'hijri' ? 'Hijri month' : 'Month', kind: 'text', align: 'left', weight: 1.6 },
      { key: 'count', label: 'Entries', kind: 'count', align: 'right', weight: 0.7 },
      this.money('income', `Income (${this.home})`),
      this.money('expense', `Expense (${this.home})`),
      this.money('net', `Net (${this.home})`),
    ];
    const months = new Map();
    for (const e of entries) {
      const { key, label } = this.monthOf(e);
      if (!months.has(key)) months.set(key, { month: label, count: 0, income: 0, expense: 0 });
      const m = months.get(key);
      m.count += 1;
      m[e.type] += e.homeAmount;
    }
    const rows = [...months.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([, m]) => ({ ...m, net: m.income - m.expense }));
    const total = this.format.showTotals && rows.length
      ? {
        month: 'Total', count: BaseReport.sum(rows, 'count'), income: BaseReport.sum(rows, 'income'),
        expense: BaseReport.sum(rows, 'expense'), net: BaseReport.sum(rows, 'net'), _strong: true,
      }
      : null;
    return new ReportTable({
      title: this.title(this.format.calendar === 'hijri' ? 'Income and expense by Hijri month' : 'Income and expense by month'),
      subtitle: this.subtitle(),
      columns,
      sections: [{ label: null, rows, subtotal: null }],
      total,
      fileStem: this.fileStem('months'),
    });
  }
}
