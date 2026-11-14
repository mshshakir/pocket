/**
 * AccountsReport — what moved through each account in the period, in that
 * account's own currency: money in (income), money out (expenses), transfers
 * in and out, and the net change. No grand total: accounts can hold
 * different currencies.
 */
import { BaseReport } from './BaseReport.js';
import { ReportTable } from '../ReportTable.js';
import { CurrencyService } from '../../services/CurrencyService.js';

export class AccountsReport extends BaseReport {
  #fx = new CurrencyService();

  build() {
    const entries = this.entries();
    const money = (key, label) => ({ key, label, kind: 'money', align: 'right', weight: 1.1, currencyKey: 'currency' });
    const columns = [
      { key: 'account', label: 'Account', kind: 'text', align: 'left', weight: 1.8 },
      { key: 'currency', label: 'Currency', kind: 'text', align: 'left', weight: 0.7 },
      money('moneyIn', 'Money in'),
      money('moneyOut', 'Money out'),
      money('transferIn', 'Transfers in'),
      money('transferOut', 'Transfers out'),
      money('net', 'Net change'),
    ];

    const byAccount = new Map();
    const slot = (id) => {
      const acc = this.ledger.account(id);
      if (!acc) return null;
      if (!byAccount.has(id)) {
        byAccount.set(id, { account: acc.name, currency: acc.currency, moneyIn: 0, moneyOut: 0, transferIn: 0, transferOut: 0 });
      }
      return byAccount.get(id);
    };
    // Amounts are booked in each account's own currency.
    const inAcc = (amount, from, acc) => (acc.currency === from ? amount : this.#fx.convert(amount, from, acc.currency));
    const wanted = new Set(this.filter.accountIds);
    const counts = (id) => !wanted.size || wanted.has(id);

    for (const e of entries) {
      if (e.type === 'transfer') {
        const out = counts(e.fromAccountId) ? slot(e.fromAccountId) : null;
        if (out) out.transferOut += inAcc(e.amount, e.currency, out);
        const into = e.toAccountId && counts(e.toAccountId) ? slot(e.toAccountId) : null;
        if (into) {
          into.transferIn += e.receivedAmount != null && e.receivedCurrency
            ? inAcc(e.receivedAmount, e.receivedCurrency, into)
            : inAcc(e.amount, e.currency, into);
        }
        continue;
      }
      const a = slot(e.accountId);
      if (!a) continue;
      if (e.type === 'income') a.moneyIn += inAcc(e.amount, e.currency, a);
      if (e.type === 'expense') a.moneyOut += inAcc(e.amount, e.currency, a);
    }

    const rows = [...byAccount.values()]
      .map((a) => ({ ...a, net: a.moneyIn - a.moneyOut + a.transferIn - a.transferOut }))
      .sort((a, b) => a.account.localeCompare(b.account, undefined, { sensitivity: 'base' }));

    return new ReportTable({
      title: this.title('Account activity'),
      subtitle: this.subtitle(),
      columns,
      sections: [{ label: null, rows, subtotal: null }],
      notes: ['Amounts are in each account’s own currency.'],
      fileStem: this.fileStem('accounts'),
    });
  }
}
