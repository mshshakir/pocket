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
  /**
   * Process-wide label cache. Static (not per-instance) because the app creates
   * many CurrencyService instances; a per-instance `_labelMap` rebuilt the same
   * Intl.DisplayNames table for each one and was never shared.
   * @type {Record<string, string>|null}
   */
  static #labelMap = null;

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
   * Strict conversion: throws when either currency has no FX rate. Use this on
   * the ledger/balance path, where the caller MUST be able to tell an
   * unconvertible row apart from a genuine zero (e.g. to skip freezing it and
   * retry later) rather than silently folding a wrong number into a balance.
   * @param {number} minor
   * @param {string} from
   * @param {string} to
   * @returns {number} amount in minor units of `to`
   * @throws {Error} when `from` or `to` is not in the rate table
   */
  convertStrict(minor, from, to) {
    if (from === to) return minor;
    const fromRate = RATES[from];
    const toRate   = RATES[to];
    if (!fromRate || !toRate) {
      throw new Error(`No FX rate for ${from}→${to}`);
    }
    const majorUSD = this.fromMinor(minor, from) / fromRate;
    const majorTo  = majorUSD * toRate;
    return this.toMinor(majorTo, to);
  }

  /**
   * Resilient conversion for display/aggregation. Delegates to convertStrict but
   * NEVER throws: an unknown currency yields 0 (with a warning) instead of the
   * old, dangerous 1:1 passthrough, so a single corrupt/exotic currency can no
   * longer silently inflate a home-currency total by treating, say, 1000 JPY as
   * 1000 USD.
   * @param {number} minor   - amount in minor units of `from`
   * @param {string} from
   * @param {string} to
   * @returns {number} amount in minor units of `to` (0 if unconvertible)
   */
  convert(minor, from, to) {
    try {
      return this.convertStrict(minor, from, to);
    } catch (e) {
      console.warn(`[CurrencyService] ${e.message}; counting as 0 to avoid a wrong total`);
      return 0;
    }
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
    if (!CurrencyService.#labelMap) {
      const map = {};
      try {
        const dn = new Intl.DisplayNames(['en'], { type: 'currency' });
        CURRENCIES.forEach((c) => { map[c] = dn.of(c) || c; });
      } catch {
        CURRENCIES.forEach((c) => { map[c] = c; });
      }
      CurrencyService.#labelMap = map;
    }
    return CurrencyService.#labelMap;
  }

  /** All supported currency codes, sorted. @returns {string[]} */
  get allCodes() {
    return CURRENCIES;
  }
}
