/**
 * HijriCalendar — server-side port of the app's HijriCalendarService
 * (mobile-app/src/domain/services/HijriCalendarService.js), so a transaction
 * logged from Telegram carries exactly the hijriDate snapshot the app would
 * have produced. Month index is 0-based, as in the app.
 *
 * Keep the tables and arithmetic in step with the app's copy.
 */
export interface HijriDate {
  year: number;
  month: number;
  day: number;
  offset: number;
}

export class HijriCalendar {
  static readonly #DAYS_IN_YEAR = [30, 59, 89, 118, 148, 177, 207, 236, 266, 295, 325];
  static readonly #DAYS_IN_30 = [
    354, 708, 1063, 1417, 1771, 2126, 2480, 2834, 3189, 3543, 3898, 4252, 4606, 4961,
    5315, 5669, 6024, 6378, 6732, 7087, 7441, 7796, 8150, 8504, 8859, 9213, 9567, 9922, 10276, 10631,
  ];
  static readonly MONTHS = [
    'Moharram al-Haraam', 'Safar al-Muzaffar', 'Rabi al-Awwal', 'Rabi al-Aakhar',
    'Jumada al-Ula', 'Jumada al-Ukhra', 'Rajab al-Asab', 'Shabaan al-Karim',
    'Ramadaan al-Moazzam', 'Shawwal al-Mukarram', 'Zilqadah al-Haraam', 'Zilhaj al-Haraam',
  ];

  readonly #offset: number;

  /** @param offset the owner's hijriOffset preference (−7 … +7) */
  constructor(offset = 0) {
    this.#offset = Number.isFinite(offset) ? offset : 0;
  }

  /** Convert an ISO 'YYYY-MM-DD' date, at local noon as the app does. */
  toHijri(isoDate: string): HijriDate {
    const [y, m, d] = isoDate.split('-').map(Number);
    const noon = Date.UTC(y, m - 1, d, 12) + this.#offset * 86_400_000;
    const shifted = new Date(noon);
    const ajd = HijriCalendar.#gregorianToAJD(
      shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate() + 0.5,
    );
    return { ...HijriCalendar.#ajdToHijri(ajd), offset: this.#offset };
  }

  /** Human label, e.g. "1 Rabi al-Awwal 1448". */
  label(h: HijriDate): string {
    return `${h.day} ${HijriCalendar.MONTHS[h.month] ?? ''} ${h.year}`;
  }

  static #gregorianToAJD(year: number, month: number, dayWithFraction: number): number {
    let y = year;
    let m = month;
    if (m < 3) { y--; m += 12; }
    const a = Math.floor(y / 100);
    const b = 2 - a + Math.floor(a / 4); // all bot dates are post-1582 Gregorian
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + dayWithFraction + b - 1524.5;
  }

  static #ajdToHijri(ajd: number): { year: number; month: number; day: number } {
    const d30 = HijriCalendar.#DAYS_IN_30;
    const dYr = HijriCalendar.#DAYS_IN_YEAR;
    let i = 0;
    let left = Math.floor(ajd - 1948083.5);
    const y30 = Math.floor(left / 10631);
    left -= y30 * 10631;
    while (left > d30[i]) i++;
    const year = Math.round(y30 * 30 + i);
    if (i > 0) left -= d30[i - 1];
    i = 0;
    while (left > dYr[i]) i++;
    const month = Math.round(i);
    const day = i > 0 ? Math.round(left - dYr[i - 1]) : Math.round(left);
    return { year, month, day };
  }
}
