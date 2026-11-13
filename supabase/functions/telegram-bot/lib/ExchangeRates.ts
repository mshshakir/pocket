/**
 * ExchangeRates — the same live source the app's ExchangeRateService uses
 * (open.er-api.com, units per 1 USD), cached for 6 hours per function
 * instance. The owner's saved `fxRates`, if any, fill in when the fetch fails.
 */
export class ExchangeRates {
  static readonly #ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
  static readonly #TTL_MS = 6 * 60 * 60 * 1000;
  static readonly #TIMEOUT_MS = 4000;

  #cache: Record<string, number> | null = null;
  #fetchedAt = 0;

  /** Live rates merged over the book's saved ones. */
  async current(saved: Record<string, number>): Promise<Record<string, number>> {
    const live = await this.#live();
    return { ...saved, ...(live ?? {}) };
  }

  async #live(): Promise<Record<string, number> | null> {
    if (this.#cache && Date.now() - this.#fetchedAt < ExchangeRates.#TTL_MS) return this.#cache;
    try {
      const res = await fetch(ExchangeRates.#ENDPOINT, { signal: AbortSignal.timeout(ExchangeRates.#TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rates = (await res.json())?.rates;
      if (!rates || typeof rates.USD !== 'number') throw new Error('Unexpected payload');
      this.#cache = rates;
      this.#fetchedAt = Date.now();
    } catch (err) {
      console.warn('[telegram-bot] exchange rate fetch failed', err);
    }
    return this.#cache;
  }
}
