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

  /**
   * Format a stored 'YYYY-MM-DD' per the user's preference (web BaseView parity).
   * @param {string} iso
   * @param {'auto'|'ymd'|'mdy'|'dmy'} [fmt='auto']
   * @returns {string}
   */
  static format(iso, fmt = 'auto') {
    if (!iso || typeof iso !== 'string') return iso || '';
    const [y, m, d] = iso.split('-');
    if (fmt === 'ymd') return `${y}-${m}-${d}`;
    if (fmt === 'mdy') return `${m}/${d}/${y}`;
    if (fmt === 'dmy') return `${d}/${m}/${y}`;
    // auto → locale medium date
    const dt = new Date(`${iso}T12:00:00`);
    if (isNaN(dt)) return iso;
    return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /**
   * Friendly day label: Today / Yesterday, else format().
   * @param {string} iso
   * @param {'auto'|'ymd'|'mdy'|'dmy'} [fmt='auto']
   * @returns {string}
   */
  static label(iso, fmt = 'auto') {
    if (!iso) return '';
    const today = this.todayIso();
    if (iso === today) return 'Today';
    const y = new Date(today + 'T12:00:00'); y.setDate(y.getDate() - 1);
    if (iso === this.toIso(y)) return 'Yesterday';
    return this.format(iso, fmt);
  }
}
