/**
 * PaymentHandler with fakes for sign-in, the database and Razorpay.
 * Run: deno run --import-map <map with a supabase-js stub> supabase/functions/payments/test/handler_test.ts
 */
import { PaymentHandler } from '../lib/PaymentHandler.ts';
import type { PaymentStore, Product, Quote } from '../lib/PaymentStore.ts';
import { RazorpayClient } from '../lib/RazorpayClient.ts';
import { Signature } from '../lib/Signature.ts';

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

const KEY_SECRET = 'key-secret', HOOK_SECRET = 'hook-secret';
const PRODUCTS: Product[] = [
  { product: 'sync_month', name: 'Sync · 1 month', plan: 'sync', term: 'month', amountPaise: 16900 },
  { product: 'family_trial', name: 'Family · 14-day trial', plan: 'family', term: 'trial', amountPaise: 5000 },
  { product: 'ai_pack', name: 'AI pack · 1000 uses', aiCredits: 1000, amountPaise: 10000 },
];

class FakeStore {
  open = true;
  trialUsed = false;
  orders = new Map<string, { user: string; paid: boolean; product: string }>();
  fulfilled: string[] = [];
  products() { return Promise.resolve(PRODUCTS); }
  quotedWith: (string | null)[] = [];
  offered = false;
  quote(_u: string, product: string, code: string | null = null): Promise<Quote> {
    this.quotedWith.push(code);
    if (!this.open) return Promise.resolve({ ok: false, reason: 'closed' });
    if (product === 'programme') {
      return Promise.resolve(this.offered
        ? { ok: true, product: 'programme', name: 'Habit programme · Batch 1', amountPaise: 500000, listPaise: 500000, applicationId: 7 }
        : { ok: false, reason: 'no_place' });
    }
    if (code === 'BAD') return Promise.resolve({ ok: false, reason: 'coupon_unknown' });
    if (code === 'TEN') {
      const p = PRODUCTS.find((x) => x.product === product)!;
      return Promise.resolve({ ok: true, ...p, listPaise: p.amountPaise, amountPaise: Math.round(p.amountPaise * 0.9), coupon: 'TEN', offerIds: [3] });
    }
    const p = PRODUCTS.find((x) => x.product === product);
    if (!p) return Promise.resolve({ ok: false, reason: 'unknown' });
    if (p.term === 'trial' && this.trialUsed) return Promise.resolve({ ok: false, reason: 'trial_used' });
    return Promise.resolve({ ok: true, ...p });
  }
  saved: Quote[] = [];
  saveOrder(id: string, user: string, q: Quote) { this.saved.push(q); this.orders.set(id, { user, paid: false, product: q.product! }); return Promise.resolve(); }
  ownerOf(id: string) { return Promise.resolve(this.orders.get(id)?.user ?? null); }
  fulfil(id: string, payment: string) {
    const o = this.orders.get(id)!;
    const applied = !o.paid;
    o.paid = true;
    if (applied) this.fulfilled.push(`${id}:${payment}`);
    return Promise.resolve({ ok: true, applied });
  }
}

let rzpCalls: { auth: string; body: Record<string, unknown> }[] = [];
const razorpay = (status = 200) => new RazorpayClient('rzp_test_abc', KEY_SECRET, ((_u: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  rzpCalls.push({ auth: (init?.headers as Record<string, string>).Authorization, body });
  return Promise.resolve(new Response(JSON.stringify(status === 200
    ? { id: `order_${rzpCalls.length}`, amount: body.amount, currency: 'INR' }
    : { error: { description: 'bad' } }), { status }));
}) as typeof fetch);

const userOf = (a: string) => Promise.resolve(a === 'Bearer alice' ? 'alice' : a === 'Bearer bob' ? 'bob' : null);
const make = (store: FakeStore, rzp: RazorpayClient | null = razorpay()) =>
  new PaymentHandler(userOf, store as unknown as PaymentStore, rzp, KEY_SECRET, HOOK_SECRET);
const app = (b: unknown, who = 'alice') => new Request('https://x/functions/v1/payments', {
  method: 'POST', headers: { Authorization: `Bearer ${who}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b),
});
const hook = async (event: unknown, secret = HOOK_SECRET) => {
  const raw = JSON.stringify(event);
  return new Request('https://x/payments/webhook', {
    method: 'POST', headers: { 'X-Razorpay-Signature': await new Signature(secret).sign(raw) }, body: raw,
  });
};
const checkoutSig = (order: string, payment: string, secret = KEY_SECRET) => new Signature(secret).sign(`${order}|${payment}`);

console.log('\npayments function');
{
  // Razorpay's documented sample: HMAC-SHA256 hex of a known message.
  const sig = await new Signature('key').sign('The quick brown fox jumps over the lazy dog');
  ok('P0 HMAC-SHA256 matches the standard test vector', sig === 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', sig);
}
{
  const s = new FakeStore(); s.trialUsed = true;
  const j = await (await make(s).handle(app({ action: 'products' }))).json();
  const trial = j.products.find((p: { product: string }) => p.product === 'family_trial');
  ok('P1 products list prices from the database, the key id, and what this person can buy',
    j.keyId === 'rzp_test_abc' && j.products.length === 3 && trial.available === false && trial.reason === 'trial_used' && !('sort' in j.products[0] && j.products[0].sort !== undefined), JSON.stringify(j));
}
{
  const s = new FakeStore(); rzpCalls = [];
  const res = await make(s).handle(app({ action: 'order', product: 'sync_month' }));
  const j = await res.json();
  ok('P2 an order is created at Razorpay for the database price and saved for this user',
    res.status === 200 && j.orderId === 'order_1' && j.amount === 16900 && rzpCalls[0].body.amount === 16900 && s.orders.get('order_1')?.user === 'alice', JSON.stringify(j));
  ok('P3 Razorpay gets basic auth with the key pair', rzpCalls[0].auth === `Basic ${btoa(`rzp_test_abc:${KEY_SECRET}`)}`);
  ok('P4 the app never sees the key secret', !JSON.stringify(j).includes(KEY_SECRET));
}
{
  const s = new FakeStore(); rzpCalls = [];
  const res = await make(s).handle(app({ action: 'order', product: 'sync_month', amountPaise: 1 }));
  ok('P5 the app cannot set its own price', (await res.json()).amount === 16900 && rzpCalls[0].body.amount === 16900);
}
{
  const s = new FakeStore(); s.open = false;
  const res = await make(s).handle(app({ action: 'order', product: 'sync_month' }));
  ok('P6 payments switched off: refused before Razorpay', res.status === 503 && (await res.json()).code === 'closed');
}
{
  const s = new FakeStore(); s.trialUsed = true;
  const res = await make(s).handle(app({ action: 'order', product: 'family_trial' }));
  const j = await res.json();
  ok('P7 trial already used: refused with a reason', res.status === 409 && /already used/.test(j.error), JSON.stringify(j));
}
{
  const res = await make(new FakeStore(), null).handle(app({ action: 'order', product: 'sync_month' }));
  ok('P8 no Razorpay keys yet: "not set up"', res.status === 503 && (await res.json()).code === 'not_set_up');
}
{
  const res = await make(new FakeStore(), razorpay(400)).handle(app({ action: 'order', product: 'sync_month' }));
  const j = await res.json();
  ok('P9 Razorpay refuses the order: nothing charged, said plainly', res.status === 502 && /weren't charged/.test(j.error), JSON.stringify(j));
}
{
  const res = await make(new FakeStore()).handle(app({ action: 'products' }, 'nobody'));
  ok('P10 not signed in: refused', res.status === 401 && (await res.json()).code === 'signed_out');
}
{
  const s = new FakeStore(); rzpCalls = [];
  const h = make(s);
  await h.handle(app({ action: 'order', product: 'ai_pack' }));
  const bad = await h.handle(app({ action: 'verify', orderId: 'order_1', paymentId: 'pay_1', signature: 'deadbeef' }));
  ok('P11 a forged Checkout result is refused and nothing applied', bad.status === 400 && (await bad.json()).code === 'bad_signature' && !s.fulfilled.length);
  const bob = await h.handle(app({ action: 'verify', orderId: 'order_1', paymentId: 'pay_1', signature: await checkoutSig('order_1', 'pay_1') }, 'bob'));
  ok('P12 someone else cannot claim my payment', bob.status === 403 && !s.fulfilled.length);
  const good = await h.handle(app({ action: 'verify', orderId: 'order_1', paymentId: 'pay_1', signature: await checkoutSig('order_1', 'pay_1') }));
  const j = await good.json();
  ok('P13 a genuine payment is applied', good.status === 200 && j.applied === true && s.fulfilled[0] === 'order_1:pay_1', JSON.stringify(j));

  const event = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', status: 'captured' } } } };
  const again = await (await h.handle(await hook(event))).json();
  ok('P14 the webhook for the same payment changes nothing', again.applied === false && s.fulfilled.length === 1, JSON.stringify(again));
}
{
  const s = new FakeStore(); rzpCalls = [];
  const h = make(s);
  await h.handle(app({ action: 'order', product: 'sync_month' }));
  const event = { event: 'order.paid', payload: { order: { entity: { id: 'order_1' } }, payment: { entity: { id: 'pay_9', order_id: 'order_1', status: 'captured' } } } };
  const forged = await h.handle(await hook(event, 'wrong-secret'));
  ok('P15 a webhook with a wrong signature is refused', forged.status === 401 && !s.fulfilled.length);
  const res = await h.handle(await hook(event));
  ok('P16 the app never came back: the webhook applies the payment', (await res.json()).applied === true && s.fulfilled[0] === 'order_1:pay_9');
}
{
  const s = new FakeStore();
  const h = make(s);
  const other = await (await h.handle(await hook({ event: 'order.paid', payload: { order: { entity: { id: 'order_xyz' } }, payment: { entity: { id: 'pay_x' } } } }))).json();
  const failedPay = await (await h.handle(await hook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: 'order_1', status: 'failed' } } } }))).json();
  ok('P17 other orders and other events are acknowledged and ignored', other.ignored === true && failedPay.ignored === true && !s.fulfilled.length);
}

{
  const s = new FakeStore(); rzpCalls = [];
  const res = await make(s).handle(app({ action: 'order', product: 'sync_month', code: ' ten ' }));
  const j = await res.json();
  ok('P18 a coupon is passed to the price check, tidied; the order is for the discounted amount',
    s.quotedWith.at(-1) === 'TEN' && rzpCalls[0].body.amount === 15210 && j.amount === 15210 && j.listAmount === 16900 && j.coupon === 'TEN'
    && (rzpCalls[0].body.notes as Record<string, string>).coupon === 'TEN' && s.saved[0].offerIds?.[0] === 3, JSON.stringify(j));
}
{
  const s = new FakeStore(); rzpCalls = [];
  const res = await make(s).handle(app({ action: 'order', product: 'sync_month', code: 'BAD' }));
  const j = await res.json();
  ok('P19 a bad code: refused with a reason, no Razorpay order', res.status === 409 && j.code === 'bad_coupon' && /isn't valid/.test(j.error) && !rzpCalls.length, JSON.stringify(j));
  const odd = await make(new FakeStore()).handle(app({ action: 'order', product: 'sync_month', code: 'no spaces allowed!' }));
  ok('P20 a code with odd characters never reaches the database as typed', (await odd.json()).code === 'bad_coupon');
}
{
  const s = new FakeStore(); rzpCalls = [];
  const before = await (await make(s).handle(app({ action: 'order', product: 'programme' }))).json();
  ok('P21 programme before a place is offered: refused', before.code === 'not_allowed' && /no programme place/.test(before.error), JSON.stringify(before));
  s.offered = true;
  const j = await (await make(s).handle(app({ action: 'order', product: 'programme' }))).json();
  ok('P22 programme once offered: ₹5,000 order tied to the application', j.amount === 500000 && s.saved.at(-1)?.applicationId === 7 && /Habit programme/.test(j.name), JSON.stringify(j));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
