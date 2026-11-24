/**
 * CellValue — reads a date or an amount out of a cell as people type them.
 *
 *   dates    2025-11-12 · 12/11/2025 · 12-11-25 · 12 Nov 2025 · Nov 12, 2025 ·
 *            an Excel day number (45973). Day/month order comes from the AI
 *            (DMY, MDY or YMD); an impossible date ("31/02/2025") is null.
 *   amounts  ₹1,234.50 · 1,234.50 Dr · (500) · -500 · 500- · Rs. 2,000 ·
 *            "12,34,567" (Indian grouping)
 */
export class CellValue {
  static #MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  /**
   * @param {string} text
   * @param {'DMY'|'MDY'|'YMD'} [order='DMY']
   * @returns {string|null} YYYY-MM-DD
   */
  static date(text, order = 'DMY') {
    const s = String(text ?? '').trim().replace(/\s+/g, ' ');
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
    if (m) return CellValue.#make(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T].*)?$/);
    if (m) {
      const y = CellValue.#year(m[3]);
      const [d, mo] = order === 'MDY' ? [+m[2], +m[1]] : [+m[1], +m[2]];
      return CellValue.#make(y, mo, d);
    }
    m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[ \-/.]?([a-z]{3,9})[ \-/.,]*(\d{2}|\d{4})$/i);
    if (m) {
      const mo = CellValue.#month(m[2]);
      return mo ? CellValue.#make(CellValue.#year(m[3]), mo, +m[1]) : null;
    }
    m = s.match(/^([a-z]{3,9})[ \-/.]?(\d{1,2})(?:st|nd|rd|th)?[ ,\-/.]*(\d{2}|\d{4})$/i);
    if (m) {
      const mo = CellValue.#month(m[1]);
      return mo ? CellValue.#make(CellValue.#year(m[3]), mo, +m[2]) : null;
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (n > 20000 && n < 80000) return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
    }
    return null;
  }

  /**
   * @param {string} text
   * @returns {{value: number, sign: -1|1, mark: 'dr'|'cr'|null}|null} value is positive (major units)
   */
  static amount(text) {
    let s = String(text ?? '').trim().toLowerCase();
    if (!s) return null;
    let mark = null;
    const dc = s.match(/\b(dr|cr)\.?$/);
    if (dc) { mark = dc[1]; s = s.slice(0, dc.index).trim(); }
    let sign = 1;
    if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
    s = s.replace(/^(rs\.?|inr|usd|aed|sar|gbp|eur)\s*/i, '').replace(/[₹$€£¥]/g, '').trim();
    if (s.startsWith('-') || s.startsWith('−')) { sign = -1; s = s.slice(1); }
    else if (s.endsWith('-')) { sign = -1; s = s.slice(0, -1); }
    else if (s.startsWith('+')) s = s.slice(1);
    s = s.replace(/[\s,']/g, '');
    if (!/^\d*\.?\d+$/.test(s)) return null;
    const value = Number(s);
    return Number.isFinite(value) ? { value, sign, mark } : null;
  }

  static #year(y) {
    const n = Number(y);
    return y.length === 2 ? (n > 70 ? 1900 + n : 2000 + n) : n;
  }

  static #month(word) {
    const i = CellValue.#MONTHS.indexOf(String(word).slice(0, 3).toLowerCase());
    return i < 0 ? 0 : i + 1;
  }

  static #make(y, m, d) {
    if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return null;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d > days) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
}
