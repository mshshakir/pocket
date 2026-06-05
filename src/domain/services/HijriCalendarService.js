/**
 * HijriCalendarService — Hijri/Gregorian calendar conversions.
 *
 * Ported from mumineen_calendar_js (MIT).  All computation is pure;
 * no DOM, no state, no side effects.
 *
 * Month index is 0-based:  0 = Moharram … 11 = Zilhaj
 */
import {
  HIJRI_MONTHS_LONG,
  HIJRI_MONTHS_SHORT,
  HIJRI_KABISA_REM,
  HIJRI_DAYS_IN_YEAR,
  HIJRI_DAYS_IN_30,
  MIQAATS,
} from '../../data/constants.js';
import { Store } from '../../core/Store.js';

export class HijriCalendarService {
  /** @type {Store} */
  #store;

  constructor() {
    // Use the singleton Store to read user's hijriOffset preference.
    // HijriCalendarService is a pure computation service; the offset
    // is the only stateful value it reads, and it reads it lazily on
    // each toHijri() call so changes take effect immediately.
    this.#store = Store.getInstance();
  }

  /**
   * The user-configured day offset (−7 … +7).
   * Positive = add days to the calculated date.
   * Negative = subtract days.
   * @returns {number}
   */
  get offset() {
    return this.#store.getState().user?.hijriOffset ?? 0;
  }

  // ── Julian / Gregorian helpers ──────────────────────────────────────

  /** @param {Date} d @returns {boolean} */
  #isJulian(d) {
    if (d.getFullYear() < 1582) return true;
    if (d.getFullYear() === 1582) {
      if (d.getMonth()  <  9)  return true;
      if (d.getMonth() === 9 && d.getDate() < 5) return true;
    }
    return false;
  }

  /**
   * Convert a JS Date to Astronomical Julian Day Number.
   * @param {Date} d
   * @returns {number}
   */
  #gregorianToAJD(d) {
    let y = d.getFullYear();
    let m = d.getMonth() + 1;
    const day =
      d.getDate() +
      d.getHours()        / 24 +
      d.getMinutes()      / 1440 +
      d.getSeconds()      / 86400 +
      d.getMilliseconds() / 86400000;

    if (m < 3) { y--; m += 12; }

    const a = Math.floor(y / 100);
    const b = this.#isJulian(d) ? 0 : 2 - a + Math.floor(a / 4);

    return (
      Math.floor(365.25  * (y + 4716)) +
      Math.floor(30.6001 * (m + 1)) +
      day + b - 1524.5
    );
  }

  /** @param {number} ajd @returns {{ year, month, day }} */
  #ajdToHijri(ajd) {
    let i    = 0;
    let left = Math.floor(ajd - 1948083.5);
    const y30 = Math.floor(left / 10631);
    left -= y30 * 10631;

    while (left > HIJRI_DAYS_IN_30[i]) i++;
    const year = Math.round(y30 * 30 + i);
    if (i > 0) left -= HIJRI_DAYS_IN_30[i - 1];

    i = 0;
    while (left > HIJRI_DAYS_IN_YEAR[i]) i++;
    const month = Math.round(i);
    const day   = i > 0
      ? Math.round(left - HIJRI_DAYS_IN_YEAR[i - 1])
      : Math.round(left);

    return { year, month, day };
  }

  /** @param {number} year @returns {boolean} */
  #isKabisa(year) {
    return HIJRI_KABISA_REM.includes(year % 30);
  }

  /** @param {number} year @param {number} month @returns {number} */
  daysInMonth(year, month) {
    return (month === 11 && this.#isKabisa(year)) || month % 2 === 0 ? 30 : 29;
  }

  // ── Hijri → AJD → Gregorian ─────────────────────────────────────────

  /** @param {number} year @param {number} month @param {number} day @returns {number} AJD */
  #hijriToAJD(year, month, day) {
    const y30 = Math.floor(year / 30);
    let ajd   = 1948083.5 + y30 * 10631;
    const doy = month === 0 ? day : HIJRI_DAYS_IN_YEAR[month - 1] + day;
    ajd += doy;
    if (year % 30 !== 0) ajd += HIJRI_DAYS_IN_30[year - y30 * 30 - 1];
    return ajd;
  }

  /** @param {number} ajd @returns {Date} */
  #ajdToGregorian(ajd) {
    const z = Math.floor(ajd + 0.5);
    const f = ajd + 0.5 - z;
    let a;
    if (z < 2299161) {
      a = z;
    } else {
      const alpha = Math.floor((z - 1867216.25) / 36524.25);
      a = z + 1 + alpha - Math.floor(alpha / 4);
    }
    const b = a + 1524;
    const c = Math.floor((b - 122.1) / 365.25);
    const d = Math.floor(365.25 * c);
    const e = Math.floor((b - d) / 30.6001);

    let day   = b - d - Math.floor(30.6001 * e) + f;
    day       = Math.floor(day);
    const month = e < 14 ? e - 2 : e - 14;
    const year  = month < 2 ? c - 4715 : c - 4716;
    return new Date(year, month, day, 12, 0, 0);
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Convert a Gregorian date to Hijri.
   * @param {Date|string} input  JS Date or ISO 'YYYY-MM-DD' string
   * @returns {{ year: number, month: number, day: number }}
   */
  toHijri(input) {
    const d = typeof input === 'string'
      ? new Date(input + 'T12:00:00')
      : input;
    const offset = this.offset;
    // Apply user's day offset by shifting the date before conversion.
    // Multiply by 86_400_000 ms (one day) and create a new Date so the
    // original value is never mutated.
    const shifted = offset !== 0
      ? new Date(d.getTime() + offset * 86_400_000)
      : d;
    return this.#ajdToHijri(this.#gregorianToAJD(shifted));
  }

  /**
   * Convert a Gregorian date to Hijri WITHOUT applying the user's offset.
   * Used exclusively for back-filling hijriDate on transactions that were
   * created before the offset system existed, where offset was implicitly 0.
   * @param {Date|string} input
   * @returns {{ year: number, month: number, day: number }}
   */
  toHijriRaw(input) {
    const d = typeof input === 'string'
      ? new Date(input + 'T12:00:00')
      : input;
    return this.#ajdToHijri(this.#gregorianToAJD(d));
  }

  /**
   * Convert a Hijri date to Gregorian.
   * @param {number} year
   * @param {number} month  0-based
   * @param {number} day
   * @returns {Date}
   */
  toGregorian(year, month, day) {
    return this.#ajdToGregorian(this.#hijriToAJD(year, month, day));
  }

  /**
   * Format a Hijri date as a human-readable string.
   * @param {Date|string|{year,month,day}} input
   * @param {object} [opts]
   * @param {boolean} [opts.long=false]
   * @param {boolean} [opts.withYear=true]
   * @param {boolean} [opts.ah=false]  append "AH" vs "H"
   * @returns {string}
   */
  format(input, { long = false, withYear = true, ah = false } = {}) {
    const h =
      input && typeof input === 'object' && 'year' in input
        ? input
        : this.toHijri(input);
    const monthNames = long ? HIJRI_MONTHS_LONG : HIJRI_MONTHS_SHORT;
    const suffix     = withYear ? ` ${h.year}${ah ? ' AH' : 'H'}` : '';
    return `${h.day} ${monthNames[h.month]}${suffix}`;
  }

  // ── Miqaat helpers ──────────────────────────────────────────────────

  /**
   * Return miqaats for a given Hijri date.
   * @param {{ month: number, day: number }} h
   * @returns {Array<{t: string, p: number}>}
   */
  miqaatsFor(h) {
    if (!h) return [];
    return MIQAATS[`${h.month}-${h.day}`] || [];
  }

  /**
   * Return miqaats for a Gregorian date.
   * @param {Date|string} gregorian
   * @returns {Array<{t: string, p: number}>}
   */
  miqaatsForGregorian(gregorian) {
    return this.miqaatsFor(this.toHijri(gregorian));
  }

  /**
   * Return the highest-priority miqaat in a list.
   * @param {Array<{t: string, p: number}>} list
   * @returns {{t: string, p: number}|null}
   */
  topMiqaat(list) {
    if (!list?.length) return null;
    return list.slice().sort((a, b) => a.p - b.p)[0];
  }

  get monthsLong()  { return HIJRI_MONTHS_LONG;  }
  get monthsShort() { return HIJRI_MONTHS_SHORT; }
}
