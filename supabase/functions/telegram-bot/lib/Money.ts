/**
 * Money — minor-unit and FX rules mirrored from the app's CurrencyService,
 * over a rate table in units per 1 USD.
 */
export class Money {
  static readonly #ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'ISK', 'RWF', 'UGX', 'XAF', 'XOF', 'XPF']);
  static readonly #THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
  static readonly #SYMBOLS: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', KES: 'KSh ' };

  readonly #rates: Record<string, number>;

  constructor(rates: Record<string, number> = {}) {
    this.#rates = rates;
  }

  factor(currency: string): number {
    if (Money.#ZERO_DECIMAL.has(currency)) return 1;
    if (Money.#THREE_DECIMAL.has(currency)) return 1000;
    return 100;
  }

  toMinor(major: number, currency: string): number {
    return Math.round(major * this.factor(currency));
  }

  /** Same formula as the app's TransactionComposer: rate(ccy) / rate(home). */
  exchangeRate(currency: string, home: string): number {
    if (currency === home) return 1;
    return (this.#rates[currency] || 1) / (this.#rates[home] || 1);
  }

  /** Units of `to` per one unit of `from`; throws when either rate is missing. */
  rate(from: string, to: string): number {
    if (from === to) return 1;
    const fromRate = this.#rates[from];
    const toRate = this.#rates[to];
    if (!fromRate || !toRate) throw new Error(`No exchange rate for ${from} → ${to}. Add the received amount, e.g. =7750`);
    return toRate / fromRate;
  }

  /** Amount in home-currency minor units; throws when a rate is missing. */
  convert(minor: number, from: string, to: string): number {
    if (from === to) return minor;
    const fromRate = this.#rates[from];
    const toRate = this.#rates[to];
    if (!fromRate || !toRate) throw new Error(`No exchange rate for ${from} → ${to}`);
    return this.toMinor((minor / this.factor(from) / fromRate) * toRate, to);
  }

  format(minor: number, currency: string): string {
    const major = minor / this.factor(currency);
    const text = major.toLocaleString('en-IN', { maximumFractionDigits: 3 });
    const symbol = Money.#SYMBOLS[currency];
    return symbol ? `${symbol}${text}` : `${text} ${currency}`;
  }
}
