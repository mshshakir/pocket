/**
 * EntryDate — a date typed in a message, day first as written in India:
 *
 *   8/11        → 8 November this year; a date up to 30 days ahead is taken
 *                 as a typo and refused, one further ahead means last year
 *                 (so 28/12 sent in January is last December)
 *   8/11/2026   → 8 November 2026 (a two-digit year, 8/11/26, works too)
 *
 * Only slash dates count, so words like "oct 2026" stay in the note.
 * Future dates are refused, in case of a typo.
 */
export type DateResolution = { ok: true; iso: string } | { ok: false; reason: string };

export class EntryDate {
  static readonly #PATTERN = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?$/;
  static readonly #TYPO_WINDOW_DAYS = 30;

  readonly #day: number;
  readonly #month: number;
  readonly #year: number | null;
  readonly #typed: string;

  private constructor(day: number, month: number, year: number | null, typed: string) {
    this.#day = day;
    this.#month = month;
    this.#year = year;
    this.#typed = typed;
  }

  /** Whether a word is written like a date (it may still not be a real one). */
  static looksLikeDate(word: string): boolean {
    return EntryDate.#PATTERN.test(word);
  }

  /** The date in a word, null if it isn't written like one, or a reason if it isn't a real date. */
  static parse(word: string): EntryDate | null | { invalid: string } {
    const m = EntryDate.#PATTERN.exec(word);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    // Check against a leap year when no year is given, so 29/02 is allowed.
    if (!EntryDate.#exists(year ?? 2024, month, day)) {
      return { invalid: `${word} isn't a real date. Write the day first, then the month, e.g. 8/11 for 8 November.` };
    }
    return new EntryDate(day, month, year, word);
  }

  /** The ISO date, given today's ISO date in the bot's time zone. */
  resolve(todayIso: string): DateResolution {
    const [ty] = todayIso.split('-').map(Number);
    let year = this.#year ?? ty;
    let iso = EntryDate.#iso(year, this.#month, this.#day);
    if (this.#year === null && iso > todayIso && EntryDate.#daysBetween(todayIso, iso) > EntryDate.#TYPO_WINDOW_DAYS) {
      year -= 1; // well ahead: they mean last year's
      iso = EntryDate.#iso(year, this.#month, this.#day);
    }
    if (!EntryDate.#exists(year, this.#month, this.#day)) {
      return { ok: false, reason: `${this.#typed} isn't a real date in ${year}.` };
    }
    if (iso > todayIso) {
      return { ok: false, reason: `${this.#typed} is in the future. Entries can only be dated today or earlier.` };
    }
    return { ok: true, iso };
  }

  static #exists(year: number, month: number, day: number): boolean {
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  }

  static #daysBetween(fromIso: string, toIso: string): number {
    return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
  }

  static #iso(year: number, month: number, day: number): string {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
}
