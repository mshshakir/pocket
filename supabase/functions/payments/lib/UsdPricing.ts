/**
 * UsdPricing — dollar prices for people outside India (migration 0059).
 *
 * Rupee prices, sales and codes stay the source of the rules. A dollar price
 * is the product's list price in cents, scaled by whatever the rupee quote
 * took off: a 20% code makes the dollar price 20% lower too.
 */
export class UsdPricing {
  /** Razorpay's smallest USD charge. */
  static readonly MIN_CENTS = 50;

  readonly #cents: Record<string, number>;

  /** @param cents dollar list prices in cents, by product code */
  constructor(cents: Record<string, number>) {
    this.#cents = cents;
  }

  /** Is this product sold in dollars? */
  has(product: string): boolean {
    return Number.isInteger(this.#cents[product]) && this.#cents[product] > 0;
  }

  /**
   * The dollar amount in cents for a rupee quote, or null when the product
   * isn't sold in dollars.
   * @param amountPaise the rupee price to pay (after any sale or code)
   * @param listPaise   the rupee price before them (defaults to amountPaise)
   */
  cents(product: string, amountPaise: number, listPaise?: number | null): number | null {
    if (!this.has(product)) return null;
    const list = this.#cents[product];
    const before = listPaise && listPaise > 0 ? listPaise : amountPaise;
    if (!(before > 0) || amountPaise >= before) return list;
    return Math.max(UsdPricing.MIN_CENTS, Math.round(list * amountPaise / before));
  }

  /**
   * A product as the app lists it, re-priced in dollars: amountPaise and
   * listPaise then hold cents (the app reads them with `currency`). Dollar
   * items never renew by auto-debit. Null when it isn't sold in dollars.
   */
  item<T extends { product: string; amountPaise: number; listPaise?: number; renews?: boolean }>(p: T): (T & { currency: 'USD' }) | null {
    const now = this.cents(p.product, p.amountPaise, p.listPaise);
    if (now == null) return null;
    const { renews: _renews, ...rest } = p;
    const out = { ...rest, currency: 'USD' as const, amountPaise: now } as T & { currency: 'USD' };
    if (p.listPaise && p.listPaise > p.amountPaise) out.listPaise = this.#cents[p.product];
    else delete (out as { listPaise?: number }).listPaise;
    return out;
  }
}
