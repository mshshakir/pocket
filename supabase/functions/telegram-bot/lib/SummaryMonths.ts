/**
 * SummaryMonths — the month a day belongs to, by a group's chosen calendar:
 *   gregorian  October 2026 = 2026-10-01 … 2026-10-31
 *   hijri      Rabi al-Aakhar 1448, by the same tables as the app and the
 *              book owner's Hijri offset, so it matches the app's dates.
 * Months are given as Gregorian date ranges, which is what the database sums.
 */
import { HijriCalendar } from './HijriCalendar.ts';
import { LocalClock } from './LocalClock.ts';

export type CalendarKind = 'gregorian' | 'hijri';

export interface MonthPeriod {
  from: string;  // first day, YYYY-MM-DD
  to: string;    // last day
  label: string; // "October 2026" / "Rabi al-Aakhar 1448"
  short: string; // "October" / "Rabi al-Awwal", for "(September ₹55,100 …)"
}

export abstract class SummaryMonths {
  static for(calendar: CalendarKind, hijriOffset = 0): SummaryMonths {
    return calendar === 'hijri' ? new HijriMonths(hijriOffset) : new GregorianMonths();
  }

  abstract month(day: string): MonthPeriod;

  /** Is this the last day of its month? (the monthly summary goes out then) */
  isLastDay(day: string): boolean {
    return this.month(day).to === day;
  }

  previous(m: MonthPeriod): MonthPeriod {
    return this.month(LocalClock.shift(m.from, -1));
  }
}

class GregorianMonths extends SummaryMonths {
  month(day: string): MonthPeriod {
    const [y, m] = day.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const last = new Date(Date.UTC(y, m, 0));
    const name = first.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), label: `${name} ${y}`, short: name };
  }
}

class HijriMonths extends SummaryMonths {
  readonly #cal: HijriCalendar;

  constructor(offset: number) {
    super();
    this.#cal = new HijriCalendar(offset);
  }

  month(day: string): MonthPeriod {
    const h = this.#cal.toHijri(day);
    let from = day;
    for (let i = 0; i < 31 && this.#cal.toHijri(from).day !== 1; i++) from = LocalClock.shift(from, -1);
    let to = day;
    for (let i = 0; i < 31 && this.#cal.toHijri(LocalClock.shift(to, 1)).day !== 1; i++) to = LocalClock.shift(to, 1);
    const name = HijriCalendar.MONTHS[h.month] ?? '';
    return { from, to, label: `${name} ${h.year}`, short: name };
  }
}
