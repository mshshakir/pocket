/**
 * PaymentHandler — one-time payments through Razorpay Checkout.
 *
 * From the app (signed in), POST JSON { action, ... }:
 *   products { code? }  → { products: [{ ...product, available, reason?, coupon? }], keyId, coupon? }
 *                         with a code, each item it applies to is priced with it
 *                         (coupon: { code, products }); a code that isn't
 *                         valid, or fits none of them, is refused (bad_coupon)
 *   order  { product, code? } → { orderId, keyId, amount, listAmount, coupon?, currency, name }
 *                         product 'programme' = the habit programme place offered to them, in full
 *                         (less the upfront discount); 'programme_half' = half now, confirming the
 *                         place; 'programme_rest' = the other half (migration 0051)
 *                         For a plan that renews by itself (migration 0053: the ₹30 promise,
 *                         Pocket Pro monthly/yearly, Group yearly) the answer is instead
 *                         { kind: 'subscription', subscriptionId, keyId, amount, currency, name }:
 *                         Checkout sets up auto-debit and takes the first payment. Coupons
 *                         don't apply to auto-debit.
 *   verify { orderId, paymentId, signature } → { ok, applied }
 *   verify { subscriptionId, paymentId, signature } → { ok, applied }  the first auto-debit charge
 *   cancel {}           → { ok, cancelled }  stops auto-debit; the time paid for runs to its end
 *   switch { plan }     → { ok, applied, plan, days, endsAt }  moving down to a
 *                         cheaper plan: no payment, the time left becomes days there
 *
 * Moving up is an ordinary order: the full price, plus the time left on the
 * old plan as extra days (products show it as switchDays; switches lists
 * the free moves down).
 *
 * From Razorpay, POST /payments/webhook with X-Razorpay-Signature:
 *   payment.captured / order.paid → the order is applied (if the app's verify
 *   hasn't already). Applying is idempotent, so both paths are safe together.
 *   subscription.charged → that charge is applied (first payment and renewals).
 *   subscription.authenticated / activated / pending / halted / cancelled /
 *   completed / paused / resumed → the subscription's status; when it stops,
 *   the plan stops renewing.
 *
 * Errors are { error, code }: signed_out, bad_request, closed, not_allowed,
 * bad_coupon, not_set_up, bad_signature, not_yours, failed.
 */
import type { PaymentStore, Quote, SubscriptionQuote } from './PaymentStore.ts';
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
    has_backup: 'Scheduled backups are already switched on for your account.',
    has_subscription: 'Auto-debit for this is already on.',
    auto_debit_off: 'Monthly auto-debit isn\'t available yet. Meanwhile, you can ask to use Pocket free.',
    promise_not_needed: 'Your plan already lets you add entries, so the ₹30 promise isn\'t needed.',
    no_place: 'There is no programme place waiting for you to pay for.',
    no_rest: 'There is no second half of the programme fee left to pay.',
    no_credit: 'There\'s no paid time left on your plan to move.',
    not_lower: 'Moving to a bigger plan needs a payment; your time left is added as extra days.',
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
      case 'products': {
        const code = PaymentHandler.#code(body.code);
        if (code === false) return this.#fail(409, 'bad_coupon', PaymentHandler.#REFUSALS.coupon_unknown);
        return await this.#products(userId, code);
      }
      case 'order': {
        const code = PaymentHandler.#code(body.code);
        if (code === false) return this.#fail(409, 'bad_coupon', PaymentHandler.#REFUSALS.coupon_unknown);
        return await this.#order(userId, String(body.product ?? ''), code);
      }
      case 'verify': return body.subscriptionId ? await this.#verifySubscription(userId, body) : await this.#verify(userId, body);
      case 'cancel': return await this.#cancel(userId);
      case 'switch': return await this.#switch(userId, String(body.plan ?? ''));
      default: return this.#fail(400, 'bad_request', 'Unknown action.');
    }
  }

  async #products(userId: string, code: string | null): Promise<Response> {
    const products = await this.#store.products();
    const quotes = await Promise.all(products.map((p) => this.#store.quote(userId, p.product)));
    // Whether each monthly/yearly product is sold by auto-debit right now (billing_settings.auto_debit_enabled).
    const renewing = await Promise.all(products.map((p) => (p.term === 'month' || p.term === 'year')
      ? this.#store.subscriptionQuote(userId, p.product).then((q) => q.renewing && q.reason !== 'auto_debit_off')
      : Promise.resolve(false)));
    const listed = products.map((p, i) => ({
      ...p, sort: undefined, available: quotes[i].ok, reason: quotes[i].reason,
      ...(renewing[i] ? { renews: true } : {}),
      ...(quotes[i].switchDays ? { switchDays: quotes[i].switchDays, switchFrom: quotes[i].switchFrom } : {}),
    }));
    const switches = await this.#store.switchOptions(userId);
    if (!code) return this.#json(200, { keyId: this.#razorpay?.keyId ?? null, products: listed, switches });

    // Price each item this person can buy with the code too.
    const withCode = await Promise.all(products.map((p, i) =>
      quotes[i].ok ? this.#store.quote(userId, p.product, code) : Promise.resolve(null)));
    const broken = withCode.find((q) => q && !q.ok && PaymentHandler.#CODE_FAULTS.has(q.reason ?? ''));
    if (broken) return this.#fail(409, 'bad_coupon', PaymentHandler.#REFUSALS[broken.reason!]);
    const applied = listed.map((p, i) => {
      const q = withCode[i];
      return q?.ok && q.coupon ? { ...p, amountPaise: q.amountPaise, listPaise: q.listPaise, sale: q.sale, coupon: q.coupon } : p;
    });
    const fits = applied.filter((p) => 'coupon' in p).map((p) => p.product);
    if (!fits.length) return this.#fail(409, 'bad_coupon', PaymentHandler.#REFUSALS.coupon_not_for_this);
    return this.#json(200, { keyId: this.#razorpay?.keyId ?? null, products: applied, switches, coupon: { code, products: fits } });
  }

  async #switch(userId: string, plan: string): Promise<Response> {
    if (!/^[a-z_]{1,32}$/.test(plan)) return this.#fail(400, 'bad_request', 'Which plan?');
    const r = await this.#store.switchPlan(userId, plan);
    if (!r.ok) {
      const reason = r.reason ?? '';
      return this.#fail(reason === 'closed' ? 503 : 409, reason === 'closed' ? 'closed' : 'not_allowed', PaymentHandler.#REFUSALS[reason] ?? 'Not available.');
    }
    return this.#json(200, { ok: true, applied: true, plan: r.plan, days: r.days, endsAt: r.endsAt });
  }

  /** Refusals that mean the code itself is no good (not just "not for this item"). */
  static readonly #CODE_FAULTS = new Set(['coupon_unknown', 'coupon_not_started', 'coupon_expired', 'coupon_used_up']);

  async #order(userId: string, product: string, coupon: string | null): Promise<Response> {
    const renewing = await this.#store.subscriptionQuote(userId, product);
    if (renewing.renewing) return await this.#subscribe(userId, renewing, product);
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

  // ── auto-debit ──────────────────────────────────────────────────

  async #subscribe(userId: string, q: SubscriptionQuote, product: string): Promise<Response> {
    if (!q.ok) {
      const reason = product.startsWith('promise_') && q.reason === 'has_plan' ? 'promise_not_needed' : q.reason ?? '';
      return this.#fail(reason === 'closed' ? 503 : 409, reason === 'closed' ? 'closed' : 'not_allowed', PaymentHandler.#REFUSALS[reason] ?? 'Not available.');
    }
    if (!this.#razorpay) return this.#fail(503, 'not_set_up', 'Payments aren\'t set up yet. Please try again later.');
    let sub;
    try {
      let planId = await this.#store.razorpayPlan(q.product!, q.amountPaise!);
      if (!planId) {
        const made = await this.#razorpay.createPlan(q.term!, q.amountPaise!, `Pocket · ${q.name}`);
        planId = await this.#store.saveRazorpayPlan(q.product!, q.amountPaise!, made);
      }
      sub = await this.#razorpay.createSubscription(planId, q.totalCount ?? 120, { user_id: userId, product: q.product! });
      await this.#store.saveSubscription(sub.id, userId, q, planId);
    } catch (e) {
      if (e instanceof RazorpayError) return this.#fail(502, 'failed', `${e.message} You weren't charged.`);
      throw e;
    }
    return this.#json(200, {
      kind: 'subscription', subscriptionId: sub.id, keyId: this.#razorpay.keyId,
      amount: q.amountPaise, listAmount: q.amountPaise, currency: 'INR', name: q.name, renews: q.term,
    });
  }

  async #verifySubscription(userId: string, body: Record<string, unknown>): Promise<Response> {
    const subId = String(body.subscriptionId ?? ''), paymentId = String(body.paymentId ?? ''), signature = String(body.signature ?? '');
    if (!subId || !paymentId) return this.#fail(400, 'bad_request', 'Missing payment details.');
    if (!(await this.#checkout.matches(`${paymentId}|${subId}`, signature))) {
      return this.#fail(400, 'bad_signature', 'The payment couldn\'t be confirmed. If you were charged, it will be applied shortly.');
    }
    if ((await this.#store.subscriptionOwner(subId)) !== userId) return this.#fail(403, 'not_yours', 'That payment belongs to another account.');
    const r = await this.#store.charge(subId, paymentId, null);
    await this.#cancelReplaced(r.cancel);
    return this.#json(200, { ok: true, applied: r.applied });
  }

  async #cancel(userId: string): Promise<Response> {
    const current = await this.#store.currentSubscription(userId);
    if (!current) return this.#fail(409, 'not_allowed', 'There is no auto-debit to stop.');
    if (!this.#razorpay) return this.#fail(503, 'not_set_up', 'Payments aren\'t set up yet. Please try again later.');
    try {
      await this.#razorpay.cancelSubscription(current.id);
    } catch (e) {
      if (e instanceof RazorpayError) return this.#fail(502, 'failed', `${e.message} Please try again.`);
      throw e;
    }
    await this.#store.subscriptionStatus(current.id, 'cancelled');
    return this.#json(200, { ok: true, cancelled: true });
  }

  /** Stops subscriptions a newer one replaced. A failure is logged, not shown: the person has paid for the new plan. */
  async #cancelReplaced(ids: string[]): Promise<void> {
    for (const id of ids) {
      try { await this.#razorpay?.cancelSubscription(id); }
      catch (e) { console.error('[payments] cancelling replaced subscription failed', id, e); }
    }
  }

  // ── from Razorpay ───────────────────────────────────────────────

  async #webhookEvent(req: Request): Promise<Response> {
    const raw = await req.text();
    if (!(await this.#webhook.matches(raw, req.headers.get('X-Razorpay-Signature') ?? ''))) {
      return this.#fail(401, 'bad_signature', 'Bad signature.');
    }
    const event = JSON.parse(raw);
    if (typeof event?.event === 'string' && event.event.startsWith('subscription.')) return await this.#subscriptionEvent(event);
    const payment = event?.payload?.payment?.entity;
    const orderId: string | undefined = event?.payload?.order?.entity?.id ?? payment?.order_id;
    const paid = event?.event === 'order.paid' || (event?.event === 'payment.captured' && payment?.status === 'captured');
    if (!paid || !orderId || !payment?.id) return this.#json(200, { ignored: true });
    // Not one of Pocket's orders (another product on the same account): acknowledge and move on.
    if (!(await this.#store.ownerOf(orderId))) return this.#json(200, { ignored: true });
    return this.#json(200, await this.#store.fulfil(orderId, payment.id));
  }

  async #subscriptionEvent(event: Record<string, any>): Promise<Response> {
    const sub = event?.payload?.subscription?.entity;
    if (!sub?.id || !(await this.#store.subscriptionOwner(sub.id))) return this.#json(200, { ignored: true });
    if (event.event === 'subscription.charged') {
      const payment = event?.payload?.payment?.entity;
      if (!payment?.id) return this.#json(200, { ignored: true });
      const r = await this.#store.charge(sub.id, payment.id, Number.isInteger(payment.amount) ? payment.amount : null);
      await this.#cancelReplaced(r.cancel);
      return this.#json(200, { ok: true, applied: r.applied });
    }
    if (typeof sub.status === 'string') await this.#store.subscriptionStatus(sub.id, sub.status);
    return this.#json(200, { ok: true });
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
