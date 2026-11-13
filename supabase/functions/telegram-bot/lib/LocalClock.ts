/** LocalClock — today's date (or N days ago) as YYYY-MM-DD in a fixed time zone. */
export class LocalClock {
  readonly #timeZone: string;

  constructor(timeZone: string) {
    this.#timeZone = timeZone;
  }

  isoDate(daysAgo = 0): string {
    const when = new Date(Date.now() - daysAgo * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.#timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(when);
  }
}
