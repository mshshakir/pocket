/**
 * LoanInstalments — a loan paid back in fixed monthly amounts (a bank or car
 * loan), as opposed to one repaid whenever (a loan from a friend).
 *
 * A debt may carry (all optional, flat so they sync as plain fields):
 *   instalmentAmount  minor units, in the debt's currency
 *   instalmentDay     1–31, the day each month it's due
 *   instalmentCount   how many instalments in all
 * The first instalment is the first `instalmentDay` after the date taken.
 *
 * Payments are the debt's ordinary payment entries; any amount counts, so
 * paying extra moves you ahead and paying less leaves you behind.
 *
 * Pure: no Store, no DOM.
 */
import { CardCycle } from './CardCycle.js';

export class LoanInstalments {
  /** Days before the next date when an instalment counts as "due soon". */
  static SOON = 5;

  /** @param {object} debt */
  static has(debt) {
    return Number(debt?.instalmentAmount) > 0 && Number(debt?.instalmentDay) >= 1 && Number(debt?.instalmentCount) >= 1;
  }

  /**
   * Where a loan stands against its instalments.
   * @param {object} debt
   * @param {number} paid  total repaid so far, minor units in the debt's currency
   * @param {string} today YYYY-MM-DD
   * @returns {null|{amount:number, count:number, paidCount:number, dates:string[],
   *   nextDate:string|null, behind:number, dueNow:number, status:'done'|'overdue'|'soon'|'open'}}
   *   behind  how much of what's fallen due by today is still unpaid
   *   dueNow  what to pay next: what's behind, else one instalment
   */
  static of(debt, paid, today) {
    if (!LoanInstalments.has(debt)) return null;
    const amount = Math.round(debt.instalmentAmount);
    const count  = Math.round(debt.instalmentCount);
    const dates  = LoanInstalments.dates(debt);
    const remaining = Math.max(0, (debt.principal || 0) - paid);
    const paidCount = Math.min(count, Math.floor((paid + 1) / amount));
    const fallen    = dates.filter((d) => d <= today).length;
    const owedByNow = Math.min(debt.principal || Infinity, fallen * amount);
    const behind    = Math.max(0, Math.min(remaining, owedByNow - paid));
    const nextDate  = remaining <= 0 ? null : (dates[paidCount] ?? dates.at(-1));
    const dueNow    = remaining <= 0 ? 0 : Math.min(remaining, behind || amount);
    const status = remaining <= 0 || debt.status === 'paid' ? 'done'
      : behind > 0 ? 'overdue'
      : nextDate && CardCycle.daysUntil(today, nextDate) <= LoanInstalments.SOON ? 'soon'
      : 'open';
    return { amount, count, paidCount, dates, nextDate, behind, dueNow, status };
  }

  /** Every instalment date, oldest first. */
  static dates(debt) {
    if (!LoanInstalments.has(debt)) return [];
    const day = Math.round(debt.instalmentDay);
    const out = [];
    let d = CardCycle.nextAfter(day, debt.dateTaken || '1970-01-01');
    for (let i = 0; i < Math.round(debt.instalmentCount) && i < 600; i++) {
      out.push(d);
      d = CardCycle.nextAfter(day, d);
    }
    return out;
  }
}
