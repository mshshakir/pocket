/**
 * TransactionsReport — every entry in the period, one per row, in the
 * columns and order the user chose, optionally grouped (by day, month,
 * category or account) with a subtotal under each group.
 *
 * Amounts are in the home currency: income +, expense −. Transfers are
 * listed but count towards no total — they move money between the user's own
 * accounts.
 */
import { BaseReport } from './BaseReport.js';
import { ReportTable } from '../ReportTable.js';
import { ExportFormat } from '../ExportFormat.js';
import { CurrencyService } from '../../services/CurrencyService.js';

export class TransactionsReport extends BaseReport {
  #fx = new CurrencyService();

  build() {
    const entries = this.entries();
    const columns = this.#columns();
    const rows = entries.map((e) => this.#row(e));
    const amountCol = columns.find((c) => c.key === 'amount');
    const sections = this.#group(entries, rows, columns, amountCol);

    // Totals count as Reports do: loans and paybacks count nothing, and a
    // paid-back expense counts what you bore. Each row still shows its amount.
    const income  = entries.filter((e) => e.type === 'income').reduce((n, e) => n + (e.countedHome ?? e.homeAmount), 0);
    const expense = entries.filter((e) => e.type === 'expense').reduce((n, e) => n + (e.countedHome ?? e.homeAmount), 0);
    const transfers = entries.filter((e) => e.type === 'transfer').length;
    const fmt = (v) => this.#fx.formatMoney(v, this.home);
    const notes = [`${entries.length.toLocaleString()} entr${entries.length === 1 ? 'y' : 'ies'} · Income ${fmt(income)} · Expense ${fmt(expense)} · Net ${fmt(income - expense)}`];
    if (transfers) notes.push(`Transfers (${transfers}) are listed but not counted in totals.`);
    if (entries.some((e) => e.kind || e.paidBackHome)) notes.push('Loans and money paid back are listed but not counted as income; paid-back expenses count what was not paid back.');

    const total = this.format.showTotals && amountCol
      ? this.#labelled(columns, `Total · ${entries.length.toLocaleString()} entries`, { amount: income - expense }, true)
      : null;

    return new ReportTable({
      title: this.title('Transactions'),
      subtitle: this.subtitle(),
      columns,
      sections,
      total,
      notes,
      fileStem: this.fileStem('transactions'),
    });
  }

  #columns() {
    const defs = {
      date:     { kind: 'date', align: 'left', weight: 0.9 },
      hijri:    { kind: 'text', align: 'left', weight: 1, nowrap: true },
      type:     { kind: 'text', align: 'left', weight: 0.7 },
      account:  { kind: 'text', align: 'left', weight: 1.3 },
      category: { kind: 'text', align: 'left', weight: 1.4 },
      payee:    { kind: 'text', align: 'left', weight: 1.2 },
      note:     { kind: 'text', align: 'left', weight: 2.2 },
      payment:  { kind: 'text', align: 'left', weight: 0.8 },
      original: { kind: 'text', align: 'right', weight: 1 },
      amount:   { kind: 'money', align: 'right', weight: 1.1, currency: this.home },
      addedBy:  { kind: 'text', align: 'left', weight: 1.3 },
      source:   { kind: 'text', align: 'left', weight: 1.1 },
      reimbBy:  { kind: 'text', align: 'left', weight: 1.2 },
      paidBack: { kind: 'money', align: 'right', weight: 1.1, currency: this.home },
      reimbPct: { kind: 'percent', align: 'right', weight: 0.8 },
    };
    return this.format.columns.map((key) => ({
      key,
      label: key === 'amount' ? `Amount (${this.home})` : ExportFormat.label(ExportFormat.TX_COLUMNS, key),
      ...defs[key],
    }));
  }

  #row(e) {
    const foreign = e.currency !== this.home;
    return {
      date: e.date,
      hijri: e.hijri?.label || '',
      type: e.type[0].toUpperCase() + e.type.slice(1),
      account: e.accountName,
      category: e.type === 'transfer' ? 'Transfer' : `${e.categoryPath}${e.split ? ' (split)' : ''}`,
      payee: e.payee,
      note: e.note.replace(/\s*\n\s*/g, ' · '),
      payment: e.paymentType ? e.paymentType[0].toUpperCase() + e.paymentType.slice(1) : '',
      original: foreign ? this.#fx.formatMoney(e.amount, e.currency) : '',
      amount: e.type === 'transfer' ? e.homeAmount : e.signedHome,
      addedBy: e.addedBy,
      source: e.kind || e.source || '',
      reimbBy: e.reimbBy || '',
      paidBack: e.paidBackHome ?? null,
      reimbPct: e.reimbPct ?? null,
      _transfer: e.type === 'transfer',
    };
  }

  #group(entries, rows, columns, amountCol) {
    const by = this.format.groupBy;
    if (by === 'none') return [{ label: null, rows, subtotal: null }];

    const keyOf = (e) => {
      switch (by) {
        case 'day':      return { key: e.date, label: new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + (e.hijri?.label ? ` · ${e.hijri.label}` : '') };
        case 'month':    return this.monthOf(e);
        case 'category': return e.type === 'transfer'
          ? { key: '~transfer', label: 'Transfers' }
          : { key: this.ledger.mainCategory(e.categoryId)?.name || 'Uncategorised', label: this.ledger.mainCategory(e.categoryId)?.name || 'Uncategorised' };
        case 'account':  return { key: e.accountName, label: e.accountName };
        case 'source':   return e.source ? { key: e.source, label: e.source + 's' } : { key: '~other', label: 'Other entries' };
        default:         return { key: '', label: '' };
      }
    };

    const groups = new Map();
    entries.forEach((e, i) => {
      const { key, label } = keyOf(e);
      if (!groups.has(key)) groups.set(key, { label, rows: [], entries: [] });
      groups.get(key).rows.push(rows[i]);
      groups.get(key).entries.push(e);
    });
    const ordered = [...groups.entries()].sort(([a], [b]) => (by === 'day' || by === 'month' ? a.localeCompare(b) : a.localeCompare(b, undefined, { sensitivity: 'base' })));

    return ordered.map(([, g]) => {
      const net = g.entries.reduce((n, e) => n + (e.countedSigned ?? e.signedHome), 0);
      const subtotal = this.format.showTotals && amountCol
        ? this.#labelled(columns, `Subtotal · ${g.rows.length}`, { amount: net }, true)
        : null;
      return { label: g.label, rows: g.rows, subtotal };
    });
  }

  /** A totals row with its label in the first text column that isn't the amount. */
  #labelled(columns, label, values, strong) {
    const first = columns.find((c) => c.key !== 'amount');
    return { ...values, _strong: strong, _label: label, _labelKey: first?.key ?? null };
  }
}
