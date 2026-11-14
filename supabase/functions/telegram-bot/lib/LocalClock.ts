/**
 * LocalClock — dates and times in a fixed time zone: today as YYYY-MM-DD,
 * the hour and the day of the week (for scheduled summaries).
 */
export class LocalClock {
  readonly #timeZone: string;
  readonly #now: () => number;

  /** @param now the current time in ms (replaceable in tests) */
  constructor(timeZone: string, now: () => number = Date.now) {
    this.#timeZone = timeZone;
    this.#now = now;
  }

  isoDate(daysAgo = 0): string {
    const when = new Date(this.#now() - daysAgo * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.#timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(when);
  }

  /** The hour of the day, 0–23. */
  hour(): number {
    const h = new Intl.DateTimeFormat('en-GB', { timeZone: this.#timeZone, hour: '2-digit', hourCycle: 'h23' })
      .format(new Date(this.#now()));
    return Number(h);
  }

  /** The day of the week of today, 0 = Sunday … 6 = Saturday. */
  weekday(): number {
    return LocalClock.weekdayOf(this.isoDate());
  }

  static weekdayOf(isoDate: string): number {
    return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  }

  /** A YYYY-MM-DD date moved by a number of days. */
  static shift(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
