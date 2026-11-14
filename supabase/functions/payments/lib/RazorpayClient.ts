/**
 * RazorpayClient — creates Razorpay orders with the server's key pair.
 * The key secret never leaves the server; the app only ever sees the key id.
 */
export class RazorpayError extends Error {}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

export class RazorpayClient {
  static readonly #ORDERS = 'https://api.razorpay.com/v1/orders';

  readonly keyId: string;
  readonly #keySecret: string;
  readonly #fetch: typeof fetch;

  constructor(keyId: string, keySecret: string, fetcher: typeof fetch = fetch) {
    this.keyId = keyId;
    this.#keySecret = keySecret;
    this.#fetch = fetcher;
  }

  /** @throws RazorpayError */
  async createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<RazorpayOrder> {
    let res: Response;
    try {
      res = await this.#fetch(RazorpayClient.#ORDERS, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa(`${this.keyId}:${this.#keySecret}`)}`,
        },
        body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: receipt.slice(0, 40), notes }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (_) {
      throw new RazorpayError('Could not reach Razorpay.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.id) {
      console.error('[payments] order failed', res.status, JSON.stringify(body?.error ?? body));
      throw new RazorpayError('Razorpay could not start the payment.');
    }
    return { id: body.id, amount: body.amount, currency: body.currency };
  }
}
