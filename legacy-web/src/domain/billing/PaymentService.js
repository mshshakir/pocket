/**
 * PaymentService — buying a plan, a trial or an AI pack (phase 5).
 *
 *   offers()  what's for sale and whether this person can buy each item
 *   buy(code) order on the server → Razorpay's window → the server checks
 *             the signature and applies it → { applied }
 *
 * Prices and rules live on the server (the `payments` function and the
 * database); the app never sends an amount. If the app loses the answer after
 * paying, Razorpay's webhook applies the payment anyway.
 */
import { PaymentError } from './PaymentError.js';

export class PaymentService {
  #invoker;
  #checkout;

  /**
   * @param {() => (((name: string, opts: object) => Promise<{data: any, error: any}>)|null)} invoker
   *   supabase.functions.invoke for the signed-in person, or null when signed out
   * @param {{open: (o: object) => Promise<{orderId: string, paymentId: string, signature: string}>}} checkout
   */
  constructor(invoker, checkout) {
    this.#invoker = invoker;
    this.#checkout = checkout;
  }

  /**
   * What's for sale. With a coupon code, each item it applies to comes back
   * at its final price (amountPaise) with the price before (listPaise).
   * @param {string} [code]
   * @returns {Promise<{keyId: string|null, coupon: {code: string, products: string[]}|null, products: {product: string, name: string, plan?: string, term?: string, aiCredits?: number, amountPaise: number, listPaise?: number, coupon?: string, available: boolean, reason?: string}[]}>}
   * @throws {PaymentError}  code 'bad_coupon' when the code isn't valid or fits nothing
   */
  async offers(code = '') {
    const c = String(code ?? '').trim();
    const data = await this.#call({ action: 'products', ...(c ? { code: c } : {}) });
    return { keyId: data.keyId ?? null, coupon: data.coupon ?? null, products: Array.isArray(data.products) ? data.products : [] };
  }

  /**
   * @param {string} product  e.g. 'sync_month', 'family_trial', 'ai_pack'
   * @param {{email?: string, code?: string}} [who]  code: a coupon code, if typed
   * @returns {Promise<{applied: boolean}>}
   * @throws {PaymentError}  code 'dismissed' when the person closed the window
   */
  async buy(product, who = {}) {
    const code = (who.code ?? '').trim();
    const order = await this.#call({ action: 'order', product, ...(code ? { code } : {}) });
    const paid = await this.#checkout.open({ ...order, email: who.email });
    const result = await this.#call({ action: 'verify', ...paid });
    return { applied: result.applied === true };
  }

  async #call(body) {
    const invoke = this.#invoker();
    if (!invoke) throw new PaymentError('Please sign in to buy a plan.', 'signed_out');
    let result;
    try {
      result = await invoke('payments', { body });
    } catch (_) {
      throw new PaymentError('Network error — check your connection and try again.', 'network');
    }
    const { data, error } = result ?? {};
    if (error) throw await PaymentService.#explain(error);
    return data ?? {};
  }

  static async #explain(error) {
    try {
      const body = await error.context?.json?.();
      if (body?.error) return new PaymentError(body.error, body.code || 'failed');
    } catch (_) { /* not JSON */ }
    return new PaymentError(error.message || 'The payment request failed. Please try again.', 'failed');
  }
}
