/**
 * SummaryYears — a group's year for the yearly summary, ending on the date it
 * chose in its calendar: 31 December (or the last day of Zilhaj) by default,
 * or e.g. 31 March for a financial year. A day past a month's length means
 * its last day (31 February → 28/29 February, 30 Zilhaj → 29 or 30).
 *
 *   "31 mar", "March 31", "31/3", "last day of march", "29 zilhaj", "end zilhaj"
 */
import { LocalClock } from './LocalClock.ts';
import { PocketBook } from './PocketBook.ts';
import type { CalendarKind, SummaryMonths } from './SummaryMonths.ts';
import { HijriCalendar } from './HijriCalendar.ts';

export interface YearEnd {
  month: number; // 1–12 in the calendar
  day: number;   // 1–31; past the month's end = its last day
}

export interface YearPeriod {
  from: string;
  to: string;
  label: string; // "2026", "1447 H", or "April 2025 – March 2026"
}

export class SummaryYears {
  static readonly DEFAULT: YearEnd = { month: 12, day: 31 };
  static readonly #GREGORIAN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  static readonly #HIJRI_EXTRA: Record<string, number> = {
    muharram: 1, moharram: 1, rabi1: 3, rabiulawwal: 3, rabi2: 4, rabiulakhir: 4, rabiussani: 4,
    jumada1: 5, jamadilawwal: 5, jumada2: 6, jamadilakhir: 6, shaban: 8, ramadan: 9, ramzan: 9,
    zilqad: 11, dhulqadah: 11, zulqadah: 11, zilhaj: 12, zilhijja: 12, dhulhijjah: 12, zulhijjah: 12,
  };

  readonly #months: SummaryMonths;
  readonly #end: YearEnd;

  constructor(months: SummaryMonths, end: YearEnd = SummaryYears.DEFAULT) {
    this.#months = months;
    this.#end = end;
  }

  get calendar(): CalendarKind { return this.#months.kind; }

  /** Is this the last day of a year? (the yearly summary goes out then) */
  isYearEnd(day: string): boolean {
    const pos = this.#months.position(day);
    if (pos.month !== this.#end.month) return false;
    const m = this.#months.month(day);
    const length = SummaryYears.#days(m.from, m.to);
    return pos.day === Math.min(this.#end.day, length);
  }

  /** The year ending on `lastDay`. */
  period(lastDay: string): YearPeriod {
    const from = LocalClock.shift(this.#endBefore(lastDay), 1);
    return { from, to: lastDay, label: this.#label(from, lastDay) };
  }

  previous(p: YearPeriod): YearPeriod {
    return this.period(LocalClock.shift(p.from, -1));
  }

  /** "31 March", "last day of Zilhaj al-Haraam" */
  describe(): string {
    const name = this.#months.names[this.#end.month - 1];
    return this.#end.day >= 29 && (this.calendar === 'hijri' || this.#end.day === 31)
      ? `the last day of ${name}`
      : `${this.#end.day} ${name}`;
  }

  /** Parses a typed year-end; the calendar is taken from a month's name, else null (the group's). */
  static parse(typed: string): (YearEnd & { calendar: CalendarKind | null }) | null {
    const words = typed.toLowerCase().replace(/(\d)\s*(st|nd|rd|th)\b/g, '$1').split(/[\s,/.-]+/).filter(Boolean)
      .filter((w) => !['of', 'the', 'day'].includes(w));
    let day: number | null = null, month: number | null = null, calendar: CalendarKind | null = null;
    for (const w of words) {
      if (w === 'last' || w === 'end') { day = 31; continue; }
      if (/^\d{1,2}$/.test(w)) {
        const n = Number(w);
        if (day === null) day = n; else if (month === null) month = n; else return null;
        continue;
      }
      const g = SummaryYears.#GREGORIAN.findIndex((m) => m.startsWith(w) && w.length >= 3);
      if (g >= 0 && month === null) { month = g + 1; calendar = 'gregorian'; continue; }
      const h = SummaryYears.#hijriMonth(w);
      if (h && month === null) { month = h; calendar = 'hijri'; continue; }
      return null;
    }
    if (day === null && month !== null) day = 31; // "march" = the end of March
    if (day === null || month === null || day < 1 || day > 31 || month < 1 || month > 12) return null;
    return { month, day, calendar };
  }

  static #hijriMonth(word: string): number | null {
    const w = PocketBook.squash(word);
    if (w.length < 3) return null;
    if (SummaryYears.#HIJRI_EXTRA[w]) return SummaryYears.#HIJRI_EXTRA[w];
    const hits = HijriCalendar.MONTHS.map((m, i) => ({ key: PocketBook.squash(m), n: i + 1 })).filter((m) => m.key.startsWith(w));
    return hits.length === 1 ? hits[0].n : null;
  }

  /** The year end before `day` (a year earlier, give or take the calendar's length). */
  #endBefore(day: string): string {
    for (let back = 340; back <= 400; back++) {
      const d = LocalClock.shift(day, -back);
      if (this.isYearEnd(d)) return d;
    }
    return LocalClock.shift(day, this.calendar === 'hijri' ? -354 : -365);
  }

  #label(from: string, to: string): string {
    const a = this.#months.position(from), b = this.#months.position(to);
    if (a.month === 1 && a.day === 1 && b.month === 12) return this.calendar === 'hijri' ? `${b.year} H` : `${b.year}`;
    return `${this.#months.month(from).label} – ${this.#months.month(to).label}`;
  }

  static #days(from: string, to: string): number {
    return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  }
}
