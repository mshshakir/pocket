/**
 * DateService — Timezone-safe local-date helpers.
 *
 * `new Date().toISOString().slice(0, 10)` converts to UTC first, so in any
 * non-UTC timezone it can return the wrong calendar day (e.g. late evening in
 * UTC+ offsets rolls forward, early morning rolls back). The app stores
 * transaction dates as local 'YYYY-MM-DD' strings, so all "today" / date-key
 * derivation must use LOCAL components. These static helpers are the single
 * source of truth for that conversion.
 */
export class DateService {
  /**
   * Format a Date as a local 'YYYY-MM-DD' string. Pass-through for strings.
   * @param {Date|string} d
   * @returns {string}
   */
  static toIso(d) {
    if (!(d instanceof Date)) return d;
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Today's local date as 'YYYY-MM-DD'.
   * @returns {string}
   */
  static todayIso() {
    return this.toIso(new Date());
  }
}
