/**
 * RecurringService — Generates missing recurring transaction instances.
 *
 * Called once at boot (after store is initialised) to backfill any
 * recurring transactions that should have been created while the app
 * was offline.
 */
import { Store }           from '../../core/Store.js';
import { IdGenerator }     from './IdGenerator.js';
import { AccountService }  from './AccountService.js';

export class RecurringService {
  /** @type {Store} */          #store;
  /** @type {AccountService} */ #accounts;

  constructor() {
    this.#store    = Store.getInstance();
    this.#accounts = new AccountService();
  }

  // ── Date helpers ─────────────────────────────────────────────────────

  /**
   * ISO date string for a given JS Date.
   * @param {Date} d
   * @returns {string}
   */
  #isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Advance an ISO date string by one recurrence step.
   * @param {string} iso
   * @param {'daily'|'weekly'|'monthly'|'yearly'} rule
   * @param {number} [interval=1]
   * @returns {string}
   */
  stepDate(iso, rule, interval = 1) {
    const d        = new Date(iso + 'T12:00:00');
    const n        = Math.max(1, Number(interval) || 1);
    if (rule === 'daily')        d.setDate(d.getDate() + n);
    else if (rule === 'weekly')  d.setDate(d.getDate() + 7 * n);
    else if (rule === 'monthly') d.setMonth(d.getMonth() + n);
    else if (rule === 'yearly')  d.setFullYear(d.getFullYear() + n);
    return this.#isoDate(d);
  }

  // ── Main entry ───────────────────────────────────────────────────────

  /**
   * Scan all recurring templates and generate any missing instances up to today.
   * @returns {number} number of transactions generated
   */
  process() {
    const state   = this.#store.getState();
    const today   = this.#isoDate(new Date());
    const txs     = state.transactions;
    const templates = txs.filter((t) => t.recurring && !t.recurringSourceId);

    let generated = 0;

    for (const template of templates) {
      const instances = txs.filter((t) => t.recurringSourceId === template.id);
      const dates     = [template.date, ...instances.map((i) => i.date)].sort();
      let   latest    = dates[dates.length - 1];
      let   next      = this.stepDate(latest, template.recurring.rule, template.recurring.interval);
      let   safety    = 0;

      while (
        next <= today &&
        (!template.recurring.until || next <= template.recurring.until) &&
        safety++ < 500
      ) {
        const clone = {
          ...template,
          id:                IdGenerator.generate('tx'),
          date:              next,
          recurringSourceId: template.id,
          recurring:         null,
          tags:              (template.tags || []).slice(),
          splits:            template.splits ? template.splits.map((s) => ({ ...s })) : null,
        };

        txs.push(clone);
        this.#accounts.applyBalances(clone);
        generated++;
        next = this.stepDate(next, template.recurring.rule, template.recurring.interval);
      }
    }

    if (generated > 0) this.#store.persist();
    return generated;
  }
}
