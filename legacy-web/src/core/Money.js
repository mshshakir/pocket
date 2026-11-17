/**
 * Money — which currency Pocket's own prices are shown and charged in, and
 * how to write them (owner, 17 Nov 2026).
 *
 * In India's time zone prices are in rupees; everywhere else in US dollars.
 * There is no switch. Amounts are in the currency's smallest unit (paise or
 * cents). This is only about what Pocket sells — a person's own entries keep
 * their own currencies.
 *
 * The dollar list mirrors the usd_prices table (migration 0059), for places
 * that show a price before the server has quoted one (the website, a plan
 * card while offers load). The server's quote is always what is charged.
 */
export class Money {
  static #INDIA = new Set(['Asia/Kolkata', 'Asia/Calcutta']);

  /** Dollar list prices in cents, by product (keep in step with usd_prices). */
  static #USD = Object.freeze({
    family_month: 299, family_year: 2499, family_trial: 399, group_year: 4999,
    drive_backup: 499, ai_pack: 200, promise_month: 100,
    programme_full: 11800, programme: 9900, programme_half: 5900, programme_rest: 5900,
  });

  /** For tests: a fixed time zone instead of the device's. @type {string|null} */
  static zoneOverride = null;

  /** The device's time zone, e.g. 'Asia/Kolkata' ('' when it can't be read). */
  static zone() {
    if (Money.zoneOverride != null) return Money.zoneOverride;
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; }
  }

  /** 'INR' in India's time zone, 'USD' anywhere else. An unreadable zone counts as India. */
  static currency(zone = Money.zone()) {
    return !zone || Money.#INDIA.has(zone) ? 'INR' : 'USD';
  }

  static get dollars() { return Money.currency() === 'USD'; }

  /**
   * "₹1,499" / "$24.99"; whole amounts without decimals ("$2", "₹99").
   * @param {number} minor  paise or cents
   * @param {'INR'|'USD'} [currency]
   */
  static format(minor, currency = Money.currency()) {
    const usd = currency === 'USD';
    return (minor / 100).toLocaleString(usd ? 'en-US' : 'en-IN', {
      style: 'currency', currency: usd ? 'USD' : 'INR', maximumFractionDigits: minor % 100 ? 2 : 0,
    });
  }

  /**
   * A list price in the shown currency, from the rupee price the plans table
   * gives: the rupees in India, the dollar list price elsewhere (null when
   * that product isn't sold in dollars).
   * @param {string} product  e.g. 'family_year'
   * @param {number|null|undefined} paise
   */
  static list(product, paise) {
    if (!Money.dollars) return paise ?? null;
    return Money.#USD[product] ?? null;
  }

  /** The dollar list price in cents (null when not sold in dollars). */
  static usd(product) { return Money.#USD[product] ?? null; }

  /** An item from the payments function: written in its own currency. */
  static ofItem(o, minor = o.amountPaise) {
    return Money.format(minor, o.currency === 'USD' ? 'USD' : 'INR');
  }
}
