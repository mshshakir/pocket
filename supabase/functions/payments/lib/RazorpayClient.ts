/**
 * RazorpayClient — talks to Razorpay with the server's key pair: one-time
 * orders, and for auto-debit, plans and subscriptions.
 * The key secret never leaves the server; the app only ever sees the key id.
 */
export class RazorpayError extends Error {}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

export interface RazorpaySubscription {
  id: string;
  status: string;
}

export class RazorpayClient {
  static readonly #API = 'https://api.razorpay.com/v1';

  readonly keyId: string;
  readonly #keySecret: string;
  readonly #fetch: typeof fetch;

  constructor(keyId: string, keySecret: string, fetcher: typeof fetch = fetch) {
    this.keyId = keyId;
    this.#keySecret = keySecret;
    this.#fetch = fetcher;
  }

  /** @throws RazorpayError */
  /** @param amount in the currency's smallest unit (paise, cents) */
  async createOrder(amount: number, receipt: string, notes: Record<string, string>, currency: 'INR' | 'USD' = 'INR'): Promise<RazorpayOrder> {
    const body = await this.#post('/orders', { amount, currency, receipt: receipt.slice(0, 40), notes },
      'Razorpay could not start the payment.');
    return { id: body.id, amount: body.amount, currency: body.currency };
  }

  /** A plan that charges `amountPaise` every month or year. @throws RazorpayError */
  async createPlan(term: 'month' | 'year', amountPaise: number, name: string): Promise<string> {
    const body = await this.#post('/plans', {
      period: term === 'month' ? 'monthly' : 'yearly', interval: 1,
      item: { name: name.slice(0, 100), amount: amountPaise, currency: 'INR' },
    }, 'Razorpay could not set up auto-debit.');
    return body.id;
  }

  /** A subscription on a plan, paid for the first time in Checkout. @throws RazorpayError */
  async createSubscription(planId: string, totalCount: number, notes: Record<string, string>): Promise<RazorpaySubscription> {
    const body = await this.#post('/subscriptions', {
      plan_id: planId, total_count: totalCount, quantity: 1, customer_notify: 1, notes,
    }, 'Razorpay could not set up auto-debit.');
    return { id: body.id, status: body.status };
  }

  /** Stops future charges straight away. @throws RazorpayError */
  async cancelSubscription(id: string): Promise<RazorpaySubscription> {
    const body = await this.#post(`/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: 0 },
      'Razorpay could not stop the auto-debit.');
    return { id: body.id, status: body.status };
  }

  async #post(path: string, payload: unknown, failure: string): Promise<Record<string, any>> {
    let res: Response;
    try {
      res = await this.#fetch(`${RazorpayClient.#API}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa(`${this.keyId}:${this.#keySecret}`)}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (_) {
      throw new RazorpayError('Could not reach Razorpay.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.id) {
      console.error('[payments]', path, 'failed', res.status, JSON.stringify(body?.error ?? body));
      throw new RazorpayError(failure);
    }
    return body;
  }
}
