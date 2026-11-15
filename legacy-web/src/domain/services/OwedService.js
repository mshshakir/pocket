/**
 * OwedService — everything you have to pay, in one place, for the Debts page
 * ("I owe") and the Dashboard reminders.
 *
 * Nothing is copied: each kind stays where it lives and keeps its own rules.
 *   loans    debts you borrowed (with LoanInstalments when set)
 *   cards    Credit Card accounts with something owed (CardCycle)
 *   bills    "ask me" bills overdue or due today (counted, at last time's
 *            amount) and in the next 7 days (shown, not counted)
 *   vendors  what's owed for deliveries (VendorDues)
 *
 * Totals are in the home currency.
 */
import { CardCycle }       from './CardCycle.js';
import { LoanInstalments } from './LoanInstalments.js';

export class OwedService {
  /** @type {object} */ #store;
  /** @type {object} */ #fx;
  /** @type {() => object} */ #bills;
  /** @type {() => object} */ #vendorDues;
  /** @type {() => object} */ #accounts;

  /**
   * @param {{store:object, fx:object, bills:() => object, vendorDues:() => object, accounts:() => object}} deps
   *   bills / vendorDues / accounts are getters so they can be built after this
   */
  constructor({ store, fx, bills, vendorDues, accounts }) {
    this.#store      = store;
    this.#fx         = fx;
    this.#bills      = bills;
    this.#vendorDues = vendorDues;
    this.#accounts   = accounts;
  }

  /**
   * @param {string} today YYYY-MM-DD
   * @returns {{home:string, loans:object[], cards:object[], bills:object[], vendors:object[],
   *            totals:{loans:number, cards:number, bills:number, vendors:number, all:number}}}
   */
  summary(today) {
    const state = this.#store.getState();
    const home  = state.user?.homeCurrency || 'USD';
    const toHome = (minor, cur) => this.#fx.convert(minor, cur || home, home);

    const loans = (state.debts || [])
      .filter((d) => d.type === 'borrowed' && d.status !== 'paid')
      .map((debt) => {
        const paid = this.paidOn(debt);
        return { debt, paid, remaining: Math.max(0, (debt.principal || 0) - paid), instalments: LoanInstalments.of(debt, paid, today) };
      });

    const cards = (state.accounts || [])
      .filter((a) => CardCycle.isCard(a) && !a.archived)
      .map((account) => ({ account, cycle: this.cardCycle(account, today) }))
      .filter((c) => c.cycle.owed > 0 || c.cycle.billLeft > 0);

    const bills = (this.#bills()?.due(today) ?? [])
      .map((b) => ({ ...b, counted: b.overdue || b.today }));

    const vendors = (this.#vendorDues()?.byVendor(today) ?? [])
      .filter((g) => g.amount > 0)
      .map((g) => ({ vendor: g.vendor, currency: g.currency, amount: g.amount }));

    const totals = {
      loans:   loans.reduce((s, l) => s + toHome(l.remaining, l.debt.currency), 0),
      cards:   cards.reduce((s, c) => s + toHome(c.cycle.owed, c.account.currency), 0),
      bills:   bills.filter((b) => b.counted).reduce((s, b) => s + toHome(b.lastAmount || 0, b.currency), 0),
      vendors: vendors.reduce((s, v) => s + toHome(v.amount, v.currency), 0),
    };
    totals.all = totals.loans + totals.cards + totals.bills + totals.vendors;
    return { home, loans, cards, bills, vendors, totals };
  }

  /**
   * Card bills and loan instalments that need attention: overdue, or due within
   * a few days. For the Dashboard. Oldest date first.
   * @param {string} today
   * @returns {{kind:'card'|'loan', id:string, name:string, date:string, amount:number, currency:string, overdue:boolean}[]}
   */
  reminders(today) {
    const s = this.summary(today);
    const out = [];
    for (const { account, cycle } of s.cards) {
      if (cycle.status === 'overdue' || cycle.status === 'soon') {
        out.push({ kind: 'card', id: account.id, name: account.name, date: cycle.dueDate, amount: cycle.billLeft, currency: account.currency, overdue: cycle.status === 'overdue' });
      }
    }
    for (const { debt, instalments: i } of s.loans) {
      if (i && (i.status === 'overdue' || i.status === 'soon')) {
        out.push({ kind: 'loan', id: debt.id, name: debt.counterparty, date: i.nextDate, amount: i.dueNow, currency: debt.currency, overdue: i.status === 'overdue' });
      }
    }
    return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  /** @param {object} account @param {string} today */
  cardCycle(account, today) {
    const balance = this.#accounts()?.balanceOf?.(account) ?? account.balance ?? 0;
    return CardCycle.of(account, balance, this.#store.getState().transactions, today, this.#fx);
  }

  /**
   * What's been repaid on a debt, in its own currency (payments in other
   * currencies converted). Same rule as the Debts page has always used.
   * @param {object} debt
   */
  paidOn(debt) {
    return (this.#store.getState().transactions || [])
      .filter((t) => t.debtId === debt.id && t.id !== debt.initialTxId)
      .reduce((s, t) => s + this.#fx.convert(t.amount, t.currency || debt.currency, debt.currency), 0);
  }
}
