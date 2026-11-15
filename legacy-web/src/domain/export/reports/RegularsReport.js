/**
 * RegularsReport — bills and deliveries for the period, including what
 * isn't money spent yet:
 *
 *   Bills       every date a repeat falls on: paid (with the amount paid),
 *               not paid yet, skipped, or coming up (with the last amount)
 *   Deliveries  every day an item came or was marked not delivered: the
 *               quantity and price, whether it was confirmed, and whether
 *               the vendor has been paid for it
 *
 * Amounts are in the home currency. The notes say what's still to pay.
 * The account filter applies (a bill or item on another account is left
 * out); the other filters are about entries and don't apply here.
 */
import { BaseReport } from './BaseReport.js';
import { ReportTable } from '../ReportTable.js';
import { CurrencyService } from '../../services/CurrencyService.js';
import { RecurringService } from '../../services/RecurringService.js';
import { BillService } from '../../services/BillService.js';
import { VendorDues } from '../../services/VendorDues.js';
import { DeliveryPlan } from '../../services/DeliveryPlan.js';
import { DateService } from '../../services/DateService.js';

export class RegularsReport extends BaseReport {
  static #BILL_STATUS = Object.freeze({ paid: 'Paid', overdue: 'Not paid yet', due: 'Due today', upcoming: 'Coming up', skipped: 'Skipped' });
  static #DAY_STATUS = Object.freeze({ paid: 'Paid', owed: 'Delivered · not paid', unconfirmed: 'Not confirmed · not paid', skipped: 'Not delivered' });

  #fx = new CurrencyService();

  build() {
    const today = DateService.toIso(this.today);
    const { from, to } = this.#span(today);
    const store = { getState: () => this.state };
    const bills = new BillService({ store, recurring: new RecurringService() });
    const dues = new VendorDues({ store });
    const accounts = new Set(this.filter.accountIds);
    const onAccount = (id) => !accounts.size || accounts.has(id);

    const columns = [
      { key: 'date', label: 'Date', kind: 'date', align: 'left', weight: 0.9 },
      { key: 'name', label: 'Bill / item', kind: 'text', align: 'left', weight: 1.4 },
      { key: 'detail', label: 'Detail', kind: 'text', align: 'left', weight: 1.4 },
      { key: 'status', label: 'Status', kind: 'text', align: 'left', weight: 1.3 },
      this.money('amount', `Amount (${this.home})`),
    ];
    const conv = (minor, cur) => this.#fx.convert(minor, cur || this.home, this.home);

    // ── bills ──
    const billRows = bills.occurrences(from, to, today, this.state)
      .filter((o) => onAccount(o.template.accountId))
      .map((o) => ({
        date: o.date,
        name: BillService.nameOf(o.template, this.state),
        detail: o.template.askFirst ? 'Amount changes' : 'Same amount',
        status: RegularsReport.#BILL_STATUS[o.status] || o.status,
        amount: conv(o.amount, o.currency),
        _status: o.status,
      }));
    const unpaidBills = billRows.filter((r) => r._status === 'overdue' || r._status === 'due');

    // ── deliveries ──
    const dayRows = [];
    const lastDay = to < today ? to : today;
    for (const item of dues.items().filter((i) => onAccount(i.accountId))) {
      const plan = new DeliveryPlan(item);
      const start = plan.trackFrom && plan.trackFrom > from ? plan.trackFrom : from;
      for (let d = start, i = 0; d <= lastDay && i < 1500; d = DeliveryPlan.addDays(d, 1), i++) {
        const status = dues.statusOn(item, d, today);
        if (!status) continue;
        const qty = plan.qtyOn(d);
        const price = plan.priceOn(d);
        dayRows.push({
          date: d,
          name: item.name,
          detail: qty ? `${plan.qtyLabel(qty)} × ${this.#fx.formatMoney(price, item.currency || this.home)}` : '—',
          status: RegularsReport.#DAY_STATUS[status] || status,
          amount: qty ? conv(Math.round(qty * price), item.currency) : 0,
          _status: status,
        });
      }
    }
    dayRows.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

    const subtotal = (rows, label) => (this.format.showTotals && rows.length
      ? { amount: BaseReport.sum(rows.filter((r) => r._status !== 'skipped'), 'amount'), _strong: true, _label: label, _labelKey: 'name' }
      : null);
    const sections = [
      { label: 'Bills', rows: billRows, subtotal: subtotal(billRows, `Bills · ${billRows.length}`) },
      { label: 'Deliveries', rows: dayRows, subtotal: subtotal(dayRows, `Deliveries · ${dayRows.filter((r) => r._status !== 'skipped').length} days`) },
    ];

    const fmt = (v) => this.#fx.formatMoney(v, this.home);
    const notes = [];
    if (unpaidBills.length) notes.push(`Bills not paid yet: ${unpaidBills.length} · ${fmt(BaseReport.sum(unpaidBills, 'amount'))} (last amounts)`);
    const owed = dues.byVendor(today).filter((g) => g.amount > 0 && g.lines.some((l) => onAccount(l.item.accountId)));
    if (owed.length) notes.push(`Owed to vendors today: ${owed.map((g) => `${g.vendor} ${this.#fx.formatMoney(g.amount, g.currency || this.home)}`).join(' · ')}`);
    const unconfirmed = dayRows.filter((r) => r._status === 'unconfirmed').length;
    if (unconfirmed) notes.push(`${unconfirmed} delivery day${unconfirmed === 1 ? '' : 's'} not confirmed — counted as the usual.`);

    return new ReportTable({
      title: this.title('Bills and deliveries'),
      subtitle: this.subtitle(),
      columns,
      sections,
      total: null,
      notes,
      fileStem: this.fileStem('regulars'),
    });
  }

  /** The period; "all time" starts at the earliest bill or tracked delivery. */
  #span(today) {
    const { from, to } = this.filter.range(this.today);
    const starts = [
      ...(this.state.transactions || []).filter((t) => t.recurring && !t.recurringSourceId).map((t) => t.date),
      ...(this.state.regularItems || []).filter((i) => i.payLater === true).map((i) => new DeliveryPlan(i).trackFrom).filter(Boolean),
    ].filter(Boolean).sort();
    return { from: from || starts[0] || today, to: to || today };
  }
}
