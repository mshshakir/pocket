/**
 * CategoryReport — spending and income per category: each main category,
 * then its sub-categories indented beneath it, with the number of entries,
 * the amount (home currency) and its share of the section. Expenses and
 * income are separate sections; transfers are left out.
 */
import { BaseReport } from './BaseReport.js';
import { ReportTable } from '../ReportTable.js';
import { CurrencyService } from '../../services/CurrencyService.js';

export class CategoryReport extends BaseReport {
  build() {
    const entries = this.entries().filter((e) => e.type === 'expense' || e.type === 'income');
    const columns = [
      { key: 'category', label: 'Category', kind: 'text', align: 'left', weight: 2.6 },
      { key: 'count', label: 'Entries', kind: 'count', align: 'right', weight: 0.7 },
      this.money('amount', `Amount (${this.home})`),
      { key: 'share', label: 'Share', kind: 'percent', align: 'right', weight: 0.7 },
    ];
    const sections = [['expense', 'Expenses'], ['income', 'Income']]
      .map(([type, label]) => this.#section(entries.filter((e) => e.type === type), label))
      .filter(Boolean);

    const fx = new CurrencyService();
    const sum = (t) => entries.filter((e) => e.type === t).reduce((n, e) => n + e.homeAmount, 0);
    const income = sum('income'), expense = sum('expense');
    return new ReportTable({
      title: this.title('Spending and income by category'),
      subtitle: this.subtitle(),
      columns,
      sections,
      notes: [`Income ${fx.formatMoney(income, this.home)} · Expense ${fx.formatMoney(expense, this.home)} · Net ${fx.formatMoney(income - expense, this.home)}`],
      fileStem: this.fileStem('categories'),
    });
  }

  #section(entries, label) {
    if (!entries.length) return null;
    const total = entries.reduce((n, e) => n + e.homeAmount, 0);
    const mains = new Map();
    for (const e of entries) {
      const main = this.ledger.mainCategory(e.categoryId);
      const mainKey = main?.id ?? '~none';
      if (!mains.has(mainKey)) mains.set(mainKey, { name: main?.name || 'Uncategorised', count: 0, amount: 0, subs: new Map() });
      const m = mains.get(mainKey);
      m.count += 1;
      m.amount += e.homeAmount;
      if (main && e.categoryId && e.categoryId !== main.id) {
        const subName = this.ledger.categoryPath(e.categoryId).split(' / ').pop();
        const s = m.subs.get(e.categoryId) || { name: subName, count: 0, amount: 0 };
        s.count += 1;
        s.amount += e.homeAmount;
        m.subs.set(e.categoryId, s);
      }
    }
    const share = (v) => (total ? v / total : 0);
    const rows = [];
    for (const m of [...mains.values()].sort((a, b) => b.amount - a.amount)) {
      rows.push({ category: m.name, count: m.count, amount: m.amount, share: share(m.amount), _strong: true });
      for (const s of [...m.subs.values()].sort((a, b) => b.amount - a.amount)) {
        rows.push({ category: s.name, count: s.count, amount: s.amount, share: share(s.amount), _level: 1 });
      }
    }
    const subtotal = this.format.showTotals
      ? { category: `Total ${label.toLowerCase()}`, count: entries.length, amount: total, share: 1, _strong: true }
      : null;
    return { label, rows, subtotal };
  }
}
