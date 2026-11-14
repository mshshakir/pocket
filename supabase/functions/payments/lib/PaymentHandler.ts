/**
 * PaymentHandler — one-time payments through Razorpay Checkout.
 *
 * From the app (signed in), POST JSON { action, ... }:
 *   products            → { products: [{ ...product, available, reason? }], keyId }
 *   order  { product, code? } → { orderId, keyId, amount, listAmount, coupon?, currency, name }
 *                         product 'programme' = the habit programme place offered to them
 *   verify { orderId, paymentId, signature } → { ok, applied }
 *
 * From Razorpay, POST /payments/webhook with X-Razorpay-Signature:
 *   payment.captured / order.paid → the order is applied (if the app's verify
 *   hasn't already). Applying is idempotent, so both paths are safe together.
 *
 * Errors are { error, code }: signed_out, bad_request, closed, not_allowed,
 * bad_coupon, not_set_up, bad_signature, not_yours, failed.
 */
import type { PaymentStore, Quote } from './PaymentStore.ts';
import { RazorpayError, type RazorpayClient } from './RazorpayClient.ts';
import { Signature } from './Signature.ts';

export type UserLookup = (authorization: string) => Promise<string | null>;

export class PaymentHandler {
  static readonly #CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  static readonly #REFUSALS: Record<string, string> = {
    closed: 'Payments aren\'t open yet.',
    unknown: 'That item isn\'t for sale.',
    lifetime: 'Your account is already free for life.',
    trial_used: 'You\'ve already used your trial.',
    has_plan: 'The trial is for people without a plan.',
    no_place: 'There is no programme place waiting for you to pay for.',
    coupon_unknown: 'That code isn\'t valid.',
    coupon_not_started: 'That code isn\'t active yet.',
    coupon_expired: 'That code has expired.',
    coupon_used_up: 'That code has been used up.',
    coupon_not_for_this: 'That code can\'t be used for this.',
  };

  readonly #userOf: UserLookup;
  readonly #store: PaymentStore;
  readonly #razorpay: RazorpayClient | null;
  readonly #checkout: Signature;
  readonly #webhook: Signature;

  /**
   * @param razorpay null until the Razorpay keys are set
   * @param keySecret signs Checkout results; webhookSecret signs webhooks
   */
  constructor(userOf: UserLookup, store: PaymentStore, razorpay: RazorpayClient | null, keySecret: string, webhookSecret: string) {
    this.#userOf = userOf;
    this.#store = store;
    this.#razorpay = razorpay;
    this.#checkout = new Signature(keySecret);
    this.#webhook = new Signature(webhookSecret);
  }

  async handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: PaymentHandler.#CORS });
    if (req.method !== 'POST') return this.#fail(405, 'bad_request', 'Use POST.');
    try {
      if (new URL(req.url).pathname.endsWith('/webhook')) return await this.#webhookEvent(req);
      return await this.#fromApp(req);
    } catch (e) {
      console.error('[payments]', e);
      return this.#fail(500, 'failed', 'Something went wrong with the payment. If you were charged, it will be applied shortly.');
    }
  }

  // ── from the app ────────────────────────────────────────────────

  async #fromApp(req: Request): Promise<Response> {
    const userId = await this.#userOf(req.headers.get('Authorization') ?? '');
    if (!userId) return this.#fail(401, 'signed_out', 'Please sign in to buy a plan.');

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    switch (body?.action) {
      case 'products': return await this.#products(userId);
      case 'order': {
        const code = PaymentHandler.#code(body.code);
        if (code === false) return this.#fail(409, 'bad_coupon', PaymentHandler.#REFUSALS.coupon_unknown);
        return await this.#order(userId, String(body.product ?? ''), code);
      }
      case 'verify': return await this.#verify(userId, body);
      default: return this.#fail(400, 'bad_request', 'Unknown action.');
    }
  }

  async #products(userId: string): Promise<Response> {
    const products = await this.#store.products();
    const quotes = await Promise.all(products.map((p) => this.#store.quote(userId, p.product)));
    return this.#json(200, {
      keyId: this.#razorpay?.keyId ?? null,
      products: products.map((p, i) => ({ ...p, sort: undefined, available: quotes[i].ok, reason: quotes[i].reason })),
    });
  }

  async #order(userId: string, product: string, coupon: string | null): Promise<Response> {
    const quote: Quote = await this.#store.quote(userId, product, coupon);
    if (!quote.ok) {
      const reason = quote.reason ?? '';
      const code = reason === 'closed' ? 'closed' : reason.startsWith('coupon_') ? 'bad_coupon' : 'not_allowed';
      return this.#fail(reason === 'closed' ? 503 : 409, code, PaymentHandler.#REFUSALS[reason] ?? 'Not available.');
    }
    if (!this.#razorpay) return this.#fail(503, 'not_set_up', 'Payments aren\'t set up yet. Please try again later.');

    let order;
    try {
      const notes: Record<string, string> = { user_id: userId, product };
      if (quote.coupon) notes.coupon = quote.coupon;
      order = await this.#razorpay.createOrder(quote.amountPaise!, `pocket-${product}-${Date.now()}`, notes);
    } catch (e) {
      if (e instanceof RazorpayError) return this.#fail(502, 'failed', `${e.message} You weren't charged.`);
      throw e;
    }
    await this.#store.saveOrder(order.id, userId, quote);
    return this.#json(200, {
      orderId: order.id, keyId: this.#razorpay.keyId, amount: order.amount, listAmount: quote.listPaise ?? order.amount,
      coupon: quote.coupon ?? null, currency: order.currency, name: quote.name,
    });
  }

  async #verify(userId: string, body: Record<string, unknown>): Promise<Response> {
    const orderId = String(body.orderId ?? ''), paymentId = String(body.paymentId ?? ''), signature = String(body.signature ?? '');
    if (!orderId || !paymentId) return this.#fail(400, 'bad_request', 'Missing payment details.');
    if (!(await this.#checkout.matches(`${orderId}|${paymentId}`, signature))) {
      return this.#fail(400, 'bad_signature', 'The payment couldn\'t be confirmed. If you were charged, it will be applied shortly.');
    }
    if ((await this.#store.ownerOf(orderId)) !== userId) return this.#fail(403, 'not_yours', 'That payment belongs to another account.');
    return this.#json(200, await this.#store.fulfil(orderId, paymentId));
  }

  // ── from Razorpay ───────────────────────────────────────────────

  async #webhookEvent(req: Request): Promise<Response> {
    const raw = await req.text();
    if (!(await this.#webhook.matches(raw, req.headers.get('X-Razorpay-Signature') ?? ''))) {
      return this.#fail(401, 'bad_signature', 'Bad signature.');
    }
    const event = JSON.parse(raw);
    const payment = event?.payload?.payment?.entity;
    const orderId: string | undefined = event?.payload?.order?.entity?.id ?? payment?.order_id;
    const paid = event?.event === 'order.paid' || (event?.event === 'payment.captured' && payment?.status === 'captured');
    if (!paid || !orderId || !payment?.id) return this.#json(200, { ignored: true });
    // Not one of Pocket's orders (another product on the same account): acknowledge and move on.
    if (!(await this.#store.ownerOf(orderId))) return this.#json(200, { ignored: true });
    return this.#json(200, await this.#store.fulfil(orderId, payment.id));
  }

  /** A coupon code as typed, tidied; null when there is none; false when it can't be a code. */
  static #code(raw: unknown): string | null | false {
    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (!code) return null;
    return /^[A-Z0-9_-]{3,32}$/.test(code) ? code : false;
  }

  // ── replies ─────────────────────────────────────────────────────

  #fail(status: number, code: string, error: string): Response {
    return this.#json(status, { error, code });
  }

  #json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...PaymentHandler.#CORS, 'Content-Type': 'application/json' },
    });
  }
}
