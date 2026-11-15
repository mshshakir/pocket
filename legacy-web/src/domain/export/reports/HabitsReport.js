/**
 * HabitsReport — each habit month by month for the period: how many times
 * and how much, with the habit's limit beside it, and a subtotal per habit.
 * A habit counts the same entries as on the Habits tab (HabitService).
 * Months follow the format's calendar (Gregorian or Hijri).
 */
import { BaseReport } from './BaseReport.js';
import { ReportTable } from '../ReportTable.js';
import { CurrencyService } from '../../services/CurrencyService.js';
import { HabitService } from '../../services/HabitService.js';
import { DateService } from '../../services/DateService.js';

export class HabitsReport extends BaseReport {
  #fx = new CurrencyService();

  build() {
    const today = DateService.toIso(this.today);
    const { from, to } = this.filter.range(this.today);
    const habits = new HabitService({ convert: (m, f, t) => this.#fx.convert(m, f, t) });
    const ledgerById = new Map(this.ledger.all().map((e) => [e.txId, e]));
    const columns = [
      { key: 'month', label: this.format.calendar === 'hijri' ? 'Hijri month' : 'Month', kind: 'text', align: 'left', weight: 1.5 },
      { key: 'count', label: 'Times', kind: 'count', align: 'right', weight: 0.7 },
      this.money('amount', `Amount (${this.home})`),
      this.money('average', `Average (${this.home})`),
      { key: 'limit', label: 'Monthly limit', kind: 'text', align: 'right', weight: 1 },
    ];
    const sections = [];
    for (const h of habits.all(this.state)) {
      const list = habits.entries(h, this.state, from || '0000-01-01', to || today);
      if (!list.length) continue;
      const months = new Map();
      for (const t of list) {
        const { key, label } = this.monthOf(ledgerById.get(t.id) ?? t);
        if (!months.has(key)) months.set(key, { month: label, count: 0, amount: 0 });
        const m = months.get(key);
        m.count += 1;
        m.amount += this.#fx.convert(t.amount, t.currency, this.home);
      }
      const limit = [h.limitCount ? `${h.limitCount} times` : '', h.limitAmount ? this.#fx.formatMoney(h.limitAmount, this.home) : ''].filter(Boolean).join(' / ');
      const rows = [...months.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([, m]) => ({ ...m, average: m.count ? Math.round(m.amount / m.count) : 0, limit }));
      const count = BaseReport.sum(rows, 'count'), amount = BaseReport.sum(rows, 'amount');
      sections.push({
        label: h.name,
        rows,
        subtotal: this.format.showTotals ? { month: `Total · ${h.name}`, count, amount, average: count ? Math.round(amount / count) : 0, _strong: true } : null,
      });
    }
    const notes = sections.length ? [] : ['No habit has entries in this period. Set habits up under Reports → Habits.'];
    return new ReportTable({
      title: this.title('Habits'),
      subtitle: this.subtitle(),
      columns,
      sections,
      total: null,
      notes,
      fileStem: this.fileStem('habits'),
    });
  }
}
