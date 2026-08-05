/**
 * RecurringService — Generates missing recurring transaction instances.
 *
 * Called once at boot (after the store is initialised) to backfill any
 * recurring transactions that should have been created while the app
 * was offline.
 */
import { Store }           from '../../core/Store.js';
import { IdGenerator }     from './IdGenerator.js';
import { AccountService }  from './AccountService.js';
import { HijriCalendarService } from './HijriCalendarService.js';

export class RecurringService {
  /** @type {Store} */                 #store;
  /** @type {AccountService} */        #accounts;
  /** @type {HijriCalendarService} */ #hijri;

  constructor() {
    this.#store    = Store.getInstance();
    this.#accounts = new AccountService();
    this.#hijri    = new HijriCalendarService();
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

  /** Days in a given local month. @param {number} year @param {number} monthIdx @returns {number} */
  #daysInMonth(year, monthIdx) {
    return new Date(year, monthIdx + 1, 0).getDate();
  }

  /**
   * Advance an ISO date string by one recurrence step.
   *
   * For monthly/yearly rules, the day is anchored to `anchorDay` (the template's
   * original day-of-month) and clamped to the target month's length. Without
   * this, `setMonth` overflows (Jan 31 → Mar 3) and a recurrence that lands on a
   * short month would permanently drift earlier (I4).
   * @param {string} iso
   * @param {'daily'|'weekly'|'monthly'|'yearly'} rule
   * @param {number} [interval=1]
   * @param {number|null} [anchorDay=null]  preferred day-of-month (defaults to iso's day)
   * @returns {string}
   */
  stepDate(iso, rule, interval = 1, anchorDay = null) {
    const d   = new Date(iso + 'T12:00:00');
    const n   = Math.max(1, Number(interval) || 1);
    const day = anchorDay ?? d.getDate();
    if (rule === 'daily')        d.setDate(d.getDate() + n);
    else if (rule === 'weekly')  d.setDate(d.getDate() + 7 * n);
    else if (rule === 'monthly') {
      d.setDate(1);
      d.setMonth(d.getMonth() + n);
      d.setDate(Math.min(day, this.#daysInMonth(d.getFullYear(), d.getMonth())));
    } else if (rule === 'yearly') {
      d.setDate(1);
      d.setFullYear(d.getFullYear() + n);
      d.setDate(Math.min(day, this.#daysInMonth(d.getFullYear(), d.getMonth())));
    }
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
      // Transfers are two paired legs; this generator only clones a single tx,
      // which would orphan a leg with a duplicated transferPairId. The UI blocks
      // recurring transfers, so skip defensively rather than corrupt data (B5).
      if (template.type === 'transfer') continue;

      const { rule, interval } = template.recurring;
      // Anchor monthly/yearly stepping to the template's original day-of-month so
      // it never drifts earlier after a short month (I4).
      const anchorDay = Number(template.date.slice(8, 10)) || 1;

      // Walk the recurrence grid from the TEMPLATE's own date rather than from
      // the latest existing instance. Anchoring on "latest" meant that editing
      // an instance's date backwards, or deleting the newest one, rewound the
      // cursor — regenerating a date that was already occupied (two rows with
      // the same deterministic id) or resurrecting an occurrence the user had
      // deliberately deleted.
      const existingIds = new Set(txs.map((t) => t.id));
      const skipped     = new Set(template.recurring.skipped || []);
      let   next        = this.stepDate(template.date, rule, interval, anchorDay);
      let   safety      = 0;

      while (
        next <= today &&
        (!template.recurring.until || next <= template.recurring.until) &&
        safety++ < 500
      ) {
        const cloneId = `${template.id}__${next}`;
        // Already generated, or explicitly deleted by the user — never re-create.
        if (existingIds.has(cloneId) || skipped.has(next)) {
          next = this.stepDate(next, rule, interval, anchorDay);
          continue;
        }

        const clone = {
          ...template,
          // Deterministic id per (template, date) occurrence so two devices that
          // both backfill the same recurrence collide instead of duplicating.
          id:                cloneId,
          date:              next,
          // Snapshot Hijri date at the moment the instance is generated.
          // Uses current offset — this is intentional: the instance is "new"
          // today, so it should reflect the user's current calendar setting.
          hijriDate:         this.#hijri.toHijri(next),
          recurringSourceId: template.id,
          recurring:         null,
          tags:              (template.tags || []).slice(),
          splits:            template.splits ? template.splits.map((s) => ({ ...s })) : null,
        };

        txs.push(clone);
        existingIds.add(cloneId);
        // Balances are derived; the persist below triggers the recompute hook.
        generated++;
        next = this.stepDate(next, rule, interval, anchorDay);
      }
    }

    if (generated > 0) this.#store.persist();
    return generated;
  }

  /**
   * Record that a generated occurrence was deliberately deleted, so process()
   * never re-creates it.
   *
   * Without this the generator is purely derivative: deleting an instance just
   * leaves a gap it fills again on the next app load, which made the newest
   * occurrence impossible to delete.
   *
   * @param {object} tx  the instance being deleted
   * @returns {boolean}  true when a skip was recorded
   */
  recordSkip(tx) {
    if (!tx?.recurringSourceId) return false;
    const template = this.#store.getState().transactions
      .find((t) => t.id === tx.recurringSourceId);
    if (!template?.recurring) return false;

    if (!Array.isArray(template.recurring.skipped)) template.recurring.skipped = [];
    // Skip the GRID occurrence date — embedded in the deterministic instance id
    // as `<templateId>__<YYYY-MM-DD>` — NOT tx.date. The user may have edited the
    // instance's date; process() matches occurrences on the grid date, so keying
    // the skip on tx.date let an edited-then-deleted instance reappear.
    const m = /__(\d{4}-\d{2}-\d{2})$/.exec(tx.id || '');
    const occ = m ? m[1] : tx.date;
    if (occ && !template.recurring.skipped.includes(occ)) {
      template.recurring.skipped.push(occ);
      return true;
    }
    return false;
  }
}
