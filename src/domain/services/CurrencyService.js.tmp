/**
 * CurrencyService — All currency arithmetic in one place.
 *
 * Responsibilities:
 *  - Minor-unit ↔ major-unit conversion (respecting ISO 4217 decimal rules)
 *  - Cross-currency conversion via FX rate table
 *  - Locale-aware money formatting
 *  - Human-readable currency labels
 *
 * No DOM, no state, no side effects — pure computation only.
 */
import { CURRENCIES, ZERO_DECIMAL, THREE_DECIMAL } from '../../data/constants.js';
import { RATES } from './FxRates.js';

export class CurrencyService {
  // ── Minor-unit helpers ──────────────────────────────────────────────

  /** @param {string} currency @returns {number} */
  minorFactor(currency) {
    if (ZERO_DECIMAL.has(currency))  return 1;
    if (THREE_DECIMAL.has(currency)) return 1000;
    return 100;
  }

  /** @param {string} currency @returns {number} decimal digits */
  minorDigits(currency) {
    if (ZERO_DECIMAL.has(currency))  return 0;
    if (THREE_DECIMAL.has(currency)) return 3;
    return 2;
  }

  /**
   * Convert a human-entered amount (e.g. 12.50) to minor units (1250).
   * @param {number|string} amount
   * @param {string} currency
   * @returns {number} integer minor units
   */
  toMinor(amount, currency) {
    return Math.round(Number(amount) * this.minorFactor(currency));
  }

  /**
   * Convert minor units (1250) back to a human amount (12.50).
   * @param {number} minor
   * @param {string} currency
   * @returns {number}
   */
  fromMinor(minor, currency) {
    return Number(minor) / this.minorFactor(currency);
  }

  // ── FX conversion ───────────────────────────────────────────────────

  /**
   * Convert a minor-unit amount from one currency to another.
   * @param {number} minor   - amount in minor units of `from`
   * @param {string} from
   * @param {string} to
   * @returns {number} amount in minor units of `to`
   */
  convert(minor, from, to) {
    if (from === to) return minor;
    const fromRate = RATES[from];
    const toRate   = RATES[to];
    if (!fromRate || !toRate) {
      console.warn(`[CurrencyService] Unknown currency: ${from} or ${to}`);
      return minor;
    }
    const majorUSD = this.fromMinor(minor, from) / fromRate;
    const majorTo  = majorUSD * toRate;
    return this.toMinor(majorTo, to);
  }

  /**
   * Return the auto-computed FX rate between two currencies.
   * (to-per-from expressed as a floating point multiplier)
   * @param {string} from
   * @param {string} to
   * @returns {number}
   */
  autoRate(from, to) {
    if (from === to) return 1;
    return (RATES[to] ?? 1) / (RATES[from] ?? 1);
  }

  // ── Formatting ──────────────────────────────────────────────────────

  /**
   * Format a minor-unit amount as a locale-aware currency string.
   * @param {number} minor
   * @param {string} currency
   * @param {object} [opts]
   * @returns {string}
   */
  formatMoney(minor, currency, opts = {}) {
    const value  = this.fromMinor(minor, currency);
    const digits = this.minorDigits(currency);
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        ...opts,
      }).format(value);
    } catch {
      const sign = value < 0 ? '-' : '';
      return `${sign}${currency} ${Math.abs(value).toFixed(digits)}`;
    }
  }

  /**
   * Human-readable currency label.
   * @param {string} code  e.g. 'USD'
   * @returns {string}  e.g. 'USD — US Dollar'
   */
  label(code) {
    try {
      const dn   = new Intl.DisplayNames(['en'], { type: 'currency' });
      const name = dn.of(code);
      return name ? `${code} — ${name}` : code;
    } catch {
      return code;
    }
  }

  /**
   * Pre-built label map for all supported currencies (built once, cached).
   * @returns {Record<string, string>}
   */
  get labelMap() {
    if (!this._labelMap) {
      const map = {};
      try {
        const dn = new Intl.DisplayNames(['en'], { type: 'currency' });
        CURRENCIES.forEach((c) => { map[c] = dn.of(c) || c; });
      } catch {
        CURRENCIES.forEach((c) => { map[c] = c; });
      }
      this._labelMap = map;
    }
    return this._labelMap;
  }

  /** All supported currency codes, sorted. @returns {string[]} */
  get allCodes() {
    return CURRENCIES;
  }
}
