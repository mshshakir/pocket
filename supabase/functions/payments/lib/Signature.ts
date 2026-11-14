/**
 * Signature — Razorpay's HMAC-SHA256 checks.
 *   Checkout:  hex(HMAC(key secret,     order_id + "|" + payment_id))
 *   Webhook:   hex(HMAC(webhook secret, raw request body))
 * Compared in constant time.
 */
export class Signature {
  readonly #secret: string;

  constructor(secret: string) {
    this.#secret = secret;
  }

  async sign(message: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(this.#secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
    return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async matches(message: string, signature: string): Promise<boolean> {
    if (!this.#secret || !signature) return false;
    const expected = await this.sign(message);
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  }
}
