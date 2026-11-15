/**
 * BillService — recurring entries marked "amount changes, ask me" (askFirst).
 *
 * An ordinary recurring entry is copied automatically on each date
 * (RecurringService). A bill isn't: each occurrence waits as "due" until it is
 *   paid    a copy with the usual deterministic id "<template>__<date>", dated
 *           the day it was paid, with the amount actually paid; or
 *   skipped the date goes into recurring.skipped (the existing mechanism).
 * So nothing counts as spent until it really is, and the bot (which reminds
 * from the server) and every device agree on what's paid.
 */
export class BillService {
  /** Days ahead that count as "coming up". */
  static AHEAD = 7;

  /** @type {{getState: () => object}} */ #store;
  /** @type {{stepDate: Function}} */ #recurring;

  /**
   * @param {{store: object, recurring: {stepDate: (iso: string, rule: string, interval: number, anchorDay: number) => string}}} deps
   */
  constructor({ store, recurring }) {
    this.#store = store;
    this.#recurring = recurring;
  }

  /** Templates of bills (askFirst, not a copy, not a transfer). */
  templates() {
    return (this.#store.getState().transactions || [])
      .filter((t) => t.recurring && t.askFirst === true && !t.recurringSourceId && t.type !== 'transfer');
  }

  /**
   * Occurrences not yet paid or skipped, up to `today + AHEAD` days, oldest first:
   * [{ template, date, overdue, today, lastAmount, currency }]
   * @param {string} today YYYY-MM-DD
   */
  due(today) {
    const until = BillService.#addDays(today, BillService.AHEAD);
    const ids = new Set((this.#store.getState().transactions || []).map((t) => t.id));
    const out = [];
    for (const t of this.templates()) {
      const { rule, interval = 1 } = t.recurring;
      const anchor = Number(t.date.slice(8, 10)) || 1;
      const skipped = new Set(t.recurring.skipped || []);
      let next = this.#recurring.stepDate(t.date, rule, interval, anchor);
      for (let i = 0; next <= until && (!t.recurring.until || next <= t.recurring.until) && i < 400; i++) {
        if (!ids.has(`${t.id}__${next}`) && !skipped.has(next)) {
          out.push({ template: t, date: next, overdue: next < today, today: next === today, lastAmount: this.lastAmount(t), currency: t.currency });
        }
        next = this.#recurring.stepDate(next, rule, interval, anchor);
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** What was paid last time (the template's amount before any payment). */
  lastAmount(template) {
    const paid = (this.#store.getState().transactions || [])
      .filter((t) => t.recurringSourceId === template.id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return paid[0]?.amount ?? template.amount;
  }

  /**
   * Records an occurrence as paid. The copy carries the template's account,
   * category and payee unless given; its id ties it to the occurrence.
   * @param {object} template
   * @param {string} occurrence   the due date being paid (YYYY-MM-DD)
   * @param {{amount: number, accountId?: string, paidOn: string, hijriDate?: object, refAmount?: number, exchangeRate?: number}} p
   * @returns {object} the new entry
   */
  pay(template, occurrence, p) {
    const state = this.#store.getState();
    const id = `${template.id}__${occurrence}`;
    if (state.transactions.some((t) => t.id === id)) throw new Error('Already paid');
    const { recurring, askFirst, remindTo, remindEmail, remindDays, acctMinor, ...rest } = template;
    const copy = {
      ...rest,
      id,
      date:              p.paidOn,
      hijriDate:         p.hijriDate ?? template.hijriDate,
      amount:            p.amount,
      refAmount:         p.refAmount ?? p.amount,
      exchangeRate:      p.exchangeRate ?? template.exchangeRate,
      accountId:         p.accountId || template.accountId,
      recurringSourceId: template.id,
      recurring:         null,
      splits:            null,
      tags:              (template.tags || []).slice(),
      createdAt:         new Date().toISOString(),
      note:              template.note || '',
    };
    state.transactions.push(copy);
    return copy;
  }

  /** Marks an occurrence as skipped (nothing to pay this time). */
  skip(template, occurrence) {
    const skipped = new Set(template.recurring.skipped || []);
    skipped.add(occurrence);
    template.recurring = { ...template.recurring, skipped: [...skipped].sort() };
  }

  static #addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
}
