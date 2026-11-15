/**
 * BillDates — when a recurring bill (marked "amount changes, ask me") falls
 * due, the same way as the app's RecurringService.stepDate: monthly and yearly
 * dates keep the first entry's day of the month, clamped to short months, and
 * an occurrence is open until it's paid (a copy "<id>__<date>") or skipped.
 */
import type { BillTemplate } from './DeliveryStore.ts';

export class BillDates {
  /** The date one step after `iso`. */
  static step(iso: string, rule: BillTemplate['rule'], interval = 1, anchorDay: number | null = null): string {
    const [y, m, d] = iso.split('-').map(Number);
    const n = Math.max(1, Number(interval) || 1);
    const day = anchorDay ?? d;
    let date: Date;
    if (rule === 'daily') date = new Date(Date.UTC(y, m - 1, d + n));
    else if (rule === 'weekly') date = new Date(Date.UTC(y, m - 1, d + 7 * n));
    else {
      const months = rule === 'yearly' ? 12 * n : n;
      const first = new Date(Date.UTC(y, m - 1 + months, 1));
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last)));
    }
    return date.toISOString().slice(0, 10);
  }

  /** Occurrences not paid or skipped, from the first to `until` (inclusive), oldest first. */
  static open(t: BillTemplate, until: string): string[] {
    const anchor = Number(t.date.slice(8, 10)) || 1;
    const done = new Set([...(t.paid ?? []), ...(t.skipped ?? [])]);
    const out: string[] = [];
    let next = BillDates.step(t.date, t.rule, t.interval ?? 1, anchor);
    for (let i = 0; next <= until && (!t.until || next <= t.until) && i < 400; i++) {
      if (!done.has(next)) out.push(next);
      next = BillDates.step(next, t.rule, t.interval ?? 1, anchor);
    }
    return out;
  }
}
