/**
 * RazorpayCheckout — opens Razorpay's payment window and waits for it.
 *
 * Razorpay's checkout.js is loaded only the first time someone pays, so the
 * app doesn't load a payment script for people who never buy anything.
 * Resolves with the three values the server checks; rejects with
 * PaymentError('dismissed') when the window is closed, or 'failed'.
 */
import { PaymentError } from './PaymentError.js';

export class RazorpayCheckout {
  static #SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
  /** @type {Promise<void>|null} */
  static #loading = null;

  /** @type {Window & typeof globalThis} */
  #win;

  constructor(win = globalThis.window) {
    this.#win = win;
  }

  /**
   * @param {{keyId: string, orderId?: string, subscriptionId?: string, amount: number, currency: string, name: string, email?: string}} o
   * @returns {Promise<{orderId?: string, subscriptionId?: string, paymentId: string, signature: string}>}
   */
  async open(o) {
    await this.#load();
    return new Promise((resolve, reject) => {
      // Auto-debit (a subscription) or a one-time order.
      const target = o.subscriptionId
        ? { subscription_id: o.subscriptionId }
        : { order_id: o.orderId, amount: o.amount, currency: o.currency };
      const rzp = new this.#win.Razorpay({
        key: o.keyId,
        ...target,
        name: 'Pocket',
        description: o.name,
        prefill: o.email ? { email: o.email } : undefined,
        theme: { color: '#18181b' },
        handler: (r) => resolve(o.subscriptionId
          ? { subscriptionId: r.razorpay_subscription_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }
          : { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
        modal: { ondismiss: () => reject(new PaymentError('Payment cancelled.', 'dismissed')) },
      });
      // A failed attempt keeps the window open so the person can retry another
      // way; only closing it ends the purchase.
      rzp.on?.('payment.failed', () => {});
      rzp.open();
    });
  }

  #load() {
    if (this.#win.Razorpay) return Promise.resolve();
    RazorpayCheckout.#loading ??= new Promise((resolve, reject) => {
      const s = this.#win.document.createElement('script');
      s.src = RazorpayCheckout.#SCRIPT;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        RazorpayCheckout.#loading = null;
        reject(new PaymentError('Couldn\'t open the payment window — check your connection and try again.', 'network'));
      };
      this.#win.document.head.appendChild(s);
    });
    return RazorpayCheckout.#loading;
  }
}
